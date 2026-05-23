CREATE OR REPLACE FUNCTION public.notify_department_members(
  target_department_id UUID,
  target_task_id UUID,
  notification_type TEXT,
  notification_message TEXT,
  actor_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_record RECORD;
BEGIN
  FOR member_record IN
    SELECT DISTINCT m.user_id
    FROM public.user_department_memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.department_id = target_department_id
      AND m.is_active = TRUE
      AND p.status = 'active'
      AND (actor_user_id IS NULL OR m.user_id <> actor_user_id)
  LOOP
    PERFORM public.create_notification(member_record.user_id, target_task_id, notification_type, notification_message);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_task_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.task_history(task_id, user_id, action, new_value)
  VALUES (NEW.id, NEW.created_by_id, 'task_created', to_jsonb(NEW));

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.created_by_id AND role = 'admin' AND status = 'active'
  ) THEN
    PERFORM public.notify_department_members(
      NEW.department_id,
      NEW.id,
      'department_task_created',
      'Un administrador agrego una tarea a tu departamento: ' || NEW.title,
      NEW.created_by_id
    );
  ELSIF NEW.responsible_id IS NOT NULL AND NEW.responsible_id <> NEW.created_by_id THEN
    PERFORM public.create_notification(NEW.responsible_id, NEW.id, 'task_assigned', 'Se te asigno una nueva tarea: ' || NEW.title);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_task_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := COALESCE(auth.uid(), NEW.created_by_id);
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
      NEW.completed_at := NOW();
    ELSIF NEW.status <> 'completed' THEN
      NEW.completed_at := NULL;
    END IF;

    IF NEW.status = 'archived' AND NEW.archived_at IS NULL THEN
      NEW.archived_at := NOW();
    ELSIF NEW.status <> 'archived' THEN
      NEW.archived_at := NULL;
    END IF;
  END IF;

  INSERT INTO public.task_history(task_id, user_id, action, previous_value, new_value)
  SELECT NEW.id, actor_id, 'task_updated',
    jsonb_strip_nulls(jsonb_build_object(
      'title', CASE WHEN OLD.title IS DISTINCT FROM NEW.title THEN OLD.title END,
      'description', CASE WHEN OLD.description IS DISTINCT FROM NEW.description THEN OLD.description END,
      'department_id', CASE WHEN OLD.department_id IS DISTINCT FROM NEW.department_id THEN OLD.department_id END,
      'responsible_id', CASE WHEN OLD.responsible_id IS DISTINCT FROM NEW.responsible_id THEN OLD.responsible_id END,
      'status', CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN OLD.status END,
      'priority', CASE WHEN OLD.priority IS DISTINCT FROM NEW.priority THEN OLD.priority END,
      'start_date', CASE WHEN OLD.start_date IS DISTINCT FROM NEW.start_date THEN OLD.start_date END,
      'due_date', CASE WHEN OLD.due_date IS DISTINCT FROM NEW.due_date THEN OLD.due_date END
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'title', CASE WHEN OLD.title IS DISTINCT FROM NEW.title THEN NEW.title END,
      'description', CASE WHEN OLD.description IS DISTINCT FROM NEW.description THEN NEW.description END,
      'department_id', CASE WHEN OLD.department_id IS DISTINCT FROM NEW.department_id THEN NEW.department_id END,
      'responsible_id', CASE WHEN OLD.responsible_id IS DISTINCT FROM NEW.responsible_id THEN NEW.responsible_id END,
      'status', CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN NEW.status END,
      'priority', CASE WHEN OLD.priority IS DISTINCT FROM NEW.priority THEN NEW.priority END,
      'start_date', CASE WHEN OLD.start_date IS DISTINCT FROM NEW.start_date THEN NEW.start_date END,
      'due_date', CASE WHEN OLD.due_date IS DISTINCT FROM NEW.due_date THEN NEW.due_date END
    ))
  WHERE OLD IS DISTINCT FROM NEW;

  IF OLD.responsible_id IS DISTINCT FROM NEW.responsible_id AND NEW.responsible_id IS NOT NULL THEN
    PERFORM public.create_notification(NEW.responsible_id, NEW.id, 'task_assigned', 'Se te asigno una nueva tarea: ' || NEW.title);
  END IF;

  IF OLD.description IS DISTINCT FROM NEW.description THEN
    PERFORM public.notify_department_members(
      NEW.department_id,
      NEW.id,
      'description_changed',
      'Se cambio la descripcion de una tarea de tu departamento: ' || NEW.title,
      actor_id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_comment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_record public.tasks;
  actor_name TEXT;
BEGIN
  SELECT * INTO task_record FROM public.tasks WHERE id = NEW.task_id;
  SELECT COALESCE(NULLIF(trim(full_name), ''), 'Alguien') INTO actor_name
  FROM public.profiles
  WHERE id = NEW.user_id;

  INSERT INTO public.task_history(task_id, user_id, action, new_value)
  VALUES (NEW.task_id, NEW.user_id, 'comment_added', jsonb_build_object('comment_id', NEW.id, 'comment', NEW.comment));

  PERFORM public.notify_department_members(
    task_record.department_id,
    NEW.task_id,
    'comment_added',
    COALESCE(actor_name, 'Alguien') || ' comento en una tarea de tu departamento: ' || task_record.title,
    NEW.user_id
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_attachment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_record public.tasks;
BEGIN
  SELECT * INTO task_record FROM public.tasks WHERE id = NEW.task_id;

  INSERT INTO public.task_history(task_id, user_id, action, new_value)
  VALUES (NEW.task_id, NEW.uploaded_by_id, 'file_attached', jsonb_build_object('attachment_id', NEW.id, 'file_name', NEW.file_name));

  PERFORM public.notify_department_members(
    task_record.department_id,
    NEW.task_id,
    'file_attached',
    'Se adjunto un archivo a una tarea de tu departamento: ' || task_record.title,
    NEW.uploaded_by_id
  );

  RETURN NEW;
END;
$$;

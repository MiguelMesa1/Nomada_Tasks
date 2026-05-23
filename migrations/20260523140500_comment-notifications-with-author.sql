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

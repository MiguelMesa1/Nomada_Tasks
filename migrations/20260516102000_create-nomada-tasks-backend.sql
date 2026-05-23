-- Migracion principal del backend de Nomada Tasks.
--
-- Crea tablas, funciones, triggers, permisos RLS, reportes
-- y logica de tareas recurrentes en InsForge.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  leader_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'pending' CHECK (role IN ('admin', 'department_lead', 'user', 'pending')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive')),
  approved_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_department_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'lead')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, department_id)
);

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  responsible_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'planning', 'in_progress', 'blocked', 'in_review', 'completed', 'archived')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  start_date DATE,
  due_date DATE,
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.recurring_task_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_base_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly', 'specific_weekday', 'custom_interval')),
  weekday INTEGER CHECK (weekday BETWEEN 0 AND 6),
  weekdays INTEGER[] NOT NULL DEFAULT '{}',
  month_day INTEGER CHECK (month_day BETWEEN 1 AND 31),
  interval_days INTEGER CHECK (interval_days >= 1),
  scheduled_time TIME,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  created_by_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'task-attachments',
  storage_key TEXT NOT NULL,
  file_url TEXT,
  file_type TEXT,
  file_size BIGINT,
  uploaded_by_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  comment TEXT NOT NULL CHECK (length(trim(comment)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.task_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  action TEXT NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_profiles_role_status ON public.profiles(role, status);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.user_department_memberships(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_memberships_department ON public.user_department_memberships(department_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tasks_department ON public.tasks(department_id);
CREATE INDEX IF NOT EXISTS idx_tasks_responsible ON public.tasks(responsible_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_recurring_next_run ON public.recurring_task_rules(is_active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON public.task_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON public.task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_history_task ON public.task_history(task_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, is_read, created_at DESC);

INSERT INTO public.departments (name)
VALUES ('Pagina Web'), ('Marketing'), ('Comercial'), ('Logistica'), ('Bot')
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.current_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND status = 'active' AND role <> 'pending'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_department_access(department_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1
    FROM public.user_department_memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.user_id = auth.uid()
      AND m.department_id = department_uuid
      AND m.is_active = TRUE
      AND p.status = 'active'
      AND p.role <> 'pending'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_department(department_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1
    FROM public.user_department_memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.user_id = auth.uid()
      AND m.department_id = department_uuid
      AND m.role = 'lead'
      AND m.is_active = TRUE
      AND p.status = 'active'
      AND p.role IN ('department_lead', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_task(task_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_uuid
      AND public.has_department_access(t.department_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_task(task_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_uuid
      AND (
        public.can_manage_department(t.department_id)
        OR t.created_by_id = auth.uid()
        OR t.responsible_id = auth.uid()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.create_notification(target_user_id UUID, target_task_id UUID, notification_type TEXT, notification_message TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
BEGIN
  IF target_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications(user_id, task_id, type, message)
  VALUES (target_user_id, target_task_id, notification_type, notification_message)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_admins(notification_type TEXT, notification_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_record RECORD;
BEGIN
  FOR admin_record IN
    SELECT id FROM public.profiles WHERE role = 'admin' AND status = 'active'
  LOOP
    PERFORM public.create_notification(admin_record.id, NULL, notification_type, notification_message);
  END LOOP;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.ensure_current_profile(profile_full_name TEXT DEFAULT NULL)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bootstrap_email CONSTANT TEXT := 'miguelangelmesagarzon@gmail.com';
  current_email TEXT;
  metadata_name TEXT;
  user_name TEXT;
  profile_record public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT email, raw_user_meta_data->>'name' INTO current_email, metadata_name FROM auth.users WHERE id = auth.uid();
  user_name := COALESCE(NULLIF(trim(profile_full_name), ''), NULLIF(trim(metadata_name), ''), split_part(current_email, '@', 1));

  INSERT INTO public.profiles(id, full_name, email, role, status, approved_by_id, approved_at)
  VALUES (
    auth.uid(),
    user_name,
    current_email,
    CASE WHEN lower(current_email) = bootstrap_email THEN 'admin' ELSE 'pending' END,
    CASE WHEN lower(current_email) = bootstrap_email THEN 'active' ELSE 'pending' END,
    CASE WHEN lower(current_email) = bootstrap_email THEN auth.uid() ELSE NULL END,
    CASE WHEN lower(current_email) = bootstrap_email THEN NOW() ELSE NULL END
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
    email = EXCLUDED.email,
    role = CASE
      WHEN lower(EXCLUDED.email) = bootstrap_email AND public.profiles.role = 'pending' THEN 'admin'
      ELSE public.profiles.role
    END,
    status = CASE
      WHEN lower(EXCLUDED.email) = bootstrap_email AND public.profiles.status = 'pending' THEN 'active'
      ELSE public.profiles.status
    END,
    approved_by_id = CASE
      WHEN lower(EXCLUDED.email) = bootstrap_email AND public.profiles.approved_by_id IS NULL THEN auth.uid()
      ELSE public.profiles.approved_by_id
    END,
    approved_at = CASE
      WHEN lower(EXCLUDED.email) = bootstrap_email AND public.profiles.approved_at IS NULL THEN NOW()
      ELSE public.profiles.approved_at
    END,
    updated_at = NOW()
  RETURNING * INTO profile_record;

  IF lower(current_email) <> bootstrap_email AND profile_record.created_at = profile_record.updated_at THEN
    PERFORM public.notify_admins('new_pending_user', 'Nuevo usuario pendiente de asignacion: ' || user_name);
  END IF;

  RETURN profile_record;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER departments_touch_updated_at BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER memberships_touch_updated_at BEFORE UPDATE ON public.user_department_memberships FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tasks_touch_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER subtasks_touch_updated_at BEFORE UPDATE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER recurring_rules_touch_updated_at BEFORE UPDATE ON public.recurring_task_rules FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER comments_touch_updated_at BEFORE UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

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

CREATE TRIGGER tasks_after_insert AFTER INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.handle_task_insert();
CREATE TRIGGER tasks_before_update BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.handle_task_update();

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

CREATE TRIGGER comments_after_insert AFTER INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.handle_comment_insert();

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

CREATE TRIGGER attachments_after_insert AFTER INSERT ON public.task_attachments FOR EACH ROW EXECUTE FUNCTION public.handle_attachment_insert();

CREATE OR REPLACE FUNCTION public.approve_user(target_user_id UUID, target_role TEXT, department_ids UUID[], lead_department_ids UUID[] DEFAULT '{}')
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  department_uuid UUID;
  updated_profile public.profiles;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve users';
  END IF;

  IF target_role NOT IN ('admin', 'department_lead', 'user') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  UPDATE public.profiles
  SET role = target_role,
      status = 'active',
      approved_by_id = auth.uid(),
      approved_at = NOW()
  WHERE id = target_user_id
  RETURNING * INTO updated_profile;

  DELETE FROM public.user_department_memberships WHERE user_id = target_user_id;

  FOREACH department_uuid IN ARRAY COALESCE(department_ids, '{}')
  LOOP
    INSERT INTO public.user_department_memberships(user_id, department_id, role, is_active, assigned_by_id)
    VALUES (
      target_user_id,
      department_uuid,
      CASE WHEN department_uuid = ANY(COALESCE(lead_department_ids, '{}')) THEN 'lead' ELSE 'member' END,
      TRUE,
      auth.uid()
    )
    ON CONFLICT (user_id, department_id) DO UPDATE SET
      role = EXCLUDED.role,
      is_active = TRUE,
      assigned_by_id = EXCLUDED.assigned_by_id,
      assigned_at = NOW();
  END LOOP;

  PERFORM public.create_notification(target_user_id, NULL, 'account_approved', 'Tu cuenta fue aprobada. Ya puedes acceder a tus tareas.');
  RETURN updated_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_own_profile(profile_full_name TEXT, profile_email TEXT)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_profile public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.profiles
  SET full_name = COALESCE(NULLIF(trim(profile_full_name), ''), full_name),
      email = COALESCE(NULLIF(trim(profile_email), ''), email),
      updated_at = NOW()
  WHERE id = auth.uid()
  RETURNING * INTO updated_profile;

  RETURN updated_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_department_change(requested_department_id UUID, request_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester public.profiles;
  department_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO requester FROM public.profiles WHERE id = auth.uid();
  SELECT name INTO department_name FROM public.departments WHERE id = requested_department_id;

  PERFORM public.notify_admins(
    'department_change_requested',
    COALESCE(requester.full_name, requester.email, 'Un usuario')
      || ' solicito cambio de departamento a '
      || COALESCE(department_name, 'un departamento sin identificar')
      || COALESCE('. Motivo: ' || NULLIF(trim(request_reason), ''), '')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_summary(target_department_id UUID DEFAULT NULL)
RETURNS TABLE (
  total_tasks BIGINT,
  pending_tasks BIGINT,
  in_progress_tasks BIGINT,
  completed_tasks BIGINT,
  overdue_tasks BIGINT,
  high_priority_tasks BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE status IN ('idea', 'planning'))::BIGINT,
    COUNT(*) FILTER (WHERE status IN ('in_progress', 'blocked', 'in_review'))::BIGINT,
    COUNT(*) FILTER (WHERE status = 'completed')::BIGINT,
    COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('completed', 'archived'))::BIGINT,
    COUNT(*) FILTER (WHERE priority = 'high')::BIGINT
  FROM public.tasks t
  WHERE (target_department_id IS NULL OR t.department_id = target_department_id)
    AND t.status <> 'archived'
    AND public.has_department_access(t.department_id);
$$;

CREATE OR REPLACE FUNCTION public.task_report(target_department_id UUID DEFAULT NULL)
RETURNS TABLE (
  department_id UUID,
  department_name TEXT,
  status TEXT,
  priority TEXT,
  total BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.department_id, d.name, t.status, t.priority, COUNT(*)::BIGINT
  FROM public.tasks t
  JOIN public.departments d ON d.id = t.department_id
  WHERE (target_department_id IS NULL OR t.department_id = target_department_id)
    AND public.has_department_access(t.department_id)
  GROUP BY t.department_id, d.name, t.status, t.priority
  ORDER BY d.name, t.status, t.priority;
$$;

CREATE OR REPLACE FUNCTION public.calculate_next_run(
  base_at TIMESTAMPTZ,
  frequency_value TEXT,
  weekday_value INTEGER,
  weekdays_value INTEGER[] DEFAULT '{}',
  month_day_value INTEGER DEFAULT NULL,
  interval_days_value INTEGER DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  candidate TIMESTAMPTZ;
  selected_weekdays INTEGER[] := CASE
    WHEN array_length(weekdays_value, 1) IS NULL OR array_length(weekdays_value, 1) = 0 THEN ARRAY[weekday_value]
    ELSE weekdays_value
  END;
  diff_days INTEGER;
BEGIN
  IF frequency_value = 'daily' THEN
    RETURN base_at + INTERVAL '1 day';
  ELSIF frequency_value = 'weekly' THEN
    FOR diff_days IN 1..7 LOOP
      candidate := base_at + (diff_days || ' days')::INTERVAL;
      IF EXTRACT(DOW FROM candidate)::INTEGER = ANY(selected_weekdays) THEN
        RETURN candidate;
      END IF;
    END LOOP;
    RETURN base_at + INTERVAL '1 week';
  ELSIF frequency_value = 'monthly' THEN
    candidate := date_trunc('month', base_at + INTERVAL '1 month')
      + ((LEAST(COALESCE(month_day_value, EXTRACT(DAY FROM base_at)::INTEGER), EXTRACT(DAY FROM (date_trunc('month', base_at + INTERVAL '1 month') + INTERVAL '1 month' - INTERVAL '1 day'))::INTEGER) - 1) || ' days')::INTERVAL
      + (base_at - date_trunc('day', base_at));
    RETURN candidate;
  ELSIF frequency_value = 'yearly' THEN
    RETURN base_at + INTERVAL '1 year';
  ELSIF frequency_value = 'specific_weekday' THEN
    diff_days := (weekday_value - EXTRACT(DOW FROM base_at)::INTEGER + 7) % 7;
    IF diff_days = 0 THEN
      diff_days := 7;
    END IF;
    candidate := base_at + (diff_days || ' days')::INTERVAL;
    RETURN candidate;
  ELSIF frequency_value = 'custom_interval' THEN
    RETURN base_at + (COALESCE(interval_days_value, 1) || ' days')::INTERVAL;
  END IF;

  RETURN base_at + INTERVAL '1 day';
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_recurring_tasks()
RETURNS TABLE(created_task_id UUID, rule_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rule_record RECORD;
  base_task public.tasks;
  new_task_id UUID;
  next_run TIMESTAMPTZ;
BEGIN
  FOR rule_record IN
    SELECT * FROM public.recurring_task_rules
    WHERE is_active = TRUE
      AND next_run_at <= NOW()
      AND (end_date IS NULL OR end_date >= CURRENT_DATE)
  LOOP
    SELECT * INTO base_task FROM public.tasks WHERE id = rule_record.task_base_id;

    IF base_task.id IS NULL THEN
      UPDATE public.recurring_task_rules SET is_active = FALSE WHERE id = rule_record.id;
      CONTINUE;
    END IF;

    INSERT INTO public.tasks (
      title, description, department_id, responsible_id, created_by_id, status, priority,
      start_date, due_date, is_recurring
    )
    VALUES (
      base_task.title,
      base_task.description,
      base_task.department_id,
      base_task.responsible_id,
      base_task.created_by_id,
      'idea',
      base_task.priority,
      CURRENT_DATE,
      CASE
        WHEN base_task.due_date IS NULL THEN NULL
        ELSE CURRENT_DATE + GREATEST((base_task.due_date - COALESCE(base_task.start_date, base_task.created_at::DATE)), 0)
      END,
      TRUE
    )
    RETURNING id INTO new_task_id;

    next_run := public.calculate_next_run(
      rule_record.next_run_at,
      rule_record.frequency,
      rule_record.weekday,
      rule_record.weekdays,
      rule_record.month_day,
      rule_record.interval_days
    );

    UPDATE public.recurring_task_rules
    SET last_run_at = NOW(),
        next_run_at = next_run,
        is_active = CASE WHEN end_date IS NOT NULL AND next_run::DATE > end_date THEN FALSE ELSE TRUE END
    WHERE id = rule_record.id;

    created_task_id := new_task_id;
    rule_id := rule_record.id;
    RETURN NEXT;
  END LOOP;
END;
$$;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_department_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_task_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY departments_select ON public.departments
  FOR SELECT TO authenticated
  USING (public.is_active_user() AND (public.is_admin() OR public.has_department_access(id)));
CREATE POLICY departments_insert ON public.departments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY departments_update ON public.departments
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.user_department_memberships mine
      JOIN public.user_department_memberships theirs ON theirs.department_id = mine.department_id
      WHERE mine.user_id = auth.uid()
        AND theirs.user_id = profiles.id
        AND mine.is_active = TRUE
        AND theirs.is_active = TRUE
    )
  );
CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY memberships_select ON public.user_department_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin() OR public.has_department_access(department_id));
CREATE POLICY memberships_insert_admin ON public.user_department_memberships
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY memberships_update_admin ON public.user_department_memberships
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
CREATE POLICY memberships_delete_admin ON public.user_department_memberships
  FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (public.has_department_access(department_id));
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user() AND public.has_department_access(department_id) AND created_by_id = auth.uid());
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.can_edit_task(id))
  WITH CHECK (public.has_department_access(department_id));
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE TO authenticated
  USING (public.can_manage_department(department_id));

CREATE POLICY subtasks_select ON public.subtasks
  FOR SELECT TO authenticated
  USING (public.can_access_task(task_id));
CREATE POLICY subtasks_insert ON public.subtasks
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_task(task_id) AND created_by_id = auth.uid());
CREATE POLICY subtasks_update ON public.subtasks
  FOR UPDATE TO authenticated
  USING (public.can_edit_task(task_id))
  WITH CHECK (public.can_edit_task(task_id));
CREATE POLICY subtasks_delete ON public.subtasks
  FOR DELETE TO authenticated
  USING (public.can_edit_task(task_id));

CREATE POLICY recurring_select ON public.recurring_task_rules
  FOR SELECT TO authenticated
  USING (public.can_access_task(task_base_id));
CREATE POLICY recurring_insert ON public.recurring_task_rules
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_task(task_base_id) AND created_by_id = auth.uid());
CREATE POLICY recurring_update ON public.recurring_task_rules
  FOR UPDATE TO authenticated
  USING (public.can_edit_task(task_base_id))
  WITH CHECK (public.can_edit_task(task_base_id));
CREATE POLICY recurring_delete ON public.recurring_task_rules
  FOR DELETE TO authenticated
  USING (public.can_edit_task(task_base_id));

CREATE POLICY attachments_select ON public.task_attachments
  FOR SELECT TO authenticated
  USING (public.can_access_task(task_id));
CREATE POLICY attachments_insert ON public.task_attachments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_task(task_id) AND uploaded_by_id = auth.uid());
CREATE POLICY attachments_delete ON public.task_attachments
  FOR DELETE TO authenticated
  USING (public.can_edit_task(task_id));

CREATE POLICY comments_select ON public.task_comments
  FOR SELECT TO authenticated
  USING (public.can_access_task(task_id));
CREATE POLICY comments_insert ON public.task_comments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_task(task_id) AND user_id = auth.uid());
CREATE POLICY comments_update ON public.task_comments
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY comments_delete ON public.task_comments
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.can_edit_task(task_id));

CREATE POLICY history_select ON public.task_history
  FOR SELECT TO authenticated
  USING (task_id IS NULL OR public.can_access_task(task_id));

CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

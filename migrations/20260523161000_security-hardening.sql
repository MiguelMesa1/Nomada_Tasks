ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_title_length_check CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT tasks_description_length_check CHECK (description IS NULL OR char_length(description) <= 5000);

ALTER TABLE public.task_comments
  ADD CONSTRAINT task_comments_comment_length_check CHECK (char_length(trim(comment)) BETWEEN 1 AND 2000);

ALTER TABLE public.task_attachments
  ADD CONSTRAINT task_attachments_file_name_length_check CHECK (char_length(file_name) BETWEEN 1 AND 255),
  ADD CONSTRAINT task_attachments_storage_key_check CHECK (storage_bucket = 'task-attachments' AND storage_key ~ '^tasks/[0-9a-fA-F-]{36}/[^/]+$'),
  ADD CONSTRAINT task_attachments_file_size_check CHECK (file_size IS NULL OR file_size BETWEEN 0 AND 10485760);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_full_name_length_check CHECK (char_length(trim(full_name)) BETWEEN 1 AND 120),
  ADD CONSTRAINT profiles_email_length_check CHECK (char_length(email) BETWEEN 3 AND 320);

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
    SELECT rule.*
    FROM public.recurring_task_rules AS rule
    JOIN public.tasks AS task ON task.id = rule.task_base_id
    WHERE rule.is_active = TRUE
      AND rule.next_run_at <= NOW()
      AND (rule.end_date IS NULL OR rule.end_date >= CURRENT_DATE)
      AND (auth.uid() IS NULL OR public.has_department_access(task.department_id))
  LOOP
    SELECT * INTO base_task FROM public.tasks WHERE id = rule_record.task_base_id;

    IF base_task.id IS NULL THEN
      UPDATE public.recurring_task_rules SET is_active = FALSE WHERE id = rule_record.id;
      CONTINUE;
    END IF;

    INSERT INTO public.tasks (
      title, description, department_id, responsible_id, created_by_id, status, priority,
      start_date, due_date, is_recurring, recurring_rule_id
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
      TRUE,
      rule_record.id
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

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_department_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_department(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_task(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_task(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_assign_task_responsible(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_id_from_storage_key(TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_current_profile(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_user(UUID, TEXT, UUID[], UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_department_change(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_report(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_tasks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_archived_tasks() TO authenticated;

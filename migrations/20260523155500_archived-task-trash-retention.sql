UPDATE public.tasks AS task
SET status = 'idea',
    archived_at = NULL
FROM public.recurring_task_rules AS rule
WHERE rule.task_base_id = task.id
  AND rule.is_active = TRUE
  AND task.status = 'archived';

DELETE FROM public.tasks AS task
WHERE task.status = 'archived'
  AND NOT EXISTS (
    SELECT 1
    FROM public.recurring_task_rules AS rule
    WHERE rule.task_base_id = task.id
      AND rule.is_active = TRUE
  );

CREATE OR REPLACE FUNCTION public.purge_expired_archived_tasks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.tasks AS task
  WHERE task.status = 'archived'
    AND COALESCE(task.archived_at, task.updated_at, task.created_at) <= NOW() - INTERVAL '3 days'
    AND NOT EXISTS (
      SELECT 1
      FROM public.recurring_task_rules AS rule
      WHERE rule.task_base_id = task.id
        AND rule.is_active = TRUE
    );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

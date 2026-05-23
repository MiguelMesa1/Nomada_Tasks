UPDATE public.tasks AS task
SET status = 'archived'
FROM public.recurring_task_rules AS rule
WHERE rule.task_base_id = task.id
  AND rule.is_active = TRUE
  AND task.status NOT IN ('archived', 'completed');

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS recurring_rule_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_recurring_rule_id_fkey'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_recurring_rule_id_fkey
      FOREIGN KEY (recurring_rule_id)
      REFERENCES public.recurring_task_rules(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_tasks_recurring_rule_id
  ON public.tasks(recurring_rule_id);

UPDATE public.tasks AS task
SET recurring_rule_id = rule.id
FROM public.recurring_task_rules AS rule
WHERE task.id = rule.task_base_id
  AND task.recurring_rule_id IS NULL;

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

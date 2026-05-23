ALTER TABLE public.recurring_task_rules
  DROP CONSTRAINT IF EXISTS recurring_task_rules_frequency_check;

ALTER TABLE public.recurring_task_rules
  ADD COLUMN IF NOT EXISTS weekdays INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS month_day INTEGER CHECK (month_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS interval_days INTEGER CHECK (interval_days >= 1),
  ADD CONSTRAINT recurring_task_rules_frequency_check
    CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly', 'specific_weekday', 'custom_interval'));

UPDATE public.recurring_task_rules
SET weekdays = ARRAY[weekday]
WHERE weekday IS NOT NULL
  AND (weekdays IS NULL OR array_length(weekdays, 1) IS NULL);

DROP FUNCTION IF EXISTS public.calculate_next_run(TIMESTAMPTZ, TEXT, INTEGER);

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

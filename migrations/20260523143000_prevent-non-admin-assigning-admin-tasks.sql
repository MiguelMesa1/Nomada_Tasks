-- Evita que usuarios no administradores asignen tareas a perfiles admin.

CREATE OR REPLACE FUNCTION public.can_assign_task_responsible(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    target_user_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = target_user_id
        AND p.status = 'active'
        AND p.role <> 'pending'
        AND (public.is_admin() OR p.role <> 'admin')
    );
$$;

ALTER POLICY tasks_insert ON public.tasks
  WITH CHECK (
    public.is_active_user()
    AND public.has_department_access(department_id)
    AND created_by_id = auth.uid()
    AND public.can_assign_task_responsible(responsible_id)
  );

ALTER POLICY tasks_update ON public.tasks
  USING (public.can_edit_task(id))
  WITH CHECK (
    public.has_department_access(department_id)
    AND public.can_assign_task_responsible(responsible_id)
  );

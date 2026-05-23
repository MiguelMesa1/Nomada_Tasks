ALTER POLICY tasks_delete ON public.tasks
  USING (public.is_admin());

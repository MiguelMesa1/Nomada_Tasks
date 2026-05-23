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

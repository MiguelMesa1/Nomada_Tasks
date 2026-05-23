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

  SELECT email INTO current_email
  FROM auth.users
  WHERE id = auth.uid();

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'raw_user_meta_data'
  ) THEN
    EXECUTE 'SELECT raw_user_meta_data->>''name'' FROM auth.users WHERE id = $1'
    INTO metadata_name
    USING auth.uid();
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'user_metadata'
  ) THEN
    EXECUTE 'SELECT user_metadata->>''name'' FROM auth.users WHERE id = $1'
    INTO metadata_name
    USING auth.uid();
  END IF;

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

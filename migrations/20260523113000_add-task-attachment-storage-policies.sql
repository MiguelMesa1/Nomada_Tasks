CREATE OR REPLACE FUNCTION public.task_id_from_storage_key(object_key TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF object_key ~ '^tasks/[0-9a-fA-F-]{36}/' THEN
    RETURN split_part(object_key, '/', 2)::UUID;
  END IF;

  RETURN NULL;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

DROP POLICY IF EXISTS storage_task_attachments_select ON storage.objects;
DROP POLICY IF EXISTS storage_task_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS storage_task_attachments_update ON storage.objects;
DROP POLICY IF EXISTS storage_task_attachments_delete ON storage.objects;

CREATE POLICY storage_task_attachments_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket = 'task-attachments'
    AND public.can_access_task(public.task_id_from_storage_key(key))
  );

CREATE POLICY storage_task_attachments_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket = 'task-attachments'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
    AND public.can_edit_task(public.task_id_from_storage_key(key))
  );

CREATE POLICY storage_task_attachments_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket = 'task-attachments'
    AND public.can_edit_task(public.task_id_from_storage_key(key))
  )
  WITH CHECK (
    bucket = 'task-attachments'
    AND public.can_edit_task(public.task_id_from_storage_key(key))
  );

CREATE POLICY storage_task_attachments_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket = 'task-attachments'
    AND public.can_edit_task(public.task_id_from_storage_key(key))
  );

GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_id_from_storage_key(TEXT) TO authenticated;

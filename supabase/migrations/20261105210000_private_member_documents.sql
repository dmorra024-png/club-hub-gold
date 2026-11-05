-- Preserve every existing object; scope old and new document paths to the club.
CREATE FUNCTION public.can_access_snoop_document(object_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE target uuid; fragment text;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 IF public.is_super_admin(auth.uid()) THEN RETURN true; END IF;
 IF split_part(object_path,'/',1)='clubs' AND split_part(object_path,'/',3)='members' THEN
   fragment:=split_part(object_path,'/',2);
   IF fragment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN false; END IF;
   target:=fragment::uuid;
 ELSIF split_part(object_path,'/',1)='members' THEN
   SELECT club_id INTO target FROM public.members WHERE id::text=split_part(object_path,'/',2);
 ELSE
   -- Older records can contain a different stored filename: resolve its owner,
   -- rather than opening the entire bucket or rewriting historical paths.
   SELECT CASE WHEN count(DISTINCT club_id)=1 THEN min(club_id::text)::uuid ELSE NULL END INTO target FROM public.members WHERE dni_photo_path=object_path OR signature_path=object_path;
 END IF;
 RETURN target IS NOT NULL AND (public.is_super_admin(auth.uid()) OR (target=public.current_club_id() AND public.can_manage_club_members(target)));
END;
$$;
REVOKE ALL ON FUNCTION public.can_access_snoop_document(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_access_snoop_document(text) TO authenticated;
DROP POLICY "auth read snoop-docs" ON storage.objects;
DROP POLICY "auth insert snoop-docs" ON storage.objects;
DROP POLICY "auth update snoop-docs" ON storage.objects;
DROP POLICY "auth delete snoop-docs" ON storage.objects;
CREATE POLICY snoop_documents_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='snoop-docs' AND public.can_access_snoop_document(name));
CREATE POLICY snoop_documents_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='snoop-docs' AND public.can_access_snoop_document(name));
CREATE POLICY snoop_documents_update ON storage.objects FOR UPDATE TO authenticated USING(bucket_id='snoop-docs' AND public.can_access_snoop_document(name)) WITH CHECK(bucket_id='snoop-docs' AND public.can_access_snoop_document(name));
CREATE POLICY snoop_documents_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='snoop-docs' AND public.can_access_snoop_document(name));

-- Optional per-club endorsing member (socio avalador) for new registrations.
-- Additive, no existing members modified.
BEGIN;
ALTER TABLE public.members
 ADD COLUMN IF NOT EXISTS avalador_first_name text,
 ADD COLUMN IF NOT EXISTS avalador_last_name text;
ALTER TABLE public.members
 DROP CONSTRAINT IF EXISTS members_avalador_pair_check;
ALTER TABLE public.members
 ADD CONSTRAINT members_avalador_pair_check CHECK (
  (nullif(btrim(coalesce(avalador_first_name,'')),'') IS NULL AND nullif(btrim(coalesce(avalador_last_name,'')),'') IS NULL)
  OR
  (nullif(btrim(coalesce(avalador_first_name,'')),'') IS NOT NULL AND nullif(btrim(coalesce(avalador_last_name,'')),'') IS NOT NULL)
 );
CREATE OR REPLACE FUNCTION public.snoop_register_member_with_avalador(
 p_member jsonb, p_plan_id uuid, p_method text, p_request uuid, p_confirmed_cents integer
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $avalador$
DECLARE
 c uuid; result_id uuid; must_avalador boolean;
 first_name text; last_name text;
BEGIN
 c:=public.current_club_id();
 IF auth.uid() IS NULL OR c IS NULL OR NOT public.can_operate_club(c,'manage_members'::public.app_permission)
 THEN RAISE EXCEPTION 'No autorizado para registrar socios' USING errcode='42501'; END IF;
 IF p_member IS NULL OR p_request IS NULL OR p_member->>'club_id' IS DISTINCT FROM c::text
 THEN RAISE EXCEPTION 'Registro no válido' USING errcode='22023'; END IF;
 SELECT coalesce(required,false) INTO must_avalador
 FROM public.club_member_field_config
 WHERE club_id=c AND field_key='avalador' AND visible IS TRUE;
 must_avalador:=coalesce(must_avalador,false);
 first_name:=nullif(btrim(coalesce(p_member->>'avalador_first_name','')),'');
 last_name:=nullif(btrim(coalesce(p_member->>'avalador_last_name','')),'');
 IF ((first_name IS NULL) <> (last_name IS NULL)) OR
  (must_avalador AND (first_name IS NULL OR last_name IS NULL)) OR
  length(coalesce(first_name,''))>100 OR length(coalesce(last_name,''))>100
 THEN RAISE EXCEPTION 'Indica nombre y apellidos del socio avalador' USING errcode='22023'; END IF;
 IF p_plan_id IS NOT NULL THEN
  IF p_confirmed_cents IS NULL THEN RAISE EXCEPTION 'Confirma la cuota del socio' USING errcode='22023'; END IF;
  result_id:=public.confirm_membership_with_receipt(p_confirmed_cents,NULL,p_member,p_method,p_plan_id,false,p_request);
 ELSE
  result_id:=public.save_membership_with_receipt(p_member,NULL,p_method,p_request,false,NULL);
 END IF;
 UPDATE public.members
 SET avalador_first_name=first_name,avalador_last_name=last_name
 WHERE club_id=c AND id=result_id
  AND avalador_first_name IS NOT DISTINCT FROM first_name
  AND avalador_last_name IS NOT DISTINCT FROM last_name;
 IF NOT FOUND THEN
  -- On first insertion previous fields are NULL; set them after verifying operation fingerprint.
  UPDATE public.members SET avalador_first_name=first_name, avalador_last_name=last_name
  WHERE club_id=c AND id=result_id
    AND avalador_first_name IS NULL AND avalador_last_name IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'La inscripción ya tiene otro avalador' USING errcode='23505'; END IF;
 END IF;
 RETURN result_id;
END $avalador$;
REVOKE ALL ON FUNCTION public.snoop_register_member_with_avalador(jsonb,uuid,text,uuid,integer) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.snoop_register_member_with_avalador(jsonb,uuid,text,uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

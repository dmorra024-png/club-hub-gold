CREATE TABLE public.membership_operations (
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL, member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(club_id,request_id)
);
ALTER TABLE public.membership_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.membership_operations TO service_role;
-- Atomic membership + receipt. No new sales/orders and no rewrite of existing receipts.
CREATE FUNCTION public.save_membership_with_receipt(
 p_member jsonb,p_plan_id uuid,p_method text,p_request uuid,p_renew boolean DEFAULT false,p_expected date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; mid uuid; plan public.membership_plans; m public.members; receipt public.membership_receipts; today date; fingerprint text; previous public.membership_operations;
BEGIN
 c:=public.current_club_id(); mid:=(p_member->>'id')::uuid;
 IF c IS NULL OR NOT public.can_operate_club(c,'manage_members') THEN
  RAISE EXCEPTION 'No tienes permiso para gestionar socios' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR mid IS NULL OR p_method IS NULL OR p_method NOT IN ('cash','card','transfer','other') THEN
  RAISE EXCEPTION 'Operación de inscripción no válida' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c::text||p_request::text,0));
 fingerprint:=md5(jsonb_build_array(p_member-ARRAY['contract_signed_at','joined_at','expires_at','created_by','club_id'],p_plan_id,p_method,p_renew,p_expected)::text);
 SELECT * INTO previous FROM public.membership_operations WHERE club_id=c AND request_id=p_request;
 IF FOUND THEN
  IF previous.fingerprint<>fingerprint OR previous.actor_id<>auth.uid() THEN
   RAISE EXCEPTION 'La operación ya existe con otros datos' USING ERRCODE='22023'; END IF;
  RETURN previous.member_id;
 END IF;
 IF p_plan_id IS NOT NULL THEN
  SELECT * INTO plan FROM public.membership_plans WHERE id=p_plan_id AND club_id=c AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuota no disponible en este club' USING ERRCODE='22023'; END IF;
  IF plan.price_cents>0 AND NOT public.can_operate_club(c,'use_cash') THEN
   RAISE EXCEPTION 'Se requiere permiso de caja para registrar la cuota' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO receipt FROM public.membership_receipts WHERE club_id=c AND request_id=p_request;
 IF FOUND THEN
  IF receipt.member_id<>mid OR receipt.amount_cents IS DISTINCT FROM plan.price_cents OR receipt.payment_method<>p_method THEN
   RAISE EXCEPTION 'La operación ya existe con otros datos' USING ERRCODE='22023'; END IF;
  RETURN mid;
 END IF;
 today:=(now() AT TIME ZONE 'Europe/Madrid')::date;
 IF p_renew THEN
  SELECT * INTO m FROM public.members WHERE id=mid AND club_id=c FOR UPDATE;
  IF NOT FOUND OR p_plan_id IS NULL THEN RAISE EXCEPTION 'Socio o cuota no disponible' USING ERRCODE='22023'; END IF;
  IF m.expires_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'La inscripción ha cambiado: recarga antes de renovar' USING ERRCODE='40001'; END IF;
  UPDATE public.members SET plan_id=p_plan_id,expires_at=greatest(m.expires_at,today)+plan.duration_days WHERE id=mid;
 ELSE
  IF length(trim(coalesce(p_member->>'first_name','')))=0 OR length(trim(coalesce(p_member->>'last_name','')))=0 THEN
   RAISE EXCEPTION 'Nombre y apellidos obligatorios' USING ERRCODE='22023'; END IF;
  IF (p_member->>'birth_date')::date IS NULL OR (p_member->>'birth_date')::date>today-interval '18 years' THEN
   RAISE EXCEPTION 'El socio debe ser mayor de edad' USING ERRCODE='22023'; END IF;
  INSERT INTO public.members(id,club_id,first_name,last_name,birth_date,address,city,postal_code,phone,email,dni_number,dni_photo_path,
   plan_id,joined_at,expires_at,signature_path,contract_signed_at,contract_version,created_by)
  VALUES(mid,c,trim(p_member->>'first_name'),trim(p_member->>'last_name'),(p_member->>'birth_date')::date,p_member->>'address',
   coalesce(p_member->>'city',''),p_member->>'postal_code',coalesce(p_member->>'phone',''),p_member->>'email',
   coalesce(p_member->>'dni_number',''),coalesce(p_member->>'dni_photo_path',''),p_plan_id,today,today+coalesce(plan.duration_days,0),
   coalesce(p_member->>'signature_path',''),(p_member->>'contract_signed_at')::timestamptz,coalesce(p_member->>'contract_version',''),auth.uid());
 END IF;
 IF coalesce(plan.price_cents,0)>0 THEN
  PERFORM public.record_membership_receipt(c,mid,plan.price_cents,p_method,
   CASE WHEN p_renew THEN 'Renovación: ' ELSE 'Inscripción: ' END||plan.name,p_request);
 END IF;
 INSERT INTO public.membership_operations(club_id,request_id,member_id,actor_id,fingerprint) VALUES(c,p_request,mid,auth.uid(),fingerprint);
 RETURN mid;
END $$;
REVOKE ALL ON FUNCTION public.save_membership_with_receipt(jsonb,uuid,text,uuid,boolean,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_membership_with_receipt(jsonb,uuid,text,uuid,boolean,date) TO authenticated;

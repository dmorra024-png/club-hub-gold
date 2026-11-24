-- Isolated test compatibility: current Pilot RPC signature.
-- Only used on the synthetic database AFTER installing the legacy fixture
-- implementation. This function is NOT a production migration.
CREATE FUNCTION public.confirm_membership_with_receipt(
 p_confirmed_cents integer, p_expected date, p_member jsonb,
 p_method text, p_plan_id uuid, p_renew boolean, p_request uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_club uuid; v_price integer;
BEGIN
 v_club:=public.current_club_id();
 IF auth.uid() IS NULL OR v_club IS NULL OR NOT public.can_operate_club(v_club,'manage_members') THEN
  RAISE EXCEPTION 'No tienes permiso para gestionar socios' USING ERRCODE='42501';
 END IF;
 IF p_plan_id IS NULL OR p_request IS NULL OR p_member IS NULL OR p_renew IS NULL
  OR p_confirmed_cents IS NULL OR p_confirmed_cents<0 THEN
  RAISE EXCEPTION 'Confirmación de cuota no válida' USING ERRCODE='22023';
 END IF;
 SELECT price_cents INTO v_price FROM public.membership_plans
 WHERE id=p_plan_id AND club_id=v_club AND active IS TRUE FOR SHARE;
 IF NOT FOUND OR v_price IS NULL OR v_price IS DISTINCT FROM p_confirmed_cents THEN
  RAISE EXCEPTION 'La cuota ha cambiado. Revisa el importe antes de confirmar' USING ERRCODE='22023';
 END IF;
 RETURN public.save_membership_with_receipt(
  p_member,p_plan_id,p_method,p_request,p_renew,p_expected
 );
END $$;
REVOKE ALL ON FUNCTION public.confirm_membership_with_receipt(integer,date,jsonb,text,uuid,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_membership_with_receipt(integer,date,jsonb,text,uuid,boolean,uuid) TO authenticated;

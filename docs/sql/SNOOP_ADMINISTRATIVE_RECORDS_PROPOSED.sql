-- PROPOSAL ONLY. One atomic migration; do not run on production without approval.
-- No backfill, inventory/refund action, RLS change, deletion or financial amount rewrite.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.save_membership_with_receipt(jsonb,uuid,text,uuid,boolean,date)') IS NULL
 OR to_regprocedure('public.can_operate_club(uuid,public.app_permission)') IS NULL
 OR to_regprocedure('public.is_current_user_club_admin(uuid)') IS NULL
 OR to_regclass('public.membership_operations') IS NULL THEN RAISE EXCEPTION 'Missing membership/platform dependencies'; END IF;
 IF to_regprocedure('public.annul_financial_order(uuid,uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'Migration already installed; do not repeat';END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal AND (tgtype::int & 16)<>0 AND NOT (tgname='orders_updated' AND tgfoid=to_regprocedure('public.tg_set_updated_at()'))) THEN
  RAISE EXCEPTION 'Unexpected order UPDATE trigger: review side effects before migration';END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name IN ('cancelled_at','cancelled_by','cancellation_reason')) THEN RAISE EXCEPTION 'Cancellation columns already present: review compatibility';END IF;
END $$;

-- Lock and verify the authoritative fee before calling the existing idempotent RPC.
CREATE FUNCTION public.confirm_membership_with_receipt(
 p_member jsonb,p_plan_id uuid,p_method text,p_request uuid,p_renew boolean,p_expected date,p_confirmed_cents integer
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; amount integer; previous public.membership_operations;
BEGIN
 c:=public.current_club_id();
 IF auth.uid() IS NULL OR c IS NULL OR NOT public.can_operate_club(c,'manage_members') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 IF p_request IS NULL OR p_confirmed_cents IS NULL OR p_confirmed_cents<0 THEN RAISE EXCEPTION 'Invalid confirmation' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c::text||p_request::text,0));
 SELECT * INTO previous FROM public.membership_operations WHERE club_id=c AND request_id=p_request;
 IF FOUND THEN
  SELECT coalesce((SELECT amount_cents FROM public.membership_receipts WHERE club_id=c AND request_id=p_request),0) INTO amount;
 ELSE
  SELECT price_cents INTO amount FROM public.membership_plans WHERE club_id=c AND id=p_plan_id AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuota no disponible' USING ERRCODE='22023';END IF;
 END IF;
 IF amount<>p_confirmed_cents THEN RAISE EXCEPTION 'La cuota ha cambiado: revisa el importe antes de confirmar' USING ERRCODE='40001';END IF;
 IF amount>0 AND NOT public.can_operate_club(c,'use_cash') THEN RAISE EXCEPTION 'Se requiere permiso de caja' USING ERRCODE='42501';END IF;
 RETURN public.save_membership_with_receipt(p_member,p_plan_id,p_method,p_request,p_renew,p_expected);
END $$;
REVOKE ALL ON FUNCTION public.confirm_membership_with_receipt(jsonb,uuid,text,uuid,boolean,date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_membership_with_receipt(jsonb,uuid,text,uuid,boolean,date,integer) TO authenticated;

ALTER TABLE public.orders ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN cancelled_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 ADD COLUMN cancellation_reason text;

CREATE FUNCTION public.snoop_financial_annulment_audit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'El historial contable no se puede eliminar' USING ERRCODE='42501';END IF;
 IF OLD.status='cancelled' AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN
  RAISE EXCEPTION 'La anulación es inmutable' USING ERRCODE='42501';END IF;
 IF ROW(NEW.status,NEW.cancelled_at,NEW.cancelled_by,NEW.cancellation_reason) IS DISTINCT FROM ROW(OLD.status,OLD.cancelled_at,OLD.cancelled_by,OLD.cancellation_reason) THEN
  IF auth.uid() IS NULL OR NOT public.is_current_user_club_admin(OLD.club_id) OR NOT public.can_operate_club(OLD.club_id,'use_cash') THEN RAISE EXCEPTION 'Solo el administrador puede anular' USING ERRCODE='42501';END IF;
  IF OLD.status<>'completed' OR NEW.status<>'cancelled' OR length(trim(coalesce(NEW.cancellation_reason,'')))<5 OR length(NEW.cancellation_reason)>2000 THEN RAISE EXCEPTION 'Motivo o estado no válido' USING ERRCODE='22023';END IF;
  IF (to_jsonb(NEW)-ARRAY['status','cancelled_at','cancelled_by','cancellation_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','cancelled_at','cancelled_by','cancellation_reason','updated_at']) THEN RAISE EXCEPTION 'El registro original debe conservarse' USING ERRCODE='42501';END IF;
  NEW.cancelled_at:=now();NEW.cancelled_by:=auth.uid();NEW.cancellation_reason:=trim(NEW.cancellation_reason);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snoop_financial_annulment_audit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snoop_financial_annulment_audit BEFORE UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.snoop_financial_annulment_audit();

-- A cancelled record's line items cannot be edited, deleted or appended later.
CREATE FUNCTION public.snoop_cancelled_item_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE state text;
BEGIN
 IF TG_OP<>'INSERT' THEN
  SELECT status INTO state FROM public.orders WHERE id=OLD.order_id AND club_id=OLD.club_id FOR SHARE;
  IF state='cancelled' THEN RAISE EXCEPTION 'Detalle anulado inmutable' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  SELECT status INTO state FROM public.orders WHERE id=NEW.order_id AND club_id=NEW.club_id FOR SHARE;
  IF state='cancelled' THEN RAISE EXCEPTION 'Detalle anulado inmutable' USING ERRCODE='42501';END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.snoop_cancelled_item_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snoop_cancelled_item_guard BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.snoop_cancelled_item_guard();

CREATE FUNCTION public.annul_financial_order(p_member_id uuid,p_order_id uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c uuid; record public.orders;
BEGIN
 c:=public.current_club_id();
 IF auth.uid() IS NULL OR c IS NULL OR NOT public.is_current_user_club_admin(c) OR NOT public.can_operate_club(c,'manage_members') OR NOT public.can_operate_club(c,'use_cash') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 IF length(trim(coalesce(p_reason,'')))<5 OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Indica un motivo de 5 a 2000 caracteres' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.members WHERE id=p_member_id AND club_id=c) THEN RAISE EXCEPTION 'Registro no disponible' USING ERRCODE='42501';END IF;
 SELECT * INTO record FROM public.orders WHERE id=p_order_id AND member_id=p_member_id AND club_id=c FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registro no disponible' USING ERRCODE='42501';END IF;
 IF record.status='cancelled' THEN
  IF record.cancelled_by=auth.uid() AND record.cancellation_reason=trim(p_reason) THEN RETURN record.id;END IF;
  RAISE EXCEPTION 'El registro ya está anulado' USING ERRCODE='22023';
 END IF;
 UPDATE public.orders SET status='cancelled',cancellation_reason=trim(p_reason) WHERE id=record.id;
 RETURN record.id;
END $$;
REVOKE ALL ON FUNCTION public.annul_financial_order(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.annul_financial_order(uuid,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

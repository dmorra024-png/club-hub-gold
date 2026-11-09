-- PROPOSAL ONLY. One atomic upgrade; no production execution, backfill, refund or stock write.
-- Works with platform separation, with or without the earlier administrative-records proposal.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.can_operate_club(uuid,public.app_permission)') IS NULL
 OR to_regprocedure('public.is_current_user_club_admin(uuid)') IS NULL
 THEN RAISE EXCEPTION 'Missing SNOOP platform dependencies'; END IF;
 IF to_regclass('public.financial_order_reversals') IS NOT NULL THEN RAISE EXCEPTION 'Reversal migration already installed: do not repeat'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal AND (tgtype::int & 16)<>0 AND NOT
 ((tgname='orders_updated' AND tgfoid=to_regprocedure('public.tg_set_updated_at()')) OR
 (tgname='snoop_financial_annulment_audit' AND tgfoid=to_regprocedure('public.snoop_financial_annulment_audit()'))))
 THEN RAISE EXCEPTION 'Unknown orders UPDATE trigger: review side effects first'; END IF;
END $$;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
 ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 ADD COLUMN IF NOT EXISTS cancellation_reason text;
CREATE UNIQUE INDEX snoop_reversal_order_scope ON public.orders(id,club_id);
CREATE TABLE public.financial_order_reversals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 order_id uuid NOT NULL UNIQUE,
 original_actor uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 original_actor_name text NOT NULL,
 original_at timestamptz NOT NULL,
 original_cents integer NOT NULL CHECK(original_cents>=0),
 delta_cents bigint NOT NULL CHECK(delta_cents=-original_cents::bigint),
 cancelled_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 cancelled_by_name text NOT NULL,
 recorded_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 2000),
 FOREIGN KEY(order_id,club_id) REFERENCES public.orders(id,club_id) ON DELETE RESTRICT
);
ALTER TABLE public.financial_order_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY snoop_reversal_read ON public.financial_order_reversals FOR SELECT TO authenticated
 USING(club_id=public.current_club_id() AND public.can_operate_club(club_id,'manage_members')
 AND (public.can_operate_club(club_id,'use_cash') OR public.can_operate_club(club_id,'view_reports'))
 AND (public.is_current_user_club_admin(club_id) OR public.can_operate_club(club_id,'view_reports') OR original_actor=auth.uid()));
REVOKE ALL ON public.financial_order_reversals FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.financial_order_reversals TO authenticated;
CREATE FUNCTION public.snoop_reversal_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Rectificación contable inmutable' USING ERRCODE='42501';END $$;
REVOKE ALL ON FUNCTION public.snoop_reversal_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snoop_reversal_immutable BEFORE UPDATE OR DELETE ON public.financial_order_reversals FOR EACH ROW EXECUTE FUNCTION public.snoop_reversal_immutable();

CREATE OR REPLACE FUNCTION public.snoop_financial_annulment_audit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'El historial contable no se puede eliminar' USING ERRCODE='42501';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status='cancelled' OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL OR NEW.cancellation_reason IS NOT NULL THEN
   RAISE EXCEPTION 'La anulación requiere un registro confirmado existente' USING ERRCODE='42501';END IF;
  IF auth.uid() IS NOT NULL THEN
   IF NEW.club_id IS DISTINCT FROM public.current_club_id() OR NOT public.can_operate_club(NEW.club_id,'use_cash') THEN RAISE EXCEPTION 'Forbidden original identity' USING ERRCODE='42501';END IF;
   NEW.created_by:=auth.uid();NEW.created_at:=transaction_timestamp();
  END IF;
  RETURN NEW;
 END IF;
 -- Existing creation RPC computes its total in the SAME transaction as INSERT.
 -- Permit that initial computation only; never rewrite a committed original.
 IF OLD.status='completed' AND (ROW(NEW.created_by,NEW.created_at,NEW.club_id,NEW.member_id,NEW.cash_session_id) IS DISTINCT FROM ROW(OLD.created_by,OLD.created_at,OLD.club_id,OLD.member_id,OLD.cash_session_id)
 OR (NEW.total_cents IS DISTINCT FROM OLD.total_cents AND OLD.created_at IS DISTINCT FROM transaction_timestamp())) THEN
  RAISE EXCEPTION 'El original confirmado es inmutable' USING ERRCODE='42501';END IF;
 IF OLD.status='cancelled' AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN
  RAISE EXCEPTION 'La anulación es inmutable' USING ERRCODE='42501';END IF;
 IF ROW(NEW.status,NEW.cancelled_at,NEW.cancelled_by,NEW.cancellation_reason) IS DISTINCT FROM ROW(OLD.status,OLD.cancelled_at,OLD.cancelled_by,OLD.cancellation_reason) THEN
  IF auth.uid() IS NULL OR OLD.club_id IS DISTINCT FROM public.current_club_id() OR NOT public.is_current_user_club_admin(OLD.club_id) OR NOT public.can_operate_club(OLD.club_id,'manage_members') OR NOT public.can_operate_club(OLD.club_id,'use_cash') THEN RAISE EXCEPTION 'Solo el administrador puede anular' USING ERRCODE='42501';END IF;
  IF OLD.status<>'completed' OR NEW.status<>'cancelled' OR length(trim(coalesce(NEW.cancellation_reason,'')))<5 OR length(NEW.cancellation_reason)>2000 THEN RAISE EXCEPTION 'Motivo o estado no válido' USING ERRCODE='22023';END IF;
  IF (to_jsonb(NEW)-ARRAY['status','cancelled_at','cancelled_by','cancellation_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','cancelled_at','cancelled_by','cancellation_reason','updated_at']) THEN RAISE EXCEPTION 'El registro original debe conservarse' USING ERRCODE='42501';END IF;
  NEW.cancelled_at:=now();NEW.cancelled_by:=auth.uid();NEW.cancellation_reason:=trim(NEW.cancellation_reason);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snoop_financial_annulment_audit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS snoop_financial_annulment_audit ON public.orders;
CREATE TRIGGER snoop_financial_annulment_audit BEFORE INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.snoop_financial_annulment_audit();

-- Only this trusted trigger can insert the reversal. All identity/amount/date values are server-derived.
CREATE FUNCTION public.snoop_record_financial_reversal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS DISTINCT FROM NEW.cancelled_by OR NOT public.is_current_user_club_admin(NEW.club_id) OR NEW.club_id IS DISTINCT FROM public.current_club_id() OR NOT public.can_operate_club(NEW.club_id,'manage_members') OR NOT public.can_operate_club(NEW.club_id,'use_cash') THEN RAISE EXCEPTION 'Forbidden reversal' USING ERRCODE='42501'; END IF;
 INSERT INTO public.financial_order_reversals(club_id,order_id,original_actor,original_actor_name,original_at,original_cents,delta_cents,cancelled_by,cancelled_by_name,recorded_at,reason)
 VALUES(OLD.club_id,OLD.id,OLD.created_by,coalesce((SELECT nullif(trim(full_name),'') FROM public.profiles WHERE id=OLD.created_by),'Colaborador'),OLD.created_at,OLD.total_cents,-OLD.total_cents::bigint,NEW.cancelled_by,coalesce((SELECT nullif(trim(full_name),'') FROM public.profiles WHERE id=NEW.cancelled_by),'Administrador'),NEW.cancelled_at,NEW.cancellation_reason);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snoop_record_financial_reversal() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snoop_record_financial_reversal AFTER UPDATE ON public.orders FOR EACH ROW WHEN(OLD.status='completed' AND NEW.status='cancelled') EXECUTE FUNCTION public.snoop_record_financial_reversal();
CREATE OR REPLACE FUNCTION public.snoop_cancelled_item_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
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
DROP TRIGGER IF EXISTS snoop_cancelled_item_guard ON public.order_items;
CREATE TRIGGER snoop_cancelled_item_guard BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.snoop_cancelled_item_guard();


CREATE OR REPLACE FUNCTION public.annul_financial_order(p_member_id uuid,p_order_id uuid,p_reason text) RETURNS uuid
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
  -- Network replay returns the same result but NEVER creates another adjustment.
  IF record.cancelled_by=auth.uid() AND record.cancellation_reason=trim(p_reason) AND EXISTS(SELECT 1 FROM public.financial_order_reversals WHERE order_id=record.id AND club_id=c) THEN RETURN record.id;END IF;
  RAISE EXCEPTION 'El registro ya está anulado' USING ERRCODE='22023';
 END IF;
 UPDATE public.orders SET status='cancelled',cancellation_reason=trim(p_reason) WHERE id=record.id;
 RETURN record.id;
END $$;
REVOKE ALL ON FUNCTION public.annul_financial_order(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.annul_financial_order(uuid,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

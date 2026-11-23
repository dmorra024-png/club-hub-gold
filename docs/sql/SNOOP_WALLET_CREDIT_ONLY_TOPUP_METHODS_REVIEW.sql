-- Wallet-only checkout and accurately attributed topup receipts.
-- Existing ledger amounts remain unchanged; historic topups remain recognized as cash.
BEGIN;
ALTER TABLE public.socio_wallet_ledger ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.socio_wallet_ledger DROP CONSTRAINT IF EXISTS snoop_wallet_topup_method_allowed;
ALTER TABLE public.socio_wallet_ledger ADD CONSTRAINT snoop_wallet_topup_method_allowed
 CHECK ((kind='topup' AND (payment_method IS NULL OR payment_method IN ('cash','card','transfer')))
     OR (kind<>'topup' AND payment_method IS NULL));

CREATE OR REPLACE FUNCTION public.socio_wallet_topup_with_method(
 p_club_id uuid,p_member_id uuid,p_cash_session_id uuid,
 p_operation_id uuid,p_amount_cents bigint,p_payment_method text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $snoop$
DECLARE
 v_result jsonb;
 v_stored text;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR p_payment_method IS NULL
    OR p_payment_method NOT IN ('cash','card','transfer')
 THEN RAISE EXCEPTION 'Método de recarga inválido' USING ERRCODE='22023'; END IF;
 -- Existing authorized/idempotent topup performs credit and ledger insertion
 -- atomically. Exceptions here roll the entire operation back.
 v_result := public.socio_wallet_topup(
   p_club_id,p_member_id,p_cash_session_id,p_operation_id,p_amount_cents);
 SELECT payment_method INTO v_stored FROM public.socio_wallet_ledger
  WHERE operation_id=p_operation_id AND club_id=p_club_id AND
        member_id=p_member_id AND kind='topup'
  FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recarga sin evidencia' USING ERRCODE='23514'; END IF;
 IF v_result->>'status'='duplicate' THEN
   IF coalesce(v_stored,'cash') <> p_payment_method
   THEN RAISE EXCEPTION 'Método de reintento distinto' USING ERRCODE='23505'; END IF;
 ELSE
   IF v_stored IS NOT NULL
   THEN RAISE EXCEPTION 'Método ya registrado' USING ERRCODE='23505'; END IF;
   UPDATE public.socio_wallet_ledger SET payment_method=p_payment_method
    WHERE operation_id=p_operation_id AND club_id=p_club_id AND
      member_id=p_member_id AND kind='topup' AND payment_method IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'Método de recarga no confirmado' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN v_result;
END
$snoop$;
REVOKE ALL ON FUNCTION public.socio_wallet_topup_with_method(uuid,uuid,uuid,uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.socio_wallet_topup_with_method(uuid,uuid,uuid,uuid,bigint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.socio_wallet_cash_evidence(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=(select auth.uid());v_club uuid:=public.current_club_id();
 v_admin boolean;v_orders jsonb;v_topups jsonb;
begin
 if v_actor is null or v_club is null or p_start is null or p_end is null
   or p_end<=p_start or p_end>p_start+interval '370 days'
   or not public.can_operate_club(v_club,'use_cash') then
  raise exception 'WALLET_CASH_FORBIDDEN' using errcode='42501';
 end if;
 v_admin:=public.is_current_user_club_admin(v_club);
 select coalesce(jsonb_agg(jsonb_build_object(
   'orderId',proof.order_id,'amountCents',proof.amount_cents,
   'paymentMethod',proof.payment_method)),'[]'::jsonb)
 into v_orders
 from public.socio_order_settlements proof
 join public.orders o on o.id=proof.order_id and o.club_id=proof.club_id
 where proof.club_id=v_club and o.created_at>=p_start and o.created_at<p_end
   and (v_admin or o.created_by=v_actor);
 select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'amountCents',l.delta_cents,
    'cashSessionId',l.cash_session_id,
    'actorId',l.actor_id,'at',l.created_at, 'paymentMethod',coalesce(l.payment_method,'cash'))),'[]'::jsonb)
 into v_topups
 from public.socio_wallet_ledger l
 join public.cash_sessions s on s.id=l.cash_session_id
    and s.club_id=l.club_id and s.user_id=l.actor_id
 where l.club_id=v_club and l.kind='topup' and l.delta_cents>0
    and l.created_at>=p_start and l.created_at<p_end
    and (v_admin or l.actor_id=v_actor);
 return jsonb_build_object('walletOrders',v_orders,'topups',v_topups);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_order_with_items_and_payment(_member_id uuid, _notes text, _items jsonb, _payment_method text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE created uuid; v_wallet_enabled boolean;
BEGIN
  IF auth.uid() IS NULL OR _payment_method IS NULL
     OR _payment_method NOT IN ('cash','card','transfer')
  THEN RAISE EXCEPTION 'Selecciona un método de pago válido' USING ERRCODE='22023'; END IF;
  -- Enabled clubs use only Monedero for orders; direct money payment
  -- is permitted only in member-credit topups, never at order checkout.
  SELECT s.enabled INTO v_wallet_enabled
    FROM public.socio_club_wallet_settings s
    JOIN public.members m ON m.club_id=s.club_id
    WHERE m.id=_member_id FOR SHARE OF s;
  IF v_wallet_enabled IS TRUE THEN
    RAISE EXCEPTION 'Este club solo acepta pedidos con créditos Monedero'
      USING ERRCODE='23514';
  END IF;
  -- The existing RPC enforces authenticated role, club scope, and stock transaction.
  created := public.create_order_with_items(_member_id,_notes,_items);
  UPDATE public.orders
    SET payment_method=_payment_method
    WHERE id=created AND created_by=auth.uid()
      AND member_id=_member_id AND club_id=(SELECT m.club_id FROM public.members m WHERE m.id=_member_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se pudo confirmar el método de pago del pedido' USING ERRCODE='42501';
  END IF;
  RETURN created;
END
$function$
;
SELECT 'CREDIT_MODE_AND_TOPUP_METHODS_DRY_RUN' AS result;
COMMIT;

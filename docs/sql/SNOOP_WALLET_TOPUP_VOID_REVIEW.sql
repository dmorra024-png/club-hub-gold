-- Audited Monedero recharge void (credits out + already completed real-world refund).
-- No historical balances or movements are rewritten, and no external payment is issued.
BEGIN;
ALTER TABLE public.socio_wallet_ledger DROP CONSTRAINT socio_wallet_ledger_kind_check;
ALTER TABLE public.socio_wallet_ledger ADD CONSTRAINT socio_wallet_ledger_kind_check
 CHECK (kind IN ('topup','spend','refund','topup_reversal'));
ALTER TABLE public.socio_wallet_ledger DROP CONSTRAINT socio_wallet_ledger_check;
ALTER TABLE public.socio_wallet_ledger ADD CONSTRAINT socio_wallet_ledger_check CHECK (
 (kind='topup' AND delta_cents>0 AND cash_session_id IS NOT NULL AND order_id IS NULL AND reversal_of IS NULL)
 OR (kind='spend' AND delta_cents<0 AND order_id IS NOT NULL AND cash_session_id IS NULL AND reversal_of IS NULL)
 OR (kind='refund' AND delta_cents>0 AND order_id IS NOT NULL AND cash_session_id IS NULL AND reversal_of IS NOT NULL)
 OR (kind='topup_reversal' AND delta_cents<0 AND cash_session_id IS NOT NULL AND order_id IS NULL AND reversal_of IS NOT NULL)
);
ALTER TABLE public.socio_wallet_ledger DROP CONSTRAINT snoop_wallet_topup_method_allowed;
ALTER TABLE public.socio_wallet_ledger ADD CONSTRAINT snoop_wallet_topup_method_allowed CHECK (
 (kind IN ('topup','topup_reversal') AND (payment_method IS NULL OR payment_method IN ('cash','card','transfer')))
 OR (kind NOT IN ('topup','topup_reversal') AND payment_method IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS snoop_wallet_one_topup_reversal
 ON public.socio_wallet_ledger(reversal_of) WHERE kind='topup_reversal';

CREATE OR REPLACE FUNCTION public.socio_wallet_void_topup(
 p_topup_id uuid,p_cash_session_id uuid,p_operation_id uuid,
 p_reason text,p_refund_method text,p_refund_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $wallet$
DECLARE v_actor uuid:=(select auth.uid());
 v_club uuid:=public.current_club_id();
 v_original public.socio_wallet_ledger%rowtype;
 v_account bigint;
 v_balance bigint;
 v_existing public.socio_wallet_ledger%rowtype;
 v_authorized boolean;
BEGIN
 IF v_actor IS NULL OR v_club IS NULL OR p_topup_id IS NULL OR p_cash_session_id IS NULL
  OR p_operation_id IS NULL OR p_refund_confirmed IS DISTINCT FROM true
  OR p_refund_method NOT IN ('cash','card','transfer')
  OR length(trim(coalesce(p_reason,'')))<5 OR length(p_reason)>2000
 THEN RAISE EXCEPTION 'WALLET_VOID_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT public.can_operate_club(v_club,'manage_members')
    OR NOT public.can_operate_club(v_club,'use_cash')
 THEN RAISE EXCEPTION 'WALLET_VOID_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_original FROM public.socio_wallet_ledger
  WHERE id=p_topup_id AND club_id=v_club AND kind='topup'
    AND delta_cents>0 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_TOPUP_NOT_FOUND' USING ERRCODE='23514'; END IF;
 v_authorized:=public.is_current_user_club_admin(v_club) OR v_original.actor_id=v_actor;
 IF NOT v_authorized THEN RAISE EXCEPTION 'WALLET_VOID_NOT_OWNER' USING ERRCODE='42501'; END IF;
 SELECT balance_cents INTO v_account FROM public.socio_wallet_accounts
  WHERE club_id=v_club AND member_id=v_original.member_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_ACCOUNT_NOT_FOUND' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_existing FROM public.socio_wallet_ledger WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF v_existing.kind='topup_reversal' AND v_existing.club_id=v_club
    AND v_existing.reversal_of=v_original.operation_id
    AND v_existing.delta_cents=-v_original.delta_cents
    AND v_existing.payment_method=p_refund_method
    AND v_existing.cash_session_id=p_cash_session_id
    AND v_existing.actor_id=v_actor
    AND v_existing.label=('Anulación recarga: '||trim(p_reason))
  THEN RETURN jsonb_build_object('status','duplicate','topupId',p_topup_id,'operationId',p_operation_id,'balanceCents',v_existing.balance_after_cents);
  END IF;
  RAISE EXCEPTION 'WALLET_VOID_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
 END IF;
 IF EXISTS (SELECT 1 FROM public.socio_wallet_ledger
   WHERE kind='topup_reversal' AND reversal_of=v_original.operation_id)
 THEN RAISE EXCEPTION 'WALLET_TOPUP_ALREADY_VOIDED' USING ERRCODE='23505'; END IF;
 -- Refunds are documented only after operator confirms money was returned
 -- independently: POS and transfers are recorded, never initiated.
 PERFORM 1 FROM public.cash_sessions WHERE id=p_cash_session_id
  AND club_id=v_club AND user_id=v_actor AND status='open'
  AND closed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_REFUND_CASH_NOT_OPEN' USING ERRCODE='23514'; END IF;
 IF v_account<v_original.delta_cents
 THEN RAISE EXCEPTION 'WALLET_CREDITS_ALREADY_USED' USING ERRCODE='23514'; END IF;
 v_balance:=v_account-v_original.delta_cents;
 UPDATE public.socio_wallet_accounts
  SET balance_cents=v_balance,updated_at=now()
  WHERE club_id=v_club AND member_id=v_original.member_id;
 INSERT INTO public.socio_wallet_ledger(
  club_id,member_id,operation_id,kind,cash_session_id,reversal_of,
  actor_id,delta_cents,balance_after_cents,label,payment_method
 ) VALUES (
  v_club,v_original.member_id,p_operation_id,'topup_reversal',
  p_cash_session_id,v_original.operation_id,v_actor,
  -v_original.delta_cents,v_balance,'Anulación recarga: '||trim(p_reason),p_refund_method
 );
 RETURN jsonb_build_object('status','applied','topupId',p_topup_id,'operationId',p_operation_id,
  'balanceCents',v_balance,'refundCents',v_original.delta_cents);
END
$wallet$;
REVOKE ALL ON FUNCTION public.socio_wallet_void_topup(uuid,uuid,uuid,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.socio_wallet_void_topup(uuid,uuid,uuid,text,text,boolean) TO authenticated;

-- Extend the original authorized Caja evidence: the reversed credit receipt
-- is an actual negative money movement in the cashier's refund session.
CREATE OR REPLACE FUNCTION public.socio_wallet_cash_evidence(
 p_start timestamptz,p_end timestamptz
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $wallet$
DECLARE v_actor uuid:=(select auth.uid());v_club uuid:=public.current_club_id();
 v_admin boolean;v_orders jsonb;v_topups jsonb;
BEGIN
 IF v_actor IS NULL OR v_club IS NULL OR p_start IS NULL OR p_end IS NULL
  OR p_end<=p_start OR p_end>p_start+interval '370 days'
  OR NOT public.can_operate_club(v_club,'use_cash')
 THEN RAISE EXCEPTION 'WALLET_CASH_FORBIDDEN' USING ERRCODE='42501'; END IF;
 v_admin:=public.is_current_user_club_admin(v_club);
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'orderId',proof.order_id,'amountCents',proof.amount_cents,
  'paymentMethod',proof.payment_method)),'[]'::jsonb)
 INTO v_orders
 FROM public.socio_order_settlements proof
 JOIN public.orders o ON o.id=proof.order_id AND o.club_id=proof.club_id
 WHERE proof.club_id=v_club AND o.created_at>=p_start AND o.created_at<p_end
  AND (v_admin OR o.created_by=v_actor);
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',l.id,'amountCents',l.delta_cents,
   'cashSessionId',l.cash_session_id,'actorId',l.actor_id,
   'at',l.created_at,'paymentMethod',coalesce(l.payment_method,'cash'),
   'kind',l.kind,'memberId',l.member_id,
   'voided',l.kind='topup' AND EXISTS(
      SELECT 1 FROM public.socio_wallet_ledger v
      WHERE v.kind='topup_reversal' AND v.reversal_of=l.operation_id
         AND v.club_id=l.club_id)
  )),'[]'::jsonb)
 INTO v_topups
 FROM public.socio_wallet_ledger l
 JOIN public.cash_sessions s ON s.id=l.cash_session_id
   AND s.club_id=l.club_id AND s.user_id=l.actor_id
 WHERE l.club_id=v_club AND l.kind IN ('topup','topup_reversal')
   AND l.created_at>=p_start AND l.created_at<p_end
   AND (v_admin OR l.actor_id=v_actor);
 RETURN jsonb_build_object('walletOrders',v_orders,'topups',v_topups);
END
$wallet$;
REVOKE ALL ON FUNCTION public.socio_wallet_cash_evidence(timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.socio_wallet_cash_evidence(timestamptz,timestamptz) TO authenticated;
SELECT 'SNOOP_WALLET_VOID_SCHEMA_OK' result;
COMMIT;

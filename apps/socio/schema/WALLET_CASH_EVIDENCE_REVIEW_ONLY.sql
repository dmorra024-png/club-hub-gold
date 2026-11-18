-- REVIEW ONLY. This RPC provides authenticated, club-scoped, signed
-- wallet accounting evidence to the *existing* SNOOP cash read path.
-- Orders without a proof are LEGACY/UNKNOWN, never silently classified cash.
begin;
create or replace function public.socio_wallet_cash_evidence(
 p_start timestamptz, p_end timestamptz
) returns jsonb language plpgsql stable security definer set search_path=''
as $wallet_cash$
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
    'actorId',l.actor_id,'at',l.created_at)),'[]'::jsonb)
 into v_topups
 from public.socio_wallet_ledger l
 join public.cash_sessions s on s.id=l.cash_session_id
    and s.club_id=l.club_id and s.user_id=l.actor_id
 where l.club_id=v_club and l.kind='topup' and l.delta_cents>0
    and l.created_at>=p_start and l.created_at<p_end
    and (v_admin or l.actor_id=v_actor);
 return jsonb_build_object('walletOrders',v_orders,'topups',v_topups);
end;
$wallet_cash$;
revoke all on function public.socio_wallet_cash_evidence(timestamptz,timestamptz)
 from public,anon,authenticated;
grant execute on function public.socio_wallet_cash_evidence(timestamptz,timestamptz)
 to authenticated;
commit;

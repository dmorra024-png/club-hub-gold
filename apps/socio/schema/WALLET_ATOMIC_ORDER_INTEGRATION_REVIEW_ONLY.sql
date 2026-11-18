-- REVIEW ONLY: do not apply to SNOOP production.
-- DDL + REVOKEs occur atomically to avoid any transient PUBLIC EXECUTE window.
begin;
-- Requires reviewed socio_* schema, WALLET_ORDER_SETTLEMENT_REVIEW_ONLY.sql,
-- and the existing protected SNOOP order/stock functions. Do not enable
-- wallet payments until ALL live cash reports distinguish wallet from cash.
--
-- One transaction: SNOOP order+stock + immutable wallet attribution + debit.
-- SQL functions called below run in this function's PostgreSQL transaction:
-- any error rolls back order, items, stock movement, proof and wallet debit.
-- This replaces the separate spend HTTP call for NEW wallet orders.
create or replace function public.socio_create_wallet_order(
 p_member_id uuid,
 p_notes text,
 p_items jsonb,
 p_operation_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $wallet_order$
declare
 v_club uuid := public.current_club_id();
 v_order uuid;
 v_total bigint;
 v_result jsonb;
begin
 if auth.uid() is null or v_club is null or p_member_id is null or
    p_operation_id is null or p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>100 then
   raise exception 'WALLET_ORDER_INVALID' using errcode='22023';
 end if;
 if not public.can_operate_club(v_club,'use_cash') then
   raise exception 'WALLET_ORDER_FORBIDDEN' using errcode='42501';
 end if;
 if not exists(select 1 from public.members
   where id=p_member_id and club_id=v_club) then
   raise exception 'WALLET_ORDER_MEMBER_FORBIDDEN' using errcode='42501';
 end if;
 -- Reject retries that carry an existing operation ID: no new order is made.
 -- Client must resolve the original outcome through an authorized read.
 if exists(select 1 from public.socio_wallet_ledger
           where operation_id=p_operation_id) then
   raise exception 'WALLET_ORDER_OPERATION_ALREADY_USED' using errcode='23505';
 end if;
 -- This existing RPC performs stock reservation and creates order/items.
 -- A subsequent error in this wrapper rolls back that RPC as well.
 v_order:=public.create_order_with_items(p_member_id,p_notes,p_items);
 select total_cents into v_total from public.orders
  where id=v_order and member_id=p_member_id and club_id=v_club
   and status='completed' and cancelled_at is null for update;
 if not found or v_total is null or v_total<=0 or v_total>10000000 then
   raise exception 'WALLET_ORDER_TOTAL_INVALID' using errcode='23514';
 end if;
 -- A trusted DB-only proof: no direct client INSERT grant on this table.
 insert into public.socio_order_settlements
  (order_id,club_id,member_id,payment_method,amount_cents)
 values(v_order,v_club,p_member_id,'wallet',v_total);
 -- Both permissions and sufficient balance are rechecked by the wallet RPC.
 v_result:=public.socio_wallet_order_spend(
  v_club,p_member_id,v_order,p_operation_id,v_total);
 if v_result->>'status'<>'applied' then
   raise exception 'WALLET_ORDER_DEBIT_UNVERIFIED' using errcode='23514';
 end if;
 return jsonb_build_object('orderId',v_order,'amountCents',v_total,
  'operationId',p_operation_id,'balanceCents',(v_result->>'balanceCents')::bigint,
  'status','applied');
end;
$wallet_order$;

-- SECURITY DEFINER is narrowly scoped by auth.uid(), current club, member,
-- permissions, and the existing spend RPC. Proof writes remain DB-only.
-- Review owner/search_path and all EXECUTE grants before activation.
revoke all on function public.socio_create_wallet_order(uuid,text,jsonb,uuid)
 from public,anon,authenticated;
-- Grant EXECUTE only after privilege and account/cash review.
--
-- Important open integration gate:
-- 1. Update every authorized SNOOP report (loadCash, cashMovements,
--    snoop_cash_shift_report, shift close) to exclude wallet-paid order
--    settlements from physical cash, while showing noncash turnover.
-- 2. Guarantee normal SNOOP order cancellation atomically invokes wallet
--    refund via a trusted trigger/wrapper, after stock/audit reversal.
-- 3. Add server-generated idempotency keys, fully verified operation
--    confirmation, real Postgres concurrency tests and client UI.
-- 4. Validate with disposable PostgreSQL before granting EXECUTE.
-- Until then, this function remains review-only and unmounted.

-- One transaction: existing SNOOP annulment (audit + stock restoration)
-- and wallet credit restoration. Failure of either rolls back both.
create or replace function public.socio_cancel_wallet_order(
 p_member_id uuid,
 p_order_id uuid,
 p_reason text,
 p_refund_operation_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $wallet_cancel$
declare
 v_club uuid := public.current_club_id();
 v_total bigint;
 v_debit_id uuid;
 v_result jsonb;
 v_order uuid;
begin
 if auth.uid() is null or v_club is null or p_member_id is null or
    p_order_id is null or p_refund_operation_id is null then
   raise exception 'WALLET_CANCEL_INVALID' using errcode='22023';
 end if;
 if not public.can_operate_club(v_club,'manage_members') or
    not public.can_operate_club(v_club,'use_cash') then
   raise exception 'WALLET_CANCEL_FORBIDDEN' using errcode='42501';
 end if;
 -- Lock the exact order and original debit before invoking cancellation.
 select o.total_cents into v_total
 from public.orders o join public.socio_order_settlements proof
 on proof.order_id=o.id and proof.club_id=o.club_id
 where o.id=p_order_id and o.member_id=p_member_id and o.club_id=v_club
   and o.status='completed' and proof.payment_method='wallet'
   and proof.member_id=p_member_id and proof.amount_cents=o.total_cents
 for update of o;
 if not found then
   raise exception 'WALLET_ORDER_CANNOT_CANCEL' using errcode='23514';
 end if;
 select operation_id into v_debit_id
 from public.socio_wallet_ledger
 where club_id=v_club and member_id=p_member_id and order_id=p_order_id
   and kind='spend' and delta_cents=-v_total;
 if not found then
   raise exception 'WALLET_ORIGINAL_DEBIT_MISSING' using errcode='23514';
 end if;
 -- Existing SNOOP cancellation checks authorship/roles and executes its
 -- financial audit and stock reversal triggers inside this transaction.
 v_order:=public.annul_financial_order(p_member_id,p_order_id,p_reason);
 if v_order is distinct from p_order_id then
   raise exception 'WALLET_CANCEL_UNVERIFIED' using errcode='23514';
 end if;
 -- Refund RPC checks its own role, original spend and cancellation audit.
 v_result:=public.socio_wallet_order_refund(
  v_club,p_member_id,p_order_id,v_debit_id,p_refund_operation_id,v_total);
 if v_result->>'status'<>'applied' then
   raise exception 'WALLET_CANCEL_REFUND_UNVERIFIED' using errcode='23514';
 end if;
 return jsonb_build_object('orderId',p_order_id,'refundOperationId',
  p_refund_operation_id,'refundCents',v_total,
  'balanceCents',(v_result->>'balanceCents')::bigint,'status','applied');
end;
$wallet_cancel$;
revoke all on function public.socio_cancel_wallet_order(uuid,uuid,text,uuid)
 from public,anon,authenticated;

-- No grant, trigger, or data migration is applied by this review file.
-- BEFORE release: existing direct annul_financial_order MUST be protected
-- against bypassing wallet refund, and cash reports must be payment-aware.

-- Staff-only way to identify the *recorded* payment method before cancelling.
-- Existing historical orders have no trusted payment attribution and remain legacy.
create or replace function public.socio_wallet_order_payment_state(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $payment_state$
declare v_club uuid:=public.current_club_id();v_member uuid;v_wallet boolean;
begin
 if auth.uid() is null or v_club is null or p_order_id is null
  or not public.can_operate_club(v_club,'use_cash')
  or not public.can_operate_club(v_club,'manage_members') then
  raise exception 'WALLET_ORDER_STATUS_FORBIDDEN' using errcode='42501';
 end if;
 select member_id into v_member from public.orders
  where id=p_order_id and club_id=v_club;
 if not found then raise exception 'WALLET_ORDER_NOT_FOUND' using errcode='42501';end if;
 select exists(select 1 from public.socio_order_settlements proof
   where proof.order_id=p_order_id and proof.club_id=v_club
     and proof.member_id=v_member and proof.payment_method='wallet') into v_wallet;
 return jsonb_build_object('wallet',v_wallet,'memberId',v_member);
end;
$payment_state$;
revoke all on function public.socio_wallet_order_payment_state(uuid)
 from public,anon,authenticated;
grant execute on function public.socio_wallet_order_payment_state(uuid) to authenticated;

-- DEFERRED COMMIT GUARD. A legacy SNOOP cancellation attempt must NOT
-- bypass the Monedero credit refund on a wallet-paid order. Both mutations
-- must exist by transaction end or the whole cancellation rolls back.
create or replace function public.socio_wallet_cancel_commit_guard()
returns trigger language plpgsql security definer set search_path=''
as $cancel_guard$
begin
 if exists(select 1 from public.socio_order_settlements proof
    where proof.order_id=new.id and proof.club_id=new.club_id
      and proof.payment_method='wallet')
   and not exists(select 1 from public.socio_wallet_ledger l
    where l.club_id=new.club_id and l.member_id=new.member_id
      and l.order_id=new.id and l.kind='refund'
      and exists(select 1 from public.socio_wallet_ledger original
        where original.operation_id=l.reversal_of and original.kind='spend'
          and original.order_id=new.id and original.club_id=new.club_id))
 then
  raise exception 'WALLET_CANCEL_REQUIRES_ATOMIC_REFUND' using errcode='23514';
 end if;
 return null;
end;
$cancel_guard$;
revoke all on function public.socio_wallet_cancel_commit_guard()
 from public,anon,authenticated;
create constraint trigger socio_wallet_cancel_commit_guard
after update of status on public.orders
deferrable initially deferred
for each row when (old.status='completed' and new.status='cancelled')
execute function public.socio_wallet_cancel_commit_guard();


commit;

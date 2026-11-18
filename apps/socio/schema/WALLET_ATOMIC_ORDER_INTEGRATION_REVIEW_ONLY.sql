-- REVIEW ONLY: do not apply to SNOOP production.
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

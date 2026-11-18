-- REVIEW ONLY. No execution against production SNOOP.
-- An authoritative order-creation transaction MUST create the settlement row
-- concurrently with completing the order. There is intentionally no client-
-- callable method for creating/updating these settlement proofs.
begin;
create table public.socio_order_settlements(
 order_id uuid primary key references public.orders(id),
 club_id uuid not null references public.clubs(id),
 member_id uuid not null references public.members(id),
 payment_method text not null check(payment_method in ('cash','wallet')),
 amount_cents bigint not null check(amount_cents>0),
 created_at timestamptz not null default now(),
 check (payment_method='wallet')
);
alter table public.socio_order_settlements enable row level security;
revoke all on public.socio_order_settlements from public,anon,authenticated;
create function public.socio_guard_settlement_order()
returns trigger language plpgsql security invoker set search_path=''
as $settlement_scope$
begin
 if not exists(select 1 from public.orders o
  where o.id=new.order_id and o.club_id=new.club_id
   and o.member_id=new.member_id and o.total_cents=new.amount_cents) then
  raise exception 'WALLET_ORDER_SCOPE_MISMATCH' using errcode='23514';
 end if;
 return new;
end;
$settlement_scope$;
revoke all on function public.socio_guard_settlement_order() from public,anon,authenticated;
create trigger socio_settlement_order_scope
before insert or update on public.socio_order_settlements for each row
execute function public.socio_guard_settlement_order();

create function public.socio_wallet_order_spend(
 p_club_id uuid,p_member_id uuid,p_order_id uuid,
 p_operation_id uuid,p_amount_cents bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $spend$
declare v_staff uuid:=(select auth.uid());v_before bigint;
 v_existing record; v_new bigint;
begin
 if v_staff is null or p_club_id is null or p_member_id is null or
    p_order_id is null or p_operation_id is null or
    p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>10000000
 then raise exception 'WALLET_SPEND_INVALID' using errcode='22023';end if;
 if not exists(select 1 from public.user_roles r
  left join public.socio_wallet_staff_permissions p
  on p.club_id=r.club_id and p.user_id=r.user_id
  where r.user_id=v_staff and r.club_id=p_club_id
   and r.role::text in ('admin','collaborator') and
   (r.role::text='admin' or 'use_cash'=any(r.permissions))
   and (r.role::text='admin' or p.can_spend)) then
  raise exception 'WALLET_SPEND_FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.socio_club_wallet_settings s
  join public.clubs c on c.id=s.club_id
  where s.club_id=p_club_id and s.enabled and c.active
  for share of s,c;
 if not found then raise exception 'WALLET_DISABLED' using errcode='23514';end if;
 -- Lock order BEFORE wallet to avoid a concurrent cancellation being missed.
 perform 1 from public.orders o
  join public.socio_order_settlements proof
   on proof.order_id=o.id and proof.club_id=o.club_id
   and proof.member_id=o.member_id
  where o.id=p_order_id and o.club_id=p_club_id
   and o.member_id=p_member_id and o.status='completed'
   and o.cancelled_at is null and o.total_cents=p_amount_cents
   and proof.payment_method='wallet' and proof.amount_cents=p_amount_cents
  for update of o;
 if not found then raise exception 'WALLET_ORDER_NOT_PROVEN' using errcode='23514';end if;
 perform 1 from public.members m join public.socio_member_cards card
  on card.member_id=m.id and card.club_id=m.club_id
  where m.id=p_member_id and m.club_id=p_club_id
   and m.expires_at>=current_date and card.active and card.revoked_at is null
   for share of m,card;
 if not found then raise exception 'WALLET_MEMBER_INACTIVE' using errcode='23514';end if;
 select balance_cents into v_before from public.socio_wallet_accounts
  where club_id=p_club_id and member_id=p_member_id for update;
 if not found then raise exception 'WALLET_ACCOUNT_NOT_FOUND' using errcode='23514';end if;
 select * into v_existing from public.socio_wallet_ledger where operation_id=p_operation_id;
 if found then
  if v_existing.kind<>'spend' or v_existing.club_id<>p_club_id
   or v_existing.member_id<>p_member_id or v_existing.order_id<>p_order_id
   or v_existing.delta_cents<>-p_amount_cents then
    raise exception 'WALLET_IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
  return jsonb_build_object('status','duplicate','operationId',p_operation_id,
   'balanceCents',v_existing.balance_after_cents);
 end if;
 if exists(select 1 from public.socio_wallet_ledger l
  where l.order_id=p_order_id and l.kind='spend') then
  raise exception 'WALLET_ORDER_ALREADY_PAID' using errcode='23505';end if;
 v_new:=v_before-p_amount_cents;
 if v_new<0 then raise exception 'WALLET_INSUFFICIENT_BALANCE' using errcode='23514';end if;
 update public.socio_wallet_accounts set balance_cents=v_new,updated_at=now()
  where club_id=p_club_id and member_id=p_member_id;
 insert into public.socio_wallet_ledger
  (club_id,member_id,operation_id,kind,order_id,actor_id,
   delta_cents,balance_after_cents,label)
 values(p_club_id,p_member_id,p_operation_id,'spend',p_order_id,
  v_staff,-p_amount_cents,v_new,'Pago desde monedero');
 return jsonb_build_object('status','applied','operationId',p_operation_id,
  'balanceCents',v_new);
end;
$spend$;
revoke all on function public.socio_wallet_order_spend(uuid,uuid,uuid,uuid,bigint)
 from public,anon,authenticated;
grant execute on function public.socio_wallet_order_spend(uuid,uuid,uuid,uuid,bigint)
 to authenticated;

create function public.socio_wallet_order_refund(
 p_club_id uuid,p_member_id uuid,p_order_id uuid,
 p_reversal_operation_id uuid,p_operation_id uuid,p_amount_cents bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $refund$
declare v_staff uuid:=(select auth.uid());v_before bigint;
 v_debit record;v_existing record;v_new bigint;
begin
 if v_staff is null or p_club_id is null or p_member_id is null
  or p_order_id is null or p_reversal_operation_id is null
  or p_operation_id is null or p_amount_cents is null
  or p_amount_cents<=0 or p_amount_cents>10000000
 then raise exception 'WALLET_REFUND_INVALID' using errcode='22023';end if;
 if not exists(select 1 from public.user_roles r
  left join public.socio_wallet_staff_permissions p
    on p.club_id=r.club_id and p.user_id=r.user_id
  where r.user_id=v_staff and r.club_id=p_club_id
   and r.role::text in ('admin','collaborator')
   and (r.role::text='admin' or 'use_cash'=any(r.permissions))
   and (r.role::text='admin' or p.can_refund)) then
  raise exception 'WALLET_REFUND_FORBIDDEN' using errcode='42501';end if;
 -- Cancellation must have been completed by SNOOP's own protected order
 -- transaction, including inventory reversal and historical audit. This RPC
 -- does NOT cancel an order, revert stock or create a cash refund.
 perform 1 from public.orders o
  join public.socio_order_settlements proof
   on proof.order_id=o.id and proof.club_id=o.club_id
  join public.financial_order_reversals fr
   on fr.order_id=o.id and fr.club_id=o.club_id
  where o.id=p_order_id and o.club_id=p_club_id and o.member_id=p_member_id
   and o.status='cancelled' and o.cancelled_at is not null
   and o.total_cents=p_amount_cents
   and proof.member_id=p_member_id and proof.payment_method='wallet'
   and proof.amount_cents=p_amount_cents
   and fr.original_cents=p_amount_cents and fr.delta_cents=-p_amount_cents
   and not exists(
    select 1 from public.financial_order_refunds cash_refund
    where cash_refund.reversal_id=fr.id
   )
  for update of o;
 if not found then raise exception 'WALLET_CANCEL_AUDIT_REQUIRED' using errcode='23514';end if;
 select * into v_debit from public.socio_wallet_ledger
  where operation_id=p_reversal_operation_id and kind='spend'
   and club_id=p_club_id and member_id=p_member_id
   and order_id=p_order_id and delta_cents=-p_amount_cents;
 if not found then raise exception 'WALLET_ORIGINAL_DEBIT_MISSING' using errcode='23514';end if;
 select balance_cents into v_before from public.socio_wallet_accounts
  where club_id=p_club_id and member_id=p_member_id for update;
 if not found then raise exception 'WALLET_ACCOUNT_NOT_FOUND' using errcode='23514';end if;
 select * into v_existing from public.socio_wallet_ledger where operation_id=p_operation_id;
 if found then
  if v_existing.kind<>'refund' or v_existing.club_id<>p_club_id or
   v_existing.member_id<>p_member_id or v_existing.order_id<>p_order_id or
   v_existing.reversal_of<>p_reversal_operation_id or
   v_existing.delta_cents<>p_amount_cents then
    raise exception 'WALLET_IDEMPOTENCY_CONFLICT' using errcode='23505';end if;
  return jsonb_build_object('status','duplicate','operationId',p_operation_id,
   'balanceCents',v_existing.balance_after_cents);
 end if;
 if exists(select 1 from public.socio_wallet_ledger l
  where l.reversal_of=p_reversal_operation_id or
   (l.order_id=p_order_id and l.kind='refund')) then
  raise exception 'WALLET_ALREADY_REFUNDED' using errcode='23505';end if;
 v_new:=v_before+p_amount_cents;
 if v_new>9007199254740991 then raise exception 'WALLET_BALANCE_OVERFLOW' using errcode='22003';end if;
 update public.socio_wallet_accounts set balance_cents=v_new,updated_at=now()
  where club_id=p_club_id and member_id=p_member_id;
 insert into public.socio_wallet_ledger
  (club_id,member_id,operation_id,kind,order_id,reversal_of,actor_id,
   delta_cents,balance_after_cents,label)
 values (p_club_id,p_member_id,p_operation_id,'refund',p_order_id,
  p_reversal_operation_id,v_staff,p_amount_cents,v_new,'Reembolso monedero');
 return jsonb_build_object('status','applied','operationId',p_operation_id,
  'balanceCents',v_new);
end;
$refund$;
revoke all on function public.socio_wallet_order_refund(uuid,uuid,uuid,uuid,uuid,bigint)
 from public,anon,authenticated;
grant execute on function public.socio_wallet_order_refund(uuid,uuid,uuid,uuid,uuid,bigint)
 to authenticated;
commit;

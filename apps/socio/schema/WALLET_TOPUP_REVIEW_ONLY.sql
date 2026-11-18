-- REVIEW ONLY: never deploy as an independent production migration.
-- Club-level/topup-operator permission is default DENY. This function is
-- intentionally unusable until the club explicitly authorizes its staff.
-- Cash reporting MUST separately reconcile these topups (not sales).
begin;
create table public.socio_wallet_staff_permissions(
 club_id uuid not null references public.clubs(id),
 user_id uuid not null references auth.users(id),
 can_topup boolean not null default false,
 can_spend boolean not null default false,
 can_refund boolean not null default false,
 changed_at timestamptz not null default now(),
 primary key(club_id,user_id)
);
alter table public.socio_wallet_staff_permissions enable row level security;
revoke all on public.socio_wallet_staff_permissions from public,anon,authenticated;

create function public.socio_wallet_topup(
 p_club_id uuid,p_member_id uuid,p_cash_session_id uuid,
 p_operation_id uuid,p_amount_cents bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $wallet_topup$
declare
 v_actor uuid := (select auth.uid());
 v_enabled boolean;
 v_account bigint;
 v_existing record;
 v_after bigint;
begin
 if v_actor is null or p_club_id is null or p_member_id is null or
    p_cash_session_id is null or p_operation_id is null or
    p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>10000000
 then raise exception 'WALLET_TOPUP_INVALID_INPUT' using errcode='22023'; end if;
 -- Database role is authoritative, never trust request permissions/club.
 if not exists (
  select 1 from public.user_roles r
  join public.socio_wallet_staff_permissions p
   on p.club_id=r.club_id and p.user_id=r.user_id
  where r.user_id=v_actor and r.club_id=p_club_id
   and r.role::text in ('admin','collaborator')
   and (r.role::text='admin' or 'use_cash'=any(r.permissions))
   and p.can_topup is true
 ) then raise exception 'WALLET_TOPUP_NOT_AUTHORIZED' using errcode='42501'; end if;
 -- Lock the setting, cash session, member, card and wallet within one
 -- transaction. Closing cash, disabling a club or updating membership
 -- is serialized against a topup.
 select s.enabled into v_enabled from public.socio_club_wallet_settings s
  join public.clubs c on c.id=s.club_id
  where s.club_id=p_club_id and c.active and s.enabled
  for share of s,c;
 if not found or v_enabled is distinct from true then
  raise exception 'WALLET_NOT_ENABLED' using errcode='23514'; end if;
 perform 1 from public.cash_sessions s
  where s.id=p_cash_session_id and s.club_id=p_club_id
   and s.user_id=v_actor and s.status='open' and s.closed_at is null
  for update;
 if not found then
  raise exception 'WALLET_CASH_NOT_OPEN_OR_NOT_OWNED' using errcode='23514'; end if;
 perform 1 from public.members m
  join public.socio_member_cards card
   on card.member_id=m.id and card.club_id=m.club_id
  where m.id=p_member_id and m.club_id=p_club_id
   and m.expires_at>=current_date and card.active and
    card.revoked_at is null and card.wallet_enabled
  for share of m,card;
 if not found then
  raise exception 'WALLET_MEMBER_INACTIVE' using errcode='23514'; end if;
 select balance_cents into v_account from public.socio_wallet_accounts
  where club_id=p_club_id and member_id=p_member_id for update;
 if not found then raise exception 'WALLET_ACCOUNT_NOT_FOUND' using errcode='23514'; end if;
 select operation_id,club_id,member_id,kind,cash_session_id,
  order_id,delta_cents,balance_after_cents
  into v_existing from public.socio_wallet_ledger
  where operation_id=p_operation_id;
 if found then
  if v_existing.club_id<>p_club_id or v_existing.member_id<>p_member_id
   or v_existing.kind<>'topup' or
    v_existing.cash_session_id<>p_cash_session_id or
    v_existing.order_id is not null or
    v_existing.delta_cents<>p_amount_cents then
   raise exception 'WALLET_IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  return jsonb_build_object('status','duplicate','operationId',p_operation_id,
   'balanceCents',v_existing.balance_after_cents);
 end if;
 v_after:=v_account+p_amount_cents;
 if v_after<0 or v_after>9007199254740991 then
  raise exception 'WALLET_BALANCE_OVERFLOW' using errcode='22003'; end if;
 update public.socio_wallet_accounts
  set balance_cents=v_after,updated_at=now()
  where club_id=p_club_id and member_id=p_member_id;
 insert into public.socio_wallet_ledger
 (club_id,member_id,operation_id,kind,cash_session_id,actor_id,
  delta_cents,balance_after_cents,label)
 values (p_club_id,p_member_id,p_operation_id,'topup',p_cash_session_id,
  v_actor,p_amount_cents,v_after,'Recarga monedero');
 return jsonb_build_object('status','applied','operationId',p_operation_id,
  'balanceCents',v_after);
end;
$wallet_topup$;
revoke all on function public.socio_wallet_topup(uuid,uuid,uuid,uuid,bigint)
 from public,anon,authenticated;
grant execute on function public.socio_wallet_topup(uuid,uuid,uuid,uuid,bigint)
 to authenticated;
commit;

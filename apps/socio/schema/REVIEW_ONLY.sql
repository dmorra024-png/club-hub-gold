-- SNOOP SOCIO: REVIEW-ONLY SCHEMA DRAFT. DO NOT APPLY TO PRODUCTION.
-- Only Codex-reviewed integration should create these tables; no changes to public.members.
-- All tables fail closed without the dedicated private staff approval/claim procedure.
begin;
create table if not exists public.socio_membership_links (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null references auth.users(id) on delete cascade,
 club_id uuid not null references public.clubs(id),
 member_id uuid not null references public.members(id),
 status text not null check (status in ('verified','revoked')),
 verified_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 unique (club_id,member_id),
 unique (auth_user_id,club_id,member_id),
 check ((status='verified' and verified_at is not null and revoked_at is null)
   or status='revoked')
);
create index if not exists socio_link_user_idx on public.socio_membership_links(auth_user_id,club_id);
alter table public.socio_membership_links enable row level security;
revoke all on public.socio_membership_links from anon, authenticated;
grant select on public.socio_membership_links to authenticated;
create policy socio_links_read_own on public.socio_membership_links
 for select to authenticated using (auth_user_id=(select auth.uid()));

-- A minimal projection table, NOT a view over the full members PII.
-- Reviewed management transactions must keep it in sync with member status/renews.
create table if not exists public.socio_member_cards (
 club_id uuid not null references public.clubs(id),
 member_id uuid not null references public.members(id),
 club_name text not null,
 member_number text not null,
 active boolean not null default false,
 wallet_enabled boolean not null default false,
 revoked_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key (club_id,member_id)
);
alter table public.socio_member_cards enable row level security;
revoke all on public.socio_member_cards from anon, authenticated;
grant select on public.socio_member_cards to authenticated;
create policy socio_cards_read_linked_own on public.socio_member_cards
 for select to authenticated using (
  exists(select 1 from public.socio_membership_links l
    where l.auth_user_id=(select auth.uid())
      and l.club_id=public.socio_member_cards.club_id
      and l.member_id=public.socio_member_cards.member_id and l.status='verified' and l.revoked_at is null)
 );

-- Wallet is disabled until legal/accounting review and approved financial RPCs.
-- This read-only structure will remain empty until approved rollout.
create table if not exists public.socio_wallet_accounts (
 club_id uuid not null references public.clubs(id),
 member_id uuid not null references public.members(id),
 balance_cents bigint not null default 0 check(balance_cents>=0),
 updated_at timestamptz not null default now(),
 primary key(club_id,member_id)
);
alter table public.socio_wallet_accounts enable row level security;
revoke all on public.socio_wallet_accounts from anon, authenticated;
grant select on public.socio_wallet_accounts to authenticated;
create policy socio_wallet_read_own on public.socio_wallet_accounts
 for select to authenticated using (
  exists(select 1 from public.socio_membership_links l
    join public.socio_member_cards c on c.club_id=l.club_id and c.member_id=l.member_id
    where l.auth_user_id=(select auth.uid())
      and l.club_id=socio_wallet_accounts.club_id
      and l.member_id=socio_wallet_accounts.member_id
      and l.status='verified' and l.revoked_at is null
      and c.active and c.wallet_enabled and c.revoked_at is null)
 );

create table if not exists public.socio_wallet_ledger (
 id uuid primary key default gen_random_uuid(),
 club_id uuid not null,
 member_id uuid not null,
 operation_id uuid not null unique,
 kind text not null check(kind in ('topup','spend','refund')),
 order_id uuid references public.orders(id),
 cash_session_id uuid references public.cash_sessions(id),
 reversal_of uuid references public.socio_wallet_ledger(operation_id),
 actor_id uuid not null references auth.users(id),
 delta_cents bigint not null check(delta_cents<>0),
 balance_after_cents bigint not null check(balance_after_cents>=0),
 label text not null,
 created_at timestamptz not null default now(),
 foreign key(club_id,member_id) references public.socio_wallet_accounts(club_id,member_id),
 check (
  (kind='topup' and delta_cents>0 and cash_session_id is not null and order_id is null and reversal_of is null)
  or (kind='spend' and delta_cents<0 and order_id is not null and cash_session_id is null and reversal_of is null)
  or (kind='refund' and delta_cents>0 and order_id is not null and cash_session_id is null and reversal_of is not null)
 )
);
create index if not exists socio_ledger_history_idx on public.socio_wallet_ledger(club_id,member_id,created_at desc);
-- A single order can be spent or refunded only once, regardless of request ID.
create unique index if not exists socio_ledger_one_order_event
 on public.socio_wallet_ledger(club_id,order_id,kind)
 where order_id is not null and kind in ('spend','refund');
-- A spend event may be reversed only once, even if a different order ID is supplied.
create unique index if not exists socio_ledger_one_reversal
 on public.socio_wallet_ledger(reversal_of) where reversal_of is not null;
alter table public.socio_wallet_ledger enable row level security;
revoke all on public.socio_wallet_ledger from anon, authenticated;
grant select on public.socio_wallet_ledger to authenticated;
create policy socio_ledger_read_own on public.socio_wallet_ledger
 for select to authenticated using (
  exists(select 1 from public.socio_membership_links l
    join public.socio_member_cards c on c.club_id=l.club_id and c.member_id=l.member_id
    where l.auth_user_id=(select auth.uid()) and l.club_id=socio_wallet_ledger.club_id
      and l.member_id=socio_wallet_ledger.member_id and l.status='verified'
      and l.revoked_at is null and c.active and c.wallet_enabled and c.revoked_at is null)
 );
-- No INSERT/UPDATE/DELETE grants for socio users on any table.
-- Unique order and reversal constraints are necessary but not sufficient: trusted
-- transaction must verify order club, member, amount, cancellation state, prior
-- debit kind and amount, cash session club/status, and staff permission.
-- Staff approval, email claim, card synchronization, wallet credits and reversals
-- require separate reviewed procedures enforcing RLS, idempotency and audit.
commit;

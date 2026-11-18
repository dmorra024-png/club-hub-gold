-- Applied to Snoop-pilot via Supabase migration snoop_club_premium_themes (2026-11-18).
-- Retained for code review and future audited deployment to other environments.
-- Additive, isolated club theme configuration.
-- No changes to existing cash/order/member tables or privileges.
create table if not exists public.snoop_club_themes (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  theme_id text not null default 'navy-gold' check (theme_id in (
    'navy-gold','graphite-copper','aubergine-amethyst','petrol-titanium',
    'ivory-champagne','ruby-gold','emerald-gold'
  )),
  updated_at timestamptz not null default now()
);

alter table public.snoop_club_themes enable row level security;
revoke all on public.snoop_club_themes from public, anon;
grant select, insert, update on public.snoop_club_themes to authenticated;

drop policy if exists snoop_club_themes_read on public.snoop_club_themes;
create policy snoop_club_themes_read on public.snoop_club_themes
for select to authenticated using (
  (exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.club_id = club_id
  ) and public.can_operate_club(club_id, null))
  or exists (
    select 1 from public.socio_membership_links s
    where s.auth_user_id = (select auth.uid())
      and s.club_id = club_id and s.status = 'verified'
      and s.revoked_at is null
  )
);

drop policy if exists snoop_club_themes_admin_insert on public.snoop_club_themes;
create policy snoop_club_themes_admin_insert on public.snoop_club_themes
for insert to authenticated with check (public.is_current_user_club_admin(club_id));
drop policy if exists snoop_club_themes_admin_update on public.snoop_club_themes;
create policy snoop_club_themes_admin_update on public.snoop_club_themes
for update to authenticated
using (public.is_current_user_club_admin(club_id))
with check (public.is_current_user_club_admin(club_id));
-- The only user-supplied mutable field beyond club_id is a constrained theme_id.
-- RLS prevents an administrator from changing themes belonging to another club.

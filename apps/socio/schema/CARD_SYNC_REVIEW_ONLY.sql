-- REVIEW ONLY: server-side card projection sync, run after staff member
-- creation, renewal, suspension or member-number changes. No live triggers.
-- Reads the existing members/clubs records, exposes no DNI, contact details,
-- signature/photo paths, or sensitive notes to the member PWA.
begin;
create function public.socio_sync_member_card(p_member_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $socio_card_sync$
declare
 v_staff uuid := (select auth.uid());
 v_member record;
 v_allowed boolean;
 v_wallet_enabled boolean;
 v_active boolean;
begin
 if v_staff is null then
  raise exception 'SOCIO_CARD_STAFF_REQUIRED' using errcode='42501';
 end if;
 select m.id,m.club_id,m.member_number,m.expires_at,
  c.name as club_name,c.active as club_active
 into v_member
 from public.members m join public.clubs c on c.id=m.club_id
 where m.id=p_member_id for share of m,c;
 if not found then return false; end if;
 select exists(
  select 1 from public.user_roles r
  where r.user_id=v_staff and r.club_id=v_member.club_id
   and (r.role::text='admin' or
    (r.role::text='collaborator' and 'manage_members'=any(r.permissions)))
 ) into v_allowed;
 if v_allowed is not true then
  raise exception 'SOCIO_CARD_STAFF_FORBIDDEN' using errcode='42501';
 end if;
 v_active:=v_member.club_active and v_member.expires_at>=current_date;
 select coalesce((
  select w.enabled from public.socio_club_wallet_settings w
   where w.club_id=v_member.club_id
 ),false) into v_wallet_enabled;
 insert into public.socio_member_cards
 (club_id,member_id,club_name,member_number,active,wallet_enabled,revoked_at,updated_at)
 values (v_member.club_id,v_member.id,v_member.club_name,v_member.member_number,
  v_active,(v_active and v_wallet_enabled),
  case when v_active then null else now() end,now())
 on conflict (club_id,member_id) do update set
  club_name=excluded.club_name,member_number=excluded.member_number,
  active=excluded.active,wallet_enabled=excluded.wallet_enabled,
  revoked_at=excluded.revoked_at,updated_at=now();
 -- An enabled club may present a zero-balance wallet to an active member
 -- immediately. This creates NO ledger entry and NO cash income.
 -- Re-running synchronization must never modify an existing balance.
 if v_active and v_wallet_enabled then
  insert into public.socio_wallet_accounts(club_id,member_id,balance_cents)
  values (v_member.club_id,v_member.id,0)
  on conflict (club_id,member_id) do nothing;
 end if;
 return true;
end;
$socio_card_sync$;
revoke all on function public.socio_sync_member_card(uuid) from public,anon,authenticated;
grant execute on function public.socio_sync_member_card(uuid) to authenticated;
commit;

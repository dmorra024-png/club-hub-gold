-- Reviewed add-on: auto-provision every new/renewed active member in a club
-- whose one Monedero setting is enabled. Never changes existing balances.
begin;
create or replace function public.socio_wallet_sync_member_on_change()
returns trigger language plpgsql security definer set search_path=''
as $wallet_sync$
declare v_club record;v_enabled boolean;v_active boolean;
begin
 select c.name,c.active,coalesce(s.enabled,false) as enabled into v_club
 from public.clubs c left join public.socio_club_wallet_settings s
 on s.club_id=c.id where c.id=new.club_id;
 if not found then return new;end if;
 v_enabled:=v_club.active and v_club.enabled;
 v_active:=v_club.active and new.expires_at>=current_date;
 -- Every active club member needs a Socio digital card, regardless of
 -- whether this club has enabled the optional Monedero payment feature.
 insert into public.socio_member_cards
  (club_id,member_id,club_name,member_number,active,wallet_enabled,revoked_at,updated_at)
 values(new.club_id,new.id,v_club.name,new.member_number,v_active,
  (v_active and v_enabled),case when v_active then null else now() end,now())
 on conflict (club_id,member_id) do update set
  club_name=excluded.club_name,member_number=excluded.member_number,
  active=excluded.active,wallet_enabled=excluded.wallet_enabled,
  revoked_at=excluded.revoked_at,updated_at=now();
 if v_enabled and v_active then
  insert into public.socio_wallet_accounts(club_id,member_id,balance_cents)
  values(new.club_id,new.id,0)
  on conflict (club_id,member_id) do nothing;
 end if;
 return new;
end;
$wallet_sync$;
revoke all on function public.socio_wallet_sync_member_on_change()
 from public,anon,authenticated;
drop trigger if exists socio_wallet_member_auto_sync on public.members;
create trigger socio_wallet_member_auto_sync
after insert or update of expires_at,member_number on public.members
for each row execute function public.socio_wallet_sync_member_on_change();
commit;

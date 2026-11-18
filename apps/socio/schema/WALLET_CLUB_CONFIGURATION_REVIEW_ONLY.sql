-- REVIEW ONLY. Club-level switch: one setting for ALL active club members.
-- Must be reviewed/tested alongside the entire wallet/cash schema before applying.
-- No individual member activation endpoint is provided.
begin;

create or replace function public.socio_wallet_club_configuration()
returns jsonb language plpgsql stable security definer set search_path=''
as $club_wallet_read$
declare v_club uuid:=public.current_club_id();v_enabled boolean;
begin
 if (select auth.uid()) is null or v_club is null or
  not public.is_current_user_club_admin(v_club) then
  raise exception 'WALLET_CLUB_ADMIN_REQUIRED' using errcode='42501';
 end if;
 select coalesce(s.enabled,false) into v_enabled
  from public.socio_club_wallet_settings s where s.club_id=v_club;
 return jsonb_build_object('clubEnabled',coalesce(v_enabled,false),'configured',true);
end;
$club_wallet_read$;
revoke all on function public.socio_wallet_club_configuration()
 from public,anon,authenticated;
grant execute on function public.socio_wallet_club_configuration()
 to authenticated;

create or replace function public.socio_wallet_set_club_enabled(
 p_enabled boolean,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path=''
as $club_wallet_toggle$
declare v_club uuid:=public.current_club_id();
 v_actor uuid:=(select auth.uid());v_previous boolean;v_name text;
begin
 if v_actor is null or v_club is null or
  not public.is_current_user_club_admin(v_club) then
  raise exception 'WALLET_CLUB_ADMIN_REQUIRED' using errcode='42501';
 end if;
 if p_enabled is null or p_confirmed is distinct from true then
  raise exception 'WALLET_CLUB_EXPLICIT_CONFIRMATION_REQUIRED' using errcode='22023';
 end if;
 -- Serialize a switch with the existing spend/topup locks.
 select name into v_name from public.clubs
 where id=v_club and active for update;
 if not found then
  raise exception 'WALLET_CLUB_INACTIVE' using errcode='23514';
 end if;
 insert into public.socio_club_wallet_settings(club_id,enabled,changed_by)
 values(v_club,false,v_actor) on conflict(club_id) do nothing;
 select enabled into v_previous from public.socio_club_wallet_settings
 where club_id=v_club for update;
 if v_previous is distinct from p_enabled then
  -- Prepare all eligible members once, no per-member opt-in.
  if p_enabled then
   insert into public.socio_member_cards
    (club_id,member_id,club_name,member_number,active,wallet_enabled,revoked_at)
   select m.club_id,m.id,v_name,m.member_number,
     (m.expires_at>=current_date),true,null
    from public.members m where m.club_id=v_club
      and m.expires_at>=current_date
   on conflict(club_id,member_id) do update
    set wallet_enabled=true,updated_at=now();
   insert into public.socio_wallet_accounts(club_id,member_id,balance_cents)
    select m.club_id,m.id,0 from public.members m
    where m.club_id=v_club and m.expires_at>=current_date
   on conflict(club_id,member_id) do nothing;
  end if;
  update public.socio_member_cards set wallet_enabled=p_enabled,updated_at=now()
   where club_id=v_club;
  update public.socio_club_wallet_settings
   set enabled=p_enabled,changed_by=v_actor,changed_at=now()
   where club_id=v_club;
 end if;
 return jsonb_build_object('clubEnabled',p_enabled,'configured',true,
  'changed',v_previous is distinct from p_enabled);
end;
$club_wallet_toggle$;
revoke all on function public.socio_wallet_set_club_enabled(boolean,boolean)
 from public,anon,authenticated;
grant execute on function public.socio_wallet_set_club_enabled(boolean,boolean)
 to authenticated;

commit;

-- REVIEW ONLY. Staff-safe wallet status for rendering real management UI.
-- Requires all socio_* migrations. No publication or execution without approval.
begin;
create or replace function public.socio_wallet_staff_member_state(p_member_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $state$
declare v_actor uuid:=(select auth.uid());v_club uuid;v_enabled boolean;
 v_balance bigint;v_active boolean;
begin
 if v_actor is null or p_member_id is null then
  raise exception 'WALLET_STAFF_NOT_AUTHORIZED' using errcode='42501';
 end if;
 select r.club_id into strict v_club from public.user_roles r
  join public.socio_wallet_staff_permissions p
   on p.club_id=r.club_id and p.user_id=r.user_id
  join public.members m on m.club_id=r.club_id and m.id=p_member_id
  where r.user_id=v_actor and r.role::text in ('admin','collaborator')
   and (r.role::text='admin' or 'use_cash'=any(r.permissions))
   and (p.can_topup or p.can_spend or p.can_refund);
 select s.enabled into v_enabled from public.socio_club_wallet_settings s
  join public.clubs c on c.id=s.club_id and c.active
  where s.club_id=v_club;
 if v_enabled is distinct from true then
  return jsonb_build_object('enabled',false,'balanceCents',null);
 end if;
 select (m.expires_at>=current_date and card.active and card.wallet_enabled
         and card.revoked_at is null) into v_active
  from public.members m join public.socio_member_cards card
   on card.club_id=m.club_id and card.member_id=m.id
  where m.id=p_member_id and m.club_id=v_club;
 if v_active is distinct from true then
  return jsonb_build_object('enabled',false,'balanceCents',null);
 end if;
 select balance_cents into v_balance from public.socio_wallet_accounts
 where club_id=v_club and member_id=p_member_id;
 if v_balance is null then
  return jsonb_build_object('enabled',false,'balanceCents',null);
 end if;
 return jsonb_build_object('enabled',true,'balanceCents',v_balance);
exception when no_data_found or too_many_rows then
 raise exception 'WALLET_STAFF_NOT_AUTHORIZED' using errcode='42501';
end;
$state$;
revoke all on function public.socio_wallet_staff_member_state(uuid) from public,anon,authenticated;
grant execute on function public.socio_wallet_staff_member_state(uuid) to authenticated;
commit;

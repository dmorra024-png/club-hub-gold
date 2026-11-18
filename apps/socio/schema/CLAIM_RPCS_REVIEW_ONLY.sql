-- REVIEW ONLY. Requires REVIEW_ONLY.sql tables; not a production migration.
-- Separate verified staff issuance and member claim. All privileged functions
-- reject unauthorized callers and are explicitly granted to authenticated only.
begin;
create function public.socio_issue_member_claim(p_club_id uuid,p_member_id uuid)
returns text language plpgsql security definer set search_path=''
as $snoop_issue$
declare
 v_staff uuid := (select auth.uid());
 v_code text;
begin
 if v_staff is null or not exists (
  select 1 from public.user_roles r
  where r.user_id=v_staff and r.club_id=p_club_id
  and (
   r.role::text='admin' or
   (r.role::text='collaborator' and 'manage_members'=any(r.permissions))
  )
 ) then
  raise exception 'STAFF_CLAIM_FORBIDDEN' using errcode='42501';
 end if;
 -- Lock member row to serialize staff issuance for this exact membership.
 perform 1 from public.members m
  join public.clubs c on c.id=m.club_id
  where m.id=p_member_id and m.club_id=p_club_id
   and m.expires_at >= current_date and c.active
   and exists (
    select 1 from public.socio_member_cards card
    where card.club_id=m.club_id and card.member_id=m.id
     and card.active and card.revoked_at is null
   )
  for update of m;
 if not found then
  raise exception 'CLAIM_MEMBER_NOT_ACTIVE' using errcode='42501';
 end if;
 if (
  select count(*) from public.socio_member_claim_challenges
  where issued_by=v_staff and issued_at > now() - interval '1 hour'
 ) >= 20 then
  raise exception 'CLAIM_ISSUANCE_RATE_LIMIT' using errcode='42501';
 end if;
 update public.socio_member_claim_challenges
  set revoked_at=now()
  where club_id=p_club_id and member_id=p_member_id
   and consumed_at is null and revoked_at is null;
 v_code:=encode(extensions.gen_random_bytes(24),'hex');
 insert into public.socio_member_claim_challenges
  (club_id,member_id,code_sha256,issued_by,expires_at)
 values (p_club_id,p_member_id,
  extensions.digest('snoop-socio-claim:v1:'||v_code,'sha256'),
  v_staff,now()+interval '10 minutes');
 return v_code;
end;
$snoop_issue$;
revoke all on function public.socio_issue_member_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.socio_issue_member_claim(uuid,uuid) to authenticated;

create function public.socio_claim_member(p_code text)
returns boolean language plpgsql security definer set search_path=''
as $snoop_claim$
declare
 v_user uuid := (select auth.uid());
 v_candidate record;
 v_count integer;
begin
 if v_user is null or not exists(
  select 1 from auth.users u
  where u.id=v_user and u.email_confirmed_at is not null
 ) or exists(select 1 from public.user_roles r where r.user_id=v_user)
 then
  raise exception 'SOCIO_ACCOUNT_NOT_AUTHORIZED' using errcode='42501';
 end if;
 if p_code is null or p_code !~ '^[a-f0-9]{48}$' then return false; end if;
 select ch.id,ch.club_id,ch.member_id into v_candidate
  from public.socio_member_claim_challenges ch
  where ch.code_sha256=extensions.digest(
   'snoop-socio-claim:v1:'||p_code,'sha256')
   and ch.consumed_at is null and ch.revoked_at is null
   and ch.expires_at > now()
  for update;
 if not found then return false; end if;
 if not exists (
  select 1 from public.members m join public.clubs c on c.id=m.club_id
   join public.socio_member_cards card on card.member_id=m.id and card.club_id=m.club_id
  where m.id=v_candidate.member_id and m.club_id=v_candidate.club_id
   and m.expires_at >= current_date and c.active
   and card.active and card.revoked_at is null
 ) then return false; end if;
 insert into public.socio_membership_links(
  auth_user_id,club_id,member_id,status,verified_at
 ) values(v_user,v_candidate.club_id,v_candidate.member_id,'verified',now())
 on conflict (club_id,member_id) do nothing;
 get diagnostics v_count=row_count;
 if v_count <> 1 then return false; end if;
 update public.socio_member_claim_challenges
 set consumed_at=now(),consumed_by=v_user where id=v_candidate.id;
 return true;
end;
$snoop_claim$;
revoke all on function public.socio_claim_member(text) from public,anon,authenticated;
grant execute on function public.socio_claim_member(text) to authenticated;
commit;

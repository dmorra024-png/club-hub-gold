-- REVIEW ONLY: six-digit SNOOP Socio activation. Apply to isolated pilot only
-- after schema validation; this is NOT an automatic production migration.
-- Depends on socio_member_claim_challenges, socio_member_cards and
-- socio_membership_links from the existing reviewed pilot schema.
begin;
alter table public.socio_member_claim_challenges
 add column if not exists otp_attempts integer not null default 0
 check (otp_attempts between 0 and 5);

create or replace function public.socio_issue_member_claim(p_club_id uuid,p_member_id uuid)
returns text language plpgsql security definer set search_path=''
as $issue$
declare
 v_staff uuid := (select auth.uid());
 v_code text;
 v_id uuid := gen_random_uuid();
 v_bytes bytea := extensions.gen_random_bytes(4);
 v_number bigint;
begin
 if v_staff is null or not exists (
  select 1 from public.user_roles r
  where r.user_id=v_staff and r.club_id=p_club_id
   and (r.role::text='admin' or
    (r.role::text='collaborator' and 'manage_members'=any(r.permissions)))
 ) then raise exception 'STAFF_CLAIM_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.members m join public.clubs c on c.id=m.club_id
 where m.id=p_member_id and m.club_id=p_club_id and c.active
  and m.expires_at>=current_date
  and m.email is not null and btrim(m.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
  and exists(select 1 from public.socio_member_cards card
   where card.member_id=m.id and card.club_id=m.club_id
    and card.active and card.revoked_at is null)
 for update of m;
 if not found then raise exception 'CLAIM_MEMBER_NOT_ACTIVE' using errcode='42501'; end if;
 if (select count(*) from public.socio_member_claim_challenges
     where issued_by=v_staff and issued_at>now()-interval '1 hour')>=20
 then raise exception 'CLAIM_RATE_LIMIT' using errcode='42501'; end if;
 update public.socio_member_claim_challenges
  set revoked_at=now()
 where club_id=p_club_id and member_id=p_member_id
  and consumed_at is null and revoked_at is null;
 v_number:=(
  get_byte(v_bytes,0)::bigint*16777216+
  get_byte(v_bytes,1)::bigint*65536+
  get_byte(v_bytes,2)::bigint*256+
  get_byte(v_bytes,3)::bigint
 ) % 1000000;
 v_code:=lpad(v_number::text,6,'0');
 insert into public.socio_member_claim_challenges
  (id,club_id,member_id,code_sha256,issued_by,expires_at)
 values(v_id,p_club_id,p_member_id,
  extensions.digest('snoop-socio-otp:v1:'||v_id::text||':'||v_code,'sha256'),
  v_staff,now()+interval '10 minutes');
 return v_code;
end;
$issue$;

create or replace function public.socio_claim_member(p_code text)
returns boolean language plpgsql security definer set search_path=''
as $claim$
declare
 v_user uuid := (select auth.uid());
 v_candidate record;
 v_count integer;
 v_matched boolean := false;
begin
 if v_user is null or not exists (
  select 1 from auth.users u where u.id=v_user and u.email_confirmed_at is not null
 ) or exists(select 1 from public.user_roles r where r.user_id=v_user)
 then raise exception 'SOCIO_ACCOUNT_NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_code is null or p_code !~ '^[0-9]{6}$' then return false; end if;
 -- Only challenges for memberships owned by this CONFIRMED email are considered.
 -- Increment attempts under row locks, INCLUDING failed attempts. Five tries max.
 for v_candidate in
  select ch.id,ch.club_id,ch.member_id,ch.code_sha256
  from public.socio_member_claim_challenges ch
   join public.members m on m.id=ch.member_id and m.club_id=ch.club_id
   join public.clubs c on c.id=m.club_id
   join public.socio_member_cards card
    on card.member_id=m.id and card.club_id=m.club_id
   join auth.users u on u.id=v_user
  where lower(btrim(m.email))=lower(btrim(u.email))
   and m.expires_at>=current_date and c.active and card.active
   and card.revoked_at is null and ch.consumed_at is null
   and ch.revoked_at is null and ch.expires_at>now() and ch.otp_attempts<5
  order by ch.issued_at desc for update of ch
 loop
  update public.socio_member_claim_challenges
   set otp_attempts=otp_attempts+1 where id=v_candidate.id;
  if v_candidate.code_sha256=
   extensions.digest('snoop-socio-otp:v1:'||v_candidate.id::text||':'||p_code,'sha256')
  then
   insert into public.socio_membership_links
    (auth_user_id,club_id,member_id,status,verified_at)
   values(v_user,v_candidate.club_id,v_candidate.member_id,'verified',now())
   on conflict (club_id,member_id) do nothing;
   get diagnostics v_count=row_count;
   if v_count=1 then
    update public.socio_member_claim_challenges
      set consumed_at=now(),consumed_by=v_user where id=v_candidate.id;
    v_matched:=true;
   end if;
   exit;
  end if;
 end loop;
 return v_matched;
end;
$claim$;
revoke all on function public.socio_issue_member_claim(uuid,uuid),
 public.socio_claim_member(text) from public,anon,authenticated;
grant execute on function public.socio_issue_member_claim(uuid,uuid),
 public.socio_claim_member(text) to authenticated;
commit;

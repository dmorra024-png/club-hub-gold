-- SNOOP Socio: club-emailed six digits are the sole verification.
-- ONLY service_role may call these registration helpers. Neither helper is
-- available to anon/authenticated clients through PostgREST.
create or replace function public.socio_preflight_registration(p_email text,p_code text)
returns boolean language plpgsql security definer set search_path=''
as $body$
declare ch record;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if p_email is null or length(p_email)>254 or
    p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_code !~ '^[0-9]{6}$' then return false; end if;
 -- Existing staff and member Auth identities must never be converted/reset.
 if exists(select 1 from auth.users u where lower(u.email)=lower(btrim(p_email))) then return false; end if;
 for ch in
   select c.id,c.code_sha256
    from public.socio_member_claim_challenges c
    join public.members m on m.id=c.member_id and m.club_id=c.club_id
    join public.clubs club on club.id=m.club_id
    join public.socio_member_cards card on card.member_id=m.id and card.club_id=m.club_id
    where lower(btrim(m.email))=lower(btrim(p_email))
     and m.expires_at>=current_date and club.active and card.active
     and card.revoked_at is null and c.consumed_at is null and c.revoked_at is null
     and c.expires_at>now() and c.otp_attempts<5
     and not exists(select 1 from public.socio_membership_links l
                    where l.club_id=m.club_id and l.member_id=m.id)
    order by c.issued_at desc for update of c
 loop
   update public.socio_member_claim_challenges set otp_attempts=otp_attempts+1 where id=ch.id;
   if ch.code_sha256=extensions.digest('snoop-socio-otp:v1:'||ch.id::text||':'||p_code,'sha256') then
     return true;
   end if;
 end loop;
 return false;
end;
$body$;

create or replace function public.socio_finish_registration(
 p_auth_user_id uuid,p_email text,p_code text
)
returns boolean language plpgsql security definer set search_path=''
as $body$
declare ch record;
declare v_count int;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if p_auth_user_id is null or p_email is null or p_code !~ '^[0-9]{6}$' then return false; end if;
 if not exists(select 1 from auth.users u where u.id=p_auth_user_id
    and lower(u.email)=lower(btrim(p_email)) and u.email_confirmed_at is not null)
   or exists(select 1 from public.user_roles r where r.user_id=p_auth_user_id) then
   return false;
 end if;
 for ch in
   select c.id,c.club_id,c.member_id,c.code_sha256
   from public.socio_member_claim_challenges c
    join public.members m on m.id=c.member_id and m.club_id=c.club_id
    join public.clubs club on club.id=m.club_id
    join public.socio_member_cards card on card.member_id=m.id and card.club_id=m.club_id
   where lower(btrim(m.email))=lower(btrim(p_email))
    and m.expires_at>=current_date and club.active and card.active
    and card.revoked_at is null and c.consumed_at is null and c.revoked_at is null
    and c.expires_at>now() and c.otp_attempts between 1 and 5
    and not exists(select 1 from public.socio_membership_links l
      where l.club_id=m.club_id and l.member_id=m.id)
   order by c.issued_at desc for update of c
 loop
   if ch.code_sha256<>extensions.digest('snoop-socio-otp:v1:'||ch.id::text||':'||p_code,'sha256')
      then continue; end if;
   insert into public.socio_membership_links
    (auth_user_id,club_id,member_id,status,verified_at)
   values(p_auth_user_id,ch.club_id,ch.member_id,'verified',now())
   on conflict (club_id,member_id) do nothing;
   get diagnostics v_count=row_count;
   if v_count<>1 then return false; end if;
   update public.socio_member_claim_challenges
    set consumed_at=now(),consumed_by=p_auth_user_id where id=ch.id;
   return true;
 end loop;
 return false;
end;
$body$;
revoke all on function public.socio_preflight_registration(text,text),
 public.socio_finish_registration(uuid,text,text) from public,anon,authenticated;
grant execute on function public.socio_preflight_registration(text,text),
 public.socio_finish_registration(uuid,text,text) to service_role;

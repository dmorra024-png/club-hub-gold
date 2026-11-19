-- Pilot: only the verified account owning the member's email can claim
-- a one-use SNOOP Socio invitation. No member rows or QR data are changed.
create or replace function public.socio_claim_member(p_code text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
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
 where ch.code_sha256=extensions.digest('snoop-socio-claim:v1:'||p_code,'sha256')
   and ch.consumed_at is null and ch.revoked_at is null
   and ch.expires_at > now()
 for update;
 if not found then return false; end if;
 if not exists (
   select 1
   from public.members m
   join public.clubs c on c.id=m.club_id
   join public.socio_member_cards card on card.member_id=m.id and card.club_id=m.club_id
   join auth.users u on u.id=v_user
   where m.id=v_candidate.member_id and m.club_id=v_candidate.club_id
    and m.expires_at >= current_date and c.active
    and card.active and card.revoked_at is null
    and m.email is not null
    and lower(btrim(m.email))=lower(btrim(u.email))
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
$function$;

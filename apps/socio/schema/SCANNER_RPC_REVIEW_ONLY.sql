-- REVIEW ONLY. Never run on production before explicit schema review.
-- The server must validate the AES-GCM QR token before invoking this RPC.
-- The DB rechecks staff authorization, member expiry/club scope and replay
-- under the same transaction that consumes the nonce.
begin;
create function public.socio_staff_consume_qr(
 p_club_id uuid,p_member_id uuid,p_nonce text
) returns boolean
language plpgsql security definer set search_path=''
as $scanner$
declare v_staff uuid:=(select auth.uid()); v_inserted integer;
begin
 if v_staff is null or not exists(
  select 1 from public.user_roles r
  where r.user_id=v_staff and r.club_id=p_club_id
   and (r.role::text='admin' or
    (r.role::text='collaborator' and
     ('use_cash'=any(r.permissions) or 'manage_members'=any(r.permissions))))
 ) then raise exception 'QR_STAFF_NOT_AUTHORIZED' using errcode='42501';
 end if;
 if p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{20,30}$'
 then return false; end if;
 perform 1 from public.members m
  join public.clubs c on c.id=m.club_id
  join public.socio_member_cards card
   on card.club_id=m.club_id and card.member_id=m.id
  where m.id=p_member_id and m.club_id=p_club_id
   and m.expires_at>=current_date and c.active
   and card.active and card.revoked_at is null
  for share of m,c,card;
 if not found then return false; end if;
 insert into public.socio_qr_scan_nonces
 (nonce_sha256,club_id,member_id,scanned_by,expires_at)
 values (extensions.digest('snoop-socio-qr:v2:'||p_nonce,'sha256'),
  p_club_id,p_member_id,v_staff,now()+interval '60 seconds')
 on conflict (nonce_sha256) do nothing;
 get diagnostics v_inserted=row_count;
 return v_inserted=1;
end;
$scanner$;
revoke all on function public.socio_staff_consume_qr(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.socio_staff_consume_qr(uuid,uuid,text)
 to authenticated;
commit;

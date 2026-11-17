-- Disposable Postgres assertions only; requires prior claim fixture.
\set ON_ERROR_STOP on
update public.members
 set member_number='015'
 where id='935b7336-4bc9-4ba3-88e0-98b04f53ec51';
insert into public.socio_club_wallet_settings(club_id,enabled)
values('4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',true);
set role authenticated;
select set_config('request.jwt.claim.sub',
 '7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_sync_member_card('935b7336-4bc9-4ba3-88e0-98b04f53ec51') as synced \gset
select 1/(case when :'synced'='t' then 1 else 0 end) as sync_ok;
reset role;
do $assert$
declare c record;
begin
 select * into c from public.socio_member_cards
 where member_id='935b7336-4bc9-4ba3-88e0-98b04f53ec51';
 if c.member_number<>'015' or c.club_name<>'Club A' or
   c.active is not true or c.wallet_enabled is not true then
  raise exception 'SYNCHRONIZED_CARD_FIELDS_INVALID';
 end if;
 if (select count(*) from information_schema.columns
  where table_schema='public' and table_name='socio_member_cards'
  and column_name in ('email','first_name','last_name','dni_number','dni_photo_path','signature_path','notes'))<>0 then
  raise exception 'SENSITIVE_MEMBER_COLUMNS_EXPOSED';
 end if;
end
$assert$;
-- Non-admin accounts must not update other people's membership projections.
set role authenticated;
select set_config('request.jwt.claim.sub',
 '4f778a41-c207-4011-84b6-8a6c2cc1c011',false);
do $assert$
begin
 begin
  perform public.socio_sync_member_card('935b7336-4bc9-4ba3-88e0-98b04f53ec51');
  raise exception 'UNAUTHORIZED_CARD_SYNC_ALLOWED';
 exception when insufficient_privilege then null; end;
end
$assert$;
reset role;
update public.members set expires_at=current_date-1
 where id='935b7336-4bc9-4ba3-88e0-98b04f53ec51';
set role authenticated;
select set_config('request.jwt.claim.sub',
 '7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_sync_member_card('935b7336-4bc9-4ba3-88e0-98b04f53ec51') as synced \gset
reset role;
do $assert$
declare c record;
begin
 select * into c from public.socio_member_cards where member_id=
 '935b7336-4bc9-4ba3-88e0-98b04f53ec51';
 if c.active or c.wallet_enabled or c.revoked_at is null then
  raise exception 'EXPIRED_MEMBER_NOT_DISABLED';
 end if;
end
$assert$;
select 'SNOOP SOCIO: authorized minimal card sync, wallet setting, expiry and privacy PASS' as result;

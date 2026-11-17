-- Cross-club RLS and schema constraints: run only on throwaway PostgreSQL.
\set ON_ERROR_STOP on
insert into auth.users(id) values
('9d5d3ca0-de23-467b-8ad4-211fce9003b9'),
('9ab51fa6-dff9-4d15-a80a-a32295264c8d');
insert into public.clubs(id,name) values
('4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc','Club A'),
('63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4','Club B');
insert into public.members(id,club_id) values
('c319b1ed-9389-4c81-9e7f-42f808d95c34','4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc'),
('437f044d-9c4d-4b95-8672-d2b8c9af3851','63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4');
insert into public.socio_member_cards(club_id,member_id,club_name,member_number,active,wallet_enabled)
values
('4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc','c319b1ed-9389-4c81-9e7f-42f808d95c34','Club A','001',true,true),
('63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4','437f044d-9c4d-4b95-8672-d2b8c9af3851','Club B','002',true,true);
insert into public.socio_membership_links(auth_user_id,club_id,member_id,status,verified_at) values
('9d5d3ca0-de23-467b-8ad4-211fce9003b9','4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc','c319b1ed-9389-4c81-9e7f-42f808d95c34','verified',now()),
('9ab51fa6-dff9-4d15-a80a-a32295264c8d','63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4','437f044d-9c4d-4b95-8672-d2b8c9af3851','verified',now());
insert into public.socio_club_wallet_settings(club_id,enabled) values
('4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',true),
('63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4',true);
insert into public.socio_wallet_accounts(club_id,member_id,balance_cents) values
('4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc','c319b1ed-9389-4c81-9e7f-42f808d95c34',2575),
('63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4','437f044d-9c4d-4b95-8672-d2b8c9af3851',6000);
-- Every independently referenced member table must reject a mismatched tenant.
do $test$
declare bad_club uuid:='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
        member_a uuid:='c319b1ed-9389-4c81-9e7f-42f808d95c34';
begin
 begin
  insert into public.socio_member_cards(club_id,member_id,club_name,member_number)
  values(bad_club,member_a,'WRONG','X');
  raise exception 'CROSS_CLUB_CARD_ACCEPTED';
 exception when check_violation then null; end;
 begin
  insert into public.socio_wallet_accounts(club_id,member_id)
  values(bad_club,member_a);
  raise exception 'CROSS_CLUB_WALLET_ACCEPTED';
 exception when check_violation then null; end;
 begin
  insert into public.socio_membership_links(auth_user_id,club_id,member_id,status,verified_at)
  values('9d5d3ca0-de23-467b-8ad4-211fce9003b9',bad_club,member_a,'verified',now());
  raise exception 'CROSS_CLUB_LINK_ACCEPTED';
 exception when check_violation then null; end;
 begin
  insert into public.socio_member_claim_challenges(
   club_id,member_id,code_sha256,issued_by,expires_at)
  values(bad_club,member_a,decode(repeat('ab',32),'hex'),
   '9d5d3ca0-de23-467b-8ad4-211fce9003b9',now()+interval '10 minutes');
  raise exception 'CROSS_CLUB_CHALLENGE_ACCEPTED';
 exception when check_violation then null; end;
 begin
  insert into public.socio_qr_scan_nonces(
   nonce_sha256,club_id,member_id,scanned_by,expires_at)
  values(decode(repeat('cd',32),'hex'),bad_club,member_a,
   '9d5d3ca0-de23-467b-8ad4-211fce9003b9',now()+interval '1 minute');
  raise exception 'CROSS_CLUB_SCAN_ACCEPTED';
 exception when check_violation then null; end;
end
$test$;
-- The user can read only their own linked cards, wallet and ledger rows.
set role authenticated;
select set_config('request.jwt.claim.sub',
 '9d5d3ca0-de23-467b-8ad4-211fce9003b9',false);
do $test$
declare n integer; b bigint;
begin
 select count(*) into n from public.socio_member_cards;
 if n<>1 then raise exception 'OWN_CARDS_SCOPE_FAILED: %',n; end if;
 select count(*) into n from public.socio_membership_links;
 if n<>1 then raise exception 'OWN_LINKS_SCOPE_FAILED: %',n; end if;
 select count(*) into n from public.socio_wallet_accounts;
 if n<>1 then raise exception 'OWN_WALLET_SCOPE_FAILED: %',n; end if;
 select balance_cents into b from public.socio_wallet_accounts;
 if b<>2575 then raise exception 'FOREIGN_BALANCE_READ: %',b; end if;
 if has_table_privilege('authenticated','public.socio_wallet_accounts','INSERT') then
  raise exception 'WALLET_WRITE_AVAILABLE_TO_SOCIO'; end if;
 if has_table_privilege('authenticated','public.socio_member_claim_challenges','SELECT') then
  raise exception 'PRIVATE_CHALLENGES_EXPOSED'; end if;
 if has_table_privilege('authenticated','public.socio_qr_scan_nonces','SELECT') then
  raise exception 'PRIVATE_QR_NONCES_EXPOSED'; end if;
end
$test$;
reset role;
select set_config('request.jwt.claim.sub',
 '9ab51fa6-dff9-4d15-a80a-a32295264c8d',false);
set role authenticated;
do $test$
declare b bigint; n integer;
begin
 select count(*) into n from public.socio_member_cards;
 if n<>1 then raise exception 'OTHER_CARD_SCOPE_FAILED: %',n; end if;
 select balance_cents into b from public.socio_wallet_accounts;
 if b<>6000 then raise exception 'FOREIGN_BALANCE_READ_OTHER: %',b; end if;
end
$test$;
reset role;
select 'SNOOP SOCIO: isolated SQL draft constraints and cross-club RLS PASS' as result;

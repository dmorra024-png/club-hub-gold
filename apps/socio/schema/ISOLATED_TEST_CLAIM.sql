-- Only after bootstrap, schema proposal and claim RPC proposal.
\set ON_ERROR_STOP on
insert into auth.users(id,email_confirmed_at) values
('7dbe4ead-c904-4c52-9fc1-51a9018aeb22',now()),
('4f778a41-c207-4011-84b6-8a6c2cc1c011',now());
insert into public.members(id,club_id) values
('935b7336-4bc9-4ba3-88e0-98b04f53ec51','4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc');
insert into public.socio_member_cards(club_id,member_id,club_name,member_number,active)
values ('4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
'935b7336-4bc9-4ba3-88e0-98b04f53ec51','Club A','003',true);
insert into public.user_roles(user_id,club_id,role,permissions) values
('7dbe4ead-c904-4c52-9fc1-51a9018aeb22',
'4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc','admin',array['manage_members']);
-- Public and anon cannot execute either security-definer RPC.
do $assert$
begin
 if has_function_privilege('anon','public.socio_claim_member(text)','EXECUTE') or
    has_function_privilege('anon','public.socio_issue_member_claim(uuid,uuid)','EXECUTE') then
  raise exception 'PUBLIC_MEMBERSHIP_WRITES_EXPOSED';
 end if;
end
$assert$;
set role authenticated;
select set_config('request.jwt.claim.sub',
'7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
-- Authorized staff issues exactly one secret shown once.
select public.socio_issue_member_claim(
'4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
'935b7336-4bc9-4ba3-88e0-98b04f53ec51') as claim_code \gset
reset role;
select set_config('request.jwt.claim.sub',
'4f778a41-c207-4011-84b6-8a6c2cc1c011',false);
set role authenticated;
select public.socio_claim_member(:'claim_code') as claim_ok \gset
select 1 / (case when :'claim_ok'='t' then 1 else 0 end) as first_claim_passed;
select public.socio_claim_member(:'claim_code') as replay \gset
select 1 / (case when :'replay'='f' then 1 else 0 end) as replay_rejected;
reset role;
do $assert$
declare n integer;
begin
 select count(*) into n from public.socio_membership_links
 where auth_user_id='4f778a41-c207-4011-84b6-8a6c2cc1c011'
  and club_id='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc'
  and member_id='935b7336-4bc9-4ba3-88e0-98b04f53ec51'
  and status='verified';
 if n<>1 then raise exception 'CLAIM_LINK_NOT_CREATED'; end if;
 select count(*) into n from public.socio_member_claim_challenges
 where consumed_by='4f778a41-c207-4011-84b6-8a6c2cc1c011';
 if n<>1 then raise exception 'CLAIM_NOT_CONSUMED'; end if;
end
$assert$;
select 'SNOOP SOCIO: isolated staff issuance, email-verified one-use claim and replay protection PASS' as result;

-- Disposable CI PostgreSQL 16 only: no payment provider or production money.
\set ON_ERROR_STOP on
-- Existing fixtures have two clubs; only club A is enabled for these tests.
update public.socio_club_wallet_settings set enabled=true
 where club_id='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
update public.socio_member_cards set active=true,wallet_enabled=true,revoked_at=null
 where member_id='c319b1ed-9389-4c81-9e7f-42f808d95c34';
insert into public.cash_sessions(id,club_id,user_id,status) values
('f78e650f-66e1-40af-b1cd-4f8151cfda96',
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
 '7dbe4ead-c904-4c52-9fc1-51a9018aeb22','open'),
('3b4a2f4d-c8d9-4236-a467-579f313129f7',
 '63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4',
 '7dbe4ead-c904-4c52-9fc1-51a9018aeb22','open');
insert into public.socio_wallet_staff_permissions(club_id,user_id,can_topup)
values ('4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
 '7dbe4ead-c904-4c52-9fc1-51a9018aeb22',true);
-- Public must not access the RPC or staff permission table.
do $guard$
begin
 if has_function_privilege('anon','public.socio_wallet_topup(uuid,uuid,uuid,uuid,bigint)','execute')
 then raise exception 'PUBLIC_TOPUP_RPC_EXPOSED';end if;
 if has_table_privilege('authenticated','public.socio_wallet_staff_permissions','SELECT')
 then raise exception 'WALLET_STAFF_PERMISSIONS_EXPOSED';end if;
end
$guard$;
set role authenticated;
select set_config('request.jwt.claim.sub',
 '7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_wallet_topup(
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
 'c319b1ed-9389-4c81-9e7f-42f808d95c34',
 'f78e650f-66e1-40af-b1cd-4f8151cfda96',
 '11111111-2222-4333-8444-555555555555',1200) as first_topup \gset
select 1/(case when :'first_topup' like '%"status": "applied"%' then 1 else 0 end) as topup_applied;
select public.socio_wallet_topup(
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
 'c319b1ed-9389-4c81-9e7f-42f808d95c34',
 'f78e650f-66e1-40af-b1cd-4f8151cfda96',
 '11111111-2222-4333-8444-555555555555',1200) as repeated_topup \gset
select 1/(case when :'repeated_topup' like '%"status": "duplicate"%' then 1 else 0 end) as idempotency_ok;
reset role;
do $guard$
declare bal bigint; ledger_count integer;
begin
 select balance_cents into bal from public.socio_wallet_accounts
 where club_id='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc'
 and member_id='c319b1ed-9389-4c81-9e7f-42f808d95c34';
 if bal<>3775 then raise exception 'TOPUP_BALANCE_WRONG: %',bal;end if;
 select count(*) into ledger_count from public.socio_wallet_ledger
 where operation_id='11111111-2222-4333-8444-555555555555';
 if ledger_count<>1 then raise exception 'DUPLICATE_TOPUP_LEDGER';end if;
end
$guard$;
-- Wrong club, changed amount, closed session and unapproved staff fail.
set role authenticated;
select set_config('request.jwt.claim.sub',
 '7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
do $assert$
begin
 begin
  perform public.socio_wallet_topup(
  '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
  'c319b1ed-9389-4c81-9e7f-42f808d95c34',
  'f78e650f-66e1-40af-b1cd-4f8151cfda96',
  '11111111-2222-4333-8444-555555555555',2000);
  raise exception 'REPLAY_CHANGED_AMOUNT_ACCEPTED';
 exception when unique_violation then null;end;
 begin
  perform public.socio_wallet_topup(
  '63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4',
  'c319b1ed-9389-4c81-9e7f-42f808d95c34',
  '3b4a2f4d-c8d9-4236-a467-579f313129f7',
  '22222222-2222-4333-8444-555555555555',100);
  raise exception 'CROSS_TENANT_TOPUP_ACCEPTED';
 exception when insufficient_privilege then null;end;
end
$assert$;
reset role;
update public.cash_sessions set status='closed',closed_at=now()
 where id='f78e650f-66e1-40af-b1cd-4f8151cfda96';
set role authenticated;
select set_config('request.jwt.claim.sub',
 '7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
do $assert$
begin
 begin
  perform public.socio_wallet_topup(
  '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
  'c319b1ed-9389-4c81-9e7f-42f808d95c34',
  'f78e650f-66e1-40af-b1cd-4f8151cfda96',
  '33333333-2222-4333-8444-555555555555',100);
  raise exception 'CLOSED_CASH_TOPUP_ACCEPTED';
 exception when check_violation then null;end;
end
$assert$;
reset role;
select set_config('request.jwt.claim.sub',
 '4f778a41-c207-4011-84b6-8a6c2cc1c011',false);
set role authenticated;
do $assert$
begin
 begin
  perform public.socio_wallet_topup(
  '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
  'c319b1ed-9389-4c81-9e7f-42f808d95c34',
  'f78e650f-66e1-40af-b1cd-4f8151cfda96',
  '44444444-2222-4333-8444-555555555555',100);
  raise exception 'UNAPPROVED_STAFF_TOPUP_ACCEPTED';
 exception when insufficient_privilege then null;end;
end
$assert$;
reset role;
select 'SNOOP SOCIO: atomic topup, replay protection, closed cash, staff deny PASS' as result;

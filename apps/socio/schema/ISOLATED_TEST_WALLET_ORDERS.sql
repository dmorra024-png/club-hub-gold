-- Disposable PostgreSQL CI only. Never execute on live club data.
\set ON_ERROR_STOP on
-- After previous topup tests, synthetic staff A exists and owns funded wallet.
update public.socio_wallet_staff_permissions
set can_spend=true,can_refund=true
where club_id='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc'
and user_id='7dbe4ead-c904-4c52-9fc1-51a9018aeb22';
insert into public.orders(id,club_id,member_id,total_cents,status)
values('56565656-1111-4222-8333-444444444444',
'4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
'c319b1ed-9389-4c81-9e7f-42f808d95c34',1500,'completed');
set role authenticated;
select set_config('request.jwt.claim.sub',
'7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
-- Completed legacy orders alone are NOT evidence that wallet settled them.
do $assert$
begin
 begin
  perform public.socio_wallet_order_spend(
   '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
   'c319b1ed-9389-4c81-9e7f-42f808d95c34',
   '56565656-1111-4222-8333-444444444444',
   '11111111-9999-4333-8444-555555555555',1500);
  raise exception 'LEGACY_ORDER_SPENT_WITHOUT_PROOF';
 exception when check_violation then null;end;
end
$assert$;
reset role;
-- Simulates proof written by a trusted *order transaction*; neither staff
-- nor member browser is granted INSERT on this table.
insert into public.socio_order_settlements
(order_id,club_id,member_id,payment_method,amount_cents)
values('56565656-1111-4222-8333-444444444444',
'4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
'c319b1ed-9389-4c81-9e7f-42f808d95c34','wallet',1500);
set role authenticated;
select set_config('request.jwt.claim.sub',
'7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_wallet_order_spend(
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
 'c319b1ed-9389-4c81-9e7f-42f808d95c34',
 '56565656-1111-4222-8333-444444444444',
 '11111111-9999-4333-8444-555555555555',1500) as spent \gset
select 1/(case when :'spent' like '%"status": "applied"%' then 1 else 0 end) as spend_once_passed;
select public.socio_wallet_order_spend(
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
 'c319b1ed-9389-4c81-9e7f-42f808d95c34',
 '56565656-1111-4222-8333-444444444444',
 '11111111-9999-4333-8444-555555555555',1500) as spent_replay \gset
select 1/(case when :'spent_replay' like '%"status": "duplicate"%' then 1 else 0 end) as duplicate_spend_rejected;
do $assert$
begin
 begin
  perform public.socio_wallet_order_spend(
   '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
   'c319b1ed-9389-4c81-9e7f-42f808d95c34',
   '56565656-1111-4222-8333-444444444444',
   '22222222-9999-4333-8444-555555555555',1500);
  raise exception 'SECOND_SPEND_ALLOWED';
 exception when unique_violation then null;end;
 begin
  perform public.socio_wallet_order_refund(
   '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
   'c319b1ed-9389-4c81-9e7f-42f808d95c34',
   '56565656-1111-4222-8333-444444444444',
   '11111111-9999-4333-8444-555555555555',
   '33333333-9999-4333-8444-555555555555',1500);
  raise exception 'REFUND_BEFORE_CANCELLATION_ALLOWED';
 exception when check_violation then null;end;
end
$assert$;
reset role;
do $assert$
declare bal bigint; n integer;
begin
 select balance_cents into bal from public.socio_wallet_accounts where
 club_id='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc'
 and member_id='c319b1ed-9389-4c81-9e7f-42f808d95c34';
 if bal<>2275 then raise exception 'SPEND_BALANCE_WRONG %',bal;end if;
 select count(*) into n from public.socio_wallet_ledger where
 order_id='56565656-1111-4222-8333-444444444444' and kind='spend';
 if n<>1 then raise exception 'DUPLICATE_SPEND_LEDGER';end if;
end
$assert$;
-- Cancellation and stock reversal must be done by SNOOP's existing trusted
-- cancellation workflow, never by the Monedero refund endpoint.
update public.orders set status='cancelled',cancelled_at=now()
where id='56565656-1111-4222-8333-444444444444';
insert into public.financial_order_reversals
(id,order_id,club_id,original_cents,delta_cents)
values('66666666-1111-4222-8333-444444444444',
'56565656-1111-4222-8333-444444444444',
'4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',1500,-1500);
set role authenticated;
select set_config('request.jwt.claim.sub',
'7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_wallet_order_refund(
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
 'c319b1ed-9389-4c81-9e7f-42f808d95c34',
 '56565656-1111-4222-8333-444444444444',
 '11111111-9999-4333-8444-555555555555',
 '33333333-9999-4333-8444-555555555555',1500) as refunded \gset
select 1/(case when :'refunded' like '%"status": "applied"%' then 1 else 0 end) as audited_refund;
select public.socio_wallet_order_refund(
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
 'c319b1ed-9389-4c81-9e7f-42f808d95c34',
 '56565656-1111-4222-8333-444444444444',
 '11111111-9999-4333-8444-555555555555',
 '33333333-9999-4333-8444-555555555555',1500) as refund_replay \gset
select 1/(case when :'refund_replay' like '%"status": "duplicate"%' then 1 else 0 end) as duplicate_refund_rejected;
do $assert$
begin
 begin
  perform public.socio_wallet_order_refund(
   '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
   'c319b1ed-9389-4c81-9e7f-42f808d95c34',
   '56565656-1111-4222-8333-444444444444',
   '11111111-9999-4333-8444-555555555555',
   '44444444-9999-4333-8444-555555555555',1500);
  raise exception 'SECOND_REFUND_ALLOWED';
 exception when unique_violation then null;end;
end
$assert$;
reset role;
do $assert$
declare bal bigint; n integer;
begin
 select balance_cents into bal from public.socio_wallet_accounts where
 club_id='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc'
 and member_id='c319b1ed-9389-4c81-9e7f-42f808d95c34';
 if bal<>3775 then raise exception 'REFUND_BALANCE_WRONG %',bal;end if;
 select count(*) into n from public.socio_wallet_ledger where
 order_id='56565656-1111-4222-8333-444444444444' and kind='refund';
 if n<>1 then raise exception 'DUPLICATE_REFUND_LEDGER';end if;
end
$assert$;
select 'SNOOP SOCIO: verified wallet order spend and audited refund PASS' as result;

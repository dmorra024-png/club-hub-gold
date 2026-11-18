-- Isolated PostgreSQL integration regression. Never execute in production.
\set ON_ERROR_STOP on
grant execute on function public.socio_create_wallet_order(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.socio_cancel_wallet_order(uuid,uuid,text,uuid) to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub','7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_create_wallet_order(
 'c319b1ed-9389-4c81-9e7f-42f808d95c34',
 'synthetic test only',
 '[{"product_id":"deafbeef-1111-4222-8333-444444444444","product_name":"Synthetic","unit_type":"gr","quantity":1,"unit_price_cents":800,"line_total_cents":800}]'::jsonb,
 '12121212-1111-4222-8333-444444444444') as created \gset
reset role;
create temporary table wallet_test_created as select :'created'::jsonb as body;

do $check$
declare j jsonb;oid uuid;bal bigint;stock integer;n integer;
begin
 select body into j from wallet_test_created;
 oid:=(j->>'orderId')::uuid;
 if j->>'status'<>'applied' or (j->>'amountCents')::bigint<>800 then
  raise exception 'ORDER_NOT_COMMITTED';end if;
 select balance_cents into bal from public.socio_wallet_accounts
 where club_id='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc'
 and member_id='c319b1ed-9389-4c81-9e7f-42f808d95c34';
 select remaining into stock from public.wallet_test_stock
 where product_id='deafbeef-1111-4222-8333-444444444444';
 select count(*) into n from public.socio_order_settlements
 where order_id=oid and payment_method='wallet';
 if bal<>2975 or stock<>9 or n<>1 then
  raise exception 'ORDER_WALLET_STOCK_NOT_ATOMIC: balance %,stock %,proof %',bal,stock,n;end if;
end
$check$;

set role authenticated;
select set_config('request.jwt.claim.sub','7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_cancel_wallet_order(
 'c319b1ed-9389-4c81-9e7f-42f808d95c34',
 (:'created'::jsonb->>'orderId')::uuid,
 'synthetic customer cancellation',
 '13131313-1111-4222-8333-444444444444') as cancelled \gset
reset role;
create temporary table wallet_test_cancelled as select :'cancelled'::jsonb as body;

do $check$
declare j jsonb;oid uuid;bal bigint;stock integer;n integer;
begin
 select body into j from wallet_test_cancelled;oid:=(j->>'orderId')::uuid;
 select balance_cents into bal from public.socio_wallet_accounts
 where club_id='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc'
 and member_id='c319b1ed-9389-4c81-9e7f-42f808d95c34';
 select remaining into stock from public.wallet_test_stock
 where product_id='deafbeef-1111-4222-8333-444444444444';
 select count(*) into n from public.financial_order_reversals
 where order_id=oid;
 if j->>'status'<>'applied' or bal<>3775 or stock<>10 or n<>1 then
  raise exception 'CANCEL_WALLET_STOCK_NOT_ATOMIC: balance %,stock %,audit %',bal,stock,n;end if;
end
$check$;

-- Insufficient funds must roll back the already created SNOOP order,
-- synthetic stock movement and the trusted proof.
create temporary table wallet_atomic_snapshot as
select (select count(*) from public.orders) as orders_before,
 (select remaining from public.wallet_test_stock
  where product_id='deafbeef-1111-4222-8333-444444444444') as stock_before,
 (select count(*) from public.socio_order_settlements) as proofs_before;
set role authenticated;
select set_config('request.jwt.claim.sub','7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
do $check$
begin
 begin
  perform public.socio_create_wallet_order(
   'c319b1ed-9389-4c81-9e7f-42f808d95c34',
   'insufficient synthetic funds',
   '[{"product_id":"deafbeef-1111-4222-8333-444444444444","product_name":"Synthetic","unit_type":"gr","quantity":7,"unit_price_cents":800,"line_total_cents":5600}]'::jsonb,
   '14141414-1111-4222-8333-444444444444');
  raise exception 'INSUFFICIENT_BALANCE_ORDER_ACCEPTED';
 exception when check_violation then null;
 end;
end
$check$;
reset role;
do $check$
declare s record;
begin
 select * into s from wallet_atomic_snapshot;
 if (select count(*) from public.orders)<>s.orders_before or
    (select remaining from public.wallet_test_stock
      where product_id='deafbeef-1111-4222-8333-444444444444')<>s.stock_before or
    (select count(*) from public.socio_order_settlements)<>s.proofs_before then
  raise exception 'FAILED_PAYMENT_LEFT_ORDER_OR_STOCK_MUTATION';end if;
end
$check$;
select 'SNOOP SOCIO: atomic order/debit and cancellation/refund boundaries PASS' as result;

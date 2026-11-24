-- Disposable CI PostgreSQL only. Prior fixtures create admin roles and cards.
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub',
 '7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_staff_consume_qr(
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
 'c319b1ed-9389-4c81-9e7f-42f808d95c34',
 'abcDef0123456789_-AbCdEf') as first_scan \gset
select 1/(case when :'first_scan'='t' then 1 else 0 end) as first_scan_success;
select public.socio_staff_consume_qr(
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',
 'c319b1ed-9389-4c81-9e7f-42f808d95c34',
 'abcDef0123456789_-AbCdEf') as replay \gset
select 1/(case when :'replay'='f' then 1 else 0 end) as repeated_scan_rejected;
-- Staff cannot scan a foreign club, RPC must deny it.
do $assert$
begin
 begin
  perform public.socio_staff_consume_qr(
   '63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4',
   'c319b1ed-9389-4c81-9e7f-42f808d95c34',
   'another012345678901234');
  raise exception 'FOREIGN_QR_SCAN_ALLOWED';
 exception when insufficient_privilege then null;
 end;
end
$assert$;
reset role;
do $assert$
declare n integer;
begin
 select count(*) into n from public.socio_qr_scan_nonces
 where member_id='c319b1ed-9389-4c81-9e7f-42f808d95c34';
 if n<>1 then raise exception 'QR_REPLAY_INSERTED_DUPLICATE'; end if;
 if has_table_privilege('authenticated','public.socio_qr_scan_nonces','INSERT')
 then raise exception 'QR_REPLAY_STORE_PUBLICLY_WRITABLE'; end if;
end
$assert$;
select 'SNOOP SOCIO: QR staff authorization + once-only consumption PASS' as result;

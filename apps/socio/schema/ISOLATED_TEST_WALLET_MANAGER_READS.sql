-- Disposable database: staff wallet-read authorisation + verified cash attribution.
\set ON_ERROR_STOP on
do $gate$
begin
 if has_function_privilege('anon',
  'public.socio_wallet_staff_member_state(uuid)','execute') then
  raise exception 'ANONYMOUS_WALLET_STATUS_EXPOSED';end if;
 if has_function_privilege('anon',
  'public.socio_wallet_cash_evidence(timestamptz,timestamptz)','execute') then
  raise exception 'ANONYMOUS_WALLET_CASH_EXPOSED';end if;
end
$gate$;
set role authenticated;
select set_config('request.jwt.claim.sub',
 '7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_wallet_staff_member_state(
 'c319b1ed-9389-4c81-9e7f-42f808d95c34') as state \gset
select 1/(case when (:'state'::jsonb->>'enabled')::boolean
 and (:'state'::jsonb->>'balanceCents')::bigint=3775 then 1 else 0 end)
 as authorized_wallet_status_pass;
select public.socio_wallet_cash_evidence(
 now()-interval '1 day',now()+interval '1 day') as evidence \gset
select 1/(case when jsonb_array_length(:'evidence'::jsonb->'topups')>=1
 then 1 else 0 end) as cash_topup_proof_pass;
do $negative$
begin
 begin
  perform public.socio_wallet_staff_member_state(
  '437f044d-9c4d-4b95-8672-d2b8c9af3851');
  raise exception 'CROSS_CLUB_WALLET_STATUS_EXPOSED';
 exception when insufficient_privilege then null;
 end;
end
$negative$;
reset role;
select 'SNOOP SOCIO: wallet staff read and cash attribution PASS' as result;

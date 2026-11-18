-- Disposable PostgreSQL only: automatic wallet account for future active members.
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_wallet_set_club_enabled(true,true);
reset role;
insert into public.members(id,club_id,member_number,expires_at)
values('9a7d65bc-0f94-43e5-baa4-2df6d65b8400',
 '4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc','NEW',current_date+30);
do $check$
begin
 if not exists(select 1 from public.socio_wallet_accounts
  where member_id='9a7d65bc-0f94-43e5-baa4-2df6d65b8400'
   and balance_cents=0) then
  raise exception 'NEW_ACTIVE_MEMBER_NOT_PROVISIONED';
 end if;
 if not exists(select 1 from public.socio_member_cards
  where member_id='9a7d65bc-0f94-43e5-baa4-2df6d65b8400'
  and active and wallet_enabled) then
  raise exception 'NEW_MEMBER_CARD_NOT_PROVISIONED';
 end if;
end;
$check$;
update public.socio_wallet_accounts set balance_cents=789
where member_id='9a7d65bc-0f94-43e5-baa4-2df6d65b8400';
update public.members set member_number='NEW2' where id='9a7d65bc-0f94-43e5-baa4-2df6d65b8400';
do $check$
begin
 if (select balance_cents from public.socio_wallet_accounts
 where member_id='9a7d65bc-0f94-43e5-baa4-2df6d65b8400')<>789 then
 raise exception 'SYNC_RESET_EXISTING_BALANCE';end if;
end;
$check$;
update public.members set expires_at=current_date-1
where id='9a7d65bc-0f94-43e5-baa4-2df6d65b8400';
do $check$
begin
 if exists(select 1 from public.socio_member_cards
 where member_id='9a7d65bc-0f94-43e5-baa4-2df6d65b8400'
 and (active or wallet_enabled or revoked_at is null)) then
 raise exception 'EXPIRED_MEMBER_NOT_DISABLED';
 end if;
end;
$check$;
select 'SNOOP: new members and renewals follow the single club switch PASS' as result;

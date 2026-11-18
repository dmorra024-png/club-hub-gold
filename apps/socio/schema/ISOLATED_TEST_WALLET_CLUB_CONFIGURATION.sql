-- Disposable PostgreSQL only: club-wide activation, no individual member flag.
\set ON_ERROR_STOP on
-- Fixture already has an authorised Club A admin and existing wallet balances.
insert into public.members(id,club_id,member_number,expires_at) values
('a3141dd0-60ad-4a13-a9c1-115e647bd02d','4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc','038',current_date+30),
('a3141dd0-60ad-4a13-a9c1-115e647bd03d','4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc','039',current_date-1);
set role authenticated;
select set_config('request.jwt.claim.sub','7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_wallet_set_club_enabled(false,true);
select public.socio_wallet_set_club_enabled(true,true) as enabled_state \gset
reset role;
do $assert$
declare b bigint; cards integer; expired integer; bad_balance integer;
begin
 if (:'enabled_state'::jsonb->>'clubEnabled')::boolean is distinct from true then
  raise exception 'CLUB_WALLET_WAS_NOT_ENABLED';end if;
 select balance_cents into b from public.socio_wallet_accounts
  where member_id='a3141dd0-60ad-4a13-a9c1-115e647bd02d';
 if b is distinct from 0 then raise exception 'NEW_MEMBER_BALANCE_NOT_ZERO: %',b;end if;
 select count(*) into cards from public.socio_member_cards
  where member_id='a3141dd0-60ad-4a13-a9c1-115e647bd02d' and wallet_enabled;
 if cards<>1 then raise exception 'GLOBAL_ACTIVATION_MISSING_ACTIVE_MEMBER';end if;
 select count(*) into expired from public.socio_wallet_accounts
  where member_id='a3141dd0-60ad-4a13-a9c1-115e647bd03d';
 if expired<>0 then raise exception 'EXPIRED_MEMBER_AUTO_WALLET_CREATED';end if;
 select count(*) into bad_balance from public.socio_wallet_accounts
  where member_id='935b7336-4bc9-4ba3-88e0-98b04f53ec51'
    and balance_cents<>1234;
 if bad_balance<>0 then raise exception 'EXISTING_BALANCE_RESET';end if;
end
$assert$;
set role authenticated;
select set_config('request.jwt.claim.sub','7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_wallet_club_configuration() as state \gset
reset role;
select 1/(case when (:'state'::jsonb->>'clubEnabled')::boolean then 1 else 0 end)
 as club_only_toggle_pass;
-- Unauthorised actor is forbidden: no club context and no admin role.
set role authenticated;
select set_config('request.jwt.claim.sub','4f778a41-c207-4011-84b6-8a6c2cc1c011',false);
do $assert$
begin
 begin
  perform public.socio_wallet_set_club_enabled(false,true);
  raise exception 'NON_ADMIN_CHANGED_CLUB_WALLET';
 exception when insufficient_privilege then null;
 end;
end
$assert$;
reset role;
-- A single club switch can disable every wallet without removing any balances.
set role authenticated;
select set_config('request.jwt.claim.sub','7dbe4ead-c904-4c52-9fc1-51a9018aeb22',false);
select public.socio_wallet_set_club_enabled(false,true);
reset role;
do $assert$
begin
 if exists(select 1 from public.socio_club_wallet_settings
 where club_id='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc' and enabled) then
 raise exception 'CLUB_WALLET_DISABLE_FAILED';end if;
 if (select balance_cents from public.socio_wallet_accounts
  where member_id='935b7336-4bc9-4ba3-88e0-98b04f53ec51') is distinct from 1234 then
 raise exception 'CLUB_DISABLE_ERASED_MEMBER_BALANCE';end if;
end
$assert$;
select 'SNOOP: club-wide activation, account creation, member isolation and preserved funds PASS' as result;

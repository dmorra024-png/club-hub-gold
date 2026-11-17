-- Test fixture ONLY. Used in a throwaway GitHub Actions PostgreSQL container.
-- Never execute against real SNOOP, never create these tables in production.
create role anon;
create role authenticated;
create schema auth;
grant usage on schema public,auth to authenticated;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable
 as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.clubs(id uuid primary key, name text not null);
create table public.members(
 id uuid primary key,
 club_id uuid not null references public.clubs(id)
);
create table public.orders(id uuid primary key, club_id uuid not null, member_id uuid not null);
create table public.cash_sessions(id uuid primary key, club_id uuid not null, user_id uuid not null);

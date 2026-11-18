-- Test fixture ONLY. Used in a throwaway GitHub Actions PostgreSQL container.
-- Never execute against real SNOOP, never create these tables in production.
create role anon;
create role authenticated;
create schema auth;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public,auth to authenticated;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable
 as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.clubs(id uuid primary key, name text not null,active boolean not null default true);
create table public.members(
 id uuid primary key,
 club_id uuid not null references public.clubs(id),
 member_number text not null default '000',
expires_at date not null default (current_date + interval '30 days')
);
create table public.user_roles(user_id uuid not null references auth.users(id),club_id uuid references public.clubs(id),role text not null,permissions text[] not null default '{}');
create table public.orders(id uuid primary key, club_id uuid not null, member_id uuid not null);
create table public.cash_sessions(id uuid primary key, club_id uuid not null, user_id uuid not null, status text not null default 'open',closed_at timestamptz);

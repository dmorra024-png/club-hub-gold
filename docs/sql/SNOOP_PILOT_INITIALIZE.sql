-- SNOOP PILOT - INIZIALIZZAZIONE COMPLETA
-- Generato dalle migrazioni del repository; eseguire UNA SOLA VOLTA.
-- Solo per il NUOVO progetto Supabase Snoop-pilot VUOTO.
-- Nessun utente, socio, club, password, token o chiave viene inserito.
-- Schema, funzioni, autorizzazioni RLS e bucket privato snoop-docs.
-- Un'unica transazione: in caso di errore non viene completata l'inizializzazione.
-- Il primo utente e il primo Super Admin si configurano successivamente.

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '0';
SET LOCAL search_path = public, extensions;
DO $snoop_preflight$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public')
    OR EXISTS(SELECT 1 FROM storage.buckets)
    OR EXISTS(SELECT 1 FROM auth.users)
 THEN RAISE EXCEPTION 'STOP SNOOP: progetto non vuoto o inizializzazione gia eseguita. Nessun dato esistente deve essere modificato.';
 END IF;
END;
$snoop_preflight$;

-- ====================================================================
-- 20260622212808_9302649a-e1ee-4a0a-80b1-229dba9e2d0d.sql
-- ====================================================================

-- ENUMS
CREATE TYPE public.app_role AS ENUM ('admin', 'collaborator', 'super_admin');
CREATE TYPE public.product_type AS ENUM ('per_gram', 'per_piece');
CREATE TYPE public.app_permission AS ENUM ('manage_members','manage_products','manage_collaborators','view_reports','use_cash');

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

-- USER ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  permissions public.app_permission[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _perm public.app_permission)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (role = 'admin' OR _perm = ANY(permissions))
  )
$$;

-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

-- MEMBERS
CREATE TABLE public.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_number TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  document_type TEXT,
  document_number TEXT,
  document_expiry DATE,
  birth_date DATE,
  photo_url TEXT,
  qr_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'),
  joined_at DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_at DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.members TO authenticated;
GRANT ALL ON public.members TO service_role;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

-- PRODUCTS
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type public.product_type NOT NULL DEFAULT 'per_gram',
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

-- SALES
CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  cashier_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

-- SALE ITEMS
CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  product_type public.product_type NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated;
GRANT ALL ON public.sale_items TO service_role;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER members_uat BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER products_uat BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Profile + first-user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count INT;
BEGIN
  INSERT INTO public.profiles(id, full_name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  SELECT count(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    INSERT INTO public.user_roles(user_id, role, permissions) VALUES (NEW.id, 'admin', ARRAY['manage_members','manage_products','manage_collaborators','view_reports','use_cash']::public.app_permission[]);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ====================================================================
-- 20260622212824_0052baf8-1cf4-48d4-9e61-63f546a2750b.sql
-- ====================================================================

CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, public.app_permission) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, public.app_permission) TO authenticated;


-- ====================================================================
-- 20260623061333_89570dac-2066-417c-9729-a549a8ed6eda.sql
-- ====================================================================

-- Membership plans (admin-defined)
CREATE TABLE public.membership_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  duration_days INT NOT NULL CHECK (duration_days > 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_plans TO authenticated;
GRANT ALL ON public.membership_plans TO service_role;

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;

-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

CREATE TRIGGER set_updated_at_plans BEFORE UPDATE ON public.membership_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Member subscriptions (history of quote)
CREATE TABLE public.member_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.membership_plans(id) ON DELETE SET NULL,
  plan_name TEXT NOT NULL,
  duration_days INT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_subscriptions TO authenticated;
GRANT ALL ON public.member_subscriptions TO service_role;

ALTER TABLE public.member_subscriptions ENABLE ROW LEVEL SECURITY;

-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

CREATE TRIGGER set_updated_at_subs BEFORE UPDATE ON public.member_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_member_subs_member ON public.member_subscriptions(member_id, end_date DESC);


-- ====================================================================
-- 20260624061600_74029b3c-2a22-4855-8d8b-9762445e7f5e.sql
-- ====================================================================

-- Reset: drop old tables (keep auth, profiles, user_roles intact)
DROP TABLE IF EXISTS public.sale_items CASCADE;
DROP TABLE IF EXISTS public.sales CASCADE;
DROP TABLE IF EXISTS public.member_subscriptions CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.members CASCADE;
DROP TABLE IF EXISTS public.membership_plans CASCADE;

-- Plans (fixed memberships)
CREATE TABLE public.membership_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  duration_days int NOT NULL CHECK (duration_days > 0),
  price_cents int NOT NULL CHECK (price_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_plans TO authenticated;
GRANT ALL ON public.membership_plans TO service_role;
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
CREATE TRIGGER tg_plans_updated BEFORE UPDATE ON public.membership_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Members
CREATE TABLE public.members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  birth_date date NOT NULL,
  city text,
  phone text,
  dni_number text NOT NULL,
  dni_photo_path text,
  plan_id uuid REFERENCES public.membership_plans(id) ON DELETE SET NULL,
  joined_at date NOT NULL DEFAULT current_date,
  expires_at date NOT NULL,
  signature_path text,
  contract_signed_at timestamptz,
  contract_version text NOT NULL DEFAULT 'v1-es-2025',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX members_name_idx ON public.members (last_name, first_name);
CREATE INDEX members_dni_idx ON public.members (dni_number);
CREATE INDEX members_expires_idx ON public.members (expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.members TO authenticated;
GRANT ALL ON public.members TO service_role;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
CREATE TRIGGER tg_members_updated BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Nessuna quota precompilata: verra creata nel club corretto.


-- ====================================================================
-- 20260624061627_044429fc-7051-4e88-b5d5-68cd0466f464.sql
-- ====================================================================

-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.


-- ====================================================================
-- 20260626072407_b6c0b500-b5c1-4d0d-b871-094f0fa3ed1d.sql
-- ====================================================================

CREATE SEQUENCE IF NOT EXISTS public.member_number_seq START 1 MINVALUE 1;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS member_number text;

UPDATE public.members
SET member_number = lpad(nextval('public.member_number_seq')::text, 7, '0')
WHERE member_number IS NULL;

CREATE OR REPLACE FUNCTION public.tg_assign_member_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.member_number IS NULL OR NEW.member_number = '' THEN
    NEW.member_number := lpad(nextval('public.member_number_seq')::text, 7, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS assign_member_number ON public.members;
CREATE TRIGGER assign_member_number
BEFORE INSERT ON public.members
FOR EACH ROW EXECUTE FUNCTION public.tg_assign_member_number();

ALTER TABLE public.members ALTER COLUMN member_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_member_number_key ON public.members(member_number);

-- Keep sequence ahead of any pre-existing values
SELECT setval('public.member_number_seq', GREATEST((SELECT COALESCE(MAX(member_number::int), 0) FROM public.members), 1));


-- ====================================================================
-- 20260626072419_e512dd49-f1a2-4c08-8d6c-f46c8be80013.sql
-- ====================================================================

ALTER TABLE public.members
  ALTER COLUMN member_number SET DEFAULT lpad(nextval('public.member_number_seq')::text, 7, '0');


-- ====================================================================
-- 20260627064132_email_infra.sql
-- ====================================================================
-- Email infrastructure
-- Creates the queue system, send log, send state, suppression, and unsubscribe
-- tables used by both auth and transactional emails.

-- Extensions required for queue processing
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create email queues (auth = high priority, transactional = normal)
-- Wrapped in DO blocks to handle "queue already exists" errors idempotently.
DO $$ BEGIN PERFORM pgmq.create('auth_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Dead-letter queues for messages that exceed max retries
DO $$ BEGIN PERFORM pgmq.create('auth_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Email send log table (audit trail for all send attempts)
-- UPDATE is allowed for the service role so the suppression edge function
-- can update a log record's status when a bounce/complaint/unsubscribe occurs.
CREATE TABLE IF NOT EXISTS public.email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT,
  template_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq')),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supabase no longer grants public-schema access to service_role by default;
-- emit the grant explicitly so edge functions can reach the table via PostgREST.
GRANT ALL ON public.email_send_log TO service_role;

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_send_log_created ON public.email_send_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_send_log_recipient ON public.email_send_log(recipient_email);

-- Backfill: add message_id column to existing tables that predate this migration
DO $$ BEGIN
  ALTER TABLE public.email_send_log ADD COLUMN message_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_send_log_message ON public.email_send_log(message_id);

-- Prevent duplicate sends: only one 'sent' row per message_id.
-- If VT expires and another worker picks up the same message, the pre-send
-- check catches it. This index is a DB-level safety net for race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_message_sent_unique
  ON public.email_send_log(message_id) WHERE status = 'sent';

-- Backfill: update status CHECK constraint for existing tables that predate new statuses
DO $$ BEGIN
  ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
  ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check
    CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq'));
END $$;

-- Rate-limit state and queue config (single row, tracks Retry-After cooldown + throughput settings)
CREATE TABLE IF NOT EXISTS public.email_send_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  retry_after_until TIMESTAMPTZ,
  batch_size INTEGER NOT NULL DEFAULT 10,
  send_delay_ms INTEGER NOT NULL DEFAULT 200,
  auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 15,
  transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.email_send_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Backfill: add config columns to existing tables that predate this migration
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 10;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN send_delay_ms INTEGER NOT NULL DEFAULT 200;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 15;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 60;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

GRANT ALL ON public.email_send_state TO service_role;

ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RPC wrappers so Edge Functions can interact with pgmq via supabase.rpc()
-- (PostgREST only exposes functions in the public schema; pgmq functions are in the pgmq schema)
-- All wrappers auto-create the queue on undefined_table (42P01) so emails
-- are never lost if the queue was dropped (extension upgrade, restore, etc.).
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name TEXT, payload JSONB)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name TEXT, batch_size INT, vt INT)
RETURNS TABLE(msg_id BIGINT, read_ct INT, message JSONB)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name TEXT, message_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(
  source_queue TEXT, dlq_name TEXT, message_id BIGINT, payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$$;

-- Restrict queue RPC wrappers to service_role only (SECURITY DEFINER runs as owner,
-- so without this any authenticated user could manipulate the email queues)
REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) TO service_role;

-- Suppressed emails table (tracks unsubscribes, bounces, complaints)
-- Append-only: no DELETE or UPDATE policies to prevent bypassing suppression.
CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe', 'bounce', 'complaint')),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email)
);

GRANT ALL ON public.suppressed_emails TO service_role;

ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_suppressed_emails_email ON public.suppressed_emails(email);

-- Email unsubscribe tokens table (one token per email address for unsubscribe links)
-- No DELETE policy to prevent removing tokens. UPDATE allowed only to mark tokens as used.
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);

GRANT ALL ON public.email_unsubscribe_tokens TO service_role;

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens(token);

-- ============================================================
-- POST-MIGRATION STEPS (applied dynamically by setup_email_infra)
-- These steps contain project-specific secrets and URLs and
-- cannot be expressed as static SQL. They are applied via the
-- Supabase Management API (ExecuteSQL) each time the tool runs.
-- ============================================================
--
-- 1. VAULT SECRET
--    Stores (or updates) the Supabase service_role key in
--    vault as 'email_queue_service_role_key'.
--    Uses vault.create_secret / vault.update_secret (upsert).
--    To revert: DELETE FROM vault.secrets WHERE name = 'email_queue_service_role_key';
--
-- 2. CRON JOB (pg_cron)
--    Creates job 'process-email-queue' with a 5-second interval.
--    The job checks:
--      a) rate-limit cooldown (email_send_state.retry_after_until)
--      b) whether auth_emails or transactional_emails queues have messages
--    If conditions are met, it calls the process-email-queue Edge Function
--    via net.http_post using the vault-stored service_role key.
--    To revert: SELECT cron.unschedule('process-email-queue');


-- ====================================================================
-- 20260627064457_c59af0f1-7d12-4176-b41e-a820f08eb437.sql
-- ====================================================================
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS email TEXT;

-- ====================================================================
-- 20260628083024_c4245510-5fd8-422e-9b6a-e3de854dc3c1.sql
-- ====================================================================

-- Enum for unit type
DO $$ BEGIN
  CREATE TYPE public.product_unit AS ENUM ('gr', 'unit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enum for strain
DO $$ BEGIN
  CREATE TYPE public.strain_type AS ENUM ('indica', 'sativa', 'hibrida');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Categories
CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  unit_type public.product_unit NOT NULL DEFAULT 'unit',
  is_smokeable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

CREATE TRIGGER tg_product_categories_updated_at BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Products
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.product_categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  stock numeric(12,3) NOT NULL DEFAULT 0,
  buy_price numeric(10,2) NOT NULL DEFAULT 0,
  sell_price numeric(10,2) NOT NULL DEFAULT 0,
  strain public.strain_type,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

CREATE INDEX IF NOT EXISTS products_category_idx ON public.products(category_id);

CREATE TRIGGER tg_products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


-- ====================================================================
-- 20260629061712_98e4c829-3039-42e2-995b-cceba103a6d5.sql
-- ====================================================================

CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  total_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
CREATE TRIGGER orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  quantity NUMERIC(10,3) NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

CREATE OR REPLACE FUNCTION public.create_order_with_items(
  _member_id UUID,
  _notes TEXT,
  _items JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_order_id UUID;
  item JSONB;
  total INT := 0;
  pid UUID;
  qty NUMERIC;
  current_stock NUMERIC;
  line_total INT;
BEGIN
  INSERT INTO public.orders(member_id, notes, total_cents, created_by)
    VALUES (_member_id, _notes, 0, auth.uid())
    RETURNING id INTO new_order_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    pid := NULLIF(item->>'product_id','')::UUID;
    qty := (item->>'quantity')::NUMERIC;
    line_total := (item->>'line_total_cents')::INT;

    IF pid IS NOT NULL THEN
      SELECT stock INTO current_stock FROM public.products WHERE id = pid FOR UPDATE;
      IF current_stock IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado';
      END IF;
      IF current_stock < qty THEN
        RAISE EXCEPTION 'Stock insuficiente para %', item->>'product_name';
      END IF;
      UPDATE public.products SET stock = stock - qty WHERE id = pid;
    END IF;

    INSERT INTO public.order_items(order_id, product_id, product_name, unit_type, quantity, unit_price_cents, line_total_cents)
      VALUES (new_order_id, pid, item->>'product_name', item->>'unit_type', qty, (item->>'unit_price_cents')::INT, line_total);

    total := total + line_total;
  END LOOP;

  UPDATE public.orders SET total_cents = total WHERE id = new_order_id;
  RETURN new_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(UUID, TEXT, JSONB) TO authenticated;


-- ====================================================================
-- 20260630065129_569c0ad0-f0e7-4d7e-80db-ab34eab5ab83.sql
-- ====================================================================
CREATE OR REPLACE FUNCTION public.create_order_with_items(_member_id uuid, _notes text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_order_id UUID;
  item JSONB;
  total INT := 0;
  pid UUID;
  qty NUMERIC;
  merma NUMERIC;
  stock_delta NUMERIC;
  current_stock NUMERIC;
  line_total INT;
BEGIN
  INSERT INTO public.orders(member_id, notes, total_cents, created_by)
    VALUES (_member_id, _notes, 0, auth.uid())
    RETURNING id INTO new_order_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    pid := NULLIF(item->>'product_id','')::UUID;
    qty := (item->>'quantity')::NUMERIC;
    merma := COALESCE(NULLIF(item->>'merma','')::NUMERIC, 0);
    stock_delta := qty + merma;
    line_total := (item->>'line_total_cents')::INT;

    IF pid IS NOT NULL THEN
      SELECT stock INTO current_stock FROM public.products WHERE id = pid FOR UPDATE;
      IF current_stock IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado';
      END IF;
      IF current_stock < stock_delta THEN
        RAISE EXCEPTION 'Stock insuficiente para %', item->>'product_name';
      END IF;
      UPDATE public.products SET stock = stock - stock_delta WHERE id = pid;
    END IF;

    INSERT INTO public.order_items(order_id, product_id, product_name, unit_type, quantity, unit_price_cents, line_total_cents)
      VALUES (new_order_id, pid, item->>'product_name', item->>'unit_type', qty, (item->>'unit_price_cents')::INT, line_total);

    total := total + line_total;
  END LOOP;

  UPDATE public.orders SET total_cents = total WHERE id = new_order_id;
  RETURN new_order_id;
END;
$function$;

-- ====================================================================
-- 20260630073314_0da8ce97-94dc-4b1f-b1e6-4b789013b5b7.sql
-- ====================================================================
-- super_admin gia incluso nella definizione iniziale di app_role.


-- ====================================================================
-- 20260630073402_bbb8e018-16f8-416a-9711-988fd1fcf86d.sql
-- ====================================================================

-- clubs table
CREATE TABLE IF NOT EXISTS public.clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  city TEXT,
  logo_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  next_member_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clubs TO authenticated;
GRANT ALL ON public.clubs TO service_role;

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS tg_clubs_updated_at ON public.clubs;
CREATE TRIGGER tg_clubs_updated_at BEFORE UPDATE ON public.clubs FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Nessun club storico viene copiato nel nuovo progetto.

-- Add club_id columns
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.membership_plans ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;

-- Database vuoto: nessun backfill di dati o ruoli storici.
ALTER TABLE public.members ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.membership_plans ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.product_categories ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN club_id SET NOT NULL;

-- Helpers
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.current_club_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT club_id FROM public.user_roles
  WHERE user_id = auth.uid() AND role <> 'super_admin' AND club_id IS NOT NULL
  ORDER BY (role='admin') DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.user_has_club_access(_club_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND club_id = _club_id)
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_club_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_club_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_club_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_club_access(UUID) TO authenticated, service_role;

-- RLS on clubs
DROP POLICY IF EXISTS "clubs_select" ON public.clubs;
-- Historical policy omitted; final policies are installed below.
DROP POLICY IF EXISTS "clubs_insert_super" ON public.clubs;
-- Historical policy omitted; final policies are installed below.
DROP POLICY IF EXISTS "clubs_update_super" ON public.clubs;
-- Historical policy omitted; final policies are installed below.
DROP POLICY IF EXISTS "clubs_delete_super" ON public.clubs;
-- Historical policy omitted; final policies are installed below.

-- Drop existing policies on tenant tables
DO $$
DECLARE t TEXT; pol RECORD;
BEGIN
  FOR t IN SELECT unnest(ARRAY['members','membership_plans','products','product_categories','orders','order_items','user_roles']) LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Per-club member numbering
CREATE OR REPLACE FUNCTION public.tg_assign_member_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n INT;
BEGIN
  IF NEW.club_id IS NULL THEN RAISE EXCEPTION 'club_id required for member'; END IF;
  IF NEW.member_number IS NULL OR NEW.member_number = '' THEN
    UPDATE public.clubs SET next_member_number = next_member_number + 1
      WHERE id = NEW.club_id RETURNING next_member_number - 1 INTO n;
    NEW.member_number := lpad(n::text, 7, '0');
  END IF;
  RETURN NEW;
END $$;

-- handle_new_user: first ever user becomes super_admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count INT;
BEGIN
  INSERT INTO public.profiles(id, full_name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  SELECT count(*) INTO user_count FROM public.user_roles WHERE role='super_admin';
  IF user_count = 0 THEN
    INSERT INTO public.user_roles(user_id, role, permissions, club_id)
    VALUES (NEW.id, 'super_admin', ARRAY['manage_members','manage_products','manage_collaborators','view_reports','use_cash']::public.app_permission[], NULL);
  END IF;
  RETURN NEW;
END $$;

-- create_order_with_items with club_id
CREATE OR REPLACE FUNCTION public.create_order_with_items(_member_id uuid, _notes text, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_order_id UUID; item JSONB; total INT := 0; pid UUID; qty NUMERIC; merma NUMERIC; stock_delta NUMERIC; current_stock NUMERIC; line_total INT; _club UUID;
BEGIN
  SELECT club_id INTO _club FROM public.members WHERE id = _member_id;
  IF _club IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;

  INSERT INTO public.orders(member_id, notes, total_cents, created_by, club_id)
    VALUES (_member_id, _notes, 0, auth.uid(), _club)
    RETURNING id INTO new_order_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    pid := NULLIF(item->>'product_id','')::UUID;
    qty := (item->>'quantity')::NUMERIC;
    merma := COALESCE(NULLIF(item->>'merma','')::NUMERIC, 0);
    stock_delta := qty + merma;
    line_total := (item->>'line_total_cents')::INT;
    IF pid IS NOT NULL THEN
      SELECT stock INTO current_stock FROM public.products WHERE id = pid FOR UPDATE;
      IF current_stock IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
      IF current_stock < stock_delta THEN RAISE EXCEPTION 'Stock insuficiente para %', item->>'product_name'; END IF;
      UPDATE public.products SET stock = stock - stock_delta WHERE id = pid;
    END IF;
    INSERT INTO public.order_items(order_id, product_id, product_name, unit_type, quantity, unit_price_cents, line_total_cents, club_id)
      VALUES (new_order_id, pid, item->>'product_name', item->>'unit_type', qty, (item->>'unit_price_cents')::INT, line_total, _club);
    total := total + line_total;
  END LOOP;

  UPDATE public.orders SET total_cents = total WHERE id = new_order_id;
  RETURN new_order_id;
END;
$$;


-- ====================================================================
-- 20260630210948_9dc15ff3-7d6c-4147-9d0a-93a357f75814.sql
-- ====================================================================

CREATE TABLE public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash_cents integer not null default 0,
  closing_cash_cents integer,
  notes text,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_sessions TO authenticated;
GRANT ALL ON public.cash_sessions TO service_role;

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

CREATE TRIGGER cash_sessions_updated BEFORE UPDATE ON public.cash_sessions
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE UNIQUE INDEX cash_sessions_one_open_per_user
  ON public.cash_sessions(user_id, club_id) WHERE status = 'open';

CREATE INDEX cash_sessions_club_opened_idx ON public.cash_sessions(club_id, opened_at DESC);

ALTER TABLE public.orders ADD COLUMN cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL;
CREATE INDEX orders_cash_session_idx ON public.orders(cash_session_id);

CREATE OR REPLACE FUNCTION public.current_open_cash_session()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.cash_sessions
  WHERE user_id = auth.uid() AND status = 'open'
    AND club_id = public.current_club_id()
  ORDER BY opened_at DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.tg_orders_assign_cash_session()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cash_session_id IS NULL THEN
    SELECT id INTO NEW.cash_session_id FROM public.cash_sessions
    WHERE user_id = COALESCE(NEW.created_by, auth.uid())
      AND club_id = NEW.club_id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orders_assign_cash_session BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.tg_orders_assign_cash_session();


-- ====================================================================
-- 20260630212015_6436e01d-6fe6-48bb-b9f2-d58a03625afb.sql
-- ====================================================================

CREATE TABLE public.club_member_field_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_id, field_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_member_field_config TO authenticated;
GRANT ALL ON public.club_member_field_config TO service_role;

ALTER TABLE public.club_member_field_config ENABLE ROW LEVEL SECURITY;

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

CREATE TRIGGER trg_club_member_field_config_updated
  BEFORE UPDATE ON public.club_member_field_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Add address + postal_code columns to members (optional fields)
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT;


-- ====================================================================
-- 20260630214014_0e174034-b136-447a-a0aa-c6d1372eb4f6.sql
-- ====================================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS description text;

-- ====================================================================
-- 20260630221131_fcdbc9fb-6721-4a34-9d5b-caaa6402838c.sql
-- ====================================================================
UPDATE public.clubs SET name = 'Medusa 23' WHERE id = 'f4b9ae4d-44c6-4b4f-8d78-cf4b3aaf49cc';

-- ====================================================================
-- 20260701080938_3ce0dbb4-f7fc-4744-903f-f6f3fd5c4101.sql
-- ====================================================================

CREATE TABLE public.stock_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  delta NUMERIC NOT NULL,
  reason TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_club_created_idx ON public.stock_movements(club_id, created_at DESC);
CREATE INDEX stock_movements_product_idx ON public.stock_movements(product_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.


-- ====================================================================
-- 20260701082156_1fde76e1-594b-4d93-95b5-c603d878945f.sql
-- ====================================================================
CREATE OR REPLACE FUNCTION public.create_order_with_items(_member_id uuid, _notes text, _items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_order_id UUID;
  item JSONB;
  total INT := 0;
  pid UUID;
  qty NUMERIC;
  merma NUMERIC;
  stock_delta NUMERIC;
  current_stock NUMERIC;
  line_total INT;
  _club UUID;
BEGIN
  SELECT club_id INTO _club FROM public.members WHERE id = _member_id;
  IF _club IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;

  INSERT INTO public.orders(member_id, notes, total_cents, created_by, club_id)
    VALUES (_member_id, _notes, 0, auth.uid(), _club)
    RETURNING id INTO new_order_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    pid := NULLIF(item->>'product_id','')::UUID;
    qty := (item->>'quantity')::NUMERIC;
    merma := COALESCE(NULLIF(item->>'merma','')::NUMERIC, 0);
    stock_delta := qty + merma;
    line_total := (item->>'line_total_cents')::INT;

    IF pid IS NOT NULL THEN
      SELECT stock INTO current_stock FROM public.products WHERE id = pid FOR UPDATE;
      IF current_stock IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
      IF current_stock < stock_delta THEN RAISE EXCEPTION 'Stock insuficiente para %', item->>'product_name'; END IF;

      UPDATE public.products SET stock = stock - stock_delta WHERE id = pid;

      INSERT INTO public.stock_movements(club_id, product_id, delta, reason, notes, created_by)
      VALUES (
        _club,
        pid,
        -stock_delta,
        'sale',
        concat('Venta pedido ', new_order_id::text, ' · ', item->>'product_name'),
        auth.uid()
      );
    END IF;

    INSERT INTO public.order_items(order_id, product_id, product_name, unit_type, quantity, unit_price_cents, line_total_cents, club_id)
      VALUES (new_order_id, pid, item->>'product_name', item->>'unit_type', qty, (item->>'unit_price_cents')::INT, line_total, _club);
    total := total + line_total;
  END LOOP;

  UPDATE public.orders SET total_cents = total WHERE id = new_order_id;
  RETURN new_order_id;
END;
$function$;

-- ====================================================================
-- 20260711082655_5798e506-84c4-404d-ae58-90fba8bc8f11.sql
-- ====================================================================
-- Allow anonymous read of active clubs' public branding for the /{slug} login page
-- Historical policy omitted; final policies are installed below.

GRANT SELECT ON public.clubs TO anon;

-- ====================================================================
-- 20260713071722_ec22b55d-515e-44df-9d8c-42d7e0ed8a29.sql
-- ====================================================================

CREATE TABLE public.check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  scanned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.check_ins TO authenticated;
GRANT ALL ON public.check_ins TO service_role;

ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;

-- Historical policy omitted; final policies are installed below.

-- Historical policy omitted; final policies are installed below.

CREATE INDEX check_ins_club_created_idx ON public.check_ins (club_id, created_at DESC);
CREATE INDEX check_ins_member_created_idx ON public.check_ins (member_id, created_at DESC);


-- ====================================================================
-- 20261105103000_secure_account_access.sql
-- ====================================================================
-- Account security only. No existing users, memberships or application data
-- are deleted or rewritten. Apply to a test project before production review.

-- Membership changes must go through authenticated, club-scoped server handlers.
-- Existing policies allowed club admins to change privileged account rows via
-- direct PostgREST requests, bypassing the application's checks.
REVOKE ALL ON public.user_roles FROM anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
DROP POLICY IF EXISTS user_roles_insert ON public.user_roles;
DROP POLICY IF EXISTS user_roles_update ON public.user_roles;
DROP POLICY IF EXISTS user_roles_delete ON public.user_roles;
DROP POLICY IF EXISTS user_roles_admin_all ON public.user_roles;
DROP POLICY IF EXISTS user_roles_self_read ON public.user_roles;
DROP POLICY IF EXISTS user_roles_select ON public.user_roles;

CREATE OR REPLACE FUNCTION public.is_current_user_club_admin(_club_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND club_id = _club_id AND role = 'admin'
  )
$$;
REVOKE ALL ON FUNCTION public.is_current_user_club_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_club_admin(UUID) TO authenticated, service_role;

-- Historical policy omitted; final policies are installed below.

-- Profiles are personal data, not a global authenticated-user directory.
REVOKE ALL ON public.profiles FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated;
CREATE OR REPLACE FUNCTION public.can_read_profile(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _user_id = auth.uid() OR public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles AS caller
    JOIN public.user_roles AS target ON target.club_id = caller.club_id
    WHERE caller.user_id = auth.uid() AND target.user_id = _user_id
  )
$$;
REVOKE ALL ON FUNCTION public.can_read_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_profile(UUID) TO authenticated, service_role;
DROP POLICY IF EXISTS profiles_read_auth ON public.profiles;
-- Historical policy omitted; final policies are installed below.

-- Never grant super-admin to a public signup merely because the last admin
-- was removed or an installation has not been bootstrapped yet. Provision the
-- first super-admin explicitly through a trusted, reviewed database operation.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END
$$;



-- ====================================================================
-- 20261105113000_member_administration_scope.sql
-- ====================================================================
-- Administrative membership data only. Existing records are preserved.

CREATE OR REPLACE FUNCTION public.can_manage_club_members(_club_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND club_id = _club_id
      AND (role = 'admin' OR 'manage_members' = ANY(permissions))
  )
$$;
REVOKE ALL ON FUNCTION public.can_manage_club_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_club_members(UUID) TO authenticated, service_role;

REVOKE ALL ON public.members FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.members FROM authenticated;
DROP POLICY IF EXISTS members_all ON public.members;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.

-- A valid plan UUID alone is not enough: it must belong to the member's club.
CREATE UNIQUE INDEX IF NOT EXISTS membership_plans_id_club_key ON public.membership_plans(id, club_id);
ALTER TABLE public.members ADD CONSTRAINT members_plan_same_club
  FOREIGN KEY (plan_id, club_id) REFERENCES public.membership_plans(id, club_id) NOT VALID;
-- NOT VALID preserves historical rows; new inserts/key changes are checked.


-- ====================================================================
-- 20261105150000_administrative_cash_validation.sql
-- ====================================================================
-- Preserve historical rows; enforce valid amounts on new writes only.
ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_opening_nonnegative
  CHECK (opening_cash_cents >= 0) NOT VALID;
ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_closing_nonnegative
  CHECK (closing_cash_cents IS NULL OR closing_cash_cents >= 0) NOT VALID;

DROP POLICY IF EXISTS cash_sessions_insert ON public.cash_sessions;
-- Historical policy omitted; final policies are installed below.
DROP POLICY IF EXISTS cash_sessions_update ON public.cash_sessions;
-- Historical policy omitted; final policies are installed below.


-- ====================================================================
-- 20261105170000_membership_receipts.sql
-- ====================================================================
-- Independent association receipts; no dependency on orders, sales or stock.
CREATE TABLE public.membership_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  member_number text NOT NULL,
  member_name text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operator_name text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash','card','transfer','other')),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 240),
  request_id uuid NOT NULL,
  UNIQUE (club_id, request_id)
);
CREATE INDEX membership_receipts_club_date ON public.membership_receipts(club_id, recorded_at DESC, id);
ALTER TABLE public.membership_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_receipts FROM anon, authenticated;
GRANT SELECT ON public.membership_receipts TO authenticated;
GRANT ALL ON public.membership_receipts TO service_role;

CREATE FUNCTION public.can_read_membership_receipts(target_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT auth.uid() IS NOT NULL AND (public.is_super_admin(auth.uid()) OR EXISTS (
   SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.club_id = target_club
     AND target_club = public.current_club_id()
     AND (r.role = 'admin' OR r.permissions && ARRAY['use_cash','view_reports']::public.app_permission[])
 ));
$$;
REVOKE ALL ON FUNCTION public.can_read_membership_receipts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_membership_receipts(uuid) TO authenticated;
-- Historical policy omitted; final policies are installed below.

CREATE FUNCTION public.record_membership_receipt(
 p_club_id uuid, p_member_id uuid, p_amount_cents integer,
 p_payment_method text, p_description text, p_request_id uuid
) RETURNS public.membership_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE receipt public.membership_receipts; m public.members; operator_label text;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_super_admin(auth.uid()) OR EXISTS (
   SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.club_id = p_club_id
    AND p_club_id = public.current_club_id() AND (r.role = 'admin' OR 'use_cash' = ANY(r.permissions))
 )) THEN RAISE EXCEPTION 'No tienes permiso para registrar ingresos en este club' USING ERRCODE = '42501'; END IF;
 IF p_request_id IS NULL OR p_amount_cents IS NULL OR p_amount_cents <= 0
   OR p_payment_method IS NULL OR p_payment_method NOT IN ('cash','card','transfer','other')
   OR p_description IS NULL OR length(trim(p_description)) NOT BETWEEN 1 AND 240
 THEN RAISE EXCEPTION 'Datos del recibo no válidos' USING ERRCODE = '22023'; END IF;
 SELECT * INTO m FROM public.members WHERE id = p_member_id AND club_id = p_club_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Socio no disponible en este club' USING ERRCODE = '22023'; END IF;
 SELECT coalesce(nullif(trim(full_name),''), 'Operador') INTO operator_label FROM public.profiles WHERE id = auth.uid();
 INSERT INTO public.membership_receipts(club_id,member_id,member_number,member_name,recorded_by,operator_name,amount_cents,payment_method,description,request_id)
 VALUES(p_club_id,m.id,m.member_number,concat_ws(' ',m.first_name,m.last_name),auth.uid(),coalesce(operator_label,'Operador'),p_amount_cents,p_payment_method,trim(p_description),p_request_id)
 ON CONFLICT (club_id,request_id) DO NOTHING RETURNING * INTO receipt;
 IF receipt.id IS NULL THEN
   SELECT * INTO receipt FROM public.membership_receipts WHERE club_id = p_club_id AND request_id = p_request_id;
   IF receipt.member_id <> p_member_id OR receipt.amount_cents <> p_amount_cents OR receipt.payment_method <> p_payment_method
     OR receipt.description <> trim(p_description) OR receipt.recorded_by <> auth.uid()
   THEN RAISE EXCEPTION 'Solicitud repetida con datos distintos' USING ERRCODE = '22023'; END IF;
 END IF;
 RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.record_membership_receipt(uuid,uuid,integer,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_membership_receipt(uuid,uuid,integer,text,text,uuid) TO authenticated;

CREATE FUNCTION public.membership_receipt_report(p_club_id uuid, p_from date, p_to date, p_group text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.can_read_membership_receipts(p_club_id) THEN RAISE EXCEPTION 'No tienes permiso para consultar este club' USING ERRCODE = '42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > 3660 OR p_group IS NULL OR p_group NOT IN ('day','month')
 THEN RAISE EXCEPTION 'Periodo no válido' USING ERRCODE = '22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(summary)), '[]'::jsonb) INTO result FROM (SELECT
   to_char(r.recorded_at AT TIME ZONE 'Europe/Madrid', CASE WHEN p_group = 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS period,
   r.payment_method, count(*) AS receipts, sum(r.amount_cents)::bigint AS total_cents
 FROM public.membership_receipts r
 WHERE r.club_id = p_club_id
   AND r.recorded_at >= (p_from::timestamp AT TIME ZONE 'Europe/Madrid')
   AND r.recorded_at < (p_to::timestamp AT TIME ZONE 'Europe/Madrid')
 GROUP BY 1,2 ORDER BY 1 DESC,2) summary;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.membership_receipt_report(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.membership_receipt_report(uuid,date,date,text) TO authenticated;


-- ====================================================================
-- 20261105200000_administrative_catalog_scope.sql
-- ====================================================================
-- Administrative catalogs/resources only; existing data and order functions retained.
CREATE FUNCTION public.can_manage_snoop_catalog(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND (public.is_super_admin(auth.uid()) OR EXISTS (
 SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.club_id=target
 AND target=public.current_club_id() AND (r.role='admin' OR 'manage_products'=ANY(r.permissions))));
$$;
REVOKE ALL ON FUNCTION public.can_manage_snoop_catalog(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_snoop_catalog(uuid) TO authenticated;
DROP POLICY IF EXISTS products_all ON public.products;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
DROP POLICY IF EXISTS categories_all ON public.product_categories;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
DROP POLICY IF EXISTS plans_all ON public.membership_plans;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
REVOKE TRUNCATE,REFERENCES,TRIGGER ON public.products,public.product_categories,public.membership_plans,public.stock_movements FROM authenticated;
DROP POLICY IF EXISTS "Club members can insert stock movements" ON public.stock_movements;
-- Historical policy omitted; final policies are installed below.

CREATE FUNCTION public.save_administrative_product(p_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c uuid; old_stock numeric; new_stock numeric; pid uuid; category uuid; label text; buy integer; sell integer;
BEGIN
 IF p_id IS NULL THEN c:=public.current_club_id(); old_stock:=0;
 ELSE SELECT club_id,stock INTO c,old_stock FROM public.products WHERE id=p_id FOR UPDATE; END IF;
 IF c IS NULL OR NOT public.can_manage_snoop_catalog(c) THEN RAISE EXCEPTION 'Catálogo no autorizado' USING ERRCODE='42501'; END IF;
 label:=trim(p_values->>'name'); category:=(p_values->>'category_id')::uuid;
 new_stock:=(p_values->>'stock')::numeric; buy:=(p_values->>'buy_price')::integer; sell:=(p_values->>'sell_price')::integer;
 IF label IS NULL OR length(label) NOT BETWEEN 1 AND 120 OR new_stock IS NULL OR new_stock<0 OR new_stock>99999999.99 OR new_stock<>round(new_stock,2)
 OR buy IS NULL OR buy<0 OR sell IS NULL OR sell<0 THEN RAISE EXCEPTION 'Datos de catálogo no válidos' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.product_categories WHERE id=category AND club_id=c) THEN RAISE EXCEPTION 'Categoría de otro club o inexistente' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL THEN
 INSERT INTO public.products(club_id,category_id,name,stock,buy_price,sell_price,strain,notes)
 VALUES(c,category,label,new_stock,buy,sell,nullif(p_values->>'strain','')::public.strain_type,p_values->>'notes') RETURNING id INTO pid;
 ELSE
 UPDATE public.products SET category_id=category,name=label,stock=new_stock,buy_price=buy,sell_price=sell,strain=nullif(p_values->>'strain','')::public.strain_type,notes=p_values->>'notes' WHERE id=p_id RETURNING id INTO pid;
 END IF;
 IF new_stock<>old_stock THEN
 INSERT INTO public.stock_movements(club_id,product_id,delta,reason,notes,created_by)
 VALUES(c,pid,new_stock-old_stock,CASE WHEN p_id IS NULL THEN 'initial_stock' ELSE 'administrative_edit' END,'Ajuste administrativo',auth.uid());
 END IF;
 RETURN pid;
END;
$$;
REVOKE ALL ON FUNCTION public.save_administrative_product(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_administrative_product(uuid,jsonb) TO authenticated;

CREATE FUNCTION public.adjust_administrative_stock(p_id uuid,p_delta numeric,p_expected numeric,p_notes text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c uuid; before_stock numeric; after_stock numeric;
BEGIN
 SELECT club_id,stock INTO c,before_stock FROM public.products WHERE id=p_id FOR UPDATE;
 IF c IS NULL OR NOT public.can_manage_snoop_catalog(c) THEN RAISE EXCEPTION 'Inventario no autorizado' USING ERRCODE='42501'; END IF;
 IF before_stock IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Stock modificado por otro operador: recarga y confirma de nuevo' USING ERRCODE='40001'; END IF;
 IF p_delta IS NULL OR p_delta=0 OR abs(p_delta)>1000000 OR p_delta<>round(p_delta,2) THEN RAISE EXCEPTION 'Cantidad no válida' USING ERRCODE='22023'; END IF;
 after_stock:=before_stock+p_delta;
 IF after_stock<0 OR after_stock>99999999.99 THEN RAISE EXCEPTION 'Stock no válido' USING ERRCODE='22023'; END IF;
 UPDATE public.products SET stock=after_stock WHERE id=p_id;
 INSERT INTO public.stock_movements(club_id,product_id,delta,reason,notes,created_by)
 VALUES(c,p_id,p_delta,'administrative_adjustment',left(p_notes,1000),auth.uid());
 RETURN after_stock;
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_administrative_stock(uuid,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.adjust_administrative_stock(uuid,numeric,numeric,text) TO authenticated;


-- ====================================================================
-- 20261105210000_private_member_documents.sql
-- ====================================================================
-- Preserve every existing object; scope old and new document paths to the club.
CREATE FUNCTION public.can_access_snoop_document(object_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE target uuid; fragment text;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 IF public.is_super_admin(auth.uid()) THEN RETURN true; END IF;
 IF split_part(object_path,'/',1)='clubs' AND split_part(object_path,'/',3)='members' THEN
   fragment:=split_part(object_path,'/',2);
   IF fragment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN false; END IF;
   target:=fragment::uuid;
 ELSIF split_part(object_path,'/',1)='members' THEN
   SELECT club_id INTO target FROM public.members WHERE id::text=split_part(object_path,'/',2);
 ELSE
   -- Older records can contain a different stored filename: resolve its owner,
   -- rather than opening the entire bucket or rewriting historical paths.
   SELECT CASE WHEN count(DISTINCT club_id)=1 THEN min(club_id::text)::uuid ELSE NULL END INTO target FROM public.members WHERE dni_photo_path=object_path OR signature_path=object_path;
 END IF;
 RETURN target IS NOT NULL AND (public.is_super_admin(auth.uid()) OR (target=public.current_club_id() AND public.can_manage_club_members(target)));
END;
$$;
REVOKE ALL ON FUNCTION public.can_access_snoop_document(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_access_snoop_document(text) TO authenticated;
DROP POLICY IF EXISTS "auth read snoop-docs" ON storage.objects;
DROP POLICY IF EXISTS "auth insert snoop-docs" ON storage.objects;
DROP POLICY IF EXISTS "auth update snoop-docs" ON storage.objects;
DROP POLICY IF EXISTS "auth delete snoop-docs" ON storage.objects;
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.
-- Historical policy omitted; final policies are installed below.


-- ====================================================================
-- 20261106100000_authoritative_rls.sql
-- ====================================================================
-- Authoritative SNOOP policy set. No records/accounts are removed or changed.
-- PostgreSQL permissive policies are OR-ed: remove ALL previous public policies.
DO $cleanup$
DECLARE p record;
BEGIN
 FOR p IN SELECT * FROM pg_policies WHERE schemaname='public'
 OR (schemaname='storage' AND tablename='objects' AND (policyname LIKE '%snoop-docs%' OR policyname LIKE 'snoop_documents_%')) LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',p.policyname,p.schemaname,p.tablename);
 END LOOP;
END $cleanup$;

CREATE POLICY "cash_sessions_insert" ON public.cash_sessions FOR INSERT TO "authenticated" WITH CHECK (((user_id = auth.uid()) AND (club_id = current_club_id()) AND (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = cash_sessions.club_id) AND ((r.role = 'admin'::app_role) OR ('use_cash'::app_permission = ANY (r.permissions))))))));
CREATE POLICY "cash_sessions_select" ON public.cash_sessions FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR ((club_id = current_club_id()) AND ((user_id = auth.uid()) OR is_current_user_club_admin(club_id)))));
CREATE POLICY "cash_sessions_update" ON public.cash_sessions FOR UPDATE TO "authenticated" USING ((is_super_admin(auth.uid()) OR ((club_id = current_club_id()) AND (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = cash_sessions.club_id) AND ((r.role = 'admin'::app_role) OR ((cash_sessions.user_id = auth.uid()) AND ('use_cash'::app_permission = ANY (r.permissions)))))))))) WITH CHECK ((is_super_admin(auth.uid()) OR ((club_id = current_club_id()) AND (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = cash_sessions.club_id) AND ((r.role = 'admin'::app_role) OR ((cash_sessions.user_id = auth.uid()) AND ('use_cash'::app_permission = ANY (r.permissions))))))))));
CREATE POLICY "check_ins club access insert" ON public.check_ins FOR INSERT TO "authenticated" WITH CHECK (user_has_club_access(club_id));
CREATE POLICY "check_ins club access select" ON public.check_ins FOR SELECT TO "authenticated" USING (user_has_club_access(club_id));
CREATE POLICY "admins can manage field config" ON public.club_member_field_config FOR ALL TO "authenticated" USING ((is_super_admin(auth.uid()) OR (user_has_club_access(club_id) AND is_current_user_club_admin(club_id)))) WITH CHECK ((is_super_admin(auth.uid()) OR (user_has_club_access(club_id) AND is_current_user_club_admin(club_id))));
CREATE POLICY "club members can read field config" ON public.club_member_field_config FOR SELECT TO "authenticated" USING (user_has_club_access(club_id));
CREATE POLICY "clubs_delete_super" ON public.clubs FOR DELETE TO "authenticated" USING (is_super_admin(auth.uid()));
CREATE POLICY "clubs_insert_super" ON public.clubs FOR INSERT TO "authenticated" WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "clubs_public_branding_select" ON public.clubs FOR SELECT TO "anon" USING ((active = true));
CREATE POLICY "clubs_select" ON public.clubs FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR user_has_club_access(id)));
CREATE POLICY "clubs_update_super" ON public.clubs FOR UPDATE TO "authenticated" USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Service role can insert send log" ON public.email_send_log FOR INSERT TO "service_role" WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can read send log" ON public.email_send_log FOR SELECT TO "service_role" USING ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can update send log" ON public.email_send_log FOR UPDATE TO "service_role" USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can manage send state" ON public.email_send_state FOR ALL TO "service_role" USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens FOR INSERT TO "service_role" WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens FOR UPDATE TO "service_role" USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens FOR SELECT TO "service_role" USING ((auth.role() = 'service_role'::text));
CREATE POLICY "members_administrative_delete" ON public.members FOR DELETE TO "authenticated" USING (((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id)));
CREATE POLICY "members_administrative_insert" ON public.members FOR INSERT TO "authenticated" WITH CHECK (((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id)));
CREATE POLICY "members_administrative_read" ON public.members FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "members_administrative_update" ON public.members FOR UPDATE TO "authenticated" USING (((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id))) WITH CHECK (((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id)));
CREATE POLICY "plans_admin_write" ON public.membership_plans FOR ALL TO "authenticated" USING ((is_super_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = membership_plans.club_id) AND (r.club_id = current_club_id()) AND (r.role = 'admin'::app_role)))))) WITH CHECK ((is_super_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = membership_plans.club_id) AND (r.club_id = current_club_id()) AND (r.role = 'admin'::app_role))))));
CREATE POLICY "plans_read" ON public.membership_plans FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "receipts_read" ON public.membership_receipts FOR SELECT TO "authenticated" USING (can_read_membership_receipts(club_id));
CREATE POLICY "order_items_all" ON public.order_items FOR ALL TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id()))) WITH CHECK ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "orders_all" ON public.orders FOR ALL TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id()))) WITH CHECK ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "categories_catalog_read" ON public.product_categories FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "categories_catalog_write" ON public.product_categories FOR ALL TO "authenticated" USING (can_manage_snoop_catalog(club_id)) WITH CHECK (can_manage_snoop_catalog(club_id));
CREATE POLICY "products_catalog_read" ON public.products FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "products_catalog_write" ON public.products FOR ALL TO "authenticated" USING (can_manage_snoop_catalog(club_id)) WITH CHECK (can_manage_snoop_catalog(club_id));
CREATE POLICY "profiles_read_auth" ON public.profiles FOR SELECT TO "authenticated" USING (can_read_profile(id));
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO "authenticated" USING ((auth.uid() = id));
CREATE POLICY "profiles_self_upsert" ON public.profiles FOR INSERT TO "authenticated" WITH CHECK ((auth.uid() = id));
CREATE POLICY "Admins can delete stock movements" ON public.stock_movements FOR DELETE TO "authenticated" USING ((user_has_club_access(club_id) AND (is_super_admin(auth.uid()) OR is_current_user_club_admin(club_id))));
CREATE POLICY "Admins can update stock movements" ON public.stock_movements FOR UPDATE TO "authenticated" USING ((user_has_club_access(club_id) AND (is_super_admin(auth.uid()) OR is_current_user_club_admin(club_id))));
CREATE POLICY "Club members can view stock movements" ON public.stock_movements FOR SELECT TO "authenticated" USING (user_has_club_access(club_id));
CREATE POLICY "administrative_movement_insert" ON public.stock_movements FOR INSERT TO "authenticated" WITH CHECK ((can_manage_snoop_catalog(club_id) AND (created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = stock_movements.product_id) AND (p.club_id = stock_movements.club_id))))));
CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails FOR INSERT TO "service_role" WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails FOR SELECT TO "service_role" USING ((auth.role() = 'service_role'::text));
CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO "authenticated" USING (((user_id = auth.uid()) OR is_current_user_club_admin(club_id)));
CREATE POLICY "snoop_documents_delete" ON storage.objects FOR DELETE TO "authenticated" USING (((bucket_id = 'snoop-docs'::text) AND can_access_snoop_document(name)));
CREATE POLICY "snoop_documents_insert" ON storage.objects FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'snoop-docs'::text) AND can_access_snoop_document(name)));
CREATE POLICY "snoop_documents_read" ON storage.objects FOR SELECT TO "authenticated" USING (((bucket_id = 'snoop-docs'::text) AND can_access_snoop_document(name)));
CREATE POLICY "snoop_documents_update" ON storage.objects FOR UPDATE TO "authenticated" USING (((bucket_id = 'snoop-docs'::text) AND can_access_snoop_document(name))) WITH CHECK (((bucket_id = 'snoop-docs'::text) AND can_access_snoop_document(name)));

-- A restrictive tenant fence cannot be bypassed by another permissive policy.
DO $fences$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['members','membership_plans','products','product_categories','orders','order_items','cash_sessions','stock_movements','club_member_field_config','membership_receipts','check_ins'] LOOP
  EXECUTE format('CREATE POLICY snoop_tenant_fence ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.user_has_club_access(club_id)) WITH CHECK (public.user_has_club_access(club_id))',t);
 END LOOP;
 -- TRUNCATE bypasses RLS. No browser account needs these privileges.
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM PUBLIC, anon, authenticated',t);
 END LOOP;
END $fences$;
REVOKE ALL ON public.user_roles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
REVOKE ALL ON public.email_send_log,public.email_send_state,public.email_unsubscribe_tokens,public.suppressed_emails FROM PUBLIC,anon,authenticated;

-- Related IDs must belong to the same club, including requests made via RPC.
-- NOT VALID retains existing records; every new/key-changing write is checked.
CREATE UNIQUE INDEX IF NOT EXISTS members_id_club_key ON public.members(id,club_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_id_club_key ON public.products(id,club_id);
CREATE UNIQUE INDEX IF NOT EXISTS categories_id_club_key ON public.product_categories(id,club_id);
CREATE UNIQUE INDEX IF NOT EXISTS orders_id_club_key ON public.orders(id,club_id);
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_id_club_key ON public.cash_sessions(id,club_id);
ALTER TABLE public.products ADD CONSTRAINT products_category_same_club FOREIGN KEY(category_id,club_id) REFERENCES public.product_categories(id,club_id) NOT VALID;
ALTER TABLE public.check_ins ADD CONSTRAINT check_ins_member_same_club FOREIGN KEY(member_id,club_id) REFERENCES public.members(id,club_id) NOT VALID;
ALTER TABLE public.membership_receipts ADD CONSTRAINT receipts_member_same_club FOREIGN KEY(member_id,club_id) REFERENCES public.members(id,club_id) NOT VALID;
ALTER TABLE public.stock_movements ADD CONSTRAINT movements_product_same_club FOREIGN KEY(product_id,club_id) REFERENCES public.products(id,club_id) NOT VALID;
ALTER TABLE public.orders ADD CONSTRAINT orders_member_same_club FOREIGN KEY(member_id,club_id) REFERENCES public.members(id,club_id) NOT VALID;
ALTER TABLE public.orders ADD CONSTRAINT orders_session_same_club FOREIGN KEY(cash_session_id,club_id) REFERENCES public.cash_sessions(id,club_id) NOT VALID;
ALTER TABLE public.order_items ADD CONSTRAINT items_order_same_club FOREIGN KEY(order_id,club_id) REFERENCES public.orders(id,club_id) NOT VALID;
ALTER TABLE public.order_items ADD CONSTRAINT items_product_same_club FOREIGN KEY(product_id,club_id) REFERENCES public.products(id,club_id) NOT VALID;

CREATE OR REPLACE FUNCTION public.create_order_with_items(_member_id uuid, _notes text, _items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_order_id UUID;
  item JSONB;
  total INT := 0;
  pid UUID;
  qty NUMERIC;
  merma NUMERIC;
  stock_delta NUMERIC;
  current_stock NUMERIC;
  line_total INT;
  _club UUID;
BEGIN
  SELECT club_id INTO _club FROM public.members WHERE id = _member_id;
  IF auth.uid() IS NULL OR _club IS NULL OR NOT (public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.club_id=_club
    AND (r.role='admin' OR 'use_cash'=ANY(r.permissions))
  )) THEN RAISE EXCEPTION 'Club not authorized' USING ERRCODE='42501'; END IF;

  INSERT INTO public.orders(member_id, notes, total_cents, created_by, club_id)
    VALUES (_member_id, _notes, 0, auth.uid(), _club)
    RETURNING id INTO new_order_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    pid := NULLIF(item->>'product_id','')::UUID;
    qty := (item->>'quantity')::NUMERIC;
    merma := COALESCE(NULLIF(item->>'merma','')::NUMERIC, 0);
    stock_delta := qty + merma;
    line_total := (item->>'line_total_cents')::INT;

    IF pid IS NOT NULL THEN
      SELECT stock INTO current_stock FROM public.products WHERE id = pid AND club_id = _club FOR UPDATE;
      IF current_stock IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
      IF current_stock < stock_delta THEN RAISE EXCEPTION 'Stock insuficiente para %', item->>'product_name'; END IF;

      UPDATE public.products SET stock = stock - stock_delta WHERE id = pid;

      INSERT INTO public.stock_movements(club_id, product_id, delta, reason, notes, created_by)
      VALUES (
        _club,
        pid,
        -stock_delta,
        'sale',
        concat('Venta pedido ', new_order_id::text, ' · ', item->>'product_name'),
        auth.uid()
      );
    END IF;

    INSERT INTO public.order_items(order_id, product_id, product_name, unit_type, quantity, unit_price_cents, line_total_cents, club_id)
      VALUES (new_order_id, pid, item->>'product_name', item->>'unit_type', qty, (item->>'unit_price_cents')::INT, line_total, _club);
    total := total + line_total;
  END LOOP;

  UPDATE public.orders SET total_cents = total WHERE id = new_order_id;
  RETURN new_order_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_order_with_items(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(uuid,text,jsonb) TO authenticated;

-- Categories and member numbers belong to a club, never to a global namespace.
ALTER TABLE public.product_categories DROP CONSTRAINT IF EXISTS product_categories_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS categories_club_name_key ON public.product_categories(club_id,name);
DROP INDEX IF EXISTS public.members_member_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS members_club_number_key ON public.members(club_id,member_number);
-- Number allocation occurs inside the member INSERT; an RLS failure rolls it back.
-- Browser callers cannot invoke a trigger function directly.
ALTER FUNCTION public.tg_assign_member_number() SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.tg_assign_member_number() FROM PUBLIC,anon,authenticated;
ALTER TABLE public.members ALTER COLUMN member_number DROP DEFAULT;

-- Anonymous login branding exposes no internal numbering/configuration columns.
REVOKE ALL ON public.clubs FROM anon;
GRANT SELECT(id,name,slug,logo_url,city,active) ON public.clubs TO anon;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;


-- Bucket privato: nessun documento viene caricato.
INSERT INTO storage.buckets(id,name,public) VALUES('snoop-docs','snoop-docs',false);

-- Verifiche obbligatorie prima del commit.
DO $snoop_verify$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['clubs','user_roles','profiles','members','membership_plans','products','product_categories','cash_sessions','membership_receipts','stock_movements'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=table_name AND c.relrowsecurity) THEN
   RAISE EXCEPTION 'RLS mancante per %',table_name;
  END IF;
 END LOOP;

 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname IN ('public','storage') AND (qual ~ '^\(*true\)*$' OR with_check ~ '^\(*true\)*$')) THEN RAISE EXCEPTION 'Unscoped RLS policy'; END IF;
 IF EXISTS(
 WITH expected(s,t,p,c,r,q,w,m) AS (VALUES ('public','cash_sessions','cash_sessions_insert','INSERT','authenticated',NULL,'((user_id = auth.uid()) AND (club_id = current_club_id()) AND (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = cash_sessions.club_id) AND ((r.role = ''admin''::app_role) OR (''use_cash''::app_permission = ANY (r.permissions)))))))','PERMISSIVE'),
('public','cash_sessions','cash_sessions_select','SELECT','authenticated','(is_super_admin(auth.uid()) OR ((club_id = current_club_id()) AND ((user_id = auth.uid()) OR is_current_user_club_admin(club_id))))',NULL,'PERMISSIVE'),
('public','cash_sessions','cash_sessions_update','UPDATE','authenticated','(is_super_admin(auth.uid()) OR ((club_id = current_club_id()) AND (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = cash_sessions.club_id) AND ((r.role = ''admin''::app_role) OR ((cash_sessions.user_id = auth.uid()) AND (''use_cash''::app_permission = ANY (r.permissions)))))))))','(is_super_admin(auth.uid()) OR ((club_id = current_club_id()) AND (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = cash_sessions.club_id) AND ((r.role = ''admin''::app_role) OR ((cash_sessions.user_id = auth.uid()) AND (''use_cash''::app_permission = ANY (r.permissions)))))))))','PERMISSIVE'),
('public','cash_sessions','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','check_ins','check_ins club access insert','INSERT','authenticated',NULL,'user_has_club_access(club_id)','PERMISSIVE'),
('public','check_ins','check_ins club access select','SELECT','authenticated','user_has_club_access(club_id)',NULL,'PERMISSIVE'),
('public','check_ins','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','club_member_field_config','admins can manage field config','ALL','authenticated','(is_super_admin(auth.uid()) OR (user_has_club_access(club_id) AND is_current_user_club_admin(club_id)))','(is_super_admin(auth.uid()) OR (user_has_club_access(club_id) AND is_current_user_club_admin(club_id)))','PERMISSIVE'),
('public','club_member_field_config','club members can read field config','SELECT','authenticated','user_has_club_access(club_id)',NULL,'PERMISSIVE'),
('public','club_member_field_config','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','clubs','clubs_delete_super','DELETE','authenticated','is_super_admin(auth.uid())',NULL,'PERMISSIVE'),
('public','clubs','clubs_insert_super','INSERT','authenticated',NULL,'is_super_admin(auth.uid())','PERMISSIVE'),
('public','clubs','clubs_public_branding_select','SELECT','anon','(active = true)',NULL,'PERMISSIVE'),
('public','clubs','clubs_select','SELECT','authenticated','(is_super_admin(auth.uid()) OR user_has_club_access(id))',NULL,'PERMISSIVE'),
('public','clubs','clubs_update_super','UPDATE','authenticated','is_super_admin(auth.uid())','is_super_admin(auth.uid())','PERMISSIVE'),
('public','email_send_log','Service role can insert send log','INSERT','service_role',NULL,'(auth.role() = ''service_role''::text)','PERMISSIVE'),
('public','email_send_log','Service role can read send log','SELECT','service_role','(auth.role() = ''service_role''::text)',NULL,'PERMISSIVE'),
('public','email_send_log','Service role can update send log','UPDATE','service_role','(auth.role() = ''service_role''::text)','(auth.role() = ''service_role''::text)','PERMISSIVE'),
('public','email_send_state','Service role can manage send state','ALL','service_role','(auth.role() = ''service_role''::text)','(auth.role() = ''service_role''::text)','PERMISSIVE'),
('public','email_unsubscribe_tokens','Service role can insert tokens','INSERT','service_role',NULL,'(auth.role() = ''service_role''::text)','PERMISSIVE'),
('public','email_unsubscribe_tokens','Service role can mark tokens as used','UPDATE','service_role','(auth.role() = ''service_role''::text)','(auth.role() = ''service_role''::text)','PERMISSIVE'),
('public','email_unsubscribe_tokens','Service role can read tokens','SELECT','service_role','(auth.role() = ''service_role''::text)',NULL,'PERMISSIVE'),
('public','members','members_administrative_delete','DELETE','authenticated','((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id))',NULL,'PERMISSIVE'),
('public','members','members_administrative_insert','INSERT','authenticated',NULL,'((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id))','PERMISSIVE'),
('public','members','members_administrative_read','SELECT','authenticated','(is_super_admin(auth.uid()) OR (club_id = current_club_id()))',NULL,'PERMISSIVE'),
('public','members','members_administrative_update','UPDATE','authenticated','((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id))','((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id))','PERMISSIVE'),
('public','members','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','membership_plans','plans_admin_write','ALL','authenticated','(is_super_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = membership_plans.club_id) AND (r.club_id = current_club_id()) AND (r.role = ''admin''::app_role)))))','(is_super_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = membership_plans.club_id) AND (r.club_id = current_club_id()) AND (r.role = ''admin''::app_role)))))','PERMISSIVE'),
('public','membership_plans','plans_read','SELECT','authenticated','(is_super_admin(auth.uid()) OR (club_id = current_club_id()))',NULL,'PERMISSIVE'),
('public','membership_plans','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','membership_receipts','receipts_read','SELECT','authenticated','can_read_membership_receipts(club_id)',NULL,'PERMISSIVE'),
('public','membership_receipts','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','order_items','order_items_all','ALL','authenticated','(is_super_admin(auth.uid()) OR (club_id = current_club_id()))','(is_super_admin(auth.uid()) OR (club_id = current_club_id()))','PERMISSIVE'),
('public','order_items','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','orders','orders_all','ALL','authenticated','(is_super_admin(auth.uid()) OR (club_id = current_club_id()))','(is_super_admin(auth.uid()) OR (club_id = current_club_id()))','PERMISSIVE'),
('public','orders','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','product_categories','categories_catalog_read','SELECT','authenticated','(is_super_admin(auth.uid()) OR (club_id = current_club_id()))',NULL,'PERMISSIVE'),
('public','product_categories','categories_catalog_write','ALL','authenticated','can_manage_snoop_catalog(club_id)','can_manage_snoop_catalog(club_id)','PERMISSIVE'),
('public','product_categories','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','products','products_catalog_read','SELECT','authenticated','(is_super_admin(auth.uid()) OR (club_id = current_club_id()))',NULL,'PERMISSIVE'),
('public','products','products_catalog_write','ALL','authenticated','can_manage_snoop_catalog(club_id)','can_manage_snoop_catalog(club_id)','PERMISSIVE'),
('public','products','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','profiles','profiles_read_auth','SELECT','authenticated','can_read_profile(id)',NULL,'PERMISSIVE'),
('public','profiles','profiles_self_update','UPDATE','authenticated','(auth.uid() = id)',NULL,'PERMISSIVE'),
('public','profiles','profiles_self_upsert','INSERT','authenticated',NULL,'(auth.uid() = id)','PERMISSIVE'),
('public','stock_movements','administrative_movement_insert','INSERT','authenticated',NULL,'(can_manage_snoop_catalog(club_id) AND (created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = stock_movements.product_id) AND (p.club_id = stock_movements.club_id)))))','PERMISSIVE'),
('public','stock_movements','Admins can delete stock movements','DELETE','authenticated','(user_has_club_access(club_id) AND (is_super_admin(auth.uid()) OR is_current_user_club_admin(club_id)))',NULL,'PERMISSIVE'),
('public','stock_movements','Admins can update stock movements','UPDATE','authenticated','(user_has_club_access(club_id) AND (is_super_admin(auth.uid()) OR is_current_user_club_admin(club_id)))',NULL,'PERMISSIVE'),
('public','stock_movements','Club members can view stock movements','SELECT','authenticated','user_has_club_access(club_id)',NULL,'PERMISSIVE'),
('public','stock_movements','snoop_tenant_fence','ALL','authenticated','user_has_club_access(club_id)','user_has_club_access(club_id)','RESTRICTIVE'),
('public','suppressed_emails','Service role can insert suppressed emails','INSERT','service_role',NULL,'(auth.role() = ''service_role''::text)','PERMISSIVE'),
('public','suppressed_emails','Service role can read suppressed emails','SELECT','service_role','(auth.role() = ''service_role''::text)',NULL,'PERMISSIVE'),
('public','user_roles','user_roles_select','SELECT','authenticated','((user_id = auth.uid()) OR is_current_user_club_admin(club_id))',NULL,'PERMISSIVE'),
('storage','objects','snoop_documents_delete','DELETE','authenticated','((bucket_id = ''snoop-docs''::text) AND can_access_snoop_document(name))',NULL,'PERMISSIVE'),
('storage','objects','snoop_documents_insert','INSERT','authenticated',NULL,'((bucket_id = ''snoop-docs''::text) AND can_access_snoop_document(name))','PERMISSIVE'),
('storage','objects','snoop_documents_read','SELECT','authenticated','((bucket_id = ''snoop-docs''::text) AND can_access_snoop_document(name))',NULL,'PERMISSIVE'),
('storage','objects','snoop_documents_update','UPDATE','authenticated','((bucket_id = ''snoop-docs''::text) AND can_access_snoop_document(name))','((bucket_id = ''snoop-docs''::text) AND can_access_snoop_document(name))','PERMISSIVE')), actual AS (
 SELECT schemaname::text s,tablename::text t,policyname::text p,cmd::text c,array_to_string(roles,',') r,qual q,with_check w,permissive m
 FROM pg_policies WHERE schemaname='public' OR (schemaname='storage' AND policyname LIKE 'snoop_documents_%'))
 SELECT 1 FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) differences
 ) THEN RAISE EXCEPTION 'Final RLS policy set differs from reviewed allowlist'; END IF;
 IF has_table_privilege('authenticated','public.user_roles','INSERT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'Browser role can change privileges'; END IF;
 IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity) THEN RAISE EXCEPTION 'Public table without RLS'; END IF;
 IF EXISTS(SELECT 1 FROM public.clubs) OR EXISTS(SELECT 1 FROM public.user_roles) OR EXISTS(SELECT 1 FROM public.members) THEN RAISE EXCEPTION 'Dati inattesi: inizializzazione annullata'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='snoop-docs' AND NOT public) THEN RAISE EXCEPTION 'Bucket privato mancante'; END IF;
END;
$snoop_verify$;
COMMIT;

SELECT 'SNOOP_INITIALIZATION_OK' AS risultato,
       'Eseguire una sola volta. Nessun account o dato personale creato.' AS nota;


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
CREATE POLICY "auth read plans" ON public.membership_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage plans" ON public.membership_plans FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
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
CREATE POLICY "auth read members" ON public.members FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert members" ON public.members FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update members" ON public.members FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin delete members" ON public.members FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER tg_members_updated BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed default plans
INSERT INTO public.membership_plans (name, duration_days, price_cents, sort_order) VALUES
  ('Mensual', 30, 2000, 1),
  ('Trimestral', 90, 5000, 2),
  ('Anual', 365, 15000, 3);

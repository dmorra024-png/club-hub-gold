
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

CREATE POLICY "auth read plans" ON public.membership_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage plans" ON public.membership_plans FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

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

CREATE POLICY "auth read subs" ON public.member_subscriptions FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage subs with perm" ON public.member_subscriptions FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_members'))
  WITH CHECK (public.has_permission(auth.uid(), 'manage_members'));

CREATE TRIGGER set_updated_at_subs BEFORE UPDATE ON public.member_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_member_subs_member ON public.member_subscriptions(member_id, end_date DESC);

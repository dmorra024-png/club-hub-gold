-- Minimal Supabase account schema. Synthetic records only; no remote service.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'
);
CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'collaborator');
CREATE TYPE public.app_permission AS ENUM ('manage_members','manage_products','manage_collaborators','view_reports','use_cash');
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  permissions public.app_permission[] NOT NULL DEFAULT '{}',
  club_id UUID,
  UNIQUE(user_id, role)
);
GRANT ALL ON public.profiles, public.user_roles TO authenticated;
GRANT ALL ON public.profiles, public.user_roles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_read_auth ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_self_upsert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

CREATE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;
CREATE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE FUNCTION public.current_club_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT club_id FROM public.user_roles
  WHERE user_id = auth.uid() AND role <> 'super_admin' AND club_id IS NOT NULL
  ORDER BY (role = 'admin') DESC LIMIT 1
$$;
-- The pre-fix policies, copied from the repository's multi-club migration.
CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin') AND club_id = public.current_club_id()));
CREATE POLICY user_roles_insert ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin') AND club_id = public.current_club_id() AND role <> 'super_admin'));
CREATE POLICY user_roles_update ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin') AND club_id = public.current_club_id()))
  WITH CHECK (public.is_super_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin') AND club_id = public.current_club_id() AND role <> 'super_admin'));
CREATE POLICY user_roles_delete ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin') AND club_id = public.current_club_id() AND role <> 'super_admin'));

-- Existing data before installing the new trigger/migration.
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin-a@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'employee-a@example.test'),
  ('00000000-0000-4000-8000-000000000003', 'admin-b@example.test'),
  ('00000000-0000-4000-8000-000000000004', 'employee-b@example.test'),
  ('00000000-0000-4000-8000-000000000005', 'root@example.test'),
  ('00000000-0000-4000-8000-000000000006', 'unassigned@example.test');
INSERT INTO public.profiles(id, full_name) SELECT id, email FROM auth.users;
INSERT INTO public.user_roles(user_id, role, club_id) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin', '10000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002', 'collaborator', '10000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000003', 'admin', '10000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000004', 'collaborator', '10000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000005', 'super_admin', null);

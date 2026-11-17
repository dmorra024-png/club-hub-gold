
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('admin', 'collaborator');
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
CREATE POLICY "profiles_read_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_self_upsert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

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

CREATE POLICY "user_roles_self_read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

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
CREATE POLICY "members_read" ON public.members FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'manage_members') OR public.has_permission(auth.uid(),'use_cash'));
CREATE POLICY "members_write" ON public.members FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'manage_members'));
CREATE POLICY "members_update" ON public.members FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'manage_members'));
CREATE POLICY "members_delete" ON public.members FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

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
CREATE POLICY "products_read" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_write" ON public.products FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'manage_products'));
CREATE POLICY "products_update" ON public.products FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'manage_products'));
CREATE POLICY "products_delete" ON public.products FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

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
CREATE POLICY "sales_read" ON public.sales FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'use_cash') OR public.has_permission(auth.uid(),'view_reports'));
CREATE POLICY "sales_insert" ON public.sales FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'use_cash') AND cashier_id = auth.uid());
CREATE POLICY "sales_admin_modify" ON public.sales FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "sales_admin_delete" ON public.sales FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

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
CREATE POLICY "sale_items_read" ON public.sale_items FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'use_cash') OR public.has_permission(auth.uid(),'view_reports'));
CREATE POLICY "sale_items_insert" ON public.sale_items FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'use_cash'));

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


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

INSERT INTO public.clubs (name, slug, city) VALUES ('MEDUZA XXIII','meduza','Mallorca') ON CONFLICT (slug) DO NOTHING;

-- Add club_id columns
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.membership_plans ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE;

-- Backfill
DO $$
DECLARE
  meduza_id UUID;
  current_max INT;
BEGIN
  SELECT id INTO meduza_id FROM public.clubs WHERE slug='meduza';
  UPDATE public.user_roles SET club_id = meduza_id WHERE club_id IS NULL;
  UPDATE public.members SET club_id = meduza_id WHERE club_id IS NULL;
  UPDATE public.membership_plans SET club_id = meduza_id WHERE club_id IS NULL;
  UPDATE public.products SET club_id = meduza_id WHERE club_id IS NULL;
  UPDATE public.product_categories SET club_id = meduza_id WHERE club_id IS NULL;
  UPDATE public.orders SET club_id = meduza_id WHERE club_id IS NULL;
  UPDATE public.order_items SET club_id = meduza_id WHERE club_id IS NULL;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(member_number,'\D','','g'),'')::int),0)+1 INTO current_max FROM public.members WHERE club_id = meduza_id;
  UPDATE public.clubs SET next_member_number = GREATEST(current_max,1) WHERE id = meduza_id;

  INSERT INTO public.user_roles(user_id, role, permissions, club_id)
  SELECT user_id, 'super_admin'::public.app_role, permissions, NULL
  FROM public.user_roles WHERE role='admin'
  ON CONFLICT DO NOTHING;
END $$;

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
CREATE POLICY "clubs_select" ON public.clubs FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.user_has_club_access(id));
DROP POLICY IF EXISTS "clubs_insert_super" ON public.clubs;
CREATE POLICY "clubs_insert_super" ON public.clubs FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "clubs_update_super" ON public.clubs;
CREATE POLICY "clubs_update_super" ON public.clubs FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "clubs_delete_super" ON public.clubs;
CREATE POLICY "clubs_delete_super" ON public.clubs FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

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

CREATE POLICY "members_all" ON public.members FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id())
  WITH CHECK (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id());

CREATE POLICY "plans_all" ON public.membership_plans FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id())
  WITH CHECK (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id());

CREATE POLICY "products_all" ON public.products FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id())
  WITH CHECK (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id());

CREATE POLICY "categories_all" ON public.product_categories FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id())
  WITH CHECK (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id());

CREATE POLICY "orders_all" ON public.orders FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id())
  WITH CHECK (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id());

CREATE POLICY "order_items_all" ON public.order_items FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id())
  WITH CHECK (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id());

CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid())
         OR (public.has_role(auth.uid(),'admin') AND club_id = public.current_club_id()));

CREATE POLICY "user_roles_insert" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid())
              OR (public.has_role(auth.uid(),'admin') AND club_id = public.current_club_id() AND role <> 'super_admin'));

CREATE POLICY "user_roles_update" ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (public.has_role(auth.uid(),'admin') AND club_id = public.current_club_id()))
  WITH CHECK (public.is_super_admin(auth.uid())
              OR (public.has_role(auth.uid(),'admin') AND club_id = public.current_club_id() AND role <> 'super_admin'));

CREATE POLICY "user_roles_delete" ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (public.has_role(auth.uid(),'admin') AND club_id = public.current_club_id() AND role <> 'super_admin'));

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


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

CREATE POLICY "auth read categories" ON public.product_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write categories" ON public.product_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

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

CREATE POLICY "auth read products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write products" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS products_category_idx ON public.products(category_id);

CREATE TRIGGER tg_products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

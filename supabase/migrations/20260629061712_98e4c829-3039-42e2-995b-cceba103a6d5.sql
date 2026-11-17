
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
CREATE POLICY "auth read orders" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write orders" ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
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
CREATE POLICY "auth read order_items" ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write order_items" ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

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

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
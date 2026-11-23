-- Merma maximum in grams per billed gram. Default .050; 0 = none.
-- Server-side protection applies to every checkout mode through the shared RPC.
BEGIN;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS max_merma_per_gram numeric(6,3) NOT NULL DEFAULT 0.050;
ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS snoop_club_merma_limit;
ALTER TABLE public.clubs ADD CONSTRAINT snoop_club_merma_limit
 CHECK (max_merma_per_gram BETWEEN 0 AND 0.500);
CREATE OR REPLACE FUNCTION public.snoop_get_club_merma()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $policy$
DECLARE c uuid:=public.current_club_id();v numeric;
BEGIN
 IF (select auth.uid()) IS NULL OR c IS NULL OR NOT public.can_operate_club(c,NULL)
 THEN RAISE EXCEPTION 'MERMA_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT max_merma_per_gram INTO v FROM public.clubs WHERE id=c;
 IF NOT FOUND THEN RAISE EXCEPTION 'MERMA_CLUB_NOT_FOUND' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('maxMermaPerGram',v);
END $policy$;
REVOKE ALL ON FUNCTION public.snoop_get_club_merma() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_get_club_merma() TO authenticated;
CREATE OR REPLACE FUNCTION public.snoop_set_club_merma(p_limit numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $policy$
DECLARE c uuid:=public.current_club_id();
BEGIN
 IF (select auth.uid()) IS NULL OR c IS NULL OR NOT public.is_current_user_club_admin(c)
 THEN RAISE EXCEPTION 'MERMA_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit<0 OR p_limit>0.500 OR p_limit<>round(p_limit,3)
 THEN RAISE EXCEPTION 'MERMA_INVALID_LIMIT' USING ERRCODE='22023'; END IF;
 UPDATE public.clubs SET max_merma_per_gram=p_limit,updated_at=now() WHERE id=c AND active=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'MERMA_CLUB_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('maxMermaPerGram',p_limit);
END $policy$;
REVOKE ALL ON FUNCTION public.snoop_set_club_merma(numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_set_club_merma(numeric) TO authenticated;

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
  v_merma_limit NUMERIC;
BEGIN
  SELECT club_id INTO _club FROM public.members WHERE id = _member_id;
  IF NOT public.can_operate_club(_club,'use_cash') THEN RAISE EXCEPTION 'Club operation denied' USING ERRCODE='42501'; END IF;
  IF auth.uid() IS NULL OR _club IS NULL OR NOT (public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.club_id=_club
    AND (r.role='admin' OR 'use_cash'=ANY(r.permissions))
  )) THEN RAISE EXCEPTION 'Club not authorized' USING ERRCODE='42501'; END IF;

  SELECT max_merma_per_gram INTO v_merma_limit FROM public.clubs WHERE id=_club;
  IF v_merma_limit IS NULL THEN RAISE EXCEPTION 'MERMA_SETTINGS_UNAVAILABLE' USING ERRCODE='23514'; END IF;
  INSERT INTO public.orders(member_id, notes, total_cents, created_by, club_id)
    VALUES (_member_id, _notes, 0, auth.uid(), _club)
    RETURNING id INTO new_order_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    pid := NULLIF(item->>'product_id','')::UUID;
    qty := (item->>'quantity')::NUMERIC;
    merma := COALESCE(NULLIF(item->>'merma','')::NUMERIC, 0);
    IF qty IS NULL OR qty<=0 OR merma IS NULL OR merma<0
       OR ((item->>'unit_type') IS DISTINCT FROM 'gr' AND merma<>0)
       OR ((item->>'unit_type')='gr' AND merma>qty*v_merma_limit+0.000001)
    THEN RAISE EXCEPTION 'MERMA_EXCEEDS_CLUB_LIMIT' USING ERRCODE='23514'; END IF;
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
$function$
;
REVOKE ALL ON FUNCTION public.create_order_with_items(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(uuid,text,jsonb) TO authenticated;
SELECT 'MERMA_POLICY_SCHEMA_READY' as result;
COMMIT;

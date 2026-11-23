-- SNOOP Pilot: two independent accounting corrections, no historical rewrites.
-- Apply in one transaction after green scoped CI. Existing orders without payment evidence remain NULL.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method text;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE payment_method IS NOT NULL AND payment_method NOT IN ('cash','card','transfer','wallet'))
  THEN RAISE EXCEPTION 'Unexpected existing payment values'; END IF;
END
$guard$;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS snoop_orders_payment_method_allowed;
ALTER TABLE public.orders ADD CONSTRAINT snoop_orders_payment_method_allowed
  CHECK (payment_method IS NULL OR payment_method IN ('cash','card','transfer','wallet'));

-- New RPC keeps legacy order creation untouched. The entire sale+method selection is atomic.
CREATE OR REPLACE FUNCTION public.create_order_with_items_and_payment(
  _member_id uuid, _notes text, _items jsonb, _payment_method text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $snoop$
DECLARE created uuid;
BEGIN
  IF auth.uid() IS NULL OR _payment_method IS NULL
     OR _payment_method NOT IN ('cash','card','transfer')
  THEN RAISE EXCEPTION 'Selecciona un método de pago válido' USING ERRCODE='22023'; END IF;
  -- The existing RPC enforces authenticated role, club scope, and stock transaction.
  created := public.create_order_with_items(_member_id,_notes,_items);
  UPDATE public.orders
    SET payment_method=_payment_method
    WHERE id=created AND created_by=auth.uid()
      AND member_id=_member_id AND club_id=public.current_club_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se pudo confirmar el método de pago del pedido' USING ERRCODE='42501';
  END IF;
  RETURN created;
END
$snoop$;
REVOKE ALL ON FUNCTION public.create_order_with_items_and_payment(uuid,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_items_and_payment(uuid,text,jsonb,text) TO authenticated;

-- A cancellation must return the verified ORIGINAL stock debit (billed quantity + merma).
-- Never infer from notes; preserve independent reversal audit, auth and unique stock-return guard.
CREATE OR REPLACE FUNCTION public.snoop_restore_cancelled_order_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $snoop$
DECLARE
  line record;
  debit_total numeric;
  movement_count bigint;
  product_found boolean;
BEGIN
  IF NEW.club_id IS DISTINCT FROM OLD.club_id OR auth.uid() IS DISTINCT FROM NEW.cancelled_by
  THEN RAISE EXCEPTION 'Unauthorized stock reversal' USING ERRCODE='42501'; END IF;
  FOR line IN
    SELECT i.product_id, sum(i.quantity) AS qty
    FROM public.order_items i
    WHERE i.order_id=OLD.id AND i.club_id=OLD.club_id
    GROUP BY i.product_id ORDER BY i.product_id
  LOOP
    IF line.product_id IS NULL OR line.qty IS NULL OR line.qty<=0
    THEN RAISE EXCEPTION 'Product/quantity missing: manual review required' USING ERRCODE='22023'; END IF;
    SELECT count(*), -coalesce(sum(m.delta),0)
      INTO movement_count,debit_total
    FROM public.stock_movements m
    WHERE m.sale_order_id=OLD.id AND m.club_id=OLD.club_id
      AND m.product_id=line.product_id AND m.reason='sale' AND m.delta<0;
    IF movement_count=0 OR debit_total<line.qty
    THEN RAISE EXCEPTION 'Missing or inconsistent sale debit: manual review required' USING ERRCODE='22023'; END IF;
    SELECT EXISTS(SELECT 1 FROM public.products p WHERE p.id=line.product_id AND p.club_id=OLD.club_id)
      INTO product_found;
    IF NOT product_found THEN RAISE EXCEPTION 'Product unavailable: manual review required' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.products p WHERE p.id=line.product_id AND p.club_id=OLD.club_id FOR UPDATE;
    -- Unique (reversal_order_id, product_id) forbids replay/double credit.
    INSERT INTO public.stock_movements(
      club_id,product_id,delta,reason,notes,created_by,reversal_order_id
    ) VALUES (
      OLD.club_id,line.product_id,debit_total,'sale_cancellation',
      'Anulación completa de pedido '||OLD.id::text,
      auth.uid(),OLD.id
    );
    UPDATE public.products SET stock=stock+debit_total
      WHERE id=line.product_id AND club_id=OLD.club_id;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.stock_movements m
    WHERE m.sale_order_id=OLD.id AND m.club_id=OLD.club_id AND m.reason='sale'
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items i
        WHERE i.order_id=OLD.id AND i.club_id=OLD.club_id AND i.product_id=m.product_id
      )
  ) THEN RAISE EXCEPTION 'Unmatched sale movement: manual review required' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END
$snoop$;
COMMIT;

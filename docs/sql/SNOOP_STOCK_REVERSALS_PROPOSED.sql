-- SNOOP STOCK REVERSALS — PROPOSAL ONLY, NEVER DEPLOY WITHOUT APPROVAL.
-- Run only AFTER SNOOP_FINANCIAL_REVERSALS_PROPOSED.sql.
-- This migration fails closed for legacy orders without verifiable stock provenance. Sold quantities are credited; waste (merma) is never credited.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.financial_order_reversals') IS NULL
 OR to_regclass('public.stock_movements') IS NULL
 OR to_regclass('public.order_items') IS NULL
 THEN RAISE EXCEPTION 'Required SNOOP cancellation schema is not installed'; END IF;
END $$;

-- Persistent evidence: future sales get an immutable order reference on each stock debit.
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS sale_order_id uuid;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS reversal_order_id uuid;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS original_movement_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS snoop_stock_movements_id_club ON public.stock_movements(id,club_id);
CREATE UNIQUE INDEX IF NOT EXISTS snoop_orders_id_club_stock ON public.orders(id,club_id);
ALTER TABLE public.stock_movements ADD CONSTRAINT snoop_sale_order_scope
 FOREIGN KEY (sale_order_id,club_id) REFERENCES public.orders(id,club_id);
ALTER TABLE public.stock_movements ADD CONSTRAINT snoop_reversal_order_scope
 FOREIGN KEY (reversal_order_id,club_id) REFERENCES public.orders(id,club_id);
ALTER TABLE public.stock_movements ADD CONSTRAINT snoop_original_stock_scope
 FOREIGN KEY (original_movement_id,club_id) REFERENCES public.stock_movements(id,club_id);
CREATE UNIQUE INDEX snoop_one_stock_reversal_per_movement
 ON public.stock_movements(original_movement_id) WHERE original_movement_id IS NOT NULL;
CREATE UNIQUE INDEX snoop_one_stock_return_per_order_product
 ON public.stock_movements(reversal_order_id,product_id) WHERE reversal_order_id IS NOT NULL;

-- The currently deployed create_order_with_items emits: reason='sale',
-- notes='Venta pedido <uuid> · <name>'. Capture the exact original order
-- reference at INSERT time (not by guessing when reversing a historical sale).
CREATE FUNCTION public.snoop_bind_sale_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE parsed text;
BEGIN
 IF NEW.reason='sale' AND NEW.delta < 0 THEN
  IF NEW.sale_order_id IS NULL THEN
   parsed := substring(coalesce(NEW.notes,'') from '^Venta pedido ([0-9a-fA-F-]{36}) · ');
   IF parsed IS NULL THEN RAISE EXCEPTION 'Sale movement must identify its order' USING ERRCODE='22023'; END IF;
   NEW.sale_order_id:=parsed::uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id=NEW.sale_order_id AND o.club_id=NEW.club_id) THEN
   RAISE EXCEPTION 'Sale movement order/club mismatch' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snoop_bind_sale_stock_movement() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snoop_bind_sale_stock_movement BEFORE INSERT ON public.stock_movements
 FOR EACH ROW EXECUTE FUNCTION public.snoop_bind_sale_stock_movement();

-- Reversal rows are immutable. Reject direct client INSERT; nested trusted cancellation trigger only.
CREATE FUNCTION public.snoop_protect_stock_reversal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP <> 'INSERT' AND (OLD.original_movement_id IS NOT NULL OR OLD.reversal_order_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Stock reversal immutable' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' AND NEW.reversal_order_id IS NOT NULL
    AND pg_trigger_depth() < 2 THEN
  RAISE EXCEPTION 'Direct stock reversal forbidden' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snoop_protect_stock_reversal() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snoop_protect_stock_reversal BEFORE INSERT OR UPDATE OR DELETE ON public.stock_movements
 FOR EACH ROW EXECUTE FUNCTION public.snoop_protect_stock_reversal();

-- Stock is credited ONLY for orders where each line has one exactly identifiable
-- original debit. For historical orders with no structured reference the whole
-- annulment rolls back, avoiding accounting/stock mismatches.
CREATE FUNCTION public.snoop_restore_cancelled_order_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE line record; debit_total numeric; movement_count bigint; product_found boolean;
BEGIN
 IF NEW.club_id IS DISTINCT FROM OLD.club_id OR auth.uid() IS DISTINCT FROM NEW.cancelled_by
 THEN RAISE EXCEPTION 'Unauthorized stock reversal' USING ERRCODE='42501'; END IF;
 -- Do not guess quantities from unstructured notes or duplicate past debits.
 -- Always restore exactly delivered order_items.quantity, never discarded merma.
 FOR line IN SELECT i.product_id, sum(i.quantity) AS qty
   FROM public.order_items i WHERE i.order_id=OLD.id AND i.club_id=OLD.club_id
   GROUP BY i.product_id ORDER BY i.product_id LOOP
  IF line.product_id IS NULL OR line.qty IS NULL OR line.qty<=0 THEN
   RAISE EXCEPTION 'Product/quantity missing: manual review required' USING ERRCODE='22023'; END IF;
  SELECT count(*), -coalesce(sum(m.delta),0) INTO movement_count,debit_total
    FROM public.stock_movements m
    WHERE m.sale_order_id=OLD.id AND m.club_id=OLD.club_id
      AND m.product_id=line.product_id AND m.reason='sale' AND m.delta<0;
  IF movement_count=0 OR debit_total<line.qty THEN
   RAISE EXCEPTION 'Missing or inconsistent sale debit: manual review required' USING ERRCODE='22023'; END IF;
  -- An order's debit can be larger than quantity because of merma; never restock merma.
  SELECT EXISTS(SELECT 1 FROM public.products p WHERE p.id=line.product_id AND p.club_id=OLD.club_id)
    INTO product_found;
  IF NOT product_found THEN RAISE EXCEPTION 'Product unavailable: manual review required' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.products p WHERE p.id=line.product_id AND p.club_id=OLD.club_id FOR UPDATE;
  -- Must be invoked only by the trusted order-cancellation trigger.
  INSERT INTO public.stock_movements(club_id,product_id,delta,reason,notes,created_by,reversal_order_id)
  VALUES (OLD.club_id,line.product_id,line.qty,'sale_cancellation',
     'Anulación de pedido '||OLD.id::text,auth.uid(),OLD.id);
  UPDATE public.products SET stock=stock+line.qty WHERE id=line.product_id AND club_id=OLD.club_id;
 END LOOP;
 IF EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.sale_order_id=OLD.id AND m.club_id=OLD.club_id AND m.reason='sale'
   AND NOT EXISTS (SELECT 1 FROM public.order_items i WHERE i.order_id=OLD.id AND i.club_id=OLD.club_id AND i.product_id=m.product_id))
 THEN RAISE EXCEPTION 'Unmatched sale movement: manual review required' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snoop_restore_cancelled_order_stock() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snoop_restore_cancelled_order_stock AFTER UPDATE ON public.orders
 FOR EACH ROW WHEN(OLD.status='completed' AND NEW.status='cancelled')
 EXECUTE FUNCTION public.snoop_restore_cancelled_order_stock();
NOTIFY pgrst,'reload schema';
COMMIT;

-- SNOOP only. Additive upgrade; no existing rows, identities or receipts are removed.
ALTER TABLE public.product_categories ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_attribution jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE FUNCTION public.snoop_catalog_delete_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='product_categories' THEN
  IF EXISTS(SELECT 1 FROM public.products WHERE category_id=OLD.id) THEN
   RAISE EXCEPTION 'La categoría contiene productos: archívala para conservar sus datos' USING ERRCODE='23503';
  END IF;
 ELSE
  IF OLD.stock<>0 OR EXISTS(SELECT 1 FROM public.stock_movements WHERE product_id=OLD.id)
   OR EXISTS(SELECT 1 FROM public.order_items WHERE product_id=OLD.id) THEN
   RAISE EXCEPTION 'Producto con stock o historial: archívalo para conservar sus datos' USING ERRCODE='23503';
  END IF;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER snoop_category_delete_guard BEFORE DELETE ON public.product_categories
 FOR EACH ROW EXECUTE FUNCTION public.snoop_catalog_delete_guard();
CREATE TRIGGER snoop_product_delete_guard BEFORE DELETE ON public.products
 FOR EACH ROW EXECUTE FUNCTION public.snoop_catalog_delete_guard();

CREATE FUNCTION public.snoop_stock_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'El historial de inventario es inmutable; registra una nueva rectificación' USING ERRCODE='42501'; END $$;
CREATE TRIGGER snoop_stock_history_guard BEFORE UPDATE OR DELETE ON public.stock_movements
 FOR EACH ROW EXECUTE FUNCTION public.snoop_stock_history_guard();
REVOKE UPDATE,DELETE ON public.stock_movements FROM authenticated;

CREATE FUNCTION public.manage_administrative_category(p_id uuid,p_name text,p_archived boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid;
BEGIN
 SELECT club_id INTO c FROM public.product_categories WHERE id=p_id FOR UPDATE;
 IF c IS NULL OR NOT public.can_manage_snoop_catalog(c) THEN
  RAISE EXCEPTION 'Catálogo no autorizado' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120 OR p_archived IS NULL THEN
  RAISE EXCEPTION 'Datos de categoría no válidos' USING ERRCODE='22023'; END IF;
 UPDATE public.product_categories SET name=trim(p_name),archived=p_archived WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.manage_administrative_category(uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_administrative_category(uuid,text,boolean) TO authenticated;

-- Optimistic locking avoids overwriting a correction made by another operator.
CREATE FUNCTION public.save_administrative_product_checked(p_id uuid,p_values jsonb,p_expected numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_stock numeric; c uuid;
BEGIN
 SELECT stock,club_id INTO current_stock,c FROM public.products WHERE id=p_id FOR UPDATE;
 IF c IS NULL OR NOT public.can_manage_snoop_catalog(c) THEN
  RAISE EXCEPTION 'Catálogo no autorizado' USING ERRCODE='42501'; END IF;
 IF current_stock IS DISTINCT FROM p_expected THEN
  RAISE EXCEPTION 'Stock modificado por otro operador: recarga y confirma de nuevo' USING ERRCODE='40001'; END IF;
 -- Editing the card cannot silently change inventory: use the dedicated adjustment.
 IF (p_values->>'stock')::numeric IS DISTINCT FROM current_stock THEN
  RAISE EXCEPTION 'Usa Corregir stock para registrar una rectificación con motivo' USING ERRCODE='22023'; END IF;
 PERFORM public.save_administrative_product(p_id,p_values);
 UPDATE public.products SET
  description=CASE WHEN p_values?'description' THEN p_values->>'description' ELSE description END,
  image_url=CASE WHEN p_values?'image_url' THEN p_values->>'image_url' ELSE image_url END,
  image_attribution=CASE WHEN p_values?'image_attribution' THEN nullif(p_values->'image_attribution','null'::jsonb) ELSE image_attribution END
 WHERE id=p_id;
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.save_administrative_product_checked(uuid,jsonb,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_administrative_product_checked(uuid,jsonb,numeric) TO authenticated;
-- API clients must use the audited RPCs; SECURITY DEFINER writes retain their audit.
REVOKE INSERT ON public.stock_movements FROM authenticated;
CREATE FUNCTION public.snoop_stock_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND
   ((TG_OP='INSERT' AND NEW.stock<>0) OR (TG_OP='UPDATE' AND NEW.stock IS DISTINCT FROM OLD.stock)) THEN
  RAISE EXCEPTION 'Usa la rectificación de inventario para conservar el historial' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER snoop_stock_write_guard BEFORE INSERT OR UPDATE ON public.products
 FOR EACH ROW EXECUTE FUNCTION public.snoop_stock_write_guard();

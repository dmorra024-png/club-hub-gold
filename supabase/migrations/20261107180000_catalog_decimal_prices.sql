-- SNOOP catalog-only corrective migration. Prices are euros in numeric(10,2), not integer cents.
-- Preserve all rows, ids, stock movements, authorization, grants and function signature.
-- Apply once to SNOOP Pilot after reviewing the live function and schema.
CREATE OR REPLACE FUNCTION public.save_administrative_product(p_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c uuid; old_stock numeric; new_stock numeric; pid uuid; category uuid; label text; buy numeric; sell numeric;
BEGIN
 IF p_id IS NULL THEN c:=public.current_club_id(); old_stock:=0;
 ELSE SELECT club_id,stock INTO c,old_stock FROM public.products WHERE id=p_id FOR UPDATE; END IF;
 IF c IS NULL OR NOT public.can_manage_snoop_catalog(c) THEN RAISE EXCEPTION 'Catálogo no autorizado' USING ERRCODE='42501'; END IF;
 label:=trim(p_values->>'name'); category:=(p_values->>'category_id')::uuid;
 new_stock:=(p_values->>'stock')::numeric; buy:=(p_values->>'buy_price')::numeric; sell:=(p_values->>'sell_price')::numeric;
 IF label IS NULL OR length(label) NOT BETWEEN 1 AND 120 OR new_stock IS NULL OR new_stock<0 OR new_stock>99999999.99 OR new_stock<>round(new_stock,2)
 OR buy IS NULL OR buy<0 OR buy>99999999.99 OR buy<>round(buy,2)
 OR sell IS NULL OR sell<0 OR sell>99999999.99 OR sell<>round(sell,2) THEN RAISE EXCEPTION 'Datos de catálogo no válidos' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.product_categories WHERE id=category AND club_id=c) THEN RAISE EXCEPTION 'Categoría de otro club o inexistente' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL THEN
 INSERT INTO public.products(club_id,category_id,name,stock,buy_price,sell_price,strain,notes)
 VALUES(c,category,label,new_stock,buy,sell,nullif(p_values->>'strain','')::public.strain_type,p_values->>'notes') RETURNING id INTO pid;
 ELSE
 UPDATE public.products SET category_id=category,name=label,stock=new_stock,buy_price=buy,sell_price=sell,strain=nullif(p_values->>'strain','')::public.strain_type,notes=p_values->>'notes' WHERE id=p_id RETURNING id INTO pid;
 END IF;
 IF new_stock<>old_stock THEN
 INSERT INTO public.stock_movements(club_id,product_id,delta,reason,notes,created_by)
 VALUES(c,pid,new_stock-old_stock,CASE WHEN p_id IS NULL THEN 'initial_stock' ELSE 'administrative_edit' END,'Ajuste administrativo',auth.uid());
 END IF;
 RETURN pid;
END;
$$;
REVOKE ALL ON FUNCTION public.save_administrative_product(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_administrative_product(uuid,jsonb) TO authenticated;

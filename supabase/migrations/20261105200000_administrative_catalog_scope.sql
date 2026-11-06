-- Administrative catalogs/resources only; existing data and order functions retained.
CREATE FUNCTION public.can_manage_snoop_catalog(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND (public.is_super_admin(auth.uid()) OR EXISTS (
 SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.club_id=target
 AND target=public.current_club_id() AND (r.role='admin' OR 'manage_products'=ANY(r.permissions))));
$$;
REVOKE ALL ON FUNCTION public.can_manage_snoop_catalog(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_snoop_catalog(uuid) TO authenticated;
DROP POLICY products_all ON public.products;
CREATE POLICY products_catalog_read ON public.products FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR club_id=public.current_club_id());
CREATE POLICY products_catalog_write ON public.products FOR ALL TO authenticated USING (public.can_manage_snoop_catalog(club_id)) WITH CHECK (public.can_manage_snoop_catalog(club_id));
DROP POLICY categories_all ON public.product_categories;
CREATE POLICY categories_catalog_read ON public.product_categories FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR club_id=public.current_club_id());
CREATE POLICY categories_catalog_write ON public.product_categories FOR ALL TO authenticated USING (public.can_manage_snoop_catalog(club_id)) WITH CHECK (public.can_manage_snoop_catalog(club_id));
DROP POLICY plans_all ON public.membership_plans;
CREATE POLICY plans_read ON public.membership_plans FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR club_id=public.current_club_id());
CREATE POLICY plans_admin_write ON public.membership_plans FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.club_id=membership_plans.club_id AND r.club_id=public.current_club_id() AND r.role='admin'))
WITH CHECK (public.is_super_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.club_id=membership_plans.club_id AND r.club_id=public.current_club_id() AND r.role='admin'));
REVOKE TRUNCATE,REFERENCES,TRIGGER ON public.products,public.product_categories,public.membership_plans,public.stock_movements FROM authenticated;
DROP POLICY "Club members can insert stock movements" ON public.stock_movements;
CREATE POLICY administrative_movement_insert ON public.stock_movements FOR INSERT TO authenticated
WITH CHECK(public.can_manage_snoop_catalog(club_id) AND created_by=auth.uid() AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id AND p.club_id=stock_movements.club_id));

CREATE FUNCTION public.save_administrative_product(p_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c uuid; old_stock numeric; new_stock numeric; pid uuid; category uuid; label text; buy integer; sell integer;
BEGIN
 IF p_id IS NULL THEN c:=public.current_club_id(); old_stock:=0;
 ELSE SELECT club_id,stock INTO c,old_stock FROM public.products WHERE id=p_id FOR UPDATE; END IF;
 IF c IS NULL OR NOT public.can_manage_snoop_catalog(c) THEN RAISE EXCEPTION 'Catálogo no autorizado' USING ERRCODE='42501'; END IF;
 label:=trim(p_values->>'name'); category:=(p_values->>'category_id')::uuid;
 new_stock:=(p_values->>'stock')::numeric; buy:=(p_values->>'buy_price')::integer; sell:=(p_values->>'sell_price')::integer;
 IF label IS NULL OR length(label) NOT BETWEEN 1 AND 120 OR new_stock IS NULL OR new_stock<0 OR new_stock>99999999.99 OR new_stock<>round(new_stock,2)
 OR buy IS NULL OR buy<0 OR sell IS NULL OR sell<0 THEN RAISE EXCEPTION 'Datos de catálogo no válidos' USING ERRCODE='22023'; END IF;
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

CREATE FUNCTION public.adjust_administrative_stock(p_id uuid,p_delta numeric,p_expected numeric,p_notes text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c uuid; before_stock numeric; after_stock numeric;
BEGIN
 SELECT club_id,stock INTO c,before_stock FROM public.products WHERE id=p_id FOR UPDATE;
 IF c IS NULL OR NOT public.can_manage_snoop_catalog(c) THEN RAISE EXCEPTION 'Inventario no autorizado' USING ERRCODE='42501'; END IF;
 IF before_stock IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Stock modificado por otro operador: recarga y confirma de nuevo' USING ERRCODE='40001'; END IF;
 IF p_delta IS NULL OR p_delta=0 OR abs(p_delta)>1000000 OR p_delta<>round(p_delta,2) THEN RAISE EXCEPTION 'Cantidad no válida' USING ERRCODE='22023'; END IF;
 after_stock:=before_stock+p_delta;
 IF after_stock<0 OR after_stock>99999999.99 THEN RAISE EXCEPTION 'Stock no válido' USING ERRCODE='22023'; END IF;
 UPDATE public.products SET stock=after_stock WHERE id=p_id;
 INSERT INTO public.stock_movements(club_id,product_id,delta,reason,notes,created_by)
 VALUES(c,p_id,p_delta,'administrative_adjustment',left(p_notes,1000),auth.uid());
 RETURN after_stock;
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_administrative_stock(uuid,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.adjust_administrative_stock(uuid,numeric,numeric,text) TO authenticated;

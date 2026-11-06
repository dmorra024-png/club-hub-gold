-- Authoritative SNOOP policy set. No records/accounts are removed or changed.
-- PostgreSQL permissive policies are OR-ed: remove ALL previous public policies.
DO $cleanup$
DECLARE p record;
BEGIN
 FOR p IN SELECT * FROM pg_policies WHERE schemaname='public'
 OR (schemaname='storage' AND tablename='objects' AND (policyname LIKE '%snoop-docs%' OR policyname LIKE 'snoop_documents_%')) LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',p.policyname,p.schemaname,p.tablename);
 END LOOP;
END $cleanup$;

CREATE POLICY "cash_sessions_insert" ON public.cash_sessions FOR INSERT TO "authenticated" WITH CHECK (((user_id = auth.uid()) AND (club_id = current_club_id()) AND (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = cash_sessions.club_id) AND ((r.role = 'admin'::app_role) OR ('use_cash'::app_permission = ANY (r.permissions))))))));
CREATE POLICY "cash_sessions_select" ON public.cash_sessions FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR ((club_id = current_club_id()) AND ((user_id = auth.uid()) OR is_current_user_club_admin(club_id)))));
CREATE POLICY "cash_sessions_update" ON public.cash_sessions FOR UPDATE TO "authenticated" USING ((is_super_admin(auth.uid()) OR ((club_id = current_club_id()) AND (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = cash_sessions.club_id) AND ((r.role = 'admin'::app_role) OR ((cash_sessions.user_id = auth.uid()) AND ('use_cash'::app_permission = ANY (r.permissions)))))))))) WITH CHECK ((is_super_admin(auth.uid()) OR ((club_id = current_club_id()) AND (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = cash_sessions.club_id) AND ((r.role = 'admin'::app_role) OR ((cash_sessions.user_id = auth.uid()) AND ('use_cash'::app_permission = ANY (r.permissions))))))))));
CREATE POLICY "check_ins club access insert" ON public.check_ins FOR INSERT TO "authenticated" WITH CHECK (user_has_club_access(club_id));
CREATE POLICY "check_ins club access select" ON public.check_ins FOR SELECT TO "authenticated" USING (user_has_club_access(club_id));
CREATE POLICY "admins can manage field config" ON public.club_member_field_config FOR ALL TO "authenticated" USING ((is_super_admin(auth.uid()) OR (user_has_club_access(club_id) AND is_current_user_club_admin(club_id)))) WITH CHECK ((is_super_admin(auth.uid()) OR (user_has_club_access(club_id) AND is_current_user_club_admin(club_id))));
CREATE POLICY "club members can read field config" ON public.club_member_field_config FOR SELECT TO "authenticated" USING (user_has_club_access(club_id));
CREATE POLICY "clubs_delete_super" ON public.clubs FOR DELETE TO "authenticated" USING (is_super_admin(auth.uid()));
CREATE POLICY "clubs_insert_super" ON public.clubs FOR INSERT TO "authenticated" WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "clubs_public_branding_select" ON public.clubs FOR SELECT TO "anon" USING ((active = true));
CREATE POLICY "clubs_select" ON public.clubs FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR user_has_club_access(id)));
CREATE POLICY "clubs_update_super" ON public.clubs FOR UPDATE TO "authenticated" USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Service role can insert send log" ON public.email_send_log FOR INSERT TO "service_role" WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can read send log" ON public.email_send_log FOR SELECT TO "service_role" USING ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can update send log" ON public.email_send_log FOR UPDATE TO "service_role" USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can manage send state" ON public.email_send_state FOR ALL TO "service_role" USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens FOR INSERT TO "service_role" WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens FOR UPDATE TO "service_role" USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens FOR SELECT TO "service_role" USING ((auth.role() = 'service_role'::text));
CREATE POLICY "members_administrative_delete" ON public.members FOR DELETE TO "authenticated" USING (((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id)));
CREATE POLICY "members_administrative_insert" ON public.members FOR INSERT TO "authenticated" WITH CHECK (((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id)));
CREATE POLICY "members_administrative_read" ON public.members FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "members_administrative_update" ON public.members FOR UPDATE TO "authenticated" USING (((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id))) WITH CHECK (((is_super_admin(auth.uid()) OR (club_id = current_club_id())) AND can_manage_club_members(club_id)));
CREATE POLICY "plans_admin_write" ON public.membership_plans FOR ALL TO "authenticated" USING ((is_super_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = membership_plans.club_id) AND (r.club_id = current_club_id()) AND (r.role = 'admin'::app_role)))))) WITH CHECK ((is_super_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.club_id = membership_plans.club_id) AND (r.club_id = current_club_id()) AND (r.role = 'admin'::app_role))))));
CREATE POLICY "plans_read" ON public.membership_plans FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "receipts_read" ON public.membership_receipts FOR SELECT TO "authenticated" USING (can_read_membership_receipts(club_id));
CREATE POLICY "order_items_all" ON public.order_items FOR ALL TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id()))) WITH CHECK ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "orders_all" ON public.orders FOR ALL TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id()))) WITH CHECK ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "categories_catalog_read" ON public.product_categories FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "categories_catalog_write" ON public.product_categories FOR ALL TO "authenticated" USING (can_manage_snoop_catalog(club_id)) WITH CHECK (can_manage_snoop_catalog(club_id));
CREATE POLICY "products_catalog_read" ON public.products FOR SELECT TO "authenticated" USING ((is_super_admin(auth.uid()) OR (club_id = current_club_id())));
CREATE POLICY "products_catalog_write" ON public.products FOR ALL TO "authenticated" USING (can_manage_snoop_catalog(club_id)) WITH CHECK (can_manage_snoop_catalog(club_id));
CREATE POLICY "profiles_read_auth" ON public.profiles FOR SELECT TO "authenticated" USING (can_read_profile(id));
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO "authenticated" USING ((auth.uid() = id));
CREATE POLICY "profiles_self_upsert" ON public.profiles FOR INSERT TO "authenticated" WITH CHECK ((auth.uid() = id));
CREATE POLICY "Admins can delete stock movements" ON public.stock_movements FOR DELETE TO "authenticated" USING ((user_has_club_access(club_id) AND (is_super_admin(auth.uid()) OR is_current_user_club_admin(club_id))));
CREATE POLICY "Admins can update stock movements" ON public.stock_movements FOR UPDATE TO "authenticated" USING ((user_has_club_access(club_id) AND (is_super_admin(auth.uid()) OR is_current_user_club_admin(club_id))));
CREATE POLICY "Club members can view stock movements" ON public.stock_movements FOR SELECT TO "authenticated" USING (user_has_club_access(club_id));
CREATE POLICY "administrative_movement_insert" ON public.stock_movements FOR INSERT TO "authenticated" WITH CHECK ((can_manage_snoop_catalog(club_id) AND (created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = stock_movements.product_id) AND (p.club_id = stock_movements.club_id))))));
CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails FOR INSERT TO "service_role" WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails FOR SELECT TO "service_role" USING ((auth.role() = 'service_role'::text));
CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO "authenticated" USING (((user_id = auth.uid()) OR is_current_user_club_admin(club_id)));
CREATE POLICY "snoop_documents_delete" ON storage.objects FOR DELETE TO "authenticated" USING (((bucket_id = 'snoop-docs'::text) AND can_access_snoop_document(name)));
CREATE POLICY "snoop_documents_insert" ON storage.objects FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'snoop-docs'::text) AND can_access_snoop_document(name)));
CREATE POLICY "snoop_documents_read" ON storage.objects FOR SELECT TO "authenticated" USING (((bucket_id = 'snoop-docs'::text) AND can_access_snoop_document(name)));
CREATE POLICY "snoop_documents_update" ON storage.objects FOR UPDATE TO "authenticated" USING (((bucket_id = 'snoop-docs'::text) AND can_access_snoop_document(name))) WITH CHECK (((bucket_id = 'snoop-docs'::text) AND can_access_snoop_document(name)));

-- A restrictive tenant fence cannot be bypassed by another permissive policy.
DO $fences$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['members','membership_plans','products','product_categories','orders','order_items','cash_sessions','stock_movements','club_member_field_config','membership_receipts','check_ins'] LOOP
  EXECUTE format('CREATE POLICY snoop_tenant_fence ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.user_has_club_access(club_id)) WITH CHECK (public.user_has_club_access(club_id))',t);
 END LOOP;
 -- TRUNCATE bypasses RLS. No browser account needs these privileges.
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM PUBLIC, anon, authenticated',t);
 END LOOP;
END $fences$;
REVOKE ALL ON public.user_roles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
REVOKE ALL ON public.email_send_log,public.email_send_state,public.email_unsubscribe_tokens,public.suppressed_emails FROM PUBLIC,anon,authenticated;

-- Related IDs must belong to the same club, including requests made via RPC.
-- NOT VALID retains existing records; every new/key-changing write is checked.
CREATE UNIQUE INDEX IF NOT EXISTS members_id_club_key ON public.members(id,club_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_id_club_key ON public.products(id,club_id);
CREATE UNIQUE INDEX IF NOT EXISTS categories_id_club_key ON public.product_categories(id,club_id);
CREATE UNIQUE INDEX IF NOT EXISTS orders_id_club_key ON public.orders(id,club_id);
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_id_club_key ON public.cash_sessions(id,club_id);
ALTER TABLE public.products ADD CONSTRAINT products_category_same_club FOREIGN KEY(category_id,club_id) REFERENCES public.product_categories(id,club_id) NOT VALID;
ALTER TABLE public.check_ins ADD CONSTRAINT check_ins_member_same_club FOREIGN KEY(member_id,club_id) REFERENCES public.members(id,club_id) NOT VALID;
ALTER TABLE public.membership_receipts ADD CONSTRAINT receipts_member_same_club FOREIGN KEY(member_id,club_id) REFERENCES public.members(id,club_id) NOT VALID;
ALTER TABLE public.stock_movements ADD CONSTRAINT movements_product_same_club FOREIGN KEY(product_id,club_id) REFERENCES public.products(id,club_id) NOT VALID;
ALTER TABLE public.orders ADD CONSTRAINT orders_member_same_club FOREIGN KEY(member_id,club_id) REFERENCES public.members(id,club_id) NOT VALID;
ALTER TABLE public.orders ADD CONSTRAINT orders_session_same_club FOREIGN KEY(cash_session_id,club_id) REFERENCES public.cash_sessions(id,club_id) NOT VALID;
ALTER TABLE public.order_items ADD CONSTRAINT items_order_same_club FOREIGN KEY(order_id,club_id) REFERENCES public.orders(id,club_id) NOT VALID;
ALTER TABLE public.order_items ADD CONSTRAINT items_product_same_club FOREIGN KEY(product_id,club_id) REFERENCES public.products(id,club_id) NOT VALID;

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
  IF auth.uid() IS NULL OR _club IS NULL OR NOT (public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.club_id=_club
    AND (r.role='admin' OR 'use_cash'=ANY(r.permissions))
  )) THEN RAISE EXCEPTION 'Club not authorized' USING ERRCODE='42501'; END IF;

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
$function$;
REVOKE ALL ON FUNCTION public.create_order_with_items(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(uuid,text,jsonb) TO authenticated;

-- Categories and member numbers belong to a club, never to a global namespace.
ALTER TABLE public.product_categories DROP CONSTRAINT IF EXISTS product_categories_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS categories_club_name_key ON public.product_categories(club_id,name);
DROP INDEX IF EXISTS public.members_member_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS members_club_number_key ON public.members(club_id,member_number);
-- Number allocation occurs inside the member INSERT; an RLS failure rolls it back.
-- Browser callers cannot invoke a trigger function directly.
ALTER FUNCTION public.tg_assign_member_number() SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.tg_assign_member_number() FROM PUBLIC,anon,authenticated;
ALTER TABLE public.members ALTER COLUMN member_number DROP DEFAULT;

-- Anonymous login branding exposes no internal numbering/configuration columns.
REVOKE ALL ON public.clubs FROM anon;
GRANT SELECT(id,name,slug,logo_url,city,active) ON public.clubs TO anon;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;

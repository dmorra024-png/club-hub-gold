-- SNOOP platform/club separation. Upgrade only; never deletes records or roles.
-- Apply to Snoop-pilot only after explicit approval. Not yet applied remotely.
BEGIN;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.can_operate_club(target uuid, permission public.app_permission DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND NOT public.is_super_admin(auth.uid()) AND EXISTS(
 SELECT 1 FROM public.user_roles r JOIN public.clubs c ON c.id=r.club_id
 WHERE r.user_id=auth.uid() AND r.club_id=target AND r.role IN ('admin','collaborator')
 AND c.active AND (c.subscription_expires_at IS NULL OR c.subscription_expires_at>now())
 AND (permission IS NULL OR r.role='admin' OR permission=ANY(r.permissions)));
$$;
REVOKE ALL ON FUNCTION public.can_operate_club(uuid,public.app_permission) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_operate_club(uuid,public.app_permission) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.user_has_club_access(_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT public.can_operate_club(_club_id,NULL)$$;
CREATE OR REPLACE FUNCTION public.current_club_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT r.club_id FROM public.user_roles r WHERE r.user_id=auth.uid() AND public.can_operate_club(r.club_id,NULL)
 ORDER BY (r.role='admin') DESC,r.club_id,r.id LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.is_current_user_club_admin(_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.can_operate_club(_club_id,NULL) AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND club_id=_club_id AND role='admin');
$$;
CREATE OR REPLACE FUNCTION public.can_manage_club_members(_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT public.can_operate_club(_club_id,'manage_members')$$;
CREATE OR REPLACE FUNCTION public.can_manage_snoop_catalog(target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT public.can_operate_club(target,'manage_products')$$;
CREATE OR REPLACE FUNCTION public.can_read_membership_receipts(target_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT target_club=public.current_club_id() AND (public.can_operate_club(target_club,'use_cash') OR public.can_operate_club(target_club,'view_reports'));
$$;
CREATE OR REPLACE FUNCTION public.can_read_profile(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT _user_id=auth.uid() OR EXISTS(SELECT 1 FROM public.user_roles caller JOIN public.user_roles target ON target.club_id=caller.club_id
 WHERE caller.user_id=auth.uid() AND target.user_id=_user_id AND public.can_operate_club(caller.club_id,NULL));
$$;

-- Platform writes are exclusively trusted server operations after assertSuperAdmin.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.clubs FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS clubs_select ON public.clubs;
DROP POLICY IF EXISTS clubs_insert_super ON public.clubs;
DROP POLICY IF EXISTS clubs_update_super ON public.clubs;
DROP POLICY IF EXISTS clubs_delete_super ON public.clubs;
CREATE POLICY clubs_select ON public.clubs FOR SELECT TO authenticated USING(
 NOT public.is_super_admin(auth.uid()) AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND club_id=clubs.id));
DROP POLICY IF EXISTS user_roles_select ON public.user_roles;
CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated USING(
 user_id=auth.uid() OR public.is_current_user_club_admin(club_id));

-- Restrictive fences remain effective even if an old permissive policy exists.
DO $permissions$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['members','products','product_categories','stock_movements','cash_sessions','check_ins','club_member_field_config','orders','order_items'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS snoop_permission_read ON public.%I',t);
  EXECUTE format('DROP POLICY IF EXISTS snoop_permission_write ON public.%I',t);
 END LOOP;
END $permissions$;
CREATE POLICY snoop_permission_read ON public.members AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_operate_club(club_id,'manage_members'));
CREATE POLICY snoop_permission_read ON public.products AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_operate_club(club_id,'manage_products') OR public.can_operate_club(club_id,'use_cash') OR public.can_operate_club(club_id,'view_reports'));
CREATE POLICY snoop_permission_read ON public.product_categories AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_operate_club(club_id,'manage_products') OR public.can_operate_club(club_id,'use_cash') OR public.can_operate_club(club_id,'view_reports'));
CREATE POLICY snoop_permission_read ON public.stock_movements AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_operate_club(club_id,'manage_products') OR public.can_operate_club(club_id,'view_reports'));
CREATE POLICY snoop_permission_read ON public.cash_sessions AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_operate_club(club_id,'use_cash') OR public.can_operate_club(club_id,'view_reports'));
CREATE POLICY snoop_permission_read ON public.club_member_field_config AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_operate_club(club_id,'manage_members'));
CREATE POLICY snoop_permission_read ON public.check_ins AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_operate_club(club_id,'manage_members') OR public.can_operate_club(club_id,'view_reports'));
CREATE POLICY snoop_permission_write ON public.check_ins AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(public.can_operate_club(club_id,'manage_members'));
DO $orders$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['orders','order_items'] LOOP
 EXECUTE format('CREATE POLICY snoop_permission_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_operate_club(club_id,''use_cash'') OR public.can_operate_club(club_id,''view_reports''))',t);
 EXECUTE format('CREATE POLICY snoop_permission_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.can_operate_club(club_id,''use_cash''))',t);
 EXECUTE format('CREATE POLICY snoop_permission_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.can_operate_club(club_id,''use_cash'')) WITH CHECK(public.can_operate_club(club_id,''use_cash''))',t);
 EXECUTE format('CREATE POLICY snoop_permission_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING(public.is_current_user_club_admin(club_id))',t);
 END LOOP;
END $orders$;

-- Identity/status only. Never returns members, documents, balances or inventory.
CREATE OR REPLACE FUNCTION public.snoop_access_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.user_roles; c public.clubs; operational boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 IF public.is_super_admin(auth.uid()) THEN RETURN jsonb_build_object('role','super_admin','permissions','[]'::jsonb,'clubId',NULL,'status','platform'); END IF;
 SELECT * INTO r FROM public.user_roles WHERE user_id=auth.uid() AND role IN('admin','collaborator') AND club_id IS NOT NULL ORDER BY (role='admin') DESC,club_id,id LIMIT 1;
 IF r.id IS NULL THEN RETURN jsonb_build_object('role',NULL,'permissions','[]'::jsonb,'clubId',NULL,'status','unassigned'); END IF;
 SELECT * INTO c FROM public.clubs WHERE id=r.club_id;
 operational:=public.can_operate_club(r.club_id,NULL);
 RETURN jsonb_build_object('role',r.role,'permissions',CASE WHEN NOT operational THEN '[]'::jsonb WHEN r.role='admin' THEN to_jsonb(ARRAY['manage_members','manage_products','manage_collaborators','view_reports','use_cash']) ELSE to_jsonb(r.permissions) END,
 'clubId',c.id,'clubName',c.name,'clubLogo',c.logo_url,'status',CASE WHEN NOT c.active THEN 'suspended' WHEN NOT operational THEN 'expired' ELSE 'active' END);
END;
$$;
REVOKE ALL ON FUNCTION public.snoop_access_context() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_access_context() TO authenticated;

CREATE OR REPLACE FUNCTION public.record_membership_receipt(
 p_club_id uuid, p_member_id uuid, p_amount_cents integer,
 p_payment_method text, p_description text, p_request_id uuid
) RETURNS public.membership_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE receipt public.membership_receipts; m public.members; operator_label text;
BEGIN
 IF NOT public.can_operate_club(p_club_id,'use_cash') THEN RAISE EXCEPTION 'Club operation denied' USING ERRCODE='42501'; END IF;
 IF auth.uid() IS NULL OR NOT (public.is_super_admin(auth.uid()) OR EXISTS (
   SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.club_id = p_club_id
    AND p_club_id = public.current_club_id() AND (r.role = 'admin' OR 'use_cash' = ANY(r.permissions))
 )) THEN RAISE EXCEPTION 'No tienes permiso para registrar ingresos en este club' USING ERRCODE = '42501'; END IF;
 IF p_request_id IS NULL OR p_amount_cents IS NULL OR p_amount_cents <= 0
   OR p_payment_method IS NULL OR p_payment_method NOT IN ('cash','card','transfer','other')
   OR p_description IS NULL OR length(trim(p_description)) NOT BETWEEN 1 AND 240
 THEN RAISE EXCEPTION 'Datos del recibo no válidos' USING ERRCODE = '22023'; END IF;
 SELECT * INTO m FROM public.members WHERE id = p_member_id AND club_id = p_club_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Socio no disponible en este club' USING ERRCODE = '22023'; END IF;
 SELECT coalesce(nullif(trim(full_name),''), 'Operador') INTO operator_label FROM public.profiles WHERE id = auth.uid();
 INSERT INTO public.membership_receipts(club_id,member_id,member_number,member_name,recorded_by,operator_name,amount_cents,payment_method,description,request_id)
 VALUES(p_club_id,m.id,m.member_number,concat_ws(' ',m.first_name,m.last_name),auth.uid(),coalesce(operator_label,'Operador'),p_amount_cents,p_payment_method,trim(p_description),p_request_id)
 ON CONFLICT (club_id,request_id) DO NOTHING RETURNING * INTO receipt;
 IF receipt.id IS NULL THEN
   SELECT * INTO receipt FROM public.membership_receipts WHERE club_id = p_club_id AND request_id = p_request_id;
   IF receipt.member_id <> p_member_id OR receipt.amount_cents <> p_amount_cents OR receipt.payment_method <> p_payment_method
     OR receipt.description <> trim(p_description) OR receipt.recorded_by <> auth.uid()
   THEN RAISE EXCEPTION 'Solicitud repetida con datos distintos' USING ERRCODE = '22023'; END IF;
 END IF;
 RETURN receipt;
END;
$$;

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
  IF NOT public.can_operate_club(_club,'use_cash') THEN RAISE EXCEPTION 'Club operation denied' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.can_access_snoop_document(object_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE target uuid; fragment text;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 IF public.is_super_admin(auth.uid()) THEN RETURN false; END IF;
 IF split_part(object_path,'/',1)='clubs' AND split_part(object_path,'/',3)='members' THEN
   fragment:=split_part(object_path,'/',2);
   IF fragment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN false; END IF;
   target:=fragment::uuid;
 ELSIF split_part(object_path,'/',1)='members' THEN
   SELECT club_id INTO target FROM public.members WHERE id::text=split_part(object_path,'/',2);
 ELSE
   -- Older records can contain a different stored filename: resolve its owner,
   -- rather than opening the entire bucket or rewriting historical paths.
   SELECT CASE WHEN count(DISTINCT club_id)=1 THEN min(club_id::text)::uuid ELSE NULL END INTO target FROM public.members WHERE dni_photo_path=object_path OR signature_path=object_path;
 END IF;
 RETURN target IS NOT NULL AND (public.is_super_admin(auth.uid()) OR (target=public.current_club_id() AND public.can_manage_club_members(target)));
END;
$$;


-- Cash staff can look up the minimal identity needed for a receipt, not DNI,
-- addresses, birth dates, stored document paths or the full member registry.
CREATE OR REPLACE FUNCTION public.lookup_receipt_members(p_club_id uuid,p_query text)
RETURNS TABLE(id uuid,member_number text,first_name text,last_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pattern text;
BEGIN
 IF p_club_id IS DISTINCT FROM public.current_club_id() OR NOT public.can_operate_club(p_club_id,'use_cash') THEN RAISE EXCEPTION 'Club lookup denied' USING ERRCODE='42501'; END IF;
 IF p_query IS NULL OR length(trim(p_query))<2 OR length(p_query)>80 THEN RETURN; END IF;
 pattern:='%'||replace(replace(replace(trim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 RETURN QUERY SELECT m.id,m.member_number,m.first_name,m.last_name FROM public.members m WHERE m.club_id=p_club_id
 AND (m.member_number ILIKE pattern OR m.first_name ILIKE pattern OR m.last_name ILIKE pattern) ORDER BY m.member_number,m.id LIMIT 30;
END;
$$;
REVOKE ALL ON FUNCTION public.lookup_receipt_members(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lookup_receipt_members(uuid,text) TO authenticated;

COMMIT;

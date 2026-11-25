-- REVIEW ONLY: replaces the previous UNAPPLIED proposal, not an upgrade to run blindly.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.snoop_voice_executions') IS NOT NULL OR to_regprocedure('public.snoop_voice_access(uuid,text,boolean,uuid)') IS NOT NULL OR to_regprocedure('public.snoop_voice_command(uuid,text,text,jsonb,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'VOICE_EXECUTION_SCHEMA_ALREADY_PRESENT_REVIEW_UPGRADE';END IF;
 IF to_regprocedure('public.snoop_get_club_access_control()') IS NULL OR
 to_regprocedure('public.snoop_set_club_access_control(boolean)') IS NULL OR
 to_regprocedure('public.manage_administrative_category(uuid,text,boolean)') IS NULL OR
 to_regprocedure('public.save_administrative_product_checked(uuid,jsonb,numeric)') IS NULL OR
 (to_regprocedure('public.confirm_membership_with_receipt(jsonb,uuid,text,uuid,boolean,date,integer)') IS NULL AND to_regprocedure('public.confirm_membership_with_receipt(integer,date,jsonb,text,uuid,boolean,uuid)') IS NULL) THEN
 RAISE EXCEPTION 'VOICE_EXECUTION_DEPENDENCY_MISSING'; END IF;
 IF to_regclass('public.member_discounts') IS NULL OR to_regclass('public.member_discount_assignments') IS NULL OR to_regclass('public.club_member_field_config') IS NULL THEN RAISE EXCEPTION 'VOICE_EXECUTION_DEPENDENCY_MISSING';END IF;
END $$;
-- Personal search text is a POST body argument, never a URL query parameter.
CREATE FUNCTION public.snoop_voice_find_members(p_query text,p_club uuid,p_limit integer DEFAULT 7)
RETURNS TABLE(id uuid,first_name text,last_name text,city text,expires_at date)
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_club IS DISTINCT FROM public.current_club_id() OR public.can_operate_club(p_club,'manage_members') IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 IF p_query IS NULL OR length(p_query)>100 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'VOICE_INVALID_QUERY';END IF;
 RETURN QUERY SELECT m.id,m.first_name::text,m.last_name::text,m.city::text,m.expires_at
 FROM public.members m WHERE m.club_id=p_club AND NOT EXISTS(
 SELECT 1 FROM regexp_split_to_table(trim(p_query),'\s+') AS term WHERE term<>'' AND position(lower(term) in lower(concat_ws(' ',m.first_name,m.last_name)))=0)
 ORDER BY m.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_find_members(text,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_voice_find_members(text,uuid,integer) TO authenticated;
CREATE FUNCTION public.snoop_voice_finance_search(p_kind text,p_query text,p_club uuid,p_limit integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_club IS DISTINCT FROM public.current_club_id() OR public.can_operate_club(p_club,NULL) IS DISTINCT FROM true OR public.is_current_user_club_admin(p_club) IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 IF p_query IS NULL OR length(p_query)>100 OR p_limit NOT BETWEEN 1 AND 7 OR p_limit IS NULL THEN RAISE EXCEPTION 'VOICE_INVALID_QUERY';END IF;
 IF p_kind='suppliers' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO result FROM (SELECT id,name FROM public.snoop_suppliers WHERE club_id=p_club AND position(lower(p_query) in lower(name))>0 ORDER BY id LIMIT p_limit) t;
 ELSIF p_kind='expenses' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO result FROM (SELECT id,description,amount_cents,payment_method,occurred_on,cancelled_at FROM public.snoop_expenses WHERE club_id=p_club AND position(lower(p_query) in lower(description))>0 ORDER BY occurred_on DESC,id LIMIT p_limit) t;
 ELSIF p_kind='purchases' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO result FROM (SELECT id,reference,description,amount_cents,status FROM public.snoop_purchases WHERE club_id=p_club AND position(lower(p_query) in lower(description||' '||reference))>0 ORDER BY id LIMIT p_limit) t;
 ELSE RAISE EXCEPTION 'VOICE_INVALID_QUERY';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_finance_search(text,text,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_voice_finance_search(text,text,uuid,integer) TO authenticated;
CREATE FUNCTION public.snoop_voice_collaborators(p_query text,p_club uuid,p_limit integer DEFAULT 7)
RETURNS TABLE(id uuid,name text) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_club IS DISTINCT FROM public.current_club_id() OR public.can_operate_club(p_club,NULL) IS DISTINCT FROM true OR public.is_current_user_club_admin(p_club) IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 IF p_query IS NULL OR length(p_query)>100 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'VOICE_INVALID_QUERY';END IF;
 RETURN QUERY SELECT r.user_id,p.full_name::text FROM public.user_roles r JOIN public.profiles p ON p.id=r.user_id
 WHERE r.club_id=p_club AND r.role IN ('admin','collaborator') AND position(lower(p_query) in lower(coalesce(p.full_name,'')))>0 ORDER BY r.user_id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_collaborators(text,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_voice_collaborators(text,uuid,integer) TO authenticated;

CREATE TABLE public.snoop_voice_executions (
 id uuid PRIMARY KEY, actor uuid NOT NULL, club uuid NOT NULL,
 token uuid NOT NULL DEFAULT gen_random_uuid(), action text NOT NULL,
 arguments jsonb NOT NULL, expected jsonb NOT NULL, summary jsonb NOT NULL,
 prepared_at timestamptz NOT NULL DEFAULT now(), receipt_confirmed_at timestamptz, completed_at timestamptz,cancelled_at timestamptz,result jsonb
);
ALTER TABLE public.snoop_voice_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.snoop_voice_executions FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.snoop_voice_authorized(p_action text,p_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND p_club=public.current_club_id() AND public.can_operate_club(p_club,NULL) IS TRUE AND
 CASE p_action WHEN 'access_control.set' THEN public.is_current_user_club_admin(p_club)
 WHEN 'theme.set' THEN public.is_current_user_club_admin(p_club)
 WHEN 'collaborator.permissions.set' THEN public.is_current_user_club_admin(p_club)
 WHEN 'collaborator.revoke' THEN public.is_current_user_club_admin(p_club)
 WHEN 'finance.supplier.create' THEN public.is_current_user_club_admin(p_club)
 WHEN 'finance.expense.create' THEN public.is_current_user_club_admin(p_club)
 WHEN 'finance.expense.cancel' THEN public.is_current_user_club_admin(p_club)
 WHEN 'finance.purchase.record' THEN public.is_current_user_club_admin(p_club)
 WHEN 'product.create' THEN public.can_manage_snoop_catalog(p_club)
 WHEN 'product.update' THEN public.can_manage_snoop_catalog(p_club)
 WHEN 'stock.adjust' THEN public.can_manage_snoop_catalog(p_club)
 WHEN 'category.create' THEN public.can_manage_snoop_catalog(p_club)
 WHEN 'category.update' THEN public.can_manage_snoop_catalog(p_club)
 WHEN 'product.description' THEN public.can_manage_snoop_catalog(p_club)
 WHEN 'member.renew' THEN public.can_operate_club(p_club,'manage_members')
 WHEN 'wallet.configure' THEN public.is_current_user_club_admin(p_club)
 WHEN 'wallet.topup' THEN public.can_operate_club(p_club,'use_cash') AND public.can_operate_club(p_club,'manage_members')
 WHEN 'wallet.topup.reverse' THEN public.can_operate_club(p_club,'use_cash') AND public.can_operate_club(p_club,'manage_members')
 WHEN 'member.create' THEN public.can_operate_club(p_club,'manage_members')
 WHEN 'member_field.set' THEN public.is_current_user_club_admin(p_club)
 WHEN 'member.update' THEN public.can_operate_club(p_club,'manage_members')
 WHEN 'cash.open' THEN public.can_operate_club(p_club,'use_cash')
 WHEN 'cash.close' THEN public.can_operate_club(p_club,'use_cash')
 WHEN 'fee.create' THEN public.is_current_user_club_admin(p_club)
 WHEN 'fee.update' THEN public.is_current_user_club_admin(p_club)
 WHEN 'discount.create' THEN public.is_current_user_club_admin(p_club)
 WHEN 'discount.update' THEN public.is_current_user_club_admin(p_club)
 WHEN 'member.discount.set' THEN public.is_current_user_club_admin(p_club)
 WHEN 'member.discount.clear' THEN public.is_current_user_club_admin(p_club)
 ELSE false END IS TRUE;
$$;
REVOKE ALL ON FUNCTION public.snoop_voice_authorized(text,uuid) FROM PUBLIC,anon,authenticated;
-- Support both the historical fixture signature and the owner-verified current Pilot
-- signature. The original receipt RPC still validates fee, role and idempotency.
CREATE FUNCTION public.snoop_voice_membership(p_member jsonb,p_plan uuid,p_method text,p_request uuid,p_renew boolean,p_expected date,p_cents integer)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF to_regprocedure('public.confirm_membership_with_receipt(integer,date,jsonb,text,uuid,boolean,uuid)') IS NOT NULL THEN
  RETURN public.confirm_membership_with_receipt(p_cents,p_expected,p_member,p_method,p_plan,p_renew,p_request);
 END IF;
 RETURN public.confirm_membership_with_receipt(p_member,p_plan,p_method,p_request,p_renew,p_expected,p_cents);
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_membership(jsonb,uuid,text,uuid,boolean,date,integer) FROM PUBLIC,anon,authenticated;

-- Same table operations as existing manual PostgREST APIs; existing constraints,
-- audit triggers and accounting RPCs remain authoritative. Private dispatch only.
CREATE FUNCTION public.snoop_voice_entity(p_action text,p_args jsonb,p_apply boolean,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid:=public.current_club_id();a uuid:=auth.uid();v jsonb;desired jsonb;result jsonb;rid uuid;d date:=(now() AT TIME ZONE 'Europe/Madrid')::date;k text;allowed text[];required_keys text[];
BEGIN
 IF public.snoop_voice_authorized(p_action,c) IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 CASE p_action
 WHEN 'theme.set' THEN allowed:=ARRAY['theme_id'];required_keys:=allowed;
 WHEN 'collaborator.permissions.set' THEN allowed:=ARRAY['id','permissions'];required_keys:=allowed;
 WHEN 'collaborator.revoke' THEN allowed:=ARRAY['id'];required_keys:=allowed;
 WHEN 'finance.supplier.create' THEN allowed:=ARRAY['name','contact','notes'];required_keys:=allowed;
 WHEN 'finance.expense.create' THEN allowed:=ARRAY['supplier_id','category','description','amount_cents','payment_method'];required_keys:=allowed;
 WHEN 'finance.expense.cancel' THEN allowed:=ARRAY['id','reason'];required_keys:=allowed;
 WHEN 'finance.purchase.record' THEN allowed:=ARRAY['supplier_id','reference','description','amount_cents'];required_keys:=allowed;
 WHEN 'member_field.set' THEN allowed:=ARRAY['field_key','visible','required'];required_keys:=allowed;
 WHEN 'category.create' THEN allowed:=ARRAY['name','unit_type','is_smokeable'];required_keys:=allowed;
 WHEN 'member.update' THEN allowed:=ARRAY['id','first_name','last_name','birth_date','city','phone','email'];required_keys:=ARRAY['id'];
 WHEN 'fee.create' THEN allowed:=ARRAY['name','duration_days','price_cents','active'];required_keys:=allowed;
 WHEN 'fee.update' THEN allowed:=ARRAY['id','name','duration_days','price_cents','active'];required_keys:=allowed;
 WHEN 'discount.create' THEN allowed:=ARRAY['name','percentage_basis_points','active','valid_from','valid_until'];required_keys:=allowed;
 WHEN 'discount.update' THEN allowed:=ARRAY['id','name','percentage_basis_points','active','valid_from','valid_until'];required_keys:=allowed;
 WHEN 'member.discount.set' THEN allowed:=ARRAY['member_id','discount_id'];required_keys:=allowed;
 WHEN 'member.discount.clear' THEN allowed:=ARRAY['member_id'];required_keys:=allowed;
 WHEN 'cash.open' THEN allowed:=ARRAY['opening_cash_cents'];required_keys:=allowed;
 WHEN 'cash.close' THEN allowed:=ARRAY['id','closing_cash_cents','notes'];required_keys:=allowed;
 ELSE RAISE EXCEPTION 'VOICE_ACTION_NOT_REGISTERED';END CASE;
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR p_args-allowed<>'{}'::jsonb OR NOT(p_args?&required_keys) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
 FOR k IN SELECT jsonb_object_keys(p_args) LOOP
  IF k='permissions' THEN
   IF jsonb_typeof(p_args->k) IS DISTINCT FROM 'array' OR jsonb_array_length(p_args->k) NOT BETWEEN 1 AND 5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_args->k) p WHERE jsonb_typeof(p) IS DISTINCT FROM 'string' OR (p#>>'{}') NOT IN ('manage_members','manage_products','view_reports','use_cash','manage_collaborators')) OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_args->k))<>jsonb_array_length(p_args->k) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  ELSIF k=ANY(ARRAY['opening_cash_cents','closing_cash_cents','price_cents','duration_days','percentage_basis_points','amount_cents']) THEN
   IF jsonb_typeof(p_args->k) IS DISTINCT FROM 'number' OR (p_args->>k)::numeric<>trunc((p_args->>k)::numeric) OR (p_args->>k)::numeric NOT BETWEEN 0 AND (CASE WHEN p_action LIKE 'finance.%' THEN 100000000 ELSE 10000000 END) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  ELSIF k=ANY(ARRAY['active','is_smokeable','visible','required']) THEN
   IF jsonb_typeof(p_args->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  ELSIF k=ANY(ARRAY['valid_from','valid_until']) THEN
   IF p_args->k<>'null'::jsonb AND (jsonb_typeof(p_args->k) IS DISTINCT FROM 'string' OR (p_args->>k)!~'^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
   PERFORM (p_args->>k)::date;
  ELSIF k='supplier_id' AND p_args->k='null'::jsonb THEN NULL;
  ELSE
   IF jsonb_typeof(p_args->k) IS DISTINCT FROM 'string' OR length(p_args->>k)>2000 THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  END IF;
 END LOOP;
 IF p_args?'name' AND length(trim(p_args->>'name')) NOT BETWEEN 1 AND (CASE WHEN p_action LIKE 'discount.%' THEN 100 WHEN p_action='finance.supplier.create' THEN 160 ELSE 120 END) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
 IF p_action='theme.set' THEN
  IF to_regclass('public.snoop_club_themes') IS NULL THEN RAISE EXCEPTION 'VOICE_THEME_UNAVAILABLE';END IF;
  IF (p_args->>'theme_id') NOT IN ('navy-gold','graphite-copper','aubergine-amethyst','petrol-titanium','ivory-champagne','ruby-gold','emerald-gold') THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  SELECT to_jsonb(t) INTO v FROM public.snoop_club_themes t WHERE club_id=c FOR UPDATE;
  v:=coalesce(v,jsonb_build_object('theme_id','navy-gold','configured',false));
  IF p_apply THEN
   INSERT INTO public.snoop_club_themes(club_id,theme_id) VALUES(c,p_args->>'theme_id') ON CONFLICT(club_id) DO UPDATE SET theme_id=excluded.theme_id;
   SELECT jsonb_build_object('id',club_id,'theme_id',theme_id) INTO result FROM public.snoop_club_themes WHERE club_id=c;
   desired:=p_args;
  END IF;
 END IF;
 IF p_action IN ('collaborator.permissions.set','collaborator.revoke') THEN
  SELECT to_jsonb(r)||jsonb_build_object('name',p.full_name) INTO v FROM public.user_roles r LEFT JOIN public.profiles p ON p.id=r.user_id
   WHERE r.user_id=(p_args->>'id')::uuid AND r.club_id=c AND r.role='collaborator' FOR UPDATE OF r;
  IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  IF p_apply THEN
   IF p_action='collaborator.permissions.set' THEN
    UPDATE public.user_roles SET permissions=ARRAY(SELECT jsonb_array_elements_text(p_args->'permissions'))::public.app_permission[] WHERE id=(v->>'id')::uuid AND club_id=c AND role='collaborator';
    SELECT jsonb_build_object('id',user_id,'permissions',permissions) INTO result FROM public.user_roles WHERE id=(v->>'id')::uuid AND club_id=c AND role='collaborator';
    desired:=p_args;
   ELSE
    DELETE FROM public.user_roles WHERE id=(v->>'id')::uuid AND club_id=c AND role='collaborator';
    IF EXISTS(SELECT 1 FROM public.user_roles WHERE id=(v->>'id')::uuid) THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    result:=jsonb_build_object('id',p_args->'id','revoked',true);desired:=result;
   END IF;
  END IF;
 END IF;
 IF p_action LIKE 'finance.%' THEN
  IF to_regclass('public.snoop_suppliers') IS NULL OR to_regclass('public.snoop_expenses') IS NULL OR to_regclass('public.snoop_purchases') IS NULL THEN RAISE EXCEPTION 'VOICE_FINANCE_UNAVAILABLE';END IF;
  IF p_action='finance.supplier.create' THEN
   IF length(trim(p_args->>'name'))<2 OR length(p_args->>'contact')>300 OR length(p_args->>'notes')>1000 THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
   IF EXISTS(SELECT 1 FROM public.snoop_suppliers WHERE club_id=c AND lower(trim(name))=lower(trim(p_args->>'name'))) THEN RAISE EXCEPTION 'VOICE_DUPLICATE_NAME';END IF;
   v:='{}'::jsonb;
   IF p_apply THEN INSERT INTO public.snoop_suppliers(id,club_id,created_by,name,contact,notes) VALUES(p_request,c,a,trim(p_args->>'name'),p_args->>'contact',p_args->>'notes');
    SELECT jsonb_build_object('id',id,'name',name,'contact',contact,'notes',notes) INTO result FROM public.snoop_suppliers WHERE id=p_request AND club_id=c;
    desired:=p_args;END IF;
  ELSIF p_action='finance.expense.cancel' THEN
   IF length(trim(p_args->>'reason')) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
   SELECT to_jsonb(t) INTO v FROM public.snoop_expenses t WHERE id=(p_args->>'id')::uuid AND club_id=c AND cancelled_at IS NULL FOR UPDATE;
   IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
   IF p_apply THEN PERFORM public.snoop_cancel_expense((p_args->>'id')::uuid,p_args->>'reason');
    SELECT jsonb_build_object('id',id,'cancelled_by',cancelled_by,'cancelled_at',cancelled_at,'cancel_reason',cancel_reason) INTO result FROM public.snoop_expenses WHERE id=(p_args->>'id')::uuid AND club_id=c;
    desired:=jsonb_build_object('cancelled_by',a,'cancel_reason',p_args->>'reason');END IF;
  ELSE
   IF (p_args->>'amount_cents')::int NOT BETWEEN 1 AND 100000000 OR length(trim(p_args->>'description')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
   v:=jsonb_build_object('supplier',NULL);
   IF p_args->>'supplier_id' IS NOT NULL THEN
    SELECT jsonb_build_object('supplier',jsonb_build_object('id',id,'name',name)) INTO v FROM public.snoop_suppliers WHERE id=(p_args->>'supplier_id')::uuid AND club_id=c FOR SHARE;
    IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
   END IF;
   IF p_action='finance.expense.create' AND ((p_args->>'category') NOT IN ('alquiler','suministros','personal','mantenimiento','compras','otros') OR (p_args->>'payment_method') NOT IN ('efectivo','banco','pendiente')) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
   IF p_action='finance.purchase.record' AND (p_args->>'supplier_id' IS NULL OR length(p_args->>'reference')>120) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
   IF p_apply THEN
    IF p_action='finance.expense.create' THEN
     INSERT INTO public.snoop_expenses(id,club_id,request_id,created_by,supplier_id,category,description,amount_cents,payment_method) VALUES(p_request,c,p_request,a,(p_args->>'supplier_id')::uuid,p_args->>'category',trim(p_args->>'description'),(p_args->>'amount_cents')::int,p_args->>'payment_method');
     SELECT jsonb_build_object('id',id,'amount_cents',amount_cents,'payment_method',payment_method,'description',description) INTO result FROM public.snoop_expenses WHERE id=p_request AND club_id=c;
     desired:=p_args-ARRAY['supplier_id','category'];
    ELSE
     INSERT INTO public.snoop_purchases(id,club_id,request_id,created_by,supplier_id,reference,description,amount_cents,status) VALUES(p_request,c,p_request,a,(p_args->>'supplier_id')::uuid,p_args->>'reference',trim(p_args->>'description'),(p_args->>'amount_cents')::int,'pendiente');
     SELECT jsonb_build_object('id',id,'status',status,'amount_cents',amount_cents,'reference',reference) INTO result FROM public.snoop_purchases WHERE id=p_request AND club_id=c;
     desired:=jsonb_build_object('status','pendiente','amount_cents',p_args->'amount_cents','reference',p_args->'reference');
    END IF;
   END IF;
  END IF;
 ELSIF p_action='member_field.set' THEN
  IF (p_args->>'field_key') NOT IN ('birth_date','dni_number','dni_photo','address','city','postal_code','phone','email','plan','signature','avalador') THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  SELECT coalesce((SELECT to_jsonb(t) FROM public.club_member_field_config t WHERE club_id=c AND field_key=p_args->>'field_key' FOR UPDATE),'{}'::jsonb) INTO v;
  IF p_apply THEN
   INSERT INTO public.club_member_field_config(club_id,field_key,visible,required) VALUES(c,p_args->>'field_key',(p_args->>'visible')::boolean,(p_args->>'required')::boolean) ON CONFLICT(club_id,field_key) DO UPDATE SET visible=excluded.visible,required=excluded.required;
   SELECT jsonb_build_object('id',id,'field_key',field_key,'visible',visible,'required',required) INTO result FROM public.club_member_field_config WHERE club_id=c AND field_key=p_args->>'field_key';
   desired:=p_args;
  END IF;
 ELSIF p_action='category.create' THEN
  IF (p_args->>'unit_type') NOT IN ('gr','unit') THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF EXISTS(SELECT 1 FROM public.product_categories WHERE club_id=c AND lower(trim(name))=lower(trim(p_args->>'name'))) THEN RAISE EXCEPTION 'VOICE_DUPLICATE_NAME';END IF;
  v:='{"available":true}'::jsonb;
  IF p_apply THEN
   INSERT INTO public.product_categories(id,club_id,name,unit_type,is_smokeable) VALUES(p_request,c,trim(p_args->>'name'),(p_args->>'unit_type')::public.product_unit,(p_args->>'is_smokeable')::boolean);
   SELECT jsonb_build_object('id',id,'name',name,'unit_type',unit_type,'is_smokeable',is_smokeable) INTO result FROM public.product_categories WHERE id=p_request AND club_id=c;
   desired:=jsonb_build_object('name',trim(p_args->>'name'),'unit_type',p_args->'unit_type','is_smokeable',p_args->'is_smokeable');
  END IF;
 ELSIF p_action='member.update' THEN
  IF p_args-'id'='{}'::jsonb THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  SELECT jsonb_build_object('id',m.id,'first_name',first_name,'last_name',last_name,'birth_date',birth_date,'city',city,'phone',phone,'email',email,'has_document',length(trim(coalesce(dni_number,'')))>0,'updated_at',updated_at) INTO v FROM public.members m WHERE m.id=(p_args->>'id')::uuid AND club_id=c FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  desired:=v||(p_args-'id');
  IF length(trim(desired->>'first_name')) NOT BETWEEN 1 AND 120 OR length(trim(desired->>'last_name')) NOT BETWEEN 1 AND 120 OR (desired->>'has_document')::boolean IS DISTINCT FROM true OR (desired->>'birth_date')!~'^\d{4}-\d{2}-\d{2}$' OR (desired->>'birth_date')::date>d-interval '18 years' OR (desired->>'birth_date')::date<'1900-01-01'::date OR length(coalesce(desired->>'city',''))>200 OR length(coalesce(desired->>'phone',''))>50 OR length(coalesce(desired->>'email',''))>254 OR (coalesce(desired->>'email','')<>'' AND (desired->>'email')!~'^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN RAISE EXCEPTION 'VOICE_INVALID_MEMBER';END IF;
  IF p_apply THEN
   UPDATE public.members SET first_name=trim(desired->>'first_name'),last_name=trim(desired->>'last_name'),birth_date=(desired->>'birth_date')::date,city=nullif(trim(desired->>'city'),''),phone=nullif(trim(desired->>'phone'),''),email=nullif(trim(desired->>'email'),'') WHERE id=(p_args->>'id')::uuid AND club_id=c;
   SELECT jsonb_build_object('id',id,'first_name',first_name,'last_name',last_name,'birth_date',birth_date,'city',coalesce(city,''),'phone',coalesce(phone,''),'email',coalesce(email,'')) INTO result FROM public.members WHERE id=(p_args->>'id')::uuid AND club_id=c;
   desired:=jsonb_build_object('first_name',trim(desired->>'first_name'),'last_name',trim(desired->>'last_name'),'birth_date',desired->'birth_date','city',coalesce(nullif(trim(desired->>'city'),''),''),'phone',coalesce(nullif(trim(desired->>'phone'),''),''),'email',coalesce(nullif(trim(desired->>'email'),''),''));
  END IF;
 ELSIF p_action IN ('fee.create','fee.update') THEN
  IF (p_args->>'duration_days')::integer NOT BETWEEN 1 AND 36600 THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF p_action='fee.update' THEN SELECT to_jsonb(t) INTO v FROM public.membership_plans t WHERE id=(p_args->>'id')::uuid AND club_id=c FOR UPDATE;
  ELSE
   IF EXISTS(SELECT 1 FROM public.membership_plans WHERE club_id=c AND lower(trim(name))=lower(trim(p_args->>'name'))) THEN RAISE EXCEPTION 'VOICE_DUPLICATE_NAME';END IF;
   v:='{"available":true}'::jsonb;
  END IF;
  IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  IF p_apply THEN
   rid:=CASE WHEN p_action='fee.create' THEN p_request ELSE (p_args->>'id')::uuid END;
   IF p_action='fee.create' THEN INSERT INTO public.membership_plans(id,club_id,name,duration_days,price_cents,active) VALUES(rid,c,trim(p_args->>'name'),(p_args->>'duration_days')::int,(p_args->>'price_cents')::int,(p_args->>'active')::boolean);
   ELSE UPDATE public.membership_plans SET name=trim(p_args->>'name'),duration_days=(p_args->>'duration_days')::int,price_cents=(p_args->>'price_cents')::int,active=(p_args->>'active')::boolean WHERE id=rid AND club_id=c;END IF;
   SELECT jsonb_build_object('id',id,'name',name,'duration_days',duration_days,'price_cents',price_cents,'active',active) INTO result FROM public.membership_plans WHERE id=rid AND club_id=c;
   desired:=(p_args-'id')||jsonb_build_object('name',trim(p_args->>'name'));
  END IF;
 ELSIF p_action IN ('discount.create','discount.update') THEN
  IF (p_args->>'percentage_basis_points')::int NOT BETWEEN 1 AND 10000 OR (p_args->>'valid_from')::date>(p_args->>'valid_until')::date THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF p_action='discount.update' THEN SELECT to_jsonb(t) INTO v FROM public.member_discounts t WHERE id=(p_args->>'id')::uuid AND club_id=c FOR UPDATE;
  ELSE
   IF EXISTS(SELECT 1 FROM public.member_discounts WHERE club_id=c AND lower(trim(name))=lower(trim(p_args->>'name'))) THEN RAISE EXCEPTION 'VOICE_DUPLICATE_NAME';END IF;
   v:='{"available":true}'::jsonb;
  END IF;
  IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  IF p_apply THEN
   rid:=CASE WHEN p_action='discount.create' THEN p_request ELSE (p_args->>'id')::uuid END;
   IF p_action='discount.create' THEN INSERT INTO public.member_discounts(id,club_id,name,percentage_basis_points,active,valid_from,valid_until) VALUES(rid,c,trim(p_args->>'name'),(p_args->>'percentage_basis_points')::int,(p_args->>'active')::boolean,(p_args->>'valid_from')::date,(p_args->>'valid_until')::date);
   ELSE UPDATE public.member_discounts SET name=trim(p_args->>'name'),percentage_basis_points=(p_args->>'percentage_basis_points')::int,active=(p_args->>'active')::boolean,valid_from=(p_args->>'valid_from')::date,valid_until=(p_args->>'valid_until')::date WHERE id=rid AND club_id=c;END IF;
   SELECT jsonb_build_object('id',id,'name',name,'percentage_basis_points',percentage_basis_points,'active',active,'valid_from',valid_from,'valid_until',valid_until) INTO result FROM public.member_discounts t WHERE id=rid AND club_id=c;
   desired:=(p_args-'id')||jsonb_build_object('name',trim(p_args->>'name'));
  END IF;
 ELSIF p_action IN ('member.discount.set','member.discount.clear') THEN
  SELECT jsonb_build_object('id',m.id,'updated_at',m.updated_at,'assignment',(SELECT to_jsonb(x) FROM public.member_discount_assignments x WHERE x.member_id=m.id AND x.club_id=c)) INTO v FROM public.members m WHERE id=(p_args->>'member_id')::uuid AND club_id=c FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  IF p_action='member.discount.set' THEN
   SELECT v||jsonb_build_object('discount',to_jsonb(t)) INTO v FROM public.member_discounts t WHERE id=(p_args->>'discount_id')::uuid AND club_id=c AND active AND (valid_from IS NULL OR valid_from<=d) AND (valid_until IS NULL OR valid_until>=d) FOR SHARE;
   IF v IS NULL THEN RAISE EXCEPTION 'VOICE_DISCOUNT_UNAVAILABLE';END IF;
  END IF;
  IF p_apply THEN
   IF p_action='member.discount.clear' THEN DELETE FROM public.member_discount_assignments WHERE member_id=(p_args->>'member_id')::uuid AND club_id=c;
   ELSE INSERT INTO public.member_discount_assignments(member_id,club_id,discount_id) VALUES((p_args->>'member_id')::uuid,c,(p_args->>'discount_id')::uuid) ON CONFLICT(member_id) DO UPDATE SET discount_id=excluded.discount_id WHERE member_discount_assignments.club_id=c;END IF;
   result:=jsonb_build_object('id',p_args->'member_id','discount_id',(SELECT discount_id FROM public.member_discount_assignments WHERE member_id=(p_args->>'member_id')::uuid AND club_id=c));
   desired:=jsonb_build_object('discount_id',CASE WHEN p_action='member.discount.clear' THEN 'null'::jsonb ELSE p_args->'discount_id' END);
  END IF;
 ELSIF p_action IN ('cash.open','cash.close') THEN
  IF to_regprocedure('public.snoop_cash_session_audit()') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.cash_sessions'::regclass AND tgname='snoop_cash_session_audit' AND tgenabled='O') THEN RAISE EXCEPTION 'VOICE_CASH_AUDIT_REQUIRED';END IF;
  IF p_action='cash.open' THEN
   IF EXISTS(SELECT 1 FROM public.cash_sessions WHERE club_id=c AND user_id=a AND status='open') THEN RAISE EXCEPTION 'VOICE_CASH_ALREADY_OPEN';END IF;
   v:='{"available":true}'::jsonb;
  ELSE
   SELECT to_jsonb(t) INTO v FROM public.cash_sessions t WHERE id=(p_args->>'id')::uuid AND club_id=c AND user_id=a AND status='open' FOR UPDATE;
  END IF;
  IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  IF p_apply THEN
   rid:=CASE WHEN p_action='cash.open' THEN p_request ELSE (p_args->>'id')::uuid END;
   IF p_action='cash.open' THEN INSERT INTO public.cash_sessions(id,club_id,user_id,opening_cash_cents) VALUES(rid,c,a,(p_args->>'opening_cash_cents')::int);
   ELSE UPDATE public.cash_sessions SET status='closed',closing_cash_cents=(p_args->>'closing_cash_cents')::int,notes=p_args->>'notes',closed_at=now() WHERE id=rid AND club_id=c AND user_id=a AND status='open';END IF;
   SELECT jsonb_build_object('id',id,'status',status,'opening_cash_cents',opening_cash_cents,'closing_cash_cents',closing_cash_cents,'closed_by',closed_by) INTO result FROM public.cash_sessions WHERE id=rid AND club_id=c AND user_id=a;
   desired:=CASE WHEN p_action='cash.open' THEN jsonb_build_object('status','open','opening_cash_cents',p_args->'opening_cash_cents') ELSE jsonb_build_object('status','closed','closing_cash_cents',p_args->'closing_cash_cents','closed_by',a) END;
  END IF;
 END IF;
 IF p_apply THEN
  IF result IS NULL OR NOT(result@>desired) THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
  RETURN result;
 END IF;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_entity(text,jsonb,boolean,uuid) FROM PUBLIC,anon,authenticated;

-- Voice money arguments use explicit cents. The original catalog stores decimal EUR.
CREATE FUNCTION public.snoop_voice_catalog_values(p_args jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_args-ARRAY['buy_price_cents','sell_price_cents']
 ||CASE WHEN p_args?'buy_price_cents' THEN jsonb_build_object('buy_price',(p_args->>'buy_price_cents')::numeric/100) ELSE '{}'::jsonb END
 ||CASE WHEN p_args?'sell_price_cents' THEN jsonb_build_object('sell_price',(p_args->>'sell_price_cents')::numeric/100) ELSE '{}'::jsonb END;
$$;
REVOKE ALL ON FUNCTION public.snoop_voice_catalog_values(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.snoop_voice_snapshot(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid:=public.current_club_id();v jsonb;
BEGIN
 IF public.snoop_voice_authorized(p_action,c) IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_action IN ('product.create','product.update','product.description') THEN
  IF coalesce(position('buy numeric' in lower(pg_get_functiondef(to_regprocedure('public.save_administrative_product(uuid,jsonb)')))),0)=0 OR coalesce(position('sell numeric' in lower(pg_get_functiondef(to_regprocedure('public.save_administrative_product(uuid,jsonb)')))),0)=0 THEN RAISE EXCEPTION 'VOICE_LEGACY_PRICE_UNSUPPORTED';END IF;
 END IF;
 IF p_action IN ('product.create','product.update') THEN
  IF EXISTS(SELECT 1 FROM jsonb_each(p_args) e WHERE e.key IN ('buy_price_cents','sell_price_cents') AND (jsonb_typeof(e.value) IS DISTINCT FROM 'number' OR (e.value::text)::numeric<>trunc((e.value::text)::numeric) OR (e.value::text)::numeric NOT BETWEEN 0 AND 10000000)) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF p_args?'name' AND (jsonb_typeof(p_args->'name') IS DISTINCT FROM 'string' OR length(trim(p_args->>'name')) NOT BETWEEN 1 AND 120) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF p_args?'description' AND (jsonb_typeof(p_args->'description') IS DISTINCT FROM 'string' OR length(p_args->>'description')>4000) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF p_args?'notes' AND (jsonb_typeof(p_args->'notes') IS DISTINCT FROM 'string' OR length(p_args->>'notes')>1000) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF p_args?'active' AND jsonb_typeof(p_args->'active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF p_args?'strain' AND p_args->'strain'<>'null'::jsonb AND (p_args->>'strain') NOT IN ('sativa','indica','hybrid') THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
 END IF;
 CASE p_action
 WHEN 'access_control.set' THEN
  IF p_args - 'enabled'<>'{}'::jsonb OR jsonb_typeof(p_args->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'VOICE_VALUE_REQUIRED';END IF;
  v:=public.snoop_get_club_access_control();
 WHEN 'category.update' THEN
  IF p_args-ARRAY['id','name','archived']<>'{}'::jsonb OR jsonb_typeof(p_args->'name') IS DISTINCT FROM 'string' OR length(trim(p_args->>'name')) NOT BETWEEN 1 AND 120 OR jsonb_typeof(p_args->'archived') IS DISTINCT FROM 'boolean' OR NOT(p_args?'name') THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF public.can_manage_snoop_catalog(c) IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED';END IF;
  SELECT to_jsonb(t) INTO v FROM public.product_categories t WHERE id=(p_args->>'id')::uuid AND club_id=c FOR UPDATE;
 WHEN 'product.description' THEN
  IF p_args-ARRAY['id','description']<>'{}'::jsonb OR jsonb_typeof(p_args->'description') IS DISTINCT FROM 'string' OR length(trim(p_args->>'description')) NOT BETWEEN 1 AND 4000 OR NOT(p_args?'description') THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF public.can_manage_snoop_catalog(c) IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED';END IF;
  SELECT jsonb_build_object('id',id,'name',name,'category_id',category_id,'stock',stock,'buy_price',buy_price,'sell_price',sell_price,'strain',strain,'notes',notes,'description',description,'updated_at',updated_at) INTO v FROM public.products WHERE id=(p_args->>'id')::uuid AND club_id=c FOR UPDATE;
 WHEN 'product.create' THEN
  IF jsonb_typeof(p_args->'destination') IS DISTINCT FROM 'string' OR (p_args->>'destination') NOT IN ('almacen','dispensario') OR to_regprocedure('public.snoop_create_product_located(jsonb,text,uuid)') IS NULL THEN RAISE EXCEPTION 'VOICE_LOCATION_CONFIRMATION_REQUIRED';END IF;
  IF p_args-ARRAY['name','category_id','buy_price_cents','sell_price_cents','strain','notes','description','destination']<>'{}'::jsonb OR NOT(p_args?&ARRAY['name','category_id','buy_price_cents','sell_price_cents','strain','notes','description','destination']) OR jsonb_typeof(p_args->'name') IS DISTINCT FROM 'string' OR length(trim(p_args->>'name')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  SELECT to_jsonb(t) INTO v FROM public.product_categories t WHERE id=(p_args->>'category_id')::uuid AND club_id=c AND coalesce(archived,false)=false FOR SHARE;
  IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  IF EXISTS(SELECT 1 FROM public.products WHERE club_id=c AND lower(trim(name))=lower(trim(p_args->>'name'))) THEN RAISE EXCEPTION 'VOICE_DUPLICATE_NAME';END IF;
 WHEN 'product.update' THEN
  IF p_args-ARRAY['id','name','category_id','buy_price_cents','sell_price_cents','strain','notes','description','active']<>'{}'::jsonb OR p_args-'id'='{}'::jsonb THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  SELECT jsonb_build_object('id',id,'name',name,'category_id',category_id,'stock',stock,'buy_price',buy_price,'sell_price',sell_price,'strain',strain,'notes',notes,'description',description,'active',active,'updated_at',updated_at) INTO v FROM public.products WHERE id=(p_args->>'id')::uuid AND club_id=c FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  IF p_args?'category_id' THEN
   PERFORM 1 FROM public.product_categories WHERE id=(p_args->>'category_id')::uuid AND club_id=c AND coalesce(archived,false)=false FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  END IF;
 WHEN 'stock.adjust' THEN
  IF to_regclass('public.snoop_stock_locations') IS NOT NULL THEN RAISE EXCEPTION 'VOICE_DUAL_STOCK_REVIEW_REQUIRED';END IF;
  IF p_args-ARRAY['id','delta','notes']<>'{}'::jsonb OR NOT(p_args?&ARRAY['id','delta','notes']) OR jsonb_typeof(p_args->'delta') IS DISTINCT FROM 'string' OR (p_args->>'delta')!~'^-?\d{1,7}(\.\d{1,2})?$' OR (p_args->>'delta')::numeric=0 OR abs((p_args->>'delta')::numeric)>1000000 OR jsonb_typeof(p_args->'notes') IS DISTINCT FROM 'string' OR length(trim(p_args->>'notes')) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  SELECT jsonb_build_object('id',p.id,'name',p.name,'stock',p.stock,'category_id',p.category_id,'unit_type',cat.unit_type) INTO v FROM public.products p JOIN public.product_categories cat ON cat.id=p.category_id AND cat.club_id=c WHERE p.id=(p_args->>'id')::uuid AND p.club_id=c FOR UPDATE OF p FOR SHARE OF cat;
  IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  IF v->>'unit_type'='unit' AND (p_args->>'delta')::numeric<>trunc((p_args->>'delta')::numeric) THEN RAISE EXCEPTION 'VOICE_WHOLE_UNITS_REQUIRED';END IF;
  IF (v->>'stock')::numeric+(p_args->>'delta')::numeric<0 THEN RAISE EXCEPTION 'VOICE_INSUFFICIENT_STOCK';END IF;
 WHEN 'wallet.topup.reverse' THEN
  IF p_args-ARRAY['topup_id','cash_session_id','reason','method']<>'{}'::jsonb OR NOT(p_args?&ARRAY['topup_id','cash_session_id','reason','method']) OR jsonb_typeof(p_args->'reason') IS DISTINCT FROM 'string' OR length(trim(p_args->>'reason')) NOT BETWEEN 5 AND 2000 OR (p_args->>'method') NOT IN ('cash','card','transfer') OR jsonb_typeof(p_args->'method') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF to_regprocedure('public.socio_wallet_void_topup(uuid,uuid,uuid,text,text,boolean)') IS NULL THEN RAISE EXCEPTION 'VOICE_WALLET_UNAVAILABLE';END IF;
  SELECT jsonb_build_object('id',l.id,'operation_id',l.operation_id,'member_id',l.member_id,'amount_cents',l.delta_cents,'balance_cents',ac.balance_cents,'method',l.payment_method,'at',l.created_at) INTO v
   FROM public.socio_wallet_ledger l JOIN public.socio_wallet_accounts ac ON ac.club_id=l.club_id AND ac.member_id=l.member_id
   WHERE l.id=(p_args->>'topup_id')::uuid AND l.club_id=c AND l.kind='topup' AND l.delta_cents>0
    AND (l.actor_id=auth.uid() OR public.is_current_user_club_admin(c))
    AND NOT EXISTS(SELECT 1 FROM public.socio_wallet_ledger rev WHERE rev.club_id=c AND rev.kind='topup_reversal' AND rev.reversal_of=l.operation_id) FOR UPDATE OF l,ac;
  IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  IF (v->>'balance_cents')::bigint<(v->>'amount_cents')::bigint THEN RAISE EXCEPTION 'VOICE_WALLET_CREDITS_USED';END IF;
  PERFORM 1 FROM public.cash_sessions WHERE id=(p_args->>'cash_session_id')::uuid AND club_id=c AND user_id=auth.uid() AND status='open' AND closed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
 WHEN 'wallet.configure' THEN
  IF p_args-'enabled'<>'{}'::jsonb OR jsonb_typeof(p_args->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF to_regprocedure('public.socio_wallet_club_configuration()') IS NULL OR to_regprocedure('public.socio_wallet_set_club_enabled(boolean,boolean)') IS NULL THEN RAISE EXCEPTION 'VOICE_WALLET_UNAVAILABLE';END IF;
  v:=public.socio_wallet_club_configuration();
 WHEN 'wallet.topup' THEN
  IF p_args-ARRAY['member_id','cash_session_id','amount_cents','method']<>'{}'::jsonb OR NOT(p_args?&ARRAY['member_id','cash_session_id','amount_cents','method']) OR jsonb_typeof(p_args->'amount_cents') IS DISTINCT FROM 'number' OR (p_args->>'amount_cents')::numeric<>trunc((p_args->>'amount_cents')::numeric) OR (p_args->>'amount_cents')::numeric NOT BETWEEN 1 AND 10000000 OR (p_args->>'method') NOT IN ('cash','card','transfer') OR jsonb_typeof(p_args->'method') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF to_regprocedure('public.socio_wallet_staff_member_state(uuid)') IS NULL OR to_regprocedure('public.socio_wallet_topup_with_method(uuid,uuid,uuid,uuid,bigint,text)') IS NULL THEN RAISE EXCEPTION 'VOICE_WALLET_UNAVAILABLE';END IF;
  PERFORM 1 FROM public.members WHERE id=(p_args->>'member_id')::uuid AND club_id=c;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  PERFORM 1 FROM public.cash_sessions WHERE id=(p_args->>'cash_session_id')::uuid AND club_id=c AND user_id=auth.uid() AND status='open' AND closed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  v:=public.socio_wallet_staff_member_state((p_args->>'member_id')::uuid);
  IF (v->>'enabled')::boolean IS DISTINCT FROM true OR (v->>'clubEnabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_WALLET_UNAVAILABLE';END IF;
 WHEN 'member.create' THEN
  IF p_args-ARRAY['first_name','last_name','birth_date','city','phone','email','address','postal_code','plan_id','method','avalador_id']<>'{}'::jsonb OR NOT(p_args?&ARRAY['first_name','last_name','birth_date','city','phone','email','address','postal_code','plan_id','method','avalador_id']) THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_args) f WHERE f.key NOT IN ('plan_id','avalador_id') AND jsonb_typeof(f.value) IS DISTINCT FROM 'string') OR (p_args->'plan_id'<>'null'::jsonb AND jsonb_typeof(p_args->'plan_id') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF length(trim(p_args->>'first_name')) NOT BETWEEN 1 AND 120 OR length(trim(p_args->>'last_name')) NOT BETWEEN 1 AND 120 OR (p_args->>'birth_date')!~'^\d{4}-\d{2}-\d{2}$' OR (p_args->>'birth_date')::date>(now() AT TIME ZONE 'Europe/Madrid')::date-interval '18 years' OR (p_args->>'birth_date')::date<'1900-01-01'::date OR (p_args->>'method') NOT IN ('cash','card','transfer','other') OR length(p_args->>'city')>200 OR length(p_args->>'phone')>50 OR length(p_args->>'address')>200 OR length(p_args->>'postal_code')>20 OR length(p_args->>'email')>254 OR (p_args->>'email'<>'' AND (p_args->>'email')!~'^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN RAISE EXCEPTION 'VOICE_INVALID_MEMBER';END IF;
  LOCK TABLE public.club_member_field_config IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.club_member_field_config WHERE club_id=c AND visible AND required AND field_key NOT IN ('birth_date','dni_number','dni_photo','address','city','postal_code','phone','email','plan','signature','avalador')) THEN RAISE EXCEPTION 'VOICE_UNSUPPORTED_MEMBER_FIELD';END IF;
  SELECT jsonb_object_agg(f.key,jsonb_build_object('visible',coalesce(t.visible,f.visible),'required',coalesce(t.required,f.required))) INTO v
  FROM (VALUES ('birth_date',true,true),('dni_number',true,true),('dni_photo',true,true),('address',false,false),('city',true,true),('postal_code',false,false),('phone',true,true),('email',true,false),('plan',true,true),('signature',true,true),('avalador',true,false)) f(key,visible,required)
  LEFT JOIN public.club_member_field_config t ON t.club_id=c AND t.field_key=f.key;
  IF EXISTS(SELECT 1 FROM jsonb_each(v) f WHERE f.key IN ('dni_number','dni_photo','signature') AND (f.value->>'visible')::boolean AND (f.value->>'required')::boolean) THEN RAISE EXCEPTION 'VOICE_HUMAN_DOCUMENTS_REQUIRED';END IF;
  IF (v->'avalador'->>'visible')::boolean AND (v->'avalador'->>'required')::boolean AND p_args->>'avalador_id' IS NULL THEN RAISE EXCEPTION 'VOICE_AVALADOR_REQUIRED';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(v) f WHERE f.key NOT IN ('dni_number','dni_photo','signature') AND (f.value->>'visible')::boolean AND (f.value->>'required')::boolean AND coalesce(trim(p_args->>CASE WHEN f.key='plan' THEN 'plan_id' WHEN f.key='avalador' THEN 'avalador_id' ELSE f.key END),'')='') THEN RAISE EXCEPTION 'VOICE_REQUIRED_FIELD';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(v) f WHERE f.key IN ('address','city','postal_code','phone','email','plan','avalador') AND NOT (f.value->>'visible')::boolean AND coalesce(trim(p_args->>CASE WHEN f.key='plan' THEN 'plan_id' WHEN f.key='avalador' THEN 'avalador_id' ELSE f.key END),'')<>'') THEN RAISE EXCEPTION 'VOICE_FIELD_DISABLED';END IF;
  v:=jsonb_build_object('config',v,'plan',NULL,'avalador',NULL);
  IF p_args->>'avalador_id' IS NOT NULL THEN
   SELECT v||jsonb_build_object('avalador',jsonb_build_object('id',m.id,'number',m.member_number,'updated_at',m.updated_at)) INTO v FROM public.members m WHERE id=(p_args->>'avalador_id')::uuid AND club_id=c FOR SHARE;
   IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  END IF;
  IF p_args->>'plan_id' IS NOT NULL THEN
   SELECT v||jsonb_build_object('plan',to_jsonb(p)) INTO v FROM public.membership_plans p WHERE id=(p_args->>'plan_id')::uuid AND club_id=c AND active FOR SHARE;
   IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
   IF (v->'plan'->>'price_cents')::int>0 AND public.can_operate_club(c,'use_cash') IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED';END IF;
  END IF;
 WHEN 'member.renew' THEN
  IF p_args-ARRAY['member_id','plan_id','method']<>'{}'::jsonb OR NOT(p_args?'method') OR (p_args->>'method') NOT IN ('cash','card','transfer','other') THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  IF public.can_operate_club(c,'manage_members') IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED';END IF;
  PERFORM 1 FROM public.members WHERE id=(p_args->>'member_id')::uuid AND club_id=c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  PERFORM 1 FROM public.membership_plans WHERE id=(p_args->>'plan_id')::uuid AND club_id=c AND active=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
  SELECT jsonb_build_object('member_id',m.id,'member_name',concat_ws(' ',m.first_name,m.last_name),'expires_at',m.expires_at,'member_plan_id',m.plan_id,'plan_id',p.id,'duration_days',p.duration_days,'amount_cents',p.price_cents,'plan_name',p.name) INTO v
  FROM public.members m JOIN public.membership_plans p ON p.id=(p_args->>'plan_id')::uuid AND p.club_id=c AND p.active
  WHERE m.id=(p_args->>'member_id')::uuid AND m.club_id=c;
  IF (v->>'amount_cents')::int>0 AND public.can_operate_club(c,'use_cash') IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED';END IF;
 ELSE v:=public.snoop_voice_entity(p_action,p_args,false,NULL);
 END CASE;
 IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_snapshot(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.snoop_voice_command(p_request uuid,p_operation text,p_action text DEFAULT NULL,p_arguments jsonb DEFAULT NULL,p_token uuid DEFAULT NULL,p_receipt_confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid:=public.current_club_id();a uuid:=auth.uid();r public.snoop_voice_executions;v jsonb;res jsonb;mid uuid;
BEGIN
 IF a IS NULL OR c IS NULL OR public.can_operate_club(c,NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 IF p_operation NOT IN ('prepare','confirm','status','cancel','recover') OR p_operation IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'VOICE_INVALID_OPERATION';END IF;
 -- Fixed lock order serializes club writes and prevents stale confirmation races.
 PERFORM 1 FROM public.clubs WHERE id=c FOR UPDATE;
 IF p_operation='prepare' THEN
  IF jsonb_typeof(p_arguments) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  v:=public.snoop_voice_snapshot(p_action,p_arguments);
  INSERT INTO public.snoop_voice_executions(id,actor,club,action,arguments,expected,summary)
  VALUES(p_request,a,c,p_action,p_arguments,v,
    CASE p_action WHEN 'access_control.set' THEN jsonb_build_object('label','Control de acceso','enabled',p_arguments->'enabled')
    WHEN 'member.renew' THEN jsonb_build_object('label','Renovar cuota','member_name',v->'member_name','plan',v->'plan_name','amount_cents',v->'amount_cents','duration_days',v->'duration_days','method',p_arguments->'method')
    ELSE jsonb_build_object('label',CASE p_action WHEN 'theme.set' THEN 'Cambiar paleta visual del club' WHEN 'collaborator.permissions.set' THEN 'Actualizar permisos del colaborador' WHEN 'collaborator.revoke' THEN 'Revocar acceso del colaborador (no elimina la cuenta)' WHEN 'category.update' THEN 'Actualizar categoría' WHEN 'product.description' THEN 'Actualizar descripción' WHEN 'category.create' THEN 'Crear categoría' WHEN 'finance.supplier.create' THEN 'Registrar proveedor' WHEN 'finance.expense.create' THEN 'Registrar gasto (no ejecuta pago ni modifica Caja)' WHEN 'finance.expense.cancel' THEN 'Anular registro de gasto' WHEN 'finance.purchase.record' THEN 'Registrar compra prevista (no emite pedido ni mueve stock)' WHEN 'product.create' THEN 'Crear ficha de producto (sin existencias)' WHEN 'product.update' THEN 'Actualizar ficha de producto' WHEN 'stock.adjust' THEN 'Rectificación de inventario verificado' WHEN 'wallet.configure' THEN 'Configurar Monedero del club' WHEN 'wallet.topup' THEN 'Registrar recarga de créditos' WHEN 'wallet.topup.reverse' THEN 'Anular recarga y registrar devolución ya realizada' WHEN 'member.create' THEN 'Registrar socio' WHEN 'member_field.set' THEN 'Configurar campo de socio' WHEN 'member.update' THEN 'Actualizar socio' WHEN 'fee.create' THEN 'Crear cuota' WHEN 'fee.update' THEN 'Actualizar cuota' WHEN 'discount.create' THEN 'Crear descuento' WHEN 'discount.update' THEN 'Actualizar descuento' WHEN 'member.discount.set' THEN 'Asignar descuento' WHEN 'member.discount.clear' THEN 'Quitar descuento' WHEN 'cash.open' THEN 'Abrir caja' WHEN 'cash.close' THEN 'Cerrar caja' ELSE 'Operación' END,'name',coalesce(p_arguments->'name',p_arguments->'description',v->'name',v->'description'),'changes',p_arguments-ARRAY['id','member_id','discount_id','category_id','plan_id','cash_session_id','supplier_id','topup_id','avalador_id']) || jsonb_strip_nulls(jsonb_build_object(
    'category',CASE WHEN p_arguments?'category_id' THEN (SELECT name FROM public.product_categories WHERE id=(p_arguments->>'category_id')::uuid AND club_id=c) ELSE NULL END,
    'member_name',CASE WHEN p_arguments?'member_id' OR p_action='member.update' THEN (SELECT concat_ws(' ',first_name,last_name) FROM public.members WHERE id=coalesce(p_arguments->>'member_id',p_arguments->>'id')::uuid AND club_id=c) ELSE NULL END,
    'discount',CASE WHEN p_arguments?'discount_id' THEN (SELECT name FROM public.member_discounts WHERE id=(p_arguments->>'discount_id')::uuid AND club_id=c) ELSE NULL END,
    'supplier',v->'supplier'->'name','amount_cents',CASE WHEN p_action='wallet.topup.reverse' THEN v->'amount_cents' ELSE NULL END,'unit_type',v->'unit_type','opened_at',v->'opened_at','attestation',CASE WHEN p_action='wallet.topup' THEN 'Confirmo que la recarga ya se ha cobrado por el método indicado.' WHEN p_action='wallet.topup.reverse' THEN 'Confirmo que ya he devuelto el importe por el método indicado. SNOOP no inicia pagos.' ELSE NULL END)) END)
  ON CONFLICT(id) DO NOTHING;
 END IF;
 SELECT * INTO r FROM public.snoop_voice_executions WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.club<>c OR (r.actor<>a AND (p_operation<>'status' OR public.is_current_user_club_admin(c) IS DISTINCT FROM true)) THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 IF public.snoop_voice_authorized(r.action,c) IS DISTINCT FROM true OR (r.action='member.renew' AND (r.expected->>'amount_cents')::integer>0 AND public.can_operate_club(c,'use_cash') IS DISTINCT FROM true) THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED';END IF;
 IF p_operation='prepare' AND (r.action IS DISTINCT FROM p_action OR r.arguments IS DISTINCT FROM p_arguments) THEN RAISE EXCEPTION 'VOICE_KEY_REUSED';END IF;
 IF p_operation='recover' AND r.completed_at IS NULL AND r.cancelled_at IS NULL AND now()>r.prepared_at+interval '10 minutes' THEN
  UPDATE public.snoop_voice_executions SET cancelled_at=now() WHERE id=r.id;
  SELECT * INTO r FROM public.snoop_voice_executions WHERE id=r.id;
 END IF;
 IF p_operation='cancel' THEN
  IF p_token IS DISTINCT FROM r.token THEN RAISE EXCEPTION 'VOICE_CONFIRMATION_REQUIRED';END IF;
  IF r.completed_at IS NOT NULL THEN RAISE EXCEPTION 'VOICE_ALREADY_COMPLETED';END IF;
  UPDATE public.snoop_voice_executions SET cancelled_at=coalesce(cancelled_at,now()) WHERE id=r.id;
  SELECT * INTO r FROM public.snoop_voice_executions WHERE id=r.id;
 END IF;
 IF p_operation='confirm' THEN
  IF r.action IN ('wallet.topup','wallet.topup.reverse') AND p_receipt_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_RECEIPT_CONFIRMATION_REQUIRED';END IF;
  IF r.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'VOICE_CANCELLED';END IF;
  IF p_token IS DISTINCT FROM r.token THEN RAISE EXCEPTION 'VOICE_CONFIRMATION_REQUIRED';END IF;
  IF r.completed_at IS NULL THEN
   IF now()>r.prepared_at+interval '10 minutes' THEN RAISE EXCEPTION 'VOICE_CONFIRMATION_EXPIRED';END IF;
   v:=public.snoop_voice_snapshot(r.action,r.arguments);
   IF v IS DISTINCT FROM r.expected THEN RAISE EXCEPTION 'VOICE_STATE_CHANGED';END IF;
   CASE r.action
   WHEN 'access_control.set' THEN res:=public.snoop_set_club_access_control((r.arguments->>'enabled')::boolean);
    IF res IS DISTINCT FROM public.snoop_get_club_access_control() OR (res->>'enabled')::boolean IS DISTINCT FROM (r.arguments->>'enabled')::boolean THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
   WHEN 'category.update' THEN
    PERFORM public.manage_administrative_category((r.arguments->>'id')::uuid,r.arguments->>'name',(r.arguments->>'archived')::boolean);
    SELECT jsonb_build_object('id',id,'name',name,'archived',archived) INTO res FROM public.product_categories WHERE id=(r.arguments->>'id')::uuid AND club_id=c;
    IF res->>'name' IS DISTINCT FROM trim(r.arguments->>'name') OR (res->>'archived')::boolean IS DISTINCT FROM (r.arguments->>'archived')::boolean THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
   WHEN 'product.description' THEN
    mid:=public.save_administrative_product_checked((r.arguments->>'id')::uuid,v||jsonb_build_object('description',r.arguments->>'description'),(v->>'stock')::numeric);
    SELECT jsonb_build_object('id',id,'description',description) INTO res FROM public.products WHERE id=mid AND club_id=c;
    PERFORM 1 FROM public.products WHERE id=mid AND club_id=c AND stock=(v->>'stock')::numeric AND buy_price=(v->>'buy_price')::numeric AND sell_price=(v->>'sell_price')::numeric;
    IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    IF mid IS DISTINCT FROM (r.arguments->>'id')::uuid OR res->>'description' IS DISTINCT FROM r.arguments->>'description' THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
   WHEN 'product.create' THEN
    mid:=public.snoop_create_product_located(public.snoop_voice_catalog_values(r.arguments-'destination')||jsonb_build_object('stock',0),r.arguments->>'destination',r.id);
    UPDATE public.products SET description=r.arguments->>'description' WHERE id=mid AND club_id=c;
    SELECT jsonb_build_object('id',id,'name',name,'stock',stock,'category_id',category_id,'buy_price',buy_price,'sell_price',sell_price,'price_unit','EUR','description',description,'strain',strain,'notes',notes) INTO res FROM public.products WHERE id=mid AND club_id=c;
    IF res IS NULL OR NOT(res@>public.snoop_voice_catalog_values(r.arguments-'destination')) OR (res->>'stock')::numeric<>0 THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
   WHEN 'product.update' THEN
    mid:=public.save_administrative_product_checked((r.arguments->>'id')::uuid,v||public.snoop_voice_catalog_values(r.arguments),(v->>'stock')::numeric);
    IF r.arguments?'active' THEN UPDATE public.products SET active=(r.arguments->>'active')::boolean WHERE id=mid AND club_id=c;END IF;
    SELECT jsonb_build_object('id',id,'name',name,'stock',stock,'category_id',category_id,'buy_price',buy_price,'sell_price',sell_price,'strain',strain,'notes',notes,'description',description,'active',active,'price_unit','EUR') INTO res FROM public.products WHERE id=mid AND club_id=c;
    IF res IS NULL OR mid IS DISTINCT FROM (r.arguments->>'id')::uuid OR NOT(res@>public.snoop_voice_catalog_values(r.arguments)) OR (res->>'stock')::numeric IS DISTINCT FROM (v->>'stock')::numeric THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
   WHEN 'stock.adjust' THEN
    PERFORM public.adjust_administrative_stock((r.arguments->>'id')::uuid,(r.arguments->>'delta')::numeric,(v->>'stock')::numeric,r.arguments->>'notes');
    SELECT jsonb_build_object('id',id,'stock',stock) INTO res FROM public.products WHERE id=(r.arguments->>'id')::uuid AND club_id=c;
    IF res IS NULL OR (res->>'stock')::numeric IS DISTINCT FROM (v->>'stock')::numeric+(r.arguments->>'delta')::numeric THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    PERFORM 1 FROM public.stock_movements WHERE product_id=(r.arguments->>'id')::uuid AND club_id=c AND created_by=a AND delta=(r.arguments->>'delta')::numeric AND notes=r.arguments->>'notes' AND reason='administrative_adjustment';
    IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
   WHEN 'wallet.configure' THEN
    v:=public.socio_wallet_set_club_enabled((r.arguments->>'enabled')::boolean,true);
    IF (v->>'clubEnabled')::boolean IS DISTINCT FROM (r.arguments->>'enabled')::boolean OR (public.socio_wallet_club_configuration()->>'clubEnabled')::boolean IS DISTINCT FROM (r.arguments->>'enabled')::boolean THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    res:=v||jsonb_build_object('id',c);
   WHEN 'wallet.topup.reverse' THEN
    v:=public.socio_wallet_void_topup((r.arguments->>'topup_id')::uuid,(r.arguments->>'cash_session_id')::uuid,r.id,r.arguments->>'reason',r.arguments->>'method',true);
    PERFORM 1 FROM public.socio_wallet_ledger rev JOIN public.socio_wallet_accounts ac ON ac.club_id=rev.club_id AND ac.member_id=rev.member_id WHERE rev.operation_id=r.id AND rev.club_id=c AND rev.kind='topup_reversal' AND rev.reversal_of=(r.expected->>'operation_id')::uuid AND rev.delta_cents=-(r.expected->>'amount_cents')::bigint AND rev.actor_id=a AND rev.payment_method=r.arguments->>'method' AND rev.cash_session_id=(r.arguments->>'cash_session_id')::uuid AND ac.balance_cents=(v->>'balanceCents')::bigint;
    IF NOT FOUND OR v->>'operationId' IS DISTINCT FROM r.id::text OR v->>'topupId' IS DISTINCT FROM r.arguments->>'topup_id' OR v->>'status' NOT IN ('applied','duplicate') THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    res:=jsonb_build_object('id',r.id,'topupId',r.arguments->'topup_id','balanceCents',v->'balanceCents','refundCents',r.expected->'amount_cents');
   WHEN 'wallet.topup' THEN
    v:=public.socio_wallet_topup_with_method(c,(r.arguments->>'member_id')::uuid,(r.arguments->>'cash_session_id')::uuid,r.id,(r.arguments->>'amount_cents')::bigint,r.arguments->>'method');
    IF v->>'operationId' IS DISTINCT FROM r.id::text OR v->>'status' NOT IN ('applied','duplicate') THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    PERFORM 1 FROM public.socio_wallet_ledger l JOIN public.socio_wallet_accounts ac ON ac.member_id=l.member_id AND ac.club_id=l.club_id WHERE l.operation_id=r.id AND l.club_id=c AND l.member_id=(r.arguments->>'member_id')::uuid AND l.kind='topup' AND l.actor_id=a AND l.delta_cents=(r.arguments->>'amount_cents')::bigint AND l.payment_method=r.arguments->>'method' AND l.cash_session_id=(r.arguments->>'cash_session_id')::uuid AND ac.balance_cents=(v->>'balanceCents')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    res:=jsonb_build_object('id',r.id,'balanceCents',v->'balanceCents');
   WHEN 'member.create' THEN
    IF to_regprocedure('public.snoop_register_member_with_avalador(jsonb,uuid,text,uuid,integer)') IS NOT NULL THEN
     mid:=public.snoop_register_member_with_avalador(r.arguments||jsonb_build_object('id',r.id,'club_id',c,'avalador_member_number',v->'avalador'->'number','dni_number','','dni_photo_path','','signature_path',''),(r.arguments->>'plan_id')::uuid,r.arguments->>'method',r.id,coalesce((v->'plan'->>'price_cents')::int,0));
    ELSIF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='avalador_member_id') OR r.arguments->>'avalador_id' IS NOT NULL THEN RAISE EXCEPTION 'VOICE_AVALADOR_REVIEW_REQUIRED';
    ELSIF r.arguments->>'plan_id' IS NULL THEN
     mid:=public.save_membership_with_receipt(r.arguments||jsonb_build_object('id',r.id,'dni_number','','dni_photo_path','','signature_path',''),NULL,r.arguments->>'method',r.id,false,NULL);
    ELSE
     mid:=public.snoop_voice_membership(r.arguments||jsonb_build_object('id',r.id,'dni_number','','dni_photo_path','','signature_path',''),(r.arguments->>'plan_id')::uuid,r.arguments->>'method',r.id,false,NULL,(v->'plan'->>'price_cents')::int);
    END IF;
    SELECT jsonb_build_object('id',m.id) INTO res FROM public.members m JOIN public.membership_operations o ON o.member_id=m.id AND o.club_id=c AND o.request_id=r.id AND o.actor_id=a WHERE m.id=mid AND m.id=r.id AND m.club_id=c AND m.created_by=a AND m.first_name=trim(r.arguments->>'first_name') AND m.last_name=trim(r.arguments->>'last_name') AND m.birth_date=(r.arguments->>'birth_date')::date;
    IF res IS NULL THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
   WHEN 'member.renew' THEN
    mid:=public.snoop_voice_membership(jsonb_build_object('id',r.arguments->>'member_id'),(r.arguments->>'plan_id')::uuid,r.arguments->>'method',r.id,true,(v->>'expires_at')::date,(v->>'amount_cents')::int);
    SELECT jsonb_build_object('id',id,'expires_at',expires_at) INTO res FROM public.members WHERE id=mid AND club_id=c;
    IF mid IS DISTINCT FROM (r.arguments->>'member_id')::uuid OR res IS NULL THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    PERFORM 1 FROM public.members m JOIN public.membership_operations o ON o.member_id=m.id AND o.club_id=c AND o.request_id=r.id AND o.actor_id=a WHERE m.id=mid AND m.club_id=c AND m.plan_id=(r.arguments->>'plan_id')::uuid AND m.expires_at>coalesce((v->>'expires_at')::date,'-infinity'::date);
    IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    IF (v->>'amount_cents')::int>0 THEN
     PERFORM 1 FROM public.membership_receipts WHERE club_id=c AND request_id=r.id AND member_id=mid AND amount_cents=(v->>'amount_cents')::int AND payment_method=r.arguments->>'method';
     IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    END IF;
   ELSE res:=public.snoop_voice_entity(r.action,r.arguments,true,r.id);
   END CASE;
   IF res IS NULL THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
   UPDATE public.snoop_voice_executions SET result=res,completed_at=now(),receipt_confirmed_at=CASE WHEN r.action IN ('wallet.topup','wallet.topup.reverse') THEN now() ELSE NULL END WHERE id=r.id;
   SELECT * INTO r FROM public.snoop_voice_executions WHERE id=r.id;
  END IF;
 END IF;
 RETURN jsonb_build_object('id',r.id,'status',CASE WHEN r.cancelled_at IS NOT NULL THEN 'cancelled' WHEN r.completed_at IS NULL THEN 'confirmation_required' ELSE 'completed' END,
 'action',r.action,'summary',r.summary,'result',r.result,'token',CASE WHEN p_operation IN ('prepare','recover') AND r.completed_at IS NULL AND r.cancelled_at IS NULL THEN r.token ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_command(uuid,text,text,jsonb,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_voice_command(uuid,text,text,jsonb,uuid,boolean) TO authenticated;
-- Compatibility wrapper, no second execution engine.
CREATE FUNCTION public.snoop_voice_access(p_request uuid,p_operation text,p_enabled boolean DEFAULT NULL,p_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v jsonb;
BEGIN
 v:=public.snoop_voice_command(p_request,p_operation,CASE WHEN p_operation='prepare' THEN 'access_control.set' ELSE NULL END,CASE WHEN p_operation='prepare' THEN jsonb_build_object('enabled',p_enabled) ELSE NULL END,p_token);
 RETURN (v-ARRAY['action','summary'])||jsonb_build_object('enabled',v->'summary'->'enabled');
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_access(uuid,text,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_voice_access(uuid,text,boolean,uuid) TO authenticated;
COMMIT;

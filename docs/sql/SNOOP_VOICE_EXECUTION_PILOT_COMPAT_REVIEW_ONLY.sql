-- Pilot-compatible SQL only; requires separate review, not automatically applied.
-- Actual Pilot renewal RPC takes (integer,date,jsonb,text,uuid,boolean,uuid).
-- REVIEW ONLY: replaces the previous UNAPPLIED proposal, not an upgrade to run blindly.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.snoop_voice_executions') IS NOT NULL OR to_regprocedure('public.snoop_voice_access(uuid,text,boolean,uuid)') IS NOT NULL OR to_regprocedure('public.snoop_voice_command(uuid,text,text,jsonb,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'VOICE_EXECUTION_SCHEMA_ALREADY_PRESENT_REVIEW_UPGRADE';END IF;
 IF to_regprocedure('public.snoop_get_club_access_control()') IS NULL OR
 to_regprocedure('public.snoop_set_club_access_control(boolean)') IS NULL OR
 to_regprocedure('public.manage_administrative_category(uuid,text,boolean)') IS NULL OR
 to_regprocedure('public.save_administrative_product_checked(uuid,jsonb,numeric)') IS NULL OR
 to_regprocedure('public.confirm_membership_with_receipt(integer,date,jsonb,text,uuid,boolean,uuid)') IS NULL THEN
 RAISE EXCEPTION 'VOICE_EXECUTION_DEPENDENCY_MISSING'; END IF;
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
CREATE TABLE public.snoop_voice_executions (
 id uuid PRIMARY KEY, actor uuid NOT NULL, club uuid NOT NULL,
 token uuid NOT NULL DEFAULT gen_random_uuid(), action text NOT NULL,
 arguments jsonb NOT NULL, expected jsonb NOT NULL, summary jsonb NOT NULL,
 prepared_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,cancelled_at timestamptz,result jsonb
);
ALTER TABLE public.snoop_voice_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.snoop_voice_executions FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.snoop_voice_authorized(p_action text,p_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND p_club=public.current_club_id() AND public.can_operate_club(p_club,NULL) IS TRUE AND
 CASE p_action WHEN 'access_control.set' THEN public.is_current_user_club_admin(p_club)
 WHEN 'category.update' THEN public.can_manage_snoop_catalog(p_club)
 WHEN 'product.description' THEN public.can_manage_snoop_catalog(p_club)
 WHEN 'member.renew' THEN public.can_operate_club(p_club,'manage_members') ELSE false END IS TRUE;
$$;
REVOKE ALL ON FUNCTION public.snoop_voice_authorized(text,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.snoop_voice_snapshot(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid:=public.current_club_id();v jsonb;
BEGIN
 IF public.snoop_voice_authorized(p_action,c) IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
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
  IF (v->>'buy_price')::numeric<>trunc((v->>'buy_price')::numeric) OR (v->>'sell_price')::numeric<>trunc((v->>'sell_price')::numeric) THEN RAISE EXCEPTION 'VOICE_LEGACY_PRICE_UNSUPPORTED';END IF;
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
 ELSE RAISE EXCEPTION 'VOICE_ACTION_NOT_REGISTERED';
 END CASE;
 IF v IS NULL THEN RAISE EXCEPTION 'VOICE_REFERENCE_NOT_FOUND';END IF;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_snapshot(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.snoop_voice_command(p_request uuid,p_operation text,p_action text DEFAULT NULL,p_arguments jsonb DEFAULT NULL,p_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid:=public.current_club_id();a uuid:=auth.uid();r public.snoop_voice_executions;v jsonb;res jsonb;mid uuid;
BEGIN
 IF a IS NULL OR c IS NULL OR public.can_operate_club(c,NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 IF p_operation NOT IN ('prepare','confirm','status','cancel') OR p_operation IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'VOICE_INVALID_OPERATION';END IF;
 -- Fixed lock order serializes club writes and prevents stale confirmation races.
 PERFORM 1 FROM public.clubs WHERE id=c FOR UPDATE;
 IF p_operation='prepare' THEN
  IF jsonb_typeof(p_arguments) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'VOICE_INVALID_ARGUMENTS';END IF;
  v:=public.snoop_voice_snapshot(p_action,p_arguments);
  INSERT INTO public.snoop_voice_executions(id,actor,club,action,arguments,expected,summary)
  VALUES(p_request,a,c,p_action,p_arguments,v,
    CASE p_action WHEN 'access_control.set' THEN jsonb_build_object('label','Control de acceso','enabled',p_arguments->'enabled')
    WHEN 'member.renew' THEN jsonb_build_object('label','Renovar cuota','member_name',v->'member_name','plan',v->'plan_name','amount_cents',v->'amount_cents','duration_days',v->'duration_days','method',p_arguments->'method')
    ELSE jsonb_build_object('label',CASE p_action WHEN 'category.update' THEN 'Actualizar categoría' ELSE 'Actualizar descripción' END,'name',v->'name','changes',p_arguments-'id') END)
  ON CONFLICT(id) DO NOTHING;
 END IF;
 SELECT * INTO r FROM public.snoop_voice_executions WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.club<>c OR (r.actor<>a AND (p_operation<>'status' OR public.is_current_user_club_admin(c) IS DISTINCT FROM true)) THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 IF public.snoop_voice_authorized(r.action,c) IS DISTINCT FROM true OR (r.action='member.renew' AND (r.expected->>'amount_cents')::integer>0 AND public.can_operate_club(c,'use_cash') IS DISTINCT FROM true) THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED';END IF;
 IF p_operation='prepare' AND (r.action IS DISTINCT FROM p_action OR r.arguments IS DISTINCT FROM p_arguments) THEN RAISE EXCEPTION 'VOICE_KEY_REUSED';END IF;
 IF p_operation='cancel' THEN
  IF p_token IS DISTINCT FROM r.token THEN RAISE EXCEPTION 'VOICE_CONFIRMATION_REQUIRED';END IF;
  IF r.completed_at IS NOT NULL THEN RAISE EXCEPTION 'VOICE_ALREADY_COMPLETED';END IF;
  UPDATE public.snoop_voice_executions SET cancelled_at=coalesce(cancelled_at,now()) WHERE id=r.id;
  SELECT * INTO r FROM public.snoop_voice_executions WHERE id=r.id;
 END IF;
 IF p_operation='confirm' THEN
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
    IF (v->>'buy_price')::numeric<>trunc((v->>'buy_price')::numeric) OR (v->>'sell_price')::numeric<>trunc((v->>'sell_price')::numeric) THEN RAISE EXCEPTION 'VOICE_LEGACY_PRICE_UNSUPPORTED';END IF;
    mid:=public.save_administrative_product_checked((r.arguments->>'id')::uuid,v||jsonb_build_object('description',r.arguments->>'description','buy_price',(v->>'buy_price')::numeric::integer,'sell_price',(v->>'sell_price')::numeric::integer),(v->>'stock')::numeric);
    SELECT jsonb_build_object('id',id,'description',description) INTO res FROM public.products WHERE id=mid AND club_id=c;
    PERFORM 1 FROM public.products WHERE id=mid AND club_id=c AND stock=(v->>'stock')::numeric AND buy_price=(v->>'buy_price')::numeric AND sell_price=(v->>'sell_price')::numeric;
    IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    IF mid IS DISTINCT FROM (r.arguments->>'id')::uuid OR res->>'description' IS DISTINCT FROM r.arguments->>'description' THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
   WHEN 'member.renew' THEN
    mid:=public.confirm_membership_with_receipt((v->>'amount_cents')::int,(v->>'expires_at')::date,jsonb_build_object('id',r.arguments->>'member_id'),r.arguments->>'method',(r.arguments->>'plan_id')::uuid,true,r.id);
    SELECT jsonb_build_object('id',id,'expires_at',expires_at) INTO res FROM public.members WHERE id=mid AND club_id=c;
    IF mid IS DISTINCT FROM (r.arguments->>'member_id')::uuid OR res IS NULL THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    PERFORM 1 FROM public.members m JOIN public.membership_operations o ON o.member_id=m.id AND o.club_id=c AND o.request_id=r.id AND o.actor_id=a WHERE m.id=mid AND m.club_id=c AND m.plan_id=(r.arguments->>'plan_id')::uuid AND m.expires_at>coalesce((v->>'expires_at')::date,'-infinity'::date);
    IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    IF (v->>'amount_cents')::int>0 THEN
     PERFORM 1 FROM public.membership_receipts WHERE club_id=c AND request_id=r.id AND member_id=mid AND amount_cents=(v->>'amount_cents')::int AND payment_method=r.arguments->>'method';
     IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
    END IF;
   ELSE RAISE EXCEPTION 'VOICE_ACTION_NOT_REGISTERED';
   END CASE;
   IF res IS NULL THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
   UPDATE public.snoop_voice_executions SET result=res,completed_at=now() WHERE id=r.id;
   SELECT * INTO r FROM public.snoop_voice_executions WHERE id=r.id;
  END IF;
 END IF;
 RETURN jsonb_build_object('id',r.id,'status',CASE WHEN r.cancelled_at IS NOT NULL THEN 'cancelled' WHEN r.completed_at IS NULL THEN 'confirmation_required' ELSE 'completed' END,
 'action',r.action,'summary',r.summary,'result',r.result,'token',CASE WHEN p_operation='prepare' THEN r.token ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_command(uuid,text,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_voice_command(uuid,text,text,jsonb,uuid) TO authenticated;
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

-- ONE-TIME PROPOSAL ONLY. Replaces neither accounting rows nor existing RLS.
-- Supersedes the dues-only report; independent of its proposal, and compatible if it already exists.
BEGIN;
DO $$
DECLARE item record;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('orders','id','uuid'),('orders','club_id','uuid'),('orders','created_by','uuid'),
 ('orders','created_at','timestamp with time zone'),('orders','total_cents','integer'),('orders','status','text'),
 ('membership_receipts','id','uuid'),('membership_receipts','club_id','uuid'),
 ('membership_receipts','recorded_by','uuid'),('membership_receipts','recorded_at','timestamp with time zone'),
 ('membership_receipts','amount_cents','integer'),('membership_receipts','operator_name','text'),
 ('membership_receipts','payment_method','text'),('profiles','id','uuid'),('profiles','full_name','text')
 ) AS required(table_name,column_name,data_type)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=item.table_name AND c.column_name=item.column_name AND c.data_type=item.data_type) THEN
   RAISE EXCEPTION 'Incompatible dependency: %.% (%)',item.table_name,item.column_name,item.data_type;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN('orders','membership_receipts') AND NOT t.relrowsecurity) THEN RAISE EXCEPTION 'RLS must already be enabled on accounting sources';END IF;
 IF to_regprocedure('public.current_club_id()') IS NULL OR to_regprocedure('public.is_current_user_club_admin(uuid)') IS NULL OR to_regprocedure('public.can_operate_club(uuid,public.app_permission)') IS NULL THEN
  RAISE EXCEPTION 'Missing platform authorization functions';
 END IF;
 IF to_regprocedure('public.snoop_cash_shift_report(date,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Cash shift report already exists; inspect before applying';END IF;
END $$;
CREATE FUNCTION public.snoop_cash_shift_report(p_day date DEFAULT NULL,p_operator uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; a boolean; d date; result jsonb; operator_name text;
BEGIN
 c:=public.current_club_id();
 IF c IS NULL OR NOT public.can_operate_club(c,'use_cash') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 a:=public.is_current_user_club_admin(c);
 IF p_operator IS NOT NULL AND NOT a AND p_operator<>auth.uid() THEN RAISE EXCEPTION 'Forbidden operator' USING ERRCODE='42501';END IF;
 d:=coalesce(p_day,(now() AT TIME ZONE 'Europe/Madrid')::date);
 IF d<date '2000-01-01' OR d>(now() AT TIME ZONE 'Europe/Madrid')::date+1 THEN RAISE EXCEPTION 'Invalid date';END IF;
 SELECT coalesce(nullif(p.full_name,''),'Colaborador') INTO operator_name FROM public.profiles p WHERE p.id=auth.uid();
 WITH movements AS (
 SELECT 'order:'||o.id::text AS id,'order' AS source,o.created_at AS recorded_at,o.created_by AS recorded_by,
 o.total_cents AS amount_cents,coalesce(nullif(p.full_name,''),CASE WHEN o.created_by IS NULL THEN 'Sin responsable registrado' ELSE 'Colaborador' END) AS operator_name,
 'pedido completado'::text AS type,NULL::text AS payment_method
 FROM public.orders o LEFT JOIN public.profiles p ON p.id=o.created_by
 WHERE o.club_id=c AND o.status='completed'
 AND o.created_at>=d::timestamp AT TIME ZONE 'Europe/Madrid' AND o.created_at<(d+1)::timestamp AT TIME ZONE 'Europe/Madrid'
 AND (CASE WHEN a THEN p_operator IS NULL OR o.created_by=p_operator ELSE o.created_by=auth.uid() END)
 UNION ALL
 SELECT 'fee:'||r.id::text,'fee',r.recorded_at,r.recorded_by,r.amount_cents,r.operator_name,'cuota asociativa',r.payment_method
 FROM public.membership_receipts r WHERE r.club_id=c
 AND r.recorded_at>=d::timestamp AT TIME ZONE 'Europe/Madrid' AND r.recorded_at<(d+1)::timestamp AT TIME ZONE 'Europe/Madrid'
 AND (CASE WHEN a THEN p_operator IS NULL OR r.recorded_by=p_operator ELSE r.recorded_by=auth.uid() END)
 ), normalized AS (
 SELECT m.*,(m.recorded_at AT TIME ZONE 'Europe/Madrid')::date AS shift_day,
 CASE WHEN (m.recorded_at AT TIME ZONE 'Europe/Madrid')::time>=time '11:00' AND (m.recorded_at AT TIME ZONE 'Europe/Madrid')::time<time '17:00' THEN 1
 WHEN (m.recorded_at AT TIME ZONE 'Europe/Madrid')::time>=time '17:00' AND (m.recorded_at AT TIME ZONE 'Europe/Madrid')::time<time '23:00' THEN 2 ELSE NULL END AS shift,
 'fecha original del servidor'::text AS attribution_source FROM movements m
 ) SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.recorded_at,n.id),'[]'::jsonb) INTO result FROM normalized n;
 RETURN jsonb_build_object('server_now',now(),'day',d,'user_id',auth.uid(),'operator_name',coalesce(operator_name,'Colaborador'),'admin',a,'rows',result);
END $$;
REVOKE ALL ON FUNCTION public.snoop_cash_shift_report(date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.snoop_cash_shift_report(date,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

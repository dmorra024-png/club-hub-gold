-- Reviewable amendment of the existing SNOOP shift report; keeps the same
-- permissions, return fields and Madrid shift semantics. Adds wallet-payment
-- attribution and actual cash topups without counting wallet spend as cash.
BEGIN;
CREATE OR REPLACE FUNCTION public.snoop_cash_shift_report(p_day date DEFAULT NULL::date, p_operator uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                                  'pedido completado'::text AS type,CASE WHEN EXISTS (SELECT 1 FROM public.socio_order_settlements proof WHERE proof.order_id=o.id AND proof.club_id=o.club_id AND proof.payment_method='wallet') THEN 'wallet'::text ELSE NULL::text END AS payment_method
                                   FROM public.orders o LEFT JOIN public.profiles p ON p.id=o.created_by
                                    WHERE o.club_id=c AND o.status='completed'
                                     AND o.created_at>=d::timestamp AT TIME ZONE 'Europe/Madrid' AND o.created_at<(d+1)::timestamp AT TIME ZONE 'Europe/Madrid'
                                      AND (CASE WHEN a THEN p_operator IS NULL OR o.created_by=p_operator ELSE o.created_by=auth.uid() END)
                                       UNION ALL
                                        SELECT 'fee:'||r.id::text,'fee',r.recorded_at,r.recorded_by,r.amount_cents,r.operator_name,'cuota asociativa',r.payment_method
                                         FROM public.membership_receipts r WHERE r.club_id=c
                                          AND r.recorded_at>=d::timestamp AT TIME ZONE 'Europe/Madrid' AND r.recorded_at<(d+1)::timestamp AT TIME ZONE 'Europe/Madrid'
                                           AND (CASE WHEN a THEN p_operator IS NULL OR r.recorded_by=p_operator ELSE r.recorded_by=auth.uid() END)
                                       UNION ALL
                                        SELECT 'topup:'||l.id::text,'topup',l.created_at,l.actor_id,l.delta_cents,
                                         coalesce(nullif(p.full_name,''),'Colaborador'),'recarga monedero','cash'
                                        FROM public.socio_wallet_ledger l
                                        LEFT JOIN public.profiles p ON p.id=l.actor_id
                                        WHERE l.club_id=c AND l.kind='topup' AND l.delta_cents>0
                                         AND l.created_at>=d::timestamp AT TIME ZONE 'Europe/Madrid'
                                         AND l.created_at<(d+1)::timestamp AT TIME ZONE 'Europe/Madrid'
                                         AND (CASE WHEN a THEN p_operator IS NULL OR l.actor_id=p_operator ELSE l.actor_id=auth.uid() END)
                                            ), normalized AS (
                                             SELECT m.*,(m.recorded_at AT TIME ZONE 'Europe/Madrid')::date AS shift_day,
                                              CASE WHEN (m.recorded_at AT TIME ZONE 'Europe/Madrid')::time>=time '11:00' AND (m.recorded_at AT TIME ZONE 'Europe/Madrid')::time<time '17:00' THEN 1
                                               WHEN (m.recorded_at AT TIME ZONE 'Europe/Madrid')::time>=time '17:00' AND (m.recorded_at AT TIME ZONE 'Europe/Madrid')::time<time '23:00' THEN 2 ELSE NULL END AS shift,
                                                'fecha original del servidor'::text AS attribution_source FROM movements m
                                                 ) SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.recorded_at,n.id),'[]'::jsonb) INTO result FROM normalized n;
                                                  RETURN jsonb_build_object('server_now',now(),'day',d,'user_id',auth.uid(),'operator_name',coalesce(operator_name,'Colaborador'),'admin',a,'rows',result);
                                                  END $function$
;
COMMIT;

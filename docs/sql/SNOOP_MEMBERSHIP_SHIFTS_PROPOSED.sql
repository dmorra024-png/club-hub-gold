-- REVIEW/APPROVAL REQUIRED. Not an applied Supabase migration.
-- Additive only: no receipt/account changes, no backfill, no existing RLS changes.
BEGIN;
CREATE TABLE public.snoop_membership_shifts(
 receipt_id uuid PRIMARY KEY REFERENCES public.membership_receipts(id),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 operator_id uuid NOT NULL REFERENCES auth.users(id),
 shift_day date NOT NULL,
 shift smallint CHECK(shift IN(1,2)),
 attributed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.snoop_membership_shifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.snoop_membership_shifts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.snoop_membership_shifts TO service_role;
CREATE FUNCTION public.snoop_attribute_membership_shift() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t time; n smallint;
BEGIN
 t:=(NEW.recorded_at AT TIME ZONE 'Europe/Madrid')::time;
 n:=CASE WHEN t>=time '11:00' AND t<time '17:00' THEN 1 WHEN t>=time '17:00' AND t<time '23:00' THEN 2 ELSE NULL END;
 INSERT INTO public.snoop_membership_shifts(receipt_id,club_id,operator_id,shift_day,shift)
 VALUES(NEW.id,NEW.club_id,NEW.recorded_by,(NEW.recorded_at AT TIME ZONE 'Europe/Madrid')::date,n);
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.snoop_attribute_membership_shift() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snoop_membership_shift_snapshot AFTER INSERT ON public.membership_receipts
 FOR EACH ROW EXECUTE FUNCTION public.snoop_attribute_membership_shift();
CREATE FUNCTION public.snoop_membership_shift_report(p_day date DEFAULT NULL,p_operator uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; admin boolean; d date; rows jsonb; n text;
BEGIN
 c:=public.current_club_id();
 IF c IS NULL OR NOT public.can_operate_club(c,'use_cash') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 admin:=public.is_current_user_club_admin(c);
 IF p_operator IS NOT NULL AND NOT admin AND p_operator<>auth.uid() THEN RAISE EXCEPTION 'Forbidden operator' USING ERRCODE='42501';END IF;
 IF p_operator IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE club_id=c AND user_id=p_operator AND role IN('admin','collaborator')) THEN RAISE EXCEPTION 'Unknown operator';END IF;
 d:=coalesce(p_day,(now() AT TIME ZONE 'Europe/Madrid')::date);
 IF d<date '2000-01-01' OR d>(now() AT TIME ZONE 'Europe/Madrid')::date+1 THEN RAISE EXCEPTION 'Invalid date';END IF;
 SELECT coalesce(nullif(full_name,''),'Colaborador') INTO n FROM public.profiles WHERE id=auth.uid();
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'recorded_at',r.recorded_at,'recorded_by',r.recorded_by,'operator_name',r.operator_name,'member_name',CASE WHEN public.can_operate_club(c,'manage_members') THEN r.member_name ELSE NULL END,'member_number',CASE WHEN public.can_operate_club(c,'manage_members') THEN r.member_number ELSE NULL END,'amount_cents',r.amount_cents,'payment_method',r.payment_method,'type','cuota asociativa',
 'shift_day',coalesce(s.shift_day,(r.recorded_at AT TIME ZONE 'Europe/Madrid')::date),
 'shift',CASE WHEN s.receipt_id IS NOT NULL THEN s.shift WHEN (r.recorded_at AT TIME ZONE 'Europe/Madrid')::time>=time '11:00' AND (r.recorded_at AT TIME ZONE 'Europe/Madrid')::time<time '17:00' THEN 1 WHEN (r.recorded_at AT TIME ZONE 'Europe/Madrid')::time>=time '17:00' AND (r.recorded_at AT TIME ZONE 'Europe/Madrid')::time<time '23:00' THEN 2 ELSE NULL END,
 'attribution_source',CASE WHEN s.receipt_id IS NULL THEN 'fecha original del servidor' ELSE 'registro inmutable del turno' END) ORDER BY r.recorded_at,r.id),'[]') INTO rows
 FROM public.membership_receipts r LEFT JOIN public.snoop_membership_shifts s ON s.receipt_id=r.id
 WHERE r.club_id=c AND r.recorded_at>=(d::timestamp AT TIME ZONE 'Europe/Madrid') AND r.recorded_at<((d+1)::timestamp AT TIME ZONE 'Europe/Madrid')
 AND (CASE WHEN admin THEN p_operator IS NULL OR r.recorded_by=p_operator ELSE r.recorded_by=auth.uid() END);
 RETURN jsonb_build_object('server_now',now(),'day',d,'user_id',auth.uid(),'operator_name',coalesce(n,'Colaborador'),'admin',admin,'rows',rows);
END; $$;
REVOKE ALL ON FUNCTION public.snoop_membership_shift_report(date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_membership_shift_report(date,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Independent association receipts; no dependency on orders, sales or stock.
CREATE TABLE public.membership_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  member_number text NOT NULL,
  member_name text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operator_name text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash','card','transfer','other')),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 240),
  request_id uuid NOT NULL,
  UNIQUE (club_id, request_id)
);
CREATE INDEX membership_receipts_club_date ON public.membership_receipts(club_id, recorded_at DESC, id);
ALTER TABLE public.membership_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_receipts FROM anon, authenticated;
GRANT SELECT ON public.membership_receipts TO authenticated;
GRANT ALL ON public.membership_receipts TO service_role;

CREATE FUNCTION public.can_read_membership_receipts(target_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT auth.uid() IS NOT NULL AND (public.is_super_admin(auth.uid()) OR EXISTS (
   SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.club_id = target_club
     AND target_club = public.current_club_id()
     AND (r.role = 'admin' OR r.permissions && ARRAY['use_cash','view_reports']::public.app_permission[])
 ));
$$;
REVOKE ALL ON FUNCTION public.can_read_membership_receipts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_membership_receipts(uuid) TO authenticated;
CREATE POLICY receipts_read ON public.membership_receipts FOR SELECT TO authenticated
USING (public.can_read_membership_receipts(club_id));

CREATE FUNCTION public.record_membership_receipt(
 p_club_id uuid, p_member_id uuid, p_amount_cents integer,
 p_payment_method text, p_description text, p_request_id uuid
) RETURNS public.membership_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE receipt public.membership_receipts; m public.members; operator_label text;
BEGIN
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
REVOKE ALL ON FUNCTION public.record_membership_receipt(uuid,uuid,integer,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_membership_receipt(uuid,uuid,integer,text,text,uuid) TO authenticated;

CREATE FUNCTION public.membership_receipt_report(p_club_id uuid, p_from date, p_to date, p_group text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.can_read_membership_receipts(p_club_id) THEN RAISE EXCEPTION 'No tienes permiso para consultar este club' USING ERRCODE = '42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > 3660 OR p_group IS NULL OR p_group NOT IN ('day','month')
 THEN RAISE EXCEPTION 'Periodo no válido' USING ERRCODE = '22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(summary)), '[]'::jsonb) INTO result FROM (SELECT
   to_char(r.recorded_at AT TIME ZONE 'Europe/Madrid', CASE WHEN p_group = 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS period,
   r.payment_method, count(*) AS receipts, sum(r.amount_cents)::bigint AS total_cents
 FROM public.membership_receipts r
 WHERE r.club_id = p_club_id
   AND r.recorded_at >= (p_from::timestamp AT TIME ZONE 'Europe/Madrid')
   AND r.recorded_at < (p_to::timestamp AT TIME ZONE 'Europe/Madrid')
 GROUP BY 1,2 ORDER BY 1 DESC,2) summary;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.membership_receipt_report(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.membership_receipt_report(uuid,date,date,text) TO authenticated;

-- PROPOSAL ONLY: requires explicit approval; no existing policy/table changes.
BEGIN;
CREATE TABLE public.snoop_member_mail_cutover(installed_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.snoop_member_mail_cutover DEFAULT VALUES;
CREATE TABLE public.snoop_member_mail_legacy_review(member_id uuid PRIMARY KEY REFERENCES public.members(id),club_id uuid NOT NULL REFERENCES public.clubs(id),reviewed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.snoop_member_mail_cutover ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snoop_member_mail_legacy_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.snoop_member_mail_cutover,public.snoop_member_mail_legacy_review FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.snoop_member_mail_cutover,public.snoop_member_mail_legacy_review TO service_role;
CREATE TABLE public.snoop_member_mail(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL REFERENCES public.clubs(id),member_id uuid NOT NULL REFERENCES public.members(id),
 recipient text NOT NULL,member_number text NOT NULL,club_name text NOT NULL,idempotency_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','accepted','delivered','error','unknown')),
 provider_id text UNIQUE,attempts integer NOT NULL DEFAULT 0,lease uuid,lease_until timestamptz,error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.snoop_member_mail_events(event_id text PRIMARY KEY,provider_id text NOT NULL,event_type text NOT NULL CHECK(event_type IN('email.delivered','email.bounced')),received_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.snoop_member_mail ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snoop_member_mail_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.snoop_member_mail,public.snoop_member_mail_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.snoop_member_mail,public.snoop_member_mail_events TO service_role;
CREATE FUNCTION public.snoop_member_mail_request(p_member uuid,p_retry boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; m public.members; j public.snoop_member_mail; k text; n text;
BEGIN
 c:=public.current_club_id();IF c IS NULL OR NOT public.can_operate_club(c,'manage_members') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.members WHERE id=p_member AND club_id=c;
 IF NOT FOUND OR m.email IS NULL OR m.email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Socio o email no disponible';END IF;
 IF m.created_at<(SELECT installed_at FROM public.snoop_member_mail_cutover LIMIT 1) AND NOT EXISTS(SELECT 1 FROM public.snoop_member_mail_legacy_review WHERE member_id=m.id AND club_id=c) THEN RAISE EXCEPTION 'Reconciliar la cola anterior antes de reenviar un QR histórico';END IF;
 SELECT name INTO n FROM public.clubs WHERE id=c;
 k:='snoop-card-v1-'||md5(c::text||m.id::text||lower(trim(m.email))||m.member_number);
 INSERT INTO public.snoop_member_mail(club_id,member_id,recipient,member_number,club_name,idempotency_key)
 VALUES(c,m.id,lower(trim(m.email)),m.member_number,n,k) ON CONFLICT(idempotency_key) DO NOTHING;
 SELECT * INTO j FROM public.snoop_member_mail WHERE idempotency_key=k FOR UPDATE;
 IF p_retry AND j.status IN('error','unknown') AND j.provider_id IS NULL AND j.attempts<5 AND j.created_at>now()-interval '23 hours' THEN
 UPDATE public.snoop_member_mail SET status='pending',error_code=NULL,updated_at=now() WHERE id=j.id RETURNING * INTO j;END IF;
 RETURN jsonb_build_object('id',j.id,'status',j.status,'attempts',j.attempts,'error_code',j.error_code,'provider_id',j.provider_id);
END; $$;
CREATE FUNCTION public.snoop_member_mail_status(p_member uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; j public.snoop_member_mail;
BEGIN
 c:=public.current_club_id();IF c IS NULL OR NOT public.can_operate_club(c,'manage_members') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.members WHERE id=p_member AND club_id=c) THEN RAISE EXCEPTION 'Forbidden';END IF;
 SELECT * INTO j FROM public.snoop_member_mail WHERE member_id=p_member AND club_id=c ORDER BY created_at DESC LIMIT 1;
 RETURN jsonb_build_object('id',j.id,'status',coalesce(j.status,'not_requested'),'attempts',j.attempts,'error_code',j.error_code,'provider_id',j.provider_id);
END; $$;
CREATE FUNCTION public.snoop_claim_member_mail() RETURNS SETOF public.snoop_member_mail
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.snoop_member_mail;
BEGIN
 UPDATE public.snoop_member_mail SET status=CASE WHEN attempts=0 THEN 'error' ELSE 'unknown' END,error_code='idempotency_window_expired',updated_at=now() WHERE status IN('pending','sending') AND created_at<=now()-interval '23 hours';
 SELECT * INTO j FROM public.snoop_member_mail WHERE (status='pending' OR (status='sending' AND lease_until<now())) AND attempts<5 AND created_at>now()-interval '23 hours' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.members WHERE id=j.member_id AND club_id=j.club_id AND lower(trim(email))=j.recipient AND member_number=j.member_number) THEN
 UPDATE public.snoop_member_mail SET status='error',error_code='member_changed',updated_at=now() WHERE id=j.id;RETURN;END IF;
 RETURN QUERY UPDATE public.snoop_member_mail SET status='sending',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=j.id RETURNING *;
END; $$;
CREATE FUNCTION public.snoop_finish_member_mail(p_id uuid,p_lease uuid,p_status text,p_provider text DEFAULT NULL,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE affected integer; actual text;
BEGIN
 IF p_status NOT IN('accepted','error','unknown') OR (p_status='accepted' AND coalesce(p_provider,'')='') THEN RAISE EXCEPTION 'Invalid provider result';END IF;
 actual:=CASE WHEN p_status='accepted' AND EXISTS(SELECT 1 FROM public.snoop_member_mail_events WHERE provider_id=p_provider AND event_type='email.bounced') THEN 'error' WHEN p_status='accepted' AND EXISTS(SELECT 1 FROM public.snoop_member_mail_events WHERE provider_id=p_provider AND event_type='email.delivered') THEN 'delivered' ELSE p_status END;
 UPDATE public.snoop_member_mail SET status=actual,provider_id=p_provider,error_code=CASE WHEN actual='error' AND p_status='accepted' THEN 'provider_bounce' ELSE p_error END,lease_until=NULL,updated_at=now() WHERE id=p_id AND lease=p_lease AND status='sending';GET DIAGNOSTICS affected=ROW_COUNT;RETURN affected=1;
END; $$;
CREATE FUNCTION public.snoop_confirm_member_mail(p_event text,p_provider text,p_type text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE affected integer;
BEGIN
 IF p_type NOT IN('email.delivered','email.bounced') THEN RAISE EXCEPTION 'Invalid event';END IF;
 INSERT INTO public.snoop_member_mail_events(event_id,provider_id,event_type) VALUES(p_event,p_provider,p_type) ON CONFLICT DO NOTHING;GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=0 THEN RETURN false;END IF;
 UPDATE public.snoop_member_mail SET status=CASE WHEN p_type='email.delivered' THEN 'delivered' ELSE 'error' END,error_code=CASE WHEN p_type='email.bounced' THEN 'provider_bounce' ELSE NULL END,updated_at=now() WHERE provider_id=p_provider;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.snoop_member_mail_request(uuid,boolean),public.snoop_member_mail_status(uuid),public.snoop_claim_member_mail(),public.snoop_finish_member_mail(uuid,uuid,text,text,text),public.snoop_confirm_member_mail(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.snoop_member_mail_request(uuid,boolean),public.snoop_member_mail_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.snoop_claim_member_mail(),public.snoop_finish_member_mail(uuid,uuid,text,text,text),public.snoop_confirm_member_mail(text,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

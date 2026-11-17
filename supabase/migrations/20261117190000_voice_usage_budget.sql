-- SNOOP voice usage only. Prepare for approval; no existing business rows are changed.
BEGIN;
CREATE TABLE public.snoop_voice_budget (
 club_id uuid PRIMARY KEY REFERENCES public.clubs(id),
 monthly_seconds integer NOT NULL DEFAULT 3600 CHECK(monthly_seconds BETWEEN 0 AND 864000),
 rate_microusd_per_minute integer CHECK(rate_microusd_per_minute BETWEEN 1 AND 10000000),
 budget_microusd bigint NOT NULL DEFAULT 10000000 CHECK(budget_microusd BETWEEN 0 AND 1000000000)
);
CREATE TABLE public.snoop_voice_month (
 club_id uuid NOT NULL REFERENCES public.clubs(id), month date NOT NULL,
 reserved_seconds integer NOT NULL DEFAULT 0 CHECK(reserved_seconds>=0),
 connected_ms bigint NOT NULL DEFAULT 0 CHECK(connected_ms>=0), PRIMARY KEY(club_id,month)
);
CREATE TABLE public.snoop_voice_session (
 id uuid PRIMARY KEY, club_id uuid NOT NULL REFERENCES public.clubs(id), actor_id uuid NOT NULL,
 month date NOT NULL, sequence integer NOT NULL DEFAULT 0, reserved_seconds integer NOT NULL,
 connected_ms bigint NOT NULL DEFAULT 0, lease_until timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','closed')),
 CHECK(reserved_seconds>=0 AND connected_ms>=0)
);
CREATE UNIQUE INDEX snoop_voice_one_active_actor ON public.snoop_voice_session(club_id,actor_id) WHERE state='active';
ALTER TABLE public.snoop_voice_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snoop_voice_month ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snoop_voice_session ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.snoop_voice_budget,public.snoop_voice_month,public.snoop_voice_session FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.snoop_voice_budget,public.snoop_voice_month,public.snoop_voice_session TO authenticated;
CREATE POLICY voice_budget_read ON public.snoop_voice_budget FOR SELECT TO authenticated USING(public.is_current_user_club_admin(club_id));
CREATE POLICY voice_month_read ON public.snoop_voice_month FOR SELECT TO authenticated USING(public.is_current_user_club_admin(club_id));
CREATE POLICY voice_session_read ON public.snoop_voice_session FOR SELECT TO authenticated USING(public.can_operate_club(club_id,NULL) AND (actor_id=auth.uid() OR public.is_current_user_club_admin(club_id)));

-- Server-only lease. User/club derive from a verified JWT in the gateway, never model arguments.
-- A service credential is used exclusively for this metering RPC, never for business reads/writes.
CREATE FUNCTION public.snoop_voice_usage(p_id uuid,p_actor uuid,p_club uuid,p_operation text,p_sequence integer,p_connected_ms bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE config public.snoop_voice_budget; m public.snoop_voice_month; s public.snoop_voice_session;
 period date:=date_trunc('month',now() AT TIME ZONE 'UTC')::date; cap integer; delta integer; answer jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_id IS NULL OR p_actor IS NULL OR p_club IS NULL OR p_operation IS NULL OR p_sequence IS NULL OR p_connected_ms IS NULL OR p_sequence<0 OR p_sequence>1000000 OR p_connected_ms<0 THEN RAISE EXCEPTION 'Voice usage denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles r JOIN public.clubs c ON c.id=r.club_id WHERE r.user_id=p_actor AND r.club_id=p_club AND r.role='admin' AND c.active AND (c.subscription_expires_at IS NULL OR c.subscription_expires_at>now()))
 OR public.is_super_admin(p_actor) THEN RAISE EXCEPTION 'Voice access revoked' USING ERRCODE='42501'; END IF;
 INSERT INTO public.snoop_voice_budget(club_id) VALUES(p_club) ON CONFLICT DO NOTHING;
 SELECT * INTO config FROM public.snoop_voice_budget WHERE club_id=p_club FOR UPDATE;
 SELECT * INTO s FROM public.snoop_voice_session WHERE id=p_id FOR UPDATE;
 IF s.id IS NOT NULL THEN
  IF s.club_id<>p_club OR s.actor_id<>p_actor THEN RAISE EXCEPTION 'Foreign voice session' USING ERRCODE='42501'; END IF;
  period:=s.month;
 END IF;
 INSERT INTO public.snoop_voice_month(club_id,month) VALUES(p_club,period) ON CONFLICT DO NOTHING;
 SELECT * INTO m FROM public.snoop_voice_month WHERE club_id=p_club AND month=period FOR UPDATE;
 cap:=config.monthly_seconds;
 IF config.rate_microusd_per_minute IS NOT NULL THEN cap:=least(cap, least(2147483647,floor(config.budget_microusd::numeric*60/config.rate_microusd_per_minute))::integer); END IF;
 IF p_operation='start' AND s.id IS NULL THEN
  IF p_sequence<>0 THEN RAISE EXCEPTION 'Invalid initial sequence'; END IF;
  UPDATE public.snoop_voice_session SET state='closed' WHERE club_id=p_club AND actor_id=p_actor AND state='active' AND lease_until<now();
  IF EXISTS(SELECT 1 FROM public.snoop_voice_session WHERE club_id=p_club AND actor_id=p_actor AND state='active') THEN RAISE EXCEPTION 'Voice session already active'; END IF;
  delta:=least(30,cap-m.reserved_seconds);
  IF delta<=0 THEN RAISE EXCEPTION 'VOICE_BUDGET_EXHAUSTED'; END IF;
  INSERT INTO public.snoop_voice_session(id,club_id,actor_id,month,reserved_seconds,lease_until) VALUES(p_id,p_club,p_actor,period,delta,now()+make_interval(secs=>delta)) RETURNING * INTO s;
 ELSIF p_operation IN('start','extend') AND s.id IS NOT NULL AND p_sequence=s.sequence THEN
  NULL; -- Idempotent duplicate: never charge twice.
 ELSIF p_operation='extend' AND s.state='active' AND s.lease_until>=now() AND p_sequence=s.sequence+1 THEN
  delta:=least(30,cap-m.reserved_seconds);
  IF delta<=0 THEN RAISE EXCEPTION 'VOICE_BUDGET_EXHAUSTED'; END IF;
  UPDATE public.snoop_voice_session SET sequence=p_sequence,reserved_seconds=reserved_seconds+delta,lease_until=lease_until+make_interval(secs=>delta) WHERE id=p_id RETURNING * INTO s;
 ELSIF p_operation='close' AND s.id IS NOT NULL THEN
  IF s.state='active' THEN
   IF p_connected_ms>s.reserved_seconds::bigint*1000 THEN RAISE EXCEPTION 'Unreserved voice duration'; END IF;
   delta:=ceil(p_connected_ms::numeric/1000)::integer-s.reserved_seconds;
   UPDATE public.snoop_voice_month SET connected_ms=connected_ms+p_connected_ms WHERE club_id=p_club AND month=period;
   UPDATE public.snoop_voice_session SET state='closed',connected_ms=p_connected_ms,reserved_seconds=ceil(p_connected_ms::numeric/1000)::integer WHERE id=p_id RETURNING * INTO s;
  END IF;
 ELSE RAISE EXCEPTION 'Invalid or expired voice lease'; END IF;
 UPDATE public.snoop_voice_month SET reserved_seconds=reserved_seconds+coalesce(delta,0) WHERE club_id=p_club AND month=period RETURNING * INTO m;
 answer:=jsonb_build_object('session',s.id,'sequence',s.sequence,'state',s.state,'leaseUntil',s.lease_until,'reservedSeconds',s.reserved_seconds,'remainingSeconds',greatest(0,cap-m.reserved_seconds),'monthlySeconds',cap,'connectedMs',m.connected_ms,'estimatedMicrousd',CASE WHEN config.rate_microusd_per_minute IS NULL THEN NULL ELSE ceil(m.connected_ms::numeric/60000*config.rate_microusd_per_minute) END,'billedCostVerified',false);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_usage(uuid,uuid,uuid,text,integer,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.snoop_voice_usage(uuid,uuid,uuid,text,integer,bigint) TO service_role;
COMMIT;

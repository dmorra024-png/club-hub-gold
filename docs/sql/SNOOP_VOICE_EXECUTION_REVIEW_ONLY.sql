-- REVIEW ONLY. Never apply automatically. Reuses existing access-control RPCs.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.snoop_get_club_access_control()') IS NULL OR
 to_regprocedure('public.snoop_set_club_access_control(boolean)') IS NULL THEN
 RAISE EXCEPTION 'VOICE_EXECUTION_DEPENDENCY_MISSING'; END IF;
END $$;
CREATE TABLE public.snoop_voice_executions (
 id uuid PRIMARY KEY, actor uuid NOT NULL, club uuid NOT NULL,
 token uuid NOT NULL DEFAULT gen_random_uuid(),
 enabled boolean NOT NULL, expected boolean NOT NULL,
 prepared_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 result jsonb
);
ALTER TABLE public.snoop_voice_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.snoop_voice_executions FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.snoop_voice_access(p_request uuid,p_operation text,p_enabled boolean DEFAULT NULL,p_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid:=public.current_club_id();a uuid:=auth.uid();r public.snoop_voice_executions;v jsonb;
BEGIN
 IF a IS NULL OR c IS NULL OR public.is_current_user_club_admin(c) IS DISTINCT FROM true
 OR public.can_operate_club(c,NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 IF p_operation NOT IN ('prepare','confirm','status') OR p_operation IS NULL OR p_request IS NULL
 THEN RAISE EXCEPTION 'VOICE_INVALID_OPERATION';END IF;
 IF p_operation='prepare' THEN
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'VOICE_VALUE_REQUIRED';END IF;
 v:=public.snoop_get_club_access_control();
 INSERT INTO public.snoop_voice_executions(id,actor,club,enabled,expected)
 VALUES(p_request,a,c,p_enabled,(v->>'enabled')::boolean) ON CONFLICT(id) DO NOTHING;
 END IF;
 SELECT * INTO r FROM public.snoop_voice_executions WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.actor<>a OR r.club<>c THEN RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 IF p_operation='prepare' AND r.enabled IS DISTINCT FROM p_enabled THEN RAISE EXCEPTION 'VOICE_KEY_REUSED';END IF;
 IF p_operation='confirm' THEN
 PERFORM 1 FROM public.clubs WHERE id=c FOR UPDATE;
 IF p_token IS DISTINCT FROM r.token THEN RAISE EXCEPTION 'VOICE_CONFIRMATION_REQUIRED';END IF;
 IF r.completed_at IS NULL THEN
 IF now()>r.prepared_at+interval '10 minutes' THEN RAISE EXCEPTION 'VOICE_CONFIRMATION_EXPIRED';END IF;
 v:=public.snoop_get_club_access_control();
 IF (v->>'enabled')::boolean IS DISTINCT FROM r.expected THEN RAISE EXCEPTION 'VOICE_STATE_CHANGED';END IF;
 v:=public.snoop_set_club_access_control(r.enabled);
 IF (v->>'enabled')::boolean IS DISTINCT FROM r.enabled OR
 (public.snoop_get_club_access_control()->>'enabled')::boolean IS DISTINCT FROM r.enabled
 THEN RAISE EXCEPTION 'VOICE_RESULT_UNVERIFIED';END IF;
 UPDATE public.snoop_voice_executions SET result=v,completed_at=now() WHERE id=r.id;
 SELECT * INTO r FROM public.snoop_voice_executions WHERE id=r.id;
 END IF;
 END IF;
 RETURN jsonb_build_object('id',r.id,'status',CASE WHEN r.completed_at IS NULL THEN 'confirmation_required' ELSE 'completed' END,
 'enabled',r.enabled,'result',r.result,'token',CASE WHEN p_operation='prepare' THEN r.token ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.snoop_voice_access(uuid,text,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snoop_voice_access(uuid,text,boolean,uuid) TO authenticated;
COMMIT;

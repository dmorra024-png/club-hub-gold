-- Approval-required metadata upgrade for recording the actual closer of NEW sessions.
-- Not applied remotely. No backfill, accounting updates or policy changes.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.cash_sessions') IS NULL OR to_regprocedure('public.can_operate_club(uuid,public.app_permission)') IS NULL THEN RAISE EXCEPTION 'Missing cash/platform dependencies';END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cash_sessions' AND column_name='closed_by' AND data_type<>'uuid') THEN RAISE EXCEPTION 'Incompatible closer field';END IF;
 IF to_regprocedure('public.snoop_cash_session_audit()') IS NOT NULL THEN RAISE EXCEPTION 'Audit already installed; do not reapply';END IF;
END $$;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE FUNCTION public.snoop_cash_session_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_operate_club(NEW.club_id,'use_cash') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.user_id<>auth.uid() OR NEW.status<>'open' THEN RAISE EXCEPTION 'Invalid session owner/state';END IF;
  NEW.opened_at:=now();NEW.closed_at:=NULL;NEW.closed_by:=NULL;
 ELSE
  IF ROW(NEW.user_id,NEW.club_id,NEW.opened_at,NEW.opening_cash_cents) IS DISTINCT FROM ROW(OLD.user_id,OLD.club_id,OLD.opened_at,OLD.opening_cash_cents) OR OLD.status='closed' THEN RAISE EXCEPTION 'Session history is immutable';END IF;
  IF NEW.status='closed' THEN
   IF NEW.closing_cash_cents IS NULL OR NEW.closing_cash_cents<0 THEN RAISE EXCEPTION 'Missing closing amount';END IF;
   NEW.closed_at:=now();NEW.closed_by:=auth.uid();
  ELSE NEW.closed_at:=NULL;NEW.closed_by:=NULL;END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snoop_cash_session_audit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snoop_cash_session_audit BEFORE INSERT OR UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION public.snoop_cash_session_audit();
NOTIFY pgrst,'reload schema';
COMMIT;

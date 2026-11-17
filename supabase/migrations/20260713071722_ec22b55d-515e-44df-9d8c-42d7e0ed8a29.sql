
CREATE TABLE public.check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  scanned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.check_ins TO authenticated;
GRANT ALL ON public.check_ins TO service_role;

ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "check_ins club access select" ON public.check_ins
  FOR SELECT TO authenticated
  USING (public.user_has_club_access(club_id));

CREATE POLICY "check_ins club access insert" ON public.check_ins
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_club_access(club_id));

CREATE INDEX check_ins_club_created_idx ON public.check_ins (club_id, created_at DESC);
CREATE INDEX check_ins_member_created_idx ON public.check_ins (member_id, created_at DESC);

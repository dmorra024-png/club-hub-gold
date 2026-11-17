
CREATE TABLE public.club_member_field_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_id, field_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_member_field_config TO authenticated;
GRANT ALL ON public.club_member_field_config TO service_role;

ALTER TABLE public.club_member_field_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "club members can read field config"
  ON public.club_member_field_config FOR SELECT TO authenticated
  USING (public.user_has_club_access(club_id));

CREATE POLICY "admins can manage field config"
  ON public.club_member_field_config FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (public.user_has_club_access(club_id) AND public.has_role(auth.uid(), 'admin')))
  WITH CHECK (public.is_super_admin(auth.uid()) OR (public.user_has_club_access(club_id) AND public.has_role(auth.uid(), 'admin')));

CREATE TRIGGER trg_club_member_field_config_updated
  BEFORE UPDATE ON public.club_member_field_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Add address + postal_code columns to members (optional fields)
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT;

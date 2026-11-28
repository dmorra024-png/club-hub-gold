-- GERVIS SNOOP: REVIEW-ONLY SQL, NEVER EXECUTE ON EXISTING PILOT.
-- Draft for an isolated development Supabase environment. Before installation:
-- generate a properly named local migration with 'supabase migration new',
-- run RLS/advisor tests, and explicitly approve the target project.
-- Storage contains only manually approved pronunciation/workflow preferences;
-- NEVER store member records, account secrets, identity documents or chats.

CREATE TABLE public.gervis_learning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pronunciation','workflow_preference')),
  phrase text NOT NULL CHECK (char_length(phrase) BETWEEN 2 AND 90),
  meaning text NOT NULL CHECK (char_length(meaning) BETWEEN 2 AND 160),
  approved_by uuid NOT NULL REFERENCES auth.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id,kind,phrase)
);

REVOKE ALL ON public.gervis_learning FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gervis_learning TO authenticated;
ALTER TABLE public.gervis_learning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gervis_learning FORCE ROW LEVEL SECURITY;

-- Collaborators may read approved glossary entries only for their own club.
CREATE POLICY gervis_read_club ON public.gervis_learning
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.club_id = gervis_learning.club_id
      AND ur.role IN ('admin'::public.app_role, 'collaborator'::public.app_role)
  ));

-- Only a currently assigned club ADMIN can approve, change or remove lessons.
-- Neither self-reported club IDs nor user_metadata grant access.
CREATE POLICY gervis_admin_insert ON public.gervis_learning
  FOR INSERT TO authenticated
  WITH CHECK (
    approved_by = (SELECT auth.uid()) AND
    EXISTS (SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.club_id = gervis_learning.club_id
        AND ur.role = 'admin'::public.app_role)
  );
CREATE POLICY gervis_admin_update ON public.gervis_learning
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.club_id = gervis_learning.club_id
      AND ur.role = 'admin'::public.app_role))
  WITH CHECK (
    approved_by = (SELECT auth.uid()) AND
    EXISTS (SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.club_id = gervis_learning.club_id
        AND ur.role = 'admin'::public.app_role)
  );
CREATE POLICY gervis_admin_delete ON public.gervis_learning
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.club_id = gervis_learning.club_id
      AND ur.role = 'admin'::public.app_role));

-- Mandatory live proof before release: anon cannot SELECT/INSERT;
-- club A cannot see, update or delete club B; collaborators cannot write;
-- operator approval must be explicit, auditable and reversible.

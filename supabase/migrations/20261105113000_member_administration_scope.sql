-- Administrative membership data only. Existing records are preserved.
BEGIN;
CREATE OR REPLACE FUNCTION public.can_manage_club_members(_club_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND club_id = _club_id
      AND (role = 'admin' OR 'manage_members' = ANY(permissions))
  )
$$;
REVOKE ALL ON FUNCTION public.can_manage_club_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_club_members(UUID) TO authenticated, service_role;

REVOKE ALL ON public.members FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.members FROM authenticated;
DROP POLICY IF EXISTS members_all ON public.members;
CREATE POLICY members_administrative_read ON public.members FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id());
CREATE POLICY members_administrative_insert ON public.members FOR INSERT TO authenticated
  WITH CHECK ((public.is_super_admin(auth.uid()) OR club_id = public.current_club_id()) AND public.can_manage_club_members(club_id));
CREATE POLICY members_administrative_update ON public.members FOR UPDATE TO authenticated
  USING ((public.is_super_admin(auth.uid()) OR club_id = public.current_club_id()) AND public.can_manage_club_members(club_id))
  WITH CHECK ((public.is_super_admin(auth.uid()) OR club_id = public.current_club_id()) AND public.can_manage_club_members(club_id));
CREATE POLICY members_administrative_delete ON public.members FOR DELETE TO authenticated
  USING ((public.is_super_admin(auth.uid()) OR club_id = public.current_club_id()) AND public.can_manage_club_members(club_id));

-- A valid plan UUID alone is not enough: it must belong to the member's club.
CREATE UNIQUE INDEX IF NOT EXISTS membership_plans_id_club_key ON public.membership_plans(id, club_id);
ALTER TABLE public.members ADD CONSTRAINT members_plan_same_club
  FOREIGN KEY (plan_id, club_id) REFERENCES public.membership_plans(id, club_id) NOT VALID;
-- NOT VALID preserves historical rows; new inserts/key changes are checked.
COMMIT;

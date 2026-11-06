-- Account security only. No existing users, memberships or application data
-- are deleted or rewritten. Apply to a test project before production review.
BEGIN;

-- Membership changes must go through authenticated, club-scoped server handlers.
-- Existing policies allowed club admins to change privileged account rows via
-- direct PostgREST requests, bypassing the application's checks.
REVOKE ALL ON public.user_roles FROM anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
DROP POLICY IF EXISTS user_roles_insert ON public.user_roles;
DROP POLICY IF EXISTS user_roles_update ON public.user_roles;
DROP POLICY IF EXISTS user_roles_delete ON public.user_roles;
DROP POLICY IF EXISTS user_roles_admin_all ON public.user_roles;
DROP POLICY IF EXISTS user_roles_self_read ON public.user_roles;
DROP POLICY IF EXISTS user_roles_select ON public.user_roles;

CREATE OR REPLACE FUNCTION public.is_current_user_club_admin(_club_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND club_id = _club_id AND role = 'admin'
  )
$$;
REVOKE ALL ON FUNCTION public.is_current_user_club_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_club_admin(UUID) TO authenticated, service_role;

CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_current_user_club_admin(club_id));

-- Profiles are personal data, not a global authenticated-user directory.
REVOKE ALL ON public.profiles FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated;
CREATE OR REPLACE FUNCTION public.can_read_profile(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _user_id = auth.uid() OR public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles AS caller
    JOIN public.user_roles AS target ON target.club_id = caller.club_id
    WHERE caller.user_id = auth.uid() AND target.user_id = _user_id
  )
$$;
REVOKE ALL ON FUNCTION public.can_read_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_profile(UUID) TO authenticated, service_role;
DROP POLICY IF EXISTS profiles_read_auth ON public.profiles;
CREATE POLICY profiles_read_auth ON public.profiles FOR SELECT TO authenticated
  USING (public.can_read_profile(id));

-- Never grant super-admin to a public signup merely because the last admin
-- was removed or an installation has not been bootstrapped yet. Provision the
-- first super-admin explicitly through a trusted, reviewed database operation.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END
$$;

COMMIT;

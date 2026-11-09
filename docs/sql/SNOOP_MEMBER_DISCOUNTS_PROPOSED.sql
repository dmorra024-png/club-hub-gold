-- Proposed only: do not apply without authorization. No historical/economic updates.
BEGIN;
CREATE TABLE public.member_discounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 percentage_basis_points integer NOT NULL CHECK(percentage_basis_points BETWEEN 1 AND 10000),
 active boolean NOT NULL DEFAULT true,
 valid_from date, valid_until date,
 CHECK(valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until),
 UNIQUE(id,club_id)
);
CREATE UNIQUE INDEX snoop_member_discount_scope ON public.members(id,club_id);
CREATE TABLE public.member_discount_assignments (
 member_id uuid PRIMARY KEY,
 FOREIGN KEY(member_id,club_id) REFERENCES public.members(id,club_id),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 discount_id uuid NOT NULL,
 FOREIGN KEY(discount_id,club_id) REFERENCES public.member_discounts(id,club_id)
);
CREATE FUNCTION public.guard_member_discount_assignment() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.members m WHERE m.id=NEW.member_id AND m.club_id=NEW.club_id)
 THEN RAISE EXCEPTION 'Member club mismatch' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER member_discount_assignment_scope BEFORE INSERT OR UPDATE ON public.member_discount_assignments
 FOR EACH ROW EXECUTE FUNCTION public.guard_member_discount_assignment();
ALTER TABLE public.member_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_discount_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY discount_read ON public.member_discounts FOR SELECT TO authenticated
 USING(club_id=public.current_club_id() AND public.can_operate_club(club_id,'manage_members'));
CREATE POLICY discount_insert ON public.member_discounts FOR INSERT TO authenticated
 WITH CHECK(club_id=public.current_club_id() AND public.is_current_user_club_admin(club_id));
CREATE POLICY discount_update ON public.member_discounts FOR UPDATE TO authenticated
 USING(club_id=public.current_club_id() AND public.is_current_user_club_admin(club_id)) WITH CHECK(club_id=public.current_club_id() AND public.is_current_user_club_admin(club_id));
CREATE POLICY assignment_read ON public.member_discount_assignments FOR SELECT TO authenticated
 USING(club_id=public.current_club_id() AND public.can_operate_club(club_id,'manage_members'));
CREATE POLICY assignment_insert ON public.member_discount_assignments FOR INSERT TO authenticated
 WITH CHECK(club_id=public.current_club_id() AND public.is_current_user_club_admin(club_id));
CREATE POLICY assignment_update ON public.member_discount_assignments FOR UPDATE TO authenticated
 USING(club_id=public.current_club_id() AND public.is_current_user_club_admin(club_id)) WITH CHECK(club_id=public.current_club_id() AND public.is_current_user_club_admin(club_id));
CREATE POLICY assignment_remove ON public.member_discount_assignments FOR DELETE TO authenticated
 USING(club_id=public.current_club_id() AND public.is_current_user_club_admin(club_id));
REVOKE ALL ON public.member_discounts,public.member_discount_assignments FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.member_discounts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.member_discount_assignments TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

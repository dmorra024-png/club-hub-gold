-- PROPOSAL ONLY. Never applied to a remote database by this task.
-- A separate informational ledger: no product/order/stock/payment references.
-- Does not replace or modify any existing table or RLS policy.
BEGIN;
CREATE TABLE public.genetics_information (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 name text NOT NULL CHECK(length(name) BETWEEN 3 AND 100),
 facts jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(facts)='array'),
 description text NOT NULL CHECK(length(description) BETWEEN 20 AND 4000),
 image jsonb CHECK(image IS NULL OR jsonb_typeof(image)='object'),
 status text NOT NULL DEFAULT 'reviewed' CHECK(status='reviewed'),
 reviewed_by uuid NOT NULL REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX genetics_information_club_name ON public.genetics_information(club_id,lower(name));
ALTER TABLE public.genetics_information ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genetics_information FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.genetics_information FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.genetics_information TO authenticated;
CREATE POLICY genetics_information_read ON public.genetics_information FOR SELECT TO authenticated
 USING(public.can_operate_club(club_id,NULL));
CREATE POLICY genetics_information_review ON public.genetics_information FOR INSERT TO authenticated
 WITH CHECK(public.can_operate_club(club_id,NULL) AND public.is_current_user_club_admin(club_id) AND reviewed_by=auth.uid());
-- No anonymous access or invented member login. The existing app authenticates
-- employees, not association members. Member-portal publication needs a separate
-- authorization design and is deliberately not enabled here.
COMMIT;

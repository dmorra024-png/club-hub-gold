-- Preserve historical rows; enforce valid amounts on new writes only.
ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_opening_nonnegative
  CHECK (opening_cash_cents >= 0) NOT VALID;
ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_closing_nonnegative
  CHECK (closing_cash_cents IS NULL OR closing_cash_cents >= 0) NOT VALID;

DROP POLICY cash_sessions_insert ON public.cash_sessions;
CREATE POLICY cash_sessions_insert ON public.cash_sessions FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid() AND club_id = public.current_club_id()
  AND EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = auth.uid() AND r.club_id = cash_sessions.club_id
      AND (r.role = 'admin' OR 'use_cash' = ANY(r.permissions))
  )
);
DROP POLICY cash_sessions_update ON public.cash_sessions;
CREATE POLICY cash_sessions_update ON public.cash_sessions FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid()) OR (
    club_id = public.current_club_id() AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid() AND r.club_id = cash_sessions.club_id
        AND (r.role = 'admin' OR (cash_sessions.user_id = auth.uid() AND 'use_cash' = ANY(r.permissions)))
    )
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid()) OR (
    club_id = public.current_club_id() AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid() AND r.club_id = cash_sessions.club_id
        AND (r.role = 'admin' OR (cash_sessions.user_id = auth.uid() AND 'use_cash' = ANY(r.permissions)))
    )
  )
);

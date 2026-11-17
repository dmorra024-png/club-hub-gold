
CREATE TABLE public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash_cents integer not null default 0,
  closing_cash_cents integer,
  notes text,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_sessions TO authenticated;
GRANT ALL ON public.cash_sessions TO service_role;

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_sessions_select" ON public.cash_sessions FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (club_id = public.current_club_id() AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
);

CREATE POLICY "cash_sessions_insert" ON public.cash_sessions FOR INSERT TO authenticated
WITH CHECK (
  club_id = public.current_club_id() AND user_id = auth.uid()
);

CREATE POLICY "cash_sessions_update" ON public.cash_sessions FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (club_id = public.current_club_id() AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (club_id = public.current_club_id() AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
);

CREATE TRIGGER cash_sessions_updated BEFORE UPDATE ON public.cash_sessions
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE UNIQUE INDEX cash_sessions_one_open_per_user
  ON public.cash_sessions(user_id, club_id) WHERE status = 'open';

CREATE INDEX cash_sessions_club_opened_idx ON public.cash_sessions(club_id, opened_at DESC);

ALTER TABLE public.orders ADD COLUMN cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL;
CREATE INDEX orders_cash_session_idx ON public.orders(cash_session_id);

CREATE OR REPLACE FUNCTION public.current_open_cash_session()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.cash_sessions
  WHERE user_id = auth.uid() AND status = 'open'
    AND club_id = public.current_club_id()
  ORDER BY opened_at DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.tg_orders_assign_cash_session()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cash_session_id IS NULL THEN
    SELECT id INTO NEW.cash_session_id FROM public.cash_sessions
    WHERE user_id = COALESCE(NEW.created_by, auth.uid())
      AND club_id = NEW.club_id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orders_assign_cash_session BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.tg_orders_assign_cash_session();

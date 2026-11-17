
CREATE TABLE public.stock_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  delta NUMERIC NOT NULL,
  reason TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_club_created_idx ON public.stock_movements(club_id, created_at DESC);
CREATE INDEX stock_movements_product_idx ON public.stock_movements(product_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Club members can view stock movements"
  ON public.stock_movements FOR SELECT
  TO authenticated
  USING (public.user_has_club_access(club_id));

CREATE POLICY "Club members can insert stock movements"
  ON public.stock_movements FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_club_access(club_id));

CREATE POLICY "Admins can update stock movements"
  ON public.stock_movements FOR UPDATE
  TO authenticated
  USING (public.user_has_club_access(club_id) AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can delete stock movements"
  ON public.stock_movements FOR DELETE
  TO authenticated
  USING (public.user_has_club_access(club_id) AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin')));

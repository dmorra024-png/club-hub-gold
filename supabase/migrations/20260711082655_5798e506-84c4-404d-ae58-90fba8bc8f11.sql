-- Allow anonymous read of active clubs' public branding for the /{slug} login page
CREATE POLICY "clubs_public_branding_select"
ON public.clubs
FOR SELECT
TO anon
USING (active = true);

GRANT SELECT ON public.clubs TO anon;
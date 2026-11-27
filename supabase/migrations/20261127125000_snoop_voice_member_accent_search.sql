-- SNOOP Pilot: accent-insensitive member search, preserving existing actor and club checks.
-- Fixes Fatima/Fátima and splitting of compound names. No identity data is exported.
CREATE OR REPLACE FUNCTION public.snoop_voice_find_members(
  p_query text, p_club uuid, p_limit integer DEFAULT 7
)
RETURNS TABLE(id uuid, first_name text, last_name text, city text, expires_at date)
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
 IF p_club IS DISTINCT FROM public.current_club_id()
    OR public.can_operate_club(p_club,'manage_members') IS DISTINCT FROM true
 THEN
   RAISE EXCEPTION 'VOICE_ACCESS_DENIED' USING ERRCODE='42501';
 END IF;
 IF p_query IS NULL OR length(p_query)>100
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 7
 THEN
   RAISE EXCEPTION 'VOICE_INVALID_QUERY';
 END IF;
 RETURN QUERY
 SELECT m.id, m.first_name::text, m.last_name::text, m.city::text, m.expires_at
 FROM public.members m
 WHERE m.club_id=p_club AND NOT EXISTS (
   SELECT 1
   FROM regexp_split_to_table(trim(p_query), '[[:space:]]+') AS term
   WHERE term<>'' AND position(
     translate(lower(term), 'áàâäãåéèêëíìîïóòôöõúùûüñç', 'aaaaaaeeeeiiiiooooouuuunc')
     IN translate(lower(concat_ws(' ',m.first_name,m.last_name)),
       'áàâäãåéèêëíìîïóòôöõúùûüñç', 'aaaaaaeeeeiiiiooooouuuunc')
   )=0
 )
 ORDER BY m.id LIMIT p_limit;
END
$function$;

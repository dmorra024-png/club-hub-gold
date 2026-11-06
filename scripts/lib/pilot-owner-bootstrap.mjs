// One-time reviewed operations script, never an application signup/RPC endpoint.
export const PILOT_PROJECT_REF = "bnwanxbmprbymbutoths";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
export function preparePilotOwnerBootstrap({
  projectRef,
  ownerId,
  ownerEmail,
  clubId,
  clubName = "SNOOP Pilot",
  clubSlug = "snoop-pilot",
}) {
  if (projectRef !== PILOT_PROJECT_REF)
    throw new Error("Only the dedicated Snoop-pilot project is permitted");
  if (!uuid.test(ownerId) || !uuid.test(clubId))
    throw new Error("Explicit valid owner and club UUIDs are required");
  if (
    typeof ownerEmail !== "string" ||
    !/^\S+@\S+\.\S+$/.test(ownerEmail) ||
    ownerEmail.length > 254
  )
    throw new Error("Explicit owner email is required");
  if (!clubName.trim() || clubName.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clubSlug))
    throw new Error("Invalid pilot club identity");
  let bodyTag = "$snoop_owner$";
  while ([ownerEmail, clubName, clubSlug].some((value) => value.includes(bodyTag)))
    bodyTag = bodyTag.slice(0, -1) + "x$";
  return `-- SNOOP: ONE-TIME OWNER BOOTSTRAP. NOT A MIGRATION OR PUBLIC RPC.
-- Target project ONLY: ${PILOT_PROJECT_REF}
-- Apply through the trusted project-specific management endpoint only AFTER approval.
BEGIN;
SET LOCAL lock_timeout='10s';
LOCK TABLE public.user_roles,public.clubs IN SHARE ROW EXCLUSIVE MODE;
DO ${bodyTag}
DECLARE target uuid := ${literal(ownerId)}; pilot uuid := ${literal(clubId)};
BEGIN
 PERFORM 1 FROM auth.users WHERE id=target FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=target AND lower(email)=lower(${literal(ownerEmail)}) AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) AND (banned_until IS NULL OR banned_until<=now())) THEN
  RAISE EXCEPTION 'SNOOP_OWNER_IDENTITY_NOT_CONFIRMED';
 END IF;
 IF EXISTS(SELECT 1 FROM public.user_roles) OR EXISTS(SELECT 1 FROM public.clubs) THEN
  RAISE EXCEPTION 'SNOOP_BOOTSTRAP_STATE_CHANGED: roles or clubs already exist; no changes applied';
 END IF;
 INSERT INTO public.clubs(id,name,slug) VALUES(pilot,${literal(clubName.trim())},${literal(clubSlug)});
 INSERT INTO public.user_roles(user_id,role,permissions,club_id)
 VALUES(target,'super_admin',ARRAY['manage_members','manage_products','manage_collaborators','view_reports','use_cash']::public.app_permission[],NULL),
       (target,'admin',ARRAY['manage_members','manage_products','manage_collaborators','view_reports','use_cash']::public.app_permission[],pilot);
 IF (SELECT count(*) FROM public.user_roles WHERE user_id=target)<>2 OR NOT public.is_super_admin(target) THEN
  RAISE EXCEPTION 'SNOOP_BOOTSTRAP_VERIFICATION_FAILED';
 END IF;
END;
${bodyTag};
COMMIT;
SELECT 'SNOOP_OWNER_BOOTSTRAP_OK' AS result;
`;
}

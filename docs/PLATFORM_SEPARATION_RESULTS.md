# SNOOP — platform/club separation

The prepared upgrade preserves all current accounts, clubs, roles and private data. No remote database write, account creation, suspension, merge or deployment was performed for this change.

## Resulting behavior

* `/snoop-admin` is a distinct web administration panel and layout. Every privileged management action verifies the authenticated platform role on the server before using a private service client. Only allowlisted club metadata are returned. Direct browser writes to clubs remain forbidden, even for a platform identity.
* Club creation/admin invitation are retained. Club metadata editing, suspension/reactivation and subscription expiration use a validated server command with explicit confirmation for suspension/reactivation. No payment service is introduced.
* A Super Admin cannot access the normal application or private club data. This applies even to the historical pilot owner with both Super Admin and Admin rows. Existing rows are retained; the server and SQL explicitly deny the platform identity operational authority. A different non-platform identity must administer the pilot club; none has been provisioned automatically.
* The database returns each authenticated user's effective role, club and status. Administrators and collaborators enter only the operational app; menus, routes, server functions and RLS enforce their permissions. Suspended, expired and unassigned users retain a status page, logout and account recovery, without operations.
* Existing sessions lose database/RPC/document access when their club is suspended or expires; no logout/token replacement is needed. Reactivation or subscription extension restores the same authorized sessions. Previously viewed/downloaded documents cannot be retroactively erased from a device; no such deletion is attempted.
* Platform helpers no longer override tenant privacy. Restrictive tenant policies, scoped permissions and SECURITY DEFINER guards protect members, inventory, finances, reports, documents and access records. Cash staff use a minimal receipt lookup (name/number) and cannot enumerate DNI, birth dates or stored document paths.

## Database change awaiting approval

`supabase/migrations/20261106150000_platform_club_separation.sql` is an upgrade transaction, not a reset. It adds nullable `clubs.subscription_expires_at`, replaces access helpers/policies, restricts club writes to guarded server operations, and adds the account-status/minimal-lookup RPCs. Existing `active` is the suspension switch. Nothing is suspended during migration; NULL expiration preserves current subscription availability.

The matching manifest/hash is in `PLATFORM_SEPARATION_RESULTS.json`. Apply this migration only to Snoop-pilot (`bnwanxbmprbymbutoths`), only after explicit approval and a fresh target/state check. Do not reinitialize or re-bootstrap the existing project. Deploy the reviewed application only after the migration succeeds and deployment is separately approved. This prevents running the new client against a schema without the required access RPC.

## Verification actually performed

| Check | Result |
| --- | --- |
| Complete automatic suite | PASS — 131/131 |
| New layered full-schema SQL security tests | PASS — 12/12 |
| Super Admin with historical Admin row: no private records, documents or privileged RPCs | PASS |
| Cross-club admin isolation and collaborator least privilege | PASS |
| Suspend existing sessions; preserve records; unaffected club; reactivate; expire/extend subscription | PASS |
| All 18 public tables retain RLS; 11 tenant fences remain restrictive; anonymous helper execution denied | PASS |
| Selected server platform command rejects ordinary identities before accessing privileged client | PASS |
| TypeScript | PASS |
| Cloudflare-module build with synthetic sandbox configuration | PASS |
| Worker dry-run and client-secret scan | PASS — 58 public artifacts |
| Android/iPhone emulation: platform, admin, limited staff, suspended and expired scenarios | PASS — 56 assertions / 10 scenarios |
| Browser member registration, duplicate guard, renewal cancel/confirm, QR and AI-draft behavior | PASS |
| Physical Android / native Safari / remote post-upgrade flows | NOT RUN — no device/live-upgrade authorization |

SQL tests load the complete approved initialization snapshot, then the exact new upgrade, into local PostgreSQL/PGlite. Auth and Storage schemas are synthetic fixtures; native server-extension installation is excluded. No real member data are used. Historical initialization/owner tests remain baseline compatibility tests; the layered tests establish the new stricter behavior.

Browser tests use the real local application with an intercepted synthetic API and block external requests. They establish UI behavior, not live Supabase HTTP or physical Safari certification.

Commands: `npm test`, `npm run test:security:architecture`, `npm run typecheck`, `npm run build:worker:test`, `npm run worker:dry-run`, `npm run test:security:bundle`, `node scripts/test-owner-navigation.mjs`. The member regression was run with `TEST_BASE_URL=http://127.0.0.1:3000 TEST_SUPABASE_URL=http://127.0.0.1:3000/sandbox-api node scripts/test-member-administration.mjs` against the isolated local dev server.

## Delivery constraints

The database still has the previously approved bootstrap state until this migration is authorized. Do not describe the live app as having the new separation yet. No existing identity is deleted, demoted, duplicated or automatically converted. A separate club-admin identity is indispensable for operational pilot use under this model.

GitHub deployment remains `workflow_dispatch` only with the protected SNOOP target/confirmation. The verification/deploy workflows now include the architecture regression suite. A push is not an instruction to run the deployment workflow. Security PSG resources and configuration are outside scope and were not accessed.

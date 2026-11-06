# SNOOP owner bootstrap verification — 2026-11-06

## Remote state inspected (SELECT only)

Only project `bnwanxbmprbymbutoths` (Snoop-pilot): 18 public tables with RLS enabled; one confirmed signed-in account, no roles, no clubs. The specific owner identity/email and reviewed operation are kept outside Git in a protected local directory. No password, token, account privilege or database row was changed.

## Prepared operation — NOT APPLIED

The reviewed transaction creates one club, `SNOOP Pilot` (`snoop-pilot`), and gives the selected existing confirmed account two roles: platform `super_admin` and club `admin`. Both are required because `current_club_id()` intentionally derives membership from non-platform roles. It preserves all identities, profiles and other records, rejects a different project at preparation, checks the exact UUID/email and confirmed/nonanonymous/nonbanned identity, serializes privilege changes and refuses if ANY role or club already exists. Repeating it does not silently grant a second owner. It is not a public endpoint, migration or signup hook. Application accounts cannot run it.

Implementation: `scripts/lib/pilot-owner-bootstrap.mjs`. Real execution still requires explicit operation-specific approval.

## Corrections prepared locally

* A Super Admin attached to a club can see the existing Socios, Caja and Ajustes navigation and club home. A platform-only Super Admin retains its platform-only navigation.
* Membership receipts initially use the owner's club while preserving explicit club selection.
* Missing original SNOOP artwork has an accessible text fallback; existing asset references/style are retained. The original SNOOP PNG is not in reachable Git history or the checkout, so restoration of the original artwork remains blocked. No replacement art was invented.
* The verification workflow now uses the existing pinned Bun lockfile instead of `npm ci` without a package-lock.json.

## Actually executed

| Check | Result |
| --- | --- |
| Complete automatic suite, including new full-bundle bootstrap tests | PASS 114/114 |
| Bootstrap-specific checks within that suite | PASS 8/8 |
| Confirmed owner + club membership, ordinary account and repeat refusal | PASS |
| Synthetic member creation/search/update, quota receipt/report and staff permission enforcement after bootstrap | PASS |
| Chromium Pixel 7 and iPhone 13 viewport navigation | PASS 24 assertions across 4 scenarios |
| TypeScript, Cloudflare sandbox build, Worker dry-run and client-secret scan | PASS |
| Actual Android handset or Safari/WebKit | NOT RUN; device not available |

The database tests use PostgreSQL/PGlite with the complete application initialization SQL and synthetic Auth/Storage fixtures. Native server-extension installers are excluded, as in the existing initialization regression. The browser test runs against a local server and fully mocked local API; it blocks all external requests. It is a UI regression test, not an authenticated remote production trial.

Commands: `npm test`, `node scripts/test-owner-navigation.mjs` with the local sandbox dev server. The provider tests need local network sockets; executing them in the network sandbox stalled, while the normal authorized local execution passed. No tests use real member records.

## GitHub and deployment evidence

PR #1 and Actions pages were read publicly; branch head at inspection was `906b308`. The latest visible run `42200247286` has successful install, SQL/TypeScript checks, build and deploy steps, followed by a failure in `Upload private server settings`. Its raw step log was unavailable (HTTP 404); GitHub CLI API calls were denied (Forbidden). The exact secret-upload error is therefore not established. No workflow was triggered.

The app origin configured by that workflow is `https://snoop-pilot.dmorra024.workers.dev`. Direct HTTPS verification is blocked by the current environment network policy (CONNECT 403); this is not evidence that the application itself is down. No Cloudflare credential is configured in the current environment. No merge, push or deployment was performed during this preparation.

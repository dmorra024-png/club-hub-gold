# SNOOP — critical stabilization, 8 November 2026

Update: the dues-only Caja scope below is superseded by [CAJA_UNIFIED.md](CAJA_UNIFIED.md). Use its single SQL proposal for the unified report; this document retains the earlier stabilization evidence.

Scope: existing branch `codex/stabilize-independent-club`, integrated through `eb20b3c`. No production SQL, remote writes, secrets, accounts, deployment or merge. The photo/Genetics implementation is unchanged. All fixtures are synthetic.

## Reproducible regressions

| Problem | Identified cause / change | Before → after evidence | Limits |
|---|---|---|---|
| Draft lost on return / apparent reload | `useAuth` set loading on every same-user access refresh; Caja replaced and destroyed its form. Keep verified same-identity refresh mounted, block operations on error; only actual identity/club changes reset scope. Root no longer keys the first session restoration as a new app. | `test-critical-stabilization.mjs`: previous `eb20b3c` fails “Same draft input must stay mounted”. Candidate preserves the same node and `123.45` after focus, online, pageshow, 30-second access check, synthetic token refresh, failure/retry. Actual club change discards the old draft. Zero document reloads during those checks. | Confirmed React remount, not evidence of an actual Android process crash. Physical Samsung suspension, OS termination and hardware token-renewal conditions still need testing. Unsaved cash drafts are not persisted across OS process termination. |
| Delayed unsolicited PWA reload | Update consent left a controllerchange listener alive indefinitely. Scope to the accepted worker and clean it on timeout/unmount/failure. | `test-pwa-update-consent.mjs`: old version reloads on an unrelated controller after 31 seconds; candidate does not. Cancel sends no activation. Accepted matching worker reloads exactly once. Chromium + WebKit. | Worker lifecycle events are simulated here; existing PWA suite separately checks the real local service worker/cache/installability. |
| Keyboard covers navigation / field | Height-only detection and absent scrolling; overlay keyboard leaves layout viewport tall. Track VisualViewport resize/scroll, focus settling and window resize; reserve overlay scroll space; scroll active input without refocusing or changing its value. Hide dock while editing when VisualViewport is unavailable on touch devices. | Old version fails the actual member field visibility assertion. Candidate checks actual Socios, Perfil, Caja, generic supplies stock-correction and collaborator forms, overlay and resize-content geometry, pan, focus/text retention and dock restoration in both engines. | Viewport/keyboard geometry simulated, not a physical iOS/Android keyboard. No existing operational form uses a portalled dialog; shared dialog CSS is defensive, not claimed as an actual modal E2E test. |
| QR email remains queued | Code used a new timestamp key on every request and legacy queue integration did not establish a working dedicated Worker scheduled consumer. New dedicated outbox, lease, stable key, bounded retries, provider ID confirmation and signed delivery events. | PostgreSQL outbox + mocked provider tests cover duplicate requests, one claimant, rejection, uncertain response, stable retry, expired retry, early delivered/bounced events, signature/timestamp tampering and webhook replay. Actual member profile shows pending / accepted-unconfirmed / delivered-confirmed / error / unknown separately in both browsers. | Real deployment/provider configuration and live delivery **not verified**. Never report delivery from queueing or provider acceptance alone. |
| Administrative shift attribution | Existing cash sessions do not implement the requested immutable two-shift dues ledger. Add a separate **membership-fee** report and proposed append-only snapshot table, deriving employee/time from original server receipt fields. | Full existing schema + migrations accept both proposals locally without changing members or existing policy rows. Staff own-only, cross-club, forged operator, direct update, platform identity, suspension and personal-name redaction tests pass. | Not active in production. Existing orders/sales cash paths are unchanged and are **not** certified as shift accounting. This report covers membership fees only. No assigned personnel roster is inferred. |
| Voice phrase in Nombre / missing create form fields | Existing upstream fixes `b4af93f`, `b495b9f`, `eb20b3c` were integrated, retained and verified, rather than duplicated. | Expanded Voice 2.0 browser suite dictates the exact Mario Rossi / 15 marzo 1990 / Palma sentence into real fields; generic non-smokeable “Libreta … Material stock 25” opens and fills the real form. Manual correction survives refresh, zero automatic writes. Existing IT/ES corrections, permission revocation, recording cancellation and failure cases also run. | Simulated recorder and transcription. No physical microphone accuracy or live Cloudflare inference claim. No cannabis-specific stock, pricing or distribution functionality added. |

Before failures: [CRITICAL_BEFORE.json](regressions/CRITICAL_BEFORE.json). Browser outcomes: [CRITICAL_BROWSER_RESULTS.json](CRITICAL_BROWSER_RESULTS.json), [VOICE2_ADMINISTRATIVE_BROWSER_RESULTS.json](VOICE2_ADMINISTRATIVE_BROWSER_RESULTS.json). Screenshots under `docs/screenshots/critical-*` are actual rendered components using synthetic API fixtures.

## Administrative reconciliation (synthetic)

| Owner | Morning 11–17 | Afternoon 17–23 | Outside shift | Day |
|---|---:|---:|---:|---:|
| A | €10.00 | €5.00 | €2.50 | €17.50 |
| B | €25.00 | €0.00 | €0.00 | €25.00 |
| Club | **€35.00** | **€5.00** | **€2.50** | **€42.50** |

IDs are deduplicated; conflicting duplicate receipts fail rather than inflate totals. Madrid timestamp boundaries, summer/winter UTC offsets and local date rollover are tested. Exactly 11:00 starts morning, 17:00 starts afternoon, 23:00 is outside. Outside-shift receipts stay visible and included in the consolidated day; they are not assigned a fictional shift. Historical receipts retain their original timestamp and are labelled as such; no backfill or reassignment occurs. The default report date and active time slot come from the server, not the device clock. Names of members are omitted by SQL when `manage_members` is absent.

## Executed results

| Check | Result |
|---|---|
| Full automatic suite, including local authorization/SQL tests | **207/207 PASS** |
| TypeScript application + tests | **PASS** |
| Production build | **PASS** |
| Critical browser suite (8 component cases + update-consent suite, Chromium/WebKit) | **PASS** |
| Voice 2.0 browser suite (Samsung / iPhone WebKit, simulated audio/transcription) | **PASS** |
| Existing PWA + administrative browser suite | **PASS** |
| Existing Android/WebKit warm/cold session-resume suite | **PASS** |
| Existing completion suite (Android Chromium, iPhone Chromium emulation, iPhone WebKit) | **PASS** |
| Client secret scan | **PASS** |
| Cloudflare sandbox build + local dry-run | **PASS**, gzip bundle 879.12 KiB |
| Live email delivery, production SQL activation, physical phones/microphones | **BLOCKED / not performed** |

## Verification / reproducibility

Use a fresh local production server after building, with no live authenticated browser session:

```sh
npm test
npm run typecheck
npm run build
NITRO_PORT=3063 npm start
# Separate terminal, installed Chromium/WebKit:
TEST_BASE_URL=http://127.0.0.1:3063 npm run test:critical:browser
TEST_BASE_URL=http://127.0.0.1:3063 npm run test:voice2:browser
TEST_BASE_URL=http://127.0.0.1:3063 TEST_WEBKIT=true npm run test:pwa:resume
TEST_BASE_URL=http://127.0.0.1:3063 npm run test:browser
npm run test:security:bundle
```

API calls in these browser scripts are intercepted; external origins are blocked. Database authorization runs in local PGlite PostgreSQL with Supabase auth/storage fixtures. The complete-schema test applies the existing initialization + platform separation + catalog lifecycle + payment-flow migrations **only locally**, then the proposals. Supabase server extensions are unavailable in PGlite; their installers are excluded as in the existing security suite. No remote isolation/RLS claim is made.

Worker packaging is separately checked with `npm run build:worker:test` and `npm run worker:dry-run` (local packaging only). The generated config contains `*/5 * * * *`, the scheduled export, `ASSETS`, and `SNOOP_AI`. No AI inference or paid service is activated by these tests. Do not overwrite the production build while browser tests are running against it.

## Pending authorization / external verification

1. Review the **two proposals**, not automatically discovered migrations: [membership shifts](sql/SNOOP_MEMBERSHIP_SHIFTS_PROPOSED.sql) and [member mail](sql/SNOOP_MEMBER_MAIL_PROPOSED.sql). Neither has been run remotely. They are one-time SQL proposals, additive, with their own transactions. Existing RLS policies, receipts and account records are untouched. A fresh compatibility check on the actual target is required before an approved application. The UI explicitly reports unavailable shift functionality if the SQL has not been activated.
2. Before handing historical members to the new queue, an authorized server-side review must reconcile their old queue/provider status. `snoop_member_mail_legacy_review` intentionally blocks new sends for pre-cutover members until this happens; no legacy request is silently retried or deleted. Never add review rows without checking the old queue. Stable provider idempotency retries are restricted to the first 23 hours and at most five attempts. Unknown/expired outcomes require reconciliation, not a new key. Changed-recipient jobs are rejected before sending.
3. Verify SNOOP-only existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SNOOP_RESOURCE_NAMESPACE`, `EMAIL_API_KEY`, and `EMAIL_FROM` bindings without exposing values. The dedicated sender refuses any Supabase URL other than `https://bnwanxbmprbymbutoths.supabase.co`. Sender must be verified by the existing provider (implementation uses Resend). Live bindings/provider account/free quota were not inspected or changed. No new subscription/payment is authorized or necessary for local testing.
4. Confirm provider support/free availability and configure its signed delivery webhook to `/api/webhooks/member-mail`, with `SNOOP_MAIL_WEBHOOK_SECRET` matching its Svix signing key. This is a future authorized configuration, not a secret created by this work. Without it, accepted email stays “delivery unconfirmed”. The Worker task processes one job every five minutes; it fails closed when dedicated configuration or SQL is missing.
5. Only after SQL/provider checks: separately authorize deployment and a single end-to-end email to an explicitly authorized test address. Physical Samsung/iPhone keyboard, long backgrounding, process termination and microphone checks remain required. No production publication is authorized here.

**Readiness:** code locally verifiable; production acceptance remains blocked by the unapplied SQL, unverified live email delivery, physical device checks and explicit deployment authorization. Do not label the whole project complete based on simulated tests.

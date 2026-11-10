# Home / Caja read consistency

## Verified defects and fix

Base inspected: `bbc57ac`, branch `codex/stabilize-independent-club`.

* Home and report used separate readers. Home did not paginate; report did. Both now use `readCashLedger` and `cashDaySummary`, retaining club and actor filters and the existing completed/cancelled accounting rules.
* A database response `{ data: null, error: null }` was treated as an empty ledger by both original readers. Reproduced on the base: report returned **0**. New readers reject it; the UI displays an error and retry, never a fabricated zero.
* `cashDaySummary([], [], 'invalid', 'invalid')` returned **0** on the base. It now rejects invalid/reversed periods even when there are no rows. Invalid movement timestamps already raised errors before this change.
* Day boundaries previously depended on locale-formatted strings and `longOffset` support. Madrid dates now use numeric `formatToParts`; ledger timestamps require an explicit timezone and are normalized before calculations. Tests cover spring/fall DST boundaries and PostgreSQL timestamp variants. Current Chromium/WebKit both parsed normal ISO correctly before the fix: **no claim that normal ISO parsing caused the physical iPhone issue**.
* Both surfaces refresh on foreground visibility, focus, online, BFCache `pageshow`, record changes and Madrid midnight. Cash HTTP reads request no-store; server report responses are private/no-store. The existing service worker does not cache Supabase/API/server-function responses.
* Permission/identity changes invalidate the displayed scope. Staff totals remain their own activity; staff are not silently promoted to club-wide totals. RLS and authenticated server middleware are unchanged.
* Open sessions retain their complete interval; daily totals filter movement timestamps to the selected Madrid day. Opening float is never income. Existing forms remain mounted during refresh.

## Reproducible verification

`npm test`, `npm run typecheck`, `npm run build`, `npm run test:cash:consistency`.

The same synthetic backend dataset is used by real browser UI and the actual server reader. It contains two operators, another club, completed/cancelled orders, membership receipts and an open overnight session. All unknown external traffic is blocked; unexpected writes fail the test.

| Scenario | Admin | Collaborator |
| --- | ---: | ---: |
| Nov 10 Madrid day, Home and report | €72.00 | €34.00 |
| After a new €1 receipt and refresh | €73.00 | €35.00 |
| Nov 11 after Madrid midnight | €5.00 | €5.00 |
| Overnight session interval, initial dataset | €45.00 | €45.00 |

The session opening float (€50) and cancelled order are not income. Unit tests additionally cover over 1,000 rows, genuine empty-day zero, malformed/null/error responses and immutable source records. Browser tests verify failed reads, retry, actor/club request filters, invalid report bounds, overnight visibility and foreground day rollover in Chromium mobile, WebKit mobile and standalone WebKit simulation. Synthetic permission enforcement is not evidence of live RLS configuration; existing isolated PostgreSQL/security tests are retained.

Screenshots and machine-readable outcomes: `docs/screenshots/cash-consistency-*.png` and `docs/CASH_CONSISTENCY_RESULTS.json`. Existing premium Home, PWA resume and cash-session browser regressions also run in CI. CI uploads these artifacts.

## Limits / release status

No production query/write, RLS change, migration, accounting mutation, secret change, merge or deployment is performed. The affected physical iPhone's actual identity, permissions, installed build and network responses were not inspected. Thus the production symptom's exact trigger remains unconfirmed: the reproducible false-zero and inconsistent-read paths are corrected, but this is not proof of a physical Safari/PWA fix. WebKit and standalone flag simulation are not a physical iPhone installation or microphone/hardware test. A real-device retest after an authorized release remains necessary.

CI initially exposed an unrelated startup race in the isolated PostgreSQL concurrency fixture: Unix-socket readiness selected the entrypoint's temporary server, which shut down during bootstrap. The fixture now waits for TCP on container loopback and bootstraps once on that same endpoint, instead of retrying potentially partially applied SQL. PostgreSQL 17 local isolated concurrency tests passed (seven backends per case, one unique reversal/refund, six lock waiters); no production or accounting application code changed for this fixture fix.

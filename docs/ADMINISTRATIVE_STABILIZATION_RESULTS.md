# Administrative stabilization — 8 November 2026

## Implemented in existing screens

**Productos (administrative catalog):** failed category/product queries previously became empty arrays. Reads now show a safe error and retry instead of a false empty catalog; each request is explicitly club-scoped, paginated with a stable name/id order, and checked for foreign-club responses. Stale asynchronous responses cannot replace the current scope. Existing data, including archived and zero-stock records, is preserved by the read layer. The existing visibility rules remain unchanged. Text and local voice searches now normalize accents consistently without changing stored names.

**Caja / Informe de caja:** one daily summary separates associative membership receipts from other existing recorded income, known cash, counted closing observations and income outside a session. It never reclassifies historical orders as membership contributions. Expected closing balances and discrepancies are shown only when payment methods are known. Closing observations are assigned to their closing day; full overnight-session income remains separate from that day's income. Opening floats and counted money are never income. Closing requires an explicitly entered counted amount, including an explicit zero; notes remain available and bounded to the server's 2,000-character limit.

## Executed checks

| Check | Result | Evidence / limits |
|---|---|---|
| Full automatic suite | PASS, 233/233 | Includes isolated PostgreSQL/PGlite RLS, ownership, payment idempotency and historical-preservation tests; no remote database |
| TypeScript / production build | PASS | Local final application build |
| Public bundle secret scan | PASS | 67 public artifacts |
| Catalog outage / retry | PASS | Rendered Android Chromium, iPhone Chromium emulation and iPhone WebKit; persistent synthetic API outage recovers through the actual retry button |
| Catalog text/category/local voice lookup | PASS | Accented synthetic product name, real rendered controls and simulated voice event; no write during searches |
| Caja opening / closing / staff isolation | PASS | Samsung Chromium and iPhone WebKit viewports; mocked server-function transport |
| Associative cash reconciliation | PASS | Synthetic fee 350 EUR, counted 345 EUR, difference -5 EUR; saved note displayed; blank counted input sends no close request |
| Keyboard / focus / same-identity session refresh | PASS | Chromium Samsung and WebKit iPhone simulations, including preserving form values and hiding dock |
| Administrative Voice 2.0 | PASS | Chromium Samsung and WebKit iPhone; simulated recorder/audio/transcription; not proof of physical microphone accuracy |

Screenshots: `docs/screenshots/caja-reconciliation-samsung.png` and `caja-reconciliation-iphone.png`; browser ledger checks: `docs/CAJA_BROWSER_RESULTS.json`. Broader local browser evidence: `.sandbox/completion-mobile-results.json`.

## Unverified / not implemented

- No production catalog or physical Samsung/iPhone test was performed. The production “No hay productos” in Hacer pedido is not declared fixed.
- Hacer pedido's cannabis ordering/fulfilment, euro/weight conversion, merma, checkout and delivery-stock execution were not modified. These are separate from read-only information and accounting; no conclusion of legality follows from nonprofit status or assembly resolutions. The actual sourcing/distribution arrangements and contributions linked to quantities require qualified Spanish legal assessment. This work does not certify compliance or implement that flow.
- Historical orders without a payment method remain unidentified; no cash classification or backfill is invented. Unknown methods prevent claiming a reconciled physical-cash balance.
- External mail delivery, live AI accuracy and production service configuration were not reverified by these simulated browser checks.

No new SQL migration is needed for these changes. Existing SQL proposals were not applied or repeated. No merge, deployment, production database, account, permission, secret or Security PSG operation.

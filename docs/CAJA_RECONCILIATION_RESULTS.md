# Caja reconciliation — 2026-11-08

Implemented in existing Caja screen only:
- Known cash income, opening float, expected cash, counted cash and discrepancy remain separate.
- Missing/other payment methods make expected cash and discrepancy indeterminate; historical orders are never assumed cash.
- Closing observations belong only to their closing date; overnight overlapping sessions do not duplicate counted cash.
- Expandable session movements show operation, amount, responsible employee and Madrid timestamp.
- Open overnight sessions load their full interval through server time, with daily revenue still filtered by Madrid calendar day.

Verification: 227/227 automatic tests PASS (includes isolated PostgreSQL security/audit tests), TypeScript PASS, production build PASS, client bundle secret scan PASS (67 artifacts). Chromium Samsung viewport and WebKit iPhone viewport PASS with synthetic authentication/API responses; screenshots in docs/screenshots/caja-simple-{samsung,iphone}.png. No physical-device or live-payment verification. Browser regression selects the session by its synthetic movement rather than positional ordering.

No SQL migration required by these read-only reconciliation changes. No remote database, secrets, deployment, merge or Security PSG operations.

Scope limitation: cannabis ordering/fulfilment, euro-to-weight checkout, merma and delivery stock updates were not implemented. Existing order/stock execution remains unchanged. Historical unknown payment methods were not backfilled. This is not completion of the entire requested checkout flow.

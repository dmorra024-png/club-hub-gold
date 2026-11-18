# SNOOP Monedero online — release gate for real money

Status: **development branch only**. The existing production Supabase has
no `socio_*` tables, and the active SNOOP cash ledger currently
aggregates completed orders and membership receipts without a verified
payment method on all historic orders.

## Already implemented / verified in isolated CI

- JWT-scoped, staff-authorized **topup** backend adapter and a proposed
  Postgres RPC in `WALLET_TOPUP_REVIEW_ONLY.sql`. The RPC checks club
  enabled, member active, cash session open and owned by the operator, a
  separate explicit wallet permission, and serializes wallet account and
  operation-ID checks. It rejects modified replays. It returns only the
  committed balance and event ID, and never changes existing orders.
- Pure cash reconciliation contract: topups are **cash collected** but
  wallet-paid orders are internal settlement, not new physical cash.
  It rejects unknown payment methods. The current cash flow cannot safely
  be extended by pretending all `orders.status=completed` are cash.
- Existing account read RLS, claim and scan guards have separate tests.

## Blocking dependencies BEFORE any live activation

1. Review the exact current deployed management code/branch and the
   accounting design, especially the real `loadCash` and `cashMovements`
   paths, and add recorded **payment method** and cash settlement linkage
   for orders while preserving historical audit.
2. Install reviewed `socio_*` SQL migrations only with explicit approval
   and a recovery plan. None has been applied to production.
3. Introduce a real staff UI for topup, role management, explicit
   confirmation and server-derived permissions. The `wallet_topup`
   endpoint is not currently mounted to the public management Worker.
4. Integrate spend with order completion, and refund with cancellation,
   stock reversal, and cash reconciliation in the **same transaction**.
   Wallet ledger alone must not authorize or create a retail order.
5. Obtain a dedicated HTTPS Socio Worker plus approved Auth redirect
   allowlist and verify real email delivery. No real client credentials or
   data have been created.
6. Perform security review, realistic concurrent transaction tests,
   cross-club authorization, manual accounting reconciliation and
   physical Android/iPhone acceptance before enabling nonzero live funds.

Until these gates pass: **keep all real wallets disabled, do not enable
topups or publish an app that suggests its balance is real.**

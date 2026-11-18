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

## Progress — 18 November 2026

The isolated branch now contains an additional **review-only**
`WALLET_ORDER_SETTLEMENT_REVIEW_ONLY.sql` with server-guarded
`socio_wallet_order_spend` and `socio_wallet_order_refund` RPC drafts.
PostgreSQL 16 CI verifies that a previously completed legacy order
cannot be debited without an explicit trusted wallet payment record,
the first authorized debit decreases the balance only once, and
refunds only restore the original debit after a matching completed
cancellation and reversal audit. A second debit/refund is rejected.

`supabase-wallet-operations.mjs` and `staff-wallet-operations-app.mjs`
are isolated JWT-scoped adapters. Staff roles come from an external
verified auth resolver; neither adapter is mounted in the live
management Worker. The member PWA stays read-only.

**Critical integration boundary:** the actual SNOOP order completion,
payment attribution, stock reservation and wallet debit must be
committed by **one authoritative transaction**, not four independent
HTTP calls. The proof-row schema deliberately has NO client-writable
INSERT grant. Existing legacy `completed` orders must never be
backfilled as wallet-paid from guesswork. Until the SNOOP order
write path is integrated and independently verified, the draft spend
RPC must not be enabled for real clubs.

The cash reconciliation helper preserves a *signed* period cash
result; legitimate refunds of prior-shift orders can exceed the cash
collected in the current shift. It does not substitute for the
active application's own accounting views.

**Current deployment:** no live `socio_*` tables, no live wallet
credits, no worker deployment, no management or Codex modification.

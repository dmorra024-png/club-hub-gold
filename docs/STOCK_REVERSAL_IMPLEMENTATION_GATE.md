# SNOOP — stock reversal: implementation gate (9 Nov 2026)

Base: `df8093ac414345442edf2c9a5396a3c18f496380`. This document is a technical handoff, **not an implemented stock reversal**. Do not run production SQL from this note.

## Verified current behavior
- `docs/sql/SNOOP_FINANCIAL_REVERSALS_PROPOSED.sql` handles accounting reversal and separately recorded refunds, with author/admin permissions and an immutable audit; it explicitly has **no stock write**.
- The latest `create_order_with_items` function in `docs/sql/SNOOP_PILOT_INITIALIZE.sql` subtracts `qty + merma` from `products.stock` and emits a negative `stock_movements` row whose `reason` is `sale`, with an order UUID only embedded in unstructured `notes`.
- `order_items` stores quantity but **not merma**. A naïve reversal based on order-item quantity alone cannot reproduce the original stock movement, and crediting `qty + merma` may put physically wasted stock back into inventory.
- No authoritative `order_id` foreign key currently ties a sale stock movement to its order; old movements may be missing or altered. This must be resolved **before** any automatic credit.

## Required safe implementation
1. Introduce a structured immutable link `stock_movements.order_id` (FK to `orders` scoped by club) plus a unique idempotency key for each reversal movement. Ensure the creation RPC writes this link **atomically** with each debit, and save separately the delivered quantity and discarded/waste quantity.
2. For historical orders, perform a **read-only audit** of negative sale movements and reconcile against every `order_items` row, order ID, club ID, product ID, quantity and units. Never guess from product name or assume a movement exists. Fail closed for missing/ambiguous evidence; no automatic backfill of stock.
3. Establish product-return policy: a sale cancellation does not prove items were physically returned. The operator must attest actual returned quantity; validate that it is nonnegative and at most the delivered quantity. Never automatically restore recorded `merma` as usable stock. If a complete return is confirmed, credit only verified returned inventory. If the product cannot be identified in the same club, fail closed.
4. Execute status change, financial reversal, and positive inventory movement in **one database transaction**. Use row locks / unique index to prevent duplicate returns under retries or concurrent requests. Protect financial and inventory audit from client manipulation. Only original collaborator (with relevant permissions) or authorized club admin can perform the operation.
5. Keep physical payment refunds separate from the accounting adjustment; do not double-subtract from cash or count a return as a new sale.
6. Surface returned quantity and reversal reference in member history, activity detail and inventory history, preserving the current premium UI and all existing functionality.
7. Extend local PostgreSQL and browser tests: one product, multiple products, duplicated product lines, with merma, partial/zero physical return, deleted product, missing legacy movement, concurrent retries, wrong club, unauthorized actor, rollback of any failed write, no doubled stock / cash, reporting across days.
8. Submit migration in proposed/non-applied form; do **not** merge, deploy, mutate live data or backfill without explicit authorization.

## Status
This branch records the verified blocker and a safe route to completion. Financial annulment implementation remains in the existing PR #1. The automatic physical stock return and cancellation of other arbitrary activity types are **not yet implemented**.

# Administrative confirmations and member history

## Activation dependency — not applied

`docs/sql/SNOOP_ADMINISTRATIVE_RECORDS_PROPOSED.sql` is a **single proposed transaction**, tested only in isolated PostgreSQL/PGlite. It has not been run on Snoop-pilot or any remote database. Apply only after explicit approval and compatibility checks, before publishing this code.

It requires the existing platform and `save_membership_with_receipt` / `membership_operations` migration. It does not repeat them. Preflight rejects missing dependencies, an existing installation, conflicting cancellation columns or unknown order UPDATE triggers. No backfill, accounting amount rewrite, inventory movement, refund, account change or RLS policy change occurs during installation.

The new `confirm_membership_with_receipt` wrapper locks/verifies the authoritative membership fee and reuses the existing atomic/idempotent registration/renewal. Paid registrations and renewals need this function. Selected free plans also use the expected-amount check so a changed fee cannot become an unconfirmed charge. Registration without a plan retains its existing path.

The migration adds nullable cancellation actor/time/reason fields and an admin-only `annul_financial_order` RPC. It stamps the database actor/time, preserves original amounts, timestamps and employee, serializes concurrent cancellation requests and recognizes identical replays. Cancelled rows and their line items cannot be rewritten, deleted or appended to. Financial history deletion is blocked, including a member deletion that would cascade into orders. This is intentional history preservation and must be reviewed before approval. Historical cancellations remain without fabricated audit metadata.

## Implemented in existing screens

- **Membership registration and renewal:** premium confirmation dialog with total, cash received and exact-cent change; insufficient or invalid cash cannot confirm. Card/transfer/other methods have no fictional cash change. Cancel keeps the form without saving. Receiving 100 EUR against a 75 EUR fee records 75 EUR, not 100 EUR; change is transient UI information.
- Busy guards and the existing request identifier protect double clicks and uncertain-response retries. The response must identify the expected member before success is shown. Fee changes are rejected server-side. Renewal parameters remain locked while an unresolved request is pending.
- **Existing member page:** compact, lazily loaded `Historial de pedidos`; date/time in Europe/Madrid, internal reference, original amount, status and responsible employee; paginated history and requested detail without a new page/menu. Completed and cancelled registrations remain separate.
- History server functions use the normal authenticated client. They require member-management plus financial-reading permission, verify operational club, scope member/order/items explicitly and restrict staff without reports permission to their own records. Administrators can request a reasoned accounting annulment after the migration is available. No actor, club, timestamp or amount supplied by the browser is used for the cancellation audit.
- **Draft abandonment:** existing back action now offers discard/continue when a draft has unsaved content. Discard navigates away without creating an order. The member-parent route's hooks remain stable when entering/leaving the nested draft.
- **Mobile:** keyboard geometry now rechecks portalled dialogs after their layout shrinks, preserving the actual field/focus and keeping the dock hidden. Both payment and cancellation fields have specific browser regressions.

## Scope limits

The economic confirmation is for **associative membership fees**, not an extension of the existing order checkout. Existing order creation, quantity/weight calculations and stock delivery logic are unchanged. Annulment is an administrative correction of the recorded financial status: it **does not return cash, reverse inventory or certify a legal distribution model**. Original order amounts/items remain stored. Existing Caja/report readers already exclude `cancelled` orders, so a cancelled record is not counted again as a completed receipt; recorded cash counts are not rewritten.

History can read pre-migration rows, but new annulment controls require the new audit schema/RPC. New economic confirmations require the proposed RPC before this version is deployed. No live functionality on a physical Samsung/iPhone is claimed for this unpublished version.

## Executed verification

- **248/248 automatic tests PASS**, including actual PostgreSQL/PGlite roles/RLS and proposed-migration execution on synthetic clubs/users.
- Expected fee vs cash received, exact decimal change, invalid/insufficient cash, changed-price rejection (including free-to-paid change), single receipt on replay and no partial member insertion on price mismatch.
- Admin authorization, foreign-club refusal, direct-patch audit enforcement, actual actor/time despite forged values, immutable cancelled header/items, identical cancellation replay and preserved original financial totals/data.
- Product stock and inventory-movement count remain unchanged after annulment in SQL integration tests. Migration preflight rejection and repeat-install refusal are tested without remote operations.
- History server permission checks, own-record filtering, strict cancellation arguments and narrow output DTO: no unrelated member/club identifiers or private notes returned.
- Rendered **Samsung Chromium / iPhone WebKit** administrative cases: modal cancel, insufficient cash, change, failed-request retention, same-key retry/double click, history/detail/status/reason, no-finance hiding, staff cannot annul, draft continue/discard with zero order writes, and keyboard visibility/value preservation in both dialogs. APIs/audio are simulated; SQL semantics are tested separately.
- Existing administrative, catalog, account-link, PWA resume, premium-home, Caja, keyboard, update-consent, Voice 2.0 and informational-image browser suites PASS. The premium-home fixture now finishes the old document's requests before changing its synthetic club; all isolation assertions remain active.
- TypeScript, production build, Cloudflare worker build, local Wrangler dry-run and public bundle secret scan PASS (71 public artifacts).

Evidence: `docs/ADMINISTRATIVE_RECORDS_BROWSER_RESULTS.json`, `scripts/test-administrative-records.mjs`, `tests/administrative-records.test.mjs`, `tests/member-order-history.test.mjs`. Rendered screenshots: `docs/screenshots/administrative-records-samsung.png` and `administrative-records-iphone-webkit.png`.

No merge, deployment, remote SQL, production data/account/secret changes or Security PSG operation. No new paid service or dependency.

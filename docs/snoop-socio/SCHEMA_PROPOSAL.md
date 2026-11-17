# Schema proposal: NOT applied

`apps/socio/schema/REVIEW_ONLY.sql` is deliberately not a Supabase migration file and is not referenced by any deployment workflow. It documents minimum tables and tenant-scoped SELECT policies for a distinct Socio product.

It has **NOT** been executed. Before adoption, Codex must compare it with the actual SNOOP schema, PostgreSQL function/version constraints, staff RLS, existing wallet/cash accounting, and the legally acceptable wallet usage. Run local staging, schema advisors and cross-club adversarial tests. Do not use a privileged service_role key for the member app's normal reads. No member PII is copied to the card projection.

Required before real operation:
- Secure issuance of member-to-account ownership proof (current `members.email` is NOT independently verified).
- Atomic link challenge issue/claim/revoke procedures. Never auto-link on email equality alone.
- Management-side sync of minimal `socio_member_cards` after membership creation, renewal, suspension and club name changes, without broadening member table RLS.
- Wallet ledger/accounting integrated with existing cash/order/refund flows; transactionally unique IDs and no negative balances; no double-counting.
- Separate scanner endpoint, real staff auth, same-club permission, member active checks and QR anti-replay policy.
- Production Auth configuration with confirmed emails, approved redirect allowlist, rate limits, dedicated credentials and no connection to existing admin roles.
- Independent staging worker deployment; physical Android/iPhone tests only after real backend becomes available.

Keep the draft separate until Codex reviews JARVIS and authorizes integration.
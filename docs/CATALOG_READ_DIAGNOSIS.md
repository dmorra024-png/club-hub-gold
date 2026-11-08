# Catalog read failure — 8 November 2026

## Verified cause and evidence

The existing screen selected `products(..., product_categories(name,unit_type))` without qualifying a relationship. Its response handler ignored `error` and mapped `data ?? []` to the display. Thus a database/query failure became the misleading “No hay productos. Crea alguno…” state.

A read-only SELECT of **schema metadata only**, on Snoop-pilot `bnwanxbmprbymbutoths`, confirmed both foreign keys:

- `products_category_id_fkey`: `category_id -> product_categories.id`.
- `products_category_same_club`: `(category_id, club_id) -> product_categories(id, club_id)`.

These are distinct PostgREST relationships: an unqualified embed is ambiguous (`PGRST201`). The inspection also confirmed the requested columns exist, RLS is enabled on both tables, and their SELECT, restrictive club and permission policies are present. Sanitized evidence is in `CATALOG_SCHEMA_VERIFICATION.json`.

No product/member rows were read through elevated credentials. The actual authenticated HTTP response from the Samsung was not captured; the schema ambiguity and swallowed-error path were verified independently. Production row visibility for that user's session is therefore not claimed as tested.

## Implemented correction

- Two independent, paginated, stable-order SELECTs of the **same existing tables**, each explicitly filtered by the verified club; no inferred relationship, duplicate catalog or database migration.
- Minimal existing display fields only; no purchase cost or personal data added to the catalog query.
- Category matching uses the returned club-scoped category IDs. Missing/inaccessible category data and unexpected foreign-club responses fail closed.
- Active/category-archive visibility matches the administrative catalog. Zero stock stays visible; it is not used to declare the catalog empty. Active empty categories remain navigable.
- Distinct loading, read error (safe diagnostic code + retry), permission denial, no RLS-visible rows, inactive/archived-only rows, and no filter matches. The interface does not claim the database is empty when RLS returns no visible rows.
- Text/category filters use accent-insensitive matching. Loading retries and stale responses cannot replace a different user/club scope.

Source comparison verified that the complete existing function block from `const total` through the order confirmation handler is unchanged, including cart, calculations, payment/order RPC and stock-related logic. No order or distribution functionality was added or tested as part of the read-only browser cases.

## Tests executed

- **237/237** automatic tests PASS, including four new read-only catalog tests.
- Local PostgreSQL/PGlite: both FK relationships, two synthetic clubs, authorized own-club reads, foreign-club isolation and refusal for staff without catalog-reading permission PASS.
- TypeScript, production build and public bundle secret scan PASS (67 artifacts).
- **16/16** rendered catalog scenarios PASS: Samsung Chromium and iPhone WebKit, each covering loaded/zero-stock rows, query error + actual retry button, empty visibility, all-inactive rows, forbidden read, missing category, foreign-scope response and denied permission. Every scenario asserts zero database/RPC writes. Only synthetic API responses and local PostgreSQL fixtures were used; no fake products were inserted into the actual catalog.
- Existing PWA resume/freeze, transient access error/retry, draft preservation, cold-route recovery and permission-fence browser regression PASS on Android Chromium and iPhone WebKit.

Browser results: `CATALOG_READ_BROWSER_RESULTS.json`. Rendered catalog screenshots: `screenshots/catalog-read-only-samsung.png` and `screenshots/catalog-read-only-iphone-webkit.png` (synthetic fixtures, not production data).

## Not performed

No production data/account/stock/RLS edits, seed inserts, migrations, merge, deployment or Security PSG operations. The corrected build has not been published or physically tested on a Samsung/iPhone. Confirming the real authenticated display requires running the corrected version under the real user's normal session; no privileged fallback was introduced.

Authorized pilot release of SNOOP double-location inventory UI. All existing inventory movement triggers and transfer RPC are reused; additive creation RPC installed. Stock total and Caja are unchanged. No JARVIS/Socio changes.

Fix v2: native accessible Almacén radio and selectable warehouse/dispenser inventory views. CI passed.

Stock UX v3: product-specific inventory balances with explicit units; no mixed global stock totals. CI green.

Stock UX v4: remove standalone warehouse view; inline Almacén beneath Stock in product rows and provide bidirectional transfer in pencil editor. CI green.

Valuation v1: cost price × inventory for each product; show total EUR and by warehouse/dispensary, with warnings for zero cost. Isolated verification passed.

Informes pilot: dated opening-of-day inventory at current purchase prices; inbound/outbound stock movement valuation; historic purchases disclosed as current price estimates; no Stock valuation panel. CI green.

Product economics pilot: selectable as-of date, per-product dated stock recharge entries, recorded completed-order revenue, remaining value, expected gross margin, aggregated club totals. CI green and secured read RPC installed.

Informes simplified v5: remove product-profitability panel; on existing inventory valuation show purchase cost of remaining goods and net-of-product-cost projected gain, per-item breakdown, explicit overhead exclusion. RPC smoke tested and isolated CI green.

Primary Informes KPI is active products' current stock valued at their configured sale price. Reference purchase cost and gross margin secondary. Verified build/security.

Net stock movement summary: canceled stock movement pairs (Gelatto and Orange Juice) yield 0 EUR day variation, no misleading gross +/-23.50 boxes. Build and security tests passed.

Pilot member endorsement release: optional/mandatory avalador name and surname per club in Ajustes Socios, saved atomically and displayed on member detail. SQL and CI verified, no changes to SNOOP Socio or JARVIS.

Avalador v2 pilot: register by first/last name OR verified existing member number, server scoped to same club, linked member stored. CI success, SQL smoke test rolled back.

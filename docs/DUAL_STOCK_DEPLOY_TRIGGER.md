Authorized pilot release of SNOOP double-location inventory UI. All existing inventory movement triggers and transfer RPC are reused; additive creation RPC installed. Stock total and Caja are unchanged. No JARVIS/Socio changes.

Fix v2: native accessible Almacén radio and selectable warehouse/dispenser inventory views. CI passed.

Stock UX v3: product-specific inventory balances with explicit units; no mixed global stock totals. CI green.

Stock UX v4: remove standalone warehouse view; inline Almacén beneath Stock in product rows and provide bidirectional transfer in pencil editor. CI green.

Valuation v1: cost price × inventory for each product; show total EUR and by warehouse/dispensary, with warnings for zero cost. Isolated verification passed.

Informes pilot: dated opening-of-day inventory at current purchase prices; inbound/outbound stock movement valuation; historic purchases disclosed as current price estimates; no Stock valuation panel. CI green.

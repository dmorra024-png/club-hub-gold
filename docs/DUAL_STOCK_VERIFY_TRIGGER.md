Build and security verify the location-aware SNOOP inventory branch; do not deploy or migrate yet.

Fix declaration order and rerun.

Accessibility regression: native radio selection for initial placement and clickable Almacén / Dispensario inventory filters.

Fix inventory number labels: select product first, display its g/u in Almacén, Dispensario, Total, never sum unlike units.

Product-row stock UX: warehouse shown directly below dispensary stock, transfers under edit pencil; removed top-level location dashboard; decimal input validation repaired.

Valuation v1: calculate per-item quantity times purchase price, summarize euros by location, warn on missing cost.

Informes day-opening inventory valuation: moving from Stock to Informes, 00:00 Madrid historical inventory quantity, entrances, exits and closing cost from canonical ledger.

New reports: product-level recharge timestamps, cumulative actual recorded completed-order line revenue as of selected day, remaining projected revenue, expected gross margin; whole-club totals. No claims of accounting net profit.

Inventory UX simplification: remove separate Rentabilidad por producto report; embed purchase cost and net-of-product-cost projected profit within existing inventory valuation card, with per-item breakdown. SQL RPC test verified.

Valuation correction: sale-price stock value is the principal headline; configured buy price is hypothetical reference cost, never money paid, net or realized profit. No product prices or stock changed.

Final UI layout: principal figure at top is value of active stocked merchandise at sale price; historical day movement report and notional cost/margin remain secondary.

Correction: cancelled sale stock movements net to zero; replace + and - gross quantities with one net inventory value change, explicitly not Caja revenue.

Member endorsement: new socio form asks avalador first/last names; per-club required/optional setting, atomic registration RPC and detail display. SQL transaction smoke test rolled back successfully.

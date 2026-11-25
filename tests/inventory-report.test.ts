import { test } from "node:test";
import assert from "node:assert/strict";
import { InventoryCostReportData } from "../src/lib/inventory-report.ts";
const valid = {
  day: "2026-11-25",
  start_at: "2026-11-24T23:00:00+00:00",
  end_at: "2026-11-25T12:00:00+00:00",
  cost_basis: "current_purchase_price",
  opening_eur: 123.45,
  incoming_eur: 10.25,
  outgoing_eur: 5.05,
  closing_eur: 128.65,
  opening_sale_eur: 246.9,
  incoming_sale_eur: 20.5,
  outgoing_sale_eur: 10.1,
  closing_sale_eur: 257.3,
  closing_expected_profit_eur: 128.65,
  missing_sale_price: 0,
  missing_cost: 0,
  invalid_quantities: 0,
  lines: [],
};
test("original inventory response retains exact supplied values and rejects malformed responses rather than manufacturing a zero report", () => {
  assert.deepEqual(InventoryCostReportData.parse(valid), valid);
  for (const bad of [
    [],
    null,
    {},
    "unavailable",
    { ...valid, lines: null },
    { ...valid, lines: [{}] },
    { ...valid, closing_eur: null },
    { ...valid, day: "2026-02-30" },
    { ...valid, closing_eur: NaN },
  ])
    assert.equal(InventoryCostReportData.safeParse(bad).success, false);
});

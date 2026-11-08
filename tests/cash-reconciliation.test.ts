import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileCash,
  countedCashOnDay,
  dayRevenue,
  type CashSession,
  type CashMovement,
} from "../src/lib/cash-sessions.ts";
const session: CashSession = {
  id: "s",
  user_id: "a",
  opened_at: "2026-11-07T22:00:00Z",
  closed_at: "2026-11-08T02:00:00Z",
  opening_cash_cents: 5000,
  closing_cash_cents: 39500,
  status: "closed",
};
const movement = (
  id: string,
  cents: number,
  method: string | null,
  at = "2026-11-08T00:30:00Z",
): CashMovement => ({
  id,
  source: "fee",
  at,
  by: "a",
  cents,
  session_id: "s",
  payment_method: method,
});
test("reconciliation separates float, cash, card, counted and difference", () => {
  const entries = [movement("1", 35000, "cash"), movement("2", 20000, "card")];
  assert.deepEqual(reconcileCash(session, entries), {
    cash: 35000,
    expected: 40000,
    difference: -500,
  });
  assert.equal(dayRevenue(entries, "2026-11-07T23:00:00Z", "2026-11-08T23:00:00Z"), 55000);
});
test("unknown and other methods prevent invented cash balances", () => {
  for (const method of [null, "other", "invalid"])
    assert.deepEqual(
      reconcileCash(session, [movement("1", 35000, "cash"), movement("2", 100, method)]),
      { cash: 35000, expected: null, difference: null },
    );
});
test("other employees and sessions do not enter a private reconciliation", () => {
  const other = { ...movement("2", 99999, "cash"), by: "b" };
  const outside = { ...movement("3", 99999, "cash"), session_id: null };
  assert.deepEqual(reconcileCash(session, [movement("1", 35000, "cash"), other, outside]), {
    cash: 35000,
    expected: 40000,
    difference: -500,
  });
});
test("overnight day totals follow movement dates while session retains full interval", () => {
  const entries = [
    movement("1", 1000, "cash", "2026-11-07T22:30:00Z"),
    movement("2", 2000, "cash"),
  ];
  assert.equal(dayRevenue(entries, "2026-11-07T23:00:00Z", "2026-11-08T23:00:00Z"), 2000);
  assert.equal(reconcileCash(session, entries).expected, 8000);
  assert.equal(
    reconcileCash({ ...session, status: "open", closed_at: null }, entries).difference,
    null,
  );
});

test("counted money belongs only to closing day, never duplicated on overnight overlap", () => {
  assert.equal(countedCashOnDay([session], "2026-11-06T23:00:00Z", "2026-11-07T23:00:00Z"), 0);
  assert.equal(countedCashOnDay([session], "2026-11-07T23:00:00Z", "2026-11-08T23:00:00Z"), 39500);
});

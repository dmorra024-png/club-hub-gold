import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileCash,
  cashDaySummary,
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

test("daily summary separates associative receipts, existing operations, outside-session cash and closing observations", () => {
  const cash = movement("fee", 35000, "cash"),
    card = movement("card", 20000, "card");
  const outside = { ...movement("outside", 700, "cash"), session_id: null };
  const result = cashDaySummary(
    [cash, card, outside, cash],
    [session, session],
    "2026-11-07T23:00:00Z",
    "2026-11-08T23:00:00Z",
  );
  assert.deepEqual(result, {
    orderCents: 0,
    feeCents: 55700,
    totalCents: 55700,
    cashCents: 35700,
    unidentifiedCents: 0,
    outsideSessionCents: 700,
    countedCents: 39500,
    expectedAtClosures: 40000,
    differenceAtClosures: -500,
    closedSessions: 1,
  });
});
test("daily reconciliation never reclassifies historical operations as associative cash or hides incomplete balances", () => {
  const order = { ...movement("same-id", 1000, null), source: "order" as const };
  const fee = movement("same-id", 2000, "cash");
  const result = cashDaySummary(
    [order, fee],
    [session],
    "2026-11-07T23:00:00Z",
    "2026-11-08T23:00:00Z",
  );
  assert.equal(result.totalCents, 3000);
  assert.equal(result.orderCents, 1000);
  assert.equal(result.feeCents, 2000);
  assert.equal(result.unidentifiedCents, 1000);
  assert.equal(result.expectedAtClosures, null);
  assert.equal(result.differenceAtClosures, null);
});
test("closing-day reconciliation includes full overnight interval but daily receipts only selected-day movements", () => {
  const entries = [
    movement("previous-day", 1000, "cash", "2026-11-07T22:30:00Z"),
    movement("today", 2000, "cash"),
  ];
  const result = cashDaySummary(entries, [session], "2026-11-07T23:00:00Z", "2026-11-08T23:00:00Z");
  assert.equal(result.totalCents, 2000);
  assert.equal(result.expectedAtClosures, 8000);
  assert.equal(result.differenceAtClosures, 31500);
  assert.throws(
    () =>
      cashDaySummary(
        [entries[0], { ...entries[0], cents: 999 }],
        [session],
        "2026-11-07T23:00:00Z",
        "2026-11-08T23:00:00Z",
      ),
    /duplicada incoherente/,
  );
});

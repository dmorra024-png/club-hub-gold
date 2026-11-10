import test from "node:test";
import assert from "node:assert/strict";
import { cashDataset, cashBackend, actor, club, day } from "../scripts/lib/cash-totals-fixture.mjs";
import { readCashLedger, cashInstant } from "../src/lib/cash-ledger.ts";
import { loadCash } from "../src/lib/cash-sessions.server.ts";
import { cashMovements, cashDaySummary, sessionRevenue } from "../src/lib/cash-sessions.ts";
import { clubDayRange } from "../src/lib/cash-summary.ts";
import { madridToday } from "../src/lib/member-administration.ts";
import { madridMidnight } from "../src/lib/membership-receipts.ts";
test("same reader/calculator produces identical Home and report totals without broadening staff scope", async () => {
  for (const admin of [true, false]) {
    const records = cashDataset(),
      before = structuredClone(records),
      client = cashBackend(records, { admin }),
      scope = { userId: actor, clubId: club };
    const { start, end } = clubDayRange(day);
    const home = await readCashLedger(client, { ...scope, admin }, start, end);
    const report = await loadCash(client, scope, day, () => new Date("2026-11-10T18:00:00Z"));
    const summary = cashDaySummary(cashMovements(home.orders, home.fees, []), [], start, end);
    assert.equal(summary.totalCents, admin ? 7200 : 3400);
    assert.equal(
      cashDaySummary(report.movements, report.sessions, report.start, report.end).totalCents,
      summary.totalCents,
    );
    assert.equal(
      sessionRevenue(report.sessions[0], report.movements),
      4500,
      "open session keeps its full interval, daily totals exclude yesterday",
    );
    const cacheHeaders = client.calls.filter((c) => c.header === "Cache-Control");
    assert.ok(cacheHeaders.length >= 4);
    assert.ok(cacheHeaders.every((c) => c.value === "no-cache, no-store"));
    assert.equal(client.writes, 0);
    assert.deepEqual(records, before);
  }
});
test("null/error transport and invalid or missing-zone timestamps never become a successful zero", async () => {
  for (const failure of ["null", "error"]) {
    const client = cashBackend(cashDataset(), { broken: () => failure });
    await assert.rejects(
      readCashLedger(
        client,
        { clubId: club, userId: actor, admin: false },
        ...Object.values(clubDayRange(day)),
      ),
      /cargar/,
    );
    await assert.rejects(loadCash(client, { clubId: club, userId: actor }, day), /cargar/);
  }
  assert.throws(() => cashDaySummary([], [], "bad", "bad"), /Fecha/);
  assert.throws(
    () => cashDaySummary([], [], "2026-11-11T00:00:00Z", "2026-11-10T00:00:00Z"),
    /Periodo/,
  );
  for (const raw of ["not-a-date", "2026-11-10T12:00:00", "2026-02-30T12:00:00Z"])
    assert.throws(() => cashInstant(raw), /Fecha/);
  assert.equal(
    cashInstant("2026-11-10 12:00:00.123456+00"),
    cashInstant("2026-11-10T12:00:00.123Z"),
  );
});
test("Madrid day strings and DST boundaries do not parse locale-formatted offsets or depend on handset timezone", () => {
  const Native = Intl.DateTimeFormat;
  Intl.DateTimeFormat = class extends Native {
    constructor(locale, options) {
      if (options?.timeZoneName === "longOffset")
        throw new RangeError("Older Safari offset format");
      super(locale, options);
    }
    format() {
      return "10/11/2026";
    }
  };
  try {
    assert.equal(madridToday(new Date("2026-11-09T23:30:00Z")), "2026-11-10");
    assert.equal(madridMidnight("2026-03-29"), "2026-03-28T23:00:00.000Z");
    assert.equal(madridMidnight("2026-03-30"), "2026-03-29T22:00:00.000Z");
    assert.equal(madridMidnight("2026-10-25"), "2026-10-24T22:00:00.000Z");
    assert.equal(madridMidnight("2026-10-26"), "2026-10-25T23:00:00.000Z");
  } finally {
    Intl.DateTimeFormat = Native;
  }
});
test("Home and report paginate the same ledger beyond the API row limit; a genuinely empty day is zero", async () => {
  const records = cashDataset();
  records.orders = Array.from({ length: 1005 }, (_, n) => ({
    id: `order-${String(n).padStart(5, "0")}`,
    club_id: club,
    created_by: actor,
    created_at: "2026-11-10T12:00:00Z",
    total_cents: 1,
    status: "completed",
    cash_session_id: null,
  }));
  records.membership_receipts = [];
  records.cash_sessions = [];
  const client = cashBackend(records),
    { start, end } = clubDayRange(day);
  const ledger = await readCashLedger(
    client,
    { clubId: club, userId: actor, admin: true },
    start,
    end,
  );
  const report = await loadCash(client, { clubId: club, userId: actor }, day);
  assert.equal(ledger.orders.length, 1005);
  assert.equal(
    cashDaySummary(cashMovements(ledger.orders, ledger.fees, []), [], start, end).totalCents,
    1005,
  );
  assert.equal(cashDaySummary(report.movements, [], start, end).totalCents, 1005);
  assert.equal(cashDaySummary([], [], start, end).totalCents, 0);
  assert.equal(client.writes, 0);
});

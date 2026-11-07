import test from "node:test";
import assert from "node:assert/strict";
import { membershipTimeline } from "../src/lib/membership-timeline.ts";
const start = "2026-11-07T00:00:00Z",
  end = "2026-11-08T00:00:00Z",
  now = Date.parse(end) - 1;
const rows = [
  { id: "a", recorded_at: "2026-11-07T09:00:00Z", amount_cents: 1000 },
  { id: "b", recorded_at: "2026-11-07T12:00:00Z", amount_cents: 1500 },
  { id: "c", recorded_at: "2026-11-07T15:00:00Z", amount_cents: 2500 },
];
test("membership graph uses actual receipt times and cumulative cents, deduplicating ledger IDs", () => {
  const points = membershipTimeline([rows[2], ...rows], start, end, now);
  assert.deepEqual(
    points.map((p) => p.cents),
    [0, 1000, 2500, 5000],
  );
  assert.equal(points[0].at, Date.parse(start));
  assert.equal(points[3].at, Date.parse(rows[2].recorded_at));
});
test("no illustrative graph is returned for missing, conflicting, invalid or insufficient ledger observations", () => {
  for (const input of [
    [],
    rows.slice(0, 2),
    [...rows, { ...rows[0], amount_cents: 7 }],
    [...rows, { id: "d", amount_cents: 30 }],
    rows.map((r) => ({ ...r, amount_cents: 0 })),
    [...rows, { ...rows[0], id: "d", recorded_at: end }],
  ])
    assert.deepEqual(membershipTimeline(input, start, end, now), []);
  assert.deepEqual(membershipTimeline(rows, start, end, Date.parse(rows[0].recorded_at)), []);
});

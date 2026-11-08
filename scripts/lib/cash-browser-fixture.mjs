import { cashMovements } from "../../src/lib/cash-sessions.ts";
import { clubDayRange } from "../../src/lib/cash-summary.ts";
import { madridToday } from "../../src/lib/member-administration.ts";
export function cashBrowserFixture({
  day = madridToday(),
  userId,
  admin = true,
  orders = [],
  fees = [],
  sessions = [],
  profiles = [],
}) {
  const { start, end } = clubDayRange(day);
  const selectedOrders = orders
    .filter((o) => admin || o.created_by === userId)
    .map((o, n) => ({
      status: "completed",
      created_at: `${day}T12:00:00Z`,
      created_by: userId,
      id: `order-${n}`,
      ...o,
    }));
  const selectedFees = fees
    .filter((r) => admin || r.recorded_by === userId)
    .map((r, n) => ({
      recorded_at: `${day}T12:00:00Z`,
      recorded_by: userId,
      id: `fee-${n}`,
      ...r,
    }));
  const selectedSessions = sessions.filter((s) => admin || s.user_id === userId);
  return {
    day,
    start,
    end,
    userId,
    admin,
    profiles,
    sessions: selectedSessions,
    movements: cashMovements(selectedOrders, selectedFees, selectedSessions),
  };
}

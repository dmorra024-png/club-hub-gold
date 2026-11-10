import { cashInstant } from "../../src/lib/cash-ledger.ts";
export const actor = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002",
  club = "10000000-0000-4000-8000-000000000001";
export const day = "2026-11-10";
export function cashDataset() {
  const order = (id, created_by, created_at, total_cents, status = "completed") => ({
    id,
    club_id: club,
    created_by,
    created_at,
    total_cents,
    status,
    cash_session_id: "session-a",
  });
  const fee = (id, recorded_by, recorded_at, amount_cents) => ({
    id,
    club_id: club,
    recorded_by,
    recorded_at,
    amount_cents,
    payment_method: "cash",
  });
  return {
    cash_sessions: [
      {
        id: "session-a",
        club_id: club,
        user_id: actor,
        status: "open",
        opened_at: "2026-11-09T21:00:00Z",
        closed_at: null,
        opening_cash_cents: 5000,
        closing_cash_cents: null,
      },
    ],
    orders: [
      order("prior", actor, "2026-11-09T22:30:00Z", 1100),
      order("today", actor, "2026-11-09T23:30:00Z", 2500),
      order("other", other, "2026-11-10T10:00:00Z", 3000),
      order("cancelled", actor, "2026-11-10T10:30:00Z", 99999, "cancelled"),
      { ...order("foreign", actor, "2026-11-10T10:30:00Z", 99999), club_id: "foreign-club" },
    ],
    membership_receipts: [
      fee("fee-a", actor, "2026-11-10T08:00:00Z", 700),
      fee("fee-b", other, "2026-11-10T11:00:00Z", 800),
      fee("fee-c", actor, "2026-11-10T13:00:00Z", 200),
      fee("tomorrow", actor, "2026-11-10T23:02:00Z", 500),
    ],
    profiles: [
      { id: actor, full_name: "Persona sintética A" },
      { id: other, full_name: "Persona sintética B" },
    ],
    financial_order_reversals: [],
    financial_order_refunds: [],
  };
}
export function cashBackend(
  records,
  { admin = false, userId = actor, clubId = club, broken = () => null } = {},
) {
  let writes = 0;
  const calls = [];
  const client = {
    calls,
    get writes() {
      return writes;
    },
    rpc: async (name, args) => {
      calls.push({ rpc: name, args });
      if (name === "is_current_user_club_admin")
        return { data: args._club_id === clubId && admin, error: null };
      throw new Error("Unexpected RPC");
    },
    from(table) {
      const filters = [];
      let offset = 0,
        end = Infinity;
      const query = {
        setHeader(header, value) {
          calls.push({ table, header, value });
          return query;
        },
        select() {
          return query;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return query;
        },
        in(k, values) {
          filters.push((r) => values.includes(r[k]));
          return query;
        },
        gte(k, v) {
          filters.push((r) => cashInstant(r[k]) >= cashInstant(v));
          return query;
        },
        lt(k, v) {
          filters.push((r) => cashInstant(r[k]) < cashInstant(v));
          return query;
        },
        or(value) {
          const start = value.split("closed_at.gte.")[1];
          filters.push(
            (r) => r.closed_at === null || cashInstant(r.closed_at) >= cashInstant(start),
          );
          return query;
        },
        order() {
          return query;
        },
        range(a, b) {
          offset = a;
          end = b + 1;
          return query;
        },
        insert() {
          writes++;
          throw new Error("Unexpected write");
        },
        update() {
          writes++;
          throw new Error("Unexpected write");
        },
        delete() {
          writes++;
          throw new Error("Unexpected write");
        },
        then(resolve, reject) {
          calls.push({ table, offset });
          let data = (records[table] ?? []).filter(
            (r) => !("club_id" in r) || r.club_id === clubId,
          );
          if (!admin) {
            const key =
              table === "orders"
                ? "created_by"
                : table === "membership_receipts"
                  ? "recorded_by"
                  : table === "cash_sessions"
                    ? "user_id"
                    : null;
            if (key) data = data.filter((r) => r[key] === userId);
          }
          data = data
            .filter((r) => filters.every((f) => f(r)))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(offset, end);
          const failure = broken(table);
          return Promise.resolve(
            failure === "null"
              ? { data: null, error: null }
              : failure === "error"
                ? { data: null, error: { message: "Synthetic failure" } }
                : { data: structuredClone(data), error: null },
          ).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return client;
}

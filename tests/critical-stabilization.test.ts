import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptShift, reconcileAdministrativeShifts } from "../src/lib/administrative-shifts.ts";
import { memberMailLabel } from "../src/lib/member-mail-state.ts";
import { verifyMailEvent, processMemberMail } from "../src/lib/member-mail-worker.server.ts";
import { createHmac } from "node:crypto";
test("Madrid shifts use immutable timestamps, exact boundaries, DST and outside-shift exceptions", () => {
  for (const [at, shift] of [
    ["2026-01-10T09:59:59Z", null],
    ["2026-01-10T10:00:00Z", 1],
    ["2026-01-10T16:00:00Z", 2],
    ["2026-01-10T22:00:00Z", null],
    ["2026-07-10T09:00:00Z", 1],
    ["2026-07-10T15:00:00Z", 2],
    ["2026-07-10T21:00:00Z", null],
  ] as const)
    assert.equal(receiptShift(at).shift, shift, at);
  assert.equal(receiptShift("2026-07-10T23:30:00Z").day, "2026-07-11");
  assert.throws(() => receiptShift("2026-01-10T10:00:00"));
});
test("two employees in one shift reconcile exactly, duplicates cannot inflate the day, outside-shift money remains visible", () => {
  const base = { recorded_by: "a", recorded_at: "2026-01-10T10:00:00Z", amount_cents: 1000 };
  const rows = [
    { ...base, id: "1" },
    { ...base, id: "2", recorded_by: "b", amount_cents: 2500 },
    { ...base, id: "3", recorded_at: "2026-01-10T16:00:00Z", amount_cents: 500 },
    { ...base, id: "4", recorded_at: "2026-01-10T22:00:00Z", amount_cents: 250 },
    { ...base, id: "1" },
  ];
  assert.deepEqual(reconcileAdministrativeShifts(rows, "2026-01-10"), {
    totals: { morning: 3500, afternoon: 500, outside: 250, day: 4250 },
    operators: { a: 1750, b: 2500 },
  });
  assert.throws(
    () =>
      reconcileAdministrativeShifts([...rows, { ...base, id: "1", amount_cents: 5 }], "2026-01-10"),
    /distintos/,
  );
});
test("mail labels never equate pending, accepted and confirmed delivery", () => {
  assert.match(memberMailLabel("pending"), /Pendiente/);
  assert.match(memberMailLabel("accepted"), /no confirmada/);
  assert.match(memberMailLabel("delivered"), /confirmado/);
});
test("mail processing requires provider ID and stores an uncertain outcome when confirmation is missing", async () => {
  const calls: any[] = [];
  const job = { id: "synthetic", lease: "claim", idempotency_key: "stable" };
  const client = {
    rpc: async (name: string, args?: any) => {
      calls.push({ name, args });
      return name === "snoop_claim_member_mail" ? { data: [job] } : { data: true };
    },
  };
  await processMemberMail(client, async () => ({ message_id: "" }));
  assert.equal(calls[1].args.p_status, "unknown");
  assert.equal(calls[1].args.p_provider, null);
  calls.length = 0;
  await processMemberMail(client, async () => ({ message_id: "provider-1" }));
  assert.equal(calls[1].args.p_status, "accepted");
  assert.equal(calls[1].args.p_provider, "provider-1");
});
test("delivery is accepted only with a valid signed provider event and bounded timestamp", () => {
  const secret = "whsec_" + Buffer.alloc(32, 42).toString("base64"),
    at = 1794120000000,
    ts = String(at / 1000),
    body = JSON.stringify({ type: "email.delivered", data: { email_id: "provider-1" } }),
    id = "event-1";
  const signature = createHmac("sha256", Buffer.alloc(32, 42))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  const headers = new Headers({
    "svix-id": id,
    "svix-timestamp": ts,
    "svix-signature": "v1," + signature,
  });
  assert.deepEqual(verifyMailEvent(body, headers, secret, at), {
    id,
    provider: "provider-1",
    type: "email.delivered",
  });
  assert.throws(() => verifyMailEvent(body + " ", headers, secret, at));
  assert.throws(() => verifyMailEvent(body, headers, secret, at + 600000));
});

test("mail processing stores provider rejection as error and fails closed if confirmation cannot be persisted", async () => {
  const { EmailAPIError } = await import("../src/lib/email-provider.server.ts");
  const results: any[] = [];
  const client = {
    rpc: async (name: string, args?: any) => {
      if (name === "snoop_claim_member_mail") return { data: [{ id: "job", lease: "lease" }] };
      results.push(args);
      return { data: true };
    },
  };
  await processMemberMail(client, async () => {
    throw new EmailAPIError(429, null);
  });
  assert.equal(results[0].p_status, "error");
  assert.equal(results[0].p_error, "provider_http_429");
  await assert.rejects(
    processMemberMail(
      {
        rpc: async (name: string) =>
          name === "snoop_claim_member_mail"
            ? { data: [{ id: "job", lease: "lease" }] }
            : { error: { message: "db unavailable" } },
      },
      async () => ({ message_id: "confirmed" }),
    ),
    /not persisted/,
  );
});

import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { deliverPreparedInvitation } from "../src/lib/invitation-delivery.server.ts";
const names = ["EMAIL_API_KEY", "EMAIL_FROM", "EMAIL_API_URL"];
const old = new Map(names.map((k) => [k, process.env[k]]));
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
  for (const [k, v] of old) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
const link = "https://snoop.example.test/reset-password#token_hash=synthetic-token&type=invite";
function configured() {
  Object.assign(process.env, {
    EMAIL_API_KEY: "synthetic-test-key",
    EMAIL_FROM: "SNOOP <noreply@example.test>",
    EMAIL_API_URL: "https://mail.example.test/emails",
  });
}
test("missing email configuration preserves manual fallback without sending", async () => {
  delete process.env.EMAIL_API_KEY;
  globalThis.fetch = async () => {
    throw Error("must not send");
  };
  assert.deepEqual(await deliverPreparedInvitation("person@example.test", link), {
    emailAccepted: false,
    deliveryIssue: "email_provider_not_configured",
  });
});
test("provider acceptance requires success status AND provider message ID", async () => {
  configured();
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(init?.body as string);
    assert.equal(body.text.includes(link), true);
    assert.deepEqual(body.to, ["person@example.test"]);
    return Response.json({ id: "synthetic-receipt" });
  };
  const r = await deliverPreparedInvitation("PERSON@example.test", link);
  assert.equal(r.emailAccepted, true);
  assert.equal(r.messageId, "synthetic-receipt");
  assert.equal(calls, 1);
});
test("quota, malformed receipt and network errors never claim email sent or retry", async () => {
  configured();
  for (const result of [
    () => new Response("quota", { status: 429 }),
    () => Response.json({}),
    () => {
      throw Error("private provider details");
    },
  ]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return result();
    };
    const r = await deliverPreparedInvitation("person@example.test", link);
    assert.equal(r.emailAccepted, false);
    assert.equal(r.deliveryIssue, "email_provider_not_accepted");
    assert.equal(calls, 1);
  }
});
test("idempotency is stable per link but a regenerated link gets its own delivery", async () => {
  configured();
  const keys: string[] = [];
  globalThis.fetch = async (_input, init) => {
    keys.push((init?.headers as any)["Idempotency-Key"]);
    return Response.json({ id: "synthetic" });
  };
  await deliverPreparedInvitation("person@example.test", link);
  await deliverPreparedInvitation("person@example.test", link);
  await deliverPreparedInvitation("person@example.test", link + "2");
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
  assert.equal(
    keys.some((k) => k.includes("synthetic-token")),
    false,
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationPorts, voiceOwner } from "../src/lib/voice/application-ports.ts";
import { sealVoiceSnapshot, openVoiceSnapshot } from "../src/lib/voice/checkpoint.server.ts";
import { ActionReceipt, actionOutcome } from "../src/lib/voice/action-protocol.ts";
import { VoiceUsageLease } from "../src/lib/voice/usage.server.ts";
test("application ports isolate club/user and stale component disposal", async () => {
  const a = voiceOwner("synthetic-user", "club-a"),
    b = voiceOwner("synthetic-user", "club-b");
  const old = applicationPorts.register(a, "form", { snapshot: () => ({ name: "old" }) });
  const fresh = applicationPorts.register(a, "form", { snapshot: () => ({ name: "new" }) });
  old();
  assert.equal(applicationPorts.get(b, "form"), undefined);
  assert.equal((await applicationPorts.wait(a, "form", () => true)).snapshot?.().name, "new");
  fresh();
  await assert.rejects(
    applicationPorts.wait(a, "form", () => false),
    /SNOOP_FORM_UNAVAILABLE/,
  );
});
test("ephemeral checkpoints reject other accounts, clubs, tampering and expiration", async () => {
  const now = Date.now(),
    v = {
      owner: "u",
      club: "c",
      expires: now + 60000,
      turn: 2,
      history: [{ role: "user" as const, content: "synthetic phrase" }],
    };
  const token = await sealVoiceSnapshot(v, "synthetic-secret");
  assert(!token.includes("synthetic phrase"));
  assert.deepEqual(await openVoiceSnapshot(token, "synthetic-secret", "u", "c", now), v);
  for (const args of [
    [token, "synthetic-secret", "other", "c", now],
    [token, "synthetic-secret", "u", "other", now],
    [token, "wrong", "u", "c", now],
    [token, "synthetic-secret", "u", "c", now + 60001],
    [token.slice(0, -4) + "AAAA", "synthetic-secret", "u", "c", now],
  ] as const)
    await assert.rejects(
      openVoiceSnapshot(args[0], args[1], args[2], args[3], args[4]),
      /VOICE_RESUME_INVALID/,
    );
});
test("action receipts accept bounded metadata only and drafts are not persisted", () => {
  assert.equal(
    actionOutcome({ type: "AppActionResult", id: "one", status: "prepared" }).persisted,
    false,
  );
  assert.equal(
    ActionReceipt.safeParse({
      type: "AppActionResult",
      id: "one",
      status: "prepared",
      member: { name: "private" },
    }).success,
    false,
  );
});
test("usage lease pins project, validates server lease, closes exactly once", async () => {
  let now = 100000;
  const calls: any[] = [];
  const lease = new VoiceUsageLease({
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "sb_secret_synthetic",
    actor: "u",
    club: "c",
    now: () => now,
    fetch: (async (url, init) => {
      assert.equal(url, "https://bnwanxbmprbymbutoths.supabase.co/rest/v1/rpc/snoop_voice_usage");
      assert.equal((init!.headers as any).Authorization, undefined);
      const p = JSON.parse(init!.body as string);
      calls.push(p);
      return Response.json({
        session: p.p_id,
        sequence: p.p_sequence,
        state: p.p_operation === "close" ? "closed" : "active",
        leaseUntil: new Date(now + 30000).toISOString(),
        reservedSeconds: 30,
        remainingSeconds: 60,
        monthlySeconds: 90,
        connectedMs: p.p_connected_ms,
        estimatedMicrousd: null,
        billedCostVerified: false,
      });
    }) as typeof fetch,
  });
  await lease.start();
  lease.markConnected();
  assert(lease.valid());
  now += 1234;
  await lease.close();
  await lease.close();
  assert(!lease.valid());
  assert.equal(calls.length, 2);
  assert.equal(calls[1].p_connected_ms, 1234);
  await assert.rejects(
    new VoiceUsageLease({ url: "https://wrong.invalid", key: "x", actor: "u", club: "c" }).start(),
    /VOICE_USAGE_CONFIG_REQUIRED/,
  );
});

test("receipt metadata cannot carry arbitrary personal text as field keys", () => {
  assert.equal(
    ActionReceipt.safeParse({
      type: "AppActionResult",
      id: "a",
      status: "prepared",
      applied: ["Synthetic private name"],
    }).success,
    false,
  );
});

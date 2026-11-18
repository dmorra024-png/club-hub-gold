import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceCashPeriod, VoiceCashPeriod } from "../src/lib/voice/cash-read.server.ts";
import { voiceGeneticsInformation } from "../src/lib/voice/genetics-read.server.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";
import { voiceGeneticsSource } from "../src/lib/voice/source-links.ts";
const access: AccountAccess = {
  role: "admin",
  clubId: "synthetic-club",
  clubName: null,
  clubLogo: null,
  status: "active",
  permissions: ["use_cash", "view_reports"],
};
test("period receipts reuse ledger, exclude cancelled orders, deduplicate and honor Madrid DST and own scope", async () => {
  for (const admin of [true, false]) {
    const queries: URL[] = [];
    const result = await voiceCashPeriod(
      "https://bnwanxbmprbymbutoths.supabase.co",
      "synthetic-key",
      "synthetic-jwt",
      "synthetic-user",
      access,
      { from: "2026-10-24", to: "2026-10-25" },
      async (input, init) => {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-jwt");
        assert.equal(init?.redirect, "manual");
        const u = new URL(String(input));
        queries.push(u);
        const table = u.pathname.split("/").at(-1);
        if (table === "is_current_user_club_admin") return Response.json(admin);
        assert.equal(init?.method ?? "GET", "GET");
        assert.equal(u.searchParams.get("club_id"), "eq.synthetic-club");
        const order = {
          id: "one",
          total_cents: 1250,
          created_by: "synthetic-user",
          created_at: "2026-10-25T22:00:00Z",
          status: "completed",
          cash_session_id: null,
        };
        if (table === "orders")
          return Response.json([
            order,
            order,
            { ...order, id: "cancelled", status: "cancelled", total_cents: 9000 },
          ]);
        assert.equal(table, "membership_receipts");
        return Response.json([
          {
            id: "fee",
            amount_cents: 500,
            recorded_by: "synthetic-user",
            recorded_at: "2026-10-24T23:00:00Z",
            payment_method: "cash",
          },
        ]);
      },
    );
    assert.equal(result.cents, 1750);
    assert.equal(result.orderCents, 1250);
    assert.equal(result.feeCents, 500);
    assert.equal(result.scope, admin ? "club" : "own");
    assert.equal(result.persisted, false);
    const orders = queries.find((u) => u.pathname.endsWith("/orders"))!;
    assert.deepEqual(orders.searchParams.getAll("created_at"), [
      "gte.2026-10-23T22:00:00.000Z",
      "lt.2026-10-25T23:00:00.000Z",
    ]);
    if (!admin) assert.equal(orders.searchParams.get("created_by"), "eq.synthetic-user");
    assert(!JSON.stringify(result).includes("synthetic-user"));
  }
});
test("period validation and permission failures perform no financial reads", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return Response.json([]);
  };
  for (const args of [
    { from: "2026-11-02", to: "2026-11-01" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2024-01-01", to: "2026-11-01" },
    { from: "2026-01-01", to: "2026-01-02", actor: "other" },
  ]) {
    assert.equal(VoiceCashPeriod.safeParse(args).success, false);
    await assert.rejects(
      voiceCashPeriod(
        "https://bnwanxbmprbymbutoths.supabase.co",
        "key",
        "token",
        "u",
        access,
        args,
        request,
      ),
    );
  }
  await assert.rejects(
    voiceCashPeriod(
      "https://bnwanxbmprbymbutoths.supabase.co",
      "key",
      "token",
      "u",
      { ...access, permissions: [] },
      { from: "2026-01-01", to: "2026-01-02" },
      request,
    ),
  );
  assert.equal(calls, 0);
});
test("genetics tool returns only documented facts and attributed excerpts using existing source checks", async () => {
  const requested: URL[] = [];
  const result = await voiceGeneticsInformation({ name: "Amnesia Haze" }, async (input, init) => {
    const u = new URL(String(input));
    requested.push(u);
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    if (u.hostname === "www.wikidata.org")
      return Response.json({
        search: [{ id: "Q123", label: "Amnesia Haze", description: "cannabis strain" }],
      });
    if (u.hostname === "commons.wikimedia.org") return Response.json({});
    if (u.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /");
    if (u.hostname === "www.leafly.com")
      return new Response(
        '<title>Amnesia Haze</title><meta name="description" content="Descripción botánica sintética para comprobar la atribución exacta de una fuente.">',
      );
    return new Response("");
  });
  assert(result.verified);
  assert(result.sources.includes("https://www.wikidata.org/wiki/Q123"));
  assert.equal(result.excerpts[0].source, "https://www.leafly.com/strains/amnesia-haze");
  assert.equal(result.persisted, false);
  assert(!JSON.stringify(result).includes("images"));
  assert(requested.length <= 40);
});
test("genetics source failures and blocked redirects do not invent facts or follow destinations", async () => {
  const requested: URL[] = [];
  const result = await voiceGeneticsInformation({ name: "White Widow" }, async (input) => {
    requested.push(new URL(String(input)));
    return new Response(null, { status: 302, headers: { location: "https://untrusted.invalid" } });
  });
  assert.equal(result.verified, false);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.excerpts, []);
  assert(requested.every((u) => u.hostname !== "untrusted.invalid"));
  let calls = 0;
  await assert.rejects(
    voiceGeneticsInformation({ name: "person@example.test" }, async () => {
      calls++;
      return Response.json({});
    }),
  );
  assert.equal(calls, 0);
});
test("citation links reject commerce, credentials, tracking and unrelated Strainpedia pages", () => {
  for (const source of [
    "javascript:alert(1)",
    "https://user:pass@www.leafly.com/strains/amnesia-haze",
    "https://www.leafly.com/shop/amnesia-haze",
    "https://www.leafly.com/strains/amnesia-haze?track=1",
    "https://www.strainpedia.com/shop/",
    "https://www.wikileaf.com/strain/white-widow/",
  ])
    assert.equal(voiceGeneticsSource(source, "Amnesia Haze"), null);
  assert(voiceGeneticsSource("https://www.strainpedia.com/amnesia-haze/", "Amnesia Haze"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceCatalogQuery, voiceCatalogSearch } from "../src/lib/voice/catalog-read.server.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";
const access: AccountAccess = {
  role: "admin",
  clubId: "synthetic-club",
  clubName: null,
  clubLogo: null,
  status: "active",
  permissions: ["manage_products"],
};
const base = "https://bnwanxbmprbymbutoths.supabase.co";
test("on-demand catalog is user scoped, name-only, active and bounded independently of initial snapshot", async () => {
  for (const kind of ["products", "categories"] as const) {
    let calls = 0;
    const result = await voiceCatalogSearch(
      base,
      "synthetic-key",
      "synthetic-user-jwt",
      access,
      { kind, query: "CBD 10%" },
      async (input, init) => {
        calls++;
        const url = new URL(String(input));
        assert.equal(url.origin, base);
        assert.equal(url.searchParams.get("club_id"), "eq.synthetic-club");
        assert.equal(url.searchParams.get("select"), "name");
        assert.equal(url.searchParams.get("limit"), "7");
        assert.equal(url.searchParams.get("name"), "ilike.%CBD 10\\%%");
        assert.equal(
          url.searchParams.get("or"),
          kind === "products"
            ? "(active.eq.true,active.is.null)"
            : "(archived.eq.false,archived.is.null)",
        );
        assert.equal(init?.method, "GET");
        assert.equal(init?.redirect, "manual");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-user-jwt");
        return Response.json(
          Array.from({ length: 7 }, (_, i) => ({ name: "CBD 10% " + i, private: "never-forward" })),
        );
      },
    );
    assert.equal(calls, 1);
    assert.equal(result.matches.length, 6);
    assert(result.truncated);
    assert.equal(result.persisted, false);
    assert(!JSON.stringify(result).includes("never-forward"));
    assert(!JSON.stringify(result).includes("synthetic-user-jwt"));
  }
});
test("catalog permissions, scope and arguments fail before network access", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json([]);
  };
  for (const changed of [
    { ...access, clubId: null },
    { ...access, status: "suspended" as const },
    { ...access, permissions: [] },
  ])
    await assert.rejects(
      voiceCatalogSearch(
        base,
        "key",
        "token",
        changed,
        { kind: "products", query: "Gelato" },
        fetcher,
      ),
    );
  await assert.rejects(
    voiceCatalogSearch(
      "https://other.invalid",
      "key",
      "token",
      access,
      { kind: "products", query: "Gelato" },
      fetcher,
    ),
  );
  for (const args of [
    { kind: "members", query: "Name" },
    { kind: "products", query: "Gelato", clubId: "other" },
    { kind: "products", query: "*" },
    { kind: "categories", query: "x\nunsafe" },
  ]) {
    assert.equal(VoiceCatalogQuery.safeParse(args).success, false);
    await assert.rejects(voiceCatalogSearch(base, "key", "token", access, args, fetcher));
  }
  assert.equal(calls, 0);
});
test("catalog errors and redirects cannot masquerade as an empty catalog or forward credentials", async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { location: "https://untrusted.invalid" } }),
    Response.json({ error: "no" }, { status: 500 }),
    Response.json({ name: "bad shape" }),
    Response.json([{ id: 1 }]),
  ]) {
    let calls = 0;
    await assert.rejects(
      voiceCatalogSearch(
        base,
        "key",
        "token",
        access,
        { kind: "products", query: "Gelato" },
        async () => {
          calls++;
          return response;
        },
      ),
    );
    assert.equal(calls, 1);
  }
  const empty = await voiceCatalogSearch(
    base,
    "key",
    "token",
    access,
    { kind: "products", query: "Absent" },
    async () => Response.json([]),
  );
  assert.deepEqual(empty.matches, []);
  assert.equal(empty.truncated, false);
});

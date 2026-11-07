import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { cashAmounts, clubDayRange } from "../src/lib/cash-summary.ts";
import {
  rememberRoute,
  resumeRoute,
  forgetRoute,
  safeResumePath,
} from "../src/lib/resume-route.ts";
import { EMPTY_ACCESS } from "../src/lib/access-context.ts";
import {
  specialistDescription,
  specialistImages,
  robotsAllow,
  searchSpecialistCatalog,
} from "../src/lib/specialist-catalog.server.ts";
test("cash totals deduplicate within ledgers but never double-book membership as an order", () => {
  assert.deepEqual(
    cashAmounts(
      [
        { id: "a", total_cents: 700 },
        { id: "a", total_cents: 700 },
      ],
      [{ id: "a", amount_cents: 300 }],
    ),
    { orderCents: 700, feeCents: 300, totalCents: 1000 },
  );
  assert.throws(() =>
    cashAmounts(
      [
        { id: "a", total_cents: 10 },
        { id: "a", total_cents: 20 },
      ],
      [],
    ),
  );
  assert.throws(() => cashAmounts([], [{ amount_cents: Number.NaN }]));
});
test("Madrid club days cover DST boundaries independent of handset timezone", () => {
  assert.deepEqual(clubDayRange("2026-10-25"), {
    start: "2026-10-24T22:00:00.000Z",
    end: "2026-10-25T23:00:00.000Z",
  });
  assert.deepEqual(clubDayRange("2026-03-29"), {
    start: "2026-03-28T23:00:00.000Z",
    end: "2026-03-29T22:00:00.000Z",
  });
});
test("resume metadata is scoped to verified identity, club and current permission", () => {
  const data = new Map<string, string>();
  const old = (globalThis as any).localStorage;
  (globalThis as any).localStorage = {
    setItem: (k: string, v: string) => data.set(k, v),
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => data.delete(k),
  };
  try {
    const access = {
      ...EMPTY_ACCESS,
      role: "admin" as const,
      status: "active" as const,
      clubId: "club-a",
      permissions: ["manage_products" as const],
    };
    rememberRoute("user-a", "club-a", "/productos");
    assert.equal(resumeRoute("user-a", access), "/productos");
    assert.equal(resumeRoute("user-b", access), "/");
    assert.equal(resumeRoute("user-a", { ...access, clubId: "club-b" }), "/");
    assert.equal(resumeRoute("user-a", { ...access, permissions: [] }), "/");
    for (const path of [
      "https://other.example.test",
      "//other.example.test",
      "/reset-password#token_hash=x",
      "/productos?private=x",
      "/auth",
    ])
      assert.equal(safeResumePath(path), false);
    forgetRoute();
    assert.equal(resumeRoute("user-a", access), "/");
  } finally {
    (globalThis as any).localStorage = old;
  }
});
const html =
  '<title>Blue Dream — synthetic specialist fixture</title><meta name="description" content="Synthetic public catalog excerpt describing the named variety. Additional details require source verification.">';
test("specialist alternatives are short attributable exact-name excerpts, never invented", () => {
  const candidate = specialistDescription(
    html,
    "https://www.leafly.com/strains/blue-dream",
    "Blue Dream",
  );
  assert.ok(candidate);
  assert.match(candidate!.excerpt, /Synthetic public/);
  assert.ok(candidate!.excerpt.length <= 180);
  assert.equal(
    specialistDescription(html, "https://www.leafly.com/strains/blue-dream", "Other Strain"),
    null,
  );
  assert.equal(
    specialistDescription(html, "https://evil.example.test/blue-dream", "Blue Dream"),
    null,
  );
  assert.equal(robotsAllow("User-agent: *\nDisallow: /strains/", "/strains/blue-dream"), false);
});
test("specialist photos require explicit image-specific commercial-use license and attribution", () => {
  const image = {
    "@type": "ImageObject",
    name: "Blue Dream synthetic image",
    contentUrl: "https://images.leafly.com/blue-dream.jpg",
    license: "https://creativecommons.org/licenses/by/4.0/",
    creator: { name: "Synthetic Rights Holder" },
  };
  const markup = (value: unknown) =>
    '<script type="application/ld+json">' + JSON.stringify(value) + "</script>";
  assert.equal(
    specialistImages(markup(image), "https://www.leafly.com/strains/blue-dream", "Blue Dream")
      .length,
    1,
  );
  assert.equal(
    specialistImages(
      markup({ ...image, license: null }),
      "https://www.leafly.com/strains/blue-dream",
      "Blue Dream",
    ).length,
    0,
  );
  assert.equal(
    specialistImages(
      markup({ ...image, contentUrl: "http://127.0.0.1/private" }),
      "https://www.leafly.com/strains/blue-dream",
      "Blue Dream",
    ).length,
    0,
  );
  assert.equal(
    specialistImages(
      '<meta property="og:image" content="https://images.leafly.com/blue-dream.jpg">',
      "https://www.leafly.com/strains/blue-dream",
      "Blue Dream",
    ).length,
    0,
  );
});
test("specialist lookup respects robots and fixed origins; failures return manual fallback", async () => {
  const touched: string[] = [];
  const result = await searchSpecialistCatalog("Blue Dream", (async (url: URL) => {
    touched.push(url.href);
    if (url.hostname === "html.duckduckgo.com") return new Response("", { status: 503 });
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /");
    throw Error("must not fetch restricted page");
  }) as typeof fetch);
  assert.equal(result.descriptions.length, 0);
  assert.equal(result.images.length, 0);
  assert.ok(
    touched.every(
      (url) =>
        new URL(url).pathname === "/robots.txt" || new URL(url).hostname === "html.duckduckgo.com",
    ),
  );
});

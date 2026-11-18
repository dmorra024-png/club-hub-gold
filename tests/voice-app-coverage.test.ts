import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceDestinations } from "../src/lib/voice/destinations.ts";
import { ConversationProposal, conversationAllowed } from "../src/lib/snoop-conversation.ts";
import { authorizeProposal, proposalSchema } from "../src/lib/voice/agent-settings.server.ts";
import { vocabularyMatch } from "../src/lib/voice/catalog-vocabulary.ts";
import { applicationPorts, voiceOwner } from "../src/lib/voice/application-ports.ts";
import { applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import { VoiceCashDay, voiceCashDay } from "../src/lib/voice/cash-read.server.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";
const admin: AccountAccess = {
  role: "admin",
  clubId: "synthetic-club",
  clubName: "Synthetic",
  clubLogo: null,
  status: "active",
  permissions: ["manage_members", "manage_products", "use_cash", "view_reports"],
};
const proposal = (target: keyof typeof voiceDestinations) => ({
  intent: "navigate" as const,
  target,
  member: {},
  product: {},
  query: null,
  declined: [],
  question: "",
  asking: null,
});
test("provider schema and application share one real navigation registry, no save actions", async () => {
  assert.deepEqual(proposalSchema.properties.target.enum, [
    ...Object.keys(voiceDestinations),
    null,
  ]);
  for (const [target, path] of Object.entries(voiceDestinations)) {
    const p = ConversationProposal.parse(proposal(target as keyof typeof voiceDestinations));
    assert(conversationAllowed(admin, p), target);
    if (!["products", "product_create", "categories", "stock", "cash_report"].includes(target)) {
      let current = "/synthetic";
      await applyDeepgramDraft(p, {
        access: admin,
        path: () => current,
        current: () => true,
        last: {},
        navigate: (p) => {
          current = p;
        },
      });
      assert.equal(current, path);
    }
  }
});
test("admin destinations reject collaborators and suspended or cross-scope sessions", () => {
  for (const target of [
    "settings",
    "collaborators",
    "membership_settings",
    "membership_fees",
    "devices",
  ] as const) {
    assert.equal(conversationAllowed({ ...admin, role: "collaborator" }, proposal(target)), false);
    assert.equal(authorizeProposal(proposal(target), { ...admin, status: "suspended" }).ok, false);
    assert.equal(authorizeProposal(proposal(target), { ...admin, clubId: null }).ok, false);
  }
});
test("catalog tolerates one unique transcription error but not ambiguous or unknown categories", () => {
  assert.equal(vocabularyMatch("Extraccionés", ["Extracciones"]), "Extracciones");
  assert.equal(vocabularyMatch("Extracionez", ["Extracciones"]), null);
  assert.equal(vocabularyMatch("Flores", ["Flores", "Floras"]), "Flores");
  assert.equal(vocabularyMatch("Flores", ["Floras", "Florez"]), null);
  assert.equal(vocabularyMatch("Flora", ["Flores"]), null);
  const catalog = { categories: ["Extracciones"], products: ["Amnesia Haze"] };
  const result = authorizeProposal(
    {
      ...proposal("product_create"),
      intent: "product",
      product: { name: "Synthetic", category: "Extraccione" },
    },
    admin,
    catalog,
  );
  assert(result.ok);
  assert.equal(result.proposal.product.category, "Extracciones");
  const found = authorizeProposal(
    { ...proposal("products"), intent: "search", query: "Amnesia Hase" },
    admin,
    catalog,
  );
  assert(found.ok);
  assert.equal(found.proposal.query, "Amnesia Haze");
});
test("dated cash request opens existing report with same day and no financial writes", async () => {
  const owner = voiceOwner("synthetic", admin.clubId!);
  let opened: unknown;
  const remove = applicationPorts.register(owner, "cash.page", {
    open: (target, day) => {
      opened = { target, day };
    },
  });
  try {
    await applyDeepgramDraft(proposal("cash_report"), {
      access: admin,
      owner,
      path: () => "/caja",
      current: () => true,
      last: {},
      navigate: () => {},
      reportDay: "2026-10-25",
    });
    assert.deepEqual(opened, { target: "report", day: "2026-10-25" });
    await assert.rejects(
      applyDeepgramDraft(proposal("cash_report"), {
        access: admin,
        owner,
        path: () => "/caja",
        current: () => true,
        last: {},
        navigate: () => {},
        reportDay: "2026-02-30",
      }),
    );
  } finally {
    remove();
  }
});
test("dated cash rejects invalid dates and extra actor/club arguments before IO", async () => {
  for (const day of ["2026-02-30", "25/10/2026", "2026-13-01", ""])
    assert.equal(VoiceCashDay.safeParse({ day }).success, false);
  assert.equal(VoiceCashDay.safeParse({ day: "2026-10-25", actor: "other" }).success, false);
  let calls = 0;
  await assert.rejects(
    voiceCashDay(
      "https://bnwanxbmprbymbutoths.supabase.co",
      "synthetic",
      "synthetic",
      "u",
      "c",
      "2026-02-30",
      async () => {
        calls++;
        return Response.json([]);
      },
    ),
  );
  assert.equal(calls, 0);
});
test("missing route capability cannot report a successful search", async () => {
  const owner = voiceOwner("synthetic", admin.clubId!);
  const remove = applicationPorts.register(owner, "members.search", {});
  try {
    await assert.rejects(
      applyDeepgramDraft(
        { ...proposal("members"), intent: "search", query: "Synthetic" },
        {
          access: admin,
          owner,
          path: () => "/soci/gestisci",
          current: () => true,
          last: {},
          navigate: () => {},
        },
      ),
      /SNOOP_FORM_UNAVAILABLE/,
    );
  } finally {
    remove();
  }
});
test("dated cash preserves Madrid DST windows, collaborator scope, and aggregate privacy", async () => {
  for (const isAdmin of [true, false]) {
    const requests: URL[] = [];
    const summary = await voiceCashDay(
      "https://bnwanxbmprbymbutoths.supabase.co",
      "synthetic",
      "synthetic-jwt",
      "synthetic-user",
      "synthetic-club",
      "2026-10-25",
      async (input, init) => {
        const url = new URL(String(input));
        requests.push(url);
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-jwt");
        const table = url.pathname.split("/").at(-1);
        if (table === "is_current_user_club_admin") return Response.json(isAdmin);
        assert.equal(init?.method ?? "GET", "GET");
        if (table !== "profiles")
          assert.equal(url.searchParams.get("club_id"), "eq.synthetic-club");
        if (table === "membership_receipts")
          return Response.json([
            {
              id: "synthetic-fee",
              amount_cents: 1200,
              recorded_at: "2026-10-25T22:30:00Z",
              recorded_by: "synthetic-user",
              payment_method: "cash",
            },
          ]);
        return Response.json([]);
      },
    );
    assert.equal(summary.day, "2026-10-25");
    assert.equal(summary.cents, 1200);
    assert.equal(summary.scope, isAdmin ? "club" : "own");
    assert.equal(JSON.stringify(summary).includes("synthetic-user"), false);
    const orders = requests.find((u) => u.pathname.endsWith("/orders"))!;
    const filters = orders.searchParams.getAll("created_at");
    assert(filters.includes("gte.2026-10-24T22:00:00.000Z"));
    assert(filters.includes("lt.2026-10-25T23:00:00.000Z"));
    if (!isAdmin) assert.equal(orders.searchParams.get("created_by"), "eq.synthetic-user");
  }
});
test("cash voice reader rejects redirects without forwarding the user JWT", async () => {
  const requests: string[] = [];
  await assert.rejects(
    voiceCashDay(
      "https://bnwanxbmprbymbutoths.supabase.co",
      "synthetic",
      "synthetic-jwt",
      "u",
      "c",
      "2026-10-25",
      async (input, init) => {
        requests.push(String(input));
        assert.equal(init?.redirect, "manual");
        return new Response(null, {
          status: 302,
          headers: { Location: "https://untrusted.invalid/steal" },
        });
      },
    ),
  );
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0]).hostname, "bnwanxbmprbymbutoths.supabase.co");
});

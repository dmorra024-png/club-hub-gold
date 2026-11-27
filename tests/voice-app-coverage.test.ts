import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceDestinations } from "../src/lib/voice/destinations.ts";
import { ConversationProposal, conversationAllowed } from "../src/lib/snoop-conversation.ts";
import { authorizeProposal, proposalSchema } from "../src/lib/voice/agent-settings.server.ts";
import { vocabularyMatch, canonicalGeneticOrProduct } from "../src/lib/voice/catalog-vocabulary.ts";
import { applicationPorts, voiceOwner } from "../src/lib/voice/application-ports.ts";
import { applyDeepgramDraft, protectedVoicePatch } from "../src/lib/deepgram-draft-actions.ts";
import { VoiceCashDay, voiceCashDay } from "../src/lib/voice/cash-read.server.ts";
import { ActionReceipt, acknowledgedMemory, actionOutcome } from "../src/lib/voice/action-protocol.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";
import { normalizedPilotNames } from "../src/lib/deepgram-pilot-policy.ts";
import { catalogVocabulary } from "../src/lib/voice/catalog-vocabulary.ts";
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
    if (
      !["products", "product_create", "categories", "stock", "warehouse", "cash_report"].includes(
        target,
      )
    ) {
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
  assert(conversationAllowed({ ...admin, role: "collaborator" }, proposal("settings")));
  for (const target of [
    "collaborators",
    "membership_settings",
    "membership_fees",
    "devices",
    "personalizations",
    "general_settings",
    "wallet_settings",
    "theme_settings",
    "finances",
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
test("realistic catalog punctuation survives both server and speech vocabulary filters", () => {
  const labels = ["Gelato #41", "Gorilla Glue #4", "Flores / CBD", "CBD 10%", "Índica, Sativa"];
  const rows = [
    ...labels.map((name) => ({ name })),
    { name: "<script>" },
    { name: "unsafe\nlabel" },
    { name: "a".repeat(61) },
  ];
  assert.deepEqual(normalizedPilotNames(rows), labels);
  const vocabulary = catalogVocabulary({
    products: rows.map((r) => r.name),
    categories: rows.map((r) => r.name),
  });
  assert.deepEqual(vocabulary.products, labels);
  assert.deepEqual(vocabulary.categories, labels);
});

test("warehouse navigation opens the existing scoped products capability rather than a new page", async () => {
  const owner = voiceOwner("synthetic-user", "synthetic-club");
  let path = "/",
    opened = "";
  const remove = applicationPorts.register(owner, "products.page", {
    ready: () => true,
    open: (target) => {
      opened = target;
    },
  });
  try {
    await applyDeepgramDraft(ConversationProposal.parse(proposal("warehouse")), {
      owner,
      access: admin,
      path: () => path,
      current: () => true,
      last: {},
      navigate: (next) => {
        path = next;
      },
    });
    assert.equal(path, "/productos");
    assert.equal(opened, "warehouse");
  } finally {
    remove();
  }
});

test("strain pronunciation corrections preserve real catalog identities and reject ambiguous labels", () => {
  assert.equal(vocabularyMatch("Amnesia Heis", ["Amnesia Haze", "Amnesia OG"]), "Amnesia Haze");
  assert.equal(canonicalGeneticOrProduct("Amnecia Heis"), "Amnesia Haze");
  assert.equal(vocabularyMatch("Wite Widou", ["White Widow", "OG Kush"]), null);
  assert.equal(vocabularyMatch("Amnesia Heis", ["Amnesia Haze", "Amnesia Heis"]), "Amnesia Heis");
  assert.equal(vocabularyMatch("OG", ["OG Kush", "OG Glue"]), null);
});

test("consecutive product voice dictation collects exact quantities and euro prices without touching existing manual edits", () => {
  const product = (fields: Record<string, string>) => ConversationProposal.parse({
    intent: "product",
    target: "product_create",
    member: {},
    product: fields,
    query: null,
    declined: [],
    question: "",
    asking: null,
  });
  assert.equal(product({ stock: "0,750", buy_price: "10.25", sell_price: "22,50", destination: "almacen" }).product.stock, "0,750");
  assert.equal(product({ sell_price: "22,50" }).product.sell_price, "22,50");
  assert.equal(product({ destination: "dispensario" }).product.destination, "dispensario");
  assert.throws(() => product({ stock: "7.1234" }));
  assert.throws(() => product({ sell_price: "22.501" }));
  assert.throws(() => product({ sell_price: "22,50", forbidden: "unauthorized" }));
  const defaults = { stock: "0", buy_price: "0.00", sell_price: "0.00", destination: "dispensario" };
  const blank = { name: "", category: "", ...defaults };
  const next = protectedVoicePatch(blank, defaults, { name: "Amnesia Haze", stock: "0,750", sell_price: "22,50" });
  assert.deepEqual(next.skipped, []);
  assert.deepEqual(next.applied, { name: "Amnesia Haze", stock: "0,750", sell_price: "22,50" });
  const manuallyChanged = { ...blank, stock: "0.900", sell_price: "25.00" };
  const preserved = protectedVoicePatch(manuallyChanged, defaults, { stock: "0.750", sell_price: "22.50" });
  assert.deepEqual(preserved.applied, {});
  assert.deepEqual(preserved.skipped.sort(), ["sell_price", "stock"]);
});

test("JARVIS keeps one product form alive while sequential utterances fill only the new fields", async () => {
  const owner = voiceOwner("synthetic-worker", admin.clubId!);
  const fields: Record<string, string> = {
    name: "", category: "", stock: "0", buy_price: "0.00",
    sell_price: "0.00", destination: "dispensario",
  };
  const last: Record<string, Record<string, string>> = {};
  const opened: string[] = [];
  const removePage = applicationPorts.register(owner, "products.page", {
    open: (target) => { opened.push(target); },
  });
  const removeForm = applicationPorts.register(owner, "product.form", {
    snapshot: () => ({ ...fields }),
    patch: (values) => { Object.assign(fields, values); },
  });
  const say = async (product: Record<string, string>) =>
    applyDeepgramDraft({
      ...proposal("product_create"),
      intent: "product",
      product,
    }, {
      access: admin,
      owner,
      path: () => "/productos",
      current: () => true,
      navigate: () => {},
      last,
    });
  try {
    assert.deepEqual((await say({ name: "Amnesia Haze" })).applied, ["name"]);
    assert.deepEqual((await say({ category: "Flores" })).applied, ["category"]);
    assert.deepEqual((await say({ stock: "0.750" })).applied, ["stock"]);
    assert.deepEqual((await say({ sell_price: "22.50" })).applied, ["sell_price"]);
    assert.deepEqual((await say({ destination: "almacen", buy_price: "11.25" })).applied.sort(), ["buy_price", "destination"]);
    assert.deepEqual(fields, {
      name: "Amnesia Haze", category: "Flores", stock: "0.750",
      buy_price: "11.25", sell_price: "22.50", destination: "almacen",
    });
    fields.sell_price = "25.00"; // The collaborator manually corrects this.
    const rejected = await say({ sell_price: "20.00", stock: "0.800" });
    assert.deepEqual(rejected.skipped, ["sell_price"]);
    assert.deepEqual(rejected.applied, ["stock"]);
    assert.equal(fields.sell_price, "25.00");
    assert.equal(fields.stock, "0.800");
    assert(opened.every((target) => target === "product_create"));
  } finally {
    removeForm();
    removePage();
  }
});

test("member registration accumulates successive spoken form fields without overwriting manual edits", async () => {
  const owner = voiceOwner("synthetic-member-dictation", admin.clubId!);
  const fields: Record<string, string> = { first_name: "", last_name: "", birth_date: "", city: "" };
  const last: Record<string, Record<string, string>> = {};
  const deregister = applicationPorts.register(owner, "member.form", {
    snapshot: () => ({ ...fields }),
    patch: patch => Object.assign(fields, patch),
    ready: () => true,
  });
  const say = async (member: Record<string, string>) => applyDeepgramDraft({
    ...proposal("member_create"), intent: "member", member,
  }, {
    access: admin,
    owner,
    path: () => "/soci/nuovo",
    current: () => true,
    navigate: () => {},
    last,
  });
  try {
    assert.deepEqual((await say({ first_name: "Marco" })).applied, ["first_name"]);
    assert.deepEqual((await say({ last_name: "Rossi" })).applied, ["last_name"]);
    assert.deepEqual((await say({ birth_date: "1995-03-12" })).applied, ["birth_date"]);
    assert.deepEqual(fields, { first_name: "Marco", last_name: "Rossi", birth_date: "1995-03-12", city: "" });
    fields.last_name = "Rossini"; // collaborator correction
    const result = await say({ last_name: "Rossi", city: "Palma" });
    assert.deepEqual(result.skipped, ["last_name"]);
    assert.deepEqual(result.applied, ["city"]);
    assert.equal(fields.last_name, "Rossini");
    assert.equal(fields.city, "Palma");
  } finally { deregister(); }
});

test("product field receipts do not terminate a voice session as INVALID_SEQUENCE", () => {
  const product = ConversationProposal.parse({
    ...proposal("product_create"),
    intent: "product",
    product: { name: "Synthetic Haze", category: "Flores", stock: "0.750",
               buy_price: "10.25", sell_price: "22.50", destination: "almacen" },
  });
  const emittedFields = ["name", "category", "stock", "buy_price", "sell_price", "destination", "strain"];
  const receipt = ActionReceipt.parse({
    type: "AppActionResult", id: "synthetic-receipt", status: "prepared",
    code: "OK", applied: emittedFields, skipped: [],
  });
  const memory = acknowledgedMemory({
    operation: "none", member: {}, product: {}, declined: [], lastQuestion: "",
  }, product, receipt);
  for (const field of emittedFields)
    assert.equal((memory.product as Record<string, string>)[field], (product.product as Record<string, string>)[field]);
  assert.equal(actionOutcome(receipt).ok, true);
  assert.equal(actionOutcome(receipt).persisted, false);
  assert.equal(ActionReceipt.safeParse({
    type: "AppActionResult", id: "one-field", status: "prepared",
    applied: ["sell_price"], skipped: ["stock"], code: "MANUAL_EDIT_PRESERVED",
  }).success, true);
  assert.equal(ActionReceipt.safeParse({
    type: "AppActionResult", id: "unsafe-extra", status: "prepared",
    applied: ["stock_adjust"], skipped: [], code: "OK",
  }).success, false);
});

test("sativa/indica/hibrida form dictation is typed and requires an explicit validated value", () => {
  for (const strain of ["sativa", "indica", "hibrida"]) {
    const p = ConversationProposal.safeParse({
      ...proposal("product_create"), intent: "product", product: { strain },
    });
    assert.equal(p.success, true, strain);
    assert.equal(ActionReceipt.safeParse({
      type: "AppActionResult", id: "synthetic-strain", status: "prepared", applied: ["strain"], skipped: [],
    }).success, true);
  }
  assert.equal(ConversationProposal.safeParse({
    ...proposal("product_create"), intent: "product", product: { strain: "sativaa" },
  }).success, false);
});

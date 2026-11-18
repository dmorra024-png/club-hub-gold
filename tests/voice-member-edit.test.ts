import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import { applicationPorts } from "../src/lib/voice/application-ports.ts";
import { authorizeProposal, proposalSchema } from "../src/lib/voice/agent-settings.server.ts";
import { ConversationProposal } from "../src/lib/snoop-conversation.ts";
const proposal = (member: Record<string, string>) => ({
  intent: "member_edit",
  target: null,
  member,
  product: {},
  query: null,
  declined: [],
  question: "Revisa los cambios",
  asking: null,
});
const access = {
  role: "admin",
  clubId: "synthetic",
  clubName: null,
  clubLogo: null,
  status: "active",
  permissions: ["manage_members"],
} as const;
test("selected member edits preserve untouched and manually changed fields, never save", async () => {
  let values = { first_name: "Marco", last_name: "Rossi", city: "Palma" };
  const original = { ...values };
  let changes = 0;
  const remove = applicationPorts.register("synthetic-edit", "member.edit", {
    baseline: () => original,
    snapshot: () => values,
    patch: (patch) => {
      changes++;
      values = { ...values, ...patch };
    },
  });
  const options = {
    access: { ...access, permissions: ["manage_members"] } as any,
    owner: "synthetic-edit",
    path: () => "/soci/synthetic-member",
    current: () => true,
    navigate: () => {
      throw Error("Must not navigate");
    },
    last: {},
  };
  try {
    const first = await applyDeepgramDraft(proposal({ last_name: "Bianchi" }), options);
    assert.deepEqual(first.applied, ["last_name"]);
    assert.deepEqual(values, { first_name: "Marco", last_name: "Bianchi", city: "Palma" });
    values.last_name = "Manual";
    const second = await applyDeepgramDraft(
      proposal({ last_name: "García", city: "Madrid" }),
      options,
    );
    assert.deepEqual(second.skipped, ["last_name"]);
    assert.equal(values.last_name, "Manual");
    assert.equal(values.city, "Madrid");
    assert.equal(changes, 2);
    await assert.rejects(
      applyDeepgramDraft(proposal({ city: "Other" }), {
        ...options,
        access: { ...options.access, permissions: [] },
      }),
      /NOT_AUTHORIZED/,
    );
    assert.equal(changes, 2);
  } finally {
    remove();
  }
});
test("edit schema cannot redirect to creation or modify document, role or money", () => {
  assert(ConversationProposal.safeParse(proposal({ first_name: "Mario" })).success);
  assert(proposalSchema.properties.intent.enum.includes("member_edit"));
  assert(
    authorizeProposal(proposal({ first_name: "Mario" }), {
      ...access,
      permissions: ["manage_members"],
    } as any).ok,
  );
  assert(
    !authorizeProposal(proposal({ first_name: "Mario" }), { ...access, permissions: [] } as any).ok,
  );
  assert(
    !authorizeProposal(proposal({ first_name: "Mario" }), {
      ...access,
      status: "suspended",
      permissions: ["manage_members"],
    } as any).ok,
  );
  assert(
    !ConversationProposal.safeParse({
      ...proposal({ first_name: "Mario" }),
      target: "member_create",
    }).success,
  );
  for (const key of ["dni_number", "role", "balance", "club_id"])
    assert(!ConversationProposal.safeParse(proposal({ [key]: "unauthorized" })).success);
});
test("editing in another club has no registered form capability", async () => {
  await assert.rejects(
    applyDeepgramDraft(proposal({ city: "Palma" }), {
      access: { ...access, permissions: ["manage_members"] } as any,
      owner: "other-club",
      path: () => "/soci/a",
      current: () => false,
      navigate: () => {},
      last: {},
    }),
    /STALE/,
  );
});
test("selected-member sections share existing capabilities and enforce history permission", async () => {
  const opened: string[] = [];
  const remove = applicationPorts.register("section-test", "member.sections", {
    open: (target) => {
      opened.push(target);
    },
  });
  const options = {
    access: { ...access, permissions: ["manage_members", "view_reports"] } as any,
    owner: "section-test",
    path: () => "/soci/synthetic",
    current: () => true,
    navigate: () => {
      throw Error("unexpected navigation");
    },
    last: {},
  };
  try {
    for (const query of ["qr", "history", "discounts", "renewal"]) {
      await applyDeepgramDraft({ ...proposal({}), intent: "member_section", query }, options);
    }
    assert.deepEqual(opened, ["qr", "history", "discounts", "renewal"]);
    await assert.rejects(
      applyDeepgramDraft(
        { ...proposal({}), intent: "member_section", query: "history" },
        { ...options, access: { ...options.access, permissions: ["manage_members"] } },
      ),
      /NOT_AUTHORIZED/,
    );
    for (const query of ["save", "pay", "delete", "refund", "other-member"])
      assert(
        !ConversationProposal.safeParse({ ...proposal({}), intent: "member_section", query })
          .success,
      );
  } finally {
    remove();
  }
});
test("cash drafts prepare exact decimal values in existing form, never submit and preserve manual count", async () => {
  let values = { opening_cash: "0", closing_cash: "", notes: "" };
  let tab = "";
  const cleanups = [
    applicationPorts.register("cash-draft", "cash.page", {
      open: (value) => {
        tab = value;
      },
    }),
    applicationPorts.register("cash-draft", "cash.form", {
      baseline: () => ({ opening_cash: "0", closing_cash: "", notes: "" }),
      snapshot: () => values,
      patch: (patch) => {
        values = { ...values, ...patch };
      },
    }),
  ];
  const options = {
    access: { ...access, permissions: ["use_cash"] } as any,
    owner: "cash-draft",
    path: () => "/caja",
    current: () => true,
    navigate: () => {},
    last: {},
  };
  const request = {
    ...proposal({}),
    intent: "cash_draft",
    target: "cash",
    cash: { opening_cash: "50,25" },
  };
  try {
    const result = await applyDeepgramDraft(request, options);
    assert.deepEqual(result.applied, ["opening_cash"]);
    assert.equal(values.opening_cash, "50,25");
    assert.equal(tab, "mine");
    values.opening_cash = "75";
    const next = await applyDeepgramDraft({ ...request, cash: { opening_cash: "60" } }, options);
    assert.deepEqual(next.skipped, ["opening_cash"]);
    assert.equal(values.opening_cash, "75");
    await assert.rejects(
      applyDeepgramDraft(request, { ...options, access: { ...options.access, permissions: [] } }),
      /NOT_AUTHORIZED/,
    );
    for (const cash of [
      { opening_cash: "-1" },
      { closing_cash: "1.999" },
      { opening_cash: "50", closing_cash: "50" },
      { balance: "50" },
      { cash_session_id: "other" },
    ])
      assert(!ConversationProposal.safeParse({ ...request, cash }).success);
  } finally {
    cleanups.forEach((fn) => fn());
  }
});
test("mounted but still loading capabilities are not acknowledged as ready", async () => {
  let ready = false;
  const remove = applicationPorts.register("loading-form", "member.edit", { ready: () => ready });
  try {
    const waiting = applicationPorts.wait("loading-form", "member.edit", () => true, 200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    ready = true;
    assert.equal(await waiting, applicationPorts.get("loading-form", "member.edit"));
    ready = false;
    await assert.rejects(
      applicationPorts.wait("loading-form", "member.edit", () => true, 25),
      /FORM_UNAVAILABLE/,
    );
  } finally {
    remove();
  }
});
test("navigation acknowledgements never demand a second user confirmation", async () => {
  const { actionOutcome } = await import("../src/lib/voice/action-protocol.ts");
  assert.equal(
    actionOutcome({ type: "AppActionResult", id: "navigation", status: "opened" })
      .requiresConfirmation,
    false,
  );
  assert.equal(
    actionOutcome({ type: "AppActionResult", id: "draft", status: "prepared" })
      .requiresConfirmation,
    true,
  );
  const result = authorizeProposal({ ...proposal({}), intent: "navigate", target: "members" }, {
    ...access,
    permissions: ["manage_members"],
  } as any);
  assert(result.ok);
  assert.equal(result.requiresConfirmation, false);
  assert.equal(result.requiresManualSave, false);
});

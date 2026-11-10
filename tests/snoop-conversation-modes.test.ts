import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dialogueCases } from "./fixtures/snoop-dialogue-cases.mjs";
import {
  ConversationProposal,
  emptyConversation,
  reduceConversation,
  conversationAllowed,
} from "../src/lib/snoop-conversation.ts";
import {
  conversationAvailability,
  interpretConversation as executeConversation,
} from "../src/lib/snoop-conversation.server.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";
const access: AccountAccess = {
  role: "collaborator",
  status: "active",
  clubId: "10000000-0000-4000-8000-000000000001",
  clubName: null,
  clubLogo: null,
  permissions: ["manage_members", "manage_products", "use_cash", "view_reports"],
};
function interpretConversation(raw: any, scope: Parameters<typeof executeConversation>[1]) {
  return executeConversation(
    { ...raw, owner: { userId: scope.userId, clubId: scope.access.clubId } },
    scope,
  );
}
const flags = {
  AI_PROVIDER: "cloudflare",
  AI_VOICE_INTENTS_ENABLED: "true",
  AI_EXTERNAL_PROCESSING_ENABLED: "true",
  AI_VOICE_PROCESSING_ENABLED: "true",
  SNOOP_AI_FREE_TIER_CONFIRMED: "true",
  SNOOP_AI_CONVERSATION_MODE: "pilot",
  SNOOP_AI_PILOT_CLUB_ID: access.clubId!,
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_URL: "http://127.0.0.1:54321",
  AI_PERSONAL_DATA_PROCESSING_ENABLED: "false",
  SNOOP_AI_DPA_REVIEW_ID: "",
  SNOOP_AI_NOTICE_REVIEW_ID: "",
  SNOOP_AI_PROCESSING_REVIEW_ID: "",
};
function env(values: Record<string, string>) {
  const saved = Object.keys(values).map((k) => [k, process.env[k]]);
  Object.assign(process.env, values);
  return () =>
    saved.forEach(([k, v]) => (v === undefined ? delete process.env[k!] : (process.env[k!] = v)));
}
test("PILOT requires local matching database origins and the explicitly isolated club; REAL defaults closed", () => {
  const restore = env(flags);
  try {
    assert.deepEqual(conversationAvailability(access), { pilot: true, real: false });
    process.env.SUPABASE_URL = "https://bnwanxbmprbymbutoths.supabase.co";
    assert.equal(conversationAvailability(access).pilot, false);
    process.env.SUPABASE_URL = flags.SUPABASE_URL;
    assert.equal(conversationAvailability({ ...access, clubId: "other" }).pilot, false);
    process.env.SNOOP_AI_CONVERSATION_MODE = "real";
    process.env.AI_PERSONAL_DATA_PROCESSING_ENABLED = "true";
    assert.equal(conversationAvailability(access).real, false);
    for (const k of [
      "SNOOP_AI_DPA_REVIEW_ID",
      "SNOOP_AI_NOTICE_REVIEW_ID",
      "SNOOP_AI_PROCESSING_REVIEW_ID",
    ])
      process.env[k] = "test-review";
    assert.equal(conversationAvailability(access).real, true);
    assert.equal(conversationAvailability({ ...access, status: "suspended" }).real, false);
  } finally {
    restore();
  }
});
test("51 realistic IT/ES dialogue vectors traverse the actual GLM adapter with synthetic responses, never live inference", async () => {
  const restore = env(flags),
    root = globalThis as typeof globalThis & { __env__?: any },
    before = root.__env__;
  let index = 0,
    memory = emptyConversation();
  root.__env__ = {
    SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
    SNOOP_AI: {
      run: async (model: string, payload: any) => {
        assert.equal(model, "@cf/zai-org/glm-4.7-flash");
        assert.equal(payload.store, false);
        assert.equal(payload.stream, false);
        assert.equal(payload.max_completion_tokens, 700);
        const wire = JSON.parse(payload.messages[1].content);
        assert.equal(wire.text, dialogueCases[index].text);
        assert.equal(wire.context.declined.includes("phone"), memory.declined.includes("phone"));
        assert.deepEqual(Object.keys(wire).sort(), ["context", "screen", "text"]);
        return { response: JSON.stringify(dialogueCases[index].proposal) };
      },
    },
  };
  try {
    for (index = 0; index < dialogueCases.length; index++) {
      const row = dialogueCases[index];
      const proposal = await interpretConversation(
        {
          mode: "pilot",
          consent: true,
          synthetic: true,
          text: row.text,
          screen: "home",
          context: memory,
        },
        { userId: `synthetic-${Math.floor(index / 25)}`, access },
      );
      assert.equal(proposal.intent, row.proposal.intent);
      memory = reduceConversation(memory, proposal);
      if (index === 6) assert.equal(memory.member.last_name, "Bianchi");
      if (index === 30) assert.deepEqual(memory.declined, ["phone"]);
    }
    assert.deepEqual(memory, emptyConversation());
    assert.ok(dialogueCases.length >= 50);
  } finally {
    root.__env__ = before;
    restore();
  }
});
test("strict actions refuse prices, stock writes, invalid dates, unknown keys and cross-module patches", () => {
  const p = dialogueCases[0].proposal;
  for (const value of [
    { ...p, save: true },
    { ...p, intent: "payment" },
    { ...p, member: { birth_date: "1995-02-31" } },
    { ...p, product: { sell_price: 13.5 } },
    { ...p, product: { stock: 15 } },
    { ...p, intent: "navigate", member: { first_name: "Mario" } },
  ])
    assert.equal(ConversationProposal.safeParse(value).success, false);
  assert.equal(conversationAllowed({ ...access, permissions: [] }, p), false);
});
test("privacy rejects unauthorized mode and member context before touching the binding", async () => {
  const restore = env(flags);
  try {
    const request = {
      mode: "pilot",
      consent: true,
      synthetic: true,
      text: "test",
      screen: "home",
      context: { ...emptyConversation(), member: { first_name: "Synthetic" } },
    };
    await assert.rejects(
      interpretConversation({ ...request, synthetic: false }, { userId: "test", access }),
      /NOT_AUTHORIZED/,
    );
    await assert.rejects(
      interpretConversation(request, { userId: "test", access: { ...access, permissions: [] } }),
      /NOT_AUTHORIZED/,
    );
    await assert.rejects(
      interpretConversation({ ...request, mode: "real" }, { userId: "test", access }),
      /NOT_AUTHORIZED/,
    );
  } finally {
    restore();
  }
});
test("conversation transport is POST-only, no-store and has no storage/database model tools", () => {
  const server = readFileSync("src/lib/snoop-conversation.server.ts", "utf8"),
    fn = readFileSync("src/lib/snoop-conversation.functions.ts", "utf8");
  assert.doesNotMatch(server, /console\.|localStorage|sessionStorage|\.from\(|supabase\.rpc/);
  assert.match(fn, /method: ["']POST["']/);
  assert.match(fn, /no-store, private/);
});
test("declined optional field is suppressed semantically, even when the model uses another word", async () => {
  const restore = env(flags),
    root = globalThis as typeof globalThis & { __env__?: any },
    previous = root.__env__;
  root.__env__ = {
    SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
    SNOOP_AI: {
      run: async () => ({
        response: JSON.stringify({
          ...dialogueCases[0].proposal,
          question: "¿Número?",
          asking: "phone",
        }),
      }),
    },
  };
  try {
    const p = await interpretConversation(
      {
        mode: "pilot",
        consent: true,
        synthetic: true,
        text: "Continuiamo",
        screen: "home",
        context: { ...emptyConversation(), declined: ["phone"] },
      },
      { userId: "declined-synthetic", access },
    );
    assert.equal(p.asking, null);
    assert.doesNotMatch(p.question, /Número/);
  } finally {
    root.__env__ = previous;
    restore();
  }
});
test("quota and invalid structured responses fail closed, without retries or alternate providers", async () => {
  const restore = env(flags),
    root = globalThis as typeof globalThis & { __env__?: any },
    previous = root.__env__;
  let calls = 0,
    quota = true;
  root.__env__ = {
    SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
    SNOOP_AI: {
      run: async () => {
        calls++;
        if (quota) throw Object.assign(new Error("quota"), { status: 429 });
        return { response: JSON.stringify({ ...dialogueCases[0].proposal, save: true }) };
      },
    },
  };
  const request = {
    mode: "pilot",
    consent: true,
    synthetic: true,
    text: "Crear socio",
    screen: "home",
    context: emptyConversation(),
  };
  try {
    await assert.rejects(
      interpretConversation(request, { userId: "error-synthetic", access }),
      /quota/,
    );
    assert.equal(calls, 1);
    quota = false;
    await assert.rejects(
      interpretConversation(request, { userId: "error-synthetic", access }),
      /INVALID_PROPOSAL/,
    );
    assert.equal(calls, 2);
  } finally {
    root.__env__ = previous;
    restore();
  }
});
test("offscreen personal values never reach GLM; resumption uses field identifiers only", async () => {
  const restore = env(flags),
    root = globalThis as typeof globalThis & { __env__?: any },
    previous = root.__env__;
  let screen = "home";
  root.__env__ = {
    SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
    SNOOP_AI: {
      run: async (_: string, payload: any) => {
        const body = JSON.parse(payload.messages[1].content);
        assert.deepEqual(body.context.availableDrafts.member, ["first_name", "birth_date"]);
        if (screen === "home") {
          assert.deepEqual(body.context.member, {});
          assert.doesNotMatch(JSON.stringify(payload), /SyntheticPrivateName|1995-03-12/);
        } else assert.equal(body.context.member.first_name, "SyntheticPrivateName");
        return { response: JSON.stringify(dialogueCases[0].proposal) };
      },
    },
  };
  try {
    for (screen of ["home", "member_create"])
      await interpretConversation(
        {
          mode: "pilot",
          consent: true,
          synthetic: true,
          text: "Continua",
          screen,
          context: {
            ...emptyConversation(),
            member: { first_name: "SyntheticPrivateName", birth_date: "1995-03-12" },
          },
        },
        { userId: "minimization-synthetic", access },
      );
  } finally {
    root.__env__ = previous;
    restore();
  }
});
test("omitted/blank AI values cannot erase manual draft fields", () => {
  const proposal = dialogueCases[0].proposal;
  assert.equal(
    ConversationProposal.safeParse({ ...proposal, member: { first_name: "" } }).success,
    false,
  );
  assert.equal(
    ConversationProposal.safeParse({ ...proposal, member: { last_name: "  " } }).success,
    false,
  );
  assert.equal(
    ConversationProposal.safeParse({ ...proposal, member: { phone: "" } }).success,
    false,
  );
  assert.equal(
    ConversationProposal.safeParse({ ...proposal, member: { phone: "" }, declined: ["phone"] })
      .success,
    true,
  );
  assert.equal(
    ConversationProposal.safeParse({ ...dialogueCases[16].proposal, product: { name: "" } })
      .success,
    false,
  );
});

test("a stale account or club request is rejected before model execution", async () => {
  const restore = env(flags);
  try {
    for (const owner of [
      { userId: "previous-user", clubId: access.clubId },
      { userId: "current-user", clubId: "previous-club" },
    ])
      await assert.rejects(
        executeConversation(
          {
            mode: "pilot",
            consent: true,
            synthetic: true,
            text: "Continuar",
            screen: "home",
            context: emptyConversation(),
            owner,
          },
          { userId: "current-user", access },
        ),
        /NOT_AUTHORIZED/,
      );
  } finally {
    restore();
  }
});

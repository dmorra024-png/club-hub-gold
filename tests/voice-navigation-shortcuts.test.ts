import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceNavigationShortcut } from "../src/lib/voice/navigation-shortcuts.ts";
import { normalizeNavigationProposal } from "../src/lib/voice/navigation-proposal.ts";
import { authorizeProposal } from "../src/lib/voice/agent-settings.server.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";
const access: AccountAccess = {
  status: "active", role: "admin",
  clubId: "00000000-0000-4000-8000-000000000001",
  clubName: "Synthetic", clubLogo: null,
  permissions: ["manage_members", "manage_products", "use_cash", "view_reports"],
};
const navigation = (target: string) => ({
  intent: "navigate", target, member: {}, product: {}, query: null,
  declined: [], question: "", asking: null,
});
test("common exact Spanish/Italian read-only shortcuts navigate existing screens", () => {
  for (const [phrase, target] of [
    ["quiero ver los productos", "products"],
    ["Ver productos!", "products"],
    ["muéstrame los productos", "products"],
    ["apri prodotti", "products"],
    ["abre stock", "stock"],
    ["muéstrame el stock", "stock"],
    ["quiero ver el inventario", "stock"],
    ["apri magazzino", "warehouse"],
    ["abre caja", "cash"],
    ["apri cassa", "cash"],
    ["abre ficha", "member_create"],
    ["apri scheda socio", "member_create"],
    ["crear producto", "product_create"],
    ["crear socio", "member_create"],
    ["crea un socio", "member_create"],
    ["registrar socio", "member_create"],
    ["aggiungi socio", "member_create"],
    ["crea un producto", "product_create"],
  ]) {
    assert.equal(voiceNavigationShortcut(phrase), target, phrase);
    assert(authorizeProposal(navigation(target), access).ok, phrase);
  }
});
test("never turn a named person, amount, order or ambiguous sentence into a shortcut", () => {
  for (const phrase of [
    "abre ficha de Marco Rossi",
    "Abre producto Amnesia Haze",
    "crear producto Amnesia Haze 20 euros",
    "crear socio Marco Rossi",
    "dispensar 2 gramos",
    "caja 10 euros",
    "quien abrió la caja hoy",
    "me gustaría hacer un pedido",
    "stock de Juan",
    "",
  ]) assert.equal(voiceNavigationShortcut(phrase), null, phrase);
  assert.equal(authorizeProposal(navigation("products"), { ...access, status: "suspended" }).ok, false);
});

test("LLM may omit empty navigation properties without failing the existing authorization checks", () => {
  for (const [intent,target] of [
    ["navigate","member_create"],
    ["member","member_create"],
    ["navigate","product_create"],
    ["product","product_create"],
    ["navigate","stock"],
    ["navigate","products"],
  ]) {
    const raw = { intent, target };
    const normalized = normalizeNavigationProposal(raw);
    assert.deepEqual(normalized, navigation(target), intent + " " + target);
    assert.equal(authorizeProposal(normalized, access).ok, true);
    assert.equal(authorizeProposal(normalized, {...access, status:"suspended"}).ok, false);
  }
});
test("navigation repair never discards real fields, unknown extra arguments or privileged operations", () => {
  for (const value of [
    {intent:"member",target:"member_create",member:{first_name:"Marco"}},
    {intent:"product",target:"product_create",product:{name:"Amnesia Haze"}},
    {intent:"navigate",target:"member_create",member:{first_name:"Marco"}},
    {intent:"navigate",target:"member_create",untrusted:"ignore me"},
    {intent:"navigate",target:"member_create",declined:["phone"]},
    {intent:"navigate",target:"member_create",query:"Marco"},
    {intent:"navigate",target:"member_create",question:"Continue?"},
    {intent:"navigate",target:"member_create",asking:"first_name"},
    {intent:"cash_draft",target:"cash"},
    {intent:"navigate",target:"not-a-real-route"},
  ]) {
    assert.equal(normalizeNavigationProposal(value), value);
  }
});

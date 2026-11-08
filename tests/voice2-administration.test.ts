import { test } from "node:test";
import assert from "node:assert/strict";
import {
  administrativeIntent,
  voiceIntentAllowed,
  voiceMemberDraft,
  scopedMemberDraft,
  scopedMemberSearch,
} from "../src/lib/administrative-voice.ts";
import { voiceInteger, voiceDecimal } from "../src/lib/voice-numbers.ts";
import {
  parseAdministrativeDictation,
  spokenAdministrativeDate,
  mergeUneditedValues,
} from "../src/lib/member-administration.ts";
const access = {
  role: "collaborator" as const,
  status: "active" as const,
  clubId: "club-a",
  clubName: "Synthetic",
  clubLogo: null,
  permissions: ["manage_members" as const],
};
test("complete IT/ES member phrases keep every administrative field through navigation", () => {
  for (const text of [
    "SNOOP, registra un socio Persona Sintetica, nato il ventiquattro luglio millenovecentonovantacinque, residente a Palma, telefono sei sei sei sette sette sette otto otto otto, email prova chiocciola esempio punto test, quota Mensile",
    "SNOOP, registra un socio llamado Persona Sintetica, nacido el veinticuatro de julio de mil novecientos noventa y cinco, residente en Palma, teléfono seis seis seis siete siete siete ocho ocho ocho, correo prova arroba esempio punto test, cuota Mensual",
  ]) {
    const intent = administrativeIntent(text, "/");
    assert.equal(intent?.kind, "member-draft");
    if (intent?.kind !== "member-draft") throw new Error("missing draft");
    assert.equal(intent.to, "/soci/nuovo");
    assert.equal(intent.fields.first_name, "Persona");
    assert.equal(intent.fields.last_name, "Sintetica");
    assert.equal(intent.fields.birth_date, "1995-07-24");
    assert.equal(intent.fields.city, "Palma");
    assert.equal(intent.fields.phone, "666777888");
    assert.equal(intent.fields.email, "prova@esempio.test");
    assert.ok(intent.fields.plan_name);
  }
});
test("single-field conversational corrections are patches and preserve manual edits during processing", () => {
  for (const [text, fields] of [
    ["No, cambia el apellido a Demo", { last_name: "Demo" }],
    ["No, il nome è Nuovo", { first_name: "Nuovo" }],
    ["correggi la città a Palma", { city: "Palma" }],
  ] as const) {
    const intent = administrativeIntent(text, "/soci/nuovo");
    assert.equal(intent?.kind, "member-draft");
    if (intent?.kind === "member-draft") assert.deepEqual(intent.fields, fields);
  }
  assert.deepEqual(
    mergeUneditedValues(
      { first_name: "Manual", city: "Old" },
      { first_name: "Old", city: "Old" },
      { first_name: "Dictated", city: "New" },
    ),
    { first_name: "Manual", city: "New" },
  );
});
test("local member search preserves the requested name rather than navigating with an empty search", () => {
  for (const text of [
    "Busca al socio Persona Sintetica",
    "Cerca il socio Persona Sintetica",
    "abre la ficha del socio Persona Sintetica",
  ]) {
    const i = administrativeIntent(text, "/");
    assert.equal(i?.kind, "member-search");
    if (i?.kind === "member-search") assert.equal(i.query, "Persona Sintetica");
  }
  assert.equal(administrativeIntent("busca Runtz", "/"), null);
  const number = administrativeIntent(
    "cerca il socio numero zero zero zero uno zero quattro due",
    "/",
  );
  assert.equal(number?.kind === "member-search" ? number.query : null, "0001042");
  const dni = administrativeIntent("busca al socio con DNI TEST1234", "/");
  assert.equal(dni?.kind === "member-search" ? dni.query : null, "TEST1234");
});
test("administrative permissions and short-lived draft/search scopes fail closed", () => {
  assert.equal(voiceIntentAllowed(access, "/soci/nuovo"), true);
  assert.equal(voiceIntentAllowed({ ...access, permissions: [] }, "/soci/nuovo"), false);
  assert.equal(voiceIntentAllowed({ ...access, status: "suspended" }, "/soci/nuovo"), false);
  assert.equal(voiceIntentAllowed({ ...access, role: "super_admin" }, "/soci/nuovo"), false);
  const scope = { userId: "user-a", clubId: "club-a" },
    raw = voiceMemberDraft({ city: "Synthetic" }, scope, 1000);
  assert.deepEqual(scopedMemberDraft(raw, scope, 1001), { city: "Synthetic" });
  assert.equal(scopedMemberDraft(raw, { ...scope, clubId: "club-b" }, 1001), null);
  assert.equal(scopedMemberDraft(raw, { ...scope, userId: "user-b" }, 1001), null);
  assert.equal(scopedMemberDraft(raw, scope, 200000), null);
  const query = JSON.stringify({ version: 2, ...scope, at: 1000, query: "Synthetic" });
  assert.equal(scopedMemberSearch(query, scope, 1001), "Synthetic");
  assert.equal(scopedMemberSearch(query, scope, 999), null);
  assert.equal(scopedMemberSearch(query, { ...scope, clubId: "club-b" }, 1001), null);
});
test("IT/ES numbers and strict spoken calendar dates reject guesses", () => {
  for (const [s, n] of [
    ["veinticinco", 25],
    ["ventiquattro", 24],
    ["quattro virgola cinquanta", 4.5],
    ["cuatro coma cero cinco", 4.05],
    ["4,50", 4.5],
    ["mil novecientos noventa y cinco", 1995],
    ["millenovecentonovantacinque", 1995],
  ] as const)
    assert.equal(voiceDecimal(s), n, s);
  for (const s of ["dos tres", "meno due", "4e2", "unknown"])
    assert.equal(voiceDecimal(s), null, s);
  assert.equal(spokenAdministrativeDate("trentuno febbraio duemila"), null);
  assert.deepEqual(parseAdministrativeDictation("nombre Primero, nombre Segundo"), {
    first_name: "Segundo",
  });
  assert.equal(voiceInteger("veintinueve"), 29);
});
test("actual plan names must resolve uniquely; an ambiguous alias never picks the first club plan", () => {
  assert.equal(parseAdministrativeDictation("quota mensile", ["Mensual"]).plan_name, "Mensual");
  assert.equal(parseAdministrativeDictation("cuota Mensual", ["Mensual", "MENSUAL"]).plan_name, "");
  assert.equal(parseAdministrativeDictation("cuota Mensual", ["Mensual Premium"]).plan_name, "");
});

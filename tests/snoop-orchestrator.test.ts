import test from "node:test";
import assert from "node:assert/strict";
import {
  planSnoopTurn,
  projectSnoopTurn,
  SnoopSketch,
  sketchSupports,
} from "../src/lib/snoop-orchestrator.ts";
import { memberConversation } from "../src/lib/voice-conversation.ts";

test("semantic projection never serializes free text, identifiers or local search values", () => {
  for (const raw of [
    "Buscar socio Mario Rossi 666123456",
    "buscar producto Amnesia Haze",
    "quiero crear socio <documento secreto>",
    "API_KEY=hidden foo@private.test",
    "cambia cognome García",
  ]) {
    const { sketch } = projectSnoopTurn(raw, "/");
    assert.equal(SnoopSketch.safeParse(sketch).success, true);
    assert.doesNotMatch(
      JSON.stringify(sketch),
      /Mario|Rossi|666123456|Amnesia|Haze|secreto|hidden|private|García/,
    );
  }
  assert.equal(
    SnoopSketch.safeParse({ symbols: ["Mario"], screen: "home", references: [] }).success,
    false,
  );
  assert.equal(
    SnoopSketch.safeParse({ symbols: ["create"], screen: "home", references: [], text: "secret" })
      .success,
    false,
  );
});
test("semantic intents combine concepts without per-phrase patterns", () => {
  const p = planSnoopTurn("Snoop fammi uno socio nuovo", "/");
  // Indirect requests are proposals, not guesses executed locally.
  assert.equal(p.kind, "uncertain");
  assert.equal(
    sketchSupports("Crear socio", projectSnoopTurn("Snoop fammi uno socio nuovo", "/").sketch),
    true,
  );
  for (const raw of ["cobrar caja", "anular socio", "guardar producto"])
    assert.equal(planSnoopTurn(raw, "/").kind, "uncertain");
  assert.equal(
    sketchSupports("Crear producto", projectSnoopTurn("crear socio", "/").sketch),
    false,
  );
  assert.equal(sketchSupports("Abrir caja", projectSnoopTurn("no abrir caja", "/").sketch), false);
  assert.equal(
    sketchSupports("Crear socio", projectSnoopTurn("crear socio y producto", "/").sketch),
    false,
  );
});
test("self repair and pending surname preserve other local member fields", () => {
  const name = memberConversation(
    { awaiting: "name" },
    "Si chiama Marco, no scusa Mario Rossi",
    {},
    [],
    true,
  );
  assert.deepEqual(name.patch, { first_name: "Mario", last_name: "Rossi" });
  const current = { ...name.patch, city: "Palma", phone: "666123456" };
  const ask = memberConversation(name.state, "Aspetta, cambia il cognome", current, [], true);
  assert.deepEqual(ask.patch, {});
  assert.match(ask.message, /Quale cognome/);
  const answer = memberConversation(ask.state, "Bianchi", current, [], true);
  assert.deepEqual(answer.patch, { last_name: "Bianchi" });
});
test("ambiguous spoken century requires clarification; birthplace is not residence", () => {
  const current = { first_name: "Mario", last_name: "Rossi" };
  const date = memberConversation(
    { awaiting: "birth" },
    "È nato il dodici marzo del novantacinque a Palma",
    current,
    [],
    true,
  );
  assert.deepEqual(date.patch, {});
  assert.match(date.message, /quattro cifre/);
  const answer = memberConversation(date.state, "1995", current, [], true);
  assert.deepEqual(answer.patch, { birth_date: "1995-03-12" });
});
test("local search references preserve exact proper names without leaking domain words", () => {
  const p = projectSnoopTurn("Buscar socio Mario Caja", "/");
  assert.equal(p.localReference, "Mario Caja");
  assert.deepEqual(p.sketch.symbols, ["find", "member"]);
  assert.deepEqual(p.sketch.references, ["r0"]);
});

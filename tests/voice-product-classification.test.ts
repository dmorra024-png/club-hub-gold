import { test } from "node:test";
import assert from "node:assert/strict";
import { productFormVoice, contextualProductDictation } from "../src/lib/product-form-voice.ts";

const categories = [
  { id: "smoke", name: "Flores", unit_type: "gr", is_smokeable: true },
  { id: "other", name: "Accesorios", unit_type: "unit", is_smokeable: false },
];

test("standalone spoken classification patches only the strain field", () => {
  const cases: Array<[string, string]> = [
    ["sativa", "sativa"],
    ["indica", "indica"],
    ["híbrida", "hibrida"],
    ["cambia a híbrida", "hibrida"],
    ["metti indica", "indica"],
    ["tipo sativa", "sativa"],
  ];
  for (const [phrase, strain] of cases) {
    assert.deepEqual(productFormVoice(phrase, categories), { strain }, phrase);
  }
  assert.deepEqual(contextualProductDictation("sativa", categories), { strain: "sativa" });
  assert.equal(productFormVoice("cambia a desconocida", categories), null);
  assert.equal(contextualProductDictation("Amnesia Haze", categories), null);
});

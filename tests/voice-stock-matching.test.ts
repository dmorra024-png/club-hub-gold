import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceStockCandidates } from "../src/lib/voice/stock-candidates.ts";

const normalize = (s: string) => s.toLowerCase().trim();
const products = [
  { id: "1", name: "Amnesia Haze" },
  { id: "2", name: "Amnesia Haze CBD" },
  { id: "3", name: "Super Amnesia" },
];

test("voice stock never arbitrarily selects the first partial match", () => {
  assert.deepEqual(voiceStockCandidates(products, "amnesia", normalize).map((p) => p.id), ["1", "2", "3"]);
  assert.deepEqual(voiceStockCandidates(products, "amnesia haze", normalize).map((p) => p.id), ["1"]);
  assert.deepEqual(voiceStockCandidates(products, "amnesia haze cbd", normalize).map((p) => p.id), ["2"]);
  assert.deepEqual(voiceStockCandidates(products, "missing", normalize), []);
  assert.deepEqual(voiceStockCandidates(products, "", normalize), []);
});

test("duplicated exact product names remain ambiguous", () => {
  assert.equal(voiceStockCandidates(
    [{ name: "Same" }, { name: "same" }],
    "same",
    normalize,
  ).length, 2);
});

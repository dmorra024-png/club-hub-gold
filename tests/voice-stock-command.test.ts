import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVoiceStockMovement } from "../src/lib/voice/stock-command.ts";

test("stock commands share one multilingual delta parser", () => {
  const cases: Array<[string, string, number]> = [
    ["añade 50 gramos a Amnesia Haze", "amnesia haze", 50],
    ["aumenta stock de Amnesia Haze en 50 gramos", "amnesia haze", 50],
    ["stock Amnesia Haze suma 2,50 gramos", "amnesia haze", 2.5],
    ["quita 5 gramos de Amnesia Haze", "amnesia haze", -5],
    ["togli 2 grammi da Amnesia Haze", "da amnesia haze", -2],
    ["Amnesia Haze menos 10 gramos", "amnesia haze", -10],
  ];
  for (const [spoken, name, delta] of cases)
    assert.deepEqual(parseVoiceStockMovement(spoken), { name, delta }, spoken);
});

test("stock parser rejects absolute or ambiguous commands and imprecise amounts", () => {
  for (const phrase of [
    "pon el stock a 200",
    "stock Amnesia",
    "quiero ver stock",
    "crea producto Amnesia stock 50",
    "añade 2.123 gramos a Amnesia",
    "quita 0 gramos de Amnesia",
  ]) assert.equal(parseVoiceStockMovement(phrase), null, phrase);
});

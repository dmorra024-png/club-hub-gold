import test from "node:test";
import assert from "node:assert/strict";
import { resolveVoiceUtterance as resolve } from "../src/lib/voice-intents.ts";
import { contextualProductDictation } from "../src/lib/product-form-voice.ts";
test("member navigation aliases share a typed command; ambiguous text never executes", () => {
  for (const t of [
    "Crear socio",
    "Nuevo socio",
    "Registrar un socio",
    "Quiero dar de alta un socio",
    "Creare un socio",
  ])
    assert.deepEqual(resolve(t, "/"), { kind: "command", text: "Crear socio" });
  assert.equal(resolve("abrir caja o producto", "/").kind, "uncertain");
  assert.equal(resolve("hola cosas sin sentido", "/").kind, "uncertain");
  assert.deepEqual(resolve("Caja", "/"), { kind: "command", text: "Abrir caja" });
  for (const t of ["Guardar socio", "Cobrar pedido", "Anular operación"])
    assert.equal(resolve(t, "/").kind, "uncertain");
  for (const t of ["Terminar", "Detener escucha", "Stop Snoop", "Smetti di ascoltare"])
    assert.equal(resolve(t, "/soci/nuovo").kind, "stop");
});
test("contextual product fields return a patch and resolve only club categories", () => {
  assert.deepEqual(
    contextualProductDictation(
      "Nombre Cuaderno, categoría Material, precio diez euros con cincuenta",
      [{ id: "club-a-material", name: "Material", unit_type: "unit", is_smokeable: false }],
    ),
    { name: "Cuaderno", category_id: "club-a-material", sell_price: 10.5 },
  );
  assert.equal(contextualProductDictation("categoría Desconocida", []), null);
  assert.deepEqual(contextualProductDictation("precio cinco euros con veinte", []), {
    sell_price: 5.2,
  });
});

test("continuous endpoint tolerates a pause inside a phrase and ignores low noise", async () => {
  const { SpeechEndpoint } = await import("../src/lib/speech-endpoint.ts");
  const speech = new SpeechEndpoint(0, 2000);
  speech.sample(0.1, 100);
  speech.sample(0.1, 250);
  assert.equal(speech.sample(0.005, 1800), null);
  assert.equal(speech.sample(0.1, 1850), null);
  speech.sample(0.1, 2000);
  assert.equal(speech.sample(0.005, 3900), null);
  assert.equal(speech.sample(0.005, 4000), "speech-end");
  const noise = new SpeechEndpoint(0, 2000);
  for (let t = 0; t < 12000; t += 120) assert.equal(noise.sample(0.005, t), null);
  assert.equal(noise.sample(0.005, 12000), "no-speech");
});

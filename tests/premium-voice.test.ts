import test from "node:test";
import assert from "node:assert/strict";
import { premiumVoiceIntent as intent } from "../src/lib/premium-voice.ts";
test("premium navigation preserves names and selects existing screens", () => {
  assert.deepEqual(intent("Buscar producto Amnesia Haze"), {
    to: "/productos",
    productQuery: "Amnesia Haze",
  });
  assert.deepEqual(intent("Buscar producto Café Especial."), {
    to: "/productos",
    productQuery: "Café Especial",
  });
  for (const command of ["Últimas actividades", "Ver historial", "Actividad reciente"])
    assert.equal(intent(command)?.to, "/actividades");
  for (const command of ["Ver caja de hoy", "Mostrar la caja de hoy", "caja hoy"])
    assert.equal(intent(command)?.cashReport, true);
  assert.deepEqual(intent("Escanear socio"), { to: "/soci/gestisci", search: { scanner: true } });
  assert.equal(intent("Ver stock")?.to, "/productos");
  assert.deepEqual(intent("Abrir caja", "/soci/nuovo"), { to: "/caja" });
  assert.equal(intent("Crear producto Libreta, categoría Material")?.productCreate, true);
});
test("navigation never guesses a member, submits payments or interprets distribution quantities", () => {
  assert.deepEqual(intent("Hacer pedido"), { to: "/soci/gestisci", requiresMember: true });
  assert.equal(intent("Confirmar y cobrar"), null);
  assert.equal(intent("Añadir tres gramos de Amnesia Haze al pedido"), null);
  assert.equal(intent("Hacer pedido", "/soci/00000000-0000-4000-8000-000000000001/pedido"), null);
});

test("every premium destination remains gated by the existing club permission checks", async () => {
  const { voiceIntentAllowed } = await import("../src/lib/administrative-voice.ts");
  const { parseAccountAccess } = await import("../src/lib/access-context.ts");
  const none = parseAccountAccess({
    role: "collaborator",
    status: "active",
    clubId: "club-a",
    permissions: [],
  });
  for (const command of [
    "Escanear socio",
    "Crear producto",
    "Buscar producto Libreta",
    "Ver stock",
    "Ver caja de hoy",
  ]) {
    assert.equal(voiceIntentAllowed(none, intent(command)!.to), false, command);
  }
  const granted = parseAccountAccess({
    role: "collaborator",
    status: "active",
    clubId: "club-a",
    permissions: ["manage_members", "manage_products", "use_cash"],
  });
  for (const command of ["Escanear socio", "Crear producto", "Ver caja de hoy"])
    assert.equal(voiceIntentAllowed(granted, intent(command)!.to), true);
  assert.equal(voiceIntentAllowed({ ...granted, status: "suspended" }, "/productos"), false);
  assert.equal(voiceIntentAllowed({ ...granted, role: "super_admin" }, "/productos"), false);
});

test("spoken amounts preserve cents and correct only the requested draft field", async () => {
  const { voiceMoney, productFormVoice } = await import("../src/lib/product-form-voice.ts");
  for (const [spoken, value] of [
    ["diez euros con cincuenta", 10.5],
    ["cinco euros con veinte", 5.2],
    ["cinco euros con cinco", 5.05],
    ["quattro euro e cinquanta", 4.5],
    ["10,50", 10.5],
  ] as const)
    assert.equal(voiceMoney(spoken), value);
  assert.equal(voiceMoney("cinco euros con ciento veinte"), null);
  assert.deepEqual(productFormVoice("No, el precio es cinco euros con veinte", []), {
    sell_price: 5.2,
  });
  assert.deepEqual(productFormVoice("No, precio de compra cuatro euro e cinquanta", []), {
    buy_price: 4.5,
  });
  const fields = productFormVoice(
    "Crea un producto Libreta en categoría Material, precio diez euros con cincuenta, stock veinticinco unidades",
    [{ id: "material", name: "Material", unit_type: "unit", is_smokeable: false }],
  );
  assert.equal(fields?.sell_price, 10.5);
  assert.equal(fields?.stock, 25);
  assert.equal(fields?.name, "Libreta");
});

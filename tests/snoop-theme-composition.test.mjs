import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const management = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const socio = readFileSync(new URL("../apps/socio/styles.css", import.meta.url), "utf8");
const choices = readFileSync(new URL("../src/lib/snoop-themes.ts", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/components/SnoopLayout.tsx", import.meta.url), "utf8");
const ids = ["navy-gold","graphite-copper","aubergine-amethyst","petrol-titanium",
             "ivory-champagne","ruby-gold","emerald-gold"];
test("all seven branded themes have not only colors but their own card shape in both apps", () => {
  for (const id of ids) {
    assert.match(choices, new RegExp('"'+id+'"\\s*:'));
    assert.ok(management.includes('[data-snoop-theme="'+id+'"] .premium-cash'), "Management identity absent: "+id);
    assert.ok(socio.includes('[data-snoop-theme="'+id+'"] .carnet'), "Socio identity absent: "+id);
  }
});
test("desktop layout, active navigation and member QR are preserved", () => {
  assert.match(management,/\.snoop-desktop-rail\{/);
  assert.match(layout,/Escanear socio para dispensación/);
  assert.match(layout,/snoop:voice-toggle/);
  assert.match(layout,/\/soci\/gestisci/);
  assert.ok(!layout.includes("CLUB MANAGEMENT"), "Removed unwanted subtitle must not return");
});
test("readable light design and scannable white QR retained", () => {
  assert.match(socio,/\.qr-frame\{[^}]*background:#fff!important/s);
  assert.match(socio, /\[data-snoop-theme="ivory-champagne"\]/);
});

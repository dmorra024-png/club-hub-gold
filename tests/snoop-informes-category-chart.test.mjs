import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const view = readFileSync("src/routes/_authenticated/ajustes.informes.tsx", "utf8");
const style = readFileSync("src/styles.css", "utf8");
test("category chart has no outside labels clipped on mobile", () => {
  assert.ok(view.includes('labelLine={false}'));
  assert.ok(view.includes('label={false}'));
  assert.ok(view.includes('className="snoop-informes-category-legend"'));
  assert.ok(view.includes('className="snoop-informes-category-name"'));
  assert.ok(view.includes("maximumFractionDigits: 1"));
  assert.ok(style.includes(".snoop-informes-category-item"));
});
test("preserves existing source data and club-selected theme", () => {
  assert.ok(view.includes('ChartCard title="Ingresos por categoría"'));
  assert.ok(view.includes("byCategory.reduce("));
  assert.ok(view.includes("var(--snoop-panel)"));
  assert.ok(view.includes("PIE_COLORS[index % PIE_COLORS.length]"));
  assert.ok(view.includes("Stock bajo (menos de 10)"));
});

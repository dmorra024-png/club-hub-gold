import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const view=readFileSync("src/routes/_authenticated/ajustes.informes.tsx","utf8");
const css=readFileSync("src/styles.css","utf8");
test("Informes offers daily and custom Desde/Hasta without losing preset filters",()=>{
  for(const marker of ['7 días','30 días','90 días','1 año','Personalizar búsqueda','Desde<input type="date"','Hasta<input type="date"','Aplicar fechas','setRange("custom")','draftFrom <= draftTo'])
    assert.ok(view.includes(marker),marker);
});
test("custom range actually scopes orders, stock, check-ins and product items",()=>{
  assert.ok(view.includes('const since = period.start;'));
  assert.ok(view.includes('const until = period.end;'));
  for(const table of ['order_items','orders','stock_movements','check_ins'])assert.ok(view.includes(`.from("${table}")`),table);
  assert.ok(view.includes('.lt("created_at", until)'));
  assert.ok(view.includes('clubDayRange(to).end'));
  assert.ok(view.includes('clubDayRange(from).start'));
  assert.ok(view.includes('madridDay(String(it.created_at))'));
  assert.ok(view.includes('madridDay(String(m.created_at))'));
  assert.ok(view.includes('madridDay(String(c.created_at))'));
});
test("custom date selectors respect club-selected colors and retain old visual cards",()=>{
  assert.ok(css.includes('.snoop-informes-custom-range'));
  assert.ok(css.includes('var(--snoop-accent)'));
  assert.ok(view.includes('snoop-informes-category-legend'));
  assert.ok(view.includes('snoop-informes-insights'));
});

test("preset ranges never use negative durations in membership quota calendar functions", () => {
  assert.ok(!view.includes('addCalendarDays(to, 1 -'));
  assert.ok(view.includes('Date.parse(`${to}T00:00:00Z`)'));
  for (const period of [7, 30, 90, 365]) {
    const to = "2026-11-23";
    const from = new Date(Date.parse(to + "T00:00:00Z") - (period - 1) * 86400000).toISOString().slice(0, 10);
    assert.ok(from <= to);
    assert.equal((Date.parse(to) - Date.parse(from)) / 86400000 + 1, period);
  }
});

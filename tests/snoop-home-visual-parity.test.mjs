import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const css=readFileSync("src/styles.css","utf8");
const menu=readFileSync("src/routes/_authenticated/ajustes.personalizaciones.tsx","utf8");
const shell=readFileSync("src/components/SnoopLayout.tsx","utf8");
const themes=readFileSync("src/lib/snoop-themes.ts","utf8");
test("all management routes share the premium SNOOP shell and home graphic system",()=>{
 assert.ok(shell.includes('premium-shell snoop-unified-shell'));
 assert.ok(css.includes('SNOOP 2026 — Home visual language across every Gestionale page'));
 for(const rule of ['.premium-shell.snoop-unified-shell .premium-page-heading h1','--snoop-surface-glow','--snoop-edge-glow',
 '.premium-main:not(.snoop-approved-home)','font-family:"Snoop Cash"','var(--snoop-accent)','var(--snoop-panel)']){
  assert.ok(css.includes(rule),rule);
 }
});
test("club personalization page has luminous menu cards with same home font and icons",()=>{
 assert.ok(menu.includes('contentClassName="snoop-club-customize"'));
 for(const name of ["snoop-settings-card","snoop-settings-icon","snoop-settings-title","snoop-settings-desc","snoop-settings-chevron"])
  assert.ok(menu.includes(name)&&css.includes("."+name),name);
 for(const route of ['/ajustes/cuotas','/ajustes/monedero','/ajustes/socios','/ajustes/dispositivos','/ajustes/tema-visual'])
  assert.ok(menu.includes(route),route);
});
test("all seven club theme palettes are retained and no theme is forcibly replaced",()=>{
 for(const id of ['navy-gold','graphite-copper','aubergine-amethyst','petrol-titanium','ivory-champagne','ruby-gold','emerald-gold'])
  assert.ok(themes.includes('"'+id+'"'),id);
 assert.ok(css.includes('var(--snoop-accent-light)'));
 assert.ok(css.includes('var(--snoop-canvas)'));
 assert.ok(!menu.includes('saveClubTheme('));
});
test("style changes preserve safe inputs, focus, responsive sizes and motion accessibility",()=>{
 assert.ok(css.includes('font-size:16px'));
 assert.ok(css.includes('focus-visible'));
 assert.ok(css.includes('prefers-reduced-motion:reduce'));
 assert.ok(css.includes('@media(max-width:385px)'));
 assert.ok(css.includes('pointer-events:none'));
});

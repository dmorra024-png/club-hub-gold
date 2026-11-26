import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=p=>readFileSync(p,"utf8");
const shell=file("src/components/SnoopLayout.tsx");
const css=file("src/styles.css");
test("SNOOP Home style is applied to shared management layout across routes",()=>{
 assert.ok(shell.includes("premium-shell snoop-unified-shell"));
 assert.ok(shell.includes('document.body.classList.add("snoop-management-ui")'));
 assert.ok(shell.includes('document.body.classList.remove("snoop-management-ui")'));
 assert.ok(css.includes("management-wide visual parity V2"));
 for(const x of ["--snoop-ui-surface","--snoop-ui-edge","--snoop-ui-shadow",
   ".premium-main:not(.snoop-approved-home)","var(--snoop-accent)",
   'font-family:"Snoop Cash"',"table tbody tr:hover","[role=\"combobox\"]",
   "input[type=\"checkbox\"]","input[type=\"radio\"]","premium-menu",
   "premium-header-brand","premium-bottom-nav"])assert.ok(css.includes(x),x);
});
test("dialogs and confirm windows follow Home without breaking mobile sheets",()=>{
 for(const path of ["src/components/ui/dialog.tsx","src/components/ui/alert-dialog.tsx"])
  assert.ok(file(path).includes("snoop-premium-dialog"),path);
 assert.ok(file("src/components/ui/sheet.tsx").includes("snoop-premium-sheet"));
 assert.ok(file("src/components/ui/drawer.tsx").includes("snoop-premium-drawer"));
 assert.ok(css.includes("body.snoop-management-ui .snoop-premium-dialog"));
 assert.ok(css.includes("body.snoop-management-ui :is(.snoop-premium-sheet,.snoop-premium-drawer)"));
 assert.ok(css.includes("max-height:min(88dvh,900px)"));
 assert.ok(css.includes("overflow-y:auto"));
});
test("authenticated super admin and suspended club screens are themed",()=>{
 assert.ok(file("src/components/PlatformLayout.tsx").includes("snoop-platform-visual"));
 assert.ok(file("src/routes/_authenticated/club-status.tsx").includes("snoop-club-status-visual"));
 assert.ok(css.includes(":is(.snoop-platform-visual,.snoop-club-status-visual)"));
});
test("all seven existing curated palettes, mobile inputs and access controls remain intact",()=>{
 const themes=file("src/lib/snoop-themes.ts");
 for(const name of ["navy-gold","graphite-copper","aubergine-amethyst","petrol-titanium","ivory-champagne","ruby-gold","emerald-gold"])
  assert.ok(themes.includes('"'+name+'"'));
 assert.ok(css.includes("font-size:16px"));
 assert.ok(css.includes("prefers-reduced-motion:reduce"));
 assert.ok(shell.includes('permission: "use_cash"'));
 assert.ok(shell.includes('permission: "manage_members"'));
 assert.ok(file("src/routes/_authenticated/soci.$id.pedido.tsx").includes("walletCheckout"));
});

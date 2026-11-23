import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");
const index=read("src/routes/_authenticated/ajustes.index.tsx");
const menu=read("src/routes/_authenticated/ajustes.personalizaciones.tsx");
const monedero=read("src/routes/_authenticated/ajustes.monedero.tsx");
const tema=read("src/routes/_authenticated/ajustes.tema-visual.tsx");
test("Ajustes shows one new admin-only Personalizaciones club entry",()=>{
 assert.ok(index.includes('to="/ajustes/personalizaciones"'));
 assert.ok(index.includes('title="Personalizaciones club"'));
 assert.ok(index.includes('{isAdmin && <>'));
 for(const x of ['to="/ajustes/cuotas"','to="/ajustes/socios"','to="/ajustes/dispositivos"','<ClubWalletSettingsPanel />','<ClubThemeSettingsPanel />'])
  assert.ok(!index.includes(x),x);
 assert.ok(index.includes('to="/ajustes/colaboradores"'));
 assert.ok(index.includes('to="/ajustes/informes"'));
 assert.ok(index.includes('to="/perfil"'));
});
test("Personalizaciones club links to all five existing club settings",()=>{
 for(const x of ["/ajustes/cuotas","/ajustes/monedero","/ajustes/socios","/ajustes/dispositivos","/ajustes/tema-visual"])
  assert.ok(menu.includes(x),x);
 for(const label of ["Cuotas","Monedero","Socios","Dispositivos","Tema visual"])
  assert.ok(menu.includes('title:"'+label+'"'),label);
 assert.ok(menu.includes("if(!isAdmin)"));
});
test("Monedero activation and theme panels reused in dedicated admin-only pages",()=>{
 assert.ok(monedero.includes("<ClubWalletSettingsPanel/>"));
 assert.ok(tema.includes("<ClubThemeSettingsPanel/>"));
 assert.ok(monedero.includes('if(!isAdmin)'));
 assert.ok(tema.includes('if(!isAdmin)'));
 for(const page of [monedero,tema])assert.ok(page.includes('to="/ajustes/personalizaciones"'));
});
test("legacy settings routes remain available for old deep links and no financial logic changed",()=>{
 for(const name of ["cuotas","socios","dispositivos"]){
  const code=read("src/routes/_authenticated/ajustes."+name+".tsx");
  assert.ok(code.includes('createFileRoute("/_authenticated/ajustes/'+name+'")'));
 }
});

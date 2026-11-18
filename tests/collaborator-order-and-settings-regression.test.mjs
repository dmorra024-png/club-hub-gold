import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const order=readFileSync(new URL('../src/routes/_authenticated/soci.$id.pedido.tsx',import.meta.url),'utf8');
const nav=readFileSync(new URL('../src/components/SnoopLayout.tsx',import.meta.url),'utf8');
const ajustes=readFileSync(new URL('../src/routes/_authenticated/ajustes.index.tsx',import.meta.url),'utf8');
test('cash orders do not require wallet status or wallet permission',()=>{
 assert.match(order,/const payingWallet=paymentChoice==="wallet"/);
 assert.doesNotMatch(order,/if \(!walletState \|\| walletStatusError \|\| walletUncertain\)/);
 assert.match(order,/disabled=\{!cart\.length \|\| busy \|\| walletUncertain \|\| \(paymentChoice==="wallet"/);
 assert.match(order,/if\(payingWallet && \(!walletState \|\| walletStatusError/);
});
test('Ajustes visible to club collaborator while restricted tiles stay admin-only',()=>{
 assert.match(nav,/to: "\/ajustes", label: "Ajustes", icon: Settings \}/);
 assert.match(ajustes,/\{isAdmin && <>/);
 assert.match(ajustes,/\{can\("view_reports"\) && <Tile/);
 assert.match(ajustes,/<Tile to="\/perfil"/);
 assert.doesNotMatch(ajustes,/!isAdmin\) nav\(\{ to: "\/" \}\)/);
});

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const load=p=>readFileSync(resolve(root,p),'utf8');
for(const p of ['main.js','sw.js']){
  const result=spawnSync(process.execPath,['--check',resolve(root,p)],{encoding:'utf8'});
  assert.equal(result.status,0,`${p}: ${result.stderr}`);
}
const html=load('index.html'), css=load('styles.css'), code=load('main.js'),sw=load('sw.js');
const manifest=JSON.parse(load('manifest.webmanifest'));
assert.equal(manifest.display,'standalone');
assert.equal(manifest.name,'SNOOP Socio');
assert.match(html,/name="viewport"/);
assert.match(html,/manifest\.webmanifest/);
assert.match(css,/--gold:#e5bc78/);
assert.match(code,/snoop-wordmark\.svg/);
assert.match(sw,/snoop-wordmark\.svg/);
for(const critical of ['Mis clubes','Registrarme','Iniciar sesión','Saldo monedero','Vincula tu carnet'])assert.ok(code.includes(critical),`Missing UI: ${critical}`);
assert.match(code,/credentials:'include'/);
assert.match(code,/cache:'no-store'/);
assert.match(code,/URL\.revokeObjectURL/);
// The member's printed/digital QR is permanent. Backgrounding or switching
// pages must not revoke or silently replace it. Logout still calls stopQr().
assert.match(code,/if\(!document\.hidden&&state\.page==='carnet'&&!state\.qrUrl\)/);
assert.doesNotMatch(code,/if\(document\.hidden\)stopQr/);
assert.ok(code.includes("case'logout':try{") && code.includes('resetClub();'));
assert.match(code,/state\.clubs\.find\(c=>c\.id===id\)/);
assert.match(code,/response\.status===404\|\|response\.status===503/);
assert.doesNotMatch(code,/\\blocalStorage\\s*[.\\[]/);
assert.doesNotMatch(code,/service_role|SUPABASE_SERVICE_ROLE|DEEPGRAM_API_KEY/);
assert.match(sw,/u\.pathname\.includes\('\/api\/'\)/);
assert.doesNotMatch(sw,/caches\.match\(e\.request\).*api/);
console.log('SNOOP Socio static isolation and syntax checks: PASS (no backend or real device tested)');

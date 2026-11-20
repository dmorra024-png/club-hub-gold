import test from'node:test';
import assert from'node:assert/strict';
import{readdir,readFile}from'node:fs/promises';
import{dirname,join}from'node:path';
import{fileURLToPath}from'node:url';
import{spawnSync}from'node:child_process';
const root=dirname(fileURLToPath(import.meta.url));
test('release build exposes ONLY PWA client assets, never server modules or SQL',async()=>{
 const run=spawnSync(process.execPath,[join(root,'build-public.mjs')],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const names=(await readdir(join(root,'dist'))).sort();
 assert.deepEqual(names,['approved-ui.css','chakra-petch-latin-600.woff2','icon.svg','index.html','main.js','manifest.webmanifest','snoop-wordmark.svg','styles.css','sw.js']);
 for(const name of names.filter(n=>!n.endsWith('.woff2')))assert.doesNotMatch(await readFile(join(root,'dist',name),'utf8'),/SOCIO_QR_SIGNING_KEY_BASE64|SUPABASE_SERVICE_ROLE|DEEPGRAM_API_KEY|service_role/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Script} from 'node:vm';
test('offline preview is standalone and scripts load AFTER app DOM, without real credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'snoop-offline-demo-'));
 try{
  const output=join(dir,'SNOOP-Socio-Demo.html');
  const result=spawnSync(process.execPath,['apps/socio/build-offline-demo.mjs',output],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const html=await readFile(output,'utf8');
  assert(html.indexOf('<div id="app"')<html.indexOf('<script>'));
  assert.match(html,/MODO DEMO/);
  assert.match(html,/socio.demo@snoop.test/);
  assert.match(html,/SnoopDemo2026!/);
  assert.match(html,/NO VÁLIDO PARA ESCANEAR/);
  assert.match(html,/Mis clubes/);
  assert.match(html,/Saldo disponible/);
  assert.doesNotMatch(html,/<script[^>]+src=/);
  assert.doesNotMatch(html,/navigator\.serviceWorker\.register/);
  assert.doesNotMatch(html,/SUPABASE_SERVICE_ROLE_KEY|DEEPGRAM_API_KEY|sb_secret_/);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  assert.equal(scripts.length,2);
  scripts.forEach(js=>new Script(js));
 }finally{await rm(dir,{recursive:true,force:true});}
});

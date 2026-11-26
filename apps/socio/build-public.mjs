/**
 * Safe static asset packaging for isolated SNOOP Socio Worker.
 * Only this explicit list can ever be served to visitors. No server source, SQL,
 * service_role secrets, tests, or Club Management source enters dist/.
 */
import {mkdir,cp,rm,readdir,readFile}from'node:fs/promises';
import {dirname,join}from'node:path';
import{fileURLToPath}from'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const dist=join(root,'dist');
const names=['index.html','styles.css','main.js','manifest.webmanifest','sw.js','icon.svg','snoop-wordmark.svg'];
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
for(const name of names){
 const source=join(root,name);const content=await readFile(source,'utf8');
 if(/(?:service_role|SUPABASE_SERVICE_ROLE|DEEPGRAM_API_KEY|SOCIO_QR_SIGNING_KEY_BASE64)/.test(content))
  throw Error('Sensitive marker found in public asset '+name);
 await cp(source,join(dist,name));
}
const files=(await readdir(dist)).sort();
if(files.join('|')!==names.slice().sort().join('|'))throw Error('PUBLIC_ASSET_ALLOWLIST_MISMATCH');
console.log('SNOOP Socio public assets:',files.join(', '));

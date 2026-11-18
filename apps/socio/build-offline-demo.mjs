/**
 * Build a SINGLE HTML file for offline evaluation. Never ship in the real PWA.
 * Scripts run only after the #app element exists, preventing the blank screen
 * caused by injecting the app script at the top of the document.
 */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const out=resolve(process.argv[2]||join(root,'../../.sandbox/snoop-socio-download/SNOOP-Socio-Demo.html'));
const read=name=>readFile(join(root,name),'utf8');
const [css,adapter,main]=await Promise.all(['styles.css','offline-demo-adapter.js','main.js'].map(read));
const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
const source=main
  .replaceAll('sessionStorage','globalThis.__snoopDemoStorage')
  .replace("if('serviceWorker'in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{});}","// Offline demo: no service worker, no network cache");
if(source.includes('navigator.serviceWorker.register')||!source.includes('globalThis.__snoopDemoStorage'))
 throw Error('OFFLINE_DEMO_ISOLATION_FAILED');
const html=`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#111c34">
<title>SNOOP Socio · DEMO OFFLINE</title>
<style>${css}</style>
</head><body>
<div style="position:relative;z-index:20;background:#79531a;color:#fff;text-align:center;padding:10px;font:bold 14px system-ui">MODO DEMO · DATOS FICTICIOS · SIN ACCESO REAL</div>
<div id="app" aria-live="polite"></div>
<script>${escapeScript(adapter)}</script>
<script>${escapeScript(source)}</script>
</body></html>`;
if(html.indexOf('<div id="app"')>html.indexOf('<script>'))throw Error('APP_SCRIPT_BEFORE_DOM');
await mkdir(dirname(out),{recursive:true});
await writeFile(out,html);
console.log('Built offline preview:',out);

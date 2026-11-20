// Public shell caching only. Never cache authenticated pages, QR images, API or wallet.
const VERSION='snoop-socio-approved-ui-20261120-v1';
const SHELL=['./','./index.html','./styles.css','./approved-ui.css','./main.js','./icon.svg','./snoop-wordmark.svg','./manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.includes('/api/')||e.request.headers.has('Authorization'))return;
if(!SHELL.some(x=>new URL(x,self.registration.scope).pathname===u.pathname))return;
e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(VERSION).then(c=>c.put(e.request,copy)).catch(()=>{});}return r;}).catch(()=>caches.match(e.request)));});

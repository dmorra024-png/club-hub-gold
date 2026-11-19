/** Browser acceptance tests for the REAL Socio client, not the offline HTML mock.
 * Uses a local HTTP server and intercepted synthetic API only. No production
 * Supabase/Cloudflare credentials, network writes, or deployment.
 */
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright-core';
import assert from 'node:assert/strict';
const dir=resolve(fileURLToPath(new URL('./',import.meta.url)));
const screenshotDir=resolve('.sandbox/socio-browser');
const idA='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',idB='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
const testEmail='socio@example.test', testPassword='SyntheticPassword123!';
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{
  const name=new URL(req.url,'http://127.0.0.1').pathname;
  const file=name==='/'?'index.html':name.replace(/^\//,'');
  if(!['index.html','styles.css','main.js','manifest.webmanifest','sw.js','icon.svg','snoop-wordmark.svg'].includes(file)){
   res.writeHead(404);return res.end();
  }
  const body=await readFile(join(dir,file));
  res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store'});
  res.end(body);
 }catch{res.writeHead(500);res.end();}
});
const listen=()=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close=()=>new Promise(resolve=>server.close(resolve));
function qrPreview(club){
 // Synthetic image is never a scannable/valid signed QR.
 return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#fff"/><text x="100" y="100" font-family="Arial" text-anchor="middle">SYNTHETIC '+(club===idA?'A':'B')+'</text></svg>';
}
async function setupApi(page){
 let loggedIn=false;
 let firstClubLinked=false;
 let secondClubLinked=false;
 let holdNextClubAWallet=false,releaseHeldWallet=null,heldWalletReached=null;
 const heldWalletHit=new Promise(resolve=>{heldWalletReached=resolve;});
 const hits=[];
 await page.route('**/api/socio/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname.slice('/api/socio'.length);
  const method=request.method();
  hits.push(method+' '+path);
  const response=(data,status=200,type='application/json')=>
   route.fulfill({status,contentType:type,headers:{'cache-control':'no-store'},body:type==='application/json'?JSON.stringify(data):data});
  if(path==='/auth/login'&&method==='POST'){
   let input={};try{input=JSON.parse(request.postData()||'{}')}catch{}
   loggedIn=input.email===testEmail&&input.password===testPassword;
   return response(loggedIn?{authenticated:true}:{message:'Credenciales incorrectas.'},loggedIn?200:401);
  }
  if(path==='/auth/logout'){loggedIn=false;return response({signedOut:true});}
  if(path==='/auth/refresh')return response({authenticated:false},401);
  if(path==='/auth/signup')return response({message:'Signup de prueba deshabilitado'},503);
  if(!loggedIn)return response({message:'Not authorized'},401);
  if(path==='/me')return response({authenticated:true,email:testEmail,emailVerified:true});
  if(path==='/memberships/sync')return response({message:'Código requerido'},409);
  if(path==='/link/claim'&&method==='POST'){
   let input={};try{input=JSON.parse(request.postData()||'{}')}catch{}
   if(input.code==='123456'&&!firstClubLinked){firstClubLinked=true;return response({linked:true});}
   if(input.code==='654321'&&firstClubLinked&&!secondClubLinked){secondClubLinked=true;return response({linked:true});}
   return response({message:'Código inválido o utilizado'},403);
  }
  if(path==='/clubs')return response({clubs:[
   ...(firstClubLinked?[{id:idA,name:'SNOOP Club Demo Palma',status:'active',walletEnabled:true}]:[]),
   ...(secondClubLinked?[{id:idB,name:'SNOOP Club Demo Madrid',status:'active',walletEnabled:true}]:[])
  ]});
  const match=path.match(/^\/clubs\/([0-9a-f-]+)\/(carnet|carnet\/qr|wallet|wallet\/movements)$/i);
  if(!match)return response({message:'No route'},404);
  const club=match[1],action=match[2];
  if(![idA,idB].includes(club))return response({message:'Not found'},404);
  if(action==='carnet')return response({clubId:club,memberNumber:club===idA?'00124':'00077',active:true});
  if(action==='carnet/qr')return response(qrPreview(club),200,'image/svg+xml');
  if(action==='wallet'){
   if(club===idA&&holdNextClubAWallet){
    holdNextClubAWallet=false;
    heldWalletReached();
    await new Promise(resolve=>{releaseHeldWallet=resolve;});
    // Deliberately stale answer: it must never reappear after logout/login.
    return response({balanceCents:99999});
   }
   return response({balanceCents:club===idA?2575:6000});
  }
  if(action==='wallet/movements')return response({items:[{
   deltaCents:club===idA?-825:6000,
   balanceCents:club===idA?2575:6000,
   createdAt:'2026-11-17T18:35:00Z',
   label:club===idA?'Aportación Palma':'Recarga Madrid'
  }]});
  return response({},404);
 });
 return {hits,heldWalletHit,holdNextWallet:()=>{holdNextClubAWallet=true;},releaseWallet:()=>{releaseHeldWallet?.();}};
}
async function runBrowser(browserType,deviceName,options){
 const browser=await browserType.launch({headless:true});
 const context=await browser.newContext({
  viewport:options.viewport,deviceScaleFactor:2,isMobile:options.mobile,
  hasTouch:true,serviceWorkers:'block',locale:'es-ES'
 });
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const fixture=await setupApi(page),hits=fixture.hits;
 const port=server.address().port;
 try{
  await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Bienvenido'}).waitFor({timeout:15000});
  // Incorrect password must not expose any club or member data.
  await page.locator('input[name="email"]').fill(testEmail);
  await page.locator('input[name="password"]').fill('wrong-password');
  await page.getByRole('button',{name:'Iniciar sesión'}).click();
  await page.getByText('Credenciales incorrectas.').waitFor();
  assert.equal(await page.getByText('SNOOP Club Demo Palma').count(),0);
  await page.locator('input[name="email"]').fill(testEmail);
  await page.locator('input[name="password"]').fill(testPassword);
  await page.getByRole('button',{name:'Iniciar sesión'}).click();
  await page.getByRole('heading',{name:'Introduce tu código'}).waitFor({timeout:15000});
  assert.equal(hits.some(h=>h==='POST /memberships/sync'),false);
  await page.locator('input[name="code"]').fill('000000');
  await page.getByRole('button',{name:'Activar mi carnet'}).click();
  await page.getByText('Código inválido o utilizado').waitFor();
  await page.locator('input[name="code"]').fill('123456');
  await page.getByRole('button',{name:'Activar mi carnet'}).click();
  await page.getByRole('heading',{name:'SNOOP Club Demo Palma'}).waitFor({timeout:15000});
  await page.getByText('Socio Nº 00124').waitFor();
  await page.getByText('25,75 €').waitFor();
  await page.locator('img[alt="QR permanente de socio"]').waitFor();
  await mkdir(screenshotDir,{recursive:true});
  await page.screenshot({path:join(screenshotDir,deviceName+'-carnet.png'),fullPage:true});
  // Financial readings must be limited to the currently selected club.
  await page.getByRole('button',{name:'Movimientos'}).click();
  await page.getByText('Aportación Palma').waitFor();
  assert.equal(await page.getByText('Recarga Madrid').count(),0);
  await page.getByRole('button',{name:'Volver al carnet'}).click();
  await page.getByRole('button',{name:'Mis clubes'}).click();
  await page.getByRole('heading',{name:'Mis clubes'}).waitFor();
  // The second club cannot be linked by matching an email alone.
  assert.equal(await page.getByRole('button',{name:/SNOOP Club Demo Madrid/}).count(),0);
  await page.getByRole('button',{name:'Vincular otro club'}).click();
  await page.getByRole('heading',{name:'Introduce tu código'}).waitFor();
  await page.locator('input[name="code"]').fill('654321');
  await page.getByRole('button',{name:'Activar mi carnet'}).click();
  await page.getByRole('button',{name:'Mis clubes'}).click();
  await page.getByRole('button',{name:/SNOOP Club Demo Madrid/}).click();
  await page.getByRole('heading',{name:'SNOOP Club Demo Madrid'}).waitFor();
  await page.getByText('Socio Nº 00077').waitFor();
  await page.getByText('60,00 €').waitFor();
  assert.equal(await page.getByText('Socio Nº 00124').count(),0);
  await page.getByRole('button',{name:'Movimientos'}).click();
  await page.getByText('Recarga Madrid').waitFor();
  assert.equal(await page.getByText('Aportación Palma').count(),0);
  await page.screenshot({path:join(screenshotDir,deviceName+'-wallet.png'),fullPage:true});
  await page.getByRole('button',{name:'Volver al carnet'}).click();
  await page.getByRole('button',{name:'Mis clubes'}).click();
  fixture.holdNextWallet();
  await page.getByRole('button',{name:/SNOOP Club Demo Palma/}).click();
  await fixture.heldWalletHit;
  await page.getByRole('button',{name:'Menú'}).click();
  await page.getByRole('button',{name:'Cerrar sesión'}).click();
  await page.getByRole('heading',{name:'Bienvenido'}).waitFor();
  assert.equal(await page.getByText('60,00 €').count(),0);
  assert.equal(await page.locator('input[name="email"]').inputValue(),'');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('snoop-socio-last-club')),null);
  assert.equal(await page.getByText('SNOOP Club Demo Palma').count(),0);
  assert.equal(await page.getByText('SNOOP Club Demo Madrid').count(),0);
  // A new login for the same club must not accept a late balance from the
  // previous authenticated session, even if the club ID happens to match.
  await page.locator('input[name="email"]').fill(testEmail);
  await page.locator('input[name="password"]').fill(testPassword);
  await page.getByRole('button',{name:'Iniciar sesión'}).click();
  await page.getByRole('heading',{name:'SNOOP Club Demo Palma'}).waitFor();
  await page.getByText('25,75 €').waitFor();
  fixture.releaseWallet();
  await page.waitForTimeout(250);
  assert.equal(await page.getByText('999,99 €').count(),0,'Stale wallet response leaked across sign-out');
  await page.getByText('25,75 €').waitFor();
  // Every route is intercepted; no live project endpoints can be contacted.
  assert(hits.some(h=>h==='GET /clubs/'+idB+'/wallet'));
  assert(hits.some(h=>h==='POST /link/claim'));
  assert(hits.some(h=>h==='GET /clubs/'+idA+'/wallet'));
  assert.equal(errors.length,0,'Browser JS errors: '+errors.join('; '));
  console.log('PASS',deviceName,'login, 2 clubs, QR, wallet, movements, logout; network mocked');
 }finally{await browser.close();}
}
async function testUnavailableBackend(browserType,deviceName){
 const browser=await browserType.launch({headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/socio/**',route=>route.fulfill({
  status:503,contentType:'application/json',
  body:JSON.stringify({message:'Servicio temporalmente indisponible'})
 }));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Bienvenido'}).waitFor();
  await page.getByText('Servicio de socios aún no disponible.').waitFor({timeout:12000});
  assert.equal(await page.getByRole('button',{name:'Iniciar sesión'}).isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS',deviceName,'unavailable backend reports clear error, not blank screen');
 }finally{await browser.close();}
}
const port=await listen();
try{
 await runBrowser(chromium,'android-chromium',{viewport:{width:390,height:844},mobile:true});
 await runBrowser(webkit,'iphone-webkit',{viewport:{width:375,height:812},mobile:true});
 await testUnavailableBackend(chromium,'android-chromium');
 await testUnavailableBackend(webkit,'iphone-webkit');
}finally{await close();}

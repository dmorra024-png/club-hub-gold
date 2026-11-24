import test from'node:test';
import assert from'node:assert/strict';
import{handleSocioWorker}from'./worker.mjs';
const origin='https://socio.example.test';
test('worker serves static PWA only through assets binding and does not require private keys',async()=>{
 const expected=new Response('SNOOP',{
  status:200,headers:{'content-type':'text/html'}
 });
 const response=await handleSocioWorker(new Request(origin+'/'),{ASSETS:{fetch:async()=>expected}});
 assert.equal(response.status,200);assert.equal(await response.text(),'SNOOP');
});
test('member API fails closed without separate staging secrets, no fallback to admin server',async()=>{
 const r=await handleSocioWorker(new Request(origin+'/api/socio/clubs'),{ASSETS:{fetch:async()=>{throw Error('must not serve API from assets')}}});
 assert.equal(r.status,503);assert.match(r.headers.get('cache-control'),/no-store/);
});
test('malformed signing key denies API rather than serving data',async()=>{
 const r=await handleSocioWorker(new Request(origin+'/api/socio/clubs'),{
  SOCIO_SUPABASE_URL:'https://example.supabase.co',SOCIO_SUPABASE_PUBLISHABLE_KEY:'public-test',
  SOCIO_ORIGIN:origin,SOCIO_QR_SIGNING_KEY_BASE64:'invalid'
 });
 assert.equal(r.status,503);
});
test('non-GET non-API requests cannot access assets',async()=>{
 const r=await handleSocioWorker(new Request(origin+'/',{method:'POST'}),{ASSETS:{fetch:async()=>new Response('unexpected')}});
 assert.equal(r.status,404);
});

// DEMO ONLY: This script is injected in a standalone HTML preview, NEVER served
// by the production PWA. Authentication, balances and cards are fabricated.
(() => {
 const email='socio.demo@snoop.test', password='SnoopDemo2026!';
 const clubA='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
 const clubB='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
 const clubs=[
   {id:clubA,name:'SNOOP Club Demo Palma',status:'active',walletEnabled:true},
   {id:clubB,name:'SNOOP Club Demo Madrid',status:'active',walletEnabled:true}
 ];
 const data={
  [clubA]:{memberNumber:'00124',balanceCents:2575,items:[
   {deltaCents:-825,balanceCents:2575,createdAt:'2026-11-17T18:35:00Z',label:'Aportación (DEMO)'},
   {deltaCents:3400,balanceCents:3400,createdAt:'2026-11-17T12:10:00Z',label:'Recarga (DEMO)'}]},
  [clubB]:{memberNumber:'00077',balanceCents:6000,items:[
   {deltaCents:6000,balanceCents:6000,createdAt:'2026-11-16T11:40:00Z',label:'Recarga (DEMO)'}]}
 };
 let signedIn=false;
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{
   status,headers:{'content-type':'application/json','cache-control':'no-store'}
 });
 const originalFetch=globalThis.fetch?.bind(globalThis);
 globalThis.fetch=async(request,options={})=>{
  const url=typeof request==='string'?request:request?.url||'';
  if(!url.startsWith('/api/socio')) {
   if(typeof originalFetch==='function')return originalFetch(request,options);
   throw Error('OFFLINE_DEMO_NO_NETWORK');
  }
  const path=url.slice('/api/socio'.length);
  let body={};try{body=JSON.parse(options.body||'{}')}catch{}
  if(path==='/auth/login'){
   signedIn=String(body.email||'').toLowerCase()===email&&body.password===password;
   return signedIn?reply({authenticated:true}):reply({message:'Credenciales incorrectas'},401);
  }
  if(path==='/auth/logout'){signedIn=false;return reply({signedOut:true});}
  if(path==='/auth/refresh')return reply({authenticated:false},401);
  if(path==='/auth/signup')return reply({message:'Registro no disponible en DEMO'},503);
  if(!signedIn)return reply({message:'Inicia sesión en la DEMO'},401);
  if(path==='/me')return reply({authenticated:true,email,emailVerified:true});
  if(path==='/memberships/sync')return reply({synced:true,linkedCount:2});
  if(path==='/clubs')return reply({clubs});
  if(path==='/link/claim')return reply({message:'Vinculación real deshabilitada en DEMO'},503);
  const match=path.match(/^\/clubs\/([0-9a-f-]+)\/(carnet|carnet\/qr|wallet|wallet\/movements)$/i);
  if(!match)return reply({message:'Ruta demo no disponible'},404);
  const item=data[match[1]];if(!item)return reply({message:'Club no disponible'},404);
  switch(match[2]){
   case 'carnet':return reply({clubId:match[1],active:true,memberNumber:item.memberNumber});
   case 'wallet':return reply({balanceCents:item.balanceCents});
   case 'wallet/movements':return reply({items:item.items});
   case 'carnet/qr':{
    // This is an unmistakably non-scannable preview, never a QR credential.
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">'
     +'<rect width="400" height="400" rx="12" fill="#fff"/>'
     +'<rect x="25" y="25" width="350" height="350" rx="10" fill="#f0f4f9" stroke="#23395b" stroke-width="5"/>'
     +'<text x="200" y="180" text-anchor="middle" font-family="Arial" font-size="42" font-weight="bold" fill="#23395b">SNOOP</text>'
     +'<text x="200" y="230" text-anchor="middle" font-family="Arial" font-size="32" fill="#946f26">DEMO</text>'
     +'<text x="200" y="300" text-anchor="middle" font-family="Arial" font-size="17" fill="#a32727">NO VÁLIDO PARA ESCANEAR</text></svg>';
    return new Response(svg,{status:200,headers:{'content-type':'image/svg+xml','cache-control':'no-store'}});
   }
  }
 };
 // Local file content:// may disallow sessionStorage; a volatile in-memory shim
 // is injected as demoStorage and used by the preview app only.
 const values=new Map();
 globalThis.__snoopDemoStorage={
  getItem:key=>values.get(key)??null,
  setItem:(key,value)=>values.set(key,String(value)),
  removeItem:key=>values.delete(key)
 };
})();

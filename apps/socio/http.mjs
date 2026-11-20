/**
 * Isolated SNOOP Socio HTTP adapter. This module has no network listener.
 * Bind authenticate() only on a separately deployed Socio origin. Never import
 * it into SNOOP's existing management router without explicit review.
 *
 * All actors come from server-verified sessions; never from request JSON.
 */
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store, private',
 'x-content-type-options':'nosniff',...headers}
});
const fail=(code,status)=>json({code,message:status===401?'Inicia sesión para continuar.':
 status===404?'Recurso no disponible.':status===503?'Servicio de socios aún no disponible.':'Operación no autorizada.'},status);
const ROUTE_BASE='/api/socio';
const uuid='([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})';
const clubPattern=new RegExp('^/clubs/'+uuid+'/(carnet|carnet/qr|wallet|wallet/movements)$');
const noStore={'cache-control':'private, no-store, max-age=0','pragma':'no-cache','x-content-type-options':'nosniff'};
function base64(u8){let binary='';for(const b of u8)binary+=String.fromCharCode(b);return btoa(binary);}
function isTrustedMutation(request,origin){
 const incoming=request.headers.get('origin');
 if(incoming!==origin)return false;
 const site=request.headers.get('sec-fetch-site');
 if(site&&site!=='same-origin'&&site!=='none')return false;
 return request.headers.get('content-type')?.toLowerCase().startsWith('application/json')===true;
}
function statusOf(e){const status=e?.status;return Number.isInteger(status)&&[400,401,403,404,409,422,429,503].includes(status)?status:503;}
/**
 * authenticate(request) returns server-derived, email-confirmed actor or null;
 * no raw session tokens or API keys may be returned to browser.
 * renderQrPng(token) -> Uint8Array / ArrayBuffer bytes of a QR image.
 * auth.* handlers must set secure, HttpOnly, SameSite cookies themselves.
 */
export function makeSocioHttpHandler({service,serviceFactory,authenticate,renderQrPng,renderQrSvg,auth={},origin}){
 if((!service&&typeof serviceFactory!=='function')||typeof authenticate!=='function'||typeof origin!=='string'||new URL(origin).origin!==origin)throw Error('SOCIO_HTTP_NOT_CONFIGURED');
 return async function handle(request){
  try{
   const url=new URL(request.url);
   if(url.origin!==origin)return fail('INVALID_ORIGIN',403);
   if(!url.pathname.startsWith(ROUTE_BASE+'/'))return fail('NOT_FOUND',404);
   const path=url.pathname.slice(ROUTE_BASE.length),method=request.method.toUpperCase();
   if(!['GET','POST'].includes(method))return fail('METHOD_NOT_ALLOWED',403);
   if(method==='POST'&&!isTrustedMutation(request,origin))return fail('CSRF_REJECTED',403);
   if(path.startsWith('/auth/')){
    const name=path.slice('/auth/'.length);
    const action=name==='signup'?'signup':name==='login'?'login':name==='activate'?'activate':name==='logout'?'logout':name==='refresh'?'refresh':null;
    if(method!=='POST'||!action||typeof auth[action]!=='function')return fail('AUTH_NOT_IMPLEMENTED',503);
    const input=(name==='logout'||name==='refresh')?{}:await parseJson(request,3200);
    const response=await auth[action]({request,input});
    if(!(response instanceof Response))throw Error('AUTH_HANDLER_INVALID');
    return response;
   }
   const actor=await authenticate(request);
   if(!actor||actor.accountType!=='socio'||actor.emailVerified!==true)return fail('AUTH_REQUIRED',401);
   const scopedService=serviceFactory?await serviceFactory(actor):service;
   if(!scopedService)return fail('SERVICE_UNAVAILABLE',503);
   if(method==='GET'&&path==='/me')return json({authenticated:true,email:actor.email,emailVerified:true});
   if(method==='GET'&&path==='/clubs')return json(await scopedService.clubs(actor));
   if(method==='POST'&&path==='/memberships/sync'){
    await parseJson(request,200);
    return json(await scopedService.syncClubs(actor));
   }
   if(method==='POST'&&path==='/link/claim'){
    const input=await parseJson(request,500);
    return json(await scopedService.linkMembership(actor,input.code));
   }
   const match=method==='GET'?path.match(clubPattern):null;
   if(!match)return fail('NOT_FOUND',404);
   const [,clubId,resource]=match;
   if(resource==='carnet')return json(await scopedService.card(actor,clubId));
   if(resource==='wallet')return json(await scopedService.wallet(actor,clubId));
   if(resource==='wallet/movements')return json(await scopedService.walletMovements(actor,clubId));
   if(resource==='carnet/qr'){
    if(typeof renderQrPng!=='function'&&typeof renderQrSvg!=='function')return fail('QR_RENDERER_NOT_CONFIGURED',503);
    // QR issuance is authorized and scoped before any rendering.
    const proposal=typeof scopedService.stableQr==='function' ? await scopedService.stableQr(actor,clubId) : await scopedService.qr(actor,clubId);
    if(typeof renderQrSvg==='function'){
     const svg=await renderQrSvg(proposal.token);
     // The SVG encoder is a trusted backend component; still reject active markup.
     if(typeof svg!=='string'||svg.length>200000||!svg.trimStart().startsWith('<svg')||
      /<\s*(?:script|foreignObject|iframe|image)\b/i.test(svg)||
      /\bon[a-z]+\s*=/i.test(svg))throw Error('QR_SVG_INVALID');
     return new Response(svg,{status:200,headers:{...noStore,'content-type':'image/svg+xml; charset=utf-8'}});
    }
    const png=await renderQrPng(proposal.token);
    const bytes=png instanceof Uint8Array?png:png instanceof ArrayBuffer?new Uint8Array(png):null;
    if(!bytes||bytes.length<20||bytes.length>500000||
     bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71||
     bytes[4]!==13||bytes[5]!==10||bytes[6]!==26||bytes[7]!==10)
     throw Error('QR_PNG_INVALID');
    return new Response(bytes,{status:200,headers:{...noStore,'content-type':'image/png'}});
   }
   return fail('NOT_FOUND',404);
  }catch(e){return fail(e?.code||'SERVICE_UNAVAILABLE',statusOf(e));}
 };
}
async function parseJson(request,maxBytes){
 const raw=await request.text();
 if(raw.length>maxBytes)throw Object.assign(Error('BODY_TOO_LARGE'),{status:400});
 try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OBJECT_REQUIRED');return value;}
 catch{throw Object.assign(Error('INVALID_JSON'),{status:400});}
}

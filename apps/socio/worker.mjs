/**
 * Independent SNOOP Socio Cloudflare Worker entrypoint.
 * STAGING ONLY. No deployment from CI; no permission to modify production DB.
 * Assets built from the explicit public whitelist, never from this source folder.
 */
import {createSocioApplication} from './bootstrap.mjs';
const unavailable=()=>new Response(JSON.stringify({message:'Servicio de socios no configurado.'}),{
  status:503,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}
});
function decodeSecret(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw Error('SOCIO_QR_KEY_MISSING');
 const decoded=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
 if(decoded.length!==32)throw Error('SOCIO_QR_KEY_LENGTH');
 return decoded;
}
export async function handleSocioWorker(request,env){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/socio/')){
  if(env?.ASSETS&&request.method==='GET')return env.ASSETS.fetch(request);
  return new Response('Not found',{status:404});
 }
 // All API operations fail closed until a reviewed dedicated member environment is configured.
 if(!env?.SOCIO_SUPABASE_URL||!env?.SOCIO_SUPABASE_PUBLISHABLE_KEY||
    !env?.SOCIO_ORIGIN||!env?.SOCIO_QR_SIGNING_KEY_BASE64)return unavailable();
 try{
  const qrSigningSecret=decodeSecret(env.SOCIO_QR_SIGNING_KEY_BASE64);
  const renderQrSvg=async token=>{
   // Only trusted server-side signed QR payloads arrive here, never user-supplied text.
   const lib=await import('qrcode');
   return lib.default.toString(token,{type:'svg',width:400,margin:2,errorCorrectionLevel:'M'});
  };
  const handle=createSocioApplication({
   supabaseUrl:env.SOCIO_SUPABASE_URL,
   publishableKey:env.SOCIO_SUPABASE_PUBLISHABLE_KEY,
   origin:env.SOCIO_ORIGIN,
   qrSigningSecret,
   renderQrSvg
  });
  return await handle(request);
 }catch{
  // Deliberately avoid returning environment data, internal errors or tokens.
  return unavailable();
 }
}
export default {fetch:handleSocioWorker};

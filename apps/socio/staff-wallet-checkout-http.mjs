/**
 * Mount only after approved migrations, full cash reconciliation, and live
 * manager app integration. This is an isolated staff endpoint; NOT exposed in
 * SNOOP Socio PWA. Cross-club checks live in the JWT-scoped SQL RPC.
 */
import {createSupabaseAtomicWalletOrderRepository} from './supabase-wallet-checkout.mjs';
const fail=(code,status=503)=>Object.assign(new Error(code),{code,status});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}
});
export function createStaffWalletCheckoutHttp({origin,authenticateStaff,supabaseUrl,publishableKey,fetcher=fetch}){
 if(typeof origin!=='string'||new URL(origin).origin!==origin||
    !origin.startsWith('https://')||typeof authenticateStaff!=='function')
    throw Error('WALLET_CHECKOUT_CONFIG_REQUIRED');
 return async function handle(request){
  try{
   const url=new URL(request.url);
   if(url.origin!==origin)return reply({code:'WALLET_CHECKOUT_ORIGIN_DENIED'},403);
   const action=url.pathname==='/api/snoop-wallet/checkout'?'order':
     url.pathname==='/api/snoop-wallet/cancel'?'cancel':null;
   if(!action)return reply({code:'WALLET_CHECKOUT_NOT_FOUND'},404);
   if(request.method!=='POST')return reply({code:'WALLET_CHECKOUT_METHOD_DENIED'},405);
   if(request.headers.get('origin')!==origin||
      !['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||
      !request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
     return reply({code:'WALLET_CHECKOUT_CSRF_DENIED'},403);
   const staff=await authenticateStaff(request);
   if(staff?.accountType!=='staff'||staff.verified!==true)
     return reply({code:'WALLET_CHECKOUT_AUTH_REQUIRED'},401);
   const raw=await request.text();
   if(raw.length>25000)return reply({code:'WALLET_CHECKOUT_BODY_TOO_LARGE'},400);
   let body;
   try{body=JSON.parse(raw);}catch{return reply({code:'WALLET_CHECKOUT_BAD_JSON'},400);}
   if(!body||Array.isArray(body)||typeof body!=='object'||body.confirmed!==true)
     return reply({code:'WALLET_CHECKOUT_CONFIRMATION_REQUIRED'},409);
   // The only accepted payload flags are operation fields and explicit
   // confirmation. Identity, club and permissions are server-derived.
   const {confirmed,...fields}=body;
   const repository=createSupabaseAtomicWalletOrderRepository({
    supabaseUrl,publishableKey,staff,fetcher
   });
   const result=await repository.execute(action,fields);
   return reply(result);
  }catch(error){
   const status=[400,401,403,404,409,503].includes(error?.status)?error.status:503;
   const code=typeof error?.code==='string'?error.code:'WALLET_CHECKOUT_UNAVAILABLE';
   return reply({code},status);
  }
 };
}

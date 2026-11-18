/**
 * STAGING-ONLY staff wallet HTTP entrypoint. NOT connected to management router.
 * The host MUST return staff from a freshly verified JWT and the real database
 * role/permission lookup, never client JSON, metadata or stale role claims.
 * Actual commits require the atomic, audited repository implementation.
 */
import {createWalletCommands} from './wallet-operations.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}
});
const reject=(code,status)=>json({code},status);
const routes=new Map([['topup','topup'],['spend','spend'],['refund','refund']]);
export function createStaffWalletHttp({origin,authenticateStaff,repository,repositoryFactory}){
 if(typeof origin!=='string'||new URL(origin).origin!==origin||
    typeof authenticateStaff!=='function'||(!repository&&typeof repositoryFactory!=='function'))throw Error('WALLET_HTTP_CONFIG_REQUIRED');
 return async function walletHttp(request){
  try{
   const url=new URL(request.url),path=url.pathname;
   if(url.origin!==origin)return reject('WALLET_INVALID_ORIGIN',403);
   if(!path.startsWith('/api/snoop-wallet/'))return reject('WALLET_NOT_FOUND',404);
   if(request.method!=='POST')return reject('WALLET_METHOD_DENIED',405);
   if(request.headers.get('origin')!==origin||
      !['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||
      !request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return reject('WALLET_CSRF_DENIED',403);
   const action=path.slice('/api/snoop-wallet/'.length);
   if(!routes.has(action))return reject('WALLET_NOT_FOUND',404);
   const staff=await authenticateStaff(request);
   if(!staff||staff.accountType!=='staff'||staff.verified!==true)
    return reject('WALLET_AUTH_REQUIRED',401);
   const payload=await request.text();
   if(payload.length>2000)return reject('WALLET_BODY_TOO_LARGE',400);
   let body;try{body=JSON.parse(payload);}catch{return reject('WALLET_BAD_JSON',400);}
   if(!body||typeof body!=='object'||Array.isArray(body))return reject('WALLET_BAD_JSON',400);
   // No extra fields and no client-provided role/actor/permissions.
   const allowed=new Set(['clubId','memberId','operationId','amountCents','confirmed','orderId','reversalOf','cashSessionId']);
   if(Object.keys(body).some(k=>!allowed.has(k)))return reject('WALLET_UNEXPECTED_INPUT',400);
   // Fresh verified staff identity must bind each repository to the actor's
   // own access JWT. Never reuse a privileged repository across staff sessions.
   const scopedRepository=repositoryFactory?await repositoryFactory(staff):repository;
   const commands=createWalletCommands({repository:scopedRepository});
   const result=await commands.commit(staff,{...body,kind:action});
   return json(result);
  }catch(e){
   const status=[400,401,403,404,409,503].includes(e?.status)?e.status:503;
   const code=typeof e?.code==='string'?e.code:'WALLET_UNAVAILABLE';
   return reject(code,status);
  }
 };
}

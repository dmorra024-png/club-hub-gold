/**
 * SNOOP Socio Worker application composition.
 * This is NOT imported from SNOOP's current Worker and is NOT deployed.
 * Caller supplies a trusted server-only authorizeSocioUser() DB policy and QR PNG
 * renderer; absent dependencies fail closed rather than exposing data.
 */
import {createSupabaseSocioAuth} from './auth-supabase.mjs';
import {createSocioRlsRepository} from './supabase-rls.mjs';
import {makeSocioService} from './service.mjs';
import {makeSocioHttpHandler} from './http.mjs';
import {createSocioRolePolicy} from './socio-role.mjs';
export function createSocioApplication({supabaseUrl,publishableKey,origin,qrSigningSecret,authorizeSocioUser,renderQrPng,fetcher=fetch}){
 if(typeof renderQrPng!=='function')throw Error('SOCIO_PRODUCTION_ADAPTERS_REQUIRED');
 const checkSocio=typeof authorizeSocioUser==='function'?authorizeSocioUser:createSocioRolePolicy({url:supabaseUrl,publishableKey,fetcher});
 const auth=createSupabaseSocioAuth({url:supabaseUrl,publishableKey,authorizeSocioUser:checkSocio,fetcher});
 return makeSocioHttpHandler({
  origin,auth,authenticate:auth.authenticate,renderQrPng,
  serviceFactory:actor=>{
   if(!actor?.accessToken||!actor?.userId)throw Error('UNVERIFIED_SESSION');
   const repository=createSocioRlsRepository({
    url:supabaseUrl,publishableKey,accessToken:actor.accessToken,actorId:actor.userId,fetcher
   });
   return makeSocioService({repository,signingSecret:qrSigningSecret});
  }
 });
}

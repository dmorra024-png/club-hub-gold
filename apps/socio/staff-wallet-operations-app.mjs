/** Unmounted staff financial router (topup, spend, refund).
 * API accepts only server-verified staff identities and uses their own JWT.
 * The independent management Worker must explicitly mount it later,
 * after order-settlement/write-path integration and production review.
 */
import {createStaffWalletHttp} from './wallet-http.mjs';
import {createSupabaseWalletOperationsRepository} from './supabase-wallet-operations.mjs';
export function createStaffWalletOperationsApp({
 origin,supabaseUrl,publishableKey,authenticateStaff,fetcher=fetch
}){
 if(typeof authenticateStaff!=='function')throw Error('STAFF_AUTH_REQUIRED');
 return createStaffWalletHttp({
  origin,authenticateStaff,
  repositoryFactory:async staff=>createSupabaseWalletOperationsRepository({
   supabaseUrl,publishableKey,staff,fetcher
  })
 });
}

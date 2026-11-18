/** Separate unmounted staff-only Wallet recharge app. Not member PWA.
 * The embedding management Worker MUST supply authenticateStaff(request)
 * that validates the staff JWT against Supabase Auth + real club roles.
 * No direct browser-to-RPC shortcut, no stored service role.
 */
import {createStaffWalletHttp} from './wallet-http.mjs';
import {createSupabaseWalletTopupRepository} from './supabase-wallet-topup.mjs';
export function createStaffWalletTopupApp({
 origin,supabaseUrl,publishableKey,authenticateStaff,fetcher=fetch
}){
 if(typeof authenticateStaff!=='function')throw Error('STAFF_AUTHENTICATOR_REQUIRED');
 return createStaffWalletHttp({
  origin,authenticateStaff,
  repositoryFactory:async staff=>
   createSupabaseWalletTopupRepository({supabaseUrl,publishableKey,staff,fetcher})
 });
}

/**
 * Verify the opaque Socio QR against the exact AES-GCM format used by
 * apps/socio/domain.mjs. Never expose the signing key to the browser.
 */
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const AAD=new TextEncoder().encode("snoop-socio-card:v2");
const decode=(encoded:string)=>Uint8Array.from(atob(encoded.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-encoded.length%4)%4)),s=>s.charCodeAt(0));
const fail=()=>{throw new Error("QR privado inválido, caducado o ya utilizado.");};
export async function verifySnoopSocioToken(token:string,clubId:string,secretBase64:string):Promise<{memberId:string;nonce:string}>{
 try{
  if(!UUID.test(clubId)||typeof token!=="string"||token.length>1200||
     !/^ssc2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return fail();
  const keyBytes=Uint8Array.from(atob(secretBase64),c=>c.charCodeAt(0));
  if(keyBytes.length!==32)return fail();
  const [_,ivEncoded,cipherEncoded]=token.split(".");
  const iv=decode(ivEncoded),cipher=decode(cipherEncoded);
  if(iv.length!==12||cipher.length<32||cipher.length>1000)return fail();
  const key=await crypto.subtle.importKey("raw",keyBytes,"AES-GCM",false,["decrypt"]);
  const raw=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:AAD},key,cipher);
  const claims=JSON.parse(new TextDecoder().decode(raw));
  const now=Math.floor(Date.now()/1000);
  if(claims?.aud!=="snoop-socio"||claims.v!==2||claims.clubId!==clubId||
     !UUID.test(claims.memberId)||!Number.isSafeInteger(claims.iat)||
     !Number.isSafeInteger(claims.exp)||claims.exp<=now||claims.iat>now+2||
     claims.exp-claims.iat>60||typeof claims.nonce!=="string"||
     !/^[A-Za-z0-9_-]{20,30}$/.test(claims.nonce))return fail();
  return {memberId:claims.memberId,nonce:claims.nonce};
 }catch{return fail();}
}

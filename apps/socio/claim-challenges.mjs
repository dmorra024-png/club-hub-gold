/** SNOOP Socio: issue short-lived, single-use membership claim challenges.
 * Never infer membership from e-mail equality. Issuance is staff-approved and
 * scoped to the staff's own club. The repository MUST store a HASH only.
 * A separate DB transaction must atomically claim/revoke the hash and create
 * the verified link; no frontend or offline validation is authoritative.
 */
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const isId=value=>typeof value==='string'&&UUID.test(value);
const fail=(code,status=403)=>Object.assign(new Error(code),{code,status});
const encoder=new TextEncoder();
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
export async function hashClaimCode(code){
 if(typeof code!=='string'||!/^[a-f0-9]{48}$/.test(code))throw fail('CLAIM_FORMAT_INVALID',400);
 const hash=await crypto.subtle.digest('SHA-256',encoder.encode('snoop-socio-claim:v1:'+code));
 return hex(new Uint8Array(hash));
}
export function createMembershipClaimIssuer({repository,now=()=>Date.now(),randomBytes=n=>crypto.getRandomValues(new Uint8Array(n))}){
 if(typeof repository?.memberIsClaimable!=='function'||typeof repository?.createClaimChallenge!=='function')
  throw Error('CLAIM_REPOSITORY_REQUIRED');
 return{
  async issue(staff,{clubId,memberId}={}){
   if(!isId(clubId)||!isId(memberId))throw fail('CLAIM_SCOPE_INVALID',400);
   if(!staff||staff.accountType!=='staff'||staff.verified!==true||!isId(staff.userId)||
      staff.clubId!==clubId||staff.canManageMembers!==true)
    throw fail('CLAIM_ISSUER_FORBIDDEN');
   if(await repository.memberIsClaimable(clubId,memberId)!==true)
    throw fail('CLAIM_MEMBERSHIP_UNAVAILABLE',404);
   const bytes=randomBytes(24);
   if(!(bytes instanceof Uint8Array)||bytes.length!==24)throw Error('CLAIM_RANDOM_SOURCE_INVALID');
   const code=hex(bytes),codeHash=await hashClaimCode(code);
   const expiresAt=now()+10*60*1000;
   if(await repository.createClaimChallenge({
    clubId,memberId,issuedBy:staff.userId,codeHash,expiresAt
   })!==true)throw fail('CLAIM_ISSUANCE_UNAVAILABLE',503);
   // Display exactly once to authorized staff. Do not log, email automatically,
   // put in browser URL, or store plaintext in any database.
   return{code,expiresAt};
  }
 };
}

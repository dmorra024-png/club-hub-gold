// Isolated, no-DB SNOOP Socio domain helpers. All authorizations need server-side verification.
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const te=new TextEncoder(),td=new TextDecoder();
const isUuid=x=>typeof x==='string'&&UUID.test(x);
const b64=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const un64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const cryptoApi=()=>{if(!globalThis.crypto?.subtle||!globalThis.crypto.getRandomValues)throw Error('CRYPTO_UNAVAILABLE');return globalThis.crypto;};
const key=async secret=>{if(!(secret instanceof Uint8Array)||secret.length<32)throw Error('WEAK_SECRET');return cryptoApi().subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);};
export function verifiedClubMemberships(authUserId,links,memberships){
 if(!isUuid(authUserId))return[];
 const owned=new Set((links||[]).filter(l=>l.authUserId===authUserId&&l.status==='verified'&&isUuid(l.clubId)&&isUuid(l.memberId)).map(l=>l.clubId+':'+l.memberId));
 return (memberships||[]).filter(m=>owned.has(m.clubId+':'+m.memberId)&&m.active===true&&!m.revokedAt).map(m=>({clubId:m.clubId,memberId:m.memberId,clubName:m.clubName,memberNumber:m.memberNumber,walletEnabled:m.walletEnabled===true}));
}
export function verifyMembershipClaim({userId,emailVerified,challenge,membership,now=Date.now()}){
 if(!isUuid(userId)||emailVerified!==true)return {ok:false,reason:'AUTH'};
 if(!challenge||!membership||!isUuid(challenge.clubId)||!isUuid(challenge.memberId)||challenge.clubId!==membership.clubId||challenge.memberId!==membership.memberId)return{ok:false,reason:'SCOPE'};
 if(challenge.used||challenge.revoked||challenge.staffApproved!==true||!Number.isFinite(challenge.expiresAt)||challenge.expiresAt<=now)return{ok:false,reason:'CHALLENGE'};
 if(membership.active!==true||membership.revokedAt)return{ok:false,reason:'REVOKED'};
 // Email equality alone NEVER grants membership.
 return{ok:true,clubId:challenge.clubId,memberId:challenge.memberId};
}
export async function issueCardQr({clubId,memberId,secret,now=Date.now(),ttl=40}){
 if(!isUuid(clubId)||!isUuid(memberId)||!Number.isSafeInteger(ttl)||ttl<15||ttl>60)throw Error('QR_INPUT');
 const issued=Math.floor(now/1000);
 const nonce=b64(cryptoApi().getRandomValues(new Uint8Array(16)));
 const body=b64(te.encode(JSON.stringify({v:1,aud:'snoop-socio',clubId,memberId,iat:issued,exp:issued+ttl,nonce})));
 const sig=b64(new Uint8Array(await cryptoApi().subtle.sign('HMAC',await key(secret),te.encode(body))));
 return 'ssc1.'+body+'.'+sig;
}
export async function verifyCardQr(token,{clubId,secret,now=Date.now(),memberActive=false}){
 try{
  if(!isUuid(clubId)||typeof token!=='string'||token.length>1200)return{ok:false,reason:'FORMAT'};
  const parts=token.split('.');if(parts.length!==3||parts[0]!=='ssc1'||!/^[A-Za-z0-9_-]+$/.test(parts[1])||!/^[A-Za-z0-9_-]+$/.test(parts[2]))return{ok:false,reason:'FORMAT'};
  const signed=await cryptoApi().subtle.verify('HMAC',await key(secret),un64(parts[2]),te.encode(parts[1]));
  if(!signed)return{ok:false,reason:'SIGNATURE'};
  const p=JSON.parse(td.decode(un64(parts[1]))),t=Math.floor(now/1000);
  if(p.aud!=='snoop-socio'||p.v!==1||!isUuid(p.memberId)||!isUuid(p.clubId)||p.clubId!==clubId)return{ok:false,reason:'SCOPE'};
  if(!Number.isSafeInteger(p.iat)||!Number.isSafeInteger(p.exp)||p.iat>t+2||p.exp<=t||p.exp-p.iat>60)return{ok:false,reason:'EXPIRED'};
  if(memberActive!==true)return{ok:false,reason:'REVOKED'};
  return{ok:true,clubId:p.clubId,memberId:p.memberId,nonce:p.nonce};
 }catch{return{ok:false,reason:'INVALID'};}
}
export function proposeWalletMovement({balance,amount,kind,operationId,seen=[],authorized=false,confirmed=false}){
 if(authorized!==true||confirmed!==true)return{ok:false,reason:'CONFIRMATION'};
 if(!Number.isSafeInteger(balance)||balance<0||!Number.isSafeInteger(amount)||amount<=0||amount>10000000)return{ok:false,reason:'AMOUNT'};
 if(!isUuid(operationId)||!Array.isArray(seen)||seen.includes(operationId))return{ok:false,reason:'IDEMPOTENCY'};
 if(!['topup','spend','refund','adjustment_credit','adjustment_debit'].includes(kind))return{ok:false,reason:'KIND'};
 const delta=(kind==='spend'||kind==='adjustment_debit'?-1:1)*amount;
 const after=balance+delta;
 if(!Number.isSafeInteger(after)||after<0)return{ok:false,reason:'BALANCE'};
 // Pure proposal only. Real write MUST be atomic SQL transaction with RLS, audit and uniqueness.
 return{ok:true,after,entry:{operationId,kind,delta,after}};
}

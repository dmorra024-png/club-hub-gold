// Pure automatic multi-club linking policy. Server must verify Auth email and club enrollment independently.
const id=x=>typeof x==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(x);
export const normalizeVerifiedEmail=x=>{if(typeof x!=='string'||x.length>254)return null;const v=x.normalize('NFC').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?v:null;};
export function planAutomaticLinks({authUserId,verifiedEmail,emailConfirmed,candidates=[]}){
 if(!id(authUserId)||emailConfirmed!==true||!Array.isArray(candidates))return{eligible:[],reviewRequired:false};
 const email=normalizeVerifiedEmail(verifiedEmail);if(!email)return{eligible:[],reviewRequired:false};
 const byClub=new Map();for(const c of candidates){if(!id(c?.clubId)||!id(c?.memberId)||normalizeVerifiedEmail(c.email)!==email)continue;const group=byClub.get(c.clubId)||[];group.push(c);byClub.set(c.clubId,group);}
 const eligible=[];let reviewRequired=false;
 for(const matches of byClub.values()){if(matches.length!==1){reviewRequired=true;continue;}
 const c=matches[0];
 if(c.active!==true||c.revokedAt||c.emailConfirmedAtEnrollment!==true||(c.linkedAuthUserId&&c.linkedAuthUserId!==authUserId)){reviewRequired=true;continue;}
 eligible.push({clubId:c.clubId,memberId:c.memberId,authUserId});
 }
 // Use atomic database insert with uniqueness, idempotency and auditable evidence, NEVER trust client-supplied candidates.
 return{eligible,reviewRequired};
}

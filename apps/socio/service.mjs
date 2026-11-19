import {verifiedClubMemberships,verifyMembershipClaim,issueCardQr,verifyCardQr} from './domain.mjs';
import {planAutomaticLinks,normalizeVerifiedEmail} from './auto-link.mjs';

/**
 * Framework independent server-side Socio business service.
 * All repo methods and actor claims MUST be supplied by authenticated backend adapters.
 * No prod Auth, SQL, HTTP routes, token exposure, or balance writes in this module.
 */
const UUID=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const isUuid=x=>typeof x==='string'&&UUID.test(x);
const error=(code,status=403)=>Object.assign(new Error(code),{code,status});
const verifiedActor=actor=>{
 if(!actor||!isUuid(actor.userId)||actor.emailVerified!==true||actor.accountType!=='socio')throw error('SOCIO_UNAUTHORIZED',401);
 return actor;
};
export function makeSocioService({repository,signingSecret,now=()=>Date.now()}){
 if(!repository||!(signingSecret instanceof Uint8Array)||signingSecret.length<32)throw Error('SOCIO_NOT_CONFIGURED');
 async function owned(actor){
  verifiedActor(actor);
  const [links, memberships]=await Promise.all([
   repository.linksForUser(actor.userId),
   repository.membershipsForUser(actor.userId)
  ]);
  return verifiedClubMemberships(actor.userId,links,memberships);
 }
 async function membership(actor,clubId){
  if(!isUuid(clubId))throw error('CLUB_INVALID',400);
  const list=await owned(actor);
  const item=list.find(m=>m.clubId===clubId);
  if(!item)throw error('MEMBERSHIP_NOT_FOUND',404);
  return item;
 }
 return {
  async clubs(actor){
   const list=await owned(actor);
   const themes=await Promise.all(list.map(async m=>{
    try {
     const id=await repository.themeForClub(m.clubId);
     return ['navy-gold','graphite-copper','aubergine-amethyst',
      'petrol-titanium','ivory-champagne','ruby-gold','emerald-gold'].includes(id)
       ?id:'navy-gold';
    } catch {return 'navy-gold';}
   }));
   return{clubs:list.map((m,i)=>({id:m.clubId,name:m.clubName,status:'active',
    walletEnabled:m.walletEnabled,themeId:themes[i]}))};
  },
  async syncClubs(actor){
   verifiedActor(actor);
   const verifiedEmail=normalizeVerifiedEmail(actor.email);
   if(!verifiedEmail)throw error('VERIFIED_EMAIL_REQUIRED',400);
   // Atomically look up eligible memberships by confirmed email, check uniqueness and
   // insert verified links. The repository must derive candidates from its private DB,
   // never from the browser. Member email confirmation at enrollment is mandatory.
   const result=await repository.autoLinkForVerifiedEmail({
    authUserId:actor.userId,verifiedEmail,emailConfirmed:true,
    nowMs:now(),policy:planAutomaticLinks
   });
   if(!result||!Number.isSafeInteger(result.linkedCount)||result.linkedCount<0)throw error('SYNC_UNAVAILABLE',503);
   return{synced:true,linkedCount:result.linkedCount};
  },
  async linkMembership(actor,code){
   verifiedActor(actor);
   if(typeof code!=='string'||code.length<6||code.length>64||!/^[A-Za-z0-9-]+$/.test(code))throw error('LINK_CODE_INVALID',400);
   // This repository method must validate staff issuance, expiration, single-use, account identity,
   // and membership activation, then consume + insert a link in ONE DB transaction.
   const result=await repository.claimAndConsumeLinkChallenge({code,authUserId:actor.userId,nowMs:now(),policy:verifyMembershipClaim});
   if(!result?.ok)throw error('LINK_NOT_AUTHORIZED',403);
   return{linked:true};
  },
  async card(actor,clubId){
   const item=await membership(actor,clubId);
   return{memberNumber:item.memberNumber,clubId:item.clubId,active:true};
  },
  async qr(actor,clubId){
   const item=await membership(actor,clubId);
   const token=await issueCardQr({clubId:item.clubId,memberId:item.memberId,now:now(),secret:signingSecret,ttl:40});
   return{token,expiresIn:40};
  },
  async wallet(actor,clubId){
   const item=await membership(actor,clubId);
   if(!item.walletEnabled)throw error('WALLET_DISABLED',404);
   // repository must enforce tenant/user scope independently, no caller-provided balance accepted.
   const result=await repository.walletForMember(item.clubId,item.memberId);
   if(!result||!Number.isSafeInteger(result.balanceCents)||result.balanceCents<0)throw error('WALLET_UNAVAILABLE',503);
   return{balanceCents:result.balanceCents};
  },
  async walletMovements(actor,clubId){
   const item=await membership(actor,clubId);
   if(!item.walletEnabled)throw error('WALLET_DISABLED',404);
   const records=await repository.walletMovementsForMember(item.clubId,item.memberId);
   if(!Array.isArray(records))throw error('MOVEMENTS_UNAVAILABLE',503);
   return{items:records.filter(r=>Number.isSafeInteger(r.deltaCents)&&Number.isSafeInteger(r.balanceCents)&&r.balanceCents>=0&&typeof r.createdAt==='string').slice(0,100).map(r=>({deltaCents:r.deltaCents,balanceCents:r.balanceCents,createdAt:r.createdAt,label:String(r.label||'Movimiento').slice(0,120)}))};
  },
  async scan(staff,token){
   if(!staff||staff.accountType!=='staff'||staff.verified!==true||!isUuid(staff.userId)||!isUuid(staff.clubId)||staff.canScan!==true)throw error('SCANNER_UNAUTHORIZED');
   const checked=await verifyCardQr(token,{clubId:staff.clubId,secret:signingSecret,now:now(),memberActive:true});
   if(!checked.ok)throw error('QR_REJECTED');
   // Preferred real adapter: membership, role, current expiry and nonce are
   // verified/consumed together inside one trusted database transaction.
   if(typeof repository.verifyAndConsumeQr==='function'){
    const consumed=await repository.verifyAndConsumeQr({
     clubId:checked.clubId,memberId:checked.memberId,
     nonce:checked.nonce,scannerUserId:staff.userId,
     expiresAt:now()+60_000
    });
    if(consumed!==true)throw error('QR_REJECTED_OR_REPLAY',409);
   }else{
    // Pure in-memory repository compatibility for legacy isolated tests only.
    const valid=await repository.isMemberActive(checked.clubId,checked.memberId);
    if(valid!==true)throw error('MEMBERSHIP_REVOKED');
    if(typeof repository.consumeQrNonce!=='function')
     throw error('QR_REPLAY_PROTECTION_REQUIRED',503);
    const consumed=await repository.consumeQrNonce({
     clubId:checked.clubId,memberId:checked.memberId,
     nonce:checked.nonce,scannerUserId:staff.userId,expiresAt:now()+60_000
    });
    if(consumed!==true)throw error('QR_ALREADY_SCANNED',409);
   }
   return{clubId:checked.clubId,memberId:checked.memberId,valid:true};
  }
 };
}

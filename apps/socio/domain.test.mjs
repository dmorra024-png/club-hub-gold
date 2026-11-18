import test from 'node:test';
import assert from 'node:assert/strict';
import{webcrypto}from'node:crypto';
import{verifiedClubMemberships,verifyMembershipClaim,issueCardQr,verifyCardQr,proposeWalletMovement}from'./domain.mjs';
globalThis.crypto??=webcrypto;
const a='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',b='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4',m='c319b1ed-9389-4c81-9e7f-42f808d95c34',n='437f044d-9c4d-4b95-8672-d2b8c9af3851',u='9d5d3ca0-de23-467b-8ad4-211fce9003b9',other='9ab51fa6-dff9-4d15-a80a-a32295264c8d',secret=new Uint8Array(32).fill(32),now=1800000000000;
test('same account sees separate verified memberships, not other accounts',()=>{
 const links=[{authUserId:u,status:'verified',clubId:a,memberId:m},{authUserId:u,status:'verified',clubId:b,memberId:n},{authUserId:other,status:'verified',clubId:a,memberId:n}];
 const memberships=[{clubId:a,memberId:m,active:true,memberNumber:'1'},{clubId:b,memberId:n,active:true,memberNumber:'2'},{clubId:a,memberId:n,active:true,memberNumber:'SECRET'}];
 assert.deepEqual(verifiedClubMemberships(u,links,memberships).map(x=>x.memberNumber),['1','2']);
});
test('email alone does not link a club; confirmed staff challenge and active membership required',()=>{
 const membership={clubId:a,memberId:m,active:true};
 const challenge={clubId:a,memberId:m,staffApproved:true,expiresAt:now+60000};
 assert.equal(verifyMembershipClaim({userId:u,emailVerified:true,challenge,membership,now}).ok,true);
 assert.equal(verifyMembershipClaim({userId:u,emailVerified:false,challenge,membership,now}).ok,false);
 assert.equal(verifyMembershipClaim({userId:u,emailVerified:true,challenge:{...challenge,staffApproved:false},membership,now}).ok,false);
 assert.equal(verifyMembershipClaim({userId:u,emailVerified:true,challenge:{...challenge,clubId:b},membership,now}).ok,false);
 assert.equal(verifyMembershipClaim({userId:u,emailVerified:true,challenge,membership,now:now+60000}).ok,false);
});
test('QR signature, other-club, inactive membership and expiration rejected',async()=>{
 const qr=await issueCardQr({clubId:a,memberId:m,secret,now,ttl:40});
 assert.match(qr,/^ssc2\./);
 assert.equal(qr.includes(a),false);
 assert.equal(qr.includes(m),false);
 assert.equal(qr.includes(Buffer.from(m).toString('base64url')),false);

 assert.equal((await verifyCardQr(qr,{clubId:a,secret,now:now+1000,memberActive:true})).ok,true);
 assert.equal((await verifyCardQr(qr,{clubId:b,secret,now:now+1000,memberActive:true})).ok,false);
 assert.equal((await verifyCardQr(qr,{clubId:a,secret,now:now+41000,memberActive:true})).ok,false);
 assert.equal((await verifyCardQr(qr,{clubId:a,secret,now:now+1000,memberActive:false})).ok,false);
 const parts=qr.split('.');parts[2]='A'+parts[2].slice(1);
 assert.equal((await verifyCardQr(parts.join('.'),{clubId:a,secret,now,memberActive:true})).ok,false);
});
test('wallet prevents double-operation, unconfirmed write and overdraft',()=>{
 const id='f78e650f-66e1-40af-b1cd-4f8151cfda96',opts={balance:2550,amount:320,kind:'spend',operationId:id};
 assert.equal(proposeWalletMovement(opts).ok,false);
 assert.equal(proposeWalletMovement({...opts,authorized:true,confirmed:true,seen:[id]}).ok,false);
 assert.equal(proposeWalletMovement({...opts,balance:100,authorized:true,confirmed:true}).ok,false);
 assert.deepEqual(proposeWalletMovement({...opts,authorized:true,confirmed:true}),{ok:true,after:2230,entry:{operationId:id,kind:'spend',delta:-320,after:2230}});
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationProposal } from '../src/lib/snoop-conversation.ts';
import { authorizeProposal, proposalSchema } from '../src/lib/voice/agent-settings.server.ts';
import { applicationPorts } from '../src/lib/voice/application-ports.ts';
import { applyDeepgramDraft } from '../src/lib/deepgram-draft-actions.ts';
const access:any={role:'admin',status:'active',clubId:'synthetic',permissions:['manage_members'],clubName:null,clubLogo:null};
const proposal=(member:Record<string,string>)=>({intent:'member',target:'member_create',member,product:{},query:null,declined:[],question:'Revisa los datos',asking:null});
test('member contact email is typed, explicit and never an invented identity/document field',()=>{
 assert(ConversationProposal.safeParse(proposal({email:'synthetic@example.test'})).success);
 for(const email of ['not-an-email','x\n@example.test','a'.repeat(255)+'@example.test'])assert(!ConversationProposal.safeParse(proposal({email})).success);
 assert(!ConversationProposal.safeParse(proposal({dni_number:'FORBIDDEN'})).success);
 assert(Object.hasOwn(proposalSchema.properties.member.properties,'email'));
 assert(!authorizeProposal(proposal({email:'synthetic@example.test'}),{...access,permissions:[]}).ok);
 assert(!authorizeProposal(proposal({email:'synthetic@example.test'}),{...access,status:'suspended'}).ok);
});
test('email draft reaches the scoped form, protects manual correction and rejects stale scope',async()=>{
 let current={first_name:'',last_name:'',email:''};
 const owner='synthetic-contact';
 const remove=applicationPorts.register(owner,'member.form',{snapshot:()=>({...current}),patch:patch=>{current={...current,...patch};}});
 const options={owner,access,navigate:()=>{},path:()=>'/soci/nuovo',current:()=>true,last:{}};
 try{
  const first=await applyDeepgramDraft(proposal({first_name:'Ana',email:'synthetic@example.test'}),options);
  assert.deepEqual(first.applied,['first_name','email']);
  assert.equal(current.email,'synthetic@example.test');
  current.email='manual@example.test';
  const correction=await applyDeepgramDraft(proposal({email:'other@example.test',last_name:'Prueba'}),options);
  assert.deepEqual(correction.skipped,['email']);assert.equal(current.email,'manual@example.test');assert.equal(current.last_name,'Prueba');
  await assert.rejects(applyDeepgramDraft(proposal({email:'stale@example.test'}),{...options,current:()=>false}),/STALE/);

 }finally{remove();}
});

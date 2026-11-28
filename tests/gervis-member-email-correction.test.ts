import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import { applicationPorts, voiceOwner } from "../src/lib/voice/application-ports.ts";
import { ConversationProposal } from "../src/lib/snoop-conversation.ts";
import { gervisBrainPrompt } from "../src/lib/gervis-snoop/brain.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";

const clubId="00000000-0000-4000-8000-000000000001";
const owner=voiceOwner("00000000-0000-4000-8000-000000000002",clubId);
const access:AccountAccess={
  status:"active", role:"admin", clubId, clubName:"Synthetic", clubLogo:null,
  permissions:["manage_members"],
};
const member=(fields:Record<string,string>)=>ConversationProposal.parse({
  intent:"member",target:"member_create",member:fields,product:{},
  query:null,declined:[],question:"",asking:null,
});
test("Gervis corrects a wrong voice-owned email in the SAME registration form, keeping other fields",async()=>{
  const values:Record<string,string>={
    first_name:"Fátima", last_name:"González", birth_date:"1995-02-19", email:"",
  };
  const last:Record<string,Record<string,string>>={};
  let saved=0;
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>true,
    snapshot:()=>({...values}),
    patch:(patch)=>{Object.assign(values,patch);},
  });
  const execute=async(fields:Record<string,string>)=>applyDeepgramDraft(member(fields),{
    access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
    current:()=>true,last,verifyNavigation:true,
  });
  try {
    const first=await execute({email:"fatima.gonzalez.7@example.com"});
    assert.deepEqual(first.applied,["email"]);
    assert.equal(values.email,"fatima.gonzalez.7@example.com");
    const corrected=await execute({email:"fatima.gonzalez7@example.com"});
    assert.deepEqual(corrected.applied,["email"]);
    assert.deepEqual(corrected.skipped,[]);
    assert.equal(values.email,"fatima.gonzalez7@example.com");
    assert.equal(values.first_name,"Fátima");
    assert.equal(values.last_name,"González");
    assert.equal(values.birth_date,"1995-02-19");
    assert.equal(saved,0);
  } finally {remove();}
});

test("Gervis must NOT overwrite a member email that was manually edited after dictation",async()=>{
  const values:Record<string,string>={email:""};
  const last:Record<string,Record<string,string>>={};
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>true,
    snapshot:()=>({...values}),
    patch:(patch)=>{Object.assign(values,patch);},
  });
  const execute=async(email:string)=>applyDeepgramDraft(member({email}),{
    access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
    current:()=>true,last,verifyNavigation:true,
  });
  try {
    await execute("ana.example@example.com");
    values.email="manual@example.com";
    const attempt=await execute("anaexample@example.com");
    assert.deepEqual(attempt.applied,[]);
    assert.deepEqual(attempt.skipped,["email"]);
    assert.equal(values.email,"manual@example.com");
  }finally{remove();}
});

test("Gervis recognizes email punctuation and asks when ambiguous instead of inventing punctuation",()=>{
  const prompt=gervisBrainPrompt({language:"es",today:"2026-11-27",executionEnabled:false,walletEnabled:false});
  assert.match(prompt,/arroba/);
  assert.match(prompt,/Never insert an extra period/);
  assert.match(prompt,/quita el punto antes de la arroba/);
  assert.match(prompt,/If the exact character or its position is uncertain/);
  assert.match(prompt,/KEEP the active member-registration form/);
});

test("Gervis can remove a SINGLE wrongly inserted dot from its own voice email without re-dictating",async()=>{
  const values:Record<string,string>={
    first_name:"Fátima",last_name:"García",birth_date:"1995-02-19",email:"",
  };
  const last:Record<string,Record<string,string>>={};
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>true,snapshot:()=>({...values}),
    patch:(patch)=>{Object.assign(values,patch);},
  });
  const execute=async(proposal:unknown)=>applyDeepgramDraft(proposal,{
    access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
    current:()=>true,last,verifyNavigation:true,
  });
  try {
    await execute(member({email:"fatima.garcia7@example.com"}));
    const correction=await execute({
      intent:"member",target:"member_create",member:{},product:{},query:null,
      declined:[],question:"",asking:null,email_correction:"remove_single_local_dot",
    });
    assert.deepEqual(correction.applied,["email"]);
    assert.equal(values.email,"fatimagarcia7@example.com");
    assert.equal(values.first_name,"Fátima");
    assert.equal(values.last_name,"García");
    assert.equal(values.birth_date,"1995-02-19");
  }finally{remove();}
});

test("Gervis refuses ambiguous dot changes, altered manual emails, and Pilot-mode invocation",async()=>{
  const values:Record<string,string>={email:""};
  const last:Record<string,Record<string,string>>={};
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>true,snapshot:()=>({...values}),
    patch:(patch)=>{Object.assign(values,patch);},
  });
  const execute=async(verifyNavigation:boolean)=>applyDeepgramDraft({
    intent:"member",target:"member_create",member:{},product:{},query:null,
    declined:[],question:"",asking:null,email_correction:"remove_single_local_dot",
  },{
    access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
    current:()=>true,last,verifyNavigation,
  });
  const dictation=async(email:string)=>applyDeepgramDraft(member({email}),{
    access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
    current:()=>true,last,verifyNavigation:true,
  });
  try {
    await dictation("name.with.two.dots@example.com");
    await assert.rejects(execute(true),/SNOOP_EMAIL_CORRECTION_UNCLEAR/);
    assert.equal(values.email,"name.with.two.dots@example.com");
    await dictation("name.one@example.com");
    values.email="manual.one@example.com";
    await assert.rejects(execute(true),/SNOOP_EMAIL_CORRECTION_UNCLEAR/);
    assert.equal(values.email,"manual.one@example.com");
    await assert.rejects(execute(false),/SNOOP_EMAIL_CORRECTION_UNCLEAR/);
  }finally{remove();}
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import { applicationPorts, voiceOwner } from "../src/lib/voice/application-ports.ts";
import { ConversationProposal } from "../src/lib/snoop-conversation.ts";
import { normalizeGervisProposal } from "../src/lib/gervis-snoop/proposal-envelope.ts";
import { spelledSurname } from "../src/lib/gervis-snoop/surname-correction.ts";
import { gervisBrainPrompt } from "../src/lib/gervis-snoop/brain.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";

const clubId="00000000-0000-4000-8000-000000000001";
const owner=voiceOwner("00000000-0000-4000-8000-000000000002",clubId);
const access:AccountAccess={
  status:"active",role:"admin",clubId,clubName:"Synthetic",clubLogo:null,
  permissions:["manage_members"],
};
const draft=(fields:Record<string,string>)=>({
  intent:"member",target:"member_create",member:fields,product:{},
  query:null,declined:[],question:"",asking:null,
});
const spelled=(letters:string[])=>({
  intent:"member",target:"member_create",member:{},product:{},
  query:null,declined:[],question:"",asking:null,
  surname_spelling:{letters},
});

test("Gervis replaces misheard Mechat/Mechatde with exact spoken letters Mechad",async()=>{
  const values:Record<string,string>={
    first_name:"Fátima",last_name:"",birth_date:"1995-07-26",
    email:"test@example.invalid",city:"Palma",
  };
  const last:Record<string,Record<string,string>>={};
  let saves=0;
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>true,snapshot:()=>({...values}),
    patch:(patch)=>{Object.assign(values,patch);},
  });
  const execute=async(proposal:unknown)=>applyDeepgramDraft(
    ConversationProposal.parse(normalizeGervisProposal(proposal)),
    {access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
     current:()=>true,last,verifyNavigation:true},
  );
  try {
    await execute(draft({last_name:"Mechatde"}));
    assert.equal(values.last_name,"Mechatde");
    const result=await execute(spelled(["M","e","c","h","a","d"]));
    assert.deepEqual(result.applied,["last_name"]);
    assert.equal(values.last_name,"Mechad");
    assert.equal(values.first_name,"Fátima");
    assert.equal(values.birth_date,"1995-07-26");
    assert.equal(values.city,"Palma");
    assert.equal(values.email,"test@example.invalid");
    assert.equal(saves,0);
  }finally{remove();}
});

test("Gervis refuses invented letters and malformed privileged corrections",()=>{
  assert.equal(spelledSurname(["M","e","c","h","a","d"]),"Mechad");
  for(const letters of [
    ["M","e","c","h","a","de"],
    ["M","e","c","h","a","."],
    ["M","e","c","h","a","3"],
    ["M"],
  ]) assert.equal(ConversationProposal.safeParse(spelled(letters)).success,false);
  assert.equal(ConversationProposal.safeParse({
    ...spelled(["M","e","c","h","a","d"]),member:{last_name:"Mechatde"},
  }).success,false);
  assert.equal(ConversationProposal.safeParse({
    ...spelled(["M","e","c","h","a","d"]),target:"members",
  }).success,false);
});

test("Gervis preserves manual surname changes and does not permit spelling in legacy Pilot",async()=>{
  const values={last_name:""};
  const last:Record<string,Record<string,string>>={};
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>true,snapshot:()=>({...values}),
    patch:(patch)=>{Object.assign(values,patch);},
  });
  const execute=async(proposal:unknown,verifyNavigation:boolean)=>applyDeepgramDraft(
    ConversationProposal.parse(normalizeGervisProposal(proposal)),
    {access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
     current:()=>true,last,verifyNavigation},
  );
  try{
    await execute(draft({last_name:"Mechat"}),true);
    values.last_name="ManuallyChanged";
    await assert.rejects(execute(spelled(["M","e","c","h","a","d"]),true),
      /SNOOP_SURNAME_SPELLING_UNCLEAR/);
    assert.equal(values.last_name,"ManuallyChanged");
    await assert.rejects(execute(spelled(["M","e","c","h","a","d"]),false),
      /SNOOP_SURNAME_SPELLING_UNCLEAR/);
  }finally{remove();}
});

test("Gervis asks for spelling and does not append a corrected surname as a suffix",()=>{
  const prompt=gervisBrainPrompt({
    language:"es",today:"2026-11-28",executionEnabled:false,walletEnabled:false,
  });
  assert.match(prompt,/NAME CORRECTIONS ARE COMPLETE REPLACEMENTS/);
  assert.match(prompt,/Mechatde/);
  assert.match(prompt,/surname_spelling/);
  assert.match(prompt,/¿Me deletreas el apellido letra por letra/);
});

test("An explicit corrected surname overwrites previous voice transcription, never appends",async()=>{
  const values:Record<string,string>={
    first_name:"Fátima",last_name:"",birth_date:"1995-07-26",
  };
  const last:Record<string,Record<string,string>>={};
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>true,snapshot:()=>({...values}),
    patch:(patch)=>{Object.assign(values,patch);},
  });
  const execute=async(lastName:string)=>applyDeepgramDraft(
    ConversationProposal.parse(normalizeGervisProposal({
      intent:"member",target:"member_create",member:{last_name:lastName},
    })),
    {access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
     current:()=>true,last,verifyNavigation:true},
  );
  try{
    await execute("Mechat");
    assert.equal(values.last_name,"Mechat");
    const result=await execute("Mechad");
    assert.deepEqual(result.applied,["last_name"]);
    assert.equal(values.last_name,"Mechad");
    assert.equal(values.first_name,"Fátima");
    assert.equal(values.birth_date,"1995-07-26");
  }finally{remove();}
});

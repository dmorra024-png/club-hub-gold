import assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationProposal } from "../src/lib/snoop-conversation.ts";
import { normalizeGervisProposal } from "../src/lib/gervis-snoop/proposal-envelope.ts";
import { authorizeProposal } from "../src/lib/voice/agent-settings.server.ts";
import { memberCreationPatch, memberCreationKeys } from "../src/lib/voice/member-creation-fields.ts";
import { applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import { applicationPorts, voiceOwner } from "../src/lib/voice/application-ports.ts";
import { gervisBrainPrompt } from "../src/lib/gervis-snoop/brain.ts";
import { ActionReceipt, acknowledgedMemory } from "../src/lib/voice/action-protocol.ts";
import { emptyConversation, reduceConversation } from "../src/lib/snoop-conversation.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";

const clubId="00000000-0000-4000-8000-000000000001";
const owner=voiceOwner("00000000-0000-4000-8000-000000000002",clubId);
const access:AccountAccess={
  status:"active",role:"admin",clubId,clubName:"Synthetic",clubLogo:null,
  permissions:["manage_members"],
};
const draft=(fields:Record<string,string>)=>({
  intent:"member",target:"member_create",member:fields,
});
test("Gervis validates phone and DNI/NIE separately and keeps strict form authorization",()=>{
  for (const fields of [
    {phone:"+34612345678"},
    {dni_number:"12345678Z"},
    {dni_number:"Y1234567X"},
  ]) {
    const normalized=normalizeGervisProposal(draft(fields));
    assert.equal(ConversationProposal.safeParse(normalized).success,true);
    assert.equal(authorizeProposal(normalized,access).ok,true);
  }
  for(const dni of ["", "###", "12 34", "1234", "A".repeat(21)]){
    assert.equal(ConversationProposal.safeParse(normalizeGervisProposal(draft({dni_number:dni}))).success,false);
  }
  assert(memberCreationKeys.includes("dni_number"));
  assert.deepEqual(memberCreationPatch({phone:"+34612345678",dni_number:"12345678Z"},[],["phone","dni_number"]),{
    phone:"+34612345678",dni_number:"12345678Z",
  });
  assert.throws(()=>memberCreationPatch({dni_number:"12345678Z"},[],["phone"]),/SNOOP_MEMBER_FIELD_DISABLED/);
});

test("Gervis prepares phone and DNI on real member form, never writes and never overwrites other data",async()=>{
  const values:Record<string,string>={
    first_name:"Fátima",last_name:"Mechad",birth_date:"1995-07-26",
    phone:"",dni_number:"",city:"Palma",
  };
  const last:Record<string,Record<string,string>>={};
  let saved=0;
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>true,snapshot:()=>({...values}),
    patch:(patch)=>{Object.assign(values,memberCreationPatch(patch,[],memberCreationKeys));},
  });
  const execute=async(fields:Record<string,string>,verifyNavigation:boolean)=>applyDeepgramDraft(
    ConversationProposal.parse(normalizeGervisProposal(draft(fields))),
    {access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
     current:()=>true,last,verifyNavigation},
  );
  try{
    const phone=await execute({phone:"+34612345678"},true);
    assert.deepEqual(phone.applied,["phone"]);
    const dni=await execute({dni_number:"12345678Z"},true);
    assert.deepEqual(dni.applied,["dni_number"]);
    assert.equal(values.phone,"+34612345678");
    assert.equal(values.dni_number,"12345678Z");
    assert.equal(values.first_name,"Fátima");
    assert.equal(values.last_name,"Mechad");
    assert.equal(values.birth_date,"1995-07-26");
    assert.equal(saved,0);
    const receipt=ActionReceipt.parse({
      type:"AppActionResult",id:"draft-dni",status:"prepared",
      applied:["dni_number"],skipped:[],code:"OK",
    });
    const proposed=ConversationProposal.parse(normalizeGervisProposal(draft({dni_number:"12345678Z"})));
    const remembered=acknowledgedMemory(emptyConversation(),proposed,receipt);
    assert.equal(remembered.member.dni_number,undefined);
    assert.equal(reduceConversation(emptyConversation(),proposed).member.dni_number,undefined);
    assert.equal(values.dni_number,"12345678Z","only the local member form owns the number");
    await assert.rejects(execute({dni_number:"12345678Z"},false),/SNOOP_MEMBER_FIELD_DISABLED/);
  }finally{remove();}
});

test("Gervis cannot bypass hidden phone or DNI fields in the real club's member form",()=>{
  for(const key of ["phone","dni_number"]){
    assert.throws(()=>memberCreationPatch({[key]:key==="phone"?"+34612345678":"12345678Z"},[],["first_name","last_name"]),/SNOOP_MEMBER_FIELD_DISABLED/);
  }
});

test("Gervis instructions distinguish actual disabled fields from required phone/DNI and preserve human document review",()=>{
  const prompt=gervisBrainPrompt({language:"es",today:"2026-11-28",executionEnabled:false,walletEnabled:false});
  assert.match(prompt,/A required field is NOT disabled/);
  assert.match(prompt,/If requirements say phone visible/);
  assert.match(prompt,/DNI\/NIE NUMBER/);
  assert.match(prompt,/photo and signature must always be completed manually/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { assertWritableVoiceFields, awaitVoicePatchApplied } from "../src/lib/voice/form-capabilities.ts";
import { applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import { applicationPorts, voiceOwner, type VoiceFieldCapability } from "../src/lib/voice/application-ports.ts";
import { ConversationProposal } from "../src/lib/snoop-conversation.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";

const clubId="00000000-0000-4000-8000-000000000001";
const owner=voiceOwner("00000000-0000-4000-8000-000000000002",clubId);
const access:AccountAccess={
  status:"active",role:"admin",clubId,clubName:"Synthetic",clubLogo:null,
  permissions:["manage_members"],
};
const fields:Record<string,VoiceFieldCapability>={
  first_name:{visible:true,editable:true,required:true,type:"text"},
  last_name:{visible:true,editable:true,required:true,type:"text"},
  phone:{visible:true,editable:true,required:true,type:"phone"},
  dni_number:{visible:true,editable:true,required:true,type:"identifier"},
  email:{visible:false,editable:false,required:false,type:"email"},
};
const proposal=(member:Record<string,string>)=>ConversationProposal.parse({
  intent:"member",target:"member_create",member,product:{},
  query:null,declined:[],question:"",asking:null,
});
test("Generic form contract distinguishes required visible from truly hidden fields",()=>{
  assert.doesNotThrow(()=>assertWritableVoiceFields({phone:"+34612345678",dni_number:"12345678Z"},fields));
  assert.throws(()=>assertWritableVoiceFields({email:"test@example.invalid"},fields),/SNOOP_MEMBER_FIELD_DISABLED/);
  assert.throws(()=>assertWritableVoiceFields({unknown:"value"},fields),/SNOOP_MEMBER_FIELD_DISABLED/);
});

test("Actual UI acknowledgement succeeds only after the form contains the value",async()=>{
  let state={last_name:"Mechat"};
  let checked=0;
  await assert.rejects(awaitVoicePatchApplied(()=>{checked++;return state;},{last_name:"Mechad"},()=>true,35),
    /SNOOP_FORM_NOT_APPLIED/);
  assert(checked>=1);
  setTimeout(()=>{state={last_name:"Mechad"};},10);
  await awaitVoicePatchApplied(()=>state,{last_name:"Mechad"},()=>true,150);
});

test("Gervis validates live capabilities and actual form writes, not model permissions",async()=>{
  const values:Record<string,string>={first_name:"Ana",last_name:"Mechat",phone:"",dni_number:"",email:""};
  const last:Record<string,Record<string,string>>={};
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>true,
    fieldCapabilities:()=>fields,
    snapshot:()=>({...values}),
    patch:(patch)=>{Object.assign(values,patch);},
  });
  const execute=async(fields:Record<string,string>)=>applyDeepgramDraft(proposal(fields),{
    access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
    current:()=>true,last,verifyNavigation:true,
  });
  try {
    assert.deepEqual((await execute({phone:"+34612345678"})).applied,["phone"]);
    assert.deepEqual((await execute({dni_number:"12345678Z"})).applied,["dni_number"]);
    assert.equal(values.last_name,"Mechat");
    assert.equal(values.first_name,"Ana");
    await assert.rejects(execute({email:"test@example.invalid"}),/SNOOP_MEMBER_FIELD_DISABLED/);
    assert.equal(values.email,"");
  }finally{remove();}
});

test("Gervis does not claim successful patch when a mounted form ignores it",async()=>{
  const values:Record<string,string>={first_name:"Ana",last_name:""};
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>true,fieldCapabilities:()=>fields,
    snapshot:()=>({...values}),
    patch:()=>{},
  });
  try {
    await assert.rejects(applyDeepgramDraft(proposal({last_name:"Mechad"}),{
      access,owner,path:()=>"/soci/nuovo",navigate:()=>{},
      current:()=>true,last:{},verifyNavigation:true,
    }),/SNOOP_FORM_NOT_APPLIED/);
  }finally{remove();}
});

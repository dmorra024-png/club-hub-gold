import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import { applicationPorts, voiceOwner } from "../src/lib/voice/application-ports.ts";
import { ConversationProposal } from "../src/lib/snoop-conversation.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";

const clubId="00000000-0000-4000-8000-000000000001";
const owner=voiceOwner("00000000-0000-4000-8000-000000000002",clubId);
const access:AccountAccess={
  status:"active",role:"admin",clubId,clubName:"Synthetic",clubLogo:null,
  permissions:["manage_members"],
};
const createMember = ConversationProposal.parse({
  intent:"navigate",target:"member_create",member:{},product:{},
  query:null,declined:[],question:"",asking:null,
});

test("Gervis acknowledges a member form only after route and real form port are ready",async()=>{
  let path="/";
  let ready=false;
  const remove=applicationPorts.register(owner,"member.form",{ready:()=>ready});
  try {
    ready=true;
    const result=await applyDeepgramDraft(createMember,{
      access,owner,path:()=>path,current:()=>true,last:{},
      navigate:(target)=>{path=target;},
      verifyNavigation:true,
    });
    assert.equal(result.proposal.target,"member_create");
    assert.equal(path,"/soci/nuovo");
  }finally{remove();}
});

test("Gervis rejects a route that did not actually open, instead of claiming success",async()=>{
  let active=true;
  const before="/";
  await assert.rejects(applyDeepgramDraft(createMember,{
    access,owner,path:()=>before,current:()=>active,last:{},
    navigate:()=>{active=false;},
    verifyNavigation:true,
  }),/SNOOP_FORM_UNAVAILABLE/);
});

test("Gervis does not acknowledge a form that is not mounted or ready",async()=>{
  let path="/";
  let active=true;
  // Make the readiness wait abort immediately without a fake successful form.
  const remove=applicationPorts.register(owner,"member.form",{
    ready:()=>false,
  });
  try {
    await assert.rejects(applyDeepgramDraft(createMember,{
      access,owner,path:()=>path,current:()=>active,last:{},
      navigate:(target)=>{path=target;active=false;},
      verifyNavigation:true,
    }),/SNOOP_FORM_UNAVAILABLE/);
  }finally{remove();}
});

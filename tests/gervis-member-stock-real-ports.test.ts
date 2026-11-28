import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import { applicationPorts, voiceOwner } from "../src/lib/voice/application-ports.ts";
import { ConversationProposal } from "../src/lib/snoop-conversation.ts";
import { gervisTaskFeedback } from "../src/lib/gervis-snoop/task-feedback.ts";
import { gervisBrainPrompt } from "../src/lib/gervis-snoop/brain.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";

const clubId="00000000-0000-4000-8000-000000000001";
const owner=voiceOwner("00000000-0000-4000-8000-000000000002",clubId);
const access:AccountAccess={
  status:"active",role:"admin",clubId,clubName:"Synthetic",clubLogo:null,
  permissions:["manage_members","manage_products"],
};
const memberSearch=ConversationProposal.parse({
  intent:"search",target:"members",member:{},product:{},
  query:"Mechad",declined:[],question:"",asking:null,
});
const stock=ConversationProposal.parse({
  intent:"stock_draft",target:"stock",member:{},product:{},
  query:null,declined:[],question:"",asking:null,
  stock_movement:{name:"Amnesia Haze",delta:"+50"},
});

test("Gervis waits for genuine async search and distinguishes multiple matches without guessing",async()=>{
  let path="/";
  let release!:(result:"multiple")=>void;
  let completed=false;
  const remove=applicationPorts.register(owner,"members.search",{
    ready:()=>true,
    search:(query)=>{
      assert.equal(query,"Mechad");
      return new Promise(resolve=>{release=(status)=>{completed=true;resolve(status);};});
    },
  });
  try {
    const pending=applyDeepgramDraft(memberSearch,{
      access,owner,path:()=>path,current:()=>true,last:{},verifyNavigation:true,
      navigate:(to)=>{path=to;},
    });
    // The browser must await the search result, not claim "opened" merely
    // because navigation succeeded.
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(completed,false);
    release("multiple");
    const result=await pending;
    assert.equal(path,"/soci/gestisci");
    assert.equal(result.searchOutcome,"multiple");
    assert.deepEqual(result.applied,[]);
    const feedback=gervisTaskFeedback(memberSearch,{
      ok:true,status:"opened",persisted:false,code:"MEMBER_AMBIGUOUS",
    });
    assert.match(feedback.next_step??"",/Multiple possible members/);
    assert.equal(feedback.persisted,false);
  }finally{remove();}
});

test("Gervis rejects a verified zero-result member search; it does not invent an existing member",async()=>{
  let path="/soci/gestisci";
  const remove=applicationPorts.register(owner,"members.search",{
    ready:()=>true,search:async()=> "not_found",
  });
  try {
    await assert.rejects(applyDeepgramDraft(memberSearch,{
      access,owner,path:()=>path,current:()=>true,last:{},verifyNavigation:true,
      navigate:(to)=>{path=to;},
    }),/SNOOP_MEMBER_NOT_FOUND/);
  }finally{remove();}
});
test("Gervis refuses member search provider failure without falsely claiming zero matches",async()=>{
  const remove=applicationPorts.register(owner,"members.search",{
    ready:()=>true,search:async()=> "unavailable",
  });
  try {
    await assert.rejects(applyDeepgramDraft(memberSearch,{
      access,owner,path:()=>"/soci/gestisci",current:()=>true,last:{},
      navigate:()=>{},verifyNavigation:true,
    }),/SNOOP_MEMBER_SEARCH_UNAVAILABLE/);
  }finally{remove();}
});

test("Gervis stages stock in a real registered UI port; no backend mutation",async()=>{
  let staged:unknown;
  const remove=applicationPorts.register(owner,"products.page",{
    ready:()=>true,open:()=>{},
    stageStock:(name,delta)=>{staged={name,delta};return true;},
  });
  try {
    const result=await applyDeepgramDraft(stock,{
      access,owner,path:()=>"/productos",current:()=>true,last:{},
      navigate:()=>{},verifyNavigation:true,
    });
    assert.deepEqual(staged,{name:"Amnesia Haze",delta:"+50"});
    assert.equal(result.proposal.intent,"stock_draft");
    assert.deepEqual(result.applied,[]);
    const feedback=gervisTaskFeedback(stock,{
      ok:true,status:"prepared",persisted:false,code:"OK",
    });
    assert.match(feedback.next_step??"",/not applied/);
    assert.equal(feedback.persisted,false);
  }finally{remove();}
});

test("Gervis identifies unavailable stock drafts, and retains role permissions",async()=>{
  const remove=applicationPorts.register(owner,"products.page",{
    ready:()=>true,open:()=>{},stageStock:()=>false,
  });
  try {
    await assert.rejects(applyDeepgramDraft(stock,{
      access,owner,path:()=>"/productos",current:()=>true,last:{},
      navigate:()=>{},verifyNavigation:true,
    }),/SNOOP_STOCK_DRAFT_UNAVAILABLE/);
    await assert.rejects(applyDeepgramDraft(stock,{
      access:{...access,permissions:["manage_members"]},owner,
      path:()=>"/productos",current:()=>true,last:{},
      navigate:()=>{},verifyNavigation:true,
    }),/SNOOP_PROPOSAL_NOT_AUTHORIZED/);
  }finally{remove();}
});

test("Gervis explains the difference between lookup, a stock preview and prohibited final write",()=>{
  const prompt=gervisBrainPrompt({
    language:"es",today:"2026-11-28",
    walletEnabled:false,executionEnabled:false,
  });
  assert.match(prompt,/snoop_propose with intent search, target members/);
  assert.match(prompt,/snoop_propose stock_draft target stock/);
  assert.match(prompt,/permanent stock updates are DISABLED/i);
});

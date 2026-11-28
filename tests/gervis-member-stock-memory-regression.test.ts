import assert from "node:assert/strict";
import { test } from "node:test";
import { acknowledgedMemory } from "../src/lib/voice/action-protocol.ts";
import { ConversationProposal, emptyConversation } from "../src/lib/snoop-conversation.ts";
import { gervisTaskFeedback } from "../src/lib/gervis-snoop/task-feedback.ts";

test("verified surname spelling clears stale voice transcription rather than repeating Mechatde",()=>{
  const proposal=ConversationProposal.parse({
    intent:"member",target:"member_create",member:{},product:{},
    query:null,declined:[],question:"",asking:null,
    surname_spelling:{letters:["M","e","c","h","a","d"]},
  });
  const previous={...emptyConversation(),member:{first_name:"Fátima",last_name:"Mechatde",birth_date:"1995-07-26"}};
  const receipt={type:"AppActionResult",id:"spell-1",status:"prepared",applied:["last_name"],skipped:[],code:"OK"};
  const next=acknowledgedMemory(previous,proposal,receipt);
  assert.equal(next.member.last_name,undefined);
  assert.equal(next.member.first_name,"Fátima");
  assert.equal(next.member.birth_date,"1995-07-26");
  assert.equal(previous.member.last_name,"Mechatde");
});

test("rejected surname spelling never erases a previous acknowledged voice state",()=>{
  const proposal=ConversationProposal.parse({
    intent:"member",target:"member_create",member:{},product:{},
    query:null,declined:[],question:"",asking:null,
    surname_spelling:{letters:["M","e","c","h","a","d"]},
  });
  const previous={...emptyConversation(),member:{last_name:"Mechatde"}};
  const receipt={type:"AppActionResult",id:"spell-2",status:"rejected",applied:[],skipped:[],code:"SURNAME_SPELLING_UNCLEAR"};
  const next=acknowledgedMemory(previous,proposal,receipt);
  assert.equal(next.member.last_name,"Mechatde");
});

test("Gervis distinguishes stock-not-staged from denied permission and member search failure from zero results",()=>{
  const stock=ConversationProposal.parse({
    intent:"stock_draft",target:"stock",member:{},product:{},query:null,
    declined:[],question:"",asking:null,stock_movement:{name:"Amnesia Haze",delta:"+50"},
  });
  const failed=gervisTaskFeedback(stock,{
    ok:false,status:"rejected",persisted:false,code:"STOCK_DRAFT_UNAVAILABLE",
  });
  assert.match(failed.next_step??"",/NOT prepared/);
  assert.doesNotMatch(failed.next_step??"",/permission denied/i);
  const search=ConversationProposal.parse({
    intent:"search",target:"members",member:{},product:{},query:"Mechad",
    declined:[],question:"",asking:null,
  });
  const service=gervisTaskFeedback(search,{
    ok:false,status:"rejected",persisted:false,code:"MEMBER_SEARCH_UNAVAILABLE",
  });
  assert.match(service.next_step??"",/Do NOT report zero results/);
  assert.equal(service.persisted,false);
});

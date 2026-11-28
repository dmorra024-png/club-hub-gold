import assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationProposal } from "../src/lib/snoop-conversation.ts";
import { gervisTaskFeedback } from "../src/lib/gervis-snoop/task-feedback.ts";

const proposal = (intent:string,target:string|null) => ConversationProposal.parse({
  intent,target,member:{},product:{},query:null,declined:[],question:"",asking:null,
  ...(intent==="stock_draft"?{stock_movement:{name:"Amnesia Haze",delta:"+50"}}:{}),
});
test("Gervis continues member registration after opening the ACTUAL form",() => {
  const result=gervisTaskFeedback(proposal("navigate","member_create"),{
    ok:true,status:"opened",persisted:false,code:"OK",
  });
  assert.equal(result.persisted,false);
  assert.match(result.next_step!,/Ask for one missing member detail/);
  assert.match(result.next_step!,/NOT been registered/);
});
test("Gervis knows a member/product draft is not a saved record",() => {
  for(const [intent,target] of [["member","member_create"],["product","product_create"]] as const){
    const value=gervisTaskFeedback(proposal(intent,target),{
      ok:true,status:"prepared",persisted:false,applied:["name"],skipped:[],
    });
    assert.equal(value.persisted,false);
    assert.match(value.next_step!,/manual Save|human Save/i);
  }
});
test("Gervis never calls staged inventory a completed stock movement",() => {
  const result=gervisTaskFeedback(proposal("stock_draft","stock"),{
    ok:true,status:"prepared",persisted:false,applied:[],skipped:[],
  });
  assert.match(result.next_step!,/not applied/);
  assert.equal(result.persisted,false);
});
test("Gervis retains the rejection and does not invent a successful action",() => {
  const result=gervisTaskFeedback(proposal("navigate","member_create"),{
    ok:false,status:"rejected",persisted:false,code:"STALE",
  });
  assert.equal(result.status,"rejected");
  assert.equal(result.ok,false);
  assert.match(result.next_step!,/changed screens/);
});

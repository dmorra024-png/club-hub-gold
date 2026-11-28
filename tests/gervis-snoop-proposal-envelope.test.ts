import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGervisProposal } from "../src/lib/gervis-snoop/proposal-envelope.ts";
import { authorizeProposal } from "../src/lib/voice/agent-settings.server.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";

const access:AccountAccess = {
  status:"active", role:"admin", clubId:"00000000-0000-4000-8000-000000000001",
  clubName:"Synthetic", clubLogo:null, permissions:["manage_members","manage_products","use_cash","view_reports"],
};
const validate=(p:unknown,actor=access)=>authorizeProposal(normalizeGervisProposal(p),actor);

test("Gervis accepts concise safe stock draft with existing permissions and validation",()=>{
  const raw={intent:"stock_draft",target:"stock",stock_movement:{name:"Amnesia Haze",delta:"+50"}};
  const normalized=normalizeGervisProposal(raw) as Record<string,unknown>;
  assert.deepEqual(normalized.member,{});
  assert.deepEqual(normalized.product,{});
  assert.equal(normalized.query,null);
  assert.deepEqual(normalized.stock_movement,raw.stock_movement);
  assert.equal(validate(raw).ok,true);
  assert.equal(validate(raw,{...access,permissions:["manage_members"]}).ok,false);
  assert.equal(validate(raw,{...access,status:"suspended"}).ok,false);
});

test("Gervis accepts succinct search and administration draft envelope, never auto saves",()=>{
  const search={intent:"search",target:"members",query:"Fatima"};
  assert.equal(validate(search).ok,true);
  const admin={intent:"administrative_draft",target:"collaborators",
    form:{kind:"collaborator_invite",fields:{first_name:"Ana",last_name:"Rossi",email:"ana@example.invalid"}}};
  const out=validate(admin);
  assert.equal(out.ok,true);
  if(out.ok) assert.equal(out.requiresManualSave,true);
  assert.equal(validate(admin,{...access,role:"collaborator"}).ok,false);
});

test("Gervis never invents or drops privileged fields, destinations, or malformed values",()=>{
  for (const raw of [
    {intent:"stock_draft",target:"stock"},
    {intent:"stock_draft",target:"stock",stock_movement:{name:"Amnesia Haze",delta:"0"}},
    {intent:"stock_draft",target:"stock",stock_movement:{name:"Amnesia Haze",delta:"+50"},bypass:true},
    {intent:"search",query:"Ana"},
    {intent:"navigate",target:"nonsense"},
    {intent:"member_edit",target:null,member:{id:"unauthorized"}},
    {intent:"cash_draft",target:"cash"},
    {intent:"cash_draft",target:"cash",cash:{closing_cash:"not-a-number"}},
    {intent:"navigate",target:"members",member:"not-an-object"},
  ]) {
    assert.equal(validate(raw).ok,false,JSON.stringify(raw));
    if("bypass" in raw || !("target" in raw) || typeof (raw as any).member === "string")
      assert.equal(normalizeGervisProposal(raw),raw);
  }
});

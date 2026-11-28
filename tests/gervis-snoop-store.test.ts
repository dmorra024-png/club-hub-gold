import assert from "node:assert/strict";
import { test } from "node:test";
import { createGervisSupabaseLearningStore } from "../src/lib/gervis-snoop/supabase-learning-store.server.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";

const club = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
const auth: AccountAccess = {
  status:"active", role:"admin", clubId:club, clubName:"Synthetic",
  clubLogo:null, permissions:["manage_members", "manage_products"],
};
const record = {
  clubId:club, kind:"pronunciation" as const, phrase:"Fortitten Frut",
  meaning:"Forbidden Fruit", approvedBy:actor, approvedAt:"2026-11-27T14:00:00Z",
};

test("Gervis learning uses only authorized user JWT, club-scoped RLS API and no secrets", async () => {
  const calls: {path:string; method:string; headers:Headers; body?:string}[] = [];
  const fake:typeof fetch = async (input,init) => {
    const url = new URL(String(input));
    calls.push({path:url.pathname+url.search,method:init?.method??"GET",headers:new Headers(init?.headers),body:String(init?.body??"")});
    assert.equal(url.origin,"https://bnwanxbmprbymbutoths.supabase.co");
    assert.equal(init?.redirect,"manual");
    assert.equal(new Headers(init?.headers).get("authorization"),"Bearer a.b.c");
    if (init?.method==="GET") return Response.json([
      {club_id:club,kind:record.kind,phrase:record.phrase,meaning:record.meaning,approved_by:actor,approved_at:record.approvedAt}
    ]);
    return new Response(null,{status:204});
  };
  const store = createGervisSupabaseLearningStore({
    url:"https://bnwanxbmprbymbutoths.supabase.co", publishableKey:"sb_publishable_TEST",
    jwt:"a.b.c",access:auth,authenticatedUserId:actor,fetch:fake,
  });
  assert.equal((await store.list(club)).length,1);
  await store.upsert(record);
  await store.remove(club,record.kind,record.phrase);
  assert.deepEqual(calls.map(x=>x.method),["GET","POST","DELETE"]);
  assert.ok(calls.every(x=>x.path.includes("club_id=eq."+club)||x.method==="POST"));
  assert.equal(JSON.parse(calls[1].body!).club_id, club);
  assert.equal(JSON.parse(calls[1].body!).approved_by, actor);
});

test("Gervis blocks cross-club reads and writes before any network call",async () => {
  let calls=0;
  const store=createGervisSupabaseLearningStore({
    url:"https://bnwanxbmprbymbutoths.supabase.co",publishableKey:"sb_publishable_TEST",
    jwt:"a.b.c",access:auth,authenticatedUserId:actor,fetch:async()=>{calls++;return Response.json([]);},
  });
  await assert.rejects(store.list(other),/SCOPE/);
  await assert.rejects(store.upsert({...record,clubId:other}),/SCOPE/);
  await assert.rejects(store.remove(other,"pronunciation","Fortitten Frut"),/SCOPE/);
  await assert.rejects(store.upsert({...record,approvedBy:other}),/AUTH_REQUIRED/);
  assert.equal(calls,0);
});

test("Gervis collaborator cannot write and API redirects fail closed",async () => {
  let calls=0;
  const store=createGervisSupabaseLearningStore({
    url:"https://bnwanxbmprbymbutoths.supabase.co",publishableKey:"sb_publishable_TEST",
    jwt:"a.b.c",access:{...auth,role:"collaborator"},authenticatedUserId:actor,
    fetch:async()=>{calls++;return Response.json([]);},
  });
  await assert.rejects(store.upsert(record),/AUTH_REQUIRED/);
  await assert.rejects(store.remove(club,"pronunciation","Fortitten Frut"),/AUTH_REQUIRED/);
  assert.equal(calls,0);
  const hostile=createGervisSupabaseLearningStore({
    url:"https://bnwanxbmprbymbutoths.supabase.co",publishableKey:"sb_publishable_TEST",
    jwt:"a.b.c",access:auth,authenticatedUserId:actor,
    fetch:async()=>new Response(null,{status:302,headers:{Location:"https://evil.invalid/"}}),
  });
  await assert.rejects(hostile.list(club),/UNAVAILABLE/);
});

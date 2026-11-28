import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approveGervisLearning, forgetGervisLearning,
  type GervisLearningStore, type GervisLearningRecord,
} from "../src/lib/gervis-snoop/learning.ts";

test("Gervis may learn a pronunciation only after explicit club-scoped approval", async () => {
  const records = new Map<string, GervisLearningRecord>();
  const key = (club: string, kind: string, phrase: string) => JSON.stringify([club,kind,phrase]);
  const store: GervisLearningStore = {
    async list(club) { return [...records.values()].filter(x => x.clubId === club); },
    async upsert(item) { records.set(key(item.clubId,item.kind,item.phrase),item); },
    async remove(club,kind,phrase) { records.delete(key(club,kind,phrase)); },
  };
  const ctx = { clubId: "club-a", userId: "operator", confirmed: true, canManage: true, at: "2026-11-27T14:00:00.000Z" };
  const word = { kind: "pronunciation" as const, phrase: "Fortitten Frut", meaning: "Forbidden Fruit" };
  assert.deepEqual(await approveGervisLearning(store, {...ctx,confirmed:false},word), {ok:false,reason:"approval_required"});
  assert.equal((await store.list("club-a")).length,0);
  assert.deepEqual(await approveGervisLearning(store,ctx,word), {ok:true});
  assert.equal((await store.list("club-a")).length,1);
  assert.deepEqual(await store.list("club-b"),[], "never mix club memories");
  assert.deepEqual(await approveGervisLearning(store,ctx, {kind:"pronunciation",phrase:"password",meaning:"secret"}),{ok:false,reason:"private_data"});
  assert.equal((await store.list("club-a")).length,1);
  assert.deepEqual(await forgetGervisLearning(store,{clubId:"club-a",confirmed:true,canManage:true},word), {ok:true});
  assert.deepEqual(await store.list("club-a"),[]);
});

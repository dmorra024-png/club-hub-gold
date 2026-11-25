import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingExecution } from "../src/lib/voice/pending-execution.ts";

test("pending recovery stores only a validated operation reference scoped to user and club", () => {
  const rows = new Map<string, string>();
  const storage = {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
  const owner = pendingExecution(storage, JSON.stringify(["user-a", "club-a"]));
  const id = "00000000-0000-4000-8000-000000001101";
  owner.save(id);
  assert.equal(owner.read(), id);
  assert.equal(pendingExecution(storage, JSON.stringify(["user-b", "club-a"])).read(), null);
  assert.equal(pendingExecution(storage, JSON.stringify(["user-a", "club-b"])).read(), null);
  assert.deepEqual([...rows.values()], [id]);
  assert.throws(() => owner.save("transcript or confirmation token"), /INVALID/);
  owner.clear("00000000-0000-4000-8000-000000001102");
  assert.equal(owner.read(), id);
  owner.clear(id);
  assert.equal(owner.read(), null);
});

test("storage disabled or malformed reference never blocks the manual application", () => {
  const fail = () => {
    throw Error("Storage blocked");
  };
  const blocked = pendingExecution({ getItem: fail, setItem: fail, removeItem: fail }, "owner");
  assert.equal(blocked.read(), null);
  assert.doesNotThrow(() => blocked.save("00000000-0000-4000-8000-000000001101"));
  assert.doesNotThrow(() => blocked.clear("00000000-0000-4000-8000-000000001101"));
  assert.equal(
    pendingExecution(
      { getItem: () => "private text", setItem: fail, removeItem: fail },
      "owner",
    ).read(),
    null,
  );
});

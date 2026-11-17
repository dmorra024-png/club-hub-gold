import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findServerFunctionId } from "../scripts/lib/server-function-id.mjs";

test("runtime probe resolves the exact RPC in old minified and new multiline server chunks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "snoop-rpc-"));
  try {
    await writeFile(
      join(dir, "a.mjs"),
      "createServerRpc({id:`abc123`,name:`getAdministrativeAiStatus`})",
    );
    assert.equal(await findServerFunctionId(dir, "getAdministrativeAiStatus"), "abc123");
    await writeFile(
      join(dir, "a.mjs"),
      'createServerRpc({\n id: "abc123",\n name: "getAdministrativeAiStatus",\n filename: "safe"\n})',
    );
    await writeFile(join(dir, "b.mjs"), 'createServerRpc({id:"deadbeef",name:"differentRpc"})');
    assert.equal(await findServerFunctionId(dir, "getAdministrativeAiStatus"), "abc123");
    await writeFile(
      join(dir, "c.mjs"),
      "createServerRpc({id: 'abc123', name: 'getAdministrativeAiStatus'})",
    );
    assert.equal(await findServerFunctionId(dir, "getAdministrativeAiStatus"), "abc123");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime probe rejects missing, ambiguous or injected RPC names rather than testing the wrong endpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "snoop-rpc-"));
  try {
    await writeFile(join(dir, "a.mjs"), 'createServerRpc({id:"abc123",name:"otherRpc"})');
    await assert.rejects(() => findServerFunctionId(dir, "getAdministrativeAiStatus"), /NOT_FOUND/);
    await assert.rejects(() => findServerFunctionId(dir, ".*"), /NAME_INVALID/);
    await writeFile(
      join(dir, "a.mjs"),
      'createServerRpc({id:"abc123",name:"getAdministrativeAiStatus"})',
    );
    await writeFile(
      join(dir, "b.mjs"),
      'createServerRpc({id:"def456",name:"getAdministrativeAiStatus"})',
    );
    await assert.rejects(() => findServerFunctionId(dir, "getAdministrativeAiStatus"), /AMBIGUOUS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

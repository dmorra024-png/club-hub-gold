import { test } from "node:test";
import assert from "node:assert/strict";
import { gervisToolFeedback } from "../src/lib/gervis-snoop/tool-feedback.ts";

test("Gervis distinguishes schema mistakes from genuine permissions", () => {
  const format = gervisToolFeedback({ok:false,code:"SNOOP_PROPOSAL_REJECTED",reason:"format"}) as Record<string,unknown>;
  assert.equal(format.error_kind,"format");
  assert.match(String(format.recovery),/NOT a user permission failure/);
  assert.equal(format.persisted,false);
  const permission = gervisToolFeedback({ok:false,code:"SNOOP_PROPOSAL_REJECTED",reason:"permission"}) as Record<string,unknown>;
  assert.equal(permission.error_kind,"permission");
  assert.match(String(permission.recovery),/lacks authorization/);
  assert.equal(permission.persisted,false);
});

test("Gervis handles missing category, declined optional fields and unknown errors", () => {
  for (const [failure,expected] of [
    [{ok:false,reason:"declined"},"declined"],
    [{ok:false,code:"SNOOP_UNKNOWN_CATEGORY"},"category"],
    [{ok:false,code:"SNOOP_CATEGORY_CONTEXT_REQUIRED"},"category"],
    [{ok:false,code:"APP_RESULT_TIMEOUT"},"unknown"],
  ] as const) {
    const result = gervisToolFeedback(failure) as Record<string,unknown>;
    assert.equal(result.error_kind,expected);
    assert.equal(result.status,"rejected");
    assert.equal(result.persisted,false);
  }
});

test("Gervis never alters successful, malformed, or absent model tool results", () => {
  for (const result of [
    {ok:true,status:"prepared",persisted:false},
    {ok:true,status:"opened",persisted:false},
    {ok:true,status:"completed",persisted:true},
    null,
    "untrusted",
  ]) assert.deepEqual(gervisToolFeedback(result),result);
});

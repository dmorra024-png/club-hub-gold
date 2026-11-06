import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSupabaseEndpoint } from "../src/lib/supabase-endpoint.ts";
test("sandbox browser requests use the preview origin rather than the phone's localhost", () => {
  assert.equal(
    resolveSupabaseEndpoint("/sandbox-api", "https://preview.example.test"),
    "https://preview.example.test/sandbox-api",
  );
});
test("SSR uses the internal server endpoint for a relative browser endpoint", () => {
  assert.equal(
    resolveSupabaseEndpoint("/sandbox-api", undefined, "http://127.0.0.1:54321"),
    "http://127.0.0.1:54321",
  );
  assert.throws(() => resolveSupabaseEndpoint("/sandbox-api"), /SUPABASE_URL/);
});
test("normal independent Supabase endpoints remain unchanged and unsafe URLs fail", () => {
  assert.equal(resolveSupabaseEndpoint("https://test.example.test/"), "https://test.example.test");
  for (const value of [
    "//evil.example.test",
    "javascript:alert(1)",
    "https://user:secret@example.test",
    "https://example.test/?token=x",
  ])
    assert.throws(() => resolveSupabaseEndpoint(value));
});

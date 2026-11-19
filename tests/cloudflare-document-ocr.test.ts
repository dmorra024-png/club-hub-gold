import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMoondreamAnswer, DOCUMENT_MODEL } from "../src/lib/cloudflare-documents.functions.ts";

test("pins existing Cloudflare vision model (not paid external endpoint)", () => {
  assert.equal(DOCUMENT_MODEL, "@cf/moondream/moondream3.1-9B-A2B");
});
test("validates synthetic structured identity without guessing", () => {
  const result = parseMoondreamAnswer({
    answer: ```json
{"first_name":"ANA MARIA","last_name":"GARCIA","birth_date":"1990-05-13","dni_number":"12345678Z","address":"","city":"","postal_code":""}
```,
  });
  assert.equal(result.birth_date, "1990-05-13");
  assert.equal(result.dni_number, "12345678Z");
  assert.equal(result.city, "");
});
test("rejects non-JSON answers rather than inserting a hallucination", () => {
  assert.throws(() => parseMoondreamAnswer({ answer: "Passport: John Smith born 1990." }));
  assert.equal(parseMoondreamAnswer({ answer: "{}" }).first_name, "");
});
test("rejects invalid birth date and postal code", () => {
  const r = parseMoondreamAnswer({answer:'{"first_name":"ANA","birth_date":"2026-02-30","dni_number":"123 456 78Z","postal_code":"A123"}'});
  assert.equal(r.birth_date, "");
  assert.equal(r.postal_code, "");
  assert.equal(r.dni_number, "12345678Z");
});

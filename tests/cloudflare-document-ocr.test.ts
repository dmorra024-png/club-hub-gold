import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCloudflareVisionAnswer, DOCUMENT_MODEL } from "../src/lib/cloudflare-document-parser.ts";

const asChoice = (content: string) => ({ choices: [{ message: { content } }] });
test("pins Cloudflare Gemma 4 Vision on existing provider", () => {
  assert.equal(DOCUMENT_MODEL, "@cf/google/gemma-4-26b-a4b-it");
});
test("validates synthetic structured identity without guessing", () => {
  const result = parseCloudflareVisionAnswer(asChoice(`\`\`\`json
{"first_name":"ANA MARIA","last_name":"GARCIA","birth_date":"1990-05-13","dni_number":"12345678Z","address":"","city":"","postal_code":""}
\`\`\``));
  assert.equal(result.birth_date, "1990-05-13");
  assert.equal(result.dni_number, "12345678Z");
  assert.equal(result.city, "");
});
test("rejects natural-language non-JSON, never fabricates identity", () => {
  assert.throws(() => parseCloudflareVisionAnswer(asChoice("Passport: John Smith born 1990.")));
  assert.equal(parseCloudflareVisionAnswer(asChoice("{}")).first_name, "");
});
test("rejects invalid date and postal code, trims document number", () => {
  const r = parseCloudflareVisionAnswer(asChoice('{"first_name":"ANA","birth_date":"2026-02-30","dni_number":"123 456 78Z","postal_code":"A123"}'));
  assert.equal(r.birth_date, "");
  assert.equal(r.postal_code, "");
  assert.equal(r.dni_number, "12345678Z");
});

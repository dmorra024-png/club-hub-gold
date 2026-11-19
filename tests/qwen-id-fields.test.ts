import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQwenDocumentResult, hasQwenDocumentFields } from "../src/lib/qwen-id-fields.ts";

const expected = {
  first_name: "ANA MARIA", last_name: "GARCIA PEREZ", birth_date: "1994-04-07",
  dni_number: "12345678Z", address: "CALLE MAYOR 5", city: "PALMA", postal_code: "07001"
};
test("Qwen JSON maps exactly to SNOOP membership fields", () => {
  const value = parseQwenDocumentResult({ response: JSON.stringify(expected) });
  assert.deepEqual(value, expected);
  assert.equal(hasQwenDocumentFields(value), true);
});
test("Qwen can return markdown JSON without changing field associations", () => {
  const value = parseQwenDocumentResult({ response: "Here is the extraction:\n\`\`\`json\n" + JSON.stringify(expected) + "\n\`\`\`" });
  assert.deepEqual(value, expected);
});
test("Missing data stays empty; wrong dates, postal codes and ID format are rejected", () => {
  const value = parseQwenDocumentResult({response: JSON.stringify({
    first_name:"ANA",last_name:"",birth_date:"2025-13-45",dni_number:"?",address:"",city:"",postal_code:"1234"
  })});
  assert.equal(value.first_name,"ANA");
  assert.equal(value.last_name,"");
  assert.equal(value.birth_date,"");
  assert.equal(value.dni_number,"");
  assert.equal(value.postal_code,"");
});
test("Invalid or missing JSON cannot be treated as a successful OCR result", () => {
  assert.throws(() => parseQwenDocumentResult({response:"no fields found"}));
  assert.equal(hasQwenDocumentFields(parseQwenDocumentResult({response:"{}"})),false);
});

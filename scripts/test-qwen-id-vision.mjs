import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const token = process.env.SNOOP_CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assert.ok(token && account, "Missing existing Cloudflare test credentials");
const photo = readFileSync("/tmp/snoop-synthetic-id.png").toString("base64");
const prompt = `Read the photographed fictional identity document. Return ONLY valid JSON, with exactly these seven string keys: first_name,last_name,birth_date,dni_number,address,city,postal_code. Birthdate YYYY-MM-DD. Use only text visible in the image, no guesses. Empty string if absent. This document is entirely synthetic.`;
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/qwen/qwen3.8-27b`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    messages: [{ role: "user", content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/png;base64,${photo}` } }
    ] }],
    max_completion_tokens: 512, reasoning_effort: "low", temperature: 0, stream: false, store: false
  }),
  signal: AbortSignal.timeout(90000)
});
const json = await response.json().catch(() => ({}));
if (!response.ok || json.success === false) {
  const codes = (json.errors ?? []).map(e => e.code);
  console.error(JSON.stringify({ status: "INFERENCE_UNAVAILABLE", http: response.status, error_codes: codes }));
  process.exit(2);
}
const message = json.result?.response ?? json.result?.choices?.[0]?.message?.content ?? json.choices?.[0]?.message?.content ?? "";
const raw = typeof message === "string" ? message : JSON.stringify(message);
const match = raw.match(/\{[\s\S]*\}/);
assert.ok(match, "The model did not return JSON");
const fields = JSON.parse(match[0]);
const expected = {
  first_name: "ANA MARIA",
  last_name: "GARCIA PEREZ",
  birth_date: "1994-04-07",
  dni_number: "12345678Z",
  address: "CALLE MAYOR 5",
  city: "PALMA",
  postal_code: "07001"
};
const normalize = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/\s+/g," ").trim();
const checks = Object.entries(expected).map(([field, value])=>({ field, matched: normalize(fields[field])===normalize(value) }));
console.log(JSON.stringify({ model: "@cf/qwen/qwen3.8-27b", input: "synthetic-only", total: checks.length, matched: checks.filter(x=>x.matched).length, fields: checks }));
assert.ok(checks.every(x=>x.matched), "Field extraction did not match synthetic test");

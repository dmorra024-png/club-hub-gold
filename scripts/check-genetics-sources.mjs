// Live Internet verification; no credentials, club/member data or database requests.
import { researchGenetics } from "../src/lib/genetics-research.server.ts";
import { writeFile } from "node:fs/promises";
const names = [
  "Amnesia Haze",
  "Gelato 41",
  "Runtz",
  "Gorilla Glue",
  "Wedding Cake",
  "Northern Lights",
  "White Widow",
  "Zkittlez",
];
const rows = [];
for (const name of names) {
  const r = await researchGenetics(name);
  rows.push({
    name,
    result: r.facts.length ? "PARTIAL" : "BLOCKED",
    verified_facts: r.facts,
    references: r.references,
    images: r.images,
    warnings: r.warnings,
  });
  console.log(
    name,
    JSON.stringify({
      documentedFacts: r.facts.length,
      reusableExactNamePhotos: r.images.length,
      warnings: r.warnings,
    }),
  );
}
await writeFile(
  "docs/GENETICS_LIVE_RESEARCH_RESULTS.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      method:
        "Real HTTP GET to documented public Wikimedia APIs; no simulated source data, CAPTCHA bypass, commercial APIs or AI generation",
      rows,
    },
    null,
    2,
  ),
);

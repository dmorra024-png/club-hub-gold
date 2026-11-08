import { test } from "node:test";
import assert from "node:assert/strict";
import { researchGenetics } from "../src/lib/genetics-research.server.ts";
import {
  originalSpanishDescription,
  conflictingFacts,
  informationalSource,
  geneticsName,
  exactBotanicalImage,
  safeGeneticsImage,
} from "../src/lib/genetics-archive.ts";
import { informationalVoiceCommand } from "../src/lib/informational-voice.ts";
import { privateVoiceCommand } from "../src/lib/private-voice.ts";
import { parseAdministrativeDictation } from "../src/lib/member-administration.ts";
test("botanical source and image matching reject commercial paths and unrelated exact words", () => {
  for (const u of [
    "https://www.leafly.com/shop/amnesia",
    "https://www.leafly.com/strains/amnesia?shop=1",
    "https://evil.test/wiki/Q1",
    "javascript:alert(1)",
  ])
    assert.equal(informationalSource(u), null);
  assert.ok(informationalSource("https://www.leafly.com/strains/amnesia-haze"));
  assert.throws(() => geneticsName("name@example.test"));
  assert.throws(() => geneticsName("12345678"));
  assert.equal(
    exactBotanicalImage({ title: "Wooden grinder Amnesia Haze.jpg" } as any, "Amnesia Haze"),
    false,
  );
});
test("descriptions contain only attributed fields and disclose conflicting sources", () => {
  const facts = [
    { field: "lineage" as const, value: "A × B", source: "https://www.wikidata.org/wiki/Q123" },
    {
      field: "lineage" as const,
      value: "A × C",
      source: "https://www.leafly.com/strains/amnesia-haze",
    },
  ];
  assert.deepEqual(conflictingFacts(facts), ["lineage"]);
  assert.match(originalSpanishDescription("Amnesia Haze", facts), /A × B/);
  assert.equal(originalSpanishDescription("Runtz", []), "");
  assert.equal(
    originalSpanishDescription("Runtz", [
      { field: "aroma", value: "invented", source: "https://evil.test" },
    ]),
    "",
  );
});
test("research rejects ambiguous entities, missing licences and unavailable sources without inventing facts", async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (input) => {
    const u = String(input);
    calls.push(u);
    return new Response(
      JSON.stringify(
        u.includes("wikidata")
          ? { search: [{ id: "Q1", label: "Northern Lights", description: "aurora" }] }
          : {
              query: {
                pages: {
                  1: {
                    title: "File:Northern Lights.jpg",
                    imageinfo: [{ url: "https://evil.test/fake.jpg" }],
                  },
                },
              },
            },
      ),
      { headers: { "content-type": "application/json" } },
    );
  };
  const r = await researchGenetics("Northern Lights", request);
  assert.deepEqual(r.facts, []);
  assert.deepEqual(r.images, []);
  assert.ok(r.warnings.length);
  assert.equal(calls.length, 2);
  const unavailable = await researchGenetics("Runtz", async () => {
    throw new Error("offline");
  });
  assert.deepEqual(unavailable.facts, []);
  assert.deepEqual(unavailable.images, []);
});
test("local IT/ES informational commands cannot become a member lookup or economic action", () => {
  for (const text of [
    "SNOOP, cerca la genetica Amnesia Haze",
    "SNOOP, busca la genética Amnesia Haze",
    "apri scheda botanica Amnesia Haze",
  ]) {
    assert.equal(informationalVoiceCommand(text)?.query, "Amnesia Haze");
    assert.equal(privateVoiceCommand(text).navigateTo, "/geneticas");
    assert.equal(privateVoiceCommand(text).memberDraft, null);
  }
  assert.equal(informationalVoiceCommand("crea socio nome Persona"), null);
});
test("administrative corrections are patches: spoken IT/ES phone and email leave other fields alone", () => {
  assert.deepEqual(parseAdministrativeDictation("No, il nome è Persona"), {
    first_name: "Persona",
  });
  assert.deepEqual(parseAdministrativeDictation("No, el apellido es Sintético"), {
    last_name: "Sintético",
  });
  assert.deepEqual(
    parseAdministrativeDictation("telefono sei sei sei sette sette sette otto otto otto"),
    { phone: "666777888" },
  );
  assert.deepEqual(
    parseAdministrativeDictation("teléfono seis seis seis siete siete siete ocho ocho ocho"),
    { phone: "666777888" },
  );
  assert.deepEqual(parseAdministrativeDictation("correo prueba arroba ejemplo punto test"), {
    email: "prueba@ejemplo.test",
  });
  assert.deepEqual(parseAdministrativeDictation("email prova chiocciola esempio punto test"), {
    email: "prova@esempio.test",
  });
});

test("IT/ES named-month birth dates remain strict and invalid dates cannot overwrite fields", () => {
  assert.deepEqual(parseAdministrativeDictation("data di nascita 24 luglio 1995"), {
    birth_date: "1995-07-24",
  });
  assert.deepEqual(parseAdministrativeDictation("fecha de nacimiento 24 de julio de 1995"), {
    birth_date: "1995-07-24",
  });
  assert.deepEqual(parseAdministrativeDictation("fecha de nacimiento 31 de febrero de 2000"), {});
});

test("successful open-data lookup proposes only returned classification and an attributed botanical image", async () => {
  const response = await researchGenetics(
    "White Widow",
    async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes("wikidata")
            ? { search: [{ id: "Q123", label: "White Widow", description: "cannabis strain" }] }
            : {
                query: {
                  pages: {
                    1: {
                      title: "File:White Widow.jpg",
                      imageinfo: [
                        {
                          url: "https://upload.wikimedia.org/a/white.jpg",
                          descriptionurl: "https://commons.wikimedia.org/wiki/File:White_Widow.jpg",
                          extmetadata: {
                            ImageDescription: { value: "White Widow cannabis flower" },
                            Artist: { value: "Synthetic test author" },
                            LicenseShortName: { value: "Public domain" },
                          },
                        },
                      ],
                    },
                  },
                },
              },
        ),
      ),
  );
  assert.deepEqual(response.facts, [
    {
      field: "botany",
      value: "variedad de Cannabis identificada en Wikidata",
      source: "https://www.wikidata.org/wiki/Q123",
    },
  ]);
  assert.equal(response.images.length, 1);
  assert.equal(response.images[0].author, "Synthetic test author");
  assert.equal(
    response.facts.some(
      (f) => f.field === "breeder" || f.field === "aroma" || f.field === "lineage",
    ),
    false,
  );
});

test("stored image JSON cannot inject script/file/private-network URLs into another club user browser", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://127.0.0.1/a.jpg",
    "data:image/svg+xml,<svg/>",
  ])
    assert.equal(
      safeGeneticsImage({
        url,
        source: "https://commons.wikimedia.org/wiki/File:White_Widow.jpg",
        title: "White Widow",
        author: "Synthetic",
        license: "Public domain",
        license_url: "https://commons.wikimedia.org/wiki/File:White_Widow.jpg",
      }),
      null,
    );
});

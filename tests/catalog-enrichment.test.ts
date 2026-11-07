import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import {
  licensedCatalogImages,
  searchCatalogImages,
  describeCatalog,
} from "../src/lib/catalog-enrichment.server.ts";
import {
  authorizeWorkersAi,
  workersAiFetch,
  FREE_TEXT_MODEL,
} from "../src/lib/workers-ai.server.ts";
const keys = [
  "AI_PROVIDER",
  "AI_EXTERNAL_PROCESSING_ENABLED",
  "AI_VOICE_ONLY",
  "AI_CATALOG_PROCESSING_ENABLED",
  "AI_PERSONAL_DATA_PROCESSING_ENABLED",
  "AI_CF_TEXT_MODEL",
];
const old = new Map(keys.map((k) => [k, process.env[k]]));
const globals = globalThis as any;
const oldBinding = globals.__env__;
afterEach(() => {
  for (const [k, v] of old) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  globals.__env__ = oldBinding;
});
const meta = (license = "CC BY-SA 4.0", title = "File:Synthetic Cup.jpg") => ({
  query: {
    pages: {
      1: {
        title,
        imageinfo: [
          {
            thumburl: "https://upload.wikimedia.org/wikipedia/commons/1/12/Synthetic_Cup.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Synthetic_Cup.jpg",
            extmetadata: {
              LicenseShortName: { value: license },
              LicenseUrl: {
                value: "https://creativecommons.org/licenses/by-sa/4.0/",
              },
              Artist: { value: "<b>Synthetic Author</b>" },
            },
          },
        ],
      },
    },
  },
});
test("catalog-only permission unlocks public descriptions while personal/document AI remain blocked", () => {
  Object.assign(process.env, {
    AI_EXTERNAL_PROCESSING_ENABLED: "true",
    AI_VOICE_ONLY: "true",
    AI_CATALOG_PROCESSING_ENABLED: "true",
    AI_PERSONAL_DATA_PROCESSING_ENABLED: "false",
  });
  assert.doesNotThrow(() => authorizeWorkersAi("catalog"));
  assert.throws(() => authorizeWorkersAi("administrative"));
  assert.throws(() => authorizeWorkersAi("documents"));
  process.env.AI_CATALOG_PROCESSING_ENABLED = "false";
  assert.throws(() => authorizeWorkersAi("catalog"));
});
test("Workers bridge accepts string and structured responses; rejects empty/malformed envelope", async () => {
  for (const response of ["Ficha informativa", { description: "Ficha informativa" }]) {
    const r = await workersAiFetch({ run: async () => ({ response }) })("https://unused.invalid", {
      body: JSON.stringify({ model: FREE_TEXT_MODEL, messages: [] }),
    });
    assert.equal(
      (await r.json()).choices[0].message.content,
      typeof response === "string" ? response : JSON.stringify(response),
    );
  }
  await assert.rejects(
    workersAiFetch({ run: async () => ({ text: "incorrect envelope" }) })(
      "https://unused.invalid",
      { body: JSON.stringify({ model: FREE_TEXT_MODEL }) },
    ),
    /no válida/,
  );
});
test("real AI SDK description integration uses only public fields and one binding call", async () => {
  Object.assign(process.env, {
    AI_PROVIDER: "cloudflare",
    AI_EXTERNAL_PROCESSING_ENABLED: "true",
    AI_VOICE_ONLY: "true",
    AI_CATALOG_PROCESSING_ENABLED: "true",
    AI_PERSONAL_DATA_PROCESSING_ENABLED: "false",
  });
  let calls = 0;
  globals.__env__ = {
    SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
    SNOOP_AI: {
      run: async (model: string, input: any) => {
        calls++;
        assert.equal(model, FREE_TEXT_MODEL);
        assert.deepEqual(JSON.parse(input.messages.at(-1).content), {
          name: "Synthetic Cup",
          category_name: "Resources",
          strain: "",
        });
        return {
          response: "Ficha informativa de Synthetic Cup. Detalles pendientes de verificación.",
        };
      },
    },
  };
  assert.match(
    await describeCatalog({
      name: "Synthetic Cup",
      category_name: "Resources",
      strain: "",
    }),
    /Synthetic Cup/,
  );
  assert.equal(calls, 1);
});
test("images require exact phrase, known license, attribution and authorized bitmap source", () => {
  assert.equal(licensedCatalogImages(meta(), "Synthetic Cup").length, 1);
  assert.equal(licensedCatalogImages(meta(), "Different Cup").length, 0);
  assert.equal(licensedCatalogImages(meta("All rights reserved"), "Synthetic Cup").length, 0);
  const missing = meta();
  delete (missing.query.pages[1].imageinfo[0].extmetadata as any).Artist;
  assert.equal(licensedCatalogImages(missing, "Synthetic Cup").length, 0);
  const unsafe = meta();
  unsafe.query.pages[1].imageinfo[0].thumburl = "https://evil.example.test/tracker.jpg";
  assert.equal(licensedCatalogImages(unsafe, "Synthetic Cup").length, 0);
  assert.equal(
    licensedCatalogImages(meta("CC BY-SA 4.0", "File:Synthetic Cupboard.jpg"), "Synthetic Cup")
      .length,
    0,
  );
});
test("image lookup uses fixed free source and fails without invented fallback", async () => {
  const items = await searchCatalogImages("Synthetic Cup", (async (url: any, init: any) => {
    assert.equal(new URL(url).origin, "https://commons.wikimedia.org");
    assert.equal(init.redirect, "error");
    return Response.json(meta());
  }) as typeof fetch);
  assert.equal(items.length, 1);
  await assert.rejects(
    searchCatalogImages(
      "Synthetic Cup",
      (async () => new Response("quota", { status: 429 })) as typeof fetch,
    ),
    /imagen propia/,
  );
});

test("official Wikimedia thumbnails and historical HTTP license references are accepted securely", () => {
  const response = meta();
  const info = response.query.pages[1].imageinfo[0];
  info.thumburl = "https://thumb.wikimedia.org/test/Synthetic_Cup.jpg";
  info.extmetadata.LicenseUrl.value = "http://creativecommons.org/licenses/by-sa/4.0/";
  const items = licensedCatalogImages(response, "Synthetic Cup");
  assert.equal(items.length, 1);
  assert.equal(items[0].license_url, "https://creativecommons.org/licenses/by-sa/4.0/");
  info.extmetadata.LicenseUrl.value = "https://creativecommons.org/licenses/by/4.0/";
  assert.equal(licensedCatalogImages(response, "Synthetic Cup").length, 0);
});

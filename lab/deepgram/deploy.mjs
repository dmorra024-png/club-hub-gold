import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
const BASE =
  "https://api.cloudflare.com/client/v4/accounts/0cc8106f8820d22996af3aed9e081e93/workers/scripts/snoop-voice-lab";
const token = process.env.CLOUDFLARE_API_TOKEN;
assert(token, "LAB_CLOUDFLARE_TOKEN_MISSING");
assert.equal(process.env.SNOOP_LAB_ONLY, "CONFIRM_ISOLATED_DEEPGRAM_SYNTHETIC");
const headers = { Authorization: `Bearer ${token}` };
async function settings() {
  const r = await fetch(BASE + "/settings", {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(r.status, 200, "LAB_SETTINGS_HTTP");
  const j = await r.json();
  assert(j.success, "LAB_SETTINGS_FAILED");
  return j.result;
}
const before = await settings(),
  allowed = ["secret_text", "plain_text", "json", "ai"];
assert(
  (before.bindings || []).every((b) => allowed.includes(b.type)),
  "LAB_UNEXPECTED_RESOURCE",
);
assert(
  before.bindings.some((b) => b.name === "DEEPGRAM_API_KEY" && b.type === "secret_text"),
  "LAB_DEEPGRAM_SECRET_MISSING",
);
assert(
  before.bindings.some((b) => b.name === "VOICE_PREVIEW_KEY" && b.type === "secret_text"),
  "LAB_PREVIEW_AUTH_MISSING",
);
assert(
  before.bindings.filter((b) => b.type === "ai").every((b) => b.name === "SNOOP_AI"),
  "LAB_UNEXPECTED_AI_BINDING",
);
assert.equal(
  before.observability?.enabled ?? false,
  false,
  "LAB_EXISTING_LOGGING_MUST_BE_DISABLED",
);
async function readSource() {
  let response;
  // Only bounded GETs to this lab. Never retry the upload or an authorization failure.
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(BASE, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404)
      response = await fetch(BASE + "/content/v2", {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
    if (response.status !== 404) return response;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500));
  }
  return response;
}
const original = await readSource();
assert.equal(original.status, 200, "LAB_SOURCE_READ_FAILED");
assert.match(original.headers.get("content-type") || "", /^multipart/, "LAB_EXPECTS_MODULE_WORKER");
const previousEntry = original.headers.get("cf-entrypoint");
assert(previousEntry, "LAB_ENTRYPOINT_MISSING");
const form = await original.formData(),
  modules = new Map();
for (const [name, file] of form.entries()) {
  if (name === "metadata") continue;
  modules.set(name, {
    text: typeof file === "string" ? file : await file.text(),
    type: file.type || "application/javascript+module",
  });
}
let entry = previousEntry;
if (entry === "__snoop_dg_wrapper.mjs") {
  entry = /original-lab-entrypoint: ([\w./-]+)/.exec(modules.get(entry)?.text || "")?.[1];
}
assert(
  entry && /^[\w./-]+$/.test(entry) && !entry.includes("..") && modules.has(entry),
  "LAB_ORIGINAL_ENTRYPOINT_UNSAFE",
);
const root = modules.get(entry).text;
assert(
  !/snoop-pilot|bnwanxbmprbymbutoths|supabase\.(co|com)|Security PSG/i.test(root),
  "LAB_PRODUCTION_REFERENCE",
);
assert(/export\s*\{[\s\S]*default|export\s+default/.test(root), "LAB_EXPECTS_DEFAULT_HANDLER");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const probeToken = randomBytes(32).toString("hex");
let compiled = (await readFile(".sandbox/deepgram-lab/module.mjs", "utf8")).replaceAll(
  "__LAB_PROBE_HASH__",
  hash(probeToken),
);
assert(!compiled.includes("__LAB_PROBE_HASH__"));
assert.match(process.env.GITHUB_SHA || "", /^[0-9a-f]{40}$/);
compiled = compiled.replaceAll("__LAB_BUILD_SHA__", process.env.GITHUB_SHA);
const wrapper = `// original-lab-entrypoint: ${entry}\nimport old from './${entry}';\nimport {labFetch,labAssets,safeJson} from './__snoop_dg_module.mjs';\nexport default {async fetch(req,env,ctx){const path=new URL(req.url).pathname;const asset=labAssets[path];if(asset&&req.method==='GET'){const headers=new Headers(safeJson({}).headers);headers.set('Content-Type',asset.type);return new Response(asset.content,{headers});}const response=await labFetch(req,env);return response??old.fetch(req,env,ctx);}};`;
const metadata = {
  main_module: "__snoop_dg_wrapper.mjs",
  compatibility_date: before.compatibility_date,
  compatibility_flags: before.compatibility_flags || [],
  keep_bindings: ["secret_text", "secret_key", "plain_text", "json"],
  bindings: (before.bindings || [])
    .filter((b) => b.type === "ai")
    .map((b) => ({ name: b.name, type: "ai" })),
  observability: { enabled: false },
};
const upload = new FormData();
upload.set("metadata", JSON.stringify(metadata));
for (const [name, f] of modules)
  if (!name.startsWith("__snoop_dg_")) upload.set(name, new File([f.text], name, { type: f.type }));
upload.set(
  "__snoop_dg_module.mjs",
  new File([compiled], "__snoop_dg_module.mjs", { type: "application/javascript+module" }),
);
upload.set(
  "__snoop_dg_wrapper.mjs",
  new File([wrapper], "__snoop_dg_wrapper.mjs", { type: "application/javascript+module" }),
);
const r = await fetch(BASE, {
  method: "PUT",
  headers,
  body: upload,
  redirect: "error",
  signal: AbortSignal.timeout(30000),
});
const result = await r.json();
if (!r.ok || !result.success) {
  console.log(
    JSON.stringify({
      worker: "snoop-voice-lab",
      deployment: "FAILED",
      http: r.status,
      errorCodes: result.errors?.map((e) => e.code),
    }),
  );
  throw Error("LAB_UPLOAD_FAILED_NO_AUTOMATIC_RETRY");
}
const after = await settings();
const signature = (b) => b.map((x) => `${x.name}:${x.type}`).sort();
assert.deepEqual(signature(after.bindings), signature(before.bindings), "LAB_BINDINGS_CHANGED");
const verify = await readSource();
assert.equal(verify.status, 200);
const vf = await verify.formData();
const v = vf.get(entry);
assert(
  v && hash(typeof v === "string" ? v : await v.text()) === hash(root),
  "LAB_ORIGINAL_CODE_CHANGED",
);
await mkdir(".sandbox/deepgram-lab", { recursive: true });
await writeFile(
  ".sandbox/deepgram-lab/deployment.json",
  JSON.stringify(
    {
      worker: "snoop-voice-lab",
      sha: process.env.GITHUB_SHA,
      versionId: result.result?.version_id || null,
      preservedBindings: signature(after.bindings),
      originalModuleSha256: hash(root),
      oldCodePreserved: true,
      secretWrites: false,
      productionTouched: false,
    },
    null,
    2,
  ),
);
console.log(
  "PASS only snoop-voice-lab updated; original modules, all secrets and AI binding preserved",
);
const live = spawnSync(process.execPath, ["lab/deepgram/check-live.mjs"], {
  stdio: "inherit",
  env: { ...process.env, LAB_PROBE_TOKEN: probeToken, CLOUDFLARE_API_TOKEN: "" },
});
process.exitCode = live.status ?? 1;

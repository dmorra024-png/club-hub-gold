import { defaultSerovalPlugins } from "@tanstack/router-core";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir, mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { toJSON, fromCrossJSON } from "seroval";
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve("miniflare", { paths: [require.resolve("wrangler")] }),
);
const root = resolve(".output/server");
const file = (await readdir(join(root, "_ssr"))).find((n) =>
  /^voice-agent.functions-.*\.mjs$/.test(n),
);
assert.ok(file, "Cloudflare build required");
const code = await readFile(join(root, "_ssr", file), "utf8");
function id(name) {
  const match = code.match(new RegExp("id:`([a-f0-9]+)`,name:`" + name + "`"));
  assert.ok(match, name);
  return match[1];
}
const user = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001";
const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const token =
  enc({ alg: "HS256", typ: "JWT" }) +
  "." +
  enc({
    sub: user,
    aud: "authenticated",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  }) +
  "." +
  Buffer.alloc(32).toString("base64url");
const vars = {
  SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
  AI_PROVIDER: "cloudflare",
  AI_EXTERNAL_PROCESSING_ENABLED: "true",
  AI_VOICE_PROCESSING_ENABLED: "true",
  AI_VOICE_ONLY: "true",
  AI_PERSONAL_DATA_PROCESSING_ENABLED: "false",
  AI_DOCUMENT_PROCESSING_ENABLED: "false",
  AI_CATALOG_PROCESSING_ENABLED: "false",
  AI_CF_TRANSCRIBE_MODEL: "@cf/openai/whisper-large-v3-turbo",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_SYNTHETIC",
  APP_URL: "https://synthetic.test",
};
let writes = 0;
async function outbound(request) {
  const u = new URL(request.url);
  assert.equal(u.origin, "http://127.0.0.1:54321", "no real network permitted");
  if (u.pathname === "/auth/v1/user")
    return Response.json({
      id: user,
      aud: "authenticated",
      role: "authenticated",
      email: "synthetic@example.test",
    });
  const rpc = u.pathname.split("/").at(-1);
  if (rpc === "is_super_admin") return Response.json(false);
  if (rpc === "current_club_id") return Response.json(club);
  if (rpc === "can_operate_club") return Response.json(true);
  writes++;
  throw new Error("Unexpected outbound request");
}
const dir = await mkdtemp(join(tmpdir(), "snoop-workerd-voice-"));
try {
  await cp(root, dir, { recursive: true });
  const entry = join(dir, "index.mjs"),
    original = await readFile(entry, "utf8");
  assert.ok(original.includes("globalThis.__env__="));
  // Fault injection disables Nitro's global fallback, without changing Request.runtime.
  // A request-scoped implementation must continue working in the actual Workerd bundle.
  await writeFile(
    entry,
    original.replaceAll("globalThis.__env__=", "globalThis.__snoop_unused_global__="),
  );
  const modules = [
    { type: "ESModule", path: entry },
    ...(await readdir(dir, { recursive: true }))
      .filter((n) => n.endsWith(".mjs") && n !== "index.mjs")
      .map((n) => ({ type: "ESModule", path: join(dir, n) })),
  ];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "app",
          modules,
          modulesRoot: dir,
          compatibilityDate: "2026-11-05",
          compatibilityFlags: ["nodejs_compat"],
          bindings: vars,
          serviceBindings: { SNOOP_AI: { name: "ai", entrypoint: "SyntheticAi" } },
          outboundService: outbound,
        },
        {
          name: "ai",
          modules: true,
          script: `import {WorkerEntrypoint} from 'cloudflare:workers'; export class SyntheticAi extends WorkerEntrypoint {async run(model,input){if(model!=='@cf/openai/whisper-large-v3-turbo'||input.language!=='es')throw new Error('Unexpected model input');if(input.audio==='UVVPVEE=')throw new Error('Synthetic free allocation exhausted PRIVATE_PROVIDER_PAYLOAD');if(input.audio!=='U1lOVEhFVElD')throw new Error('Unexpected audio');return {text:'Crear socio'};}} export default {fetch(){return new Response('no public AI endpoint',{status:404})}};`,
          compatibilityDate: "2026-11-05",
        },
      ],
    }),
  );
  try {
    const headers = {
      authorization: "Bearer " + token,
      "x-tsr-serverFn": "true",
      "content-type": "application/json",
    };
    const call = async (name, data) => {
      const response = await mf.dispatchFetch(
        "https://synthetic.test/_serverFn/" + id(name),
        data === undefined
          ? { headers }
          : { headers, method: "POST", body: JSON.stringify(toJSON({ data })) },
      );
      assert.equal(response.status, 200);
      const wire = await response.json();
      const result = fromCrossJSON(wire, { refs: new Map(), plugins: defaultSerovalPlugins });
      if (result instanceof Error) throw result;
      if (result.error) throw result.error;
      return result.result;
    };
    const status = await call("getAdministrativeAiStatus");
    assert.equal(status.available, true, JSON.stringify(status));
    const transcript = await call("transcribeAudio", {
      audioBase64: "U1lOVEhFVElD",
      mimeType: "audio/webm",
      language: "es",
    });
    assert.equal(transcript.text, "Crear socio");
    await assert.rejects(
      call("transcribeAudio", {
        audioBase64: "UVVPVEE=",
        mimeType: "audio/webm",
        language: "es",
      }),
      (error) => error instanceof Error && error.message === "SNOOP_WHISPER_QUOTA",
    );
    assert.equal(writes, 0);
    console.log(
      "PASS actual Workerd + Nitro + TanStack request-scoped availability, audio transport and bounded quota errors; synthetic auth/model, no real network or writes",
    );
  } finally {
    await mf.dispose();
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

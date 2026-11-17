import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
const compiled = process.argv.includes("--compiled");
const require = createRequire(import.meta.url),
  { Miniflare, convertV4MiniflareOptions } = require(
    require.resolve("miniflare", { paths: [require.resolve("wrangler")] }),
  );
const bundled = await build({
  entryPoints: ["src/lib/deepgram-app-gateway.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const script =
  bundled.outputFiles[0].text +
  '\nexport default{async fetch(req,env){return await deepgramAppSocket(req,req.headers.get("x-test-wrong-project")?{...env,SUPABASE_URL:"https://other-project.example.invalid"}:env)??new Response("normal app");}}';
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001";
const bindings = {
  DEEPGRAM_API_KEY: "test-provider-only",
  SNOOP_DEEPGRAM_PILOT_ENABLED: "true",
  SNOOP_DEEPGRAM_PILOT_USER_ID: uid,
  SNOOP_DEEPGRAM_PILOT_CLUB_ID: club,
  SUPABASE_URL: "https://bnwanxbmprbymbutoths.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic-meter",
  SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
};
const fake = `let providerCalls=0,authCalls=0,forbiddenCalls=0,tools=0;export default{async fetch(req){const u=new URL(req.url),token=req.headers.get('Authorization')||'';
 if(u.hostname==='metrics.invalid')return Response.json({providerCalls,authCalls,forbiddenCalls,tools});
 if(u.hostname==='bnwanxbmprbymbutoths.supabase.co'){
  if(u.pathname==='/rest/v1/rpc/snoop_voice_usage'){
   if(req.headers.get('apikey')!=='sb_secret_synthetic-meter'||req.method!=='POST')throw Error('Meter credential scope');
   const p=await req.json();if(p.p_actor!=='${uid}'||p.p_club!=='${club}')throw Error('Meter identity');
   return Response.json({session:p.p_id,sequence:p.p_sequence,state:p.p_operation==='close'?'closed':'active',leaseUntil:new Date(Date.now()+30000).toISOString(),reservedSeconds:30*(p.p_sequence+1),remainingSeconds:3500,monthlySeconds:3600,connectedMs:p.p_connected_ms,estimatedMicrousd:null,billedCostVerified:false});
  }
  authCalls++;if(token.includes('revoked'))return new Response('denied',{status:401});
  if(u.pathname==='/auth/v1/user')return Response.json({id:token.includes('otheruser')?'00000000-0000-4000-8000-000000000002':'${uid}'});
  if(u.pathname==='/rest/v1/rpc/snoop_access_context')return Response.json({role:token.includes('staff')?'collaborator':'admin',status:'active',clubId:token.includes('otherclub')?'other-club':'${club}',permissions:['manage_members','manage_products','use_cash','view_reports']});
  if(['/rest/v1/products','/rest/v1/product_categories'].includes(u.pathname)&&req.method==='GET'&&u.searchParams.get('select')==='name'&&u.searchParams.get('club_id')==='eq.${club}')return Response.json([{name:u.pathname.endsWith('/products')?'Amnesia Haze':'Flores'}]);
  forbiddenCalls++;return new Response('unexpected data request',{status:403});
 }
 if(u.hostname==='agent.deepgram.com'&&u.pathname==='/v1/agent/converse'){
  providerCalls++;if(token!=='Token test-provider-only')return new Response('bad key',{status:401});
  const p=new WebSocketPair();p[1].binaryType='arraybuffer';p[1].accept();let count=0;
  p[1].addEventListener('message',e=>{if(typeof e.data==='string'){
   const m=JSON.parse(e.data);
   if(m.type==='Settings'){
    const r=m.agent.listen.provider,s=JSON.stringify(m);if(r.eot_threshold!==.85||r.eot_timeout_ms!==5000||!r.keyterms.includes('Amnesia Haze')||!r.keyterms.includes('Flores')||s.includes('${uid}')||s.includes('${club}')||s.includes('synthetic.authorized.token'))throw Error('Provider scope leaked');
    p[1].send(JSON.stringify({type:'SettingsApplied'}));
   }
   if(m.type==='FunctionCallResponse'){const r=JSON.parse(m.content);if(r.ok!==true||r.persisted!==false||r.requiresConfirmation!==true)throw Error('Unsafe tool result');tools++;p[1].send(new ArrayBuffer(2400));p[1].send(JSON.stringify({type:'AgentAudioDone'}));}
  }else{
   if(e.data.byteLength!==4800)throw Error('Not binary PCM');count++;p[1].send(JSON.stringify({type:'UserStartedSpeaking'}));p[1].send(JSON.stringify({type:'ConversationText',role:'user',content:'Synthetic administrative draft'}));p[1].send(JSON.stringify({type:'AgentThinking'}));p[1].send(JSON.stringify({type:'FunctionCallRequest',functions:[{id:'draft-'+count,name:'snoop_propose',client_side:true,arguments:JSON.stringify({intent:'member',target:'member_create',member:count===1?{first_name:'Ana',last_name:'Prueba'}:{city:'Palma'},product:{},query:null,declined:[],question:'',asking:null})}]}));
  }});return new Response(null,{status:101,webSocket:p[0]});
 }
 forbiddenCalls++;return new Response('unexpected network request',{status:403});
}}`;
const compiledFiles = compiled
  ? [
      "index.mjs",
      ...(await readdir(".output/server", { recursive: true })).filter(
        (n) => n.endsWith(".mjs") && n !== "index.mjs",
      ),
    ]
  : [];
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: "app",
        modules: true,
        ...(compiled
          ? {
              modulesRoot: resolve(".output/server"),
              modules: compiledFiles.map((path) => ({
                type: "ESModule",
                path: resolve(".output/server", path),
              })),
            }
          : { script }),
        compatibilityFlags: ["nodejs_compat"],
        compatibilityDate: "2026-11-05",
        bindings,
        outboundService: "fake",
      },
      {
        name: "wrong-config",
        modules: true,
        script,
        compatibilityDate: "2026-11-05",
        bindings: { ...bindings, SUPABASE_URL: "https://other-project.example.invalid" },
        outboundService: "fake",
      },
      { name: "fake", modules: true, script: fake, compatibilityDate: "2026-11-05" },
    ],
  }),
);
const base = "https://snoop-pilot.dmorra024.workers.dev";
async function socket(token, wrongConfig = false, autoAck = true) {
  const r = await mf.dispatchFetch(base + "/api/snoop-deepgram/socket", {
    headers: {
      Origin: base,
      Upgrade: "websocket",
      ...(wrongConfig ? { "x-test-wrong-project": "true" } : {}),
    },
  });
  assert.equal(r.status, 101);
  const ws = r.webSocket;
  ws.binaryType = "arraybuffer";
  ws.accept();
  const events = [];
  ws.addEventListener("message", (e) => {
    const m =
      typeof e.data === "string" ? JSON.parse(e.data) : { type: "Audio", size: e.data.byteLength };
    events.push(m);
    if (autoAck && m.type === "AppProposal" && m.result.ok)
      ws.send(
        JSON.stringify({
          type: "AppActionResult",
          id: m.id,
          status: "prepared",
          applied: [],
          skipped: [],
          code: "OK",
        }),
      );
  });
  ws.send(
    JSON.stringify({
      type: "AppStart",
      token,
      language: "it",
      sampleRate: 24000,
      consent: true,
      synthetic: true,
    }),
  );
  return {
    ws,
    events,
    acknowledge: () => {
      autoAck = true;
    },
  };
}
async function until(test, ms = 4000) {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert(test(), "worker condition timed out");
}
try {
  const stats = async () =>
    await (await (await mf.getWorker("fake")).fetch("https://metrics.invalid")).json();
  for (const scenario of ["staff", "otheruser", "otherclub", "revoked"]) {
    const s = await socket("synthetic." + scenario + ".token");
    await until(() => s.events.some((e) => e.type === "AppClosed"));
    assert(!s.events.some((e) => e.type === "AppReady"));
    s.ws.close();
  }
  assert.equal((await stats()).providerCalls, 0);
  if (!compiled) {
    const wrong = await socket("synthetic.authorized.token", true);
    await until(() => wrong.events.some((e) => e.type === "AppClosed"));
    assert(wrong.events.some((e) => e.code === "AUTH_CONFIG"));
    wrong.ws.close();
    assert.equal((await stats()).providerCalls, 0);
  }
  const s = await socket("synthetic.authorized.token", false, false);
  await until(() => s.events.some((e) => e.type === "AppReady"));
  s.ws.send(new ArrayBuffer(4800));
  await until(() => s.events.some((e) => e.type === "AppProposal" && e.result.ok));
  assert.equal(
    (await stats()).tools,
    0,
    "provider must not hear success before UI acknowledgement",
  );
  const first = s.events.find((e) => e.type === "AppProposal" && e.result.ok);
  const receipt = JSON.stringify({
    type: "AppActionResult",
    id: first.id,
    status: "prepared",
    applied: ["first_name", "last_name"],
    skipped: [],
    code: "OK",
  });
  s.ws.send(receipt);
  s.ws.send(receipt);
  s.acknowledge();
  await until(() => s.events.some((e) => e.type === "Audio"));
  const concurrent = await socket("synthetic.authorized.token");
  await until(() => concurrent.events.some((e) => e.type === "AppClosed"));
  assert(concurrent.events.some((e) => e.code === "SESSION_LIMIT"));
  concurrent.ws.close();
  assert.equal((await stats()).providerCalls, 1);
  for (let turn = 0; turn < 7; turn++) {
    await new Promise((r) => setTimeout(r, 14000));
    assert(
      !s.events.some((e) => e.type === "AppClosed"),
      "continuous conversation must survive beyond 90 seconds",
    );
    s.ws.send(new ArrayBuffer(4800));
    await until(
      () => s.events.filter((e) => e.type === "AppProposal" && e.result.ok).length === turn + 2,
    );
  }
  s.ws.send("STOP");
  await until(() => s.events.some((e) => e.code === "STOPPED"));
  s.ws.close();
  const final = await stats();
  assert.equal(final.forbiddenCalls, 0);
  assert.equal(final.tools, 8);
  assert.equal(final.providerCalls, 1);
  assert(!JSON.stringify(s.events).includes("test-provider-only"));
  console.log(
    (compiled ? "PASS compiled application Worker: " : "PASS isolated Workerd gateway: ") +
      " JWT verification, wrong user/club/staff/revoked denied, exact names-only RLS requests, binary audio, eight turns beyond 90s with renewed budget leases, one active session, no writes or secret exposure (provider simulated)",
  );
} finally {
  await mf.dispose();
}

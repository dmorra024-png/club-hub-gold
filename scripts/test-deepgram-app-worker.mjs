import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
const executionMode = process.argv.includes("--execution");
const compiled = process.argv.includes("--compiled");
const closeRetryOnly = process.argv.includes("--close-retry");
const noThinking = process.argv.includes("--no-thinking");
const conversationTurns = noThinking ? 20 : closeRetryOnly ? 2 : 8;
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
  // Production already uses nodejs_compat; resolve built-ins in Workerd itself.
  external: ["node:*"],
  target: "es2022",
});
const script =
  bundled.outputFiles[0].text +
  '\nexport default{async fetch(req,env,ctx){req.waitUntil=ctx.waitUntil.bind(ctx);return await deepgramAppSocket(req,req.headers.get("x-test-wrong-project")?{...env,SUPABASE_URL:"https://other-project.example.invalid"}:env)??new Response("normal app");}}';
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001";
const bindings = {
  SNOOP_VOICE_EXECUTION_PILOT_ENABLED: executionMode ? "true" : "false",
  DEEPGRAM_API_KEY: "test-provider-only",
  SNOOP_DEEPGRAM_PILOT_ENABLED: "true",
  SNOOP_DEEPGRAM_PILOT_USER_ID: uid,
  SNOOP_DEEPGRAM_PILOT_CLUB_ID: club,
  SUPABASE_URL: "https://bnwanxbmprbymbutoths.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic-meter",
  SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
};
const fake = `let providerCalls=0,authCalls=0,forbiddenCalls=0,tools=0,closeAttempts=0;const closeDurations=[],cashResponses=[],tables=[];let executionWrites=0;const executionRecords=new Map();export default{async fetch(req){const u=new URL(req.url),token=req.headers.get('Authorization')||'';
 if(u.hostname==='metrics.invalid')return Response.json({providerCalls,authCalls,forbiddenCalls,tools,closeAttempts,closeDurations,cashResponses,tables,executionWrites});
 if(u.hostname==='bnwanxbmprbymbutoths.supabase.co'){
  if(u.pathname==='/rest/v1/rpc/snoop_voice_usage'){
   if(req.headers.get('apikey')!=='sb_secret_synthetic-meter'||req.method!=='POST')throw Error('Meter credential scope');
   const p=await req.json();if(p.p_actor!=='${uid}'||p.p_club!=='${club}')throw Error('Meter identity');
   if(p.p_operation==='close'){closeAttempts++;closeDurations.push(p.p_connected_ms);if(closeAttempts===1)return Response.json({message:'synthetic transient close failure'},{status:503});}
   return Response.json({session:p.p_id,sequence:p.p_sequence,state:p.p_operation==='close'?'closed':'active',leaseUntil:new Date(Date.now()+30000).toISOString(),reservedSeconds:30*(p.p_sequence+1),remainingSeconds:3500,monthlySeconds:3600,connectedMs:p.p_connected_ms,estimatedMicrousd:null,billedCostVerified:false});
  }
  if(u.pathname==='/rest/v1/rpc/snoop_voice_access'){
   if(token!=='Bearer synthetic.authorized.token')throw Error('Execution identity');
   const body=await req.json();let value=executionRecords.get(body.p_request);
   if(body.p_operation==='prepare'){value={id:body.p_request,status:'confirmation_required',enabled:body.p_enabled,result:null,token:'${uid}'};executionRecords.set(body.p_request,value);}
   if(!value)return new Response('missing',{status:404});
   if(body.p_operation==='confirm'){if(body.p_token!=='${uid}')throw Error('Confirmation token');if(value.status!=='completed'){executionWrites++;value={...value,status:'completed',result:{enabled:value.enabled},token:null};executionRecords.set(body.p_request,value);}}
   return Response.json(value);
  }
  authCalls++;tables.push(u.pathname);if(token.includes('revoked'))return new Response('denied',{status:401});
  if(u.pathname==='/auth/v1/user')return Response.json({id:token.includes('otheruser')?'00000000-0000-4000-8000-000000000002':'${uid}'});
  if(u.pathname==='/rest/v1/rpc/snoop_access_context')return Response.json({role:token.includes('staff')?'collaborator':'admin',status:'active',clubId:token.includes('otherclub')?'other-club':'${club}',permissions:['manage_members','manage_products','use_cash','view_reports']});
  if(['/rest/v1/products','/rest/v1/product_categories'].includes(u.pathname)&&req.method==='GET'&&u.searchParams.get('select')==='name'&&u.searchParams.get('club_id')==='eq.${club}'){if(u.searchParams.has('name')){if(u.searchParams.get('name')!=='ilike.%Flores Especial%'||u.searchParams.get('limit')!=='7')throw Error('Unbounded catalog lookup');return Response.json([{name:'Flores Especial'}]);}return Response.json([{name:u.pathname.endsWith('/products')?'Amnesia Haze':'Flores'}]);}
  if(u.pathname==='/rest/v1/rpc/is_current_user_club_admin'&&req.method==='POST')return Response.json(true);
  if(['/rest/v1/orders','/rest/v1/membership_receipts','/rest/v1/cash_sessions','/rest/v1/financial_order_reversals','/rest/v1/financial_order_refunds','/rest/v1/profiles'].includes(u.pathname)&&req.method==='GET'){
   if(!token.includes('authorized'))throw Error('Cash requires user JWT');
   if(!u.pathname.endsWith('/profiles')&&u.searchParams.get('club_id')!=='eq.${club}')throw Error('Cash club filter');
   return Response.json([]);
  }
  forbiddenCalls++;return new Response('unexpected data request',{status:403});
 }
 if(['www.wikidata.org','commons.wikimedia.org','html.duckduckgo.com','www.leafly.com','www.strainpedia.com','seedfinder.eu','www.allbud.com','www.wikileaf.com'].includes(u.hostname)){
  if(token||req.headers.get('apikey'))throw Error('Credentials leaked to public source');
  if(u.hostname==='www.wikidata.org')return Response.json({search:[{id:'Q123',label:'Amnesia Haze',description:'cannabis strain'}]});
  if(u.hostname==='commons.wikimedia.org')return Response.json({});
  if(u.pathname==='/robots.txt')return new Response('User-agent: *'+String.fromCharCode(10)+'Disallow: /');
  return new Response('');
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
   if(m.type==='FunctionCallResponse'){const r=JSON.parse(m.content);
    if(m.name==='snoop_access_control'){if(!r.ok||r.status!=='completed'||r.persisted!==true||m.content.includes('${uid}'))throw Error('Unverified execution outcome');tools++;p[1].send(JSON.stringify({type:'AgentStartedSpeaking'}));p[1].send(new ArrayBuffer(2400));p[1].send(JSON.stringify({type:'AgentAudioDone'}));return;}
    if(m.name==='snoop_catalog_search'){if(!r.ok||r.persisted!==false||r.matches.length!==1||r.matches[0]!=='Flores Especial')throw Error('Catalog lookup result');tools++;p[1].send(JSON.stringify({type:'FunctionCallRequest',functions:[{id:'catalog-draft-'+count,name:'snoop_propose',client_side:true,arguments:JSON.stringify({intent:'product',target:'product_create',member:{},product:{name:'Synthetic',category:'Flores Especial'},query:null,declined:[],question:'',asking:null})}]}));return;}
if(m.name==='snoop_cash_day')cashResponses.push({ok:r.ok,code:r.code,status:r.status,summary:r.summary});if(r.ok!==true||r.persisted!==false)throw Error('Unsafe tool result');if(m.name==='snoop_cash_day'){if(r.status!=='read'||r.summary.day!=='2026-10-25'||r.summary.cents!==0||r.summary.scope!=='club')throw Error('Cash day mismatch');}else if(m.name==='snoop_cash_period'){if(r.from!=='2026-10-24'||r.to!=='2026-10-25'||r.cents!==0||r.measurement!=='recorded_receipts')throw Error('Period result mismatch');}else if(m.name==='snoop_genetics_information'){if(!r.verified||!r.sources.includes('https://www.wikidata.org/wiki/Q123'))throw Error('Botanical source missing');}else if(r.requiresConfirmation!==true)throw Error('Missing manual confirmation');tools++;p[1].send(JSON.stringify({type:'AgentStartedSpeaking'}));p[1].send(new ArrayBuffer(2400));p[1].send(JSON.stringify({type:'AgentAudioDone'}));}
  }else{
   if(e.data.byteLength!==4800)throw Error('Not binary PCM');count++;
   if(new Uint8Array(e.data)[0]===5){p[1].send(JSON.stringify({type:'UserStartedSpeaking'}));p[1].send(JSON.stringify({type:'FunctionCallRequest',functions:[{id:'execute-'+count,name:'snoop_access_control',client_side:true,arguments:JSON.stringify({enabled:false})}]}));return;}
   if([3,4].includes(new Uint8Array(e.data)[0])){const period=new Uint8Array(e.data)[0]===3;p[1].send(JSON.stringify({type:'UserStartedSpeaking'}));p[1].send(JSON.stringify({type:'FunctionCallRequest',functions:[{id:'read-'+count,name:period?'snoop_cash_period':'snoop_genetics_information',client_side:true,arguments:JSON.stringify(period?{from:'2026-10-24',to:'2026-10-25'}:{name:'Amnesia Haze'})}]}));return;}
   if(new Uint8Array(e.data)[0]===2){p[1].send(JSON.stringify({type:'UserStartedSpeaking'}));p[1].send(JSON.stringify({type:'FunctionCallRequest',functions:[{id:'catalog-'+count,name:'snoop_catalog_search',client_side:true,arguments:JSON.stringify({kind:'categories',query:'Flores Especial'})}]}));return;}
   if(new Uint8Array(e.data)[0]===1){p[1].send(JSON.stringify({type:'UserStartedSpeaking'}));p[1].send(JSON.stringify({type:'FunctionCallRequest',functions:[{id:'cash-'+count,name:'snoop_cash_day',client_side:true,arguments:JSON.stringify({day:'2026-10-25'})}]}));return;}
   p[1].send(JSON.stringify({type:'UserStartedSpeaking'}));p[1].send(JSON.stringify({type:'ConversationText',role:'user',content:'Synthetic administrative draft'}));${noThinking ? "" : "p[1].send(JSON.stringify({type:'AgentThinking'}));"}p[1].send(JSON.stringify({type:'FunctionCallRequest',functions:[{id:'draft-'+count,name:'snoop_propose',client_side:true,arguments:JSON.stringify({intent:'member',target:'member_create',member:count===1?{first_name:'Ana',last_name:'Prueba'}:{city:'Palma'},product:{},query:null,declined:[],question:'',asking:null})}]}));
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
  assert(
    s.events.some((e) => e.type === "AgentStartedSpeaking"),
    "new audio turn signal must reach the browser",
  );
  const concurrent = await socket("synthetic.authorized.token");
  await until(() => concurrent.events.some((e) => e.type === "AppClosed"));
  assert(concurrent.events.some((e) => e.code === "SESSION_LIMIT"));
  concurrent.ws.close();
  assert.equal((await stats()).providerCalls, 1);
  for (let turn = 0; turn < conversationTurns - 1; turn++) {
    await new Promise((r) => setTimeout(r, closeRetryOnly || noThinking ? 20 : 14000));
    assert(
      !s.events.some((e) => e.type === "AppClosed"),
      "continuous conversation must survive beyond 90 seconds",
    );
    s.ws.send(new ArrayBuffer(4800));
    await until(
      () => s.events.filter((e) => e.type === "AppProposal" && e.result.ok).length === turn + 2,
    );
  }
  const cashAudio = new Uint8Array(4800);
  cashAudio[0] = 1;
  s.ws.send(cashAudio.buffer);
  await until(() =>
    s.events.some((e) => e.type === "AppCashResult" && e.summary.day === "2026-10-25"),
  ).catch(async (error) => {
    console.error(
      JSON.stringify({
        events: s.events
          .slice(-10)
          .map((e) => ({ type: e.type, code: e.code, resultCode: e.result?.code, day: e.cashDay })),
        stats: await stats(),
      }),
    );
    throw error;
  });
  assert(
    s.events.some((e) => e.type === "AppProposal" && e.cashDay === "2026-10-25"),
    "requested date must reach the existing report UI",
  );
  const lookupAudio = new Uint8Array(4800);
  lookupAudio[0] = 2;
  s.ws.send(lookupAudio.buffer);
  await until(() =>
    s.events.some(
      (e) =>
        e.type === "AppProposal" &&
        e.result.ok &&
        e.result.proposal.product?.category === "Flores Especial",
    ),
  );
  const periodAudio = new Uint8Array(4800);
  periodAudio[0] = 3;
  s.ws.send(periodAudio.buffer);
  await until(() =>
    s.events.some((e) => e.type === "AppCashPeriodResult" && e.summary.to === "2026-10-25"),
  );
  const beforeBotanical = (await stats()).tools;
  const botanicalAudio = new Uint8Array(4800);
  botanicalAudio[0] = 4;
  s.ws.send(botanicalAudio.buffer);
  await until(() => s.events.filter((e) => e.type === "Audio").length >= conversationTurns + 4);
  assert(
    (await stats()).tools > beforeBotanical,
    "provider must receive the actual sourced botanical result",
  );
  if (executionMode) {
    const input = new Uint8Array(4800);
    input[0] = 5;
    s.ws.send(input.buffer);
    await until(() => s.events.some((e) => e.type === "AppExecutionPrepared"));
    const prepared = s.events.find((e) => e.type === "AppExecutionPrepared");
    assert.equal((await stats()).executionWrites, 0);
    const confirm = JSON.stringify({
      type: "AppExecutionConfirm",
      id: prepared.id,
      token: prepared.token,
      confirmed: true,
    });
    s.ws.send(confirm);
    s.ws.send(confirm);
    await until(() =>
      s.events.some((e) => e.type === "AppExecutionResult" && e.status === "completed"),
    );
    assert.equal((await stats()).executionWrites, 1);
    s.ws.send(JSON.stringify({ type: "AppExecutionCheck", id: prepared.id }));
    await until(
      () =>
        s.events.filter((e) => e.type === "AppExecutionResult" && e.status === "completed")
          .length === 2,
    );
    assert.equal((await stats()).executionWrites, 1);
  }
  await until(
    () =>
      s.events.some((e) => e.type === "AppAudioHealth" && e.inputBytes > 0 && e.outputBytes > 0),
    5000,
  );
  const health = s.events.find(
    (e) => e.type === "AppAudioHealth" && e.inputBytes > 0 && e.outputBytes > 0,
  );
  assert.equal(
    health.inputBytes,
    health.forwardedInputBytes,
    "Authenticated input reached the provider socket",
  );
  assert.equal(health.inputBytes % 4800, 0);
  assert.deepEqual(
    Object.keys(health).sort(),
    [
      "type",
      "inputFrames",
      "inputBytes",
      "forwardedInputBytes",
      "outputFrames",
      "outputBytes",
      "providerUserMessages",
      "providerAssistantMessages",
    ].sort(),
  );
  s.ws.send("STOP");
  await until(() => s.events.some((e) => e.code === "STOPPED"));
  s.ws.close();
  const settleDeadline = Date.now() + 5000;
  while ((await stats()).closeAttempts < 2 && Date.now() < settleDeadline)
    await new Promise((r) => setTimeout(r, 25));
  const final = await stats();
  assert.equal(final.closeAttempts, 2, "gateway must retry the failed metering close once");
  assert.equal(
    final.closeDurations[0],
    final.closeDurations[1],
    "retry must not charge network outage time",
  );
  assert.equal(final.forbiddenCalls, 0);
  assert.equal(final.tools, conversationTurns + 5 + (executionMode ? 1 : 0));
  assert.equal(final.providerCalls, 1);
  assert(!JSON.stringify(s.events).includes("test-provider-only"));
  console.log(
    (compiled ? "PASS compiled application Worker: " : "PASS isolated Workerd gateway: ") +
      (noThinking
        ? " twenty consecutive turns without optional AgentThinking"
        : closeRetryOnly
          ? " two synthetic turns"
          : " eight turns beyond 90s") +
      (executionMode
        ? ", explicit server execution confirmation/status with synthetic backend; SQL persistence tested separately"
        : "") +
      ", explicit day/period cash reads and sourced botanical information, on-demand catalog lookup beyond initial snapshot, authenticated audio, one active session, failed close retried once with frozen duration, no production business writes or secret exposure (provider/backend simulated)",
  );
} finally {
  await mf.dispose();
}

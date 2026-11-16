import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url),
  { Miniflare, convertV4MiniflareOptions } = require(
    require.resolve("miniflare", { paths: [require.resolve("wrangler")] }),
  );
const compiled = await readFile(".sandbox/deepgram-lab/module.mjs", "utf8");
const fake = `export default{async fetch(req){if(new URL(req.url).hostname!=='agent.deepgram.com')return new Response('forbidden',{status:403});const p=new WebSocketPair();p[1].binaryType='arraybuffer';p[1].accept();p[1].addEventListener('message',e=>{if(typeof e.data==='string'){let m;try{m=JSON.parse(e.data)}catch{p[1].send(JSON.stringify({type:'ConversationText',role:'user',content:'WRONG_TEXT_FRAME'}));return;}if(m.type==='Settings')p[1].send(JSON.stringify({type:'SettingsApplied'}));}else{p[1].send(JSON.stringify({type:'ConversationText',role:'user',content:'binary:'+e.data.byteLength}));p[1].send(new ArrayBuffer(2400));}});return new Response(null,{status:101,webSocket:p[0]});}}`;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: "lab",
        modules: true,
        script: compiled + "\nexport default{async fetch(req,env){return labFetch(req,env)}}",
        compatibilityDate: "2026-11-05",
        bindings: { DEEPGRAM_API_KEY: "fake-only", VOICE_PREVIEW_KEY: "synthetic-preview-key" },
        outboundService: "fake",
      },
      { name: "fake", modules: true, script: fake, compatibilityDate: "2026-11-05" },
    ],
  }),
);
try {
  const r = await mf.dispatchFetch(
    "https://snoop-voice-lab.dmorra024.workers.dev/deepgram/socket",
    { headers: { Upgrade: "websocket", Origin: "https://snoop-voice-lab.dmorra024.workers.dev" } },
  );
  assert.equal(r.status, 101);
  const ws = r.webSocket;
  ws.binaryType = "arraybuffer";
  ws.accept();
  await new Promise((resolve, reject) => {
    let text = false,
      audio = false,
      round = 0;
    const timeout = setTimeout(() => reject(Error("LAB_BINARY_RELAY_TIMEOUT")), 18000);
    ws.addEventListener("message", (e) => {
      try {
        if (typeof e.data !== "string") {
          assert(e.data instanceof ArrayBuffer);
          assert.equal(e.data.byteLength, 2400);
          audio = true;
        } else {
          const m = JSON.parse(e.data);
          if (m.type === "LabReady") ws.send(new ArrayBuffer(4800));
          if (m.type === "ConversationText") {
            assert.equal(m.content, "binary:4800");
            text = true;
          }
          if (m.type === "LabClosed") throw Error(m.code);
        }
        if (text && audio) {
          if (round++ === 0) {
            text = false;
            audio = false;
            setTimeout(() => ws.send(new ArrayBuffer(4800)), 13000);
            return;
          }
          clearTimeout(timeout);
          ws.send("STOP");
          ws.close();
          resolve();
        }
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
    ws.send(
      JSON.stringify({
        type: "LabStart",
        key: "synthetic-preview-key",
        synthetic: true,
        language: "it",
        sampleRate: 24000,
      }),
    );
  });
  console.log(
    "PASS real Workerd binary round-trip: 4800 input bytes, 2400 output bytes, zero Blob/text conversion",
  );
} finally {
  await mf.dispose();
}

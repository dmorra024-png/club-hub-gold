const $ = (id) => document.getElementById(id);
let socket,
  context,
  stream,
  node,
  source,
  sink,
  active = false,
  session = 0,
  queue = [],
  playEnd = 0,
  suppress = false,
  lastUserAt = 0,
  firstAudioAt = 0,
  started = 0,
  captured = 0,
  audioBytes = 0,
  dirty = new Map(),
  turnVersion = new Map(),
  proposal = null;
const status = (t) => {
  $("status").textContent = t;
};
const fields = [...$("draft").elements];
for (const f of fields)
  f.addEventListener("input", () => dirty.set(f.name, (dirty.get(f.name) || 0) + 1));
function clearPlayback() {
  for (const n of queue) {
    try {
      n.stop();
    } catch {}
  }
  queue = [];
  playEnd = context?.currentTime || 0;
}
function stop(reason = "Sessione terminata. Microfono spento.") {
  session++;
  active = false;
  if (socket?.readyState === 1) socket.send("STOP");
  socket?.close();
  socket = null;
  clearPlayback();
  node?.disconnect();
  source?.disconnect();
  sink?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  void context?.close();
  context = null;
  $("start").disabled = false;
  $("stop").disabled = true;
  $("interrupt").disabled = true;
  $("status").dataset.active = "false";
  $("key").value = "";
  $("transcript").replaceChildren();
  status(reason);
}
function line(role, text) {
  const p = document.createElement("p");
  p.textContent = (role === "user" ? "Tu: " : "SNOOP: ") + text;
  $("transcript").append(p);
  while ($("transcript").children.length > 8) $("transcript").firstChild.remove();
}
async function play(data) {
  if (!active || suppress) return;
  const n = Math.floor(data.byteLength / 2);
  if (!n) return;
  const b = context.createBuffer(1, n, 24000),
    a = b.getChannelData(0),
    v = new DataView(data);
  for (let i = 0; i < n; i++) a[i] = v.getInt16(i * 2, true) / 32768;
  const sound = context.createBufferSource();
  sound.buffer = b;
  sound.connect(context.destination);
  const at = Math.max(context.currentTime + 0.015, playEnd);
  playEnd = at + b.duration;
  queue.push(sound);
  sound.onended = () => {
    queue = queue.filter((x) => x !== sound);
    if (active && !queue.length) status("● SNOOP in ascolto");
  };
  sound.start(at);
  audioBytes += data.byteLength;
  if (!firstAudioAt) {
    firstAudioAt = performance.now();
    $("metrics").textContent =
      `Prima risposta audio: ${((firstAudioAt - (lastUserAt || started)) / 1000).toFixed(2)} s dal riferimento locale. Non è una misura fine-frase del provider.`;
  }
  status("SNOOP sta parlando · puoi interrompere");
}
function proposed(msg) {
  if (!msg.ok) {
    $("proposal").textContent = "Proposta rifiutata dai controlli SNOOP.";
    return;
  }
  proposal = msg.proposal;
  $("screen").textContent = proposal.target || "Revisione bozza";
  for (const [k, v] of Object.entries({ ...proposal.member, ...proposal.product })) {
    const f = $("draft").elements.namedItem(k);
    if (f && (dirty.get(k) || 0) === (turnVersion.get(k) || 0)) f.value = v;
  }
  $("confirm").disabled = false;
  $("proposal").textContent = "Bozza preparata. Verifica i dati: nessun salvataggio eseguito.";
}
$("start").onclick = async () => {
  if (active) return;
  const key = $("key").value;
  if (key.length < 8 || !$("consent").checked) {
    status("Servono la chiave laboratorio esistente e il consenso per dati fittizi.");
    return;
  }
  active = true;
  const current = ++session;
  $("start").disabled = true;
  $("stop").disabled = false;
  status("Attivazione microfono…");
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ownContext = new AC();
    context = ownContext;
    await ownContext.resume();
    const ownStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (!active || session !== current) {
      ownStream.getTracks().forEach((t) => t.stop());
      void ownContext.close();
      return;
    }
    stream = ownStream;
    const worklet = `class Capture extends AudioWorkletProcessor{process(inputs){const a=inputs[0]?.[0];if(a){this.a??=new Float32Array(2048);this.n??=0;for(const x of a){this.a[this.n++]=x;if(this.n===2048){const b=new ArrayBuffer(4096),v=new DataView(b);for(let i=0;i<2048;i++)v.setInt16(i*2,Math.max(-32768,Math.min(32767,this.a[i]*32768)),true);this.port.postMessage(b,[b]);this.n=0;}}}return true;}}registerProcessor('snoop-lab-capture',Capture);`;
    const blob = URL.createObjectURL(new Blob([worklet], { type: "application/javascript" }));
    try {
      await ownContext.audioWorklet.addModule(blob);
    } finally {
      URL.revokeObjectURL(blob);
    }
    if (!active || session !== current) return;
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "snoop-lab-capture");
    sink = context.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(context.destination);
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/deepgram/socket`,
    );
    socket.binaryType = "arraybuffer";
    started = performance.now();
    firstAudioAt = 0;
    captured = 0;
    audioBytes = 0;
    let ready = false;
    socket.onopen = () => {
      if (session !== current || !active) return;
      socket.send(
        JSON.stringify({
          type: "LabStart",
          key,
          synthetic: true,
          language: $("language").value,
          sampleRate: context.sampleRate,
        }),
      );
    };
    node.port.onmessage = (e) => {
      if (
        session === current &&
        active &&
        ready &&
        socket?.readyState === 1 &&
        socket.bufferedAmount < 128000
      ) {
        // Half-duplex by default: do not send the agent's own playback into STT.
        if (context.currentTime < playEnd + 0.12) return;
        socket.send(e.data);
        captured += e.data.byteLength;
      }
    };
    socket.onmessage = async (e) => {
      if (session !== current || !active) return;
      if (typeof e.data !== "string") {
        await play(e.data);
        return;
      }
      const msg = JSON.parse(e.data);
      if (msg.type === "LabReady") {
        ready = true;
        $("interrupt").disabled = false;
        status("● SNOOP in ascolto");
        $("status").dataset.active = "true";
      }
      if (msg.type === "UserStartedSpeaking") {
        lastUserAt = performance.now();
        firstAudioAt = 0;
        turnVersion = new Map(dirty);
        clearPlayback();
        suppress = false;
        status("Ti ascolto…");
      }
      if (msg.type === "ConversationText") {
        line(msg.role, msg.content);
        if (msg.role === "user") status("SNOOP sta comprendendo…");
      }
      if (msg.type === "AgentThinking") {
        suppress = false;
        status("SNOOP sta comprendendo…");
      }
      if (msg.type === "LabProposal") proposed(msg);
      if (msg.type === "LabError")
        stop(`Deepgram: ${msg.code}${msg.http ? " · HTTP " + msg.http : ""}`);
      if (msg.type === "LabClosed") stop(`Sessione chiusa: ${msg.code}`);
    };
    socket.onerror = () => {
      if (session === current && active) stop("Connessione laboratorio non riuscita.");
    };
    socket.onclose = () => {
      if (session === current && active) stop("Connessione chiusa. Microfono spento.");
    };
  } catch (e) {
    if (session === current)
      stop(
        e.name === "NotAllowedError"
          ? "Permesso microfono negato."
          : `Microfono/audio non disponibile (${e.name || "errore"}).`,
      );
  }
};
$("stop").onclick = () => stop();
$("interrupt").onclick = () => {
  clearPlayback();
  suppress = true;
  status("● Parla ora per interrompere SNOOP");
};
$("confirm").onclick = () => {
  $("proposal").textContent =
    "Bozza confermata solo in questa pagina. Nessun dato scritto nel gestionale.";
  $("confirm").disabled = true;
};
$("draft").onsubmit = (e) => e.preventDefault();
document.addEventListener("visibilitychange", () => {
  if (document.hidden && active) stop("Sessione fermata passando in secondo piano.");
});
window.addEventListener("pagehide", () => {
  if (active) stop();
});

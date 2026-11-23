export type VoiceConnectionPhase =
  | "connecting"
  | "listening"
  | "paused"
  | "reconnecting"
  | "stopped";
/** One foreground microphone, replaceable sockets, bounded volatile pre-roll, no storage. */
export class VoiceTransport {
  private socket?: WebSocket;
  private stopped = false;
  private connecting = false;
  private ready = false;
  private paused = false;
  private attempts = 0;
  private version = 0;
  private checkpointSequence = 0;
  private resumeToken?: string;
  private retry?: ReturnType<typeof setTimeout>;
  private opening?: ReturnType<typeof setTimeout>;
  private queue: ArrayBuffer[] = [];
  private queuedBytes = 0;
  private speechMs = 0;
  private options: {
    url: string;
    sampleRate: number;
    resume?: string;
    payload: () => Promise<Record<string, unknown>>;
    message: (event: unknown) => void;
    binary: (audio: ArrayBuffer) => void;
    phase: (phase: VoiceConnectionPhase) => void;
    fatal: (code: string) => void;
    foreground: () => boolean;
    socketFactory?: (url: string) => WebSocket;
  };
  constructor(options: {
    url: string;
    sampleRate: number;
    resume?: string;
    payload: () => Promise<Record<string, unknown>>;
    message: (event: unknown) => void;
    binary: (audio: ArrayBuffer) => void;
    phase: (phase: VoiceConnectionPhase) => void;
    fatal: (code: string) => void;
    foreground: () => boolean;
    socketFactory?: (url: string) => WebSocket;
  }) {
    this.options = options;
    this.resumeToken = options.resume;
  }
  diagnostics() {
    return {
      connected: this.ready,
      reconnecting: this.connecting,
      paused: this.paused,
      queuedInputBytes: this.queuedBytes,
      attempts: this.attempts,
    };
  }
  get checkpoint() {
    return this.resumeToken;
  }
  async start() {
    await this.connect();
  }
  private async connect() {
    if (this.stopped || this.connecting || !this.options.foreground()) return;
    this.connecting = true;
    this.paused = false;
    this.ready = false;
    const generation = ++this.version;
    this.options.phase(this.attempts ? "reconnecting" : "connecting");
    try {
      const payload = await this.options.payload();
      if (this.stopped || generation !== this.version || !this.options.foreground()) return;
      const ws = (this.options.socketFactory ?? ((url) => new WebSocket(url)))(this.options.url);
      this.socket = ws;
      this.opening = setTimeout(() => {
        if (generation === this.version && !this.ready) this.reconnect();
      }, 20000);
      ws.binaryType = "arraybuffer";
      this.checkpointSequence = 0;
      const current = () => !this.stopped && generation === this.version && ws === this.socket;
      ws.onopen = () => {
        if (current())
          ws.send(
            JSON.stringify({
              ...payload,
              ...(this.resumeToken ? { resume: this.resumeToken } : {}),
            }),
          );
      };
      ws.onmessage = (e) => {
        if (!current()) return;
        if (e.data instanceof ArrayBuffer) {
          this.options.binary(e.data);
          return;
        }
        try {
          const m = JSON.parse(e.data);
          if (m.type === "AppCheckpoint") {
            if (
              typeof m.token !== "string" ||
              m.token.length > 24000 ||
              !Number.isSafeInteger(m.sequence)
            )
              throw Error();
            if (m.sequence > this.checkpointSequence) {
              this.resumeToken = m.token;
              this.checkpointSequence = m.sequence;
            }
            return;
          }
          if (m.type === "AppReady") {
            clearTimeout(this.opening);
            this.ready = true;
            this.connecting = false;
            this.attempts = 0;
            this.options.phase("listening");
            this.flush();
          }
          if (m.type === "AppClosed") {
            if (m.code === "IDLE_PAUSED") {
              this.pause();
              return;
            }
            if (
              [
                "PROVIDER_CLOSED",
                "PROVIDER_ERROR",
                "CLIENT_ERROR",
                "MONTH_ROLLOVER",
                "VOICE_SESSION_BUSY",
              ].includes(m.code)
            ) {
              this.reconnect();
              return;
            }
            this.options.fatal(String(m.code || "CONNECTION_CLOSED"));
            return;
          }
          this.options.message(m);
        } catch {
          this.options.fatal("INVALID_VOICE_RESPONSE");
        }
      };
      ws.onerror = () => {
        if (current()) this.reconnect();
      };
      ws.onclose = () => {
        if (current()) this.reconnect();
      };
    } catch {
      if (!this.stopped && generation === this.version) this.reconnect();
    }
  }
  private detach() {
    clearTimeout(this.opening);
    this.version++;
    this.connecting = false;
    this.ready = false;
    const old = this.socket;
    this.socket = undefined;
    try {
      old?.close();
    } catch {}
  }
  private reconnect() {
    if (this.stopped || this.retry) return;
    this.detach();
    if (!this.options.foreground()) return this.options.fatal("BACKGROUND_STOPPED");
    if (this.attempts >= 3) return this.options.fatal("CONNECTION_UNAVAILABLE");
    const delay = [500, 1500, 4000][this.attempts++];
    this.options.phase("reconnecting");
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.connect();
    }, delay);
  }
  private pause() {
    this.detach();
    this.paused = true;
    this.speechMs = 0;
    this.queue = [];
    this.queuedBytes = 0;
    this.options.phase("paused");
  }
  capture(data: ArrayBuffer) {
    if (this.stopped || !this.options.foreground()) return;
    this.queue.push(data);
    this.queuedBytes += data.byteLength;
    const max = this.options.sampleRate * 2 * 8;
    if (this.queuedBytes > max && !this.paused) {
      this.options.fatal("SPEECH_BUFFER_FULL");
      this.stop();
      return;
    }
    while (this.queuedBytes > max && this.queue.length) {
      this.queuedBytes -= this.queue.shift()!.byteLength;
    }
    if (this.paused) {
      const samples = new DataView(data);
      let energy = 0;
      for (let i = 0; i < data.byteLength - 1; i += 2) {
        const v = samples.getInt16(i, true) / 32768;
        energy += v * v;
      }
      const rms = Math.sqrt(energy / Math.max(1, data.byteLength / 2));
      this.speechMs =
        rms > 0.018
          ? this.speechMs + (data.byteLength / (this.options.sampleRate * 2)) * 1000
          : Math.max(0, this.speechMs - 50);
      if (this.speechMs >= 250) {
        while (this.queuedBytes > this.options.sampleRate * 2 * 0.6 && this.queue.length > 1)
          this.queuedBytes -= this.queue.shift()!.byteLength;
        void this.connect();
      }
      return;
    }
    this.flush();
  }
  private flush() {
    const ws = this.socket;
    if (!this.ready || !ws || ws.readyState !== WebSocket.OPEN) return;
    while (this.queue.length && ws.bufferedAmount < 128000) {
      const frame = this.queue.shift()!;
      this.queuedBytes -= frame.byteLength;
      ws.send(frame);
    }
  }
  send(message: unknown) {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN)
      throw Error("VOICE_NOT_CONNECTED");
    this.socket.send(JSON.stringify(message));
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    try {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send("STOP");
    } catch {}
    this.detach();
    this.queue = [];
    this.queuedBytes = 0;
    this.resumeToken = undefined;
    this.options.phase("stopped");
  }
}

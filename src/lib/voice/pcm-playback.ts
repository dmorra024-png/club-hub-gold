/** Deepgram raw signed little-endian PCM, mono, 24 kHz. No recordings or text retained. */
export const VOICE_OUTPUT_SAMPLE_RATE = 24000;
export type PlaybackNotice =
  | "blocked"
  | "playing"
  | "idle"
  | "overflow"
  | "invalid"
  | "empty"
  | "silent";
/**
 * Deepgram may send an assistant ConversationText before PCM without an
 * AgentStartedSpeaking/AgentThinking event. This is a new assistant turn and
 * the safe boundary at which an interrupted player may be rearmed. Never
 * rearm for user transcripts or arbitrary binary frames (possibly stale).
 */
export function resumePlaybackForAssistantText(
  player: PcmPlayback,
  role: string,
) {
  if (role === "assistant") player.beginResponse();
}

export class PcmPlayback {
  private nodes = new Set<AudioBufferSourceNode>();
  private pending: Float32Array[] = [];
  private pendingSamples = 0;
  private carry: number | null = null;
  private disposed = false;
  private muted = false;
  private until = 0;
  private receivedBytes = 0;
  private decodedSamples = 0;
  private nonzeroSamples = 0;
  private scheduledSamples = 0;
  private completedSamples = 0;
  private error: PlaybackNotice | null = null;
  private responseSamples = 0;
  private responseSignal = 0;
  private responseActive = false;
  private ctx: Pick<
    AudioContext,
    "currentTime" | "state" | "createBuffer" | "createBufferSource" | "destination"
  >;
  private notice: (notice: PlaybackNotice) => void;
  private maxSeconds: number;
  constructor(
    ctx: PcmPlayback["ctx"],
    notice: (notice: PlaybackNotice) => void = () => {},
    maxSeconds = 30,
  ) {
    this.ctx = ctx;
    this.notice = notice;
    this.maxSeconds = maxSeconds;
  }
  get playUntil() {
    return this.until;
  }
  get suppressed() {
    return this.muted;
  }
  /** A fresh provider response, never arbitrary audio from the interrupted response. */
  beginResponse() {
    if (this.disposed) return;
    this.muted = false;
    if (!this.responseActive) {
      this.responseSamples = 0;
      this.responseSignal = 0;
      this.responseActive = true;
      this.error = null;
    }
  }
  finishResponse() {
    if (this.disposed || this.muted) return;
    const error = !this.responseSamples ? "empty" : !this.responseSignal ? "silent" : null;
    if (error) {
      this.error = error;
      this.notice(error);
    }
    this.responseActive = false;
  }
  push(data: ArrayBuffer) {
    if (this.disposed || !data.byteLength) return;
    this.receivedBytes += data.byteLength;
    if (this.muted) return;
    const bytes = new Uint8Array(data);
    const samples = new Float32Array(
      Math.floor((bytes.length + (this.carry === null ? 0 : 1)) / 2),
    );
    let at = 0,
      out = 0;
    const sample = (lo: number, hi: number) => {
      let value = lo | (hi << 8);
      if (value >= 32768) value -= 65536;
      if (value !== 0) {
        this.nonzeroSamples++;
        this.responseSignal++;
      }
      return value / 32768;
    };
    if (this.carry !== null && bytes.length) {
      samples[out++] = sample(this.carry, bytes[at++]);
      this.carry = null;
    }
    while (at + 1 < bytes.length) {
      samples[out++] = sample(bytes[at], bytes[at + 1]);
      at += 2;
    }
    if (at < bytes.length) this.carry = bytes[at];
    this.decodedSamples += samples.length;
    this.responseSamples += samples.length;
    const queued =
      this.pendingSamples / VOICE_OUTPUT_SAMPLE_RATE +
      Math.max(0, this.until - this.ctx.currentTime);
    if (queued + samples.length / VOICE_OUTPUT_SAMPLE_RATE > this.maxSeconds) {
      this.interrupt();
      this.error = "overflow";
      this.notice("overflow");
      return;
    }
    if (samples.length) {
      this.pending.push(samples);
      this.pendingSamples += samples.length;
    }
    this.contextChanged();
  }
  contextChanged() {
    if (this.disposed || this.muted) return;
    if (this.ctx.state !== "running") {
      this.notice("blocked");
      return;
    }
    while (this.pending.length) {
      const samples = this.pending.shift()!;
      this.pendingSamples -= samples.length;
      const buffer = this.ctx.createBuffer(1, samples.length, VOICE_OUTPUT_SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      const start = Math.max(this.ctx.currentTime + 0.015, this.until);
      this.until = start + buffer.duration;
      this.nodes.add(source);
      source.onended = () => {
        // Canceled/stale nodes must not report a completed response.
        if (!this.nodes.delete(source)) return;
        this.completedSamples += samples.length;
        try {
          source.disconnect();
        } catch {}
        if (!this.nodes.size && !this.pending.length && !this.disposed) this.notice("idle");
      };
      try {
        source.start(start);
        this.scheduledSamples += samples.length;
      } catch {
        this.nodes.delete(source);
        try {
          source.disconnect();
        } catch {}
        this.error = "invalid";
        this.notice("invalid");
      }
    }
    if (this.nodes.size) this.notice("playing");
  }
  interrupt() {
    this.muted = true;
    this.responseActive = false;
    this.pending = [];
    this.pendingSamples = 0;
    this.carry = null;
    for (const node of this.nodes) {
      node.onended = null;
      try {
        node.stop();
      } catch {}
      try {
        node.disconnect();
      } catch {}
    }
    this.nodes.clear();
    this.until = this.ctx.currentTime;
  }
  dispose() {
    this.interrupt();
    this.disposed = true;
  }
  snapshot() {
    return {
      receivedBytes: this.receivedBytes,
      decodedSamples: this.decodedSamples,
      nonzeroSamples: this.nonzeroSamples,
      scheduledSamples: this.scheduledSamples,
      completedSamples: this.completedSamples,
      bufferedSamples: this.pendingSamples,
      scheduledNodes: this.nodes.size,
      contextState: this.ctx.state,
      suppressed: this.muted,
      lastError: this.error,
    };
  }
}

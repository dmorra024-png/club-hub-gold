/** On-device speech boundary detection. Never records, uploads or interprets content. */
export class SpeechEndpoint {
  private voiceStart: number | null = null;
  private lastVoice: number | null = null;
  private started: number;
  constructor(started: number) {
    this.started = started;
  }
  sample(rms: number, now: number): "speech-end" | "no-speech" | "limit" | null {
    if (!Number.isFinite(rms) || !Number.isFinite(now) || now < this.started) return null;
    if (rms >= 0.025) {
      this.voiceStart ??= now;
      if (now - this.voiceStart >= 120) this.lastVoice = now;
    } else this.voiceStart = null;
    if (this.lastVoice !== null && now - this.lastVoice >= 1600) return "speech-end";
    if (this.lastVoice === null && now - this.started >= 12000) return "no-speech";
    return now - this.started >= 60000 ? "limit" : null;
  }
}

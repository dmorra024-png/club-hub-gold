import { z } from "zod";
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** Authenticated socket counters only. Never samples, text, identities or credentials. */
export const ServerAudioHealth = z
  .object({
    type: z.literal("AppAudioHealth"),
    inputFrames: count,
    inputBytes: count,
    forwardedInputBytes: count,
    outputFrames: count,
    outputBytes: count,
    providerUserMessages: count,
    providerAssistantMessages: count,
  })
  .strict();
export type ServerAudioHealthValue = z.infer<typeof ServerAudioHealth>;
export class CaptureHealth {
  private frames = 0;
  private bytes = 0;
  private nonzeroFrames = 0;
  private lastFrame: number;
  private started: number;
  private processorErrors = 0;
  private invalidFrames = 0;
  constructor(now = performance.now()) {
    this.started = now;
    this.lastFrame = now;
  }
  record(data: ArrayBuffer, now = performance.now()) {
    if (!(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength % 2) {
      this.invalidFrames++;
      return false;
    }
    this.frames++;
    this.bytes += data.byteLength;
    this.lastFrame = now;
    const pcm = new DataView(data);
    let signal = false;
    for (let i = 0; i < pcm.byteLength; i += 2)
      if (Math.abs(pcm.getInt16(i, true)) > 16) {
        signal = true;
        break;
      }
    if (signal) this.nonzeroFrames++;
    return true;
  }
  processorFailed() {
    this.processorErrors++;
  }
  fault(running: boolean, muted: boolean, now = performance.now()) {
    if (!running) return "AUDIO_CONTEXT_BLOCKED";
    if (this.processorErrors) return "AUDIO_PROCESSOR_ERROR";
    if (now - this.started < 5000) return null;
    if (muted) return "MICROPHONE_MUTED";
    return now - this.lastFrame > 5000 ? "CAPTURE_NO_FRAMES" : null;
  }
  snapshot() {
    return {
      frames: this.frames,
      bytes: this.bytes,
      nonzeroFrames: this.nonzeroFrames,
      processorErrors: this.processorErrors,
      invalidFrames: this.invalidFrames,
    };
  }
}

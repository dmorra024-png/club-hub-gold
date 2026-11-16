import { test } from "node:test";
import assert from "node:assert/strict";
import { speakBrowserVoice, stopBrowserVoice } from "../src/lib/browser-voice.ts";
import { voiceFailureMessage } from "../src/lib/voice-errors.ts";
test("device replies select local IT/ES voices, finish once, and never fall back to remote voices", () => {
  const root = globalThis as any,
    previousWindow = root.window,
    previousUtterance = root.SpeechSynthesisUtterance;
  let spoken: any,
    done = 0,
    throws = false;
  root.SpeechSynthesisUtterance = class {
    text: string;
    constructor(text: string) {
      this.text = text;
    }
  };
  const voices = [
    { lang: "it-IT", localService: true },
    { lang: "es-ES", localService: true, voiceURI: "preferred" },
    { lang: "es-ES", localService: false, voiceURI: "remote" },
  ];
  root.window = {
    speechSynthesis: {
      cancel() {},
      getVoices: () => voices,
      speak(value: any) {
        if (throws) throw new Error("synthetic device failure");
        spoken = value;
      },
    },
  };
  try {
    for (const language of ["it", "es"] as const) {
      assert.equal(
        speakBrowserVoice("Sintético", language, () => done++),
        true,
      );
      assert.equal(spoken.voice.localService, true);
      assert.ok(spoken.lang.startsWith(language));
      const before = done;
      spoken.onend();
      spoken.onerror();
      assert.equal(done, before + 1);
    }
    assert.equal(
      speakBrowserVoice("Prueba", "es", () => done++, "remote"),
      true,
    );
    assert.equal(spoken.voice.localService, true);
    spoken.onend();
    assert.equal(
      speakBrowserVoice("Prueba", "es", () => done++, "preferred"),
      true,
    );
    assert.equal(spoken.voice.voiceURI, "preferred");
    spoken.onend();
    voices.splice(0, 2);
    spoken = null;
    assert.equal(
      speakBrowserVoice("Sin voz local", "es", () => done++),
      false,
    );
    assert.equal(spoken, null);
    voices.push({ lang: "es-ES", localService: true });
    throws = true;
    const before = done;
    assert.equal(
      speakBrowserVoice("Error", "es", () => done++),
      false,
    );
    assert.equal(done, before + 1);
  } finally {
    root.window = previousWindow;
    root.SpeechSynthesisUtterance = previousUtterance;
  }
});
test("voice errors identify components without reflecting payloads or secrets", () => {
  const messages = [
    ["Missing Supabase environment variable(s): SUPABASE_URL", "servidor"],
    ["binding independiente SNOOP_AI", "Whisper"],
    ["Unauthorized: token", "sesión"],
    ["NotAllowedError", "micrófono"],
    ["Whisper transcripción no disponible", "transcribir"],
    ["quota exhausted 429", "Cuota"],
  ];
  for (const [input, expected] of messages) {
    const output = voiceFailureMessage(input + " PRIVATE_CANARY");
    assert.ok(output.includes(expected), output);
    assert.ok(!output.includes("PRIVATE_CANARY"));
    assert.equal(voiceFailureMessage(output), output);
  }
  assert.equal(voiceFailureMessage("PRIVATE_CANARY"), "IA no disponible. Puedes usar el teclado.");
});

test("interrupting a reply settles its turn immediately and cannot finish the next turn", () => {
  const root = globalThis as any;
  const previousWindow = root.window,
    previousUtterance = root.SpeechSynthesisUtterance;
  const spoken: any[] = [];
  let first = 0,
    second = 0;
  root.SpeechSynthesisUtterance = class {
    text: string;
    constructor(text: string) {
      this.text = text;
    }
  };
  root.window = {
    speechSynthesis: {
      getVoices: () => [{ lang: "es-ES", localService: true }],
      cancel() {},
      speak: (reply: any) => spoken.push(reply),
    },
  };
  try {
    speakBrowserVoice("Primera respuesta", "es", () => first++);
    speakBrowserVoice("Segunda respuesta", "es", () => second++);
    assert.equal(first, 1);
    assert.equal(second, 0);
    spoken[0].onend();
    spoken[0].onerror();
    assert.equal(first, 1);
    assert.equal(second, 0);
    stopBrowserVoice();
    assert.equal(second, 1);
    spoken[1].onend();
    assert.equal(second, 1);
  } finally {
    stopBrowserVoice();
    root.window = previousWindow;
    root.SpeechSynthesisUtterance = previousUtterance;
  }
});

test("native synthesis failures are bounded, cancellation is distinct and diagnostics cannot stall a turn", () => {
  const root = globalThis as any,
    previousWindow = root.window,
    previousUtterance = root.SpeechSynthesisUtterance;
  let spoken: any,
    done = 0;
  const outcomes: string[] = [];
  root.SpeechSynthesisUtterance = class {
    text: string;
    constructor(text: string) {
      this.text = text;
    }
  };
  root.window = {
    speechSynthesis: {
      cancel() {},
      getVoices: () => [{ lang: "es-ES", localService: true }],
      speak(value: any) {
        spoken = value;
      },
    },
  };
  try {
    speakBrowserVoice(
      "Respuesta",
      "es",
      () => done++,
      undefined,
      (value) => outcomes.push(value),
    );
    spoken.onerror({ error: "PRIVATE_CANARY" });
    spoken.onend();
    assert.deepEqual(outcomes, ["error"]);
    assert.equal(done, 1);
    speakBrowserVoice(
      "Respuesta",
      "es",
      () => done++,
      undefined,
      (value) => outcomes.push(value),
    );
    stopBrowserVoice();
    spoken.onend();
    assert.deepEqual(outcomes, ["error", "cancelled"]);
    assert.equal(done, 2);
    speakBrowserVoice(
      "Respuesta",
      "es",
      () => done++,
      undefined,
      () => {
        throw new Error("diagnostic observer");
      },
    );
    spoken.onend();
    assert.equal(done, 3);
  } finally {
    stopBrowserVoice();
    root.window = previousWindow;
    root.SpeechSynthesisUtterance = previousUtterance;
  }
});

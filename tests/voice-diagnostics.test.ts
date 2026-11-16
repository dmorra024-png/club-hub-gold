import test from "node:test";
import assert from "node:assert/strict";
import { voiceDiagnosticCode } from "../src/lib/voice-diagnostics.ts";
import { voiceFailureMessage } from "../src/lib/voice-errors.ts";
test("private voice diagnostics use closed codes and never echo error content", () => {
  const cases = [
    ["SNOOP_WHISPER_QUOTA", "quota"],
    ["SNOOP_WHISPER_LIMITED", "limited"],
    ["SNOOP_WHISPER_TIMEOUT", "timeout"],
    ["SNOOP_INVALID_PROPOSAL", "invalid_response"],
    ["NotAllowedError", "permission"],
    ["network fetch failure", "network"],
    ["Transcripción desactivada por privacidad", "privacy"],
    ["PRIVATE_CANARY", "unavailable"],
  ] as const;
  for (const [message, code] of cases) assert.equal(voiceDiagnosticCode(new Error(message)), code);
  for (const code of ["QUOTA", "LIMITED", "TIMEOUT"])
    assert.ok(!voiceFailureMessage(`SNOOP_WHISPER_${code}`).includes("SNOOP_"));
  assert.equal(voiceDiagnosticCode({ status: 429, message: "PRIVATE_CANARY" }), "limited");
  assert.equal(voiceDiagnosticCode(null), "unavailable");
});

test("GLM malformed proposals have a bounded diagnostic distinct from provider availability", async () => {
  const { snoopAiFailure } = await import("../src/lib/voice-command-ai.server.ts");
  assert.equal(
    snoopAiFailure(new Error("SNOOP_INVALID_PROPOSAL PRIVATE_CANARY")),
    "invalid_response",
  );
  assert.equal(snoopAiFailure(new Error("PRIVATE_CANARY")), "unavailable");
});

/** Closed diagnostic codes only. Never return raw provider messages or payloads. */
export type VoiceDiagnosticStage =
  | "availability"
  | "microphone"
  | "whisper"
  | "interpretation"
  | "routing"
  | "synthesis";
export type VoiceDiagnosticCode =
  | "pending"
  | "ok"
  | "quota"
  | "limited"
  | "timeout"
  | "permission"
  | "privacy"
  | "network"
  | "stale"
  | "manual_edit"
  | "invalid_response"
  | "unavailable";
export function voiceDiagnosticCode(error: unknown): VoiceDiagnosticCode {
  const e = error as { message?: unknown; name?: unknown; status?: unknown; statusCode?: unknown };
  const message =
    typeof e?.message === "string" ? e.message : typeof error === "string" ? error : "";
  if (/quota|cuota|neuron|allocation/i.test(message)) return "quota";
  if (
    e?.status === 429 ||
    e?.statusCode === 429 ||
    /LIMITED|l[ií]mite de solicitudes/i.test(message)
  )
    return "limited";
  if (/timeout|tarda demasiado/i.test(message)) return "timeout";
  if (
    /NotAllowedError|denegado|Unauthorized|NOT_AUTHORIZED|permiso/i.test(message) ||
    e?.name === "NotAllowedError"
  )
    return "permission";
  if (/privacidad|desactivada|processing_disabled/i.test(message)) return "privacy";
  if (/network|fetch|conexi[oó]n/i.test(message)) return "network";
  if (/INVALID_PROPOSAL|invalid_response|no ha devuelto|no devolvi[oó]/i.test(message))
    return "invalid_response";
  return "unavailable";
}
export type VoiceDiagnosticFailure = {
  stage: VoiceDiagnosticStage;
  code: VoiceDiagnosticCode;
  transcript?: string;
};

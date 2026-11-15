const SAFE_VOICE_MESSAGES = new Set([
  "Configuración del servidor incompleta. No se ha abierto el micrófono.",
  "No se pudo verificar tu sesión o permiso de voz. Vuelve a iniciar sesión.",
  "Permite el micrófono para continuar.",
  "Whisper no está conectado al Worker. Usa el teclado.",
  "Transcripción desactivada por la configuración de privacidad.",
  "Sin conexión. Puedes usar el teclado.",
  "Cuota gratuita de IA agotada. Usa el teclado.",
  "La voz tarda demasiado. Reintenta.",
  "No se pudo grabar con este micrófono. Revisa sus permisos o usa el teclado.",
  "Whisper no pudo transcribir el audio. Reintenta.",
  "SNOOP no pudo interpretar la frase. Usa el teclado.",
  "IA no disponible. Puedes usar el teclado.",
]);
/** Bounded component diagnostics; never echo provider payloads, keys or user dictation. */
export function voiceFailureMessage(message: string): string {
  if (SAFE_VOICE_MESSAGES.has(message)) return message;
  if (/Missing Supabase environment|SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY/.test(message))
    return "Configuración del servidor incompleta. No se ha abierto el micrófono.";
  if (/Unauthorized|Forbidden|SNOOP_ACCESS|not_authorized|autorización|sesión/i.test(message))
    return "No se pudo verificar tu sesión o permiso de voz. Vuelve a iniciar sesión.";
  if (/Permiso|NotAllowedError|denegado/i.test(message))
    return "Permite el micrófono para continuar.";
  if (/binding|SNOOP_AI/.test(message))
    return "Whisper no está conectado al Worker. Usa el teclado.";
  if (/IA externa desactivada|voz no autorizada|Transcripción de voz no autorizada/.test(message))
    return "Transcripción desactivada por la configuración de privacidad.";
  if (/conex|fetch|network/i.test(message)) return "Sin conexión. Puedes usar el teclado.";
  if (/quota|429|allocation|cuota/i.test(message))
    return "Cuota gratuita de IA agotada. Usa el teclado.";
  if (/tarda|timeout/i.test(message)) return "La voz tarda demasiado. Reintenta.";
  if (/micrófono|microphone|grabar|grabación|audio no compatible/i.test(message))
    return "No se pudo grabar con este micrófono. Revisa sus permisos o usa el teclado.";
  if (/transcripción|Whisper/i.test(message))
    return "Whisper no pudo transcribir el audio. Reintenta.";
  if (/GLM|proposal|propuesta/i.test(message))
    return "SNOOP no pudo interpretar la frase. Usa el teclado.";
  return "IA no disponible. Puedes usar el teclado.";
}

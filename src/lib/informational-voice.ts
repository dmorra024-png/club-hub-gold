import { geneticsName } from "./genetics-archive.ts";
/** Local intent parsing: no personal fields, economic actions or provider calls. */
export function informationalVoiceCommand(transcript: string): { query: string } | null {
  const text = transcript.replace(/^(?:(?:hola|oye|hey|ok)\s+)?snoop[\s,:]*/i, "").trim();
  const match = text.match(
    /\b(?:gen[eé]tica|genetiche|ficha bot[aá]nica|scheda botanica|archivo informativo)(?:\s+(?:de|di))?\s*[:,-]?\s*(.*)$/i,
  );
  if (!match) return null;
  const query = match[1].replace(/[.!?]+$/, "").trim();
  if (!query) return { query: "" };
  try {
    return { query: geneticsName(query) };
  } catch {
    return { query: "" };
  }
}

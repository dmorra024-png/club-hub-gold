import { z } from "zod";

/** Exact individually spoken letters; never guess a surname from phonetics.
 * Only applied to an explicitly voice-owned field by the browser draft port.
 */
const Letter = z.string().regex(/^[\p{L}]$/u);
export function spelledSurname(letters: readonly string[]): string {
  const validated=z.array(Letter).min(2).max(60).parse(letters);
  const text=validated.join("").normalize("NFC");
  // No whitespace, punctuation, or inserted suffixes are ever inferred.
  if (!/^[\p{L}]{2,60}$/u.test(text)) throw Error("SNOOP_SURNAME_SPELLING_UNCLEAR");
  return text[0].toLocaleUpperCase("es") + text.slice(1);
}

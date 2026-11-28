import { memberFields } from "../snoop-conversation.ts";

/**
 * Deterministic local correction for an *explicitly requested* extra dot
 * before the @ sign. The model never receives the actual form snapshot.
 * This intentionally cannot guess which dot to remove when there are two.
 */
export function removeSingleLocalEmailDot(value: string) {
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) throw Error("SNOOP_EMAIL_CORRECTION_UNCLEAR");
  const local = value.slice(0,at), domain=value.slice(at+1);
  if (local.match(/\./g)?.length !== 1) throw Error("SNOOP_EMAIL_CORRECTION_UNCLEAR");
  const corrected=local.replace(".","")+"@"+domain;
  if (!memberFields.shape.email.safeParse(corrected).success)
    throw Error("SNOOP_EMAIL_CORRECTION_UNCLEAR");
  return corrected;
}

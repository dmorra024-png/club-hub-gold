import type { VoiceFieldCapability } from "./application-ports.ts";

/** All fields are interpreted against the mounted form's runtime capabilities,
 * never an LLM-supplied "enabled" claim or an inferred club configuration.
 */
export function assertWritableVoiceFields(
  patch: Readonly<Record<string, string>>,
  fields: Readonly<Record<string, VoiceFieldCapability>>,
) {
  for (const key of Object.keys(patch)) {
    const field=fields[key];
    if (!field || !field.visible || !field.editable)
      throw Error("SNOOP_MEMBER_FIELD_DISABLED");
  }
}

/** A returned tool success must reflect the actual UI snapshot, not only
 * a setState call. No field values leave this browser-side function.
 */
export async function awaitVoicePatchApplied(
  snapshot: () => Readonly<Record<string, string>>,
  applied: Readonly<Record<string, string>>,
  current: () => boolean,
  timeoutMs=1500,
) {
  if (!Object.keys(applied).length) return;
  const until=performance.now()+timeoutMs;
  while (current() && performance.now()<until) {
    const currentValues=snapshot();
    if (Object.entries(applied).every(([key,value])=>currentValues[key]===value))
      return;
    await new Promise<void>(resolve=>setTimeout(resolve,20));
  }
  throw Error("SNOOP_FORM_NOT_APPLIED");
}

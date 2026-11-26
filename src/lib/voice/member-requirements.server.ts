import { z } from "zod";
import type { AccountAccess } from "../access-context.ts";
import { MEMBER_FIELDS, mergeFieldConfig } from "../member-fields.ts";

/** Same club configuration as the manual registration form. No member data. */
export async function voiceMemberRequirements(options: {
  url: string;
  key: string;
  jwt: string;
  access: AccountAccess;
  fetch?: typeof fetch;
}) {
  const a = options.access;
  if (
    options.url !== "https://bnwanxbmprbymbutoths.supabase.co" ||
    a.status !== "active" ||
    !a.clubId ||
    !a.permissions.includes("manage_members")
  )
    throw Error("VOICE_READ_FORBIDDEN");
  const query = new URLSearchParams({
    select: "field_key,visible,required",
    club_id: "eq." + a.clubId,
    limit: "100",
  });
  const response = await (options.fetch ?? fetch)(
    options.url + "/rest/v1/club_member_field_config?" + query,
    {
      headers: { apikey: options.key, Authorization: "Bearer " + options.jwt },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw Error("VOICE_READ_UNAVAILABLE");
  const rows = z
    .array(
      z.object({ field_key: z.string(), visible: z.boolean(), required: z.boolean() }).strict(),
    )
    .max(100)
    .parse(await response.json());
  if (
    new Set(rows.map((r) => r.field_key)).size !== rows.length ||
    rows.some((r) => !MEMBER_FIELDS.some((f) => f.key === r.field_key))
  )
    throw Error("VOICE_UNKNOWN_MEMBER_FIELD");
  const fields = mergeFieldConfig(rows);
  const required = Object.entries(fields)
    .filter(([, v]) => v.visible && v.required)
    .map(([k]) => k);
  const human = required.filter((k) => ["dni_number", "dni_photo", "signature"].includes(k));
  return {
    required: ["first_name", "last_name", ...required],
    optional: Object.entries(fields)
      .filter(([, v]) => v.visible && !v.required)
      .map(([k]) => k),
    disabled: Object.entries(fields)
      .filter(([, v]) => !v.visible)
      .map(([k]) => k),
    humanInput: human,
    registrationExecutionEligible: human.length === 0 && fields.birth_date.visible,
    ageVerificationRequired: true,
    manualConfirmationRequired: true,
  };
}

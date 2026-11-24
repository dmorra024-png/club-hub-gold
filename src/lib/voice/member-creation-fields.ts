import { memberFields } from "../snoop-conversation.ts";

export const memberCreationKeys = [
  "first_name",
  "last_name",
  "birth_date",
  "city",
  "phone",
  "email",
  "address",
  "postal_code",
  "plan_name",
] as const;

/** Resolve a spoken fee against the already authorized form data. Never infer amounts. */
export function memberCreationPatch(
  value: unknown,
  plans: readonly { id: string; name: string }[],
  visible: readonly string[] = memberCreationKeys,
) {
  const parsed = memberFields.parse(value);
  if (Object.keys(parsed).some((key) => !visible.includes(key)))
    throw Error("SNOOP_MEMBER_FIELD_DISABLED");
  const { plan_name, ...fields } = parsed;
  if (plan_name === undefined) return fields;
  const normalize = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase();
  const matches = plans.filter((plan) => normalize(plan.name) === normalize(plan_name));
  if (matches.length !== 1)
    throw Error(
      matches.length ? "SNOOP_MEMBERSHIP_FEE_AMBIGUOUS" : "SNOOP_MEMBERSHIP_FEE_NOT_FOUND",
    );
  return { ...fields, plan_id: matches[0].id };
}

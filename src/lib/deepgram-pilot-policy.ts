import type { AccountAccess } from "./access-context";

/**
 * Fail-closed per-account Deepgram pilot authorization.
 * The UI alone must never confer access to an external voice provider.
 */
export function deepgramPilotAllowed(
  access: AccountAccess,
  userId: string,
  flags: {
    enabled?: string;
    allowedUserId?: string;
    allowedClubId?: string;
  },
): boolean {
  return (
    flags.enabled === "true" &&
    access.status === "active" &&
    access.role === "admin" &&
    access.permissions.includes("manage_products") &&
    !!access.clubId &&
    !!userId &&
    !!flags.allowedUserId &&
    !!flags.allowedClubId &&
    userId === flags.allowedUserId &&
    access.clubId === flags.allowedClubId
  );
}

export function normalizedPilotNames(rows: unknown, max = 35): string[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of rows) {
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    if (name.length < 2 || name.length > 60 || !/^[\p{L}\p{N} .&'’()+,:%_\/#-]+$/u.test(name))
      continue;
    const key = name.normalize("NFKC").toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
    if (result.length >= max) break;
  }
  return result;
}

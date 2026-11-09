import { parseCashCents } from "./member-administration.ts";
export function paymentReview(totalCents: number, method: string, received: string) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || totalCents > 2147483647) return null;
  if (!["cash", "card", "transfer", "other"].includes(method)) return null;
  if (method !== "cash") return { totalCents, receivedCents: null, changeCents: null };
  const cents = parseCashCents(received);
  return cents === null || cents < totalCents
    ? null
    : { totalCents, receivedCents: cents, changeCents: cents - totalCents };
}

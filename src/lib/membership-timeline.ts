export type ReceiptPoint = { at: number; cents: number };
/** Only the administrative membership ledger, never product/order transactions. */
export function membershipTimeline(
  rows: { id: string; amount_cents: number; recorded_at?: string }[],
  start: string,
  end: string,
  now = Date.now(),
): ReceiptPoint[] {
  const from = Date.parse(start),
    until = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) return [];
  const unique = new Map<string, { at: number; cents: number }>();
  for (const row of rows) {
    const at = Date.parse(row.recorded_at || "");
    if (
      !row.id ||
      !Number.isSafeInteger(row.amount_cents) ||
      row.amount_cents < 0 ||
      !Number.isFinite(at) ||
      at < from ||
      at >= until ||
      at > now
    )
      return [];
    const old = unique.get(row.id);
    if (old && (old.at !== at || old.cents !== row.amount_cents)) return [];
    unique.set(row.id, { at, cents: row.amount_cents });
  }
  const grouped = new Map<number, number>();
  for (const row of unique.values()) grouped.set(row.at, (grouped.get(row.at) || 0) + row.cents);
  if (grouped.size < 3) return [];
  // The complete daily ledger starts at zero; no synthetic payment/event is inserted.
  const points: ReceiptPoint[] = [{ at: from, cents: 0 }];
  let cents = 0;
  for (const [at, delta] of [...grouped].sort((a, b) => a[0] - b[0])) {
    cents += delta;
    if (!Number.isSafeInteger(cents)) return [];
    points.push({ at, cents });
  }
  return cents > 0 ? points : [];
}

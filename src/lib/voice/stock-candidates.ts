/**
 * Product matches for a voice stock movement. No hidden first-match choice:
 * an exact name wins only when unique, otherwise the operator must select.
 * This is selection only; backend confirmation and permissions are unchanged.
 */
export function voiceStockCandidates<T extends { name: string }>(
  products: readonly T[],
  normalizedTarget: string,
  normalize: (value: string) => string,
): T[] {
  if (!normalizedTarget) return [];
  const exact = products.filter((p) => normalize(p.name) === normalizedTarget);
  return exact.length
    ? exact
    : products.filter((p) => normalize(p.name).includes(normalizedTarget));
}

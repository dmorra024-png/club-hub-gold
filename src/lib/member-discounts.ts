export type MemberDiscount = {
  id: string;
  name: string;
  percentage_basis_points: number;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
};
export function parseDiscountPercentage(value: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const result = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return result > 0 && result <= 10000 ? result : null;
}
export function discountStatus(
  discount: MemberDiscount,
  today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()),
) {
  if (!discount.active) return "Inactivo";
  if (discount.valid_from && today < discount.valid_from) return "Programado";
  if (discount.valid_until && today > discount.valid_until) return "Caducado";
  return "Activo";
}
export function discountUnavailable(error: { code?: string }) {
  return ["42P01", "PGRST205"].includes(error.code ?? "");
}

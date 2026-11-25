import { z } from "zod";
import { calendarDate } from "./member-administration.ts";
const amount = z.number().finite();
const count = z.number().int().nonnegative();
/** Validate the original report contract; never coerce absent/invalid values to zero. */
export const InventoryCostReportData = z.object({
  day: z.string().refine((v) => calendarDate(v) === v),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  cost_basis: z.string().min(1),
  opening_eur: amount,
  incoming_eur: amount,
  outgoing_eur: amount,
  closing_eur: amount,
  opening_sale_eur: amount,
  incoming_sale_eur: amount,
  outgoing_sale_eur: amount,
  closing_sale_eur: amount,
  closing_expected_profit_eur: amount,
  missing_sale_price: count,
  missing_cost: count,
  invalid_quantities: count,
  lines: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      opening_qty: amount,
      incoming_qty: amount,
      outgoing_qty: amount,
      closing_qty: amount,
      cost: amount.nullable(),
      sale_price: amount.nullable(),
      product_cost_eur: amount,
      expected_sale_eur: amount,
      expected_profit_eur: amount,
      unpriced: z.boolean(),
      unpriced_sale: z.boolean(),
    }),
  ),
});

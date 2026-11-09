import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireClubMemberAuth } from "@/integrations/supabase/auth-middleware";
import {
  memberOrderHistory,
  annulFinancialRecord,
  activityFinancialDetail,
  recordFinancialRefund,
} from "./member-order-history.server";
export const getMemberOrderHistory = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        memberId: z.string().uuid(),
        page: z.number().int().min(0).max(10000).default(0),
        orderId: z.string().uuid().optional(),
      })
      .strict()
      .parse(v),
  )
  .handler(({ context, data }) =>
    memberOrderHistory(
      context.supabase,
      { userId: context.userId, clubId: context.clubId },
      data.memberId,
      data.page,
      data.orderId,
    ),
  );
export const annulMemberFinancialRecord = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        memberId: z.string().uuid(),
        orderId: z.string().uuid(),
        reason: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(v),
  )
  .handler(({ context, data }) =>
    annulFinancialRecord(
      context.supabase,
      { userId: context.userId, clubId: context.clubId },
      data.memberId,
      data.orderId,
      data.reason,
    ),
  );

export const getActivityFinancialDetail = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((v: unknown) => z.object({ orderId: z.string().uuid() }).strict().parse(v))
  .handler(({ context, data }) =>
    activityFinancialDetail(
      context.supabase,
      { userId: context.userId, clubId: context.clubId },
      data.orderId,
    ),
  );

export const recordMemberFinancialRefund = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        memberId: z.string().uuid(),
        orderId: z.string().uuid(),
        method: z.enum(["cash", "card", "transfer"]),
        reason: z.string().trim().min(5).max(2000),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(v),
  )
  .handler(({ context, data }) =>
    recordFinancialRefund(
      context.supabase,
      { userId: context.userId, clubId: context.clubId },
      data.memberId,
      data.orderId,
      data.method,
      data.reason,
    ),
  );

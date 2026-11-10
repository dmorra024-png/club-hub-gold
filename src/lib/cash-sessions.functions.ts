import { setResponseHeader } from "@tanstack/react-start/server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireClubCashAuth } from "@/integrations/supabase/auth-middleware";
import { calendarDate, madridToday } from "./member-administration";
import { loadCash, openSession, closeSession } from "./cash-sessions.server";
const cents = z.number().int().min(0).max(2147483647);
export const getCashReport = createServerFn({ method: "POST" })
  .middleware([requireClubCashAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        day: z
          .string()
          .refine((v) => !!calendarDate(v))
          .nullable()
          .default(null),
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ context, data }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    return loadCash(
      context.supabase,
      { userId: context.userId, clubId: context.clubId },
      data.day ?? madridToday(),
    );
  });
export const openCash = createServerFn({ method: "POST" })
  .middleware([requireClubCashAuth])
  .inputValidator((v: unknown) => z.object({ openingCash: cents }).strict().parse(v))
  .handler(async ({ context, data }) =>
    openSession(
      context.supabase,
      { userId: context.userId, clubId: context.clubId },
      data.openingCash,
    ),
  );
export const closeCash = createServerFn({ method: "POST" })
  .middleware([requireClubCashAuth])
  .inputValidator((v: unknown) =>
    z
      .object({ sessionId: z.string().uuid(), closingCash: cents, notes: z.string().max(2000) })
      .strict()
      .parse(v),
  )
  .handler(async ({ context, data }) =>
    closeSession(
      context.supabase,
      { userId: context.userId, clubId: context.clubId },
      data.sessionId,
      data.closingCash,
      data.notes,
    ),
  );

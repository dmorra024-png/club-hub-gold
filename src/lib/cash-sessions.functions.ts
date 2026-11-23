import { setResponseHeader } from "@tanstack/react-start/server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireClubCashAuth } from "@/integrations/supabase/auth-middleware";
import { calendarDate, madridToday } from "./member-administration";
import { loadCash, openSession, closeSession } from "./cash-sessions.server";
import { readWalletCashEvidence } from "./cash-wallet-evidence.server";
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

/**
 * Read-only wallet topup activity from the SAME verified evidence as Caja.
 * The RPC enforces club + authenticated cashier scope. No credit spends are
 * represented as cash receipts; never expose wallet balances or member PII.
 */
export const getRecentWalletTopups=createServerFn({method:"POST"})
 .middleware([requireClubCashAuth])
 .inputValidator((v:unknown)=>z.object({limit:z.number().int().min(1).max(100)}).strict().parse(v))
 .handler(async ({context,data})=>{
  setResponseHeader("Cache-Control","private, no-store");
  const end=new Date();
  const start=new Date(end.getTime()-90*86400000);
  const proof=await readWalletCashEvidence(context.supabase,start.toISOString(),end.toISOString());
  const rows=proof.topups.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,data.limit);
  const ids=[...new Set(rows.map(t=>t.actorId))];
  const names=new Map<string,string>();
  if(ids.length){
   const {data:profiles,error}=await context.supabase.from("profiles")
    .select("id,full_name").in("id",ids);
   if(!error)for(const p of profiles??[])if(typeof p.full_name==="string")
    names.set(p.id,p.full_name);
  }
  return rows.map(t=>({
   id:t.id,created_at:t.at,amount_cents:t.amountCents,
   payment_method:t.paymentMethod,actor_name:names.get(t.actorId)??"Colaborador",
   kind:t.kind,voided:t.voided,member_id:t.memberId,actor_id:t.actorId
  }));
 });

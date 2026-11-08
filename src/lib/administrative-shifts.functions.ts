import { createServerFn } from "@tanstack/react-start";
import { requireClubCashAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
export const getMembershipShifts = createServerFn({ method: "POST" })
  .middleware([requireClubCashAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .default(null),
        operator: z.string().uuid().nullable().default(null),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: report, error } = await (context.supabase as any).rpc("snoop_cash_shift_report", {
      p_day: data.day,
      p_operator: data.operator,
    });
    if (error)
      return {
        available: false as const,
        message: ["PGRST202", "42883"].includes(error.code)
          ? "Turnos administrativos pendientes de activación de la propuesta SQL. No se usa la hora del dispositivo ni se altera la contabilidad."
          : error.code === "42501"
            ? "No tienes autorización para consultar este informe."
            : "No se pudo verificar el informe del servidor. Comprueba la fecha y la conexión; no se ha alterado la contabilidad.",
      };
    return {
      available: true as const,
      report: report as {
        server_now: string;
        day: string;
        user_id: string;
        operator_name: string;
        admin: boolean;
        rows: import("./administrative-shifts").ShiftReceipt[];
      },
    };
  });

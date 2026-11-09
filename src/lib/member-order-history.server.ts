import { financialReversals, reversalDetail } from "./financial-reversals.server.ts";
import { parseAccountAccess } from "./access-context.ts";
export type HistoryScope = { userId: string; clubId: string };
async function checked(query: any) {
  const { data, error } = await query;
  if (error) throw new Error("No se pudo consultar el historial");
  return data;
}
async function historyAccess(client: any, scope: HistoryScope) {
  const access = parseAccountAccess(await checked(client.rpc("snoop_access_context")));
  if (
    access.status !== "active" ||
    access.clubId !== scope.clubId ||
    !access.permissions.includes("manage_members") ||
    !access.permissions.some((p) => p === "use_cash" || p === "view_reports")
  )
    throw new Error("No tienes permiso para consultar este historial");
  return {
    admin: access.role === "admin" && access.permissions.includes("use_cash"),
    all: access.role === "admin" || access.permissions.includes("view_reports"),
  };
}
export async function memberOrderHistory(
  client: any,
  scope: HistoryScope,
  memberId: string,
  page = 0,
  orderId?: string,
) {
  const access = await historyAccess(client, scope);
  const member = await checked(
    client
      .from("members")
      .select("id")
      .eq("club_id", scope.clubId)
      .eq("id", memberId)
      .maybeSingle(),
  );
  if (!member) throw new Error("Socio no disponible");
  // '*' permits reading pre-migration rows too; only this narrow DTO leaves the server.
  let query = client
    .from("orders")
    .select("*")
    .eq("club_id", scope.clubId)
    .eq("member_id", memberId);
  if (!access.all) query = query.eq("created_by", scope.userId);
  if (orderId) query = query.eq("id", orderId);
  const rows = await checked(
    query
      .order("created_at", { ascending: false })
      .order("id")
      .range(orderId ? 0 : page * 20, orderId ? 0 : page * 20 + 20),
  );
  if (orderId && rows.length !== 1) throw new Error("Registro no disponible");
  const selected = rows.slice(0, 20);
  const reversals = await financialReversals(
    client,
    scope.clubId,
    selected.map((r: any) => r.id),
  );
  const ids = [
    ...new Set(selected.flatMap((r: any) => [r.created_by, r.cancelled_by]).filter(Boolean)),
  ];
  const profiles = ids.length
    ? await checked(client.from("profiles").select("id,full_name").in("id", ids))
    : [];
  const name = (id: string | null) =>
    profiles.find((p: any) => p.id === id)?.full_name || (id ? "Colaborador" : "No registrado");
  const orders = selected.map((r: any) => {
    const reversal = reversals.rows.find((v: any) => v.order_id === r.id);
    return {
      id: r.id,
      reference: `REG-${r.id.replaceAll("-", "").slice(-12).toUpperCase()}`,
      at: reversal?.original_at ?? r.created_at,
      cents: reversal?.original_cents ?? r.total_cents,
      status: r.status,
      operator: reversal?.original_actor_name ?? name(r.created_by),
      cancelledAt: reversal?.recorded_at ?? r.cancelled_at ?? null,
      cancelledBy: reversal?.cancelled_by_name ?? (r.cancelled_by ? name(r.cancelled_by) : null),
      reason: reversal?.reason ?? r.cancellation_reason ?? null,
      reversal: reversalDetail(reversal),
      canCancel:
        access.admin &&
        reversals.available &&
        r.status === "completed" &&
        Object.hasOwn(r, "cancelled_at"),
    };
  });
  const items: any[] = [];
  if (orderId) {
    for (let offset = 0; ; offset += 1000) {
      const page = await checked(
        client
          .from("order_items")
          .select("id,product_name,quantity,unit_type,line_total_cents")
          .eq("club_id", scope.clubId)
          .eq("order_id", orderId)
          .order("id")
          .range(offset, offset + 999),
      );
      items.push(...page);
      if (page.length < 1000) break;
    }
  }
  return { orders, items, hasMore: rows.length > 20, ownOnly: !access.all };
}
export async function annulFinancialRecord(
  client: any,
  scope: HistoryScope,
  memberId: string,
  orderId: string,
  reason: string,
) {
  const access = await historyAccess(client, scope);
  if (!access.admin) throw new Error("Solo el administrador del club puede anular registros");
  if (!reason || reason.trim().length < 5 || reason.length > 2000)
    throw new Error("Indica un motivo de 5 a 2000 caracteres");
  const capability = await financialReversals(client, scope.clubId, [orderId]);
  if (!capability.available)
    throw new Error("La anulación con rectificación todavía no está activada.");
  const { data, error } = await client.rpc("annul_financial_order", {
    p_member_id: memberId,
    p_order_id: orderId,
    p_reason: reason,
  });
  if (error) {
    if (error.code === "PGRST202")
      throw new Error("La anulación contable todavía no está disponible.");
    throw new Error("No se pudo anular el registro. Consulta su estado antes de reintentar.");
  }
  if (data !== orderId)
    throw new Error("No se pudo verificar la anulación. Consulta el estado del registro.");
  return data;
}

export async function activityFinancialDetail(client: any, scope: HistoryScope, orderId: string) {
  const access = await historyAccess(client, scope);
  let query = client
    .from("orders")
    .select("member_id")
    .eq("club_id", scope.clubId)
    .eq("id", orderId);
  if (!access.all) query = query.eq("created_by", scope.userId);
  const order = await checked(query.maybeSingle());
  if (!order?.member_id) throw new Error("Registro no disponible");
  return {
    ...(await memberOrderHistory(client, scope, order.member_id, 0, orderId)),
    memberId: order.member_id,
  };
}

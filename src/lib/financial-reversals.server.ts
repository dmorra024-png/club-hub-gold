/** Normal JWT client only. Missing migration disables annulment instead of invoking the old RPC. */
export async function financialReversals(client: any, clubId: string, orderIds: string[]) {
  const rows: any[] = [];
  for (let offset = 0; offset < Math.max(1, orderIds.length); offset += 100) {
    const { data, error } = await client
      .from("financial_order_reversals")
      .select("*")
      .eq("club_id", clubId)
      .in("order_id", orderIds.slice(offset, offset + 100));
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code)) return { available: false, rows: [] };
      throw new Error("No se pudieron verificar las rectificaciones contables");
    }
    rows.push(...(data ?? []));
  }
  const refunds = await financialRefunds(
    client,
    clubId,
    rows.map((r: any) => r.id),
  );
  return {
    available: refunds.available,
    rows: rows.map((r: any) => ({
      ...r,
      refund: refunds.rows.find((f: any) => f.reversal_id === r.id) ?? null,
    })),
  };
}
export function reversalDetail(row: any) {
  return row
    ? {
        reference: `REC-${row.id.replaceAll("-", "").slice(-12).toUpperCase()}`,
        cents: Number(row.delta_cents),
        at: row.recorded_at,
        by: row.cancelled_by_name,
        reason: row.reason,
        items: row.original_items ?? null,
        refund: row.refund ? refundDetail(row.refund) : null,
      }
    : null;
}
export async function financialReversalsInPeriod(
  client: any,
  clubId: string,
  start: string,
  end: string,
  actorId?: string,
) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = client
      .from("financial_order_reversals")
      .select("*")
      .eq("club_id", clubId)
      .gte("recorded_at", start)
      .lt("recorded_at", end);
    if (actorId) query = query.eq("original_actor", actorId);
    const { data, error } = await query.order("id").range(offset, offset + 999);
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code)) return { available: false, rows: [] };
      throw new Error("No se pudieron consultar las rectificaciones");
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return { available: true, rows };
  }
}

export function refundDetail(row: any) {
  return {
    reference: `DEV-${row.id.replaceAll("-", "").slice(-12).toUpperCase()}`,
    cents: row.cents,
    method: row.method,
    by: row.recorded_by_name,
    at: row.recorded_at,
    reason: row.reason,
  };
}
export async function financialRefunds(client: any, clubId: string, ids: string[]) {
  const rows: any[] = [];
  for (let offset = 0; offset < Math.max(1, ids.length); offset += 100) {
    const { data, error } = await client
      .from("financial_order_refunds")
      .select("*")
      .eq("club_id", clubId)
      .in("reversal_id", ids.slice(offset, offset + 100));
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code)) return { available: false, rows: [] };
      throw new Error("No se pudieron consultar los reembolsos");
    }
    rows.push(...(data ?? []));
  }
  return { available: true, rows };
}
export async function financialRefundsInPeriod(
  client: any,
  clubId: string,
  start: string,
  end: string,
  actorId?: string,
) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = client
      .from("financial_order_refunds")
      .select("*")
      .eq("club_id", clubId)
      .gte("recorded_at", start)
      .lt("recorded_at", end);
    if (actorId) query = query.eq("recorded_by", actorId);
    const { data, error } = await query.order("id").range(offset, offset + 999);
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code)) return [];
      throw new Error("No se pudieron consultar los reembolsos");
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

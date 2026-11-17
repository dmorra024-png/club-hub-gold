import { z } from "zod";
const Lease = z.object({
  session: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  state: z.enum(["active", "closed"]),
  leaseUntil: z.string(),
  reservedSeconds: z.number().int().nonnegative(),
  remainingSeconds: z.number().int().nonnegative(),
  monthlySeconds: z.number().int().nonnegative(),
  connectedMs: z.number().nonnegative(),
  estimatedMicrousd: z.number().nonnegative().nullable(),
  billedCostVerified: z.literal(false),
});
export type VoiceUsage = z.infer<typeof Lease>;
export class VoiceUsageLease {
  readonly id = crypto.randomUUID();
  private sequence = 0;
  private usage: VoiceUsage | null = null;
  private connectedAt: number | null = null;
  private released = false;
  private closing: Promise<void> | null = null;
  private readonly options: {
    url: string;
    key: string;
    actor: string;
    club: string;
    fetch?: typeof fetch;
    now?: () => number;
  };
  constructor(options: {
    url: string;
    key: string;
    actor: string;
    club: string;
    fetch?: typeof fetch;
    now?: () => number;
  }) {
    this.options = options;
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private async call(operation: "start" | "extend" | "close", sequence: number, connectedMs = 0) {
    if (this.options.url !== "https://bnwanxbmprbymbutoths.supabase.co" || !this.options.key)
      throw Error("VOICE_USAGE_CONFIG_REQUIRED");
    const headers: Record<string, string> = {
      apikey: this.options.key,
      "Content-Type": "application/json",
    };
    if (!this.options.key.startsWith("sb_secret_"))
      headers.Authorization = "Bearer " + this.options.key;
    const r = await (this.options.fetch ?? fetch)(
      this.options.url + "/rest/v1/rpc/snoop_voice_usage",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_id: this.id,
          p_actor: this.options.actor,
          p_club: this.options.club,
          p_operation: operation,
          p_sequence: sequence,
          p_connected_ms: connectedMs,
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw Error(
        body?.message === "Voice session already active"
          ? "VOICE_SESSION_BUSY"
          : body?.message === "VOICE_BUDGET_EXHAUSTED"
            ? "VOICE_BUDGET_EXHAUSTED"
            : "VOICE_USAGE_UNAVAILABLE",
      );
    }
    const lease = Lease.parse(await r.json());
    if (
      lease.session !== this.id ||
      (lease.sequence !== sequence && operation !== "close") ||
      !Number.isFinite(Date.parse(lease.leaseUntil))
    )
      throw Error("VOICE_USAGE_INVALID");
    this.usage = lease;
    return lease;
  }
  async start() {
    return this.call("start", 0);
  }
  markConnected() {
    this.connectedAt = this.now();
  }
  get leaseUntil() {
    return this.usage?.leaseUntil ?? "";
  }
  valid() {
    return (
      !this.released &&
      this.usage?.state === "active" &&
      Date.parse(this.usage.leaseUntil) > this.now()
    );
  }
  async extend() {
    if (this.released) throw Error("VOICE_USAGE_CLOSED");
    const seq = this.sequence + 1;
    const result = await this.call("extend", seq);
    this.sequence = seq;
    return result;
  }
  async close() {
    if (this.released || !this.usage) return;
    if (this.closing) return this.closing;
    const elapsed = this.connectedAt === null ? 0 : Math.max(0, this.now() - this.connectedAt);
    const closing = this.call(
      "close",
      this.sequence,
      Math.min(elapsed, this.usage.reservedSeconds * 1000),
    ).then(() => {
      this.released = true;
    });
    this.closing = closing;
    try {
      await closing;
    } finally {
      if (this.closing === closing) this.closing = null;
    }
  }
}

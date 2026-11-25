import { ExecutionRequest, executionNames, executionResults } from "./execution-registry.ts";
import { z } from "zod";
const safeExecutionCodes = new Set([
  "VOICE_RECEIPT_CONFIRMATION_REQUIRED",
  "VOICE_LOCATION_CONFIRMATION_REQUIRED",
  "VOICE_DUAL_STOCK_REVIEW_REQUIRED",
  "VOICE_AVALADOR_REVIEW_REQUIRED",
  "VOICE_AVALADOR_REQUIRED",
  "VOICE_UNSUPPORTED_MEMBER_FIELD",
  "VOICE_HUMAN_DOCUMENTS_REQUIRED",
  "VOICE_REQUIRED_FIELD",
  "VOICE_FIELD_DISABLED",
  "VOICE_WALLET_UNAVAILABLE",
  "VOICE_THEME_UNAVAILABLE",
  "VOICE_MAIL_UNAVAILABLE",
  "VOICE_WALLET_CREDITS_USED",
  "VOICE_REFERENCE_NOT_FOUND",
  "VOICE_DUPLICATE_NAME",
  "VOICE_INSUFFICIENT_STOCK",
  "VOICE_WHOLE_UNITS_REQUIRED",
  "VOICE_LEGACY_PRICE_UNSUPPORTED",
  "VOICE_CASH_ALREADY_OPEN",
  "VOICE_CASH_AUDIT_REQUIRED",
  "VOICE_INVALID_MEMBER",
  "VOICE_STATE_CHANGED",
  "VOICE_ACCESS_DENIED",
]);
export const voiceExecutionFailure = (error: unknown) =>
  error instanceof Error && safeExecutionCodes.has(error.message)
    ? error.message
    : "VOICE_EXECUTION_REJECTED";
async function rejectExecution(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  throw Error(
    typeof body?.message === "string" && safeExecutionCodes.has(body.message)
      ? body.message
      : "VOICE_EXECUTION_REJECTED",
  );
}
export const ExecutionConfirmation = z
  .object({
    type: z.literal("AppExecutionConfirm"),
    id: z.string().uuid(),
    token: z.string().uuid(),
    confirmed: z.literal(true),
    receiptConfirmed: z.literal(true).optional(),
  })
  .strict();
/** Public receipt metadata only: never an email address, provider ID or token. */
export function voiceReceiptDetails(value: { action: string; status: string; result?: unknown }) {
  if (value.action !== "member.mail.request" || value.status !== "completed") return {};
  const mail = executionResults["member.mail.request"].parse(value.result) as { status: string };
  return { mailStatus: mail.status };
}
const Result = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["confirmation_required", "completed", "cancelled"]),
    enabled: z.boolean(),
    result: z.unknown(),
    token: z.string().uuid().nullable(),
  })
  .strict();
/** Only an already authenticated gateway may construct this user-scoped transport. No service role. */
export async function voiceAccessOperation(
  options: { url: string; key: string; jwt: string; enabled: boolean; fetch?: typeof fetch },
  request: {
    id: string;
    operation: "prepare" | "confirm" | "status" | "cancel" | "recover";
    value?: boolean;
    token?: string;
  },
) {
  if (!options.enabled) throw Error("VOICE_EXECUTION_DISABLED");
  if (options.url !== "https://bnwanxbmprbymbutoths.supabase.co")
    throw Error("VOICE_EXECUTION_CONFIG");
  const id = z.string().uuid().parse(request.id);
  const response = await (options.fetch ?? fetch)(options.url + "/rest/v1/rpc/snoop_voice_access", {
    method: "POST",
    headers: {
      apikey: options.key,
      Authorization: "Bearer " + options.jwt,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_request: id,
      p_operation: request.operation,
      p_enabled: request.value ?? null,
      p_token: request.token ?? null,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) await rejectExecution(response);
  const result = Result.parse(await response.json());
  if (
    result.id !== id ||
    (result.status === "completed" &&
      (!result.result ||
        typeof result.result !== "object" ||
        (result.result as { enabled?: unknown }).enabled !== result.enabled))
  )
    throw Error("VOICE_RESULT_UNVERIFIED");
  return result;
}

/** Existing read RPC with the same caller JWT and no privileged credentials. */
export async function voiceAccessRead(options: {
  url: string;
  key: string;
  jwt: string;
  fetch?: typeof fetch;
}) {
  if (options.url !== "https://bnwanxbmprbymbutoths.supabase.co")
    throw Error("VOICE_EXECUTION_CONFIG");
  const response = await (options.fetch ?? fetch)(
    options.url + "/rest/v1/rpc/snoop_get_club_access_control",
    {
      method: "POST",
      headers: {
        apikey: options.key,
        Authorization: "Bearer " + options.jwt,
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw Error("VOICE_READ_UNAVAILABLE");
  return z
    .object({ enabled: z.boolean() })
    .strict()
    .parse(await response.json());
}

export async function voiceCommandOperation(
  options: { url: string; key: string; jwt: string; enabled: boolean; fetch?: typeof fetch },
  request: {
    id: string;
    operation: "prepare" | "confirm" | "status" | "cancel" | "recover";
    action?: string;
    arguments?: Record<string, unknown>;
    token?: string;
    receiptConfirmed?: boolean;
  },
) {
  if (!options.enabled && request.operation !== "status") throw Error("VOICE_EXECUTION_DISABLED");
  if (options.url !== "https://bnwanxbmprbymbutoths.supabase.co")
    throw Error("VOICE_EXECUTION_CONFIG");
  const id = z.string().uuid().parse(request.id);
  const prepared =
    request.operation === "prepare"
      ? ExecutionRequest.parse({ action: request.action, arguments: request.arguments })
      : null;
  const response = await (options.fetch ?? fetch)(
    options.url + "/rest/v1/rpc/snoop_voice_command",
    {
      method: "POST",
      headers: {
        apikey: options.key,
        Authorization: "Bearer " + options.jwt,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_request: id,
        p_operation: request.operation,
        p_action: prepared?.action ?? null,
        p_arguments: prepared?.arguments ?? null,
        p_token: request.token ?? null,
        p_receipt_confirmed: request.receiptConfirmed === true,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) await rejectExecution(response);
  const value = z
    .object({
      id: z.string().uuid(),
      status: z.enum(["confirmation_required", "completed", "cancelled"]),
      action: z.enum(executionNames),
      summary: z.record(z.unknown()),
      result: z.unknown(),
      token: z.string().uuid().nullable(),
    })
    .strict()
    .parse(await response.json());
  if (value.id !== id) throw Error("VOICE_RESULT_UNVERIFIED");
  if (value.status === "completed") {
    if (!executionResults[value.action].safeParse(value.result).success)
      throw Error("VOICE_RESULT_UNVERIFIED");
  }
  return {
    ...value,
    enabled: typeof value.summary.enabled === "boolean" ? value.summary.enabled : undefined,
  };
}

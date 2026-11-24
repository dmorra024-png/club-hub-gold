import { ExecutionRequest, executionNames } from "./execution-registry.ts";
import { z } from "zod";
export const ExecutionConfirmation = z
  .object({
    type: z.literal("AppExecutionConfirm"),
    id: z.string().uuid(),
    token: z.string().uuid(),
    confirmed: z.literal(true),
  })
  .strict();
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
    operation: "prepare" | "confirm" | "status" | "cancel";
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
  if (!response.ok) throw Error("VOICE_EXECUTION_REJECTED");
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
    operation: "prepare" | "confirm" | "status" | "cancel";
    action?: string;
    arguments?: Record<string, unknown>;
    token?: string;
  },
) {
  if (!options.enabled) throw Error("VOICE_EXECUTION_DISABLED");
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
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw Error("VOICE_EXECUTION_REJECTED");
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
    const schemas = {
      "access_control.set": z.object({ enabled: z.boolean() }).strict(),
      "category.update": z
        .object({ id: z.string().uuid(), name: z.string(), archived: z.boolean() })
        .strict(),
      "product.description": z.object({ id: z.string().uuid(), description: z.string() }).strict(),
      "member.renew": z
        .object({ id: z.string().uuid(), expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
        .strict(),
    };
    if (!schemas[value.action].safeParse(value.result).success)
      throw Error("VOICE_RESULT_UNVERIFIED");
  }
  return {
    ...value,
    enabled: typeof value.summary.enabled === "boolean" ? value.summary.enabled : undefined,
  };
}

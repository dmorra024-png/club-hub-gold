// Fixed SNOOP target; this module never writes resources or logs credentials.
export const SNOOP_CLOUDFLARE_USER_AGENT = "wrangler/4.157.0";
export async function inspectSnoopCloudflare({
  account,
  token,
  userAgent,
  request = fetch,
  path = "settings",
  readPolicy = false,
}) {
  if (!/^[a-f0-9]{32}$/i.test(account ?? "") || !token)
    throw Error("Missing dedicated SNOOP Cloudflare credentials");
  const suffix =
    path === "verify"
      ? "/user/tokens/verify"
      : ["settings", "script-settings", "secrets", "deployments"].includes(path)
        ? `/accounts/${account}/workers/scripts/snoop-pilot/${path}`
        : null;
  if (!suffix) throw Error("Unapproved Cloudflare diagnostic endpoint");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (userAgent) headers["User-Agent"] = userAgent;
  const response = await request("https://api.cloudflare.com/client/v4" + suffix, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {}
  const blockedByBrowserCheck = /error code:\s*1010\b/i.test(raw);
  let tokenPolicy;
  if (
    path === "verify" &&
    readPolicy &&
    response.ok &&
    /^[a-f0-9]{32}$/i.test(json?.result?.id ?? "")
  ) {
    const policyResponse = await request(
      "https://api.cloudflare.com/client/v4/user/tokens/" + json.result.id,
      {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    let policy;
    try {
      policy = await policyResponse.json();
    } catch {}
    tokenPolicy = {
      http: policyResponse.status,
      permission_groups: [],
      snoop_account_in_scope: null,
    };
    if (policyResponse.ok && Array.isArray(policy?.result?.policies)) {
      tokenPolicy.permission_groups = [
        ...new Set(
          policy.result.policies
            .flatMap((p) => (p.permission_groups ?? []).map((g) => g.name))
            .filter((x) => typeof x === "string"),
        ),
      ];
      tokenPolicy.snoop_account_in_scope = policy.result.policies.some(
        (p) =>
          p.effect === "allow" &&
          Object.keys(p.resources ?? {}).some(
            (key) =>
              key === "*" ||
              key === "com.cloudflare.api.account.*" ||
              key === `com.cloudflare.api.account.${account}`,
          ),
      );
    }
  }
  return {
    ...(tokenPolicy ? { token_policy: tokenPolicy } : {}),
    http: response.status,
    success: response.ok && json?.success === true,
    error_codes: (json?.errors ?? []).map((e) => e.code).filter((n) => typeof n === "number"),
    browser_check_1010: blockedByBrowserCheck,
    ...(path === "verify"
      ? { token_status: typeof json?.result?.status === "string" ? json.result.status : null }
      : {}),
    // Bindings are reduced to names/types: no settings or secret values may leave memory.
    bindings:
      response.ok && Array.isArray(json?.result?.bindings)
        ? json.result.bindings.map((b) => ({ name: b.name, type: b.type }))
        : null,
  };
}

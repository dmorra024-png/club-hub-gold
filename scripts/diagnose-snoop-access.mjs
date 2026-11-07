import { mkdir, writeFile } from "node:fs/promises";
import {
  inspectSnoopCloudflare,
  SNOOP_CLOUDFLARE_USER_AGENT,
} from "./lib/snoop-cloudflare-access.mjs";
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
const output = {
  target: "snoop-pilot",
  method: "GET only",
  deployment_performed: false,
  checks: [],
};
for (const [label, path, userAgent] of [
  ["token-verification", "verify", SNOOP_CLOUDFLARE_USER_AGENT],
  ["settings-default-client", "settings", undefined],
  ["settings-wrangler-client", "settings", SNOOP_CLOUDFLARE_USER_AGENT],
]) {
  try {
    const result = await inspectSnoopCloudflare({ account, token, path, userAgent });
    // Never include binding values, token IDs, account IDs, headers or raw error bodies.
    output.checks.push({ label, ...result });
    console.log(
      JSON.stringify({
        label,
        ...result,
        bindings: result.bindings?.map((b) => ({ name: b.name, type: b.type })) ?? null,
      }),
    );
  } catch {
    output.checks.push({
      label,
      error: "Diagnostic request unavailable; no retry and no resource modified",
    });
  }
}
await mkdir(".sandbox", { recursive: true });
await writeFile(
  ".sandbox/snoop-cloudflare-access-diagnostic.json",
  JSON.stringify(output, null, 2) + "\n",
  { mode: 0o600 },
);

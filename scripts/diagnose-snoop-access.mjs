// Exactly one GET of snoop-pilot settings; no retries, policy reads or deployment.
import { inspectSnoopCloudflare } from "./lib/snoop-cloudflare-access.mjs";
try {
  const result = await inspectSnoopCloudflare({
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    path: "settings",
  });
  console.log(JSON.stringify({ http: result.http, error_codes: result.error_codes }));
} catch {
  // Never log raw exceptions, headers, credentials or response bodies.
  console.log(JSON.stringify({ http: null, error_codes: [] }));
  process.exitCode = 1;
}

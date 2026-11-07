// Exactly one GET of snoop-pilot settings; no retries, policy reads or deployment.
import { inspectSnoopCloudflare } from "./lib/snoop-cloudflare-access.mjs";
try {
  const result = await inspectSnoopCloudflare({
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    path: "settings",
  });
  const output={ http: result.http, error_codes: result.error_codes };
  if(process.env.SNOOP_CHECK_APP_URL==="true")output.app_url_state=result.app_url_state??"UNAVAILABLE";
  console.log(JSON.stringify(output));
} catch {
  // Never log raw exceptions, headers, credentials or response bodies.
  console.log(JSON.stringify({ http: null, error_codes: [] }));
  process.exitCode = 1;
}

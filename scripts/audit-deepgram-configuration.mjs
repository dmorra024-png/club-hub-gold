const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("CLOUDFLARE_TOKEN_UNAVAILABLE");
  process.exitCode = 1;
} else {
  const url = "https://api.cloudflare.com/client/v4/accounts/" +
    "0cc8106f8820d22996af3aed9e081e93/workers/scripts/snoop-pilot/settings";
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
    redirect: "error", signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success || !Array.isArray(body.result?.bindings)) {
    console.error("SNOOP_BINDINGS_AUDIT_FAILED HTTP " + res.status);
    process.exitCode = 1;
  } else {
    const bindings = new Map(body.result.bindings.map((b) => [b.name, b.type]));
    for (const name of [
      "DEEPGRAM_API_KEY", "SNOOP_DEEPGRAM_PILOT_ENABLED",
      "SNOOP_DEEPGRAM_PILOT_USER_ID", "SNOOP_DEEPGRAM_PILOT_CLUB_ID",
      "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY",
    ]) {
      // Only existence and type: NEVER print secret values, keys, IDs or provider responses.
      console.log(name + ": " + (bindings.get(name) ?? "ABSENT"));
    }
  }
}

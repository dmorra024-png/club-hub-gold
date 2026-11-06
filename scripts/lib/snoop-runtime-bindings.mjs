const PUBLIC_NAMES = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "APP_URL"];
export function planRuntimeBindings(config, bindings, values) {
  if (config.name !== "snoop-pilot") throw Error("Wrong Worker target");
  if (values.SUPABASE_URL !== "https://bnwanxbmprbymbutoths.supabase.co")
    throw Error("Wrong Snoop-pilot database");
  const app = new URL(values.APP_URL);
  if (app.origin !== "https://snoop-pilot.dmorra024.workers.dev" || app.pathname !== "/")
    throw Error("Wrong SNOOP HTTPS origin");
  if (!values.SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_"))
    throw Error("Missing dedicated public key");
  const secret = bindings.find((b) => b.name === "SUPABASE_SERVICE_ROLE_KEY");
  if (secret && secret.type !== "secret_text")
    throw Error(
      "Private server key must be a protected Worker secret; refusing unsafe type conversion",
    );
  const secretNames = ["SUPABASE_SERVICE_ROLE_KEY"];
  const next = { ...config, vars: { ...config.vars } };
  delete next.vars.SUPABASE_SERVICE_ROLE_KEY;
  for (const name of PUBLIC_NAMES) {
    const b = bindings.find((b) => b.name === name);
    if (b?.type === "secret_text") {
      delete next.vars[name];
      secretNames.push(name);
    } else if (!b || b.type === "plain_text") {
      next.vars[name] = values[name];
    } else throw Error("Unsupported binding type for " + name);
  }
  return { config: next, secretNames };
}

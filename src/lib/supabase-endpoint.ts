export function resolveSupabaseEndpoint(
  configured: string,
  browserOrigin?: string,
  serverUrl?: string,
): string {
  if (configured.startsWith("//")) throw new Error("Invalid Supabase endpoint");
  const value = configured.startsWith("/")
    ? browserOrigin
      ? new URL(configured, browserOrigin).href
      : serverUrl
    : configured;
  if (!value) throw new Error("SUPABASE_URL is required on the server");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid Supabase endpoint");
  return url.href.replace(/\/$/, "");
}

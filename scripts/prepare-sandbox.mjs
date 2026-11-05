import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const root = fileURLToPath(new URL("../", import.meta.url));
const workdir = resolve(process.env.SANDBOX_WORKDIR || join(root, ".sandbox"));
const cli = process.env.SUPABASE_CLI || "supabase";
const projectId = "club-hub-gold-sandbox";
const envFile = join(root, ".env.sandbox.local");
const marker = "# Generated Club Hub Gold local sandbox; no production data";
if (existsSync(envFile) && !readFileSync(envFile, "utf8").startsWith(marker))
  throw new Error("Refusing to overwrite existing sandbox environment settings");
mkdirSync(workdir, { recursive: true });
const logfile = join(workdir, "setup.log");
function run(args, json = false) {
  const result = spawnSync(cli, [...args, "--workdir", workdir], {
    encoding: "utf8",
    maxBuffer: 30_000_000,
    env: { ...process.env, SUPABASE_INTERNAL_IMAGE_REGISTRY: "docker.io" },
  });
  // CLI output may contain local keys; keep it private rather than logging it.
  writeFileSync(logfile, `${result.stdout || ""}\n${result.stderr || ""}`, { mode: 0o600 });
  if (`${result.stdout || ""} ${result.stderr || ""}`.includes("no space left on device")) {
    throw new Error(
      "Insufficient Docker storage for the local database. Increase the environment storage before retrying; no production database was used.",
    );
  }
  if (result.error || result.status !== 0)
    throw new Error(
      `Supabase ${args[0]} failed; inspect the private setup.log in the sandbox directory`,
    );
  return json ? JSON.parse(result.stdout) : undefined;
}
const config = join(workdir, "supabase/config.toml");
if (!existsSync(config)) {
  run(["init", "--yes"]);
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(/^project_id = .*$/m, `project_id = "${projectId}"`),
  );
}
if (!readFileSync(config, "utf8").includes(`project_id = "${projectId}"`))
  throw new Error("This directory is not the dedicated Club Hub Gold sandbox");
const migrations = join(workdir, "supabase/migrations");
mkdirSync(migrations, { recursive: true });
for (const name of readdirSync(join(root, "supabase/migrations")).filter((name) =>
  name.endsWith(".sql"),
))
  copyFileSync(join(root, "supabase/migrations", name), join(migrations, name));
run(["start", "--exclude", "studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor"]);
const state = run(["status", "--output", "json"], true);
if (
  new URL(state.API_URL).hostname !== "127.0.0.1" ||
  new URL(state.DB_URL).hostname !== "127.0.0.1"
)
  throw new Error("Refusing a nonlocal backend");
if (!state.ANON_KEY || !state.SERVICE_ROLE_KEY)
  throw new Error("Local Supabase authentication keys are missing");
const client = createClient(state.API_URL, state.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const credentialsFile = join(workdir, "test-credentials.json");
let credentials;
if (existsSync(credentialsFile)) credentials = JSON.parse(readFileSync(credentialsFile, "utf8"));
else {
  const { data, error } = await client.auth.admin.listUsers();
  if (error) throw new Error("Cannot verify the local user directory");
  if (data.users.length)
    throw new Error("The local directory is not empty; refusing to change existing accounts");
  credentials = {
    email: "admin.demo@example.test",
    password: randomBytes(24).toString("base64url"),
  };
  const result = await client.auth.admin.createUser({
    ...credentials,
    email_confirm: true,
    user_metadata: { full_name: "Amministratore Demo" },
  });
  if (result.error || !result.data.user)
    throw new Error("Cannot create the synthetic local administrator");
  credentials.userId = result.data.user.id;
  writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2), { mode: 0o600, flag: "wx" });
}
let { data: club, error: clubError } = await client
  .from("clubs")
  .select("id")
  .eq("slug", "sandbox-demo")
  .maybeSingle();
if (clubError) throw new Error("Administrative database schema unavailable");
if (!club) {
  const result = await client
    .from("clubs")
    .insert({ name: "Associazione Demo", slug: "sandbox-demo", city: "Città Demo" })
    .select("id")
    .single();
  if (result.error) throw new Error("Cannot seed the synthetic association");
  club = result.data;
}
const { data: roles, error: roleError } = await client
  .from("user_roles")
  .select("id")
  .eq("user_id", credentials.userId)
  .eq("club_id", club.id)
  .eq("role", "admin");
if (roleError) throw new Error("Cannot inspect sandbox roles");
if (!roles.length) {
  const result = await client.from("user_roles").insert({
    user_id: credentials.userId,
    club_id: club.id,
    role: "admin",
    permissions: [
      "manage_members",
      "manage_products",
      "manage_collaborators",
      "view_reports",
      "use_cash",
    ],
  });
  if (result.error) throw new Error("Cannot assign the local administrative role");
}
const buckets = await client.storage.listBuckets();
if (buckets.error) throw new Error("Local document storage unavailable");
if (!buckets.data.some((bucket) => bucket.id === "snoop-docs")) {
  const result = await client.storage.createBucket("snoop-docs", { public: false });
  if (result.error) throw new Error("Cannot create private synthetic document storage");
}
const auth = await client.auth.signInWithPassword(credentials);
if (auth.error || !auth.data.session) throw new Error("Real local login failed");
await client.auth.signOut();
const contents = `${marker}\nVITE_SUPABASE_URL=/sandbox-api\nVITE_SUPABASE_PUBLISHABLE_KEY=${state.ANON_KEY}\nSUPABASE_URL=${state.API_URL}\nSUPABASE_PUBLISHABLE_KEY=${state.ANON_KEY}\nSUPABASE_SERVICE_ROLE_KEY=${state.SERVICE_ROLE_KEY}\nAPP_URL=http://localhost:3000\nAI_EXTERNAL_PROCESSING_ENABLED=false\n`;
writeFileSync(envFile, contents, { mode: 0o600 });
console.log(
  "Local schema, private storage and synthetic administrator ready; password login verified.",
);
console.log(`Credentials are in the private file ${credentialsFile}; no credentials printed.`);
console.log(
  "Start the actual application with npm run dev:sandbox. No production project was accessed.",
);

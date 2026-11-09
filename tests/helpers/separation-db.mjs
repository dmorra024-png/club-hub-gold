import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
export const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const separationBootstrapSql = `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE SCHEMA extensions;
 GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE FUNCTION public.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql AS $$SELECT substring(decode(repeat(md5(gen_random_uuid()::text),(n+15)/16),'hex') FROM 1 FOR n)$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz);
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT ALL ON storage.objects TO authenticated,service_role;`;
export async function separationInitializationSql() {
  let sql = await readFile(
    new URL("../../docs/sql/SNOOP_PILOT_INITIALIZE.sql", import.meta.url),
    "utf8",
  );
  sql = sql
    .replace(
      /CREATE EXTENSION IF NOT EXISTS (?:pg_net SCHEMA extensions|supabase_vault|pgmq);/g,
      "",
    )
    .replace(
      /DO \$\$ BEGIN\s*IF NOT EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'\) THEN[\s\S]*?END \$\$;/,
      "",
    );
  return sql;
}
export async function separationDatabase() {
  const db = new PGlite();
  await db.exec(separationBootstrapSql);
  await db.exec(await separationInitializationSql());
  return db;
}

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const names = (await readdir("supabase/migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort();
let sql = `-- SNOOP PILOT - INIZIALIZZAZIONE COMPLETA
-- Generato dalle migrazioni del repository; eseguire UNA SOLA VOLTA.
-- Solo per il NUOVO progetto Supabase Snoop-pilot VUOTO.
-- Nessun utente, socio, club, password, token o chiave viene inserito.
-- Schema, funzioni, autorizzazioni RLS e bucket privato snoop-docs.
-- Un'unica transazione: in caso di errore non viene completata l'inizializzazione.
-- Il primo utente e il primo Super Admin si configurano successivamente.

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '0';
SET LOCAL search_path = public, extensions;
DO $snoop_preflight$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public')
    OR EXISTS(SELECT 1 FROM storage.buckets)
    OR EXISTS(SELECT 1 FROM auth.users)
 THEN RAISE EXCEPTION 'STOP SNOOP: progetto non vuoto o inizializzazione gia eseguita. Nessun dato esistente deve essere modificato.';
 END IF;
END;
$snoop_preflight$;
`;
const manifest = [];
const expectedPolicies = JSON.parse(
  await readFile("tests/fixtures/initialization-policy-allowlist.json", "utf8"),
);
const quoteSql = (v) =>
  v == null ? "NULL" : "'" + String(v).replaceAll("'", "''") + "'";
const expectedRows = expectedPolicies
  .map(
    (p) =>
      "(" +
      [
        p.schemaname,
        p.tablename,
        p.policyname,
        p.cmd,
        p.roles.join(","),
        p.qual,
        p.with_check,
        p.permissive,
      ]
        .map(quoteSql)
        .join(",") +
      ")",
  )
  .join(",\n");
for (const name of names) {
  let text = await readFile("supabase/migrations/" + name, "utf8");
  manifest.push({
    name,
    sha256: createHash("sha256").update(text).digest("hex"),
  });
  // Only top-level transaction delimiters from these two original migrations.
  if (
    name.endsWith("_secure_account_access.sql") ||
    name.endsWith("_member_administration_scope.sql")
  )
    text = text.replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "");
  // PostgreSQL cannot use an enum value added by ALTER TYPE until commit.
  // On a fresh database create the FINAL enum immediately, without splitting the transaction.
  if (name.startsWith("20260622212808_"))
    text = text.replace(
      "CREATE TYPE public.app_role AS ENUM ('admin', 'collaborator');",
      "CREATE TYPE public.app_role AS ENUM ('admin', 'collaborator', 'super_admin');",
    );
  if (name.startsWith("20260630073314_"))
    text =
      "-- super_admin gia incluso nella definizione iniziale di app_role.\n";
  // Historical seeds belong to the old project; fresh initialization contains no club or plans.
  if (name.startsWith("20260624061600_"))
    text = text.replace(
      /-- Seed default plans[\s\S]*?\('Anual', 365, 15000, 3\);/,
      "-- Nessuna quota precompilata: verra creata nel club corretto.",
    );
  if (name.startsWith("20260630073402_")) {
    text = text.replace(
      /^INSERT INTO public\.clubs \(name, slug, city\).*$/m,
      "-- Nessun club storico viene copiato nel nuovo progetto.",
    );
    const start = text.indexOf("-- Backfill");
    const end = text.indexOf(
      "ALTER TABLE public.members ALTER COLUMN club_id",
      start,
    );
    if (start < 0 || end < 0)
      throw new Error("Unexpected historical backfill structure");
    text =
      text.slice(0, start) +
      "-- Database vuoto: nessun backfill di dati o ruoli storici.\n" +
      text.slice(end);
  }
  // Fresh initialization emits ONLY the authoritative final policy set.
  // Historical policy statements remain in source migrations for upgrade history.
  if (!name.endsWith("_authoritative_rls.sql")) {
    text = text.replace(
      /CREATE POLICY[\s\S]*?;/g,
      name.endsWith("_email_infra.sql")
        ? "NULL;"
        : "-- Historical policy omitted; final policies are installed below.",
    );
    text = text.replace(/DROP POLICY (?!IF EXISTS)/g, "DROP POLICY IF EXISTS ");
  }
  sql += `\n-- ====================================================================\n-- ${name}\n-- ====================================================================\n${text}\n`;
}
sql += `\n-- Bucket privato: nessun documento viene caricato.
INSERT INTO storage.buckets(id,name,public) VALUES('snoop-docs','snoop-docs',false);

-- Verifiche obbligatorie prima del commit.
DO $snoop_verify$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['clubs','user_roles','profiles','members','membership_plans','products','product_categories','cash_sessions','membership_receipts','stock_movements'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=table_name AND c.relrowsecurity) THEN
   RAISE EXCEPTION 'RLS mancante per %',table_name;
  END IF;
 END LOOP;

 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname IN ('public','storage') AND (qual ~ '^\\(*true\\)*$' OR with_check ~ '^\\(*true\\)*$')) THEN RAISE EXCEPTION 'Unscoped RLS policy'; END IF;
 IF EXISTS(
 WITH expected(s,t,p,c,r,q,w,m) AS (VALUES ${expectedRows}), actual AS (
 SELECT schemaname::text s,tablename::text t,policyname::text p,cmd::text c,array_to_string(roles,',') r,qual q,with_check w,permissive m
 FROM pg_policies WHERE schemaname='public' OR (schemaname='storage' AND policyname LIKE 'snoop_documents_%'))
 SELECT 1 FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) differences
 ) THEN RAISE EXCEPTION 'Final RLS policy set differs from reviewed allowlist'; END IF;
 IF has_table_privilege('authenticated','public.user_roles','INSERT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'Browser role can change privileges'; END IF;
 IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity) THEN RAISE EXCEPTION 'Public table without RLS'; END IF;
 IF EXISTS(SELECT 1 FROM public.clubs) OR EXISTS(SELECT 1 FROM public.user_roles) OR EXISTS(SELECT 1 FROM public.members) THEN RAISE EXCEPTION 'Dati inattesi: inizializzazione annullata'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='snoop-docs' AND NOT public) THEN RAISE EXCEPTION 'Bucket privato mancante'; END IF;
END;
$snoop_verify$;
COMMIT;

SELECT 'SNOOP_INITIALIZATION_OK' AS risultato,
       'Eseguire una sola volta. Nessun account o dato personale creato.' AS nota;
`;
if (names.length !== 29)
  throw new Error("Review migration count before regenerating initialization");
if (
  /MEDUZA|meduza|Mallorca|https?:\/\/|eyJ[A-Za-z0-9_-]{20}|sb_secret_|sb_publishable_|sk-[A-Za-z0-9]{10}/.test(
    sql,
  )
)
  throw new Error(
    "Unexpected historical data, external URL or credential pattern",
  );
await mkdir("docs/sql", { recursive: true });
await writeFile("docs/sql/SNOOP_PILOT_INITIALIZE.sql", sql);
await writeFile(
  "docs/sql/SNOOP_PILOT_INITIALIZE.manifest.json",
  JSON.stringify(
    {
      migration_count: names.length,
      sql_sha256: createHash("sha256").update(sql).digest("hex"),
      notes: [
        "Only authoritative final policies emitted; historical CREATE POLICY statements omitted",
        "Final app_role enum created upfront for atomic execution",
        "Historical club/plan seeds and data backfill omitted",
        "Original function bodies preserved; only top-level transaction delimiters normalized",
      ],
      migrations: manifest,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared single SQL file from ${names.length} migrations; no remote connection.`,
);

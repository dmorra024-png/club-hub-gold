import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const names=(await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
let sql=`-- SNOOP PILOT - INIZIALIZZAZIONE COMPLETA
-- Generato dalle migrazioni del repository; eseguire UNA SOLA VOLTA.
-- Solo per il NUOVO progetto Supabase Snoop-pilot VUOTO.
-- Nessun utente, socio, club, password, token o chiave viene inserito.
-- Schema, funzioni, autorizzazioni RLS e bucket privato snoop-docs.
-- Un'unica transazione: in caso di errore non viene completata l'inizializzazione.
-- Il primo utente e il primo Super Admin si configurano successivamente.

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '0';
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
const manifest=[];
for(const name of names){let text=await readFile('supabase/migrations/'+name,'utf8');manifest.push({name,sha256:createHash('sha256').update(text).digest('hex')});
 // Only top-level transaction delimiters from these two original migrations.
 if(name.endsWith('_secure_account_access.sql')||name.endsWith('_member_administration_scope.sql'))text=text.replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'');
 // PostgreSQL cannot use an enum value added by ALTER TYPE until commit.
 // On a fresh database create the FINAL enum immediately, without splitting the transaction.
 if(name.startsWith('20260622212808_'))text=text.replace("CREATE TYPE public.app_role AS ENUM ('admin', 'collaborator');","CREATE TYPE public.app_role AS ENUM ('admin', 'collaborator', 'super_admin');");
 if(name.startsWith('20260630073314_'))text='-- super_admin gia incluso nella definizione iniziale di app_role.\n';
 // Historical seeds belong to the old project; fresh initialization contains no club or plans.
 if(name.startsWith('20260624061600_'))text=text.replace(/-- Seed default plans[\s\S]*?\('Anual', 365, 15000, 3\);/,'-- Nessuna quota precompilata: verra creata nel club corretto.');
 if(name.startsWith('20260630073402_')){
  text=text.replace(/^INSERT INTO public\.clubs \(name, slug, city\).*$/m,'-- Nessun club storico viene copiato nel nuovo progetto.');
  const start=text.indexOf('-- Backfill');const end=text.indexOf('ALTER TABLE public.members ALTER COLUMN club_id',start);
  if(start<0||end<0)throw new Error('Unexpected historical backfill structure');
  text=text.slice(0,start)+'-- Database vuoto: nessun backfill di dati o ruoli storici.\n'+text.slice(end);
 }
 sql+=`\n-- ====================================================================\n-- ${name}\n-- ====================================================================\n${text}\n`;
}
sql+=`\n-- Bucket privato: nessun documento viene caricato.
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
 IF EXISTS(SELECT 1 FROM public.clubs) OR EXISTS(SELECT 1 FROM public.user_roles) OR EXISTS(SELECT 1 FROM public.members) THEN RAISE EXCEPTION 'Dati inattesi: inizializzazione annullata'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='snoop-docs' AND NOT public) THEN RAISE EXCEPTION 'Bucket privato mancante'; END IF;
END;
$snoop_verify$;
COMMIT;

SELECT 'SNOOP_INITIALIZATION_OK' AS risultato,
       'Eseguire una sola volta. Nessun account o dato personale creato.' AS nota;
`;
if(names.length!==28)throw new Error('Review migration count before regenerating initialization');
if(/MEDUZA|meduza|Mallorca|https?:\/\/|eyJ[A-Za-z0-9_-]{20}|sb_secret_|sb_publishable_|sk-[A-Za-z0-9]{10}/.test(sql))throw new Error('Unexpected historical data, external URL or credential pattern');
await mkdir('docs/sql',{recursive:true});await writeFile('docs/sql/SNOOP_PILOT_INITIALIZE.sql',sql);
await writeFile('docs/sql/SNOOP_PILOT_INITIALIZE.manifest.json',JSON.stringify({migration_count:names.length,sql_sha256:createHash('sha256').update(sql).digest('hex'),notes:['Final app_role enum created upfront for atomic execution','Historical club/plan seeds and data backfill omitted','Original function bodies preserved; only top-level transaction delimiters normalized'],migrations:manifest},null,2)+'\n');
console.log(`Prepared single SQL file from ${names.length} migrations; no remote connection.`);

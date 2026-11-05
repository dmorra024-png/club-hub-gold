import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
// Generates files only. No API, project creation, database connection or deployment.
await mkdir(".sandbox/pilot-database", { recursive: true });
const names = (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
let sql = `-- SNOOP dedicated EMPTY Supabase Free project only.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public') OR EXISTS(SELECT 1 FROM storage.buckets) THEN RAISE EXCEPTION 'STOP: this project is not empty; no SNOOP migration may run here'; END IF; END $$;
`;
const manifest = [];
for (const name of names) {
  const text = await readFile("supabase/migrations/" + name, "utf8");
  sql += `\n-- Migration: ${name}\n${text}\n`;
  manifest.push({ name, sha256: createHash("sha256").update(text).digest("hex") });
}
sql += `\n-- Dedicated private document storage, not shared with another app.\nINSERT INTO storage.buckets(id,name,public) VALUES('snoop-docs','snoop-docs',false) ON CONFLICT(id) DO NOTHING;\n`;
await writeFile(".sandbox/pilot-database/migrations.sql", sql, { mode: 0o600 });
await writeFile(".sandbox/pilot-database/manifest.json", JSON.stringify(manifest, null, 2));
await writeFile(
  ".sandbox/pilot-database/bootstrap-owner.sql",
  `-- Run only in the newly created SNOOP project, after creating your own Auth account.\n-- Replace the UUID. This never grants roles automatically at signup.\nDO $$ DECLARE owner_id uuid := '00000000-0000-0000-0000-000000000000'; BEGIN\nIF owner_id='00000000-0000-0000-0000-000000000000' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=owner_id) THEN RAISE EXCEPTION 'Replace owner UUID with your SNOOP Auth user'; END IF;\nIF EXISTS(SELECT 1 FROM public.user_roles WHERE role='super_admin') THEN RAISE EXCEPTION 'Owner already configured: no existing roles changed'; END IF;\nINSERT INTO public.user_roles(user_id,role,permissions,club_id) VALUES(owner_id,'super_admin',ARRAY['manage_members','manage_products','manage_collaborators','view_reports','use_cash']::public.app_permission[],NULL);\nEND $$;\n`,
  { mode: 0o600 },
);
console.log(
  `Prepared ${names.length} migrations, private storage and explicit owner bootstrap. Files only; no remote database was contacted.`,
);

await writeFile(
  ".sandbox/pilot-database/synthetic-club.sql",
  `-- Optional synthetic fixtures, only after the dedicated SNOOP migration bundle.
DO $$ DECLARE c uuid; p uuid; category uuid; BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname='can_manage_snoop_catalog') THEN RAISE EXCEPTION 'SNOOP migrations missing'; END IF;
SELECT id INTO c FROM public.clubs WHERE slug='snoop-synthetic-demo';
IF c IS NOT NULL THEN RAISE EXCEPTION 'Synthetic demo already exists; nothing changed'; END IF;
INSERT INTO public.clubs(name,slug,city) VALUES('SNOOP — Demo sintetica','snoop-synthetic-demo','Località fittizia') RETURNING id INTO c;
INSERT INTO public.membership_plans(club_id,name,duration_days,price_cents,active,sort_order) VALUES(c,'Quota Demo',30,0,true,1) RETURNING id INTO p;
INSERT INTO public.members(club_id,first_name,last_name,birth_date,city,phone,dni_number,plan_id,joined_at,expires_at) VALUES(c,'Persona','Demo sintetico','2000-01-01','Località fittizia','000000000','SYNTHETIC-ONLY',p,current_date,current_date+30);
INSERT INTO public.product_categories(club_id,name,unit_type,is_smokeable) VALUES(c,'Forniture amministrative Demo','unit',false) RETURNING id INTO category;
INSERT INTO public.products(club_id,category_id,name,stock,buy_price,sell_price) VALUES(c,category,'Materiale sintetico Demo',0,0,0);
END $$;
`,
  { mode: 0o600 },
);

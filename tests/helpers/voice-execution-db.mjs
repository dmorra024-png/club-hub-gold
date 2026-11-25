import { readFile } from "node:fs/promises";
import { separationDatabase, uid } from "./separation-db.mjs";
export async function voiceExecutionDatabase(club = uid(101), other = uid(102)) {
  const db = await separationDatabase();
  await db.exec(
    await readFile("supabase/migrations/20261106150000_platform_club_separation.sql", "utf8"),
  );
  for (let n = 1; n < 4; n++)
    await db.query("insert into auth.users(id,email)values($1,$2)", [
      uid(n),
      `voice-${n}@example.test`,
    ]);
  await db.exec(
    `insert into public.clubs(id,name,slug)values('${club}','Voice A','voice-a'),('${other}','Voice B','voice-b');insert into public.user_roles(user_id,role,club_id,permissions)values('${uid(1)}','admin','${club}','{}'),('${uid(2)}','admin','${other}','{}'),('${uid(3)}','collaborator','${club}','{}');`,
  );
  for (const name of [
    "20261107120000_catalog_lifecycle.sql",
    "20261107123000_membership_payment_flow.sql",
  ])
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  const membership = await readFile("docs/sql/SNOOP_ADMINISTRATIVE_RECORDS_PROPOSED.sql", "utf8");
  await db.exec(
    membership.slice(
      membership.indexOf("CREATE FUNCTION public.confirm_membership_with_receipt("),
      membership.indexOf("ALTER TABLE public.orders ADD"),
    ),
  );
  await db.exec(
    `INSERT INTO public.product_categories(id,club_id,name)VALUES('${uid(201)}','${club}','Office'),('${uid(202)}','${other}','Other');INSERT INTO public.products(id,club_id,category_id,name,stock,buy_price,sell_price)VALUES('${uid(301)}','${club}','${uid(201)}','Synthetic Notebook',10,100,200);INSERT INTO public.membership_plans(id,club_id,name,duration_days,price_cents)VALUES('${uid(401)}','${club}','Synthetic fee',30,1000);INSERT INTO public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at)VALUES('${uid(501)}','${club}','Ana','Synthetic','1990-01-01','SYNTHETIC-VOICE','2030-01-01');`,
  );
  const existing = await readFile("docs/sql/SNOOP_CLUB_MERMA_POLICY_REVIEW.sql", "utf8");
  await db.exec(
    existing.slice(
      existing.indexOf("ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS access_control_enabled"),
      existing.indexOf("-- Restrictive RLS combines"),
    ),
  );
  await db.exec(await readFile("docs/sql/SNOOP_MEMBER_DISCOUNTS_PROPOSED.sql", "utf8"));
  await db.exec(await readFile("docs/sql/SNOOP_CASH_SESSION_AUDIT_PROPOSED.sql", "utf8"));
  for (const file of [
    "REVIEW_ONLY.sql",
    "WALLET_TOPUP_REVIEW_ONLY.sql",
    "WALLET_CLUB_CONFIGURATION_REVIEW_ONLY.sql",
    "WALLET_STAFF_STATUS_REVIEW_ONLY.sql",
  ])
    await db.exec(await readFile("apps/socio/schema/" + file, "utf8"));
  const walletMethods = await readFile(
    "docs/sql/SNOOP_WALLET_CREDIT_ONLY_TOPUP_METHODS_REVIEW.sql",
    "utf8",
  );
  await db.exec(
    walletMethods.slice(
      0,
      walletMethods.indexOf("CREATE OR REPLACE FUNCTION public.socio_wallet_cash_evidence"),
    ) + "COMMIT;",
  );
  const walletVoid = await readFile("docs/sql/SNOOP_WALLET_TOPUP_VOID_REVIEW.sql", "utf8");
  await db.exec(
    walletVoid.slice(0, walletVoid.indexOf("-- Extend the original authorized Caja evidence")) +
      "COMMIT;",
  );
  // Isolated compatibility fixture: current Pilot positional signature delegates
  // to the unchanged original receipt implementation already loaded above.
  await db.exec(
    `CREATE FUNCTION public.confirm_membership_with_receipt(p_confirmed_cents integer,p_expected date,p_member jsonb,p_method text,p_plan_id uuid,p_renew boolean,p_request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN public.confirm_membership_with_receipt(p_member,p_plan_id,p_method,p_request,p_renew,p_expected,p_confirmed_cents); END $$;`,
  );
  await db.exec(await readFile("docs/sql/SNOOP_AVALADOR_PILOT.sql", "utf8"));
  await db.exec(await readFile("docs/sql/SNOOP_LOCATED_PRODUCT_CREATION_PILOT.sql", "utf8"));
  await db.exec(await readFile("docs/sql/SNOOP_FINANZAS_V1_PILOT.sql", "utf8"));
  await db.exec(await readFile("tests/fixtures/snoop-club-themes.owner.sql", "utf8"));
  await db.exec(await readFile("docs/sql/SNOOP_VOICE_EXECUTION_REVIEW_ONLY.sql", "utf8"));

  return db;
}

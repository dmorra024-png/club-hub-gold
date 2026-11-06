import { PNG } from "pngjs";
import jsQR from "jsqr";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
const root = fileURLToPath(new URL("../", import.meta.url));
const work = resolve(process.env.SANDBOX_WORKDIR || join(root, ".sandbox"));
const env = Object.fromEntries(
  (await readFile(join(root, ".env.sandbox.local"), "utf8"))
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
assert.equal(env.SUPABASE_URL, "http://127.0.0.1:54321");
assert.equal(env.VITE_SUPABASE_URL, "/sandbox-api");
const credentials = JSON.parse(await readFile(join(work, "test-credentials.json"), "utf8"));
assert.equal(credentials.email, "admin.demo@example.test");
const origin = new URL(process.env.TEST_BASE_URL || "http://127.0.0.1:3000");
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
const client = (key) =>
  createClient(env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = client(env.SUPABASE_SERVICE_ROLE_KEY);
const run = Date.now().toString(36);
const results = [];
const manualInvites = process.env.SNOOP_TEST_MANUAL_INVITES === "true";
let member;
let quota;
let clubId;
let invitedEmployee;
const artifacts = join(work, "acceptance");
await mkdir(artifacts, { recursive: true });
const check = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
async function record(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS", level: "native local Supabase + browser/API" });
    console.log("PASS " + name);
  } catch (e) {
    const message = String(e.message).replace(/eyJ[A-Za-z0-9_.-]+/g, "[redacted]");
    results.push({ name, status: "FAIL", detail: message });
    console.log("FAIL " + name + ": " + message.slice(0, 250));
  }
  await writeFile(join(artifacts, "results.json"), JSON.stringify({ run, results }, null, 2), {
    mode: 0o600,
  });
}
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox"],
  headless: true,
});
const contexts = [];
async function login(creds) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  contexts.push(context);
  await context.route("**/*", (r) =>
    new URL(r.request().url()).origin === origin.origin ? r.continue() : r.abort(),
  );
  const page = await context.newPage();
  await page.goto(new URL("/auth", origin).href, { waitUntil: "networkidle" });
  await page.locator("input[type=email]").fill(creds.email);
  await page.locator("input[type=password]").fill(creds.password);
  await page.locator("form").getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(origin.href);
  return page;
}
async function actor(label, club, permissions) {
  const creds = {
    email: `${label}.${run}@example.test`,
    password: randomBytes(24).toString("base64url"),
  };
  const user = check(
    await admin.auth.admin.createUser({
      ...creds,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic ${label}` },
    }),
  ).user;
  check(
    await admin
      .from("user_roles")
      .insert({ user_id: user.id, club_id: club, role: "collaborator", permissions }),
  );
  const api = client(env.SUPABASE_PUBLISHABLE_KEY);
  check(await api.auth.signInWithPassword(creds));
  return { ...creds, id: user.id, api };
}
let page;
try {
  await record("Accesso nativo e schermata principale dopo login", async () => {
    page = await login(credentials);
    await page.getByRole("heading", { name: "Associazione Demo", exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, "home.png"), fullPage: true });
    clubId = check(
      await admin
        .from("user_roles")
        .select("club_id")
        .eq("user_id", credentials.userId)
        .eq("role", "admin")
        .single(),
    ).club_id;
  });
  if (!page || !clubId) throw new Error("Native login prerequisite failed");
  // Only the dedicated synthetic association is configured; documents/signatures remain independently testable.
  check(
    await admin.from("club_member_field_config").upsert(
      ["dni_photo", "signature", "address", "postal_code", "email"].map((field_key) => ({
        club_id: clubId,
        field_key,
        visible: false,
        required: false,
      })),
      { onConflict: "club_id,field_key" },
    ),
  );
  await record("Creazione quota associativa dalla UI e persistenza", async () => {
    await page.goto(new URL("/ajustes/cuotas", origin).href, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Nueva cuota", exact: true }).click();
    await page.getByLabel("Nombre", { exact: true }).fill(`Quota ${run}`);
    await page.getByLabel("Duración (días)", { exact: true }).fill("30");
    await page.getByLabel("Precio (€)", { exact: true }).fill("12.50");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.getByText("Cuota guardada", { exact: true }).waitFor();
    quota = check(
      await admin
        .from("membership_plans")
        .select("*")
        .eq("club_id", clubId)
        .eq("name", `Quota ${run}`)
        .single(),
    );
    assert.equal(quota.duration_days, 30);
    assert.equal(quota.price_cents, 1250);
  });
  await record("Registrazione manuale socio e blocco doppio clic", async () => {
    assert.ok(quota, "Quota prerequisite");
    await page.goto(new URL("/soci/nuovo", origin).href, { waitUntil: "networkidle" });
    await page.getByLabel("Nombre *", { exact: true }).fill(`Persona${run}`);
    await page.getByLabel("Apellidos *", { exact: true }).fill("García Demo");
    await page.getByLabel("Fecha de nacimiento *", { exact: true }).fill("2000-02-29");
    await page.getByLabel("Ciudad *", { exact: true }).fill("Città Fittizia");
    await page.getByLabel("Teléfono *", { exact: true }).fill("000000000");
    await page
      .getByLabel("Número de DNI / NIE *", { exact: true })
      .fill(`TEST${run.toUpperCase()}`);
    await page.getByRole("button", { name: new RegExp(`Quota ${run}`) }).click();
    await page.getByRole("button", { name: "Crear socio", exact: true }).dblclick();
    await page.waitForURL("**/soci/gestisci");
    const rows = check(
      await admin
        .from("members")
        .select("*")
        .eq("club_id", clubId)
        .eq("first_name", `Persona${run}`),
    );
    assert.equal(rows.length, 1);
    member = rows[0];
    assert.equal(member.plan_id, quota.id);
    assert.equal(member.birth_date, "2000-02-29");
  });
  if (member) {
    await record("Ricerca anagrafica con accenti IT/ES", async () => {
      await page.goto(new URL("/soci/gestisci", origin).href, { waitUntil: "networkidle" });
      await page.getByRole("link", { name: new RegExp(`Persona${run}`) }).waitFor();
      await page
        .getByPlaceholder("Buscar por nº socio, nombre, DNI o ciudad...")
        .fill(`Persona${run} garcia`);
      await page
        .getByRole("link", { name: new RegExp(`Persona${run}`) })
        .waitFor({ timeout: 5000 });
    });
    await record("Modifica anagrafica rifiuta nome vuoto senza scrivere", async () => {
      const original = member.first_name;
      try {
        await page.goto(new URL(`/soci/${member.id}`, origin).href, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Editar", exact: true }).click();
        await page.getByLabel("Nombre", { exact: true }).fill("");
        await page.getByRole("button", { name: "Guardar", exact: true }).click();
        await page.getByText(/Datos actualizados|Nombre y apellidos obligatorios/).waitFor();
        const row = check(
          await admin.from("members").select("first_name").eq("id", member.id).single(),
        );
        assert.equal(row.first_name, original);
      } finally {
        check(await admin.from("members").update({ first_name: original }).eq("id", member.id));
      }
    });
    await record("Modifica anagrafica valida e rilettura dal database", async () => {
      await page.goto(new URL(`/soci/${member.id}`, origin).href, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Editar", exact: true }).click();
      await page.getByLabel("Ciudad", { exact: true }).fill("Località Demo Aggiornata");
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      await page.getByText("Datos actualizados", { exact: true }).waitFor();
      assert.equal(
        check(await admin.from("members").select("city").eq("id", member.id).single()).city,
        "Località Demo Aggiornata",
      );
    });
    await record("Rinnovo quota: annullamento e conferma", async () => {
      await page.goto(new URL(`/soci/${member.id}`, origin).href, { waitUntil: "networkidle" });
      const before = check(
        await admin.from("members").select("expires_at").eq("id", member.id).single(),
      ).expires_at;
      page.once("dialog", (d) => d.dismiss());
      await page.getByRole("button", { name: "Renovar", exact: true }).click();
      assert.equal(
        check(await admin.from("members").select("expires_at").eq("id", member.id).single())
          .expires_at,
        before,
      );
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "Renovar", exact: true }).click();
      await page.getByText("Cuota renovada", { exact: true }).waitFor();
      const after = check(
        await admin.from("members").select("expires_at").eq("id", member.id).single(),
      ).expires_at;
      assert.equal((Date.parse(after) - Date.parse(before)) / 86400000, 30);
    });
    await record("Carnet QR del socio: immagine UI decodificata localmente", async () => {
      await page.goto(new URL(`/soci/${member.id}`, origin).href, { waitUntil: "networkidle" });
      const image = page.getByAltText(`QR socio ${member.member_number}`, { exact: true });
      await image.waitFor();
      const src = await image.getAttribute("src");
      assert.ok(src.startsWith("data:image/png;base64,"));
      const png = PNG.sync.read(Buffer.from(src.split(",")[1], "base64"));
      const pixels = new Uint8ClampedArray(png.data);
      for (let i = 0; i < pixels.length; i += 4) {
        const value = pixels[i + 3] === 0 ? 255 : 0;
        pixels[i] = value;
        pixels[i + 1] = value;
        pixels[i + 2] = value;
        pixels[i + 3] = 255;
      }
      assert.equal(jsQR(pixels, png.width, png.height)?.data, `SNOOP:${member.member_number}`);
    });
    await record("Storage documenti sintetici: upload e URL firmato", async () => {
      const api = client(env.SUPABASE_PUBLISHABLE_KEY);
      check(await api.auth.signInWithPassword(credentials));
      const bytes = await readFile(join(root, "public/icons/app-192.png"));
      const path = `members/${member.id}/synthetic-fixture.png`;
      check(await api.storage.from("snoop-docs").upload(path, bytes, { contentType: "image/png" }));
      const signed = check(await api.storage.from("snoop-docs").createSignedUrl(path, 60));
      assert.equal(new URL(signed.signedUrl).hostname, "127.0.0.1");
      const response = await fetch(signed.signedUrl);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      const scoped = `clubs/${clubId}/members/${member.id}/synthetic-private.png`;
      check(
        await api.storage.from("snoop-docs").upload(scoped, bytes, { contentType: "image/png" }),
      );
      check(await api.storage.from("snoop-docs").createSignedUrl(scoped, 60));
      const foreignClub = check(
        await admin
          .from("clubs")
          .insert({ name: "Documenti Demo " + run, slug: "docs-" + run })
          .select("id")
          .single(),
      );
      const foreign = await actor("docs-foreign", foreignClub.id, ["manage_members"]);
      for (const target of [path, scoped]) {
        assert.ok((await foreign.api.storage.from("snoop-docs").createSignedUrl(target, 60)).error);
        assert.ok(
          (
            await foreign.api.storage
              .from("snoop-docs")
              .update(target, bytes, { contentType: "image/png" })
          ).error,
        );
      }
    });
  }
  await record(
    "Invito dipendente dalla UI senza password temporanea (email o link monouso)",
    async () => {
      await page.goto(new URL("/ajustes/colaboradores", origin).href, { waitUntil: "networkidle" });
      await page.getByLabel("Nombre completo", { exact: true }).fill(`Dipendente ${run}`);
      await page.getByLabel("Email", { exact: true }).fill(`invited.${run}@example.test`);
      await page.getByRole("button", { name: "Crear acceso / invitar", exact: true }).click();
      await page
        .getByText(
          manualInvites
            ? "Invitación preparada. Comparte el enlace de un solo uso únicamente con su titular."
            : "Colaborador creado. Invitación enviada por email.",
          { exact: true },
        )
        .waitFor({ timeout: 15000 });
      const users = check(await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).users;
      const invited = users.find((u) => u.email === `invited.${run}@example.test`);
      assert.ok(invited);
      const row = check(
        await admin.from("user_roles").select("role,club_id").eq("user_id", invited.id).single(),
      );
      assert.equal(row.club_id, clubId);
      assert.equal(row.role, "collaborator");
      invitedEmployee = invited;
    },
  );
  await record(
    "Dipendenti: modifica permessi, recupero e revoca preservano l'identità",
    async () => {
      assert.ok(invitedEmployee);
      const row = page
        .getByText(`Dipendente ${run}`, { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
      await row.getByLabel("Hacer pedidos / caja", { exact: true }).uncheck();
      await row.getByRole("button", { name: "Guardar permisos", exact: true }).click();
      await page.getByText("Permisos actualizados", { exact: true }).waitFor();
      assert.ok(
        !check(
          await admin
            .from("user_roles")
            .select("permissions")
            .eq("user_id", invitedEmployee.id)
            .single(),
        ).permissions.includes("use_cash"),
      );
      await row
        .getByRole("button", { name: "Guardar permisos", exact: true })
        .waitFor({ state: "hidden" });
      page.once("dialog", (d) => d.accept());
      await row
        .getByRole("button", { name: `Enviar recuperación a Dipendente ${run}`, exact: true })
        .click();
      await page
        .getByText(
          manualInvites
            ? "Enlace de recuperación preparado para su titular."
            : "Email de recuperación enviado. Solo el titular puede elegir su nueva contraseña.",
          { exact: true },
        )
        .waitFor();
      page.once("dialog", (d) => d.accept());
      await row.getByTitle("Eliminar", { exact: true }).click();
      await page.getByText("Acceso al club revocado", { exact: true }).waitFor();
      assert.equal(
        check(await admin.from("user_roles").select("id").eq("user_id", invitedEmployee.id)).length,
        0,
      );
      assert.equal(
        check(await admin.auth.admin.getUserById(invitedEmployee.id)).user.id,
        invitedEmployee.id,
      );
      assert.ok(
        check(await admin.from("profiles").select("id").eq("id", invitedEmployee.id).single()),
      );
    },
  );
  const denied = await actor("readonly", clubId, []);
  const editor = await actor("editor", clubId, ["manage_members"]);
  const cashier = await actor("cashier", clubId, ["use_cash"]);
  await record("Permessi nativi: dipendente senza gestione soci non può modificarli", async () => {
    assert.ok(member);
    const out = check(
      await denied.api
        .from("members")
        .update({ city: "Forbidden" })
        .eq("id", member.id)
        .select("id"),
    );
    assert.equal(out.length, 0);
    const out2 = await denied.api.from("members").insert({
      club_id: clubId,
      first_name: "Forbidden",
      last_name: "Demo",
      birth_date: "2000-01-01",
      city: "Demo",
      phone: "000",
      dni_number: `DENIED${run}`,
      plan_id: quota.id,
      joined_at: "2026-11-05",
      expires_at: "2026-12-05",
    });
    assert.ok(out2.error);
  });
  await record("Permessi nativi: editor autorizzato e isolamento altro club", async () => {
    assert.ok(member);
    check(await editor.api.from("members").update({ city: "Editor Demo" }).eq("id", member.id));
    assert.equal(
      check(await admin.from("members").select("city").eq("id", member.id).single()).city,
      "Editor Demo",
    );
    const clubB = check(
      await admin
        .from("clubs")
        .insert({ name: `Demo B ${run}`, slug: `demo-b-${run}` })
        .select("id")
        .single(),
    );
    const outside = await actor("outside", clubB.id, ["manage_members"]);
    assert.equal(
      check(await outside.api.from("members").select("id").eq("id", member.id)).length,
      0,
    );
    assert.equal(
      check(
        await outside.api
          .from("members")
          .update({ city: "Forbidden B" })
          .eq("id", member.id)
          .select("id"),
      ).length,
      0,
    );
  });
  await record("Ruoli: PostgREST rifiuta escalation diretta del dipendente", async () => {
    const out = await denied.api
      .from("user_roles")
      .update({ role: "admin" })
      .eq("user_id", denied.id);
    assert.ok(out.error);
    assert.equal(
      check(await admin.from("user_roles").select("role").eq("user_id", denied.id).single()).role,
      "collaborator",
    );
  });
  await record("Cassa base senza ordini: rifiuto importo negativo", async () => {
    const cashPage = await login(cashier);
    await cashPage.goto(new URL("/caja", origin).href, { waitUntil: "networkidle" });
    await cashPage.locator('input[inputmode="decimal"]').fill("-1");
    await cashPage.getByRole("button", { name: "Abrir caja", exact: true }).click();
    await cashPage.getByText(/Caja abierta|Importe no válido/, { exact: true }).waitFor();
    const rows = check(
      await admin.from("cash_sessions").select("*").eq("user_id", cashier.id).eq("status", "open"),
    );
    try {
      assert.equal(rows.length, 0);
    } finally {
      if (rows.length)
        check(
          await admin
            .from("cash_sessions")
            .update({
              status: "closed",
              closed_at: new Date().toISOString(),
              closing_cash_cents: 0,
            })
            .eq("id", rows[0].id),
        );
    }
  });
  await record("Cassa base senza ordini: apertura e chiusura con conteggio", async () => {
    const cp = await login(cashier);
    await cp.goto(new URL("/caja", origin).href, { waitUntil: "networkidle" });
    await cp.locator('input[inputmode="decimal"]').fill("12,50");
    await cp.getByRole("button", { name: "Abrir caja", exact: true }).click();
    await cp.getByRole("button", { name: "Cerrar caja", exact: true }).waitFor();
    const open = check(
      await admin
        .from("cash_sessions")
        .select("*")
        .eq("user_id", cashier.id)
        .eq("status", "open")
        .single(),
    );
    assert.equal(open.opening_cash_cents, 1250);
    await cp.locator('input[inputmode="decimal"]').fill("12,50");
    await cp.getByRole("button", { name: "Cerrar caja", exact: true }).click();
    await cp.getByRole("button", { name: "Abrir caja", exact: true }).waitFor();
    const closed = check(await admin.from("cash_sessions").select("*").eq("id", open.id).single());
    assert.equal(closed.status, "closed");
    assert.equal(closed.closing_cash_cents, 1250);
  });
  await record("Report: errore dati visibile invece di statistiche a zero", async () => {
    await page.route("**/sandbox-api/rest/v1/check_ins?**", (r) =>
      r.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic outage" }),
      }),
    );
    try {
      await page.goto(new URL("/ajustes/informes", origin).href, { waitUntil: "networkidle" });
      await page.getByRole("alert").waitFor({ timeout: 30000 });
    } finally {
      await page.unroute("**/sandbox-api/rest/v1/check_ins?**");
    }
  });
  const receiptClub = check(
    await admin
      .from("clubs")
      .insert({ name: `Ledger Demo ${run}`, slug: `ledger-${run}` })
      .select("id")
      .single(),
  );
  const receiptMember = check(
    await admin
      .from("members")
      .insert({
        club_id: receiptClub.id,
        first_name: "Persona Ledger",
        last_name: `Demo ${run}`,
        birth_date: "2000-01-01",
        dni_number: `LEDGER${run}`,
        joined_at: "2026-11-05",
        expires_at: "2026-12-05",
      })
      .select("*")
      .single(),
  );
  const recorder = await actor("ledger", receiptClub.id, ["use_cash"]);
  const reader = await actor("report", receiptClub.id, ["view_reports"]);
  await record("Quote incassate: UI conferma, annullamento, storico e operatore", async () => {
    const lp = await login(recorder);
    await lp.goto(new URL("/cuotas", origin).href, { waitUntil: "networkidle" });
    await lp.getByLabel("Buscar socio", { exact: true }).fill("Persona Ledger");
    await lp.getByLabel("Socio", { exact: true }).selectOption(receiptMember.id);
    await lp.getByLabel("Importe (€)", { exact: true }).fill("12,50");
    await lp.getByLabel("Método de pago", { exact: true }).selectOption("card");
    lp.once("dialog", (d) => d.dismiss());
    await lp.getByRole("button", { name: "Confirmar ingreso", exact: true }).click();
    assert.equal(
      check(await admin.from("membership_receipts").select("id").eq("club_id", receiptClub.id))
        .length,
      0,
    );
    lp.once("dialog", (d) => d.accept());
    await lp.getByRole("button", { name: "Confirmar ingreso", exact: true }).click();
    await lp.getByText("Ingreso registrado", { exact: true }).waitFor();
    const r = check(
      await admin.from("membership_receipts").select("*").eq("club_id", receiptClub.id).single(),
    );
    assert.equal(r.amount_cents, 1250);
    assert.equal(r.recorded_by, recorder.id);
    assert.equal(r.member_id, receiptMember.id);
    assert.equal(r.payment_method, "card");
    assert.ok(r.recorded_at);
    await lp.getByTestId("receipts-history").getByText(r.id, { exact: true }).waitFor();
    await lp.getByLabel("Agrupar", { exact: true }).selectOption("month");
    await lp
      .getByTestId("receipts-summary")
      .getByText(/2026-11/)
      .waitFor();
  });
  await record(
    "Incassi: idempotenza concorrente, storico immutabile e isolamento club",
    async () => {
      const payload = {
        p_club_id: receiptClub.id,
        p_member_id: receiptMember.id,
        p_amount_cents: 300,
        p_payment_method: "transfer",
        p_description: "Synthetic receipt",
        p_request_id: randomBytes(16)
          .toString("hex")
          .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"),
      };
      const [a, b] = await Promise.all([
        recorder.api.rpc("record_membership_receipt", payload),
        recorder.api.rpc("record_membership_receipt", payload),
      ]);
      assert.equal(check(a).id, check(b).id);
      assert.ok(
        (await recorder.api.rpc("record_membership_receipt", { ...payload, p_amount_cents: 301 }))
          .error,
      );
      assert.ok(
        (
          await reader.api.rpc("record_membership_receipt", {
            ...payload,
            p_request_id: crypto.randomUUID(),
          })
        ).error,
      );
      assert.ok((await denied.api.rpc("record_membership_receipt", payload)).error);
      assert.equal(
        check(
          await denied.api.from("membership_receipts").select("id").eq("club_id", receiptClub.id),
        ).length,
        0,
      );
      assert.ok(
        (
          await denied.api.rpc("membership_receipt_report", {
            p_club_id: receiptClub.id,
            p_from: "2026-11-01",
            p_to: "2026-12-01",
            p_group: "day",
          })
        ).error,
      );
      assert.ok(
        (
          await recorder.api
            .from("membership_receipts")
            .update({ amount_cents: 1 })
            .eq("id", a.data.id)
        ).error,
      );
      assert.ok(
        (await recorder.api.from("membership_receipts").delete().eq("id", a.data.id)).error,
      );
      const rp = await login(reader);
      await rp.goto(new URL("/cuotas", origin).href, { waitUntil: "networkidle" });
      await rp.getByTestId("receipts-total").getByText(/15,50/).waitFor();
      assert.equal(await rp.getByRole("button", { name: "Confirmar ingreso" }).count(), 0);
    },
  );
  await record("Incassi: report giornalieri/mensili e storico con confini Madrid", async () => {
    const make = (at, cents) => ({
      club_id: receiptClub.id,
      member_id: receiptMember.id,
      member_name: "Synthetic boundary",
      member_number: receiptMember.member_number,
      recorded_by: recorder.id,
      operator_name: "Synthetic operator",
      amount_cents: cents,
      payment_method: "cash",
      description: "Synthetic date boundary",
      request_id: crypto.randomUUID(),
      recorded_at: at,
    });
    check(
      await admin
        .from("membership_receipts")
        .insert([
          make("2026-10-31T23:30:00Z", 100),
          make("2026-11-30T22:30:00Z", 200),
          make("2026-11-30T23:30:00Z", 400),
        ]),
    );
    const args = { p_club_id: receiptClub.id, p_from: "2026-11-01", p_to: "2026-12-01" };
    const monthly = check(
      await reader.api.rpc("membership_receipt_report", { ...args, p_group: "month" }),
    );
    assert.equal(
      monthly.reduce((s, r) => s + Number(r.total_cents), 0),
      1850,
    );
    const daily = check(
      await reader.api.rpc("membership_receipt_report", { ...args, p_group: "day" }),
    );
    assert.equal(daily.find((r) => r.period === "2026-11-01").total_cents, 100);
    const rp = await login(reader);
    await rp.goto(new URL("/cuotas", origin).href, { waitUntil: "networkidle" });
    await rp.getByLabel("Hasta", { exact: true }).fill("2026-11-30");
    await rp.getByTestId("receipts-total").getByText(/18,50/).waitFor();
    await rp.getByRole("heading", { name: "Histórico (4)", exact: true }).waitFor();
  });

  await record(
    "Super Admin: selezione esplicita club e nessuna mescolanza nei report",
    async () => {
      const rootUser = await actor("supervisor", receiptClub.id, []);
      check(
        await admin
          .from("user_roles")
          .insert({ user_id: rootUser.id, role: "super_admin", club_id: null, permissions: [] }),
      );
      const sp = await login(rootUser);
      await sp.goto(new URL("/cuotas", origin).href, { waitUntil: "networkidle" });
      await sp.getByLabel("Club", { exact: true }).selectOption(receiptClub.id);
      await sp.getByTestId("receipts-total").getByText(/16,50/).waitFor();
      await sp.getByLabel("Club", { exact: true }).selectOption(clubId);
      await sp.getByTestId("receipts-total").getByText(/0,00/).waitFor();
    },
  );
  await record(
    "Catalogo e genetica informativa: creazione manuale e inventario atomico",
    async () => {
      const category = check(
        await admin
          .from("product_categories")
          .insert({
            club_id: clubId,
            name: `Forniture ${run}`,
            unit_type: "unit",
            is_smokeable: false,
          })
          .select("*")
          .single(),
      );
      await page.goto(new URL("/productos", origin).href, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Crear producto", exact: true }).first().click();
      await page.getByLabel("Categoría", { exact: true }).selectOption(category.id);
      await page.getByPlaceholder("ej. Amnesia Haze").fill(`Materiale sintetico ${run}`);
      await page.getByLabel("Stock (unit)", { exact: true }).fill("10");
      await page.getByRole("button", { name: "Crear producto", exact: true }).last().click();
      await page
        .getByText("Producto creado. Puedes solicitar una propuesta de IA desde la ficha.", {
          exact: true,
        })
        .waitFor();
      const p = check(
        await admin
          .from("products")
          .select("*")
          .eq("club_id", clubId)
          .eq("name", `Materiale sintetico ${run}`)
          .single(),
      );
      const before = check(await admin.from("stock_movements").select("*").eq("product_id", p.id));
      assert.equal(before.length, 1);
      assert.equal(Number(before[0].delta), 10);
      const editorCatalog = await actor("catalog", clubId, ["manage_products"]);
      const [one, two] = await Promise.all([
        editorCatalog.api.rpc("adjust_administrative_stock", {
          p_id: p.id,
          p_delta: 2,
          p_expected: 10,
          p_notes: "Synthetic administrative resources",
        }),
        editorCatalog.api.rpc("adjust_administrative_stock", {
          p_id: p.id,
          p_delta: 2,
          p_expected: 10,
          p_notes: "Synthetic stale adjustment",
        }),
      ]);
      assert.equal([one, two].filter((r) => !r.error).length, 1);
      assert.equal(
        Number(check(await admin.from("products").select("stock").eq("id", p.id).single()).stock),
        12,
      );
      assert.ok(
        (
          await denied.api.rpc("adjust_administrative_stock", {
            p_id: p.id,
            p_delta: 1,
            p_expected: 12,
            p_notes: "Forbidden",
          })
        ).error,
      );
      const forbidden = check(
        await denied.api.from("products").update({ name: "Forbidden" }).eq("id", p.id).select("id"),
      );
      assert.equal(forbidden.length, 0);
      const informational = check(
        await admin
          .from("product_categories")
          .insert({
            club_id: clubId,
            name: `Genetiche informative ${run}`,
            unit_type: "unit",
            is_smokeable: true,
          })
          .select("id")
          .single(),
      );
      const id = check(
        await editorCatalog.api.rpc("save_administrative_product", {
          p_id: null,
          p_values: {
            name: `Scheda informativa ${run}`,
            category_id: informational.id,
            stock: 0,
            buy_price: 0,
            sell_price: 0,
            strain: "hibrida",
            notes: "Solo dati sintetici e catalogo informativo",
          },
        }),
      );
      assert.equal(
        check(await admin.from("products").select("strain").eq("id", id).single()).strain,
        "hibrida",
      );
      assert.equal(
        check(await admin.from("stock_movements").select("id").eq("product_id", p.id)).length,
        2,
      );
    },
  );
  await record("Super Admin: creazione club e account amministratore dalla UI", async () => {
    const supervisor = await actor("clubcreator", clubId, []);
    check(
      await admin
        .from("user_roles")
        .insert({ user_id: supervisor.id, role: "super_admin", club_id: null, permissions: [] }),
    );
    const sp = await login(supervisor);
    await sp.goto(new URL("/snoop-admin", origin).href, { waitUntil: "networkidle" });
    await sp.getByLabel("Nombre", { exact: true }).fill(`Pilota sintetico ${run}`);
    await sp.getByLabel("Slug (a-z, 0-9, -)", { exact: true }).fill(`pilot-${run}`);
    await sp.getByRole("button", { name: "Crear club", exact: true }).click();
    await sp.getByText("Club creado", { exact: true }).waitFor();
    const club = check(await admin.from("clubs").select("id").eq("slug", `pilot-${run}`).single());
    await sp.getByLabel("Club", { exact: true }).selectOption(club.id);
    await sp.getByLabel("Nombre completo", { exact: true }).fill("Amministratore sintetico");
    await sp.getByLabel("Email", { exact: true }).fill(`clubadmin.${run}@example.test`);
    await sp.getByRole("button", { name: "Crear acceso / invitar", exact: true }).click();
    await sp
      .getByText(
        manualInvites
          ? "Invitación preparada. Comparte el enlace de un solo uso únicamente con su titular."
          : "Administrador creado. Invitación enviada por email.",
        { exact: true },
      )
      .waitFor();
    const role = check(
      await admin
        .from("user_roles")
        .select("user_id")
        .eq("club_id", club.id)
        .eq("role", "admin")
        .single(),
    );
    assert.equal(
      check(await admin.auth.admin.getUserById(role.user_id)).user.email,
      `clubadmin.${run}@example.test`,
    );
    if (manualInvites) {
      const link = await sp.getByLabel("Enlace de un solo uso", { exact: true }).inputValue();
      assert.equal(new URL(link).origin, origin.origin);
      const fragment = new URLSearchParams(new URL(link).hash.slice(1));
      assert.equal(fragment.get("type"), "invite");
      const context = await browser.newContext({ serviceWorkers: "block" });
      contexts.push(context);
      await context.route("**/*", (r) =>
        new URL(r.request().url()).origin === origin.origin ? r.continue() : r.abort(),
      );
      const account = await context.newPage();
      await account.goto(link, { waitUntil: "networkidle" });
      const password = randomBytes(24).toString("base64url");
      await account
        .getByPlaceholder("Nueva contraseña (mínimo 8 caracteres)", { exact: true })
        .fill(password);
      await account.getByPlaceholder("Repite contraseña", { exact: true }).fill(password);
      await account.getByRole("button", { name: "Actualizar", exact: true }).click();
      await account
        .getByRole("heading", { name: `Pilota sintetico ${run}`, exact: true })
        .waitFor();
      const fresh = await login({ email: `clubadmin.${run}@example.test`, password });
      await fresh.getByRole("heading", { name: `Pilota sintetico ${run}`, exact: true }).waitFor();
      const reused = await client(env.SUPABASE_PUBLISHABLE_KEY).auth.verifyOtp({
        token_hash: fragment.get("token_hash"),
        type: "invite",
      });
      assert.ok(reused.error);
    }
  });
  results.push(
    {
      name: "Dettatura vocale reale AI IT/ES",
      status: "BLOCKED",
      detail:
        "Credenziali provider reale e dispositivo/microfono non disponibili; test dei contratti locali riportati separatamente.",
    },
    {
      name: "Android fisico",
      status: "BLOCKED",
      detail: "Nessun dispositivo fisico collegato; test PWA Chromium mobile separato.",
    },
  );
} finally {
  await writeFile(join(artifacts, "results.json"), JSON.stringify({ run, results }, null, 2), {
    mode: 0o600,
  });
  for (const ctx of contexts) await ctx.close();
  await browser.close();
}
const counts = Object.fromEntries(
  ["PASS", "FAIL", "BLOCKED"].map((s) => [s, results.filter((x) => x.status === s).length]),
);
console.log(JSON.stringify(counts));
if (counts.FAIL) process.exitCode = 1;

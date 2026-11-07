import assert from "node:assert/strict";
import { chromium, devices } from "playwright-core";
import { fromJSON } from "seroval";
import { parseAdministrativeDictation } from "../src/lib/member-administration.ts";
const base = "http://127.0.0.1:3000",
  uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "synthetic@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
  exp = Math.floor(Date.now() / 1000) + 3600;
const auth = {
  user,
  access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: uid, exp, aud: "authenticated", role: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_in: 3600,
  expires_at: exp,
  token_type: "bearer",
};
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  headless: true,
});
try {
  for (const [language, transcript, surname] of [
    [
      "it",
      "nome Persona cognome Sintetica data di nascita 2000-01-02 città Demo telefono 000000000 quota Mensile",
      "Sintetica",
    ],
    [
      "es",
      "nombre Persona apellido Sintética fecha de nacimiento 2000-01-02 ciudad Demo teléfono 000000000 cuota Mensual",
      "Sintética",
    ],
  ]) {
    const context = await browser.newContext({
      ...devices["Pixel 7"],
      permissions: ["microphone"],
      serviceWorkers: "block",
    });
    let audioCalls = 0,
      extractCalls = 0,
      writes = 0;
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.includes("_serverFn")) {
        let result = { available: true, documents: false, browserSpeech: false };
        if (req.method() === "POST") {
          const data = fromJSON(JSON.parse(req.postData())).data;
          if (data.audioBase64) {
            audioCalls++;
            assert.equal(data.language, language);
            assert.ok(data.audioBase64.length > 1000);
            assert.match(data.mimeType, /^audio\//);
            assert.deepEqual(Object.keys(data).sort(), ["audioBase64", "language", "mimeType"]);
            result = { text: transcript };
          } else if (data.transcript) {
            extractCalls++;
            result = {
              fields: {
                ...data.current,
                ...parseAdministrativeDictation(data.transcript, ["Mensual"]),
              },
              source: "local",
              warning: null,
            };
          }
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ result, context: {} }),
        });
      }
      if (!url.pathname.startsWith("/sandbox-api/")) return route.continue();
      let data = [];
      if (url.pathname.endsWith("/auth/v1/user")) data = user;
      else if (url.pathname.endsWith("/rpc/snoop_access_context"))
        data = {
          role: "admin",
          status: "active",
          clubId: club,
          clubName: "Synthetic",
          permissions: [
            "manage_members",
            "manage_products",
            "manage_collaborators",
            "view_reports",
            "use_cash",
          ],
        };
      else if (url.pathname.endsWith("/rpc/current_club_id")) data = club;
      else if (url.pathname.endsWith("/membership_plans"))
        data = [
          {
            id: "20000000-0000-4000-8000-000000000001",
            name: "Mensual",
            duration_days: 30,
            price_cents: 1000,
            active: true,
          },
        ];
      else if (url.pathname.endsWith("/club_member_field_config")) data = [];
      else if ((url.pathname.endsWith("/members") && req.method() !== "GET") || url.pathname.endsWith("/rpc/save_membership_with_receipt")) writes++;
      if (req.headers().accept?.includes("vnd.pgrst.object+json") && Array.isArray(data))
        data = data[0] ?? null;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    await context.addInitScript(
      ({ auth, language }) => {
        localStorage.setItem("sb-127-auth-token", JSON.stringify(auth));
        localStorage.setItem("snoop:voice-language", language + "-" + language.toUpperCase());
      },
      { auth, language },
    );
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(base + "/soci/nuovo", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Dictar datos", exact: true }).click();
    await page.getByText("● Escuchando… pulsa para parar", { exact: true }).waitFor();
    // Record a real MediaRecorder chunk from Chromium's synthetic microphone.
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: "Dictar datos", exact: true }).click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("input")).some((input) => input.value === "Persona"),
    );
    assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "Persona");
    assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), surname);
    assert.equal(
      await page.getByLabel("Fecha de nacimiento *", { exact: true }).inputValue(),
      "2000-01-02",
    );
    assert.equal(audioCalls, 1);
    assert.equal(extractCalls, 1);
    assert.equal(writes, 0, "Dictation must never save without confirmation");
    await context.close();
    console.log(
      "PASS",
      language,
      "real local MediaRecorder + simulated transcription + form fields + zero automatic writes",
    );
  }
} finally {
  await browser.close();
}

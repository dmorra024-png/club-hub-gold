import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  inspectSnoopCloudflare,
  SNOOP_CLOUDFLARE_USER_AGENT,
} from "../scripts/lib/snoop-cloudflare-access.mjs";
const options = { account: "a".repeat(32), token: "synthetic-private-token" };
test("diagnostics perform only exact SNOOP GET requests without redirects", async () => {
  for (const path of ["settings", "verify"])
    await inspectSnoopCloudflare({
      ...options,
      path,
      userAgent: SNOOP_CLOUDFLARE_USER_AGENT,
      request: async (url, init) => {
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "error");
        assert.equal(new URL(url).hostname, "api.cloudflare.com");
        assert.equal(init.headers["User-Agent"], SNOOP_CLOUDFLARE_USER_AGENT);
        assert.ok(
          url.endsWith(
            path === "verify" ? "/user/tokens/verify" : "/workers/scripts/snoop-pilot/settings",
          ),
        );
        return Response.json({ success: true, result: { status: "active" } });
      },
    });
  await assert.rejects(inspectSnoopCloudflare({ ...options, path: "other-worker" }), /Unapproved/);
});
test("settings diagnostics retain only names and types, never values or credentials", async () => {
  const result = await inspectSnoopCloudflare({
    ...options,
    request: async () =>
      Response.json({
        success: true,
        result: {
          bindings: [
            {
              name: "SUPABASE_SERVICE_ROLE_KEY",
              type: "secret_text",
              text: "synthetic-secret-value",
            },
            { name: "APP_URL", type: "plain_text", text: "https://snoop.example.test" },
          ],
        },
      }),
  });
  assert.deepEqual(result.bindings, [
    { name: "SUPABASE_SERVICE_ROLE_KEY", type: "secret_text" },
    { name: "APP_URL", type: "plain_text" },
  ]);
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
  assert.equal(JSON.stringify(result).includes(options.token), false);
});
test("403 distinguishes API permission errors from browser-integrity blocks without leaking messages", async () => {
  const auth = await inspectSnoopCloudflare({
    ...options,
    request: async () =>
      Response.json(
        { success: false, errors: [{ code: 10000, message: options.token }] },
        { status: 403 },
      ),
  });
  assert.deepEqual(auth.error_codes, [10000]);
  assert.equal(auth.browser_check_1010, false);
  assert.equal(JSON.stringify(auth).includes(options.token), false);
  const browser = await inspectSnoopCloudflare({
    ...options,
    request: async () => new Response("error code: 1010", { status: 403 }),
  });
  assert.equal(browser.browser_check_1010, true);
});
test("diagnostic job cannot select the deployment branch and contains no write command", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/snoop-pilot-deploy.yml", import.meta.url),
    "utf8",
  );
  const diagnostic = workflow.slice(workflow.indexOf("  diagnose-snoop:"));
  assert.match(diagnostic, /inputs.confirm == 'DIAGNOSE-SNOOP-PILOT'/);
  assert.doesNotMatch(diagnostic, /wrangler deploy|secret put|upload-snoop-runtime|supabase/i);
  const deployment = workflow.slice(
    workflow.indexOf("  deploy-snoop:"),
    workflow.indexOf("  diagnose-snoop:"),
  );
  assert.match(deployment, /inputs.confirm == 'DEPLOY-SNOOP-PILOT'/);
});

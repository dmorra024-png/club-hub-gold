import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  inspectSnoopCloudflare,
  snoopAppUrlState,
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

test("own-token policy inspection is optional and does not disclose token or account IDs", async () => {
  let calls = 0;
  const tokenId = "b".repeat(32);
  const result = await inspectSnoopCloudflare({
    ...options,
    path: "verify",
    readPolicy: true,
    request: async (url, init) => {
      assert.equal(init.method, "GET");
      calls++;
      return calls === 1
        ? Response.json({ success: true, result: { id: tokenId, status: "active" } })
        : Response.json({
            success: true,
            result: {
              policies: [
                {
                  effect: "allow",
                  permission_groups: [{ name: "Workers Scripts Write" }],
                  resources: { ["com.cloudflare.api.account." + options.account]: "*" },
                },
              ],
            },
          });
    },
  });
  assert.equal(result.token_policy.snoop_account_in_scope, true);
  assert.deepEqual(result.token_policy.permission_groups, ["Workers Scripts Write"]);
  assert.equal(JSON.stringify(result).includes(tokenId), false);
  assert.equal(JSON.stringify(result).includes(options.account), false);
});

test("APP_URL diagnostic reveals only a classification, never private URL content",()=>{
 assert.equal(snoopAppUrlState([{name:"APP_URL",type:"plain_text",text:"https://snoop-pilot.dmorra024.workers.dev"}]),"CANONICAL");
 assert.equal(snoopAppUrlState([{name:"APP_URL",type:"plain_text",text:"http://localhost:3000"}]),"LOCALHOST");
 assert.equal(snoopAppUrlState([{name:"APP_URL",type:"secret_text",text:"synthetic-secret"}]),"PROTECTED_NOT_READABLE");
 assert.equal(snoopAppUrlState([{name:"APP_URL",type:"plain_text",text:"https://other.example.test/?secret=synthetic"}]),"WRONG_ORIGIN");
});

import assert from "node:assert/strict";
import process from "node:process";

const base = new URL(process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
  "Run this smoke test only against a local development server",
);

for (const [path, title] of [
  ["/auth", "Acceso | SNOOP"],
  ["/reset-password", "Cambiar contraseña | SNOOP"],
]) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 200, path);
  assert.ok((await response.text()).includes(title), `${path}: expected page title`);
  console.log(`PASS ${path}: HTML rendered`);
}

const moduleResponse = await fetch(new URL("/src/lib/platform.functions.ts", base));
assert.equal(moduleResponse.status, 200);
const source = await moduleResponse.text();
assert.ok(!source.includes("setCollaboratorPassword"), "No global password-setting RPC");

for (const [name, method] of [
  ["listCollaborators", "GET"],
  ["requestCollaboratorPasswordReset", "POST"],
  ["deleteCollaborator", "POST"],
]) {
  const match = source.match(new RegExp(`export const ${name}.*?createClientRpc\\("([^"]+)"\\)`));
  assert.ok(match, `${name}: development RPC identifier`);
  const response = await fetch(new URL(`/_serverFn/${match[1]}`, base), {
    method,
    headers: { "x-tsr-serverFn": "true", Accept: "application/json" },
  });
  // TanStack serializes errors in an envelope, including HTTP 200 responses.
  // A transport status check alone would not verify authorization.
  const body = await response.text();
  assert.ok(
    body.includes("Unauthorized: No authorization header provided"),
    `${name}: authentication must reject before executing the handler`,
  );
  console.log(`PASS ${name}: unauthenticated request rejected`);
}

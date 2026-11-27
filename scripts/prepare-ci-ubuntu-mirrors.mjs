import { readFile, writeFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
/** Same signed Ubuntu archive/suites; avoid repeatedly stalled EC2/Azure HTTP downloads. */
export function officialUbuntuMirror(source) {
  return source.replace(
    /https?:\/\/[a-z0-9-]+\.ec2\.archive\.ubuntu\.com\/ubuntu(?=[\s/]|$)/gi,
    "https://archive.ubuntu.com/ubuntu",
  ).replace(
    /http:\/\/azure\.archive\.ubuntu\.com\/ubuntu(?=[\s/]|$)/gi,
    "https://archive.ubuntu.com/ubuntu",
  );
}
/** The hosted Ubuntu 24.04 runner may include a nonessential Microsoft
 * third-party APT source that returns HTTP 403. Disable it for this isolated
 * Playwright install; never skip Ubuntu signature verification. */
export function disableUnavailableMicrosoftSource(source, file) {
  if (!source.includes("packages.microsoft.com/ubuntu/24.04/prod")) return source;
  if (file.endsWith(".list")) {
    return source.split("\n").map((line) =>
      /^\s*deb(?:\s|\[)/.test(line) && line.includes("packages.microsoft.com/ubuntu/24.04/prod")
        ? "# disabled for GitHub Actions browser dependency installation: " + line
        : line,
    ).join("\n");
  }
  if (file.endsWith(".sources")) {
    return source.split(/\n\s*\n/).map((stanza) =>
      stanza.includes("packages.microsoft.com/ubuntu/24.04/prod") &&
      !/^\s*Enabled:/m.test(stanza)
        ? stanza.trimEnd() + "\nEnabled: no"
        : stanza.replace(/^\s*Enabled:\s*yes\s*$/m, "Enabled: no"),
    ).join("\n\n");
  }
  return source;
}
async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.getuid?.() !== 0)
    throw Error("CI_RUNNER_ONLY");
  const os = await readFile("/etc/os-release", "utf8");
  if (!/^ID=ubuntu$/m.test(os) || !/^VERSION_ID="24\.04"$/m.test(os))
    throw Error("EXPECTED_UBUNTU_24_04");
  const files = [
    "/etc/apt/apt-mirrors.txt",
    "/etc/apt/apt-security-mirrors.txt",
    "/etc/apt/sources.list",
  ];
  for (const name of await readdir("/etc/apt/sources.list.d"))
    if (/\.(?:list|sources)$/.test(name)) files.push("/etc/apt/sources.list.d/" + name);
  let changed = 0;
  for (const file of files) {
    let original;
    try {
      original = await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const updated = disableUnavailableMicrosoftSource(officialUbuntuMirror(original), file);
    if (updated !== original) {
      await writeFile(file, updated);
      changed++;
    }
  }
  console.log(
    JSON.stringify({
      officialUbuntuMirrorFilesUpdated: changed,
      signatureVerification: "unchanged",
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

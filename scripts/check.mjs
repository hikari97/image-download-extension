import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifests = ["chrome", "firefox"];
const packageMetadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

for (const name of manifests) {
  const path = resolve(root, "manifests", `${name}.json`);
  const manifest = JSON.parse(await readFile(path, "utf8"));

  if (manifest.manifest_version !== 3) throw new Error(`${name}: manifest_version harus 3`);
  if (!manifest.action?.default_popup) throw new Error(`${name}: default_popup belum diatur`);
  if (manifest.version !== packageMetadata.version) throw new Error(`${name}: versi manifest tidak sama dengan package.json`);
  if (!manifest.permissions?.includes("downloads")) throw new Error(`${name}: izin downloads belum diatur`);
  if (!manifest.permissions?.includes("clipboardWrite")) throw new Error(`${name}: izin clipboardWrite belum diatur`);
  if (!manifest.permissions?.includes("declarativeNetRequestWithHostAccess")) throw new Error(`${name}: izin Referer belum diatur`);
  if (!manifest.host_permissions?.includes("https://*/*")) throw new Error(`${name}: host permission HTTPS belum diatur`);

  if (name === "chrome") {
    if (!manifest.permissions.includes("offscreen")) throw new Error("chrome: izin offscreen dibutuhkan untuk Blob download");
    if (Number(manifest.minimum_chrome_version) < 109) throw new Error("chrome: minimum version harus mendukung Offscreen API");
    if (!manifest.background?.service_worker) throw new Error("chrome: service worker belum diatur");
  } else if (!manifest.background?.scripts?.length) {
    throw new Error("firefox: background scripts belum diatur");
  }

  console.log(`✓ Manifest ${name} valid`);
}

for (const file of ["src/offscreen.html", "src/popup.html", "src/popup.css"]) {
  await access(resolve(root, file));
  console.log(`✓ File ${file} tersedia`);
}

for (const file of ["src/background.js", "src/offscreen.js", "src/popup.js", "scripts/build.mjs", "scripts/package.mjs", "tests/firefox-download-unit.mjs", "tests/preview-layout.mjs", "tests/referer-runtime.mjs"]) {
  execFileSync(process.execPath, ["--check", resolve(root, file)], { stdio: "inherit" });
  console.log(`✓ Sintaks ${file} valid`);
}

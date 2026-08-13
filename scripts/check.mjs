import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifests = ["chrome", "firefox"];

for (const name of manifests) {
  const path = resolve(root, "manifests", `${name}.json`);
  const manifest = JSON.parse(await readFile(path, "utf8"));

  if (manifest.manifest_version !== 3) throw new Error(`${name}: manifest_version harus 3`);
  if (!manifest.action?.default_popup) throw new Error(`${name}: default_popup belum diatur`);
  console.log(`✓ Manifest ${name} valid`);
}

for (const file of ["src/background.js", "src/popup.js", "scripts/build.mjs", "scripts/package.mjs"]) {
  execFileSync(process.execPath, ["--check", resolve(root, file)], { stdio: "inherit" });
  console.log(`✓ Sintaks ${file} valid`);
}

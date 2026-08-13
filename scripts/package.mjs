import { execFileSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const target of ["chrome", "firefox"]) {
  const source = resolve(root, "dist", target);
  const archive = resolve(root, "dist", `image-pocket-${target}.zip`);
  await access(resolve(source, "manifest.json"));
  await rm(archive, { force: true });
  execFileSync("zip", ["-qr", archive, "."], { cwd: source });
  console.log(`✓ Paket dist/image-pocket-${target}.zip dibuat`);
}

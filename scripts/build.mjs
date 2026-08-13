import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["chrome", "firefox"];

await rm(resolve(root, "dist"), { recursive: true, force: true });

for (const target of targets) {
  const destination = resolve(root, "dist", target);
  await mkdir(destination, { recursive: true });
  await cp(resolve(root, "src"), destination, { recursive: true });

  const manifest = await readFile(resolve(root, "manifests", `${target}.json`), "utf8");
  await writeFile(resolve(destination, "manifest.json"), manifest);
}

console.log("Build selesai:");
console.log("- dist/chrome");
console.log("- dist/firefox");

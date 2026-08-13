import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] || "download";
if (!["download", "fetch"].includes(mode)) throw new Error(`Mode test tidak dikenal: ${mode}`);
const chromeCandidates = [
  "/Users/makki/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Users/makki/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
let chromeBinary = "";
for (const candidate of chromeCandidates) {
  try {
    await access(candidate);
    chromeBinary = candidate;
    break;
  } catch {
    // Coba kandidat berikutnya.
  }
}
if (!chromeBinary) throw new Error("Chrome/Chromium untuk pengujian tidak ditemukan.");
const expectedReferer = "https://custom-referer.example/products/42";
const requests = [];
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const server = createServer((request, response) => {
  requests.push({ url: request.url, referer: request.headers.referer || "" });

  if (request.url === "/redirect") {
    response.writeHead(302, { location: `http://localhost:${server.address().port}/image.png` });
    response.end();
    return;
  }

  if (request.url === "/image.png") {
    response.writeHead(200, {
      "content-type": "image/png",
      "content-length": pixel.length
    });
    response.end(pixel);
    return;
  }

  response.writeHead(404);
  response.end();
});

server.listen(0, "127.0.0.1");
await once(server, "listening");

const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const tempRoot = await mkdtemp(resolve(tmpdir(), "image-pocket-referer-"));
const extensionRoot = resolve(tempRoot, "extension");
const profileRoot = resolve(tempRoot, "profile");
const downloadRoot = resolve(tempRoot, "downloads");
const expectedDownload = resolve(downloadRoot, "Image Pocket Test", "referer-test.png");
await mkdir(extensionRoot, { recursive: true });
await mkdir(resolve(profileRoot, "Default"), { recursive: true });
await mkdir(downloadRoot, { recursive: true });
await writeFile(
  resolve(profileRoot, "Default", "Preferences"),
  JSON.stringify({ download: { default_directory: downloadRoot, prompt_for_download: false } })
);
const backgroundSource = await readFile(resolve(root, "src/background.js"), "utf8");
const offscreenHtml = await readFile(resolve(root, "src/offscreen.html"), "utf8");
const offscreenSource = await readFile(resolve(root, "src/offscreen.js"), "utf8");

await writeFile(
  resolve(extensionRoot, "manifest.json"),
  JSON.stringify({
    manifest_version: 3,
    name: "Image Pocket Referer Runtime Test",
    version: "1.0.0",
    permissions: ["declarativeNetRequestWithHostAccess", "downloads", "offscreen"],
    host_permissions: ["http://*/*", "https://*/*"],
    background: { service_worker: "background.js" }
  }, null, 2)
);

await writeFile(resolve(extensionRoot, "offscreen.html"), offscreenHtml);
await writeFile(resolve(extensionRoot, "offscreen.js"), offscreenSource);

await writeFile(
  resolve(extensionRoot, "background.js"),
  `${backgroundSource}
chrome.runtime.onInstalled.addListener(() => {
  const testUrl = ${JSON.stringify(`http://127.0.0.1:${port}/redirect`)};
  const referer = ${JSON.stringify(expectedReferer)};
  if (${JSON.stringify(mode)} === "fetch") {
    setRefererRules(referer, [testUrl])
      .then(() => fetch(testUrl))
      .then((response) => response.arrayBuffer())
      .catch((error) => console.error(error));
  } else {
    startDownloads({
      folder: "Image Pocket Test",
      referer,
      saveAs: false,
      items: [{ url: testUrl, filename: "referer-test.png" }]
    }).catch((error) => console.error(error));
  }
});
`
);

const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  `--user-data-dir=${profileRoot}`,
  `--download-default-directory=${downloadRoot}`,
  `--disable-extensions-except=${extensionRoot}`,
  `--load-extension=${extensionRoot}`,
  "--remote-debugging-port=0",
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] });

let stderr = "";
chrome.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  const deadline = Date.now() + 25000;
  let downloaded = false;
  while (Date.now() < deadline) {
    try {
      await access(expectedDownload);
      downloaded = true;
    } catch {
      downloaded = false;
    }

    const networkComplete = requests.some((entry) => entry.url === "/image.png");
    if (networkComplete && (mode === "fetch" || downloaded)) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  const relevant = requests.filter((entry) => ["/redirect", "/image.png"].includes(entry.url));
  if (relevant.length < 2) {
    throw new Error(`Request download tidak lengkap. Browser log: ${stderr.slice(-1000)}`);
  }

  const failures = relevant.filter((entry) => entry.referer !== expectedReferer);
  if (failures.length) {
    throw new Error(`Referer salah: ${JSON.stringify(relevant)}`);
  }

  if (mode === "download") {
    if (!downloaded) throw new Error("Request memakai Referer, tetapi file akhir tidak dibuat oleh browser.");
    const downloadedBytes = await readFile(expectedDownload);
    if (!downloadedBytes.equals(pixel)) throw new Error("Isi file hasil download tidak sama dengan respons server.");
  }

  console.log(`✓ Chrome mengirim custom Referer melalui mode ${mode} pada URL awal dan setelah redirect`);
  if (mode === "download") console.log("✓ File Blob akhir berhasil disimpan dengan isi yang utuh");
  console.log(JSON.stringify(relevant));
} finally {
  chrome.kill("SIGTERM");
  server.close();
  await rm(tempRoot, { recursive: true, force: true });
}

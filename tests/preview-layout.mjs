import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

if (!chromeBinary) throw new Error("Chrome/Chromium untuk pengujian preview tidak ditemukan.");

const fixtureUrl = pathToFileURL(resolve(root, "tests/preview-fixture.html")).href;
const { stdout } = await execFileAsync(chromeBinary, [
  "--headless=new",
  "--disable-gpu",
  "--allow-file-access-from-files",
  "--force-device-scale-factor=1",
  "--window-size=430,600",
  "--dump-dom",
  fixtureUrl
], { maxBuffer: 2 * 1024 * 1024 });

const encodedMetrics = stdout.match(/data-preview-metrics="([^"]+)"/)?.[1];
if (!encodedMetrics) throw new Error("Browser tidak menghasilkan metrik layout preview.");

const metrics = JSON.parse(Buffer.from(encodedMetrics, "base64").toString("utf8"));
if (metrics.gridColumns !== 2) throw new Error(`Preview harus dua kolom, ditemukan ${metrics.gridColumns}.`);
if (metrics.cardWidth < 180 || metrics.cardWidth > 200) throw new Error(`Lebar kartu dua kolom tidak sesuai: ${metrics.cardWidth}px.`);
if (metrics.gridScrollHeight <= metrics.gridClientHeight) {
  throw new Error("Daftar panjang seharusnya menggulir tanpa menyusutkan kartu.");
}
if (metrics.gridScrollWidth > metrics.gridClientWidth + 1) throw new Error("Grid preview mengalami overflow horizontal.");
if (metrics.actionCount !== 4) throw new Error("Tombol Salin link/Buka tab tidak lengkap pada fixture.");
if (metrics.cards.length !== 2) throw new Error("Fixture harus berisi dua kartu preview.");
if (metrics.cards[0].height >= metrics.cards[1].height) {
  throw new Error("Kartu landscape ikut diregangkan setinggi kartu portrait.");
}

for (const card of metrics.cards) {
  if (Math.abs(card.height - card.scrollHeight) > 3) {
    throw new Error(`Isi kartu terpotong: tinggi ${card.height}px, scrollHeight ${card.scrollHeight}px.`);
  }
}

for (const preview of metrics.previews) {
  const expectedHeight = preview.imageBoxWidth * preview.naturalHeight / preview.naturalWidth;
  if (Math.abs(preview.imageBoxHeight - expectedHeight) > 1) {
    throw new Error(`Tinggi preview tidak mengikuti rasio asli: ${JSON.stringify(preview)}.`);
  }
  if (Math.abs(preview.imageBoxHeight - preview.thumbHeight) > 1) {
    throw new Error(`Kotak preview memotong gambar: ${JSON.stringify(preview)}.`);
  }
  if (preview.objectFit !== "contain") {
    throw new Error(`Preview berpotensi terpotong karena object-fit=${preview.objectFit}.`);
  }
}

console.log("✓ Preview tampil dua kolom tanpa overflow horizontal");
console.log("✓ Tinggi landscape dan portrait otomatis mengikuti rasio asli");
console.log("✓ Gambar dan kartu tidak diregangkan atau terpotong");

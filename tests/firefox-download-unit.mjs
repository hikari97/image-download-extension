import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/background.js"), "utf8");
const capturedDownloads = [];
const sessionRuleUpdates = [];

const chrome = {
  runtime: {
    getURL: (path = "") => `moz-extension://unit-test/${path}`,
    lastError: null,
    onConnect: { addListener() {} },
    onMessage: { addListener() {} },
    sendMessage(_message, callback) { callback({ ok: true }); }
  },
  downloads: {
    onChanged: { addListener() {} },
    download(options, callback) {
      capturedDownloads.push(options);
      callback(101);
    }
  },
  declarativeNetRequest: {
    updateSessionRules(options, callback) {
      sessionRuleUpdates.push(options);
      callback();
    }
  }
};

const browser = {
  declarativeNetRequest: {
    async updateSessionRules(options) {
      sessionRuleUpdates.push(options);
    }
  }
};

const context = vm.createContext({
  browser,
  chrome,
  console,
  Promise,
  URL
});

vm.runInContext(source, context, { filename: "background.js" });

const response = await vm.runInContext(`startDownloads({
  folder: "Image Pocket",
  referer: "https://referer.example/gallery/",
  saveAs: false,
  items: [{ url: "https://cdn.example/image.jpg", filename: "image.jpg" }]
})`, context);

assert.equal(response.results[0].ok, true);
assert.equal(response.downloadMethod, "browser-download");
assert.deepEqual(
  JSON.parse(JSON.stringify(capturedDownloads[0].headers)),
  [{ name: "Referer", value: "https://referer.example/gallery/" }]
);
assert.equal(capturedDownloads[0].filename, "Image Pocket/image.jpg");
assert.ok(sessionRuleUpdates.some((update) => update.addRules?.length === 1));

console.log("✓ Firefox menerima custom Referer langsung pada opsi downloads.download");

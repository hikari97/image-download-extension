const DOWNLOAD_MESSAGE = "DOWNLOAD_IMAGES";
const REFERER_MESSAGE = "SET_REFERER_RULES";
const FETCH_IMAGE_MESSAGE = "FETCH_IMAGE_AS_BLOB";
const REVOKE_OBJECT_URL_MESSAGE = "REVOKE_OBJECT_URL";
const REFERER_RULE_ID = 8001;
const OFFSCREEN_PATH = "offscreen.html";
const DOWNLOAD_CONCURRENCY = 3;

const activeDownloadIds = new Set();
const objectUrlsByDownloadId = new Map();
let openPopupCount = 0;
let startingBatchCount = 0;
let creatingOffscreenDocument = null;
let downloadQueue = Promise.resolve();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "IMAGE_POCKET_POPUP") return;

  openPopupCount += 1;
  port.onDisconnect.addListener(() => {
    openPopupCount = Math.max(0, openPopupCount - 1);
    clearRefererWhenIdle();
  });
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state || !["complete", "interrupted"].includes(delta.state.current)) return;
  if (!activeDownloadIds.has(delta.id) && !objectUrlsByDownloadId.has(delta.id)) return;

  activeDownloadIds.delete(delta.id);

  const objectUrl = objectUrlsByDownloadId.get(delta.id);
  if (objectUrl) {
    objectUrlsByDownloadId.delete(delta.id);
    revokeObjectUrl(objectUrl);
  }

  clearRefererWhenIdle();
  closeOffscreenWhenIdle();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === REFERER_MESSAGE) {
    setRefererRules(message.referer, message.urls)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type !== DOWNLOAD_MESSAGE || !Array.isArray(message.items)) {
    return false;
  }

  const queuedBatch = downloadQueue.then(
    () => startDownloads(message),
    () => startDownloads(message)
  );
  downloadQueue = queuedBatch.then(() => undefined, () => undefined);

  queuedBatch
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ error: error.message }));

  return true;
});

async function startDownloads(message) {
  const folder = sanitizeFolder(message.folder || "Image Pocket");
  const saveAs = Boolean(message.saveAs);
  const referer = normalizeReferer(message.referer);
  const items = message.items.map((item) => ({
    url: String(item.url || ""),
    filename: sanitizeFilename(item.filename || "gambar")
  }));

  startingBatchCount += 1;

  try {
    await setRefererRules(referer, items.map((item) => item.url));

    const results = await mapWithConcurrency(
      items,
      DOWNLOAD_CONCURRENCY,
      (item) => downloadFile(item, folder, saveAs, referer)
    );

    return {
      results,
      folder,
      refererApplied: Boolean(referer),
      downloadMethod: referer && !isFirefox() ? "verified-fetch" : "browser-download"
    };
  } finally {
    startingBatchCount = Math.max(0, startingBatchCount - 1);
    clearRefererWhenIdle();
    closeOffscreenWhenIdle();
  }
}

async function downloadFile(item, folder, saveAs, referer) {
  const targetPath = folder ? `${folder}/${item.filename}` : item.filename;
  let downloadUrl = item.url;
  let objectUrl = "";

  try {
    if (referer && !isFirefox() && /^https?:/i.test(item.url)) {
      const fetched = await fetchImageAsObjectUrl(item.url);
      objectUrl = fetched.objectUrl;
      downloadUrl = objectUrl;
    }

    return await startBrowserDownload({
      sourceUrl: item.url,
      downloadUrl,
      targetPath,
      filename: item.filename,
      saveAs,
      referer,
      objectUrl
    });
  } catch (error) {
    if (objectUrl) revokeObjectUrl(objectUrl);
    return {
      ok: false,
      filename: item.filename,
      error: error?.message || "Unduhan tidak dapat dimulai."
    };
  }
}

function startBrowserDownload(options) {
  return new Promise((resolve) => {
    const downloadOptions = {
      url: options.downloadUrl,
      filename: options.targetPath,
      conflictAction: "uniquify",
      saveAs: options.saveAs
    };

    // Firefox 70+ mengizinkan Referer langsung pada downloads.download().
    // Chrome melarang header ini, sehingga file Chrome sudah diambil lebih
    // dahulu melalui fetch yang diverifikasi oleh aturan DNR.
    if (options.referer && isFirefox() && /^https?:/i.test(options.sourceUrl)) {
      downloadOptions.headers = [{ name: "Referer", value: options.referer }];
    }

    chrome.downloads.download(downloadOptions, (downloadId) => {
      const error = chrome.runtime.lastError;

      if (error || downloadId === undefined) {
        if (options.objectUrl) revokeObjectUrl(options.objectUrl);
        resolve({
          ok: false,
          filename: options.filename,
          error: error?.message || "Unduhan tidak dapat dimulai."
        });
        return;
      }

      activeDownloadIds.add(downloadId);
      if (options.objectUrl) objectUrlsByDownloadId.set(downloadId, options.objectUrl);

      resolve({
        ok: true,
        filename: options.filename,
        targetPath: options.targetPath,
        downloadId
      });
    });
  });
}

async function fetchImageAsObjectUrl(url) {
  await ensureOffscreenDocument();
  const response = await sendRuntimeMessage({
    target: "offscreen",
    type: FETCH_IMAGE_MESSAGE,
    url
  });

  if (!response) throw new Error("Worker download tidak merespons.");
  if (response.error) throw new Error(response.error);
  if (!response.objectUrl) throw new Error("Worker download tidak menghasilkan file.");
  return response;
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error("Browser Chrome ini belum mendukung download dengan custom Referer. Gunakan Chrome 109 atau lebih baru.");
  }

  if (await hasOffscreenDocument()) return;

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["BLOBS"],
      justification: "Mengambil gambar dengan custom Referer dan membuat Blob URL lokal untuk proses download."
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;
}

async function hasOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_PATH);

  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl]
    });
    return contexts.length > 0;
  }

  const matchedClients = await self.clients.matchAll();
  return matchedClients.some((client) => client.url === documentUrl);
}

async function closeOffscreenWhenIdle() {
  try {
    if (isFirefox() || startingBatchCount > 0 || activeDownloadIds.size > 0) return;
    if (!chrome.offscreen?.closeDocument || !(await hasOffscreenDocument())) return;
    await chrome.offscreen.closeDocument();
  } catch {
    // Dokumen mungkin sudah ditutup oleh browser atau callback lain.
  }
}

function revokeObjectUrl(objectUrl) {
  if (!objectUrl || isFirefox()) return;
  sendRuntimeMessage({
    target: "offscreen",
    type: REVOKE_OBJECT_URL_MESSAGE,
    objectUrl
  }).catch(() => {});
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

async function setRefererRules(value, urls) {
  const referer = normalizeReferer(value);
  const domains = collectHttpDomains(urls);
  const options = { removeRuleIds: [REFERER_RULE_ID] };

  if (referer && domains.length) {
    const condition = isFirefox()
      ? {
          requestDomains: domains,
          resourceTypes: ["image", "media", "other", "xmlhttprequest"]
        }
      : {
          urlFilter: "|http",
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ["image", "xmlhttprequest"]
        };

    options.addRules = [
      {
        id: REFERER_RULE_ID,
        priority: 100,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            {
              header: "Referer",
              operation: "set",
              value: referer
            }
          ]
        },
        condition
      }
    ];
  }

  await updateSessionRules(options);
  return { ok: true, enabled: Boolean(options.addRules), domains: domains.length };
}

function clearRefererWhenIdle() {
  if (openPopupCount > 0 || startingBatchCount > 0 || activeDownloadIds.size > 0) return;
  updateSessionRules({ removeRuleIds: [REFERER_RULE_ID] }).catch(() => {});
}

function updateSessionRules(options) {
  if (isFirefox() && typeof browser !== "undefined" && browser.declarativeNetRequest) {
    return browser.declarativeNetRequest.updateSessionRules(options);
  }

  return new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.updateSessionRules(options, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(limit, Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function isFirefox() {
  return chrome.runtime.getURL("").startsWith("moz-extension:");
}

function collectHttpDomains(urls) {
  const domains = new Set();

  for (const value of Array.isArray(urls) ? urls : []) {
    try {
      const url = new URL(String(value));
      if (/^https?:$/.test(url.protocol)) domains.add(url.hostname);
    } catch {
      // Abaikan URL data, blob, dan URL yang tidak valid.
    }
  }

  return Array.from(domains).slice(0, 500);
}

function normalizeReferer(value) {
  const input = String(value || "").trim();
  if (!input) return "";

  const url = new URL(input);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("HTTP Referer harus memakai protokol http:// atau https://.");
  }
  if (url.username || url.password) {
    throw new Error("HTTP Referer tidak boleh berisi username atau password.");
  }

  url.hash = "";
  return url.href;
}

function sanitizeFolder(value) {
  const reservedWindowsNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

  return String(value || "")
    .split(/[\\/]+/)
    .map((part) => part
      .replace(/[<>:"|?*\u0000-\u001f]/g, "-")
      .replace(/^\.+|[. ]+$/g, "")
      .trim()
      .slice(0, 60))
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => reservedWindowsNames.test(part) ? `_${part}` : part)
    .join("/")
    .slice(0, 120);
}

function sanitizeFilename(value) {
  const clean = String(value)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();

  return (clean || "gambar").slice(0, 180);
}

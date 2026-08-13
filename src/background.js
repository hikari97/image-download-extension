const DOWNLOAD_MESSAGE = "DOWNLOAD_IMAGES";
const REFERER_MESSAGE = "SET_REFERER_RULES";
const REFERER_RULE_ID = 8001;
let openPopupCount = 0;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "IMAGE_POCKET_POPUP") return;

  openPopupCount += 1;
  port.onDisconnect.addListener(() => {
    openPopupCount = Math.max(0, openPopupCount - 1);
    if (openPopupCount === 0) clearRefererRules().catch(() => {});
  });
});

function downloadFile(item, folder, saveAs) {
  return new Promise((resolve) => {
    const path = folder ? `${folder}/${item.filename}` : item.filename;

    chrome.downloads.download(
      {
        url: item.url,
        filename: path,
        conflictAction: "uniquify",
        saveAs
      },
      (downloadId) => {
        const error = chrome.runtime.lastError;

        if (error || downloadId === undefined) {
          resolve({
            ok: false,
            filename: item.filename,
            error: error?.message || "Unduhan tidak dapat dimulai."
          });
          return;
        }

        resolve({ ok: true, filename: item.filename, downloadId });
      }
    );
  });
}

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

  const folder = sanitizeFolder(message.folder || "Image Pocket");
  const saveAs = Boolean(message.saveAs);

  Promise.all(
    message.items.map((item) =>
      downloadFile(
        {
          url: String(item.url || ""),
          filename: sanitizeFilename(item.filename || "gambar")
        },
        folder,
        saveAs
      )
    )
  )
    .then((results) => sendResponse({ results }))
    .catch((error) => sendResponse({ error: error.message }));

  return true;
});

async function setRefererRules(value, urls) {
  const referer = normalizeReferer(value);
  const domains = collectHttpDomains(urls);
  const options = { removeRuleIds: [REFERER_RULE_ID] };

  if (referer && domains.length) {
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
        condition: {
          requestDomains: domains,
          resourceTypes: ["image", "other", "xmlhttprequest"],
          tabIds: [-1]
        }
      }
    ];
  }

  await updateSessionRules(options);
  return { ok: true, enabled: Boolean(options.addRules), domains: domains.length };
}

function clearRefererRules() {
  return updateSessionRules({ removeRuleIds: [REFERER_RULE_ID] });
}

function updateSessionRules(options) {
  if (typeof browser !== "undefined" && browser.declarativeNetRequest) {
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
  return String(value)
    .split(/[\\/]+/)
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, "").trim())
    .filter(Boolean)
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

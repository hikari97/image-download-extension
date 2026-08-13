const DOWNLOAD_MESSAGE = "DOWNLOAD_IMAGES";

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
    .trim();

  return (clean || "gambar").slice(0, 180);
}

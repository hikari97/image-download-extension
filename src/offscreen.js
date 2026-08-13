const FETCH_IMAGE_MESSAGE = "FETCH_IMAGE_AS_BLOB";
const REVOKE_OBJECT_URL_MESSAGE = "REVOKE_OBJECT_URL";
const objectUrls = new Set();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;

  if (message.type === FETCH_IMAGE_MESSAGE) {
    fetchImage(message.url)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === REVOKE_OBJECT_URL_MESSAGE) {
    revokeObjectUrl(message.objectUrl);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function fetchImage(value) {
  const url = new URL(String(value || ""));
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("Hanya URL HTTP/HTTPS yang dapat diambil dengan custom Referer.");
  }

  const response = await fetch(url.href, {
    method: "GET",
    credentials: "include",
    redirect: "follow",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Server gambar merespons HTTP ${response.status}. Periksa nilai Referer dan sesi login.`);
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error("Server mengembalikan file kosong.");

  const objectUrl = URL.createObjectURL(blob);
  objectUrls.add(objectUrl);

  return {
    ok: true,
    objectUrl,
    size: blob.size,
    contentType: blob.type || response.headers.get("content-type") || ""
  };
}

function revokeObjectUrl(value) {
  const objectUrl = String(value || "");
  if (!objectUrls.has(objectUrl)) return;
  URL.revokeObjectURL(objectUrl);
  objectUrls.delete(objectUrl);
}

window.addEventListener("unload", () => {
  objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
  objectUrls.clear();
});

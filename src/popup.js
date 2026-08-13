const state = {
  images: [],
  selected: new Set(),
  query: "",
  minSize: 0,
  pageUrl: "",
  refererInitialized: false,
  applyingReferer: false,
  previewRevision: 0,
  scanning: false,
  downloading: false
};

const elements = {
  pageHost: document.querySelector("#pageHost"),
  refreshButton: document.querySelector("#refreshButton"),
  searchInput: document.querySelector("#searchInput"),
  sizeFilter: document.querySelector("#sizeFilter"),
  refererInput: document.querySelector("#refererInput"),
  pageRefererButton: document.querySelector("#pageRefererButton"),
  applyRefererButton: document.querySelector("#applyRefererButton"),
  resultCount: document.querySelector("#resultCount"),
  selectedCount: document.querySelector("#selectedCount"),
  selectAllButton: document.querySelector("#selectAllButton"),
  clearButton: document.querySelector("#clearButton"),
  notice: document.querySelector("#notice"),
  loadingState: document.querySelector("#loadingState"),
  emptyState: document.querySelector("#emptyState"),
  imageGrid: document.querySelector("#imageGrid"),
  folderInput: document.querySelector("#folderInput"),
  customNameInput: document.querySelector("#customNameInput"),
  downloadButton: document.querySelector("#downloadButton")
};

const popupPort = chrome.runtime.connect({ name: "IMAGE_POCKET_POPUP" });

document.addEventListener("DOMContentLoaded", scanPage);
elements.refreshButton.addEventListener("click", scanPage);
elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim().toLocaleLowerCase("id");
  render();
});
elements.sizeFilter.addEventListener("change", (event) => {
  state.minSize = Number(event.target.value);
  render();
});
elements.refererInput.addEventListener("input", () => {
  elements.refererInput.classList.remove("invalid");
});
elements.refererInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyCustomReferer();
});
elements.pageRefererButton.addEventListener("click", () => {
  elements.refererInput.value = state.pageUrl;
  applyCustomReferer();
});
elements.applyRefererButton.addEventListener("click", applyCustomReferer);
elements.selectAllButton.addEventListener("click", selectAllVisible);
elements.clearButton.addEventListener("click", () => {
  state.selected.clear();
  render();
});
elements.downloadButton.addEventListener("click", downloadSelected);

async function scanPage() {
  if (state.scanning) return;

  state.scanning = true;
  state.images = [];
  state.selected.clear();
  hideNotice();
  render();

  try {
    const [tab] = await queryTabs({ active: true, currentWindow: true });
    if (!tab?.id || !isSupportedPage(tab.url)) {
      throw new Error("Halaman browser ini tidak dapat dipindai. Buka sebuah situs web, lalu coba lagi.");
    }

    elements.pageHost.textContent = getHostname(tab.url);
    state.pageUrl = tab.url;
    if (!state.refererInitialized) {
      elements.refererInput.value = tab.url;
      state.refererInitialized = true;
    }

    const injectionResults = await executeScript({
      target: { tabId: tab.id },
      func: collectPageImages
    });

    const rawImages = injectionResults?.[0]?.result || [];
    state.images = normalizeImages(rawImages);

    try {
      await configureRefererRules(elements.refererInput.value, state.images.map((image) => image.url));
    } catch (error) {
      showNotice(`Gambar tetap ditampilkan tanpa custom Referer: ${readError(error)}`, true);
    }

    if (state.images.length > 0) {
      state.selected = new Set(state.images.map((image) => image.id));
    }
  } catch (error) {
    showNotice(readError(error), true);
  } finally {
    state.scanning = false;
    render();
  }
}

function collectPageImages() {
  const results = new Map();
  const allowedProtocol = /^(https?:|data:|blob:)/i;

  function add(url, width, height, alt, source) {
    if (!url) return;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(url, document.baseURI).href;
    } catch {
      return;
    }

    if (!allowedProtocol.test(absoluteUrl) || results.has(absoluteUrl)) return;

    results.set(absoluteUrl, {
      url: absoluteUrl,
      width: Math.max(0, Number(width) || 0),
      height: Math.max(0, Number(height) || 0),
      alt: String(alt || "").trim(),
      source
    });
  }

  document.querySelectorAll("img").forEach((image) => {
    add(
      image.currentSrc || image.src || image.dataset.src || image.dataset.original,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      image.alt,
      "image"
    );

    [image.dataset.src, image.dataset.original, image.getAttribute("data-lazy-src")]
      .filter(Boolean)
      .forEach((url) => add(url, image.naturalWidth, image.naturalHeight, image.alt, "lazy"));
  });

  const elements = Array.from(document.querySelectorAll("body *")).slice(0, 3500);
  elements.forEach((element) => {
    const background = getComputedStyle(element).backgroundImage;
    if (!background || background === "none") return;

    const matches = background.matchAll(/url\(["']?(.*?)["']?\)/g);
    for (const match of matches) {
      const rect = element.getBoundingClientRect();
      add(match[1], Math.round(rect.width), Math.round(rect.height), element.getAttribute("aria-label"), "background");
    }
  });

  return Array.from(results.values()).slice(0, 500);
}

function normalizeImages(images) {
  return images.map((image, index) => {
    const filename = createFilename(image, index);
    return {
      ...image,
      id: `${index}-${hashString(image.url)}`,
      filename,
      type: getFileType(image.url, filename)
    };
  });
}

function createFilename(image, index) {
  let pathName = "";
  try {
    pathName = decodeURIComponent(new URL(image.url).pathname.split("/").pop() || "");
  } catch {
    pathName = "";
  }

  const cleanPath = sanitizeFilename(pathName);
  if (cleanPath && /\.[a-z0-9]{2,5}$/i.test(cleanPath)) return cleanPath;

  const cleanAlt = sanitizeFilename(image.alt).slice(0, 80);
  const extension = getFileType(image.url, cleanPath).toLowerCase();
  return `${cleanAlt || `gambar-${index + 1}`}.${extension === "unknown" ? "jpg" : extension}`;
}

function sanitizeFilename(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 180);
}

function getFileType(url, filename = "") {
  if (url.startsWith("data:image/")) {
    return (url.match(/^data:image\/([a-z0-9.+-]+)/i)?.[1] || "image").replace("jpeg", "jpg").toUpperCase();
  }

  if (url.startsWith("blob:")) return "BLOB";

  const extension = filename.match(/\.([a-z0-9]{2,5})(?:$|\?)/i)?.[1]
    || url.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i)?.[1];
  return extension ? extension.replace("jpeg", "jpg").toUpperCase() : "UNKNOWN";
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getVisibleImages() {
  return state.images.filter((image) => {
    const largestSide = Math.max(image.width, image.height);
    const matchesSize = largestSide >= state.minSize;
    const haystack = `${image.filename} ${image.type} ${image.alt}`.toLocaleLowerCase("id");
    return matchesSize && (!state.query || haystack.includes(state.query));
  });
}

function render() {
  const visibleImages = getVisibleImages();
  const selectedVisible = visibleImages.filter((image) => state.selected.has(image.id));

  elements.loadingState.classList.toggle("hidden", !state.scanning);
  elements.emptyState.classList.toggle("hidden", state.scanning || visibleImages.length > 0);
  elements.imageGrid.classList.toggle("hidden", state.scanning || visibleImages.length === 0);
  elements.resultCount.textContent = `${visibleImages.length} gambar`;
  elements.selectedCount.textContent = `${state.selected.size} dipilih`;
  elements.selectAllButton.textContent = selectedVisible.length === visibleImages.length && visibleImages.length
    ? "Batalkan semua"
    : "Pilih semua";
  elements.downloadButton.disabled = state.selected.size === 0 || state.downloading;
  elements.applyRefererButton.disabled = state.applyingReferer || state.scanning;
  elements.pageRefererButton.disabled = state.applyingReferer || state.scanning || !state.pageUrl;

  if (state.downloading) {
    elements.downloadButton.querySelector("span").textContent = "Menyiapkan…";
  } else {
    elements.downloadButton.querySelector("span").textContent = state.selected.size
      ? `Unduh ${state.selected.size} gambar`
      : "Unduh pilihan";
  }

  if (state.scanning) return;

  elements.imageGrid.replaceChildren(...visibleImages.map(createImageCard));
}

function createImageCard(image) {
  const card = document.createElement("article");
  card.className = `image-card${state.selected.has(image.id) ? " selected" : ""}`;
  card.title = image.filename;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selected.has(image.id);
  checkbox.setAttribute("aria-label", `Pilih ${image.filename}`);
  checkbox.addEventListener("change", () => toggleImage(image.id, checkbox.checked));

  const thumb = document.createElement("div");
  const hasKnownDimensions = Number.isFinite(image.width)
    && Number.isFinite(image.height)
    && image.width > 0
    && image.height > 0;
  thumb.className = `thumb${hasKnownDimensions ? "" : " ratio-pending"}`;
  const img = document.createElement("img");
  if (hasKnownDimensions) {
    img.width = Math.round(image.width);
    img.height = Math.round(image.height);
  }
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("load", () => {
    thumb.classList.remove("ratio-pending");
  });
  img.addEventListener("error", () => {
    thumb.classList.remove("ratio-pending");
    img.remove();
    thumb.classList.add("preview-error");
    thumb.textContent = image.url.startsWith("blob:")
      ? "Preview blob hanya tersedia di halaman asal"
      : "Preview gagal — coba ubah HTTP Referer";
  });
  img.src = createPreviewUrl(image.url);
  thumb.append(img);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const name = document.createElement("p");
  name.className = "card-name";
  name.textContent = image.filename;
  const detail = document.createElement("div");
  detail.className = "card-detail";
  const dimensions = document.createElement("span");
  dimensions.textContent = image.width && image.height ? `${image.width} × ${image.height}` : "Ukuran tak diketahui";
  const type = document.createElement("span");
  type.className = "file-type";
  type.textContent = image.type;
  detail.append(dimensions, type);
  meta.append(name, detail);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const copyButton = createCardAction(
    "Salin link",
    '<path d="M9 8.5V7A2.5 2.5 0 0 1 11.5 4.5H17A2.5 2.5 0 0 1 19.5 7v5.5A2.5 2.5 0 0 1 17 15h-1.5"/><rect x="4.5" y="9" width="11" height="10.5" rx="2.5"/>'
  );
  copyButton.addEventListener("click", () => copyImageLink(image.url, copyButton));

  const openButton = createCardAction(
    "Buka tab",
    '<path d="M13 5h6v6M19 5l-8 8"/><path d="M17 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4"/>'
  );
  openButton.addEventListener("click", () => openImageInNewTab(image.url));

  actions.append(copyButton, openButton);
  card.append(checkbox, thumb, meta, actions);
  return card;
}

function createCardAction(label, iconMarkup) {
  const button = document.createElement("button");
  button.className = "card-action";
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = iconMarkup;

  const text = document.createElement("span");
  text.textContent = label;
  button.append(icon, text);
  return button;
}

async function copyImageLink(url, button) {
  const label = button.querySelector("span");

  try {
    await writeClipboardText(url);
    label.textContent = "Tersalin";
    button.classList.add("success");
    setTimeout(() => {
      label.textContent = "Salin link";
      button.classList.remove("success");
    }, 1400);
  } catch (error) {
    showNotice(`Link tidak dapat disalin: ${readError(error)}`, true);
  }
}

async function writeClipboardText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Browser menolak akses clipboard.");
}

async function openImageInNewTab(url) {
  if (url.startsWith("blob:")) {
    showNotice("Link blob hanya berlaku di halaman asal dan tidak dapat dibuka dari popup ekstensi.", true);
    return;
  }

  try {
    await createTab({ url, active: true });
  } catch (error) {
    showNotice(`Gambar tidak dapat dibuka: ${readError(error)}`, true);
  }
}

async function applyCustomReferer() {
  if (state.applyingReferer || state.scanning) return;

  state.applyingReferer = true;
  elements.refererInput.classList.remove("invalid");
  elements.applyRefererButton.textContent = "Menerapkan…";
  hideNotice();
  render();

  try {
    const referer = await configureRefererRules(
      elements.refererInput.value,
      state.images.map((image) => image.url)
    );
    elements.refererInput.value = referer;
    state.previewRevision += 1;
    elements.applyRefererButton.textContent = "Diterapkan";
  } catch (error) {
    elements.refererInput.classList.add("invalid");
    elements.applyRefererButton.textContent = "Terapkan";
    showNotice(readError(error), true);
  } finally {
    state.applyingReferer = false;
    render();
    setTimeout(() => {
      if (!state.applyingReferer) elements.applyRefererButton.textContent = "Terapkan";
    }, 1200);
  }
}

async function configureRefererRules(value, urls) {
  const referer = normalizeReferer(value);
  const response = await sendMessage({
    type: "SET_REFERER_RULES",
    referer,
    urls
  });

  if (response?.error) throw new Error(response.error);
  return referer;
}

function normalizeReferer(value) {
  const input = String(value || "").trim();
  if (!input) return "";

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("HTTP Referer tidak valid. Gunakan URL lengkap, misalnya https://example.com/.");
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("HTTP Referer harus memakai protokol http:// atau https://.");
  }

  if (url.username || url.password) {
    throw new Error("HTTP Referer tidak boleh berisi username atau password.");
  }

  url.hash = "";
  return url.href;
}

function createPreviewUrl(url) {
  if (!/^https?:/i.test(url)) return url;

  try {
    const previewUrl = new URL(url);
    previewUrl.hash = `image-pocket-${state.previewRevision}`;
    return previewUrl.href;
  } catch {
    return url;
  }
}

function toggleImage(id, checked) {
  if (checked) state.selected.add(id);
  else state.selected.delete(id);
  render();
}

function selectAllVisible() {
  const visibleImages = getVisibleImages();
  const allSelected = visibleImages.length > 0 && visibleImages.every((image) => state.selected.has(image.id));

  visibleImages.forEach((image) => {
    if (allSelected) state.selected.delete(image.id);
    else state.selected.add(image.id);
  });
  render();
}

async function downloadSelected() {
  if (state.downloading || state.selected.size === 0) return;

  state.downloading = true;
  hideNotice();
  render();

  const selectedImages = state.images.filter((image) => state.selected.has(image.id));
  const customName = elements.customNameInput.value.trim();
  const requestedFolder = normalizeFolder(elements.folderInput.value) || "Image Pocket";
  let downloadReferer;

  try {
    downloadReferer = normalizeReferer(elements.refererInput.value);
  } catch (error) {
    elements.refererInput.classList.add("invalid");
    showNotice(readError(error), true);
    state.downloading = false;
    render();
    return;
  }

  elements.folderInput.value = requestedFolder;
  const items = selectedImages.map((image, index) => ({
    url: image.url,
    filename: createDownloadFilename(image, customName, index, selectedImages.length)
  }));

  try {
    const response = await sendMessage({
      type: "DOWNLOAD_IMAGES",
      items,
      folder: requestedFolder,
      referer: downloadReferer,
      saveAs: false
    });

    if (response?.error) throw new Error(response.error);

    const results = response?.results || [];
    const failed = results.filter((result) => !result.ok);
    const successful = results.length - failed.length;

    if (failed.length) {
      showNotice(`${successful} berhasil dimulai, ${failed.length} gagal. ${failed[0].error}`, true);
    } else {
      const savedFolder = response.folder || requestedFolder;
      const refererStatus = response.downloadMethod === "verified-fetch"
        ? " Custom Referer diverifikasi ketika file diambil, lalu hasilnya disimpan sebagai Blob lokal."
        : response.refererApplied
          ? " Custom Referer diterapkan langsung pada request download."
          : "";
      showNotice(`${successful} gambar mulai diunduh ke “Downloads/${savedFolder}”. Folder dibuat otomatis jika belum ada.${refererStatus}`);
    }
  } catch (error) {
    showNotice(`Gagal mengunduh: ${readError(error)}`, true);
  } finally {
    state.downloading = false;
    render();
  }
}

function normalizeFolder(value) {
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

function createDownloadFilename(image, customName, index, total) {
  const cleanCustomName = sanitizeFilename(customName);
  if (!cleanCustomName) return image.filename;

  const customBase = cleanCustomName.replace(/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i, "");
  const imageParts = splitFilename(image.filename);
  const fallbackExtension = normalizeDownloadExtension(image.type);
  const extension = imageParts.extension || fallbackExtension;
  const sequence = total > 1 ? `-${String(index + 1).padStart(3, "0")}` : "";

  return `${customBase || "gambar"}${sequence}${extension ? `.${extension}` : ""}`;
}

function splitFilename(value) {
  const filename = String(value || "").trim();
  const match = filename.match(/^(.*)\.([a-z0-9]{2,5})$/i);
  if (!match || !match[1]) return { base: filename, extension: "" };
  return { base: match[1], extension: match[2].toLowerCase() };
}

function normalizeDownloadExtension(value) {
  const extension = String(value || "").toLowerCase();
  if (!extension || extension === "unknown" || extension === "blob" || extension === "image") return "jpg";
  return extension.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs);
    });
  });
}

function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function executeScript(injection) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(injection, (results) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(results);
    });
  });
}

function isSupportedPage(url) {
  return /^https?:/i.test(url || "");
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Halaman aktif";
  }
}

function readError(error) {
  const message = error?.message || String(error);
  if (/cannot access|missing host permission|restricted|extensions gallery/i.test(message)) {
    return "Browser melindungi halaman ini. Coba buka situs web biasa, lalu pindai ulang.";
  }
  return message;
}

function showNotice(message, isError = false) {
  elements.notice.textContent = message;
  elements.notice.classList.remove("hidden");
  elements.notice.classList.toggle("error", isError);
}

function hideNotice() {
  elements.notice.classList.add("hidden");
  elements.notice.classList.remove("error");
  elements.notice.textContent = "";
}

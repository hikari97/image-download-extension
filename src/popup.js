const state = {
  images: [],
  selected: new Set(),
  query: "",
  minSize: 0,
  scanning: false,
  downloading: false
};

const elements = {
  pageHost: document.querySelector("#pageHost"),
  refreshButton: document.querySelector("#refreshButton"),
  searchInput: document.querySelector("#searchInput"),
  sizeFilter: document.querySelector("#sizeFilter"),
  resultCount: document.querySelector("#resultCount"),
  selectedCount: document.querySelector("#selectedCount"),
  selectAllButton: document.querySelector("#selectAllButton"),
  clearButton: document.querySelector("#clearButton"),
  notice: document.querySelector("#notice"),
  loadingState: document.querySelector("#loadingState"),
  emptyState: document.querySelector("#emptyState"),
  imageGrid: document.querySelector("#imageGrid"),
  folderInput: document.querySelector("#folderInput"),
  downloadButton: document.querySelector("#downloadButton")
};

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
    const injectionResults = await executeScript({
      target: { tabId: tab.id },
      func: collectPageImages
    });

    const rawImages = injectionResults?.[0]?.result || [];
    state.images = normalizeImages(rawImages);

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
  const card = document.createElement("label");
  card.className = `image-card${state.selected.has(image.id) ? " selected" : ""}`;
  card.title = image.filename;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selected.has(image.id);
  checkbox.setAttribute("aria-label", `Pilih ${image.filename}`);
  checkbox.addEventListener("change", () => toggleImage(image.id, checkbox.checked));

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const img = document.createElement("img");
  img.src = image.url;
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => {
    img.remove();
    thumb.textContent = "Pratinjau gagal";
  });
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
  card.append(checkbox, thumb, meta);
  return card;
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

  const items = state.images
    .filter((image) => state.selected.has(image.id))
    .map((image) => ({ url: image.url, filename: image.filename }));

  try {
    const response = await sendMessage({
      type: "DOWNLOAD_IMAGES",
      items,
      folder: elements.folderInput.value.trim() || "Image Pocket",
      saveAs: false
    });

    if (response?.error) throw new Error(response.error);

    const results = response?.results || [];
    const failed = results.filter((result) => !result.ok);
    const successful = results.length - failed.length;

    if (failed.length) {
      showNotice(`${successful} berhasil dimulai, ${failed.length} gagal. ${failed[0].error}`, true);
    } else {
      showNotice(`${successful} gambar mulai diunduh ke folder “${elements.folderInput.value.trim() || "Image Pocket"}”.`);
    }
  } catch (error) {
    showNotice(`Gagal mengunduh: ${readError(error)}`, true);
  } finally {
    state.downloading = false;
    render();
  }
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

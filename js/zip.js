import { state } from "./state.js";
import { formatBytes, showMediaUnavailableWarning, renderArchiveProgress, renderMediaProgress } from "./utils.js";
import { showView, welcomeScreen, navBack, updateNavTabs, wrapCarousel, settingsMenu } from "./nav.js";
import { handleCarouselScrollSettled, smoothScroll } from "./feed.js";
import { abortExternalGallery } from "./externalGalleries.js";

export const zipViewer = document.getElementById("zip-viewer");
export const zipTitle = document.getElementById("zip-title");
export const zipContent = document.getElementById("zip-content");
export const zipIndicator = document.getElementById("zip-indicator");
export const closeZipViewer = document.getElementById("close-zip-viewer");
export const zipNav = document.getElementById("zip-nav");
export const zipHomeViewer = document.getElementById("zip-home-viewer");
export const zipSettingsViewer = document.getElementById("zip-settings-viewer");
export const zipInfoViewer = document.getElementById("zip-info-viewer");
export const zipFileInfoModal = document.getElementById("zip-file-info-modal");
export const closeZipFileInfo = document.getElementById("close-zip-file-info");

let activeZipAbortController = null;

export function closeZipGallery() {
  if (activeZipAbortController) {
    try { activeZipAbortController.abort(); } catch (_) {}
    activeZipAbortController = null;
  }
  abortExternalGallery();
  setZipNavVisible(false, true);

  const modal = document.getElementById("zip-file-info-modal");
  if (modal) modal.classList.remove("expanded");

  if (zipViewer) zipViewer.classList.add("hidden");
  if (zipContent) {
    zipContent.innerHTML = "";
    delete zipContent.dataset.mediaCount;
    zipContent.classList.remove("folder-browser-mode");
    zipContent.classList.remove("gallery-2d-mode");
    zipContent.scrollTop = 0;
    zipContent.scrollLeft = 0;
  }
  if (zipIndicator) {
    zipIndicator.textContent = "";
    zipIndicator.style.display = "";
  }
  const floatingBack = document.getElementById("dropbox-carousel-back-btn");
  if (floatingBack) floatingBack.remove();
  if (window.zipMediaObserver) {
    window.zipMediaObserver.disconnect();
  }
  state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.currentZipObjectUrls = [];
}

export function isZipNavInteractive() {
  if (!zipNav || !zipNav.classList.contains("visible")) return false;
  return true;
}

export function setZipNavVisible(visible, manual = false) {
  if (manual) {
    state.zipNavManualVisible = visible;
  }

  if (visible) {
    if (zipNav && !zipNav.classList.contains("visible")) {
      zipNav.classList.add("visible");
    }
  } else {
    if (zipNav) {
      zipNav.classList.remove("visible");
    }
  }
}

export function updateZipNavVisibility(e) {
  const isTop = e.clientY < 100;
  if (isTop || state.zipNavManualVisible) {
    setZipNavVisible(true);
  } else {
    setZipNavVisible(false);
  }
}

/**
 * Returns metadata about the currently visible active media item in either 1D or 2D mode.
 */
export function getActiveMediaItem() {
  if (!zipContent) return null;

  if (zipContent.classList.contains("gallery-2d-mode")) {
    const rows = Array.from(zipContent.querySelectorAll(".zip-folder-row"));
    if (rows.length === 0) return null;

    const rowHeight = zipContent.clientHeight || window.innerHeight;
    const folderIdx = Math.max(0, Math.min(rows.length - 1, Math.round(zipContent.scrollTop / rowHeight)));
    const activeRow = rows[folderIdx];
    if (!activeRow) return null;

    const items = Array.from(activeRow.querySelectorAll(".media-item"));
    if (items.length === 0) return null;

    const itemWidth = activeRow.clientWidth || window.innerWidth;
    const fileIdx = Math.max(0, Math.min(items.length - 1, Math.round(activeRow.scrollLeft / itemWidth)));
    return {
      item: items[fileIdx] || items[0],
      folderRow: activeRow,
      folderIdx,
      totalFolders: rows.length,
      fileIdx,
      totalFiles: items.length,
      folderName: activeRow.dataset.folderName || ""
    };
  }

  // 1D Carousel
  const items = Array.from(zipContent.querySelectorAll(".media-item"));
  if (items.length === 0) return null;
  const itemWidth = zipContent.clientWidth || window.innerWidth;
  const rawIdx = Math.round(zipContent.scrollLeft / itemWidth);
  const count = parseInt(zipContent.dataset.mediaCount || "0", 10) || items.length;
  const realIdx = count > 1 ? ((rawIdx - 1 + count) % count) : 0;
  const nonClones = items.filter((i) => i.dataset.isClone !== "true");
  const pool = nonClones.length > 0 ? nonClones : items;
  const activeItem = pool[realIdx] || pool[0];
  return {
    item: activeItem,
    folderRow: null,
    folderIdx: 0,
    totalFolders: 1,
    fileIdx: realIdx,
    totalFiles: count,
    folderName: zipTitle?.textContent || ""
  };
}

/**
 * Updates the File Details Modal with information from the specified slide element.
 */
export function updateActiveSlideInfo(mediaItem) {
  if (!mediaItem) return;
  const filename = mediaItem.dataset.filename || "";
  const folder = mediaItem.dataset.folder || "";
  const sizeNum = parseInt(mediaItem.dataset.size, 10);
  const size = !isNaN(sizeNum) && sizeNum > 0 ? formatBytes(sizeNum) : "Unknown";
  const link = mediaItem.dataset.link || "";

  const fNameEl = document.getElementById("zip-info-filename");
  const fFolderEl = document.getElementById("zip-info-folder");
  const fSizeEl = document.getElementById("zip-info-size");
  const fLinkRow = document.getElementById("zip-info-link-row");
  const fLink = document.getElementById("zip-info-link");

  if (fNameEl) fNameEl.textContent = filename || "Unknown";
  if (fFolderEl) fFolderEl.textContent = folder || "/";
  if (fSizeEl) fSizeEl.textContent = size;

  if (fLinkRow && fLink) {
    if (link) {
      fLinkRow.classList.remove("hidden");
      fLink.href = link;
    } else {
      fLinkRow.classList.add("hidden");
    }
  }
}

/**
 * Updates top indicator text, title, folder prev/next buttons, and live info modal.
 */
export function updateZipIndicatorsAndHUD() {
  const active = getActiveMediaItem();
  if (!active) return;

  // Update Indicator
  if (zipIndicator) {
    zipIndicator.style.display = "";
    if (active.totalFolders > 1) {
      zipIndicator.textContent = `${active.folderName} • ${active.fileIdx + 1} / ${active.totalFiles}`;
    } else {
      zipIndicator.textContent = `${active.fileIdx + 1} / ${active.totalFiles}`;
    }
  }

  // Update Title
  if (zipTitle && active.folderName) {
    zipTitle.textContent = active.folderName;
  }

  // If Info Modal is currently open, keep it updated in real-time
  const modal = document.getElementById("zip-file-info-modal");
  if (modal && modal.classList.contains("expanded")) {
    updateActiveSlideInfo(active.item);
  }
}

/**
 * Toggles the File Details Modal.
 */
export function toggleZipFileInfoModal(force) {
  const modal = document.getElementById("zip-file-info-modal");
  if (!modal) return;
  const shouldOpen = force !== undefined ? force : !modal.classList.contains("expanded");
  if (shouldOpen) {
    const active = getActiveMediaItem();
    if (active && active.item) {
      updateActiveSlideInfo(active.item);
    }
    modal.classList.add("expanded");
  } else {
    modal.classList.remove("expanded");
  }
}

/**
 * Vertically scrolls the gallery container to the previous or next folder row.
 */
export function navigateFolder(direction) {
  if (!zipContent || !zipContent.classList.contains("gallery-2d-mode")) return;
  const rows = Array.from(zipContent.querySelectorAll(".zip-folder-row"));
  if (rows.length <= 1) return;

  const rowHeight = zipContent.clientHeight || window.innerHeight;
  const currentIdx = Math.max(0, Math.min(rows.length - 1, Math.round(zipContent.scrollTop / rowHeight)));
  const targetIdx = direction === "down" ? currentIdx + 1 : currentIdx - 1;

  if (targetIdx >= 0 && targetIdx < rows.length) {
    zipContent.scrollTo({
      top: targetIdx * rowHeight,
      behavior: window.pawAnimationsDisabled ? "auto" : "smooth"
    });
  }
}

/**
 * Universal 2D Matrix Gallery Renderer:
 * - Vertical scrolling (Up/Down) switches between folder rows.
 * - Horizontal scrolling (Left/Right) switches between files in the current folder.
 *
 * folderGroups: Array of {
 *   folderName: string,
 *   folderPath?: string,
 *   files: Array<{ filename: string, folder?: string, size?: number, link?: string, loadMedia: Function }>
 * }
 */
export function render2DMatrixGallery(folderGroups, options = {}) {
  if (!zipContent) return;

  if (window.zipMediaObserver) {
    window.zipMediaObserver.disconnect();
  }

  zipContent.classList.remove("folder-browser-mode");
  zipContent.classList.add("gallery-2d-mode");
  zipContent.innerHTML = "";
  zipContent.scrollTop = 0;
  zipContent.scrollLeft = 0;

  const validGroups = (folderGroups || []).filter((g) => g.files && g.files.length > 0);
  if (validGroups.length === 0) {
    if (zipTitle) zipTitle.textContent = options.galleryTitle || "Gallery";
    if (zipIndicator) {
      zipIndicator.textContent = "";
      zipIndicator.style.display = "none";
    }
    zipContent.innerHTML = '<div style="color:white; margin: auto; text-align: center; padding: 2rem;">No media files found in this archive.</div>';
    return;
  }

  const pCount = Math.max(1, window.pawPreloadCount || 1);
  window.zipMediaObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const target = entry.target;
        if (target.dataset.loaded === "true" || target.dataset.loading === "true") return;
        const loader = target._loadMedia;
        if (typeof loader === "function") {
          loader(target, options.signal);
        }
      }
    });
  }, {
    root: null,
    rootMargin: `${pCount * 100}%`
  });

  validGroups.forEach((group, folderIdx) => {
    const folderRow = document.createElement("div");
    folderRow.className = "zip-folder-row";
    folderRow.dataset.folderName = group.folderName;
    folderRow.dataset.folderPath = group.folderPath || group.folderName;
    folderRow.dataset.folderIdx = String(folderIdx);

    group.files.forEach((file, fileIdx) => {
      const slide = document.createElement("div");
      slide.className = "media-item";
      slide.dataset.filename = file.filename;
      slide.dataset.folder = group.folderPath || group.folderName;
      slide.dataset.size = String(file.size || 0);
      slide.dataset.link = file.link || "";
      slide.dataset.fileIdx = String(fileIdx);
      slide._loadMedia = file.loadMedia;

      const progress = document.createElement("div");
      progress.className = "media-progress";
      progress.style.display = "flex";
      renderMediaProgress(progress, "Loading...", null, file.filename, file.size ? formatBytes(file.size) : "", "");
      slide.appendChild(progress);

      folderRow.appendChild(slide);
      window.zipMediaObserver.observe(slide);
    });

    folderRow.addEventListener("scroll", () => {
      updateZipIndicatorsAndHUD();
    }, { passive: true });

    zipContent.appendChild(folderRow);
    folderRow.scrollLeft = 0;
  });

  zipContent.addEventListener("scroll", () => {
    updateZipIndicatorsAndHUD();
  }, { passive: true });

  zipContent.scrollTop = 0;
  zipContent.scrollLeft = 0;
  updateZipIndicatorsAndHUD();
}

export async function openZipGallery(zipUrl, filename, cachedBlob = null) {
  closeZipGallery();
  activeZipAbortController = new AbortController();
  const signal = activeZipAbortController.signal;

  setZipNavVisible(false, true);
  if (zipViewer) zipViewer.classList.remove("hidden");
  if (zipTitle) zipTitle.textContent = filename;
  if (zipIndicator) zipIndicator.textContent = "";
  if (zipContent) {
    zipContent.innerHTML = '<div id="zip-progress-text"></div>';
    const pt = document.getElementById("zip-progress-text");
    renderArchiveProgress(pt, "Connecting...", null, filename);
  }

  try {
    let blob = cachedBlob;

    if (!blob) {
      const response = await fetch(zipUrl, { signal });
      if (!response.ok) throw new Error("Network response was not ok");

      const contentLength = response.headers.get("content-length");
      const total = parseInt(contentLength, 10);
      let loaded = 0;
      const startTime = Date.now();
      const reader = response.body.getReader();
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;

        const progressText = document.getElementById("zip-progress-text");
        if (progressText && total) {
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? formatBytes(loaded / elapsed) + "/s" : "...";
          const percent = Math.round((loaded / total) * 100);
          renderArchiveProgress(progressText, "Downloading Archive...", percent, filename, formatBytes(loaded), formatBytes(total), speed);
        } else if (progressText) {
          renderArchiveProgress(progressText, "Downloading Archive...", null, filename, formatBytes(loaded));
        }
      }
      blob = new Blob(chunks);
    }

    const progressText = document.getElementById("zip-progress-text");
    if (progressText) renderArchiveProgress(progressText, "Extracting files...", null, filename);

    if (!window.JSZip) throw new Error("JSZip not loaded");
    const zip = await window.JSZip.loadAsync(blob);

    if (zipContent) zipContent.innerHTML = "";
    state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.currentZipObjectUrls = [];

    // Group image files by directory/folder path
    const folderMap = new Map();

    zip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir) return;
      const ext = relativePath.split(".").pop().toLowerCase();
      if (!["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(ext)) return;

      const parts = relativePath.split("/").filter(Boolean);
      let folderName = "";
      if (parts.length > 1) {
        folderName = parts.slice(0, -1).join("/");
      } else {
        folderName = filename.replace(/\.zip$/i, "") || "Root";
      }

      if (!folderMap.has(folderName)) {
        folderMap.set(folderName, []);
      }
      folderMap.get(folderName).push({
        entry: zipEntry,
        name: parts[parts.length - 1],
        relativePath,
        size: zipEntry._data?.uncompressedSize || 0
      });
    });

    const folderNames = Array.from(folderMap.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );

    const folderGroups = folderNames.map((folderName) => {
      const files = folderMap.get(folderName);
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

      return {
        folderName,
        folderPath: folderName,
        files: files.map((f) => ({
          filename: f.name,
          folder: folderName,
          size: f.size,
          link: "", // Local zip entries have no external cloud link
          loadMedia: async (container, sig) => {
            if (container.dataset.loaded === "true" || container.dataset.loading === "true") return;
            container.dataset.loading = "true";
            try {
              const fileBlob = await f.entry.async("blob");
              if (sig && sig.aborted) return;
              const objUrl = URL.createObjectURL(fileBlob);
              state.currentZipObjectUrls.push(objUrl);

              const img = document.createElement("img");
              img.style.maxWidth = "100%";
              img.style.maxHeight = "100%";
              img.style.objectFit = "contain";
              img.decoding = "async";
              img.src = objUrl;

              img.onload = () => {
                container.dataset.loaded = "true";
                container.dataset.loading = "false";
                const p = container.querySelector(".media-progress");
                if (p) p.style.display = "none";
              };
              img.onerror = () => {
                container.dataset.loading = "false";
              };
              container.appendChild(img);
            } catch (_) {
              container.dataset.loading = "false";
            }
          }
        }))
      };
    });

    render2DMatrixGallery(folderGroups, { galleryTitle: filename, signal });

  } catch (err) {
    if (signal && signal.aborted) return;
    console.error(err);
    if (zipTitle) zipTitle.textContent = "Error";
    if (zipIndicator) zipIndicator.textContent = "";
    if (zipContent) {
      zipContent.innerHTML = "";
      showMediaUnavailableWarning(zipContent, "zip");
    }
  }
}
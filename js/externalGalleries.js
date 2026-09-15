import {
  isMegaUrl,
  parseMegaUrl,
  openMegaGallery,
  handleMegaFileCard,
  megaFolderCache,
  megaBlobCache,
  cacheMegaBlob,
  base64urlToBytes,
  unmergeKeyMac,
  decryptAttributes,
  decryptNodeKey,
  decryptAllMegaNodes,
  formatMegaFileTree,
  megaApiRequest,
  fetchMegaStorageStream,
  downloadAndDecryptMegaPayload
} from "./mega.js";
import {
  isDropboxUrl,
  isDropboxFolderUrl,
  openDropboxGallery,
  handleDropboxFileCard
} from "./dropbox.js";
import { formatBytes, escapeHtml } from "./utils.js";
import { syncCarouselClones } from "./feed.js";
import { closeZipGallery } from "./zip.js";

// Re-export service-specific APIs for backwards compatibility
export {
  isMegaUrl,
  parseMegaUrl,
  openMegaGallery,
  handleMegaFileCard,
  megaFolderCache,
  megaBlobCache,
  cacheMegaBlob,
  base64urlToBytes,
  unmergeKeyMac,
  decryptAttributes,
  decryptNodeKey,
  decryptAllMegaNodes,
  formatMegaFileTree,
  megaApiRequest,
  fetchMegaStorageStream,
  downloadAndDecryptMegaPayload,
  isDropboxUrl,
  isDropboxFolderUrl,
  openDropboxGallery,
  handleDropboxFileCard
};

let activeAbortController = null;

/**
 * Creates and tracks a new AbortSignal for external gallery operations,
 * aborting any previous active controller first.
 */
export function createExternalAbortSignal() {
  abortExternalGallery();
  activeAbortController = new AbortController();
  return activeAbortController.signal;
}

/**
 * Aborts any active fullscreen external gallery operation (Mega or Dropbox).
 */
export function abortExternalGallery() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
}

export { escapeHtml };

/**
 * Returns standard MIME type string based on file extension.
 */
export function getMimeType(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "ogv":
      return "video/ogg";
    case "mkv":
      return "video/x-matroska";
    case "mp3":
      return "audio/mpeg";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}

/**
 * Checks whether a filename represents an image or video format.
 */
export function isImageOrVideo(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  return [
    "jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg",
    "mp4", "webm", "mov", "m4v", "ogv", "mkv",
    "mp3", "ogg", "wav", "m4a", "flac"
  ].includes(ext);
}

function cleanUrl(url) {
  let cleaned = url.replace(/&amp;/g, "&").replace(/[\.,;>]+$/, "").trim();
  while (cleaned.endsWith(")")) {
    const openCount = (cleaned.match(/\(/g) || []).length;
    const closeCount = (cleaned.match(/\)/g) || []).length;
    if (closeCount > openCount) {
      cleaned = cleaned.slice(0, -1);
      cleaned = cleaned.replace(/[\.,;>]+$/, "").trim();
    } else {
      break;
    }
  }
  return cleaned;
}

/**
 * Scans post HTML content and extracts all valid external gallery links.
 * Returns arrays of unique URLs for Mega and Dropbox.
 */
export function detectExternalGalleries(contentHtml) {
  if (!contentHtml) return { mega: [], dropbox: [] };

  const megaUrls = new Set();
  const dropboxUrls = new Set();

  const hrefRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(contentHtml)) !== null) {
    const raw = cleanUrl(match[1]);
    if (isMegaUrl(raw)) megaUrls.add(raw);
    else if (isDropboxUrl(raw)) dropboxUrls.add(raw);
  }

  const text = contentHtml.replace(/<a\b[^>]*>.*?<\/a>/gi, " ").replace(/<[^>]+>/g, " ");
  const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
  while ((match = urlRegex.exec(text)) !== null) {
    const raw = cleanUrl(match[1]);
    if (isMegaUrl(raw)) megaUrls.add(raw);
    else if (isDropboxUrl(raw)) dropboxUrls.add(raw);
  }

  return {
    mega: Array.from(megaUrls),
    dropbox: Array.from(dropboxUrls)
  };
}

/**
 * Main dispatcher for rendering external file cards within the feed carousel.
 * Delegates to either Mega or Dropbox module.
 */
export function renderExternalFileCard(item, type) {
  const url = item.dataset.url;
  const postTitle = item.dataset.postTitle || (type === "mega" ? "Mega Gallery" : "Dropbox Gallery");
  const filename = item.dataset.originalName || (type === "mega" ? "Mega Archive" : "Dropbox Archive");

  const progressOverlay = item.querySelector(".media-progress");
  if (item._abortController) {
    try { item._abortController.abort(); } catch (_) {}
  }
  const scanController = new AbortController();
  item._abortController = scanController;
  const signal = scanController.signal;

  if (type === "dropbox") {
    handleDropboxFileCard(item, url, postTitle, filename, progressOverlay, signal);
    return;
  }

  handleMegaFileCard(item, url, postTitle, filename, progressOverlay, signal);
}

/**
 * Renders the shared dark-theme archive card UI inside a carousel slide.
 * Used for multi-file folders or non-media archives from Mega or Dropbox.
 */
export function renderArchiveCardUI(item, url, type, postTitle, archiveName, signal, details) {
  const existingCards = item.querySelectorAll(".ext-archive-card");
  existingCards.forEach((c) => c.remove());

  const container = document.createElement("div");
  container.className = "ext-archive-card";
  container.style.width = "100%";
  container.style.height = "100%";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.justifyContent = "center";
  container.style.background = "#000";
  container.style.padding = "20px";
  container.style.boxSizing = "border-box";

  const isMega = type === "mega";
  const iconColor = isMega ? "#d9272e" : "#0061fe";
  const iconSvg = isMega
    ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="color: ${iconColor}; vertical-align: middle;"><circle cx="12" cy="12" r="11" fill="${iconColor}"/><path d="M7 16V8l5 5 5-5v8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="color: ${iconColor}; vertical-align: middle;"><path d="M6 2l6 4-6 4-6-4 6-4zm12 0l6 4-6 4-6-4 6-4zm-12 9l6 4-6 4-6-4 6-4zm12 0l6 4-6 4-6-4 6-4zM6 19.5l6-4 6 4-6 4.5-6-4.5z"/></svg>`;

  const infoText = document.createElement("div");
  infoText.className = "zip-info-text";
  infoText.style.color = "#fff";
  infoText.style.fontFamily = "monospace";
  infoText.style.background = "rgba(0,0,0,0.5)";
  infoText.style.padding = "15px";
  infoText.style.borderRadius = "10px";
  infoText.style.marginBottom = "20px";
  infoText.style.width = "fit-content";
  infoText.style.maxWidth = "100%";
  infoText.style.overflowX = "auto";
  infoText.style.overflowY = "auto";
  infoText.style.maxHeight = "40%";
  infoText.style.fontSize = "0.9rem";
  infoText.style.textAlign = "left";
  infoText.style.boxSizing = "border-box";

  infoText.addEventListener("click", (e) => e.stopPropagation());
  infoText.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

  if (details) {
    const sizeStr = details.totalSize > 0 ? `${formatBytes(details.totalSize)}, ` : "";
    const countText = details.countLabel || `${details.fileCount} files`;
    const headerInfo = `${sizeStr}${countText}`;
    let rawTree = (details.tree || details.treeHtml || "").trim();
    rawTree = rawTree.replace(/\n?\s*\.\.\.\s*and\s+\d+\s+more\s+files/gi, "");
    rawTree = rawTree.replace(/\n?\s*\.\.\.\s*and\s+more\s+files/gi, "");

    let fullTree = "";
    if (archiveName && !rawTree.startsWith("└── " + archiveName)) {
      fullTree = `${archiveName}\n${rawTree}`;
    } else {
      fullTree = rawTree;
    }

    infoText.innerHTML = `<div class="zip-info-header" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:8px;position:sticky;left:0;width:100%;">${iconSvg} <span>${headerInfo}</span></div><div class="zip-info-tree" style="white-space:pre;font-family:monospace;margin:0;padding:0;line-height:1.35;">${escapeHtml(fullTree)}</div>`;
  } else {
    infoText.innerHTML = `<div class="zip-info-header" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:8px;position:sticky;left:0;width:100%;">${iconSvg} <span>${escapeHtml(archiveName)}</span></div><div style="text-align:center;color:#aaa;margin-top:6px;">(Click View Gallery to open archive)</div>`;
  }
  container.appendChild(infoText);

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "10px";
  btnRow.style.flexWrap = "wrap";
  btnRow.style.justifyContent = "center";

  const btnView = document.createElement("button");
  btnView.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> View Gallery`;
  btnView.className = "zip-action-btn";
  const onGalleryClick = (e) => {
    e.stopPropagation();
    closeZipGallery();
    const post = item._post || (item.closest('.post-card') && item.closest('.post-card')._post) || null;
    if (isMega) {
      openMegaGallery(url, archiveName || postTitle, post);
    } else {
      openDropboxGallery(url, archiveName || postTitle, [], post);
    }
  };
  btnView.addEventListener("click", onGalleryClick);
  btnView._onGalleryClick = onGalleryClick;

  const btnOpenExt = document.createElement("a");
  btnOpenExt.href = url;
  btnOpenExt.target = "_blank";
  btnOpenExt.rel = "noopener noreferrer";
  btnOpenExt.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg> Open Link`;
  btnOpenExt.className = "zip-action-btn";
  btnOpenExt.style.textDecoration = "none";
  btnOpenExt.style.display = "inline-flex";
  btnOpenExt.style.alignItems = "center";
  btnOpenExt.addEventListener("click", (e) => e.stopPropagation());

  btnRow.appendChild(btnView);
  btnRow.appendChild(btnOpenExt);
  container.appendChild(btnRow);
  item.appendChild(container);

  syncCarouselClones(item);
}
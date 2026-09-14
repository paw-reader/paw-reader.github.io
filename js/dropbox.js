import { PROXY_URL, state } from "./state.js";
import { zipViewer, zipTitle, zipContent, zipIndicator, setZipNavVisible, closeZipGallery, render2DMatrixGallery, updateZipIndicatorsAndHUD } from "./zip.js";
import { formatBytes, showMediaUnavailableWarning, renderMediaProgress, renderArchiveProgress } from "./utils.js";
import { syncCarouselClones, playbackObserver, getCurrentGalleryPost } from "./feed.js";
import { createExternalAbortSignal, renderArchiveCardUI, escapeHtml, isImageOrVideo } from "./externalGalleries.js";
import { attachCustomVideoPlayer } from "./player.js";
import { loadGifPlayer } from "./gifPlayer.js";

export const dropboxFolderCache = new Map();
const dropboxInFlight = new Map();

/**
 * Checks if a URL points to a Dropbox file or folder share link.
 */
export function isDropboxUrl(url) {
  return /https?:\/\/(?:www\.)?dropbox\.com\/(?:s|scl|sh)\/[^\s<>"']+/i.test(url);
}

/**
 * Accurately determines if a Dropbox URL is a folder link vs a direct file link.
 * Handles /scl/fo/ links that point to files inside folders (e.g. .../photo.png).
 */
export function isDropboxFolderUrl(url) {
  if (!url) return false;
  const pathOnly = url.split("?")[0].split("#")[0];
  if (pathOnly.includes("/scl/fi/")) return false;
  const lastSegment = pathOnly.split("/").filter(Boolean).pop() || "";
  if (isImageOrVideo(lastSegment)) return false;
  const ext = lastSegment.includes(".") ? lastSegment.split(".").pop().toLowerCase() : "";
  if (["zip", "rar", "7z", "tar", "gz", "pdf", "txt", "cbz", "cbr"].includes(ext)) return false;
  return pathOnly.includes("/sh/") || pathOnly.includes("/scl/fo/");
}

/**
 * Formats Dropbox entries into a standard hierarchical file tree string with file sizes.
 * Supports arbitrary folder-inside-folder depth.
 */
export function formatDropboxFileTree(entries, folderName) {
  const root = { name: folderName, isFolder: true, children: new Map(), size: 0 };

  for (const item of entries) {
    const rawPath = item.path || item.filename;
    const parts = rawPath.split("/").filter(Boolean);
    let curr = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const isDir = isLast ? item.is_dir : true;

      if (!curr.children.has(part)) {
        curr.children.set(part, {
          name: part,
          isFolder: isDir,
          size: isLast ? (item.bytes || 0) : 0,
          children: new Map()
        });
      }
      curr = curr.children.get(part);
      if (isLast) {
        curr.size = item.bytes || 0;
        curr.isFolder = item.is_dir;
      }
    }
  }

  let output = "";
  function printNode(node, prefix, isLast) {
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    if (node.isFolder) {
      output += prefix + connector + node.name + "/\n";
      const children = Array.from(node.children.values());
      children.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
      for (let i = 0; i < children.length; i++) {
        printNode(children[i], childPrefix, i === children.length - 1);
      }
    } else {
      const sizeStr = node.size > 0 ? ` (${formatBytes(node.size)})` : "";
      output += prefix + connector + node.name + sizeStr + "\n";
    }
  }

  const topChildren = Array.from(root.children.values());
  topChildren.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  for (let i = 0; i < topChildren.length; i++) {
    printNode(topChildren[i], "", i === topChildren.length - 1);
  }

  return { headerName: folderName, tree: output };
}

/**
 * Fetches Dropbox folder entries via the worker proxy endpoint with caching and in-flight deduplication.
 */
export async function fetchDropboxFolderEntries(url, signal) {
  let cleanUrl = url;
  try {
    const u = new URL(url);
    u.searchParams.delete("raw");
    u.searchParams.set("dl", "0");
    cleanUrl = u.toString();
  } catch (_) {}

  if (dropboxFolderCache.has(cleanUrl)) {
    return dropboxFolderCache.get(cleanUrl);
  }
  if (dropboxInFlight.has(cleanUrl)) {
    return dropboxInFlight.get(cleanUrl);
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort("timeout"), 15000);

  let combinedSignal = timeoutController.signal;
  if (signal) {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
      combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    } else {
      signal.addEventListener("abort", () => timeoutController.abort(), { once: true });
      combinedSignal = timeoutController.signal;
    }
  }

  const fetchPromise = (async () => {
    try {
      const listEndpoint = `${PROXY_URL}/dropbox/list?url=${encodeURIComponent(cleanUrl)}`;
      const res = await fetch(listEndpoint, { signal: combinedSignal });

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/zip") || !contentType.includes("application/json")) {
        if (res.body) {
          try { res.body.cancel(); } catch (_) {}
        }
        throw new Error("Worker update required: Please paste and deploy the latest paw-worker.js into your Cloudflare Worker dashboard to enable on-demand streaming without downloading full 5GB archives.");
      }

      if (!res.ok) {
        let errMsg = `Failed to fetch Dropbox folder (HTTP ${res.status})`;
        try {
          const errData = await res.json();
          if (errData.error) errMsg = errData.error;
        } catch (_) {}
        const error = new Error(errMsg);
        error.status = res.status;
        throw error;
      }

      const data = await res.json();
      dropboxFolderCache.set(cleanUrl, data);
      return data;
    } catch (fetchErr) {
      if (signal && signal.aborted) throw fetchErr;
      if (timeoutController.signal.aborted) {
        throw new Error("Dropbox connection timed out. Please verify your Cloudflare Worker deployment.");
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
      dropboxInFlight.delete(cleanUrl);
    }
  })();

  dropboxInFlight.set(cleanUrl, fetchPromise);
  return fetchPromise;
}

/**
 * Handles embedding a Dropbox link inside a post card.
 * If it's a folder, inspects contents via worker and embeds a single video/image directly,
 * or displays a detailed multi-file archive card with a file tree and count.
 */
export function handleDropboxFileCard(item, url, postTitle, filename, progressOverlay, signal) {
  const isFolder = isDropboxFolderUrl(url);

  if (isFolder) {
    handleDropboxFolderEmbed(item, url, progressOverlay, postTitle, filename, signal);
    return;
  }

  const ext = url.split("?")[0].split(".").pop().toLowerCase();
  const isGif = ext === "gif";
  const isImage = ["jpg", "jpeg", "png", "webp", "avif"].includes(ext);
  const isVideo = ["mp4", "webm", "mov"].includes(ext);

  if (isGif || isImage || isVideo) {
    let targetUrl = url;
    try {
      const u = new URL(url);
      u.searchParams.set("raw", "1");
      u.searchParams.delete("dl");
      targetUrl = u.toString();
    } catch (_) {}
    const directUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;
    if (progressOverlay) {
      progressOverlay.style.display = "flex";
      renderMediaProgress(progressOverlay, "Loading...", null, filename, "", "");
    }
    const triggerRetry = () => {
      item.querySelectorAll("video, audio, img.post-media, canvas.post-media").forEach((el) => el.remove());
      delete item.dataset.loaded;
      handleDropboxFileCard(item, url, postTitle, filename, progressOverlay, signal);
    };
    if (isGif) {
      loadGifPlayer({
        item,
        url: directUrl,
        filename,
        progressOverlay,
        onRetry: triggerRetry,
        syncCarouselClones,
        playbackObserver,
      });
      return;
    }
    if (isVideo) {
      const video = document.createElement("video");
      video.className = "post-media";
      video.src = directUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.setAttribute("muted", "");
      video.preload = "metadata";
      video.controls = false;
      video.addEventListener("canplay", () => {
        if (progressOverlay) progressOverlay.style.display = "none";
        syncCarouselClones(item);
      });
      video.onerror = async () => {
        item.querySelectorAll("video.post-media").forEach((el) => el.remove());
        let errorStatus = "500";
        try {
          const probeRes = await fetch(directUrl, { method: "HEAD", signal });
          if (!probeRes.ok) errorStatus = String(probeRes.status);
        } catch (_) {}
        if (progressOverlay) showMediaUnavailableWarning(progressOverlay, { type: "video", filename, errorStatus, externalUrl: url, onRetry: triggerRetry });
      };
      item.appendChild(video);
      attachCustomVideoPlayer(video, item);
      playbackObserver.observe(video);
    } else {
      const img = new Image();
      img.className = "post-media";
      img.onload = () => {
        if (progressOverlay) progressOverlay.style.display = "none";
        item.querySelectorAll("img.post-media").forEach((el) => el.remove());
        item.appendChild(img);
        syncCarouselClones(item);
      };
      const triggerRetry = () => {
        item.querySelectorAll("video, audio, img.post-media").forEach((el) => el.remove());
        delete item.dataset.loaded;
        handleDropboxFileCard(item, url, postTitle, filename, progressOverlay, signal);
      };
      img.onerror = async () => {
        item.querySelectorAll("img.post-media").forEach((el) => el.remove());
        let errorStatus = "500";
        try {
          const probeRes = await fetch(directUrl, { method: "HEAD", signal });
          if (!probeRes.ok) errorStatus = String(probeRes.status);
        } catch (_) {}
        if (progressOverlay) showMediaUnavailableWarning(progressOverlay, { type: "image", filename, errorStatus, externalUrl: url, onRetry: triggerRetry });
      };
      img.src = directUrl;
    }
    return;
  }

  if (progressOverlay) progressOverlay.style.display = "none";
  renderArchiveCardUI(item, url, "dropbox", postTitle, filename, signal);
}

/**
 * Inspects a Dropbox shared folder and embeds either the single media item directly,
 * or displays an archive preview card with file counts, sizes, and file tree.
 */
export async function handleDropboxFolderEmbed(item, url, progressOverlay, postTitle, fallbackName, signal) {
  try {
    if (progressOverlay) {
      progressOverlay.style.display = "flex";
      renderMediaProgress(progressOverlay, "Loading...", null, fallbackName || "Dropbox Folder", "Connecting...", "");
    }

    const data = await fetchDropboxFolderEntries(url, signal);
    const rawEntries = data.entries || [];
    const seen = new Set();
    const entries = [];
    for (const item of rawEntries) {
      const key = item.href || item.rawUrl || (item.path || item.filename);
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(item);
      }
    }

    const mediaFiles = entries.filter((f) => !f.is_dir && isImageOrVideo(f.filename));
    const subfolders = entries.filter((f) => f.is_dir);

    let totalSize = 0;
    if (typeof data.total_size === "number" && data.total_size > 0) {
      totalSize = data.total_size;
    } else {
      for (const e of entries) {
        if (!e.is_dir) totalSize += (e.bytes || 0);
      }
    }

    const folderName = data.folder_name || fallbackName || "Dropbox Archive";
    const { headerName, tree } = formatDropboxFileTree(entries, folderName);
    const archiveName = headerName || fallbackName || "Dropbox Archive";

    // If folder contains only a single media file and no subfolders, stream it directly in the card
    if (mediaFiles.length === 1 && subfolders.length === 0) {
      const single = mediaFiles[0];
      const isVideo = ["mp4", "webm", "mov"].includes(single.filename.split(".").pop().toLowerCase());
      let targetUrl = single.rawUrl || single.href || "";
      if (targetUrl) {
        try {
          const u = new URL(targetUrl);
          u.searchParams.set("raw", "1");
          u.searchParams.delete("dl");
          targetUrl = u.toString();
        } catch (_) {}
      }
      const streamUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;

      if (progressOverlay) progressOverlay.style.display = "none";

      if (isVideo) {
        const video = document.createElement("video");
        video.className = "post-media";
        video.src = streamUrl;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.setAttribute("muted", "");
        video.preload = "metadata";
        video.controls = false;
        video.addEventListener("canplay", () => {
          syncCarouselClones(item);
        });
        const triggerRetry = () => {
          item.querySelectorAll("video, audio, img.post-media").forEach((el) => el.remove());
          delete item.dataset.loaded;
          handleDropboxFolderEmbed(item, url, progressOverlay, postTitle, fallbackName, signal);
        };
        video.onerror = async () => {
          item.querySelectorAll("video.post-media").forEach((el) => el.remove());
          let errorStatus = "500";
          try {
            const probeRes = await fetch(streamUrl, { method: "HEAD", signal });
            if (!probeRes.ok) errorStatus = String(probeRes.status);
          } catch (_) {}
          if (progressOverlay) {
            showMediaUnavailableWarning(progressOverlay, {
              type: "video",
              filename: single.filename,
              errorStatus,
              externalUrl: url,
              onRetry: triggerRetry
            });
          }
        };
        item.appendChild(video);
        attachCustomVideoPlayer(video, item);
        playbackObserver.observe(video);
      } else {
        const img = new Image();
        img.className = "post-media";
        img.onload = () => {
          if (progressOverlay) progressOverlay.style.display = "none";
          item.querySelectorAll("img.post-media").forEach((el) => el.remove());
          item.appendChild(img);
          syncCarouselClones(item);
        };
        const triggerRetry = () => {
          item.querySelectorAll("video, audio, img.post-media").forEach((el) => el.remove());
          delete item.dataset.loaded;
          handleDropboxFolderEmbed(item, url, progressOverlay, postTitle, fallbackName, signal);
        };
        img.onerror = async () => {
          item.querySelectorAll("img.post-media").forEach((el) => el.remove());
          let errorStatus = "500";
          try {
            const probeRes = await fetch(streamUrl, { method: "HEAD", signal });
            if (!probeRes.ok) errorStatus = String(probeRes.status);
          } catch (_) {}
          if (progressOverlay) {
            showMediaUnavailableWarning(progressOverlay, {
              type: "image",
              filename: single.filename,
              errorStatus,
              externalUrl: url,
              onRetry: triggerRetry
            });
          }
        };
        img.src = streamUrl;
      }
      syncCarouselClones(item);
      return;
    }

    if (progressOverlay) progressOverlay.style.display = "none";

    let countLabel = "";
    if (mediaFiles.length === 0 && subfolders.length > 0) {
      countLabel = `${subfolders.length} folder${subfolders.length > 1 ? "s" : ""}`;
    } else if (mediaFiles.length > 0 && subfolders.length > 0) {
      countLabel = `${mediaFiles.length} file${mediaFiles.length > 1 ? "s" : ""}, ${subfolders.length} folder${subfolders.length > 1 ? "s" : ""}`;
    } else {
      const count = mediaFiles.length || entries.length;
      countLabel = `${count} file${count > 1 ? "s" : ""}`;
    }

    renderArchiveCardUI(item, url, "dropbox", postTitle, archiveName, signal, {
      totalSize,
      fileCount: mediaFiles.length || entries.length,
      countLabel,
      tree
    });

    if (subfolders.length > 0) {
      progressivelyExpandDropboxTree(item, url, entries, folderName, totalSize, archiveName, signal);
    }

  } catch (err) {
    if (signal && signal.aborted) return;
    console.warn("[Dropbox] handleDropboxFolderEmbed warning for", url, err.message || err);
    if (progressOverlay) {
      const detectedStatus = String(err.status || (err.message && err.message.match(/HTTP\s+(\d{3})/i)?.[1]) || "500");
      showMediaUnavailableWarning(progressOverlay, {
        type: "zip",
        filename: fallbackName || "Dropbox Folder",
        errorStatus: detectedStatus,
        error: err,
        message: err.message || "Failed to load Dropbox folder",
        externalUrl: url,
        onRetry: () => handleDropboxFolderEmbed(item, url, progressOverlay, postTitle, fallbackName, signal)
      });
    }
  }
}

/**
 * Progressively crawls Dropbox subfolders in the background to discover all files and their sizes,
 * continuously expanding the feed card's info tree and header counts.
 */
async function progressivelyExpandDropboxTree(cardItem, rootUrl, initialEntries, folderName, initialTotalSize, archiveName, signal) {
  if (!cardItem || !initialEntries || initialEntries.length === 0) return;

  const allEntries = [...initialEntries];
  const seenPaths = new Set();
  const seenFolders = new Set();

  for (const entry of initialEntries) {
    const p = entry.path || entry.filename;
    seenPaths.add(p);
    if (entry.is_dir && entry.href) {
      seenFolders.add(entry.href);
    }
  }

  const queue = initialEntries
    .filter((e) => e.is_dir && e.href)
    .map((e) => ({ ...e, path: e.filename }));

  if (queue.length === 0) return;

  let discoveredBytes = 0;
  let running = true;
  let updateTimer = null;
  let lastUpdateTime = 0;

  function updateUI() {
    if (!cardItem.isConnected || (signal && signal.aborted)) return;

    const { tree } = formatDropboxFileTree(allEntries, folderName);
    let fullTree = "";
    if (archiveName && !tree.startsWith("└── " + archiveName)) {
      fullTree = `${archiveName}\n${tree}`;
    } else {
      fullTree = tree;
    }

    const files = allEntries.filter((e) => !e.is_dir);
    const dirs = allEntries.filter((e) => e.is_dir);

    const effectiveTotal = (initialTotalSize && initialTotalSize > 0) ? initialTotalSize : discoveredBytes;
    const sizeStr = effectiveTotal > 0 ? `${formatBytes(effectiveTotal)}, ` : "";

    let countText = "";
    if (files.length > 0 && dirs.length > 0) {
      countText = `${files.length} file${files.length > 1 ? "s" : ""}, ${dirs.length} folder${dirs.length > 1 ? "s" : ""}`;
    } else if (files.length > 0) {
      countText = `${files.length} file${files.length > 1 ? "s" : ""}`;
    } else {
      countText = `${dirs.length} folder${dirs.length > 1 ? "s" : ""}`;
    }

    const headerText = `${sizeStr}${countText}`;

    const treeEl = cardItem.querySelector(".zip-info-tree");
    if (treeEl) treeEl.textContent = fullTree;

    const headerSpan = cardItem.querySelector(".zip-info-header span");
    if (headerSpan) headerSpan.textContent = headerText;

    // Synchronize clone slides in infinite loop carousels
    if (cardItem.parentElement && cardItem.parentElement.classList.contains("media-carousel")) {
      const carousel = cardItem.parentElement;
      const children = Array.from(carousel.children);
      if (children.length > 2) {
        const firstOrig = children[1];
        const lastOrig = children[children.length - 2];
        let clone = null;
        if (cardItem === firstOrig) clone = children[children.length - 1];
        else if (cardItem === lastOrig) clone = children[0];
        if (clone && clone.dataset.isClone === "true") {
          const cTree = clone.querySelector(".zip-info-tree");
          if (cTree) cTree.textContent = fullTree;
          const cHeader = clone.querySelector(".zip-info-header span");
          if (cHeader) cHeader.textContent = headerText;
        }
      }
    }
  }

  function scheduleUpdate(immediate = false) {
    if (immediate) {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = null;
      updateUI();
      lastUpdateTime = Date.now();
      return;
    }
    const now = Date.now();
    if (now - lastUpdateTime >= 250) {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = null;
      updateUI();
      lastUpdateTime = now;
    } else if (!updateTimer) {
      updateTimer = setTimeout(() => {
        updateTimer = null;
        updateUI();
        lastUpdateTime = Date.now();
      }, 250 - (now - lastUpdateTime));
    }
  }

  const MAX_CONCURRENT = 5;
  const MAX_TOTAL_FOLDERS = 400;
  let crawledCount = 0;

  async function worker() {
    while (queue.length > 0 && running) {
      if (signal && signal.aborted) break;
      if (!cardItem.isConnected) break;
      if (crawledCount >= MAX_TOTAL_FOLDERS) break;

      const current = queue.shift();
      if (!current || !current.href) continue;

      crawledCount++;
      try {
        const data = await fetchDropboxFolderEntries(current.href, signal);
        if (signal && signal.aborted) break;
        if (!cardItem.isConnected) break;

        const subEntries = data.entries || [];
        for (const child of subEntries) {
          const childPath = `${current.path}/${child.filename}`;
          if (seenPaths.has(childPath)) continue;
          seenPaths.add(childPath);

          const childEntry = { ...child, path: childPath };
          allEntries.push(childEntry);

          if (child.is_dir) {
            if (child.href && !seenFolders.has(child.href)) {
              seenFolders.add(child.href);
              queue.push(childEntry);
            }
          } else {
            discoveredBytes += (child.bytes || 0);
          }
        }
        scheduleUpdate(false);
      } catch (err) {
        if (signal && signal.aborted) break;
      }
    }
  }

  try {
    const workers = Array.from({ length: MAX_CONCURRENT }, () => worker());
    await Promise.all(workers);
  } finally {
    running = false;
    if (updateTimer) clearTimeout(updateTimer);
    scheduleUpdate(true);
  }
}

/**
 * Recursively discovers all subfolders and media files inside a Dropbox shared directory,
 * grouping them by directory path for 2D matrix navigation.
 */
export async function crawlAllDropboxFolders(rootUrl, rootName, initialEntries, signal, onProgress) {
  const folderGroupsMap = new Map();
  const seenUrls = new Set();
  seenUrls.add(rootUrl);

  const rootFiles = (initialEntries || []).filter((e) => !e.is_dir && isImageOrVideo(e.filename));
  if (rootFiles.length > 0) {
    folderGroupsMap.set(rootName, {
      folderName: rootName,
      folderPath: rootName,
      files: rootFiles
    });
  }

  const queue = (initialEntries || [])
    .filter((e) => e.is_dir && e.href)
    .map((e) => ({ name: e.filename, path: e.filename, url: e.href }));

  for (const item of queue) {
    seenUrls.add(item.url);
  }

  const MAX_CONCURRENT = 5;
  const MAX_FOLDERS = 100;
  let crawled = 0;

  async function crawlWorker() {
    while (queue.length > 0) {
      if (signal && signal.aborted) break;
      if (crawled >= MAX_FOLDERS) break;

      const curr = queue.shift();
      if (!curr) continue;
      crawled++;
      if (onProgress) onProgress(crawled);

      try {
        const subData = await fetchDropboxFolderEntries(curr.url, signal);
        if (signal && signal.aborted) break;

        const subEntries = subData.entries || [];
        const files = subEntries.filter((e) => !e.is_dir && isImageOrVideo(e.filename));
        if (files.length > 0) {
          folderGroupsMap.set(curr.path, {
            folderName: curr.name,
            folderPath: curr.path,
            files: files
          });
        }

        for (const child of subEntries) {
          if (child.is_dir && child.href && !seenUrls.has(child.href)) {
            seenUrls.add(child.href);
            queue.push({
              name: child.filename,
              path: `${curr.path}/${child.filename}`,
              url: child.href
            });
          }
        }
      } catch (_) {}
    }
  }

  if (queue.length > 0) {
    const workers = Array.from({ length: MAX_CONCURRENT }, () => crawlWorker());
    await Promise.all(workers);
  }

  const paths = Array.from(folderGroupsMap.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );

  return paths.map((p) => folderGroupsMap.get(p));
}

/**
 * Opens a Dropbox share link in the fullscreen gallery viewer.
 * Folders stream media files individually on-demand without downloading the entire folder.
 */
export async function openDropboxGallery(dropboxUrl, galleryTitle, folderStack = [], post = null) {
  if (post) {
    state.currentGalleryPost = post;
  } else if (!state.currentGalleryPost) {
    state.currentGalleryPost = getCurrentGalleryPost();
  }

  const signal = createExternalAbortSignal();

  const existingBackBtn = document.getElementById("dropbox-carousel-back-btn");
  if (existingBackBtn) existingBackBtn.remove();

  if (state.currentZipObjectUrls && state.currentZipObjectUrls.length > 0) {
    state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.currentZipObjectUrls = [];
  }

  setZipNavVisible(false, true);
  if (zipViewer) zipViewer.classList.remove("hidden");
  if (zipTitle) zipTitle.textContent = galleryTitle || "Dropbox Gallery";
  if (zipIndicator) {
    zipIndicator.textContent = "";
    zipIndicator.style.display = "";
  }
  if (zipContent) {
    zipContent.classList.remove("folder-browser-mode");
    zipContent.innerHTML = '<div id="zip-progress-text"></div>';
    const pt = document.getElementById("zip-progress-text");
    renderArchiveProgress(pt, "Connecting...", null, galleryTitle || "Dropbox Gallery");
  }

  const isFolder = isDropboxFolderUrl(dropboxUrl);

  if (!isFolder) {
    // Single file share link
    if (signal && signal.aborted) return;
    if (zipContent) {
      zipContent.classList.remove("folder-browser-mode");
      zipContent.classList.remove("gallery-2d-mode");
      zipContent.innerHTML = "";
    }
    if (zipIndicator) zipIndicator.textContent = "1 / 1";
    if (zipContent) zipContent.dataset.mediaCount = "1";

    const container = document.createElement("div");
    container.className = "media-item";
    container.dataset.fileIdx = "0";
    const filename = dropboxUrl.split("/").pop().split("?")[0] || "file";
    container.dataset.filename = filename;
    container.dataset.folder = "/";
    container.dataset.link = dropboxUrl;
    container.dataset.size = "0";
    container.style.flex = "0 0 100vw";
    container.style.height = "100%";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";

    const directUrl = `${PROXY_URL}/dropbox?url=${encodeURIComponent(dropboxUrl)}`;
    const ext = dropboxUrl.split("?")[0].split(".").pop().toLowerCase();
    const isVideo = ["mp4", "webm", "mov"].includes(ext);

    if (isVideo) {
      const video = document.createElement("video");
      video.src = directUrl;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.loop = true;
      video.muted = true;
      video.style.maxWidth = "100%";
      video.style.maxHeight = "100%";
      video.style.objectFit = "contain";
      video.onerror = () => {
        if (zipContent) {
          zipContent.innerHTML = "";
          showMediaUnavailableWarning(zipContent, {
            type: "video",
            filename,
            errorStatus: "404",
            externalUrl: dropboxUrl
          });
        }
      };
      container.appendChild(video);
      attachCustomVideoPlayer(video, container);
    } else {
      const img = document.createElement("img");
      img.src = directUrl;
      img.style.maxWidth = "100%";
      img.style.maxHeight = "100%";
      img.style.objectFit = "contain";
      img.onerror = () => {
        if (zipContent) {
          zipContent.innerHTML = "";
          showMediaUnavailableWarning(zipContent, {
            type: "image",
            filename,
            errorStatus: "404",
            externalUrl: dropboxUrl
          });
        }
      };
      container.appendChild(img);
    }
    if (zipContent) zipContent.appendChild(container);
    updateZipIndicatorsAndHUD();
    return;
  }

  // Folder share link: fetch entries and stream individual files on demand
  try {
    const pt = document.getElementById("zip-progress-text");
    if (pt) renderArchiveProgress(pt, "Fetching folder index...", null, galleryTitle || "Dropbox Gallery");

    const data = await fetchDropboxFolderEntries(dropboxUrl, signal);
    if (signal.aborted) return;

    const rawEntries = data.entries || [];
    const seen = new Set();
    const entries = [];
    for (const item of rawEntries) {
      const key = item.href || item.rawUrl || (item.path || item.filename);
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(item);
      }
    }

    const currentFolderName = data.folder_name || galleryTitle || "Dropbox Folder";

    // Crawl all subfolders to collect folder groups for 2D matrix gallery
    const folderGroups = await crawlAllDropboxFolders(dropboxUrl, currentFolderName, entries, signal, (scannedCount) => {
      const p = document.getElementById("zip-progress-text");
      if (p) renderArchiveProgress(p, `Scanning folders (${scannedCount} scanned)...`, null, galleryTitle || "Dropbox Gallery");
    });

    if (signal.aborted) return;

    if (folderGroups && folderGroups.length > 0) {
      const matrixGroups = folderGroups.map((group) => ({
        folderName: group.folderName,
        folderPath: group.folderPath,
        files: group.files.map((f, idx) => ({
          filename: f.filename,
          folder: group.folderPath,
          size: f.bytes || 0,
          link: f.href || f.rawUrl || "",
          loadMedia: (container, sig) => {
            container.dataset.fileIdx = String(idx);
            loadAndDisplayDropboxItem(container, f, sig);
          }
        }))
      }));

      render2DMatrixGallery(matrixGroups, { galleryTitle: currentFolderName, signal });
      return;
    }

    // Fallback to interactive folder browser if no media files found anywhere
    renderDropboxFolderBrowser(data, dropboxUrl, currentFolderName, folderStack, signal);

    // Empty folder
    if (zipContent) {
      zipContent.classList.add("folder-browser-mode");
      zipContent.innerHTML = `
        <div class="dropbox-browser-root" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; text-align: center; gap: 14px;">
          <span style="color: #ffb86c; font-size: 1.3rem; font-weight: bold;">No Media Found</span>
          <span style="color: #ccc; font-size: 0.95rem; max-width: 340px; line-height: 1.4;">No supported images or videos found in this folder.</span>
          <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; justify-content: center;">
            ${folderStack.length > 0 ? `
              <button id="dropbox-empty-back-btn" class="dropbox-nav-back-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                <span>Back to ${escapeHtml(folderStack[folderStack.length - 1].name || "Previous")}</span>
              </button>
            ` : ""}
            <a href="${escapeHtml(dropboxUrl)}" target="_blank" rel="noopener noreferrer" class="dropbox-nav-back-btn" style="text-decoration: none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              <span>Open Link</span>
            </a>
          </div>
        </div>
      `;
      if (folderStack.length > 0) {
        const emptyBackBtn = document.getElementById("dropbox-empty-back-btn");
        if (emptyBackBtn) {
          emptyBackBtn.addEventListener("click", () => {
            const parent = folderStack[folderStack.length - 1];
            openDropboxGallery(parent.url, parent.name, folderStack.slice(0, -1));
          });
        }
      }
    }

  } catch (err) {
    if (signal && signal.aborted) return;
    console.warn("[Dropbox] Gallery Warning:", err.message || err);
    if (zipTitle) zipTitle.textContent = "Dropbox — Error";
    if (zipIndicator) zipIndicator.textContent = "";
    if (zipContent) {
      zipContent.classList.add("folder-browser-mode");
      const detectedStatus = String(err.status || (err.message && err.message.match(/HTTP\s+(\d{3})/i)?.[1]) || "500");
      const isServerError = ["500", "502", "503", "504"].includes(detectedStatus);
      const errorTitle = isServerError ? "Server Error" : "Dropbox Folder Unavailable";
      zipContent.innerHTML = `
        <div class="dropbox-browser-root" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; text-align: center; gap: 12px;">
          <span style="color: #ff5555; font-size: 2.2rem; font-weight: 800; font-family: monospace; letter-spacing: 1px; line-height: 1;">${escapeHtml(detectedStatus)}</span>
          <span style="color: #ffb86c; font-size: 1.2rem; font-weight: bold;">${escapeHtml(errorTitle)}</span>
          <span style="color: #ccc; font-size: 0.95rem; max-width: 340px; line-height: 1.4;">${escapeHtml(err.message || "Unknown error")}</span>
          <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; justify-content: center;">
            ${folderStack.length > 0 ? `
              <button id="dropbox-err-back-btn" class="dropbox-nav-back-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                <span>Back to ${escapeHtml(folderStack[folderStack.length - 1].name || "Previous")}</span>
              </button>
            ` : ""}
            <a href="${escapeHtml(dropboxUrl)}" target="_blank" rel="noopener noreferrer" class="dropbox-nav-back-btn" style="text-decoration: none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              <span>Open Link</span>
            </a>
          </div>
        </div>
      `;
      if (folderStack.length > 0) {
        const errBackBtn = document.getElementById("dropbox-err-back-btn");
        if (errBackBtn) {
          errBackBtn.addEventListener("click", () => {
            const parent = folderStack[folderStack.length - 1];
            openDropboxGallery(parent.url, parent.name, folderStack.slice(0, -1));
          });
        }
      }
    }
  }
}

/**
 * Renders an interactive Dropbox folder explorer inside zipContent.
 */
function renderDropboxFolderBrowser(data, folderUrl, currentFolderName, folderStack, signal) {
  if (!zipContent) return;

  const existingBackBtn = document.getElementById("dropbox-carousel-back-btn");
  if (existingBackBtn) existingBackBtn.remove();

  if (window.zipMediaObserver) window.zipMediaObserver.disconnect();

  zipContent.classList.add("folder-browser-mode");
  if (zipIndicator) {
    zipIndicator.textContent = "";
    zipIndicator.style.display = "none";
  }
  if (zipTitle) zipTitle.textContent = currentFolderName || "Dropbox";

  const entries = data.entries || [];
  const subfolders = entries.filter((f) => f.is_dir);
  const mediaFiles = entries.filter((f) => !f.is_dir && isImageOrVideo(f.filename));

  subfolders.sort((a, b) => (a.path || a.filename).localeCompare((b.path || b.filename), undefined, { numeric: true, sensitivity: "base" }));
  mediaFiles.sort((a, b) => (a.path || a.filename).localeCompare((b.path || b.filename), undefined, { numeric: true, sensitivity: "base" }));

  // Build root container
  const root = document.createElement("div");
  root.className = "dropbox-browser-root";

  // Header with back navigation & breadcrumbs
  const header = document.createElement("div");
  header.className = "dropbox-browser-header";

  const backBtn = document.createElement("button");
  backBtn.className = "dropbox-nav-back-btn";

  if (folderStack.length > 0) {
    const parent = folderStack[folderStack.length - 1];
    backBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      <span>${escapeHtml(parent.name || "Back")}</span>
    `;
    backBtn.addEventListener("click", () => {
      openDropboxGallery(parent.url, parent.name, folderStack.slice(0, -1));
    });
  } else {
    backBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      <span>Close</span>
    `;
    backBtn.addEventListener("click", () => {
      closeZipGallery();
    });
  }
  header.appendChild(backBtn);

  // Breadcrumbs container
  const crumbs = document.createElement("div");
  crumbs.className = "dropbox-breadcrumbs-container";

  folderStack.forEach((item, index) => {
    const crumbLink = document.createElement("span");
    crumbLink.className = "dropbox-breadcrumb-link";
    crumbLink.textContent = item.name || "Folder";
    crumbLink.addEventListener("click", () => {
      openDropboxGallery(item.url, item.name, folderStack.slice(0, index));
    });
    crumbs.appendChild(crumbLink);

    const sep = document.createElement("span");
    sep.style.color = "#6e7681";
    sep.textContent = "/";
    crumbs.appendChild(sep);
  });

  const currentCrumb = document.createElement("span");
  currentCrumb.className = "dropbox-breadcrumb-current";
  currentCrumb.textContent = currentFolderName;
  crumbs.appendChild(currentCrumb);

  header.appendChild(crumbs);
  root.appendChild(header);

  // Button to browse all folders in 2D Matrix Gallery
  if (subfolders.length > 0) {
    const matrixBtn = document.createElement("button");
    matrixBtn.className = "dropbox-play-all-bar";
    matrixBtn.style.background = "linear-gradient(135deg, rgba(88, 166, 255, 0.25), rgba(188, 140, 255, 0.25))";
    matrixBtn.style.border = "1px solid rgba(88, 166, 255, 0.4)";
    matrixBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      <span>Browse All Folders in 2D Gallery</span>
    `;
    matrixBtn.addEventListener("click", () => {
      openDropboxGallery(folderUrl, currentFolderName, folderStack);
    });
    root.appendChild(matrixBtn);
  }

  // If there are media files in this folder, show a Play/View All button
  if (mediaFiles.length > 0) {
    const playBtn = document.createElement("button");
    playBtn.className = "dropbox-play-all-bar";
    playBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      <span>View Media Files (${mediaFiles.length})</span>
    `;
    playBtn.addEventListener("click", () => {
      const singleGroup = [{
        folderName: currentFolderName,
        folderPath: currentFolderName,
        files: mediaFiles.map((f, fIdx) => ({
          filename: f.filename,
          folder: currentFolderName,
          size: f.bytes || 0,
          link: f.href || f.rawUrl || "",
          loadMedia: (cont, sig) => {
            cont.dataset.fileIdx = String(fIdx);
            loadAndDisplayDropboxItem(cont, f, sig);
          }
        }))
      }];
      render2DMatrixGallery(singleGroup, { galleryTitle: currentFolderName, signal });
    });
    root.appendChild(playBtn);
  }

  // Subfolders Section
  if (subfolders.length > 0) {
    const sectionTitle = document.createElement("div");
    sectionTitle.className = "dropbox-section-header";
    sectionTitle.innerHTML = `<span>Folders (${subfolders.length})</span>`;
    root.appendChild(sectionTitle);

    const grid = document.createElement("div");
    grid.className = "dropbox-grid";

    subfolders.forEach((sub) => {
      const card = document.createElement("div");
      card.className = "dropbox-folder-card";
      card.innerHTML = `
        <svg class="dropbox-folder-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <div class="dropbox-card-name" title="${escapeHtml(sub.filename)}">${escapeHtml(sub.filename)}</div>
        <svg class="dropbox-card-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      `;

      card.addEventListener("click", () => {
        card.style.opacity = "0.6";
        const nextStack = [...folderStack, { name: currentFolderName, url: folderUrl }];
        openDropboxGallery(sub.href, sub.filename, nextStack);
      });

      grid.appendChild(card);
    });

    root.appendChild(grid);
  }

  // Direct Media Files list Section
  if (mediaFiles.length > 0) {
    const mediaSectionTitle = document.createElement("div");
    mediaSectionTitle.className = "dropbox-section-header";
    mediaSectionTitle.innerHTML = `<span>Files (${mediaFiles.length})</span>`;
    root.appendChild(mediaSectionTitle);

    const fileList = document.createElement("div");
    fileList.className = "dropbox-files-list";

    mediaFiles.forEach((file, idx) => {
      const row = document.createElement("div");
      row.className = "dropbox-file-row";

      const ext = file.filename.split(".").pop().toLowerCase();
      const isVideo = ["mp4", "webm", "mov"].includes(ext);
      const iconSvg = isVideo
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3fb950" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;

      const sizeText = file.bytes ? formatBytes(file.bytes) : "";

      row.innerHTML = `
        <span style="flex-shrink:0;">${iconSvg}</span>
        <span class="dropbox-card-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</span>
        ${sizeText ? `<span style="color:#8b949e;font-size:0.85rem;margin-left:auto;padding-left:10px;white-space:nowrap;">${sizeText}</span>` : ""}
      `;

      row.addEventListener("click", () => {
        const singleGroup = [{
          folderName: currentFolderName,
          folderPath: currentFolderName,
          files: mediaFiles.map((f, fIdx) => ({
            filename: f.filename,
            folder: currentFolderName,
            size: f.bytes || 0,
            link: f.href || f.rawUrl || "",
            loadMedia: (cont, sig) => {
              cont.dataset.fileIdx = String(fIdx);
              loadAndDisplayDropboxItem(cont, f, sig);
            }
          }))
        }];
        render2DMatrixGallery(singleGroup, { galleryTitle: currentFolderName, signal });
        const rowEl = zipContent?.querySelector(".zip-folder-row");
        if (rowEl && idx > 0) {
          const itemWidth = rowEl.clientWidth || window.innerWidth;
          rowEl.scrollLeft = idx * itemWidth;
        }
      });

      fileList.appendChild(row);
    });

    root.appendChild(fileList);
  }

  zipContent.innerHTML = "";
  zipContent.appendChild(root);
}

/**
 * Sets up the swipeable fullscreen carousel with on-demand streaming for each media slide.
 */
function renderDropboxCarousel(files, folderUrl, signal, folderStack = [], currentFolderName = "", initialIndex = 0) {
  if (zipContent) {
    zipContent.classList.remove("folder-browser-mode");
    zipContent.innerHTML = "";
  }

  if (window.zipMediaObserver) window.zipMediaObserver.disconnect();

  const existingBackBtn = document.getElementById("dropbox-carousel-back-btn");
  if (existingBackBtn) existingBackBtn.remove();

  // Floating Back Button if inside a folder hierarchy
  if (folderStack && folderStack.length > 0) {
    const parent = folderStack[folderStack.length - 1];
    const carouselBackBtn = document.createElement("button");
    carouselBackBtn.id = "dropbox-carousel-back-btn";
    carouselBackBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
      <span>${escapeHtml(parent.name || "Folders")}</span>
    `;
    carouselBackBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      carouselBackBtn.remove();
      openDropboxGallery(parent.url, parent.name, folderStack.slice(0, -1));
    });
    if (zipViewer) zipViewer.appendChild(carouselBackBtn);
  }

  if (zipTitle) zipTitle.textContent = currentFolderName || "Dropbox Gallery";
  if (zipIndicator) {
    zipIndicator.style.display = "";
    zipIndicator.textContent = `${initialIndex + 1} / ${files.length}`;
  }

  const pCount = Math.max(1, window.pawPreloadCount || 1);
  window.zipMediaObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const target = entry.target;
          const idx = parseInt(target.dataset.fileIdx, 10);
          if (!isNaN(idx) && files[idx] && !target.dataset.loaded && !target.dataset.loading) {
            loadAndDisplayDropboxItem(target, files[idx], signal);
          }
        }
      });
    },
    {
      root: zipContent,
      rootMargin: `0px ${pCount * 100}%`
    }
  );

  files.forEach((file, idx) => {
    const itemContainer = createDropboxItemContainer(file, idx, currentFolderName);
    if (zipContent) zipContent.appendChild(itemContainer);
    window.zipMediaObserver.observe(itemContainer);
  });

  if (zipContent) zipContent.dataset.mediaCount = files.length;

  if (files.length > 1 && zipContent && zipContent.children.length > 1) {
    const firstChild = zipContent.children[0];
    const lastChild = zipContent.children[zipContent.children.length - 1];
    const cloneFirst = firstChild.cloneNode(true);
    const cloneLast = lastChild.cloneNode(true);

    cloneFirst.dataset.isClone = "true";
    cloneLast.dataset.isClone = "true";
    cloneFirst.querySelectorAll("video, img").forEach((el) => el.remove());
    cloneLast.querySelectorAll("video, img").forEach((el) => el.remove());
    delete cloneFirst.dataset.loading;
    delete cloneFirst.dataset.loaded;
    delete cloneLast.dataset.loading;
    delete cloneLast.dataset.loaded;
    const p1 = cloneFirst.querySelector(".media-progress");
    if (p1) p1.style.display = "flex";
    const p2 = cloneLast.querySelector(".media-progress");
    if (p2) p2.style.display = "flex";

    zipContent.insertBefore(cloneLast, firstChild);
    zipContent.appendChild(cloneFirst);

    window.zipMediaObserver.observe(cloneFirst);
    window.zipMediaObserver.observe(cloneLast);

    void zipContent.offsetHeight;

    const itemWidth = zipContent.clientWidth || window.innerWidth;
    zipContent.style.scrollSnapType = "none";
    zipContent.scrollLeft = (initialIndex + 1) * itemWidth;

    setTimeout(() => {
      zipContent.style.scrollSnapType = "";
    }, 50);
  } else if (zipContent) {
    zipContent.scrollLeft = 0;
  }
}

/**
 * Creates a media slide container with a progress placeholder.
 */
function createDropboxItemContainer(file, idx, folderName = "") {
  const container = document.createElement("div");
  container.className = "media-item";
  container.dataset.fileIdx = String(idx);
  container.dataset.filename = file.filename;
  container.dataset.folder = folderName || file.path || "/";
  container.dataset.size = String(file.bytes || 0);
  container.dataset.link = file.href || file.rawUrl || "";
  container.style.flex = "0 0 100vw";
  container.style.height = "100%";
  container.style.scrollSnapAlign = "start";
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.justifyContent = "center";
  container.style.position = "relative";

  const overlay = document.createElement("div");
  overlay.className = "media-progress";
  overlay.style.display = "flex";
  const displayName = file.path || file.filename;
  renderMediaProgress(overlay, "Loading...", null, displayName, file.bytes ? formatBytes(file.bytes) : "", "");
  container.appendChild(overlay);

  return container;
}

/**
 * Loads an individual media item (streaming video or lazy loading image) into its slide.
 */
function loadAndDisplayDropboxItem(container, file, signal) {
  if (!file) return;

  // If already loaded, do nothing
  if (container.dataset.loaded === "true") return;

  // If actively loading, do not initiate a redundant load
  if (container.dataset.loading === "true") return;

  const fileIdxStr = container.dataset.fileIdx;
  const parentRow = container.closest(".zip-folder-row");
  const allMatchingContainers = parentRow
    ? Array.from(parentRow.querySelectorAll(`[data-file-idx="${fileIdxStr}"]`))
    : (zipContent ? Array.from(zipContent.querySelectorAll(`[data-file-idx="${fileIdxStr}"]`)) : [container]);

  // If another clone already has this media successfully loaded, clone it directly and return
  const alreadyLoadedContainer = allMatchingContainers.find((c) => c.dataset.loaded === "true");
  if (alreadyLoadedContainer) {
    container.dataset.loaded = "true";
    delete container.dataset.loading;
    const existingMedia = alreadyLoadedContainer.querySelector("img, video");
    if (existingMedia) {
      container.querySelectorAll("img, video").forEach((el) => el.remove());
      container.appendChild(existingMedia.cloneNode(true));
    }
    const o = container.querySelector(".media-progress");
    if (o) o.style.display = "none";
    return;
  }

  // Mark all matching containers as loading
  allMatchingContainers.forEach((c) => {
    c.dataset.loading = "true";
    delete c.dataset.loaded;
    const overlay = c.querySelector(".media-progress");
    if (overlay) {
      overlay.style.display = "flex";
      const displayName = file.path || file.filename;
      renderMediaProgress(overlay, "Loading...", null, displayName, file.bytes ? formatBytes(file.bytes) : "", "");
    }
  });

  const ext = file.filename.split(".").pop().toLowerCase();
  const isVideo = ["mp4", "webm", "mov"].includes(ext);

  let targetUrl = file.rawUrl || file.href || "";
  if (targetUrl) {
    try {
      const u = new URL(targetUrl);
      u.searchParams.set("raw", "1");
      u.searchParams.delete("dl");
      targetUrl = u.toString();
    } catch (_) {}
  }
  const streamUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;

  if (isVideo) {
    allMatchingContainers.forEach((c) => {
      c.querySelectorAll("img, video").forEach((el) => el.remove());

      const video = document.createElement("video");
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.loop = true;
      video.muted = true;
      video.style.maxWidth = "100%";
      video.style.maxHeight = "100%";
      video.style.objectFit = "contain";
      video.preload = "metadata";
      c.appendChild(video);
      attachCustomVideoPlayer(video, c);

      const onReady = () => {
        allMatchingContainers.forEach((target) => {
          target.dataset.loaded = "true";
          delete target.dataset.loading;
          const o = target.querySelector(".media-progress");
          if (o) o.style.display = "none";
        });
      };

      video.addEventListener("canplay", onReady, { once: true });
      video.addEventListener("loadedmetadata", onReady, { once: true });

      video.onerror = async () => {
        if (signal && signal.aborted) return;
        allMatchingContainers.forEach((target) => {
          delete target.dataset.loading;
          delete target.dataset.loaded;
          target.querySelectorAll("video").forEach((v) => v.remove());
        });

        let errorStatus = "500";
        let errorMsg = "Failed to load video stream";
        try {
          const probeRes = await fetch(streamUrl, { method: "HEAD", signal });
          if (!probeRes.ok) {
            errorStatus = String(probeRes.status);
            errorMsg = probeRes.status === 404 ? "File not found" : (probeRes.status === 429 ? "Too many requests" : `Server error (HTTP ${probeRes.status})`);
          }
        } catch (_) {}

        allMatchingContainers.forEach((target) => {
          const overlay = target.querySelector(".media-progress");
          if (overlay) {
            overlay.style.display = "flex";
            showMediaUnavailableWarning(overlay, {
              type: "video",
              filename: file.filename,
              errorStatus: errorStatus,
              message: errorMsg,
              externalUrl: targetUrl,
              onRetry: () => {
                allMatchingContainers.forEach((t) => {
                  t.querySelectorAll("video, img").forEach((el) => el.remove());
                  delete t.dataset.loading;
                  delete t.dataset.loaded;
                });
                loadAndDisplayDropboxItem(container, file, signal);
              }
            });
          }
        });
      };

      video.src = streamUrl;
    });
  } else {
    // Off-screen Image instance so broken image icon is never shown in DOM
    const img = new Image();
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.objectFit = "contain";
    img.decoding = "async";

    img.onload = () => {
      if (signal && signal.aborted) return;
      allMatchingContainers.forEach((target) => {
        target.dataset.loaded = "true";
        delete target.dataset.loading;
        target.querySelectorAll("img, video").forEach((el) => el.remove());
        target.appendChild(img.cloneNode(true));
        const o = target.querySelector(".media-progress");
        if (o) o.style.display = "none";
      });
    };

    img.onerror = async () => {
      if (signal && signal.aborted) return;
      allMatchingContainers.forEach((target) => {
        delete target.dataset.loading;
        delete target.dataset.loaded;
        target.querySelectorAll("img, video").forEach((el) => el.remove());
      });

      let errorStatus = "500";
      let errorMsg = "Failed to load image";
      try {
        const probeRes = await fetch(streamUrl, { method: "HEAD", signal });
        if (!probeRes.ok) {
          errorStatus = String(probeRes.status);
          errorMsg = probeRes.status === 404 ? "File not found" : (probeRes.status === 429 ? "Too many requests" : `Server error (HTTP ${probeRes.status})`);
        } else {
          const ct = probeRes.headers.get("content-type") || "";
          if (ct.includes("text/html")) {
            errorStatus = "500";
            errorMsg = "Dropbox returned HTML instead of image bytes";
          }
        }
      } catch (_) {}

      allMatchingContainers.forEach((target) => {
        const overlay = target.querySelector(".media-progress");
        if (overlay) {
          overlay.style.display = "flex";
          showMediaUnavailableWarning(overlay, {
            type: "image",
            filename: file.filename,
            errorStatus: errorStatus,
            message: errorMsg,
            externalUrl: targetUrl,
            onRetry: () => {
              allMatchingContainers.forEach((t) => {
                t.querySelectorAll("img, video").forEach((el) => el.remove());
                delete t.dataset.loading;
                delete t.dataset.loaded;
              });
              loadAndDisplayDropboxItem(container, file, signal);
            }
          });
        }
      });
    };

    img.src = streamUrl;
  }
}

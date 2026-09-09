import { PROXY_URL, state } from "./state.js";
import { openZipGallery, zipViewer, zipTitle, zipContent, zipIndicator, setZipNavVisible } from "./zip.js";
import { formatBytes, showMediaUnavailableWarning } from "./utils.js";
import { handleCarouselScrollSettled, smoothScroll, attachMedia, playbackObserver, syncCarouselClones } from "./feed.js";

export const megaFolderCache = new Map();
export const megaBlobCache = new Map();

export function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let activeAbortController = null;

export function abortExternalGallery() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
}

export function base64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function unmergeKeyMac(key) {
  const k = new Uint8Array(32);
  k.set(key);
  for (let i = 0; i < 16; i++) {
    k[i] = key[i] ^ key[16 + i];
  }
  return k;
}

const ZERO_IV = new Uint8Array(16);

export function decryptAttributes(encAttrBase64, rawNodeKey) {
  try {
    if (!window.aesjs) return null;
    const encBytes = base64urlToBytes(encAttrBase64);
    const padLen = (16 - (encBytes.length % 16)) % 16;
    let paddedBytes = encBytes;
    if (padLen > 0) {
      paddedBytes = new Uint8Array(encBytes.length + padLen);
      paddedBytes.set(encBytes);
    }

    const fileKey = unmergeKeyMac(rawNodeKey).subarray(0, 16);
    const aesCbc = new window.aesjs.ModeOfOperation.cbc(fileKey, ZERO_IV);
    const decBytes = aesCbc.decrypt(paddedBytes);
    let end = 0;
    while (end < decBytes.length && decBytes[end] !== 0) end++;
    const str = new TextDecoder().decode(new Uint8Array(decBytes.slice(0, end)));
    if (str.startsWith('MEGA{"')) {
      return JSON.parse(str.slice(4));
    }
  } catch (e) {}
  return null;
}

export function decryptNodeKey(kStr, folderKeyBytes, encAttr, cipherInstance = null) {
  if (!window.aesjs) return null;
  const aes = cipherInstance || (
    folderKeyBytes.length === 32
      ? new window.aesjs.ModeOfOperation.ecb(Array.from(unmergeKeyMac(folderKeyBytes).subarray(0, 16)))
      : new window.aesjs.ModeOfOperation.ecb(Array.from(folderKeyBytes.subarray(0, 16)))
  );

  const parts = kStr.split("/").map((p) => p.split(":"));
  for (const part of parts) {
    const rawEncKeyStr = part[part.length - 1];
    try {
      const encKeyBytes = base64urlToBytes(rawEncKeyStr);
      let rawKey = null;
      if (encKeyBytes.length === 32 || encKeyBytes.length === 16) {
        rawKey = new Uint8Array(aes.decrypt(Array.from(encKeyBytes)));
      } else {
        continue;
      }
      if (rawKey && encAttr) {
        const attrs = decryptAttributes(encAttr, rawKey);
        if (attrs && attrs.n) {
          return { rawKey, attrs };
        }
      } else if (rawKey) {
        return { rawKey, attrs: null };
      }
    } catch (e) {}
  }
  return null;
}

export async function decryptAllMegaNodes(nodes, rootFolderKeyBytes) {
  const nodeKeyMap = new Map();
  const decryptedNodes = new Map();

  const initialKey = rootFolderKeyBytes.length === 32
    ? unmergeKeyMac(rootFolderKeyBytes).subarray(0, 16)
    : rootFolderKeyBytes.subarray(0, 16);

  const availableKeys = [initialKey];
  const cipherMap = new Map();
  function getCipher(keyBytes) {
    let c = cipherMap.get(keyBytes);
    if (!c) {
      const aesKey = keyBytes.length === 32 ? unmergeKeyMac(keyBytes).subarray(0, 16) : keyBytes.subarray(0, 16);
      c = new window.aesjs.ModeOfOperation.ecb(Array.from(aesKey));
      cipherMap.set(keyBytes, c);
    }
    return c;
  }

  let changed = true;
  let passes = 0;
  let opCount = 0;

  while (changed && passes < 10) {
    changed = false;
    passes++;

    for (const node of nodes) {
      if (decryptedNodes.has(node.h) || !node.k || !node.a) continue;

      if (++opCount % 20 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }

      const keysToTry = [];
      if (node.p && nodeKeyMap.has(node.p)) keysToTry.push(nodeKeyMap.get(node.p));
      if (!keysToTry.includes(initialKey)) keysToTry.push(initialKey);
      if (passes > 2) {
        for (const k of availableKeys) if (!keysToTry.includes(k)) keysToTry.push(k);
      }

      for (const k of keysToTry) {
        const res = decryptNodeKey(node.k, k, node.a, getCipher(k));
        if (res && res.attrs && res.attrs.n) {
          const name = res.attrs.n;
          const isFolder = node.t === 1;
          const folderAesKey = res.rawKey.length === 32
            ? unmergeKeyMac(res.rawKey).subarray(0, 16)
            : res.rawKey.subarray(0, 16);

          if (isFolder) {
            nodeKeyMap.set(node.h, folderAesKey);
            if (!availableKeys.includes(folderAesKey)) availableKeys.push(folderAesKey);
          }

          decryptedNodes.set(node.h, {
            node,
            h: node.h,
            p: node.p,
            name,
            rawKey: res.rawKey,
            isFolder,
            size: node.s || 0
          });

          changed = true;
          break;
        }
      }
    }
  }

  return decryptedNodes;
}

export function formatMegaFileTree(decryptedNodes) {
  const childrenMap = new Map();
  const rootNodes = [];

  for (const node of decryptedNodes.values()) {
    const parentId = node.p;
    if (!parentId || !decryptedNodes.has(parentId)) {
      rootNodes.push(node);
    } else {
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId).push(node);
    }
  }

  let output = "";
  let renderedCount = 0;
  const MAX_VISIBLE = 20;

  function printNode(nodeObj, prefix, isLast) {
    if (renderedCount >= MAX_VISIBLE) return;
    renderedCount++;

    const isFolder = nodeObj.isFolder;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    if (isFolder) {
      output += prefix + connector + nodeObj.name + "/\n";
      const children = childrenMap.get(nodeObj.h) || [];
      children.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
      for (let i = 0; i < children.length; i++) {
        printNode(children[i], childPrefix, i === children.length - 1);
      }
    } else {
      const sizeStr = nodeObj.size > 0 ? ` (${formatBytes(nodeObj.size)})` : "";
      output += prefix + connector + nodeObj.name + sizeStr + "\n";
    }
  }

  let headerName = "Mega Folder";
  let startNodes = rootNodes;
  if (rootNodes.length === 1 && rootNodes[0].isFolder) {
    headerName = rootNodes[0].name;
    startNodes = childrenMap.get(rootNodes[0].h) || [];
  }

  startNodes.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  for (let i = 0; i < startNodes.length; i++) {
    printNode(startNodes[i], "", i === startNodes.length - 1);
  }

  if (decryptedNodes.size > MAX_VISIBLE) {
    output += `\n... and ${decryptedNodes.size - MAX_VISIBLE} more files`;
  }

  return { headerName, tree: output };
}

export async function megaApiRequest(queryStr, bodyJson, signal, maxRetries = 3) {
  const directUrl = `https://g.api.mega.co.nz/cs?${queryStr}`;
  const proxyUrl = `${PROXY_URL}/mega/api?${queryStr}`;
  let lastData = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal && signal.aborted) throw new Error("Aborted");
    const targetUrl = attempt % 2 === 0 ? directUrl : proxyUrl;

    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyJson),
        signal
      });

      if (res.ok) {
        const data = await res.json();
        const errCode = Array.isArray(data) ? data[0] : data;

        if (errCode === -3) {
          lastData = data;
          if (attempt < maxRetries) {
            const delay = Math.min(2000, 350 * Math.pow(2, attempt));
            console.warn(`[Mega] Received -3 (EAGAIN), retrying in ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        } else {
          return data;
        }
      }
    } catch (e) {
      if (signal && signal.aborted) throw e;
      console.warn(`[Mega] API attempt ${attempt + 1} to ${targetUrl} failed:`, e.message);
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  if (lastData) return lastData;
  throw new Error("Mega API request failed after retries");
}

export async function fetchMegaStorageStream(dlUrl, signal) {
  try {
    const res = await fetch(dlUrl, { signal });
    if (res.ok) return res;
  } catch (e) {
    if (signal && signal.aborted) throw e;
  }
  const res = await fetch(`${PROXY_URL}/proxy?url=${encodeURIComponent(dlUrl)}`, { signal });
  if (!res.ok) throw new Error(`Failed to download Mega file (HTTP ${res.status})`);
  return res;
}

function decryptMegaInWorker(dlUrl, proxyUrl, rawNodeKey, totalBytes, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const workerScript = `
      self.importScripts('https://cdn.jsdelivr.net/npm/aes-js@3.1.2/index.min.js');

      function unmergeKeyMac(key) {
        const k = new Uint8Array(32);
        k.set(key);
        for (let i = 0; i < 16; i++) {
          k[i] = key[i] ^ key[16 + i];
        }
        return k;
      }

      self.onmessage = async function(e) {
        const { dlUrl, proxyUrl, rawKeyBytes, totalBytes } = e.data;
        try {
          let res;
          try {
            res = await fetch(dlUrl);
            if (!res.ok) throw new Error("Direct download failed");
          } catch (_) {
            res = await fetch(proxyUrl);
          }
          if (!res.ok) throw new Error("Download failed: HTTP " + res.status);

          const rawNodeKey = new Uint8Array(rawKeyBytes);
          const fileKey = unmergeKeyMac(rawNodeKey).subarray(0, 16);
          const counterBytes = new Uint8Array(16);
          counterBytes.set(rawNodeKey.subarray(16, 24), 0);

          const counter = new self.aesjs.Counter(counterBytes);
          const aesCtr = new self.aesjs.ModeOfOperation.ctr(Array.from(fileKey), counter);

          const reader = res.body.getReader();
          const decChunks = [];
          let received = 0;
          let lastProgress = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const decChunk = aesCtr.decrypt(value);
            decChunks.push(decChunk);
            received += value.length;

            const now = performance.now();
            if (now - lastProgress > 100 || received === totalBytes) {
              lastProgress = now;
              self.postMessage({ type: 'progress', loaded: received, total: totalBytes || received });
            }
          }

          const fullDec = new Uint8Array(received);
          let offset = 0;
          for (const c of decChunks) {
            fullDec.set(c, offset);
            offset += c.length;
          }

          self.postMessage({ type: 'done', buffer: fullDec.buffer }, [fullDec.buffer]);
        } catch (err) {
          self.postMessage({ type: 'error', message: err.message });
        }
      };
    `;

    const blob = new Blob([workerScript], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        return reject(new DOMException("Aborted", "AbortError"));
      }
      signal.addEventListener("abort", () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      });
    }

    worker.onmessage = (e) => {
      const data = e.data;
      if (data.type === "progress") {
        if (onProgress) onProgress(data.loaded, data.total);
      } else if (data.type === "done") {
        cleanup();
        resolve(data.buffer);
      } else if (data.type === "error") {
        cleanup();
        reject(new Error(data.message || "Decryption failed"));
      }
    };

    worker.onerror = (err) => {
      cleanup();
      reject(err);
    };

    worker.postMessage({
      dlUrl,
      proxyUrl,
      rawKeyBytes: Array.from(rawNodeKey),
      totalBytes
    });
  });
}

export async function downloadAndDecryptMegaPayload(dlUrl, rawNodeKey, filename, onProgress, signal) {
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    const fileRes = await fetchMegaStorageStream(dlUrl, signal);
    const totalBytes = parseInt(fileRes.headers.get("content-length") || "0", 10);
    const fileKey = unmergeKeyMac(rawNodeKey).subarray(0, 16);
    const counterBytes = new Uint8Array(16);
    counterBytes.set(rawNodeKey.subarray(16, 24), 0);

    const reader = fileRes.body.getReader();
    const chunks = [];
    let received = 0;
    let lastProgressTime = 0;

    while (true) {
      if (signal && signal.aborted) throw new Error("Aborted");
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      const now = performance.now();
      if (onProgress && totalBytes > 0 && (now - lastProgressTime > 80 || received === totalBytes)) {
        lastProgressTime = now;
        onProgress(received, totalBytes);
      }
    }

    const fullEnc = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      fullEnc.set(c, offset);
      offset += c.length;
    }

    const cryptoKey = await window.crypto.subtle.importKey(
      "raw",
      fileKey,
      { name: "AES-CTR" },
      false,
      ["decrypt"]
    );
    const decBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-CTR", counter: counterBytes, length: 64 },
      cryptoKey,
      fullEnc
    );
    return new Blob([decBuffer], { type: getMimeType(filename) });
  }

  const proxyUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(dlUrl)}`;
  const decBuffer = await decryptMegaInWorker(dlUrl, proxyUrl, rawNodeKey, 0, onProgress, signal);
  return new Blob([decBuffer], { type: getMimeType(filename) });
}

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
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

export function isImageOrVideo(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  return ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "mp4", "webm"].includes(ext);
}

export function isMegaUrl(url) {
  return /https?:\/\/(?:www\.)?mega\.(?:nz|co\.nz)\/(?:folder\/[a-zA-Z0-9_-]+#[a-zA-Z0-9_-]+|file\/[a-zA-Z0-9_-]+#[a-zA-Z0-9_-]+|#F![a-zA-Z0-9_-]+![a-zA-Z0-9_-]+|#![a-zA-Z0-9_-]+![a-zA-Z0-9_-]+)/i.test(url);
}

export function isDropboxUrl(url) {
  return /https?:\/\/(?:www\.)?dropbox\.com\/(?:s|scl|sh)\/[^\s<>"'\)]+/i.test(url);
}

function cleanUrl(url) {
  return url.replace(/[\.,\);>]+$/, "").trim();
}

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

  const text = contentHtml.replace(/<[^>]+>/g, " ");
  const urlRegex = /(https?:\/\/[^\s<>"'\)]+)/gi;
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

export function parseMegaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const folderMatch = url.pathname.match(/\/folder\/([a-zA-Z0-9_-]+)/);
    if (folderMatch && url.hash) {
      const key = url.hash.substring(1).split("/")[0];
      return { type: "folder", id: folderMatch[1], key };
    }
    const fileMatch = url.pathname.match(/\/file\/([a-zA-Z0-9_-]+)/);
    if (fileMatch && url.hash) {
      const key = url.hash.substring(1).split("/")[0];
      return { type: "file", id: fileMatch[1], key };
    }
    if (url.hash.startsWith("#F!")) {
      const parts = url.hash.split("!");
      return { type: "folder", id: parts[1], key: parts[2] };
    }
    if (url.hash.startsWith("#!")) {
      const parts = url.hash.split("!");
      return { type: "file", id: parts[1], key: parts[2] };
    }
  } catch (e) {}
  return null;
}

export function renderExternalFileCard(item, type) {
  const url = item.dataset.url;
  const postTitle = item.dataset.postTitle || (type === "mega" ? "Mega Gallery" : "Dropbox Gallery");
  const filename = item.dataset.originalName || (type === "mega" ? "Mega Archive" : "Dropbox Archive");

  const progressOverlay = item.querySelector(".media-progress");
  const scanController = new AbortController();
  item._abortController = scanController;
  const signal = scanController.signal;

  if (type === "dropbox") {
    const isFolder = url.includes("/sh/") || url.includes("/scl/fo/");
    const ext = url.split("?")[0].split(".").pop().toLowerCase();
    const isImage = ["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(ext);
    const isVideo = ["mp4", "webm", "mov"].includes(ext);

    if (!isFolder && (isImage || isVideo)) {
      const directUrl = `${PROXY_URL}/dropbox?url=${encodeURIComponent(url)}`;
      if (progressOverlay) {
        progressOverlay.style.display = "flex";
        progressOverlay.innerHTML = "Loading media...";
      }
      if (isVideo) {
        const video = document.createElement("video");
        video.className = "post-media";
        video.src = directUrl;
        video.controls = true;
        video.playsInline = true;
        video.addEventListener("canplay", () => {
          if (progressOverlay) progressOverlay.style.display = "none";
          syncCarouselClones(item);
        });
        item.appendChild(video);
        playbackObserver.observe(video);
      } else {
        const img = document.createElement("img");
        img.className = "post-media";
        img.src = directUrl;
        img.onload = () => {
          if (progressOverlay) progressOverlay.style.display = "none";
          syncCarouselClones(item);
        };
        img.onerror = () => {
          if (progressOverlay) showMediaUnavailableWarning(progressOverlay, "image");
        };
        item.appendChild(img);
      }
      return;
    }

    if (progressOverlay) progressOverlay.style.display = "none";
    renderArchiveCardUI(item, url, "dropbox", postTitle, filename, signal);
    return;
  }

  const parsed = parseMegaUrl(url);
  if (!parsed) {
    if (progressOverlay) showMediaUnavailableWarning(progressOverlay, "zip");
    return;
  }

  if (parsed.type === "file") {
    handleMegaSingleFileEmbed(item, parsed, progressOverlay, postTitle, filename, signal);
    return;
  }

  handleMegaFolderEmbed(item, parsed, progressOverlay, postTitle, filename, signal);
}

async function handleMegaSingleFileEmbed(item, parsed, progressOverlay, postTitle, fallbackName, signal) {
  try {
    const blobKey = parsed.id + "#" + parsed.key;
    if (megaBlobCache.has(blobKey)) {
      const blob = megaBlobCache.get(blobKey);
      const isVideo = blob.type.startsWith("video/");
      attachMedia(item, blob, isVideo ? "video" : "image");
      if (progressOverlay) progressOverlay.style.display = "none";
      syncCarouselClones(item);
      return;
    }

    if (progressOverlay) {
      progressOverlay.style.display = "flex";
      progressOverlay.innerHTML = "Fetching Mega file info...";
    }

    const data = await megaApiRequest(`id=${Date.now()}`, [{ a: "g", g: 1, ssl: 2, p: parsed.id }], signal);
    const megaErrCode = Array.isArray(data) ? data[0] : data;
    if (typeof megaErrCode === "number" && megaErrCode < 0) {
      throw new Error(`Mega error ${megaErrCode}`);
    }
    if (!Array.isArray(data) || !data[0] || !data[0].g) {
      throw new Error("Mega file unavailable");
    }

    const downloadUrl = data[0].g;
    const rawKey = base64urlToBytes(parsed.key);
    let filename = fallbackName;
    if (data[0].at) {
      const attrs = decryptAttributes(data[0].at, rawKey);
      if (attrs && attrs.n) filename = attrs.n;
    }

    const isVideo = ["mp4", "webm"].includes(filename.split(".").pop().toLowerCase());
    const isImage = isImageOrVideo(filename) && !isVideo;

    if (isImage || isVideo) {
      if (progressOverlay) {
        progressOverlay.innerHTML = `Downloading ${filename}... 0%`;
      }
      const blob = await downloadAndDecryptMegaPayload(
        downloadUrl,
        rawKey,
        filename,
        (loaded, total) => {
          if (progressOverlay && total > 0) {
            const pct = Math.round((loaded / total) * 100);
            progressOverlay.innerHTML = `Loading ${filename}... ${pct}%<br><span style="font-size:0.85rem; color:#aaa">${formatBytes(loaded)} / ${formatBytes(total)}</span>`;
          }
        },
        signal
      );
      if (signal.aborted) return;
      megaBlobCache.set(blobKey, blob);
      attachMedia(item, blob, isVideo ? "video" : "image");
      if (progressOverlay) progressOverlay.style.display = "none";
      syncCarouselClones(item);
    } else {
      if (progressOverlay) progressOverlay.style.display = "none";
      const sizeStr = data[0].s ? formatBytes(data[0].s) : "";
      renderArchiveCardUI(item, item.dataset.url, "mega", postTitle, filename, signal, {
        totalSize: data[0].s || 0,
        fileCount: 1,
        tree: `└── ${filename} (${sizeStr})`
      });
    }
  } catch (err) {
    if (signal.aborted) return;
    console.error("[Mega] handleMegaSingleFileEmbed error:", err);
    if (progressOverlay) {
      progressOverlay.innerHTML = `Unavailable<br><span style="font-size:0.8rem; color:#ff6b6b">${err.message || "Failed to load"}</span>`;
    }
  }
}

async function handleMegaFolderEmbed(item, parsed, progressOverlay, postTitle, fallbackName, signal) {
  try {
    const cacheKey = parsed.id + "#" + parsed.key;

    if (megaFolderCache.has(cacheKey)) {
      const cached = megaFolderCache.get(cacheKey);
      if (progressOverlay) progressOverlay.style.display = "none";
      if (cached.singleFile) {
        const singleFile = cached.singleFile;
        const isVideo = ["mp4", "webm"].includes(singleFile.name.split(".").pop().toLowerCase());
        const blobKey = parsed.id + "/" + singleFile.node.h;
        if (megaBlobCache.has(blobKey)) {
          attachMedia(item, megaBlobCache.get(blobKey), isVideo ? "video" : "image");
          syncCarouselClones(item);
          return;
        }
      } else {
        renderArchiveCardUI(item, item.dataset.url, "mega", postTitle, cached.archiveName, signal, cached.details);
        return;
      }
    }

    if (progressOverlay) {
      progressOverlay.style.display = "flex";
      progressOverlay.innerHTML = "Fetching folder contents...";
    }

    const folderKeyBytes = base64urlToBytes(parsed.key);
    const data = await megaApiRequest(`id=${Date.now()}&n=${parsed.id}`, [{ a: "f", c: 1, r: 1 }], signal);

    const megaErrCode = Array.isArray(data) ? data[0] : data;
    if (typeof megaErrCode === "number" && megaErrCode < 0) {
      const MEGA_ERRORS = {
        "-2": "Invalid folder ID / arguments",
        "-3": "Mega server temporarily congested — please try again",
        "-9": "Folder not found or link has expired",
        "-11": "Access denied",
        "-16": "Decryption key mismatch",
        "-18": "Blocked by Mega",
        "-509": "Bandwidth quota exceeded — try again later"
      };
      throw new Error(`Mega error ${megaErrCode}: ${MEGA_ERRORS[String(megaErrCode)] || "Temporary Mega issue"}`);
    }
    if (!Array.isArray(data) || !data[0] || !data[0].f) {
      throw new Error("Invalid Mega folder response");
    }

    const decryptedNodes = await decryptAllMegaNodes(data[0].f, folderKeyBytes);

    const mediaFiles = [];
    for (const n of decryptedNodes.values()) {
      if (!n.isFolder && isImageOrVideo(n.name)) {
        mediaFiles.push(n);
      }
    }

    const { headerName, tree } = formatMegaFileTree(decryptedNodes);
    let totalSize = 0;
    for (const n of decryptedNodes.values()) {
      if (!n.isFolder) totalSize += (n.size || 0);
    }
    const archiveName = headerName || fallbackName || "Mega Archive";

    megaFolderCache.set(cacheKey, {
      decryptedNodes,
      archiveName,
      details: {
        totalSize,
        fileCount: mediaFiles.length || decryptedNodes.size,
        tree
      },
      mediaFiles,
      singleFile: mediaFiles.length === 1 ? mediaFiles[0] : null
    });

    if (mediaFiles.length === 1) {
      const singleFile = mediaFiles[0];
      const isVideo = ["mp4", "webm"].includes(singleFile.name.split(".").pop().toLowerCase());
      const blobKey = parsed.id + "/" + singleFile.node.h;

      if (megaBlobCache.has(blobKey)) {
        attachMedia(item, megaBlobCache.get(blobKey), isVideo ? "video" : "image");
        if (progressOverlay) progressOverlay.style.display = "none";
        syncCarouselClones(item);
        return;
      }

      if (progressOverlay) {
        progressOverlay.innerHTML = `Downloading ${singleFile.name}... 0%`;
      }

      const dlRes = await megaApiRequest(`id=${Date.now()}&n=${parsed.id}`, [{ a: "g", g: 1, ssl: 2, n: singleFile.node.h }], signal);
      const dlUrl = dlRes[0]?.g;
      if (!dlUrl) throw new Error("Failed to get download URL from Mega");

      const blob = await downloadAndDecryptMegaPayload(
        dlUrl,
        singleFile.rawKey,
        singleFile.name,
        (loaded, total) => {
          if (progressOverlay && total > 0) {
            const pct = Math.round((loaded / total) * 100);
            progressOverlay.innerHTML = `Loading ${singleFile.name}... ${pct}%<br><span style="font-size:0.85rem; color:#aaa">${formatBytes(loaded)} / ${formatBytes(total)}</span>`;
          }
        },
        signal
      );

      if (signal.aborted) return;
      megaBlobCache.set(blobKey, blob);
      attachMedia(item, blob, isVideo ? "video" : "image");
      if (progressOverlay) progressOverlay.style.display = "none";
      syncCarouselClones(item);
      return;
    }

    if (progressOverlay) progressOverlay.style.display = "none";

    renderArchiveCardUI(item, item.dataset.url, "mega", postTitle, archiveName, signal, {
      totalSize,
      fileCount: mediaFiles.length || decryptedNodes.size,
      tree
    });

  } catch (err) {
    if (signal.aborted) return;
    console.error("[Mega] handleMegaFolderEmbed error:", err);
    if (progressOverlay) {
      progressOverlay.innerHTML = `Unavailable<br><span style="font-size:0.8rem; color:#ff6b6b">${err.message || "Failed to load"}</span>`;
    }
  }
}

function renderArchiveCardUI(item, url, type, postTitle, archiveName, signal, details) {
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
  infoText.style.color = "#fff";
  infoText.style.fontFamily = "monospace";
  infoText.style.whiteSpace = "pre-wrap";
  infoText.style.background = "rgba(0,0,0,0.5)";
  infoText.style.padding = "15px";
  infoText.style.borderRadius = "10px";
  infoText.style.marginBottom = "20px";
  infoText.style.maxWidth = "100%";
  infoText.style.overflow = "auto";
  infoText.style.maxHeight = "40%";
  infoText.className = "zip-info-text";
  infoText.style.fontSize = "0.9rem";
  infoText.style.textAlign = "left";

  if (details) {
    const sizeStr = details.totalSize > 0 ? `${formatBytes(details.totalSize)}, ` : "";
    const headerInfo = `${sizeStr}${details.fileCount} files`;
    infoText.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:8px;">${iconSvg} <span>${headerInfo}</span></div><div style="font-weight:bold;margin-bottom:8px;text-align:center;">${escapeHtml(archiveName)}</div><div style="white-space:pre-wrap;font-family:monospace;">${escapeHtml(details.tree || details.treeHtml || "")}</div>`;
  } else {
    infoText.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:8px;">${iconSvg} <span>${escapeHtml(archiveName)}</span></div><br>(Click View Gallery to open archive)`;
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
    if (isMega) {
      openMegaGallery(url, archiveName || postTitle);
    } else {
      openDropboxGallery(url, archiveName || postTitle);
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

export async function openMegaGallery(megaUrl, galleryTitle) {
  abortExternalGallery();
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  if (state.currentZipObjectUrls && state.currentZipObjectUrls.length > 0) {
    state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.currentZipObjectUrls = [];
  }

  setZipNavVisible(false, true);
  if (zipViewer) zipViewer.classList.remove("hidden");
  if (zipTitle) zipTitle.textContent = galleryTitle || "Mega Gallery";
  if (zipIndicator) zipIndicator.textContent = "";
  if (zipContent) {
    zipContent.innerHTML = '<div id="zip-progress-text" style="color:white; margin: auto; text-align: center;">Connecting to Mega...</div>';
  }

  try {
    const parsed = parseMegaUrl(megaUrl);
    if (!parsed) throw new Error("Invalid Mega URL format");

    if (parsed.type === "file") {
      await handleSingleMegaFile(parsed, galleryTitle, signal);
      return;
    }

    const cacheKey = parsed.id + "#" + parsed.key;
    let decryptedNodes = null;
    let headerName = null;

    if (megaFolderCache.has(cacheKey)) {
      const cached = megaFolderCache.get(cacheKey);
      decryptedNodes = cached.decryptedNodes;
      headerName = cached.archiveName;
    } else {
      const folderKeyBytes = base64urlToBytes(parsed.key);
      const progressText = document.getElementById("zip-progress-text");
      if (progressText) progressText.innerHTML = "Fetching folder index...";

      const data = await megaApiRequest(`id=${Date.now()}&n=${parsed.id}`, [{ a: "f", c: 1, r: 1 }], signal);

      const megaErrCode = Array.isArray(data) ? data[0] : data;
      if (typeof megaErrCode === "number" && megaErrCode < 0) {
        const MEGA_ERRORS = {
          "-2": "Bad arguments / invalid folder ID",
          "-3": "Mega server temporarily congested — please try again",
          "-9": "Folder not found or link has expired",
          "-16": "Decryption key mismatch",
          "-18": "Mega blocked this request",
          "-509": "Mega bandwidth quota exceeded — try again later"
        };
        throw new Error(`Mega error ${megaErrCode}: ${MEGA_ERRORS[String(megaErrCode)] || "Unknown Mega error"}`);
      }

      if (!Array.isArray(data) || !data[0] || !data[0].f) {
        throw new Error("Unexpected Mega folder response");
      }

      if (progressText) progressText.innerHTML = "Decrypting folder index...";

      decryptedNodes = await decryptAllMegaNodes(data[0].f, folderKeyBytes);
      const treeRes = formatMegaFileTree(decryptedNodes);
      headerName = treeRes.headerName;
    }

    const validFiles = [];
    for (const n of decryptedNodes.values()) {
      if (!n.isFolder && isImageOrVideo(n.name)) {
        validFiles.push({
          node: n.node,
          name: n.name,
          rawKey: n.rawKey,
          size: n.size || 0,
          cachedDlUrl: null
        });
      }
    }

    validFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    if (validFiles.length === 0) {
      if (zipContent) {
        zipContent.innerHTML = '<div style="color:white; margin: auto; text-align: center; padding: 1rem;">No supported images or videos found in this Mega folder.</div>';
      }
      return;
    }

    if (!headerName) {
      const treeRes = formatMegaFileTree(decryptedNodes);
      headerName = treeRes.headerName;
    }
    if (zipTitle) zipTitle.textContent = headerName || galleryTitle || "Mega Gallery";

    if (zipContent) zipContent.innerHTML = "";
    if (zipIndicator) zipIndicator.textContent = `1 / ${validFiles.length}`;

    const prefetchBatch = validFiles.slice(0, 25).map((f) => ({ a: "g", g: 1, ssl: 2, n: f.node.h }));
    megaApiRequest(`id=${Date.now()}&n=${parsed.id}`, prefetchBatch, signal)
      .then((batchRes) => {
        if (Array.isArray(batchRes)) {
          batchRes.forEach((resItem, idx) => {
            if (resItem && resItem.g && validFiles[idx]) {
              validFiles[idx].cachedDlUrl = resItem.g;
            }
          });
        }
      })
      .catch(() => {});

    renderMegaCarousel(validFiles, parsed.id, signal);

  } catch (err) {
    if (signal.aborted) return;
    console.error("Mega Gallery Error:", err);
    if (zipTitle) zipTitle.textContent = "Mega — Error";
    if (zipIndicator) zipIndicator.textContent = "";
    if (zipContent) {
      zipContent.innerHTML = `<div style="color:white; margin: auto; text-align: center; padding: 1rem;">
        <div style="color:#ff6b6b; font-size:1.1rem; margin-bottom:0.5rem;">⚠ Mega Gallery Failed</div>
        <div style="color:#ccc; font-size:0.9rem;">${err.message || "Unknown error"}</div>
        <div style="color:#888; font-size:0.8rem; margin-top:0.5rem;">See browser console for details</div>
      </div>`;
    }
  }
}

async function handleSingleMegaFile(parsed, title, signal) {
  const progressText = document.getElementById("zip-progress-text");
  if (progressText) progressText.innerHTML = "Fetching Mega file info...";

  const rawKey = base64urlToBytes(parsed.key);

  const data = await megaApiRequest(`id=${Date.now()}`, [{ a: "g", g: 1, ssl: 2, p: parsed.id }], signal);

  const megaErrCode = Array.isArray(data) ? data[0] : data;
  if (typeof megaErrCode === "number" && megaErrCode < 0) {
    const MEGA_ERRORS = {
      "-2": "Invalid file ID",
      "-9": "File not found or link has expired",
      "-16": "Decryption key mismatch",
      "-18": "Mega blocked this request",
      "-509": "Mega bandwidth quota exceeded — try again later"
    };
    throw new Error(`Mega error ${megaErrCode}: ${MEGA_ERRORS[String(megaErrCode)] || "Unknown Mega error"}`);
  }

  if (!Array.isArray(data) || !data[0] || !data[0].g) {
    throw new Error("Mega file unavailable or rate limited");
  }

  const downloadUrl = data[0].g;
  let filename = "mega_file";
  if (data[0].at) {
    const attrs = decryptAttributes(data[0].at, rawKey);
    if (attrs && attrs.n) filename = attrs.n;
  }

  if (zipTitle) zipTitle.textContent = filename;
  if (zipIndicator) zipIndicator.textContent = "1 / 1";
  if (zipContent) zipContent.dataset.mediaCount = "1";

  const blob = await downloadAndDecryptMegaPayload(
    downloadUrl,
    rawKey,
    filename,
    (loaded, total) => {
      if (progressText) {
        const pct = Math.round((loaded / total) * 100);
        progressText.innerHTML = `Downloading & decrypting... ${pct}%<br><span style="font-size:0.85rem; color:#aaa">${formatBytes(loaded)} / ${formatBytes(total)}</span>`;
      }
    },
    signal
  );

  const blobUrl = URL.createObjectURL(blob);
  state.currentZipObjectUrls.push(blobUrl);

  if (zipContent) zipContent.innerHTML = "";
  const container = document.createElement("div");
  container.style.flex = "0 0 100vw";
  container.style.height = "100%";
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.justifyContent = "center";

  const ext = filename.split(".").pop().toLowerCase();
  if (["mp4", "webm"].includes(ext)) {
    const video = document.createElement("video");
    video.src = blobUrl;
    video.controls = true;
    video.playsInline = true;
    video.style.maxWidth = "100%";
    video.style.maxHeight = "100%";
    video.style.objectFit = "contain";
    container.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = blobUrl;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.objectFit = "contain";
    container.appendChild(img);
  }
  if (zipContent) zipContent.appendChild(container);
}

function renderMegaCarousel(files, folderId, signal) {
  const fileDataMap = new Map();
  const cachedBlobs = new Map();

  files.forEach((f) => fileDataMap.set(f.node.h, f));

  if (window.zipMediaObserver) window.zipMediaObserver.disconnect();

  const pCount = Math.max(1, window.pawPreloadCount || 1);
  window.zipMediaObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const target = entry.target;
          const fileId = target.dataset.fileId;
          if (fileId && !target.dataset.loaded && !target.dataset.loading) {
            loadAndDisplayMegaItem(target, fileDataMap.get(fileId), folderId, cachedBlobs, signal);
          }
        }
      });
    },
    {
      root: zipContent,
      rootMargin: `0px ${pCount * 100}%`
    }
  );

  files.forEach((file) => {
    const itemContainer = createMegaItemContainer(file);
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

    zipContent.insertBefore(cloneLast, firstChild);
    zipContent.appendChild(cloneFirst);

    window.zipMediaObserver.observe(cloneFirst);
    window.zipMediaObserver.observe(cloneLast);

    void zipContent.offsetHeight;

    const itemWidth = zipContent.clientWidth || window.innerWidth;
    zipContent.style.scrollSnapType = "none";
    zipContent.scrollLeft = itemWidth;

    setTimeout(() => {
      zipContent.style.scrollSnapType = "";
    }, 50);
  }
}

function createMegaItemContainer(file) {
  const container = document.createElement("div");
  container.className = "media-item";
  container.dataset.fileId = file.node.h;
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
  overlay.innerHTML = `Loading...<br><span style="font-size:0.9rem; font-weight:normal; color:#ccc">${file.name} (${formatBytes(file.size)})</span>`;
  container.appendChild(overlay);

  const img = document.createElement("img");
  img.style.maxWidth = "100%";
  img.style.maxHeight = "100%";
  img.style.objectFit = "contain";
  img.style.display = "none";
  img.decoding = "async";
  container.appendChild(img);

  return container;
}

async function loadAndDisplayMegaItem(container, file, folderId, cachedBlobs, signal) {
  if (!file || container.dataset.loading === "true") return;
  container.dataset.loading = "true";

  const overlay = container.querySelector(".media-progress");

  try {
    let blobUrl = cachedBlobs.get(file.node.h);
    const globalBlobKey = folderId + "/" + file.node.h;

    if (!blobUrl && megaBlobCache.has(globalBlobKey)) {
      const b = megaBlobCache.get(globalBlobKey);
      blobUrl = URL.createObjectURL(b);
      state.currentZipObjectUrls.push(blobUrl);
      cachedBlobs.set(file.node.h, blobUrl);
    }

    if (!blobUrl) {
      if (overlay) overlay.innerHTML = `Connecting to Mega...<br><span style="font-size:0.85rem; color:#ccc">${file.name}</span>`;

      let dlUrl = file.cachedDlUrl;
      if (!dlUrl) {
        const data = await megaApiRequest(`id=${Date.now()}&n=${folderId}`, [{ a: "g", g: 1, ssl: 2, n: file.node.h }], signal);
        const megaErr = Array.isArray(data) ? data[0] : data;
        if (typeof megaErr === "number" && megaErr < 0) {
          throw new Error(`Mega error ${megaErr}`);
        }
        dlUrl = data[0]?.g;
      }

      if (!dlUrl) throw new Error("Mega did not return a download URL");

      const blob = await downloadAndDecryptMegaPayload(
        dlUrl,
        file.rawKey,
        file.name,
        (loaded, total) => {
          if (overlay) {
            const pct = Math.round((loaded / total) * 100);
            overlay.innerHTML = `Downloading... ${pct}%<br><span style="font-size:0.8rem; color:#ccc">${file.name} (${formatBytes(loaded)} / ${formatBytes(total)})</span>`;
          }
        },
        signal
      );

      megaBlobCache.set(globalBlobKey, blob);
      blobUrl = URL.createObjectURL(blob);
      state.currentZipObjectUrls.push(blobUrl);
      cachedBlobs.set(file.node.h, blobUrl);
    }

    container.dataset.loaded = "true";
    container.dataset.loading = "false";
    if (overlay) overlay.style.display = "none";

    const isVideo = ["mp4", "webm"].includes(file.name.split(".").pop().toLowerCase());

    const allMatchingContainers = zipContent ? zipContent.querySelectorAll(`[data-file-id="${file.node.h}"]`) : [container];
    allMatchingContainers.forEach((c) => {
      c.dataset.loaded = "true";
      c.dataset.loading = "false";
      const o = c.querySelector(".media-progress");
      if (o) o.style.display = "none";

      if (isVideo) {
        let vid = c.querySelector("video");
        if (!vid) {
          vid = document.createElement("video");
          vid.controls = true;
          vid.playsInline = true;
          vid.style.maxWidth = "100%";
          vid.style.maxHeight = "100%";
          vid.style.objectFit = "contain";
          c.appendChild(vid);
        }
        vid.src = blobUrl;
      } else {
        const image = c.querySelector("img");
        if (image) {
          image.src = blobUrl;
          image.style.display = "block";
          if (image.decode) image.decode().catch(() => {});
        }
      }
    });

  } catch (err) {
    if (signal.aborted) return;
    console.error(`Failed to load Mega file ${file.name}:`, err);
    container.dataset.loading = "false";
    if (overlay) {
      overlay.innerHTML = `Unavailable<br><span style="font-size:0.8rem; color:#ff6b6b">${err.message || "Failed to load"}</span>`;
    }
  }
}

export async function openDropboxGallery(dropboxUrl, galleryTitle) {
  abortExternalGallery();
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  if (state.currentZipObjectUrls && state.currentZipObjectUrls.length > 0) {
    state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.currentZipObjectUrls = [];
  }

  setZipNavVisible(false, true);
  if (zipViewer) zipViewer.classList.remove("hidden");
  if (zipTitle) zipTitle.textContent = galleryTitle || "Dropbox Gallery";
  if (zipIndicator) zipIndicator.textContent = "";
  if (zipContent) {
    zipContent.innerHTML = '<div id="zip-progress-text" style="color:white; margin: auto; text-align: center;">Connecting to Dropbox...</div>';
  }

  const isFolder = dropboxUrl.includes("/sh/") || dropboxUrl.includes("/scl/fo/");

  if (isFolder) {
    const proxyZipUrl = `${PROXY_URL}/dropbox?url=${encodeURIComponent(dropboxUrl)}`;
    await openZipGallery(proxyZipUrl, galleryTitle || "Dropbox Archive");
    return;
  }

  if (zipContent) zipContent.innerHTML = "";
  const container = document.createElement("div");
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
    video.controls = true;
    video.playsInline = true;
    video.style.maxWidth = "100%";
    video.style.maxHeight = "100%";
    video.style.objectFit = "contain";
    container.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = directUrl;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.objectFit = "contain";
    container.appendChild(img);
  }
  if (zipContent) zipContent.appendChild(container);
}
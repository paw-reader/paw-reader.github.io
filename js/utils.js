import { PROXY_URL, state } from "./state.js";

export function showMediaUnavailableWarning(container, type = "media") {
  if (!container) return;
  container.style.display = "flex";
  const displayNames = { pawchive: "Pawchive", kemono: "Kemono", cum: "Coomer" };
  const siteName = displayNames[state.currentSite] || state.currentSite;
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; gap: 10px; padding: 20px; text-align: center; background: rgba(0,0,0,0.5); border-radius: 12px; box-sizing: border-box;">
      <span style="color: #ffb86c; font-size: 2rem;">⚠️</span>
      <span style="color: #ffb86c; font-size: 1.2rem; font-weight: bold;">${type === "zip" ? "Archive" : "Media"} Unavailable</span>
      <span style="color: #ccc; font-size: 0.95rem; font-weight: normal; max-width: 250px; line-height: 1.4;">
        This file has not yet been imported to ${siteName}, or the server is busy/unavailable.
      </span>
    </div>
  `;
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function getServiceColor(service) {
  const s = (service || "").toLowerCase();
  if (s === "fanbox") return "#0096FA";
  if (s === "patreon") return "#F96854";
  if (s === "discord") return "#5865F2";
  if (s === "onlyfans") return "#00AEEF";
  if (s === "fansly") return "#2699F7";
  if (s === "subscribestar") return "#009688";
  if (s === "dlsite") return "#052A83";
  if (s === "gumroad") return "#FF90E8";
  if (s === "boosty") return "linear-gradient(to bottom, #EF7829, #EC5B2B)";
  if (s === "fantia") return "linear-gradient(to right, #8CC13F, #E1097F, #8D2680, #00A098, #383877, #F05B26)";
  return "#222";
}

export function getSiteDomain() {
  if (state.currentSite === "kemono") return "kemono.cr";
  if (state.currentSite === "cum") return "cum.st";
  return "pawchive.pw";
}

export function getServiceCreatorUrl(service, userId) {
  const domain = getSiteDomain();
  const s = encodeURIComponent((service || "").toLowerCase());
  const id = encodeURIComponent(userId || "");
  if (state.currentSite === "cum") {
    return `https://${domain}/creators/${s}/${id}`;
  }
  return `https://${domain}/${s}/user/${id}`;
}

export function getServicePostUrl(service, userId, postId) {
  const domain = getSiteDomain();
  const s = encodeURIComponent((service || "").toLowerCase());
  const uid = encodeURIComponent(userId || "");
  const pid = encodeURIComponent(postId || "");

  if (state.currentFeedEndpoint && state.currentFeedEndpoint.includes("fancards")) {
    if (state.currentSite === "cum") {
      return `https://${domain}/creators/${s}/${uid}?type=fancards`;
    }
    return `https://${domain}/${s}/user/${uid}/fancards`;
  }

  if (state.currentFeedEndpoint && state.currentFeedEndpoint.includes("/announcements")) {
    if (state.currentSite === "cum") {
      return `https://${domain}/creators/${s}/${uid}/announcements`;
    }
    return `https://${domain}/${s}/user/${uid}/announcements`;
  }

  if (state.currentFeedEndpoint && state.currentFeedEndpoint.includes("/dms")) {
    if (state.currentSite === "cum") {
      return `https://${domain}/creators/${s}/${uid}/dms`;
    }
    return `https://${domain}/${s}/user/${uid}/dms`;
  }

  if (postId) {
    if (state.currentSite === "cum") {
      return `https://${domain}/creators/${s}/${uid}/post/${pid}`;
    }
    return `https://${domain}/${s}/user/${uid}/post/${pid}`;
  }

  if (state.currentSite === "cum") {
    return `https://${domain}/creators/${s}/${uid}`;
  }
  return `https://${domain}/${s}/user/${uid}`;
}

export function getMediaUrl(path) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (state.currentSite === "kemono") {
    // Kemono's main CDN (n3) is currently down/dropping connections.
    // We use their thumbnail server as a fallback so images at least load!
    const ext = path.split(".").pop().toLowerCase();
    if (["mp4", "webm", "mov"].includes(ext)) {
      return `https://kemono.cr/data${path}`;
    }
    return `https://img.kemono.cr/thumbnail/data${path}`;
  } else if (state.currentSite === "cum") {
    return `https://e1.cum.st${path}`;
  }
  return `${PROXY_URL}/${state.currentSite}/file/data${path}`;
}

const topProgress = document.getElementById("top-progress");
export function startProgress() {
  if (topProgress) {
    topProgress.classList.remove("done");
    topProgress.classList.add("loading");
  }
}

export function stopProgress() {
  if (topProgress) {
    topProgress.classList.remove("loading");
    topProgress.classList.add("done");
  }
}

const DB_VERSION = 1;
const DB_NAME = "pawchive_downloads";
let _db;
export async function initDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore("chunks", { keyPath: "url" });
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getDbItem(url) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chunks", "readonly");
    const req = tx.objectStore("chunks").get(url);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setDbItem(url, chunks, contentType, totalSize) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").put({ url, chunks, contentType, totalSize, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteDbItem(url) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

import { PROXY_URL, state } from "./state.js";
import { openZipGallery, zipViewer, zipTitle, zipContent, zipIndicator, setZipNavVisible } from "./zip.js";
import { showMediaUnavailableWarning, renderMediaProgress, renderArchiveProgress } from "./utils.js";
import { syncCarouselClones, playbackObserver } from "./feed.js";
import { createExternalAbortSignal, renderArchiveCardUI } from "./externalGalleries.js";

/**
 * Checks if a URL points to a Dropbox file or folder share link.
 */
export function isDropboxUrl(url) {
  return /https?:\/\/(?:www\.)?dropbox\.com\/(?:s|scl|sh)\/[^\s<>"'\)]+/i.test(url);
}

/**
 * Handles embedding a Dropbox link inside a post card.
 * If it's a single image/video, streams it directly via the CORS proxy.
 * Otherwise, renders an interactive archive card to launch the fullscreen gallery.
 */
export function handleDropboxFileCard(item, url, postTitle, filename, progressOverlay, signal) {
  const isFolder = url.includes("/sh/") || url.includes("/scl/fo/");
  const ext = url.split("?")[0].split(".").pop().toLowerCase();
  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(ext);
  const isVideo = ["mp4", "webm", "mov"].includes(ext);

  if (!isFolder && (isImage || isVideo)) {
    const directUrl = `${PROXY_URL}/dropbox?url=${encodeURIComponent(url)}`;
    if (progressOverlay) {
      progressOverlay.style.display = "flex";
      renderMediaProgress(progressOverlay, "Loading...", 0, filename, "0 B", "...");
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
      video.controls = true;
      video.addEventListener("canplay", () => {
        if (progressOverlay) progressOverlay.style.display = "none";
        syncCarouselClones(item);
      });
      const triggerRetry = () => {
        item.querySelectorAll("video, audio, img.post-media").forEach((el) => el.remove());
        delete item.dataset.loaded;
        handleDropboxFileCard(item, url, postTitle, filename, progressOverlay, signal);
      };
      video.onerror = () => {
        if (progressOverlay) showMediaUnavailableWarning(progressOverlay, { type: "video", filename, errorStatus: "404", onRetry: triggerRetry });
      };
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
      const triggerRetry = () => {
        item.querySelectorAll("video, audio, img.post-media").forEach((el) => el.remove());
        delete item.dataset.loaded;
        handleDropboxFileCard(item, url, postTitle, filename, progressOverlay, signal);
      };
      img.onerror = () => {
        if (progressOverlay) showMediaUnavailableWarning(progressOverlay, { type: "image", filename, errorStatus: "404", onRetry: triggerRetry });
      };
      item.appendChild(img);
    }
    return;
  }

  if (progressOverlay) progressOverlay.style.display = "none";
  renderArchiveCardUI(item, url, "dropbox", postTitle, filename, signal);
}

/**
 * Opens a Dropbox share link in the fullscreen gallery viewer.
 * Folders are streamed and extracted as ZIP archives.
 * Single files are rendered directly with video/image players.
 */
export async function openDropboxGallery(dropboxUrl, galleryTitle) {
  const signal = createExternalAbortSignal();

  if (state.currentZipObjectUrls && state.currentZipObjectUrls.length > 0) {
    state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.currentZipObjectUrls = [];
  }

  setZipNavVisible(false, true);
  if (zipViewer) zipViewer.classList.remove("hidden");
  if (zipTitle) zipTitle.textContent = galleryTitle || "Dropbox Gallery";
  if (zipIndicator) zipIndicator.textContent = "";
  if (zipContent) {
    zipContent.innerHTML = '<div id="zip-progress-text"></div>';
    const pt = document.getElementById("zip-progress-text");
    renderArchiveProgress(pt, "Connecting...", null, galleryTitle || "Dropbox Gallery");
  }

  const isFolder = dropboxUrl.includes("/sh/") || dropboxUrl.includes("/scl/fo/");

  if (isFolder) {
    const proxyZipUrl = `${PROXY_URL}/dropbox?url=${encodeURIComponent(dropboxUrl)}`;
    await openZipGallery(proxyZipUrl, galleryTitle || "Dropbox Archive");
    return;
  }

  if (signal && signal.aborted) return;

  if (zipContent) zipContent.innerHTML = "";
  if (zipIndicator) zipIndicator.textContent = "1 / 1";
  if (zipContent) zipContent.dataset.mediaCount = "1";

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
    video.onerror = () => {
      if (zipContent) {
        zipContent.innerHTML = "";
        showMediaUnavailableWarning(zipContent, "video");
      }
    };
    container.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = directUrl;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.objectFit = "contain";
    img.onerror = () => {
      if (zipContent) {
        zipContent.innerHTML = "";
        showMediaUnavailableWarning(zipContent, "image");
      }
    };
    container.appendChild(img);
  }
  if (zipContent) zipContent.appendChild(container);
}

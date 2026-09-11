import { state } from "./state.js";
import { formatBytes, showMediaUnavailableWarning, renderArchiveProgress } from "./utils.js";
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

let activeZipAbortController = null;

export function closeZipGallery() {
  if (activeZipAbortController) {
    try { activeZipAbortController.abort(); } catch (_) {}
    activeZipAbortController = null;
  }
  abortExternalGallery();
  setZipNavVisible(false, true);
  if (zipViewer) zipViewer.classList.add("hidden");
  if (zipContent) {
    zipContent.innerHTML = "";
    delete zipContent.dataset.mediaCount;
  }
  if (zipIndicator) zipIndicator.textContent = "";
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

    const imageFiles = [];
    zip.forEach((relativePath, zipEntry) => {
      const ext = relativePath.split(".").pop().toLowerCase();
      if (!zipEntry.dir && ["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(ext)) {
        imageFiles.push(zipEntry);
      }
    });

    imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    if (imageFiles.length === 0) {
      if (zipIndicator) zipIndicator.textContent = "";
      if (zipContent)
        zipContent.innerHTML = '<div style="color:white; margin: auto;">No images found in this ZIP archive.</div>';
      return;
    }

    if (zipIndicator) zipIndicator.textContent = `1 / ${imageFiles.length}`;

    if (window.zipMediaObserver) window.zipMediaObserver.disconnect();
    
    const pCount = Math.max(1, window.pawPreloadCount || 1); 
    window.zipMediaObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target.querySelector("img");
          if (img && img.dataset.src) {
            const targetUrl = img.dataset.src;
            
            const clones = zipContent.querySelectorAll("img[data-src]");
            clones.forEach(clone => {
              if (clone.dataset.src === targetUrl) {
                clone.src = targetUrl;
                clone.removeAttribute("data-src");
                
                if (clone.decode) clone.decode().catch(()=>{});
              }
            });
          }
        }
      });
    }, { 
      root: zipContent, 
      rootMargin: `0px ${pCount * 100}%` 
    });

    for (const file of imageFiles) {
      const fileBlob = await file.async("blob");
      const objUrl = URL.createObjectURL(fileBlob);
      state.currentZipObjectUrls.push(objUrl);

      const imgContainer = document.createElement("div");
      imgContainer.style.flex = "0 0 100vw";
      imgContainer.style.height = "100%";
      imgContainer.style.scrollSnapAlign = "start";
      imgContainer.style.display = "flex";
      imgContainer.style.alignItems = "center";
      imgContainer.style.justifyContent = "center";
      imgContainer.style.position = "relative";

      const img = document.createElement("img");
      img.style.maxWidth = "100%";
      img.style.maxHeight = "100%";
      img.style.objectFit = "contain";
      img.decoding = "async"; 
      
      img.dataset.src = objUrl;

      imgContainer.appendChild(img);
      if (zipContent) zipContent.appendChild(imgContainer);
      
      window.zipMediaObserver.observe(imgContainer);
    }

    if (zipContent) zipContent.dataset.mediaCount = imageFiles.length;

    if (imageFiles.length > 1 && zipContent && zipContent.children.length > 1) {
      const firstChild = zipContent.children[0];
      const lastChild = zipContent.children[zipContent.children.length - 1];
      const cloneFirst = firstChild.cloneNode(true);
      const cloneLast = lastChild.cloneNode(true);
      
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
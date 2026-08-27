import { state } from "./state.js";
import { formatBytes, showMediaUnavailableWarning } from "./utils.js";
import { showView, welcomeScreen, navBack, updateNavTabs, wrapCarousel, settingsMenu } from "./nav.js";

export const zipViewer = document.getElementById("zip-viewer");
export const zipTitle = document.getElementById("zip-title");
export const zipContent = document.getElementById("zip-content");
export const zipIndicator = document.getElementById("zip-indicator");
export const closeZipViewer = document.getElementById("close-zip-viewer");
export const zipNav = document.getElementById("zip-nav");
export const zipHomeViewer = document.getElementById("zip-home-viewer");
export const zipSettingsViewer = document.getElementById("zip-settings-viewer");

let zipNavLastVisibleTime = 0;

export function isZipNavInteractive() {
  if (!zipNav || !zipNav.classList.contains("visible")) return false;
  if (Date.now() - zipNavLastVisibleTime < 400) return false;
  return true;
}

export function setZipNavVisible(visible, manual = false) {
  if (manual) {
    state.zipNavManualVisible = visible;
  }

  const isDesktop = window.innerWidth > 768;

  if (visible) {
    if (zipNav && !zipNav.classList.contains("visible")) {
      zipNavLastVisibleTime = Date.now();
      zipNav.classList.add("visible");
    }
    if (zipIndicator) {
      if (isDesktop) {
        zipIndicator.style.transform = "translateY(50px)"; 
      } else {
        zipIndicator.style.transform = "";
      }
    }
  } else {
    if (zipNav) zipNav.classList.remove("visible");
    if (zipIndicator) {
      if (isDesktop) {
        zipIndicator.style.transform = "translateY(0px)"; 
      } else {
        zipIndicator.style.transform = "";
      }
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
  if (state.currentZipObjectUrls && state.currentZipObjectUrls.length > 0) {
    state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.currentZipObjectUrls = [];
  }
  setZipNavVisible(false, true);
  if (zipViewer) zipViewer.classList.remove("hidden");
  if (zipTitle) zipTitle.textContent = filename;
  if (zipIndicator) zipIndicator.textContent = "";
  if (zipContent)
    zipContent.innerHTML =
      '<div id="zip-progress-text" style="color:white; margin: auto; text-align: center;">Connecting...</div>';

  try {
    let blob = cachedBlob;

    if (!blob) {
      const response = await fetch(zipUrl);
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
          progressText.innerHTML = `Downloading Archive...<br><br><span style="font-size:1.5rem">${percent}%</span><br><br>${formatBytes(loaded)} / ${formatBytes(total)}<br>${speed}`;
        } else if (progressText) {
          progressText.innerHTML = `Downloading Archive...<br><br>${formatBytes(loaded)} downloaded`;
        }
      }
      blob = new Blob(chunks);
    }

    const progressText = document.getElementById("zip-progress-text");
    if (progressText) progressText.innerHTML = "Extracting files...";

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
    console.error(err);
    if (zipTitle) zipTitle.textContent = "Error";
    if (zipIndicator) zipIndicator.textContent = "";
    if (zipContent) {
      zipContent.innerHTML = "";
      showMediaUnavailableWarning(zipContent, "zip");
    }
  }
}

export function preloadUpcomingZipMedia() {}
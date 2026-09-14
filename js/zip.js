import { state } from "./state.js";
import { formatBytes, showMediaUnavailableWarning, renderArchiveProgress, renderMediaProgress, escapeHtml } from "./utils.js";
import { showView, welcomeScreen, navBack, updateNavTabs, wrapCarousel, settingsMenu } from "./nav.js";
import { handleCarouselScrollSettled, smoothScroll, navigateCarousel, getCarouselMetrics, getCurrentGalleryPost } from "./feed.js";
import { abortExternalGallery } from "./externalGalleries.js";

export const zipViewer = document.getElementById("zip-viewer");
export const zipTitle = document.getElementById("zip-title");
export const zipContent = document.getElementById("zip-content");
export const zipIndicator = document.getElementById("zip-indicator");
export const closeZipViewer = document.getElementById("close-zip-viewer");
export const zipNav = document.getElementById("zip-nav");
export const zipNavTabs = document.getElementById("zip-nav-tabs");
export const zipHomeViewer = document.getElementById("zip-home-viewer");
export const zipSettingsViewer = document.getElementById("zip-settings-viewer");
export const zipInfoViewer = document.getElementById("zip-info-viewer");
export const zipFileInfoModal = document.getElementById("zip-file-info-modal");
export const closeZipFileInfo = document.getElementById("close-zip-file-info");

let activeZipAbortController = null;
let activeZipNavDropdown = null;

export function closeZipGallery() {
  if (activeZipAbortController) {
    try { activeZipAbortController.abort(); } catch (_) {}
    activeZipAbortController = null;
  }
  abortExternalGallery();
  closeZipNavDropdown();
  setZipNavVisible(false, true);

  const modal = document.getElementById("zip-file-info-modal");
  if (modal) modal.classList.remove("expanded");

  if (zipNavTabs) {
    zipNavTabs.innerHTML = "";
    zipNavTabs.classList.add("hidden");
    delete zipNavTabs.dataset.currentPath;
  }

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
  const scanBadge = document.getElementById("zip-bg-scan-badge");
  if (scanBadge) scanBadge.remove();
  if (window.zipMediaObserver) {
    window.zipMediaObserver.disconnect();
  }
  state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.currentZipObjectUrls = [];
  state.currentGalleryPost = null;
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
    closeZipNavDropdown();
    if (zipNav) {
      if (zipNav.classList.contains("visible")) {
        document.dispatchEvent(new CustomEvent("paw:navhidden"));
      }
      zipNav.classList.remove("visible");
    }
  }
}

export function updateZipNavVisibility(e) {
  const modal = document.getElementById("zip-file-info-modal");
  const isInfoExpanded = !!(modal && modal.classList.contains("expanded"));
  const isTop = e && e.clientY < 100;
  if (isTop || state.zipNavManualVisible || isInfoExpanded) {
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

    let activeRow = rows[0];
    let folderIdx = 0;
    let minDiffY = Infinity;
    const viewportMidY = window.innerHeight / 2;

    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      const rowCenterY = rect.top + rect.height / 2;
      const diffY = Math.abs(rowCenterY - viewportMidY);
      if (diffY < minDiffY) {
        minDiffY = diffY;
        activeRow = rows[i];
        folderIdx = i;
      }
    }

    const items = Array.from(activeRow.querySelectorAll(".media-item"));
    if (items.length === 0) return null;

    const nonClones = items.filter((i) => i.dataset.isClone !== "true");
    const count = nonClones.length || parseInt(activeRow.dataset.mediaCount, 10) || items.length;
    const pool = nonClones.length > 0 ? nonClones : items;

    // If activeRow has clones and scrollLeft is 0 (initial unaligned state), align it to slide 1
    if (activeRow.children.length > 2 && activeRow.scrollLeft === 0 && count > 1) {
      alignFolderRowToFirstSlide(activeRow, count);
    }

    let closestItem = pool[0];
    let minDiffX = Infinity;
    const viewportMidX = (window.innerWidth || zipContent?.clientWidth || 1024) / 2;

    for (let j = 0; j < items.length; j++) {
      const itemRect = items[j].getBoundingClientRect();
      const itemCenterX = itemRect.left + itemRect.width / 2;
      const diffX = Math.abs(itemCenterX - viewportMidX);
      if (diffX < minDiffX) {
        minDiffX = diffX;
        closestItem = items[j];
      }
    }

    let realIdx = 0;
    if (closestItem && closestItem.dataset.fileIdx !== undefined) {
      const parsedIdx = parseInt(closestItem.dataset.fileIdx, 10);
      if (!isNaN(parsedIdx) && parsedIdx >= 0) {
        if (closestItem.dataset.isClone === "true" && parsedIdx === count - 1 && activeRow.scrollLeft === 0) {
          realIdx = 0;
        } else {
          realIdx = parsedIdx;
        }
      }
    }
    const activeItem = pool[realIdx] || closestItem || pool[0];

    return {
      item: activeItem,
      folderRow: activeRow,
      folderIdx,
      totalFolders: rows.length,
      fileIdx: realIdx,
      totalFiles: count,
      folderName: activeRow.dataset.folderName || "",
      folderPath: activeRow.dataset.folderPath || activeRow.dataset.folderName || "",
      filename: activeItem?.dataset?.filename || ""
    };
  }

  // 1D Carousel
  const items = Array.from(zipContent.querySelectorAll(".media-item"));
  if (items.length === 0) return null;
  const count = parseInt(zipContent.dataset.mediaCount || "0", 10) || items.length;
  let realIdx = 0;
  if (count > 1) {
    const { firstOffset, step } = getCarouselMetrics(zipContent);
    const rawIdx = Math.round((zipContent.scrollLeft - firstOffset) / step) + 1;
    realIdx = ((rawIdx - 1) % count + count) % count;
  }
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
    folderName: zipTitle?.textContent || "",
    folderPath: activeItem.dataset.folder || zipTitle?.textContent || "",
    filename: activeItem?.dataset.filename || ""
  };
}

/**
 * Updates the File Details Info Sheet with information from the active slide element.
 */
export function updateActiveSlideInfo(mediaItem) {
  const modal = document.getElementById("zip-file-info-modal");
  if (!modal) return;

  const active = mediaItem || getActiveMediaItem()?.item;
  if (!active) return;

  const filename = active.dataset?.filename || "";
  let folder = active.dataset?.folder;
  if (!folder || folder === "/") {
    const activeInfo = getActiveMediaItem();
    folder = activeInfo?.folderName || zipContent?.dataset?.galleryTitle || zipTitle?.textContent || "";
  }

  const sizeNum = parseInt(active.dataset?.size, 10);
  const size = !isNaN(sizeNum) && sizeNum > 0 ? formatBytes(sizeNum) : "";
  const link = active.dataset?.link || "";

  const fFolderEl = document.getElementById("zip-info-folder");
  const fFolderRow = document.getElementById("zip-info-folder-row");
  const fNameEl = document.getElementById("zip-info-filename");
  const fSizeEl = document.getElementById("zip-info-size");
  const fSizeRow = document.getElementById("zip-info-size-row");
  const fLinkRow = document.getElementById("zip-info-link-row");
  const fLink = document.getElementById("zip-info-link");
  const fDimRow = document.getElementById("zip-info-dimensions-row");
  const fDimEl = document.getElementById("zip-info-dimensions");
  const fExtRow = document.getElementById("zip-info-ext-row");
  const fExtEl = document.getElementById("zip-info-ext");

  if (fFolderEl) {
    fFolderEl.textContent = folder || "/";
  }
  if (fFolderRow) {
    fFolderRow.style.display = folder ? "flex" : "none";
  }

  if (fNameEl) {
    fNameEl.textContent = filename || "Unknown File";
  }

  if (fSizeEl) {
    fSizeEl.textContent = size;
  }
  if (fSizeRow) {
    fSizeRow.style.display = size ? "inline-flex" : "none";
  }

  // File extension badge
  const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toUpperCase() : "";
  if (fExtEl && fExtRow) {
    if (ext) {
      fExtEl.textContent = ext;
      fExtRow.style.display = "inline-flex";
    } else {
      fExtRow.style.display = "none";
    }
  }

  // Dimensions (resolution)
  function checkDimensions() {
    let dimensions = "";
    const img = active.querySelector("img");
    if (img && img.naturalWidth && img.naturalHeight) {
      dimensions = `${img.naturalWidth} × ${img.naturalHeight}`;
    } else {
      const video = active.querySelector("video");
      if (video && video.videoWidth && video.videoHeight) {
        dimensions = `${video.videoWidth} × ${video.videoHeight}`;
      }
    }
    if (fDimEl && fDimRow) {
      if (dimensions) {
        fDimEl.textContent = dimensions;
        fDimRow.style.display = "inline-flex";
      } else {
        fDimRow.style.display = "none";
      }
    }
  }
  checkDimensions();

  const img = active.querySelector("img");
  if (img && (!img.naturalWidth || !img.naturalHeight) && !img._hasInfoDimHandler) {
    img._hasInfoDimHandler = true;
    img.addEventListener("load", () => {
      const currentActive = getActiveMediaItem()?.item;
      if (currentActive === active) {
        checkDimensions();
      }
    }, { once: true });
  }

  if (fLinkRow && fLink) {
    if (link) {
      fLinkRow.classList.remove("hidden");
      fLinkRow.style.display = "inline-flex";
      fLink.href = link;
    } else {
      fLinkRow.classList.add("hidden");
      fLinkRow.style.display = "none";
    }
  }
}

/**
 * Helper to aggregate immediate subfolders under a given prefix across all folder rows.
 */
function getSubfoldersUnder(allFolders, prefix) {
  const subMap = new Map();
  allFolders.forEach((f) => {
    let relPath = f.path;
    if (prefix) {
      if (relPath === prefix) return;
      if (!relPath.startsWith(prefix + "/")) return;
      relPath = relPath.slice(prefix.length).replace(/^\/+/, "");
    }
    if (!relPath) return;
    const directChildName = relPath.split("/")[0];
    if (!subMap.has(directChildName)) {
      subMap.set(directChildName, {
        name: directChildName,
        fullPrefix: prefix ? `${prefix}/${directChildName}` : directChildName,
        firstFolderIdx: f.idx,
        totalFiles: 0,
        foldersCount: 0
      });
    }
    const group = subMap.get(directChildName);
    group.totalFiles += f.fileCount;
    group.foldersCount += 1;
  });

  return Array.from(subMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
}

/**
 * Closes the active directory dropdown in zip-nav-tabs.
 */
export function closeZipNavDropdown() {
  if (activeZipNavDropdown) {
    if (typeof activeZipNavDropdown._cleanup === "function") {
      activeZipNavDropdown._cleanup();
    }
    activeZipNavDropdown.remove();
    activeZipNavDropdown = null;
  }
  const openBtns = document.querySelectorAll(".zip-nav-tab-btn.open");
  openBtns.forEach((b) => {
    b.classList.remove("open");
    b.classList.remove("active");
  });
}

/**
 * Instantly jumps the gallery to a target folder row without triggering intermediate media loads.
 */
export function jumpToFolder(folderIdx) {
  if (!zipContent) return;
  const rows = Array.from(zipContent.querySelectorAll(".zip-folder-row"));
  if (folderIdx < 0 || folderIdx >= rows.length) return;

  closeZipNavDropdown();

  // Cancel any ongoing vertical smooth scroll
  if (zipContent._animIdY) {
    cancelAnimationFrame(zipContent._animIdY);
    zipContent._animIdY = null;
  }
  delete zipContent._targetFolderIndex;

  const targetFolderRow = rows[folderIdx];
  if (!targetFolderRow) return;

  // 1. Flag jumping mode so observer callback ignores intermediate rows
  window._isJumpingZipGallery = true;

  // 2. Reset horizontal scroll on target row to its first non-clone file
  if (targetFolderRow._animId) {
    cancelAnimationFrame(targetFolderRow._animId);
    targetFolderRow._animId = null;
  }
  delete targetFolderRow._targetIndex;

  const count = targetFolderRow.dataset.mediaCount ? parseInt(targetFolderRow.dataset.mediaCount, 10) : 0;
  alignFolderRowToFirstSlide(targetFolderRow, count);

  // 3. Jump vertically directly and accurately to target folder row without window-scrolling side effects
  const rowHeight = targetFolderRow.clientHeight || zipContent.clientHeight || window.innerHeight;
  const targetY = targetFolderRow.offsetTop !== undefined && targetFolderRow.offsetTop >= 0
    ? targetFolderRow.offsetTop
    : folderIdx * rowHeight;

  zipContent.scrollTop = targetY;

  // 4. Update HUD immediately
  updateZipIndicatorsAndHUD();

  // 5. Restore observer processing in next frame once layout has settled
  requestAnimationFrame(() => {
    window._isJumpingZipGallery = false;
    updateZipIndicatorsAndHUD();
  });
}

/**
 * Instantly jumps the active folder row to a target file without triggering intermediate media loads.
 */
export function jumpToFile(targetRow, fileIdx) {
  if (!targetRow) return;

  closeZipNavDropdown();

  // 1. Flag jumping mode
  window._isJumpingZipGallery = true;

  // 2. Jump horizontally instantly and precisely to the non-clone target slide
  if (targetRow._animId) {
    cancelAnimationFrame(targetRow._animId);
    targetRow._animId = null;
  }
  delete targetRow._targetIndex;

  const count = targetRow.dataset.mediaCount ? parseInt(targetRow.dataset.mediaCount, 10) : 0;
  const nonClones = Array.from(targetRow.querySelectorAll(".media-item:not([data-is-clone='true'])"));
  const targetSlide = nonClones[fileIdx] || targetRow.querySelector(`[data-file-idx="${fileIdx}"]:not([data-is-clone='true'])`);

  const itemWidth = targetRow.clientWidth || window.innerWidth;
  const targetX = targetSlide ? targetSlide.offsetLeft : (count > 1 ? (fileIdx + 1) * itemWidth : fileIdx * itemWidth);
  targetRow.scrollLeft = targetX;

  // 3. Update HUD immediately
  updateZipIndicatorsAndHUD();

  // 4. Restore observer processing in next frame
  requestAnimationFrame(() => {
    window._isJumpingZipGallery = false;
    updateZipIndicatorsAndHUD();
  });
}

/**
 * Opens a directory dropdown below the clicked nav tab button, listing child folders or files.
 */
export function openZipNavDropdown(btn, seg, active) {
  const isAlreadyOpen = btn.classList.contains("open");
  closeZipNavDropdown();
  if (isAlreadyOpen) return;

  if (!zipContent) return;
  const rows = Array.from(zipContent.querySelectorAll(".zip-folder-row"));
  if (rows.length === 0) return;

  const currentActive = getActiveMediaItem() || active;

  const allFolders = rows.map((row) => {
    const path = row.dataset.folderPath || row.dataset.folderName || "";
    const name = row.dataset.folderName || path.split("/").pop() || path;
    const nonClones = row.querySelectorAll(".media-item:not([data-is-clone='true'])");
    const fileCount = nonClones.length;
    const idx = parseInt(row.dataset.folderIdx, 10);
    return { row, path, name, fileCount, idx };
  });

  let segFolder = null;
  if (seg.folderPrefix) {
    segFolder = allFolders.find((f) => f.path === seg.folderPrefix || f.path.endsWith("/" + seg.folderPrefix));
  }
  if (!segFolder && seg.name) {
    segFolder = allFolders.find((f) => f.name.toLowerCase() === seg.name.toLowerCase());
  }
  const currentFolderIdx = currentActive?.folderIdx ?? 0;
  const targetFolderIdx = segFolder ? segFolder.idx : currentFolderIdx;
  const targetRow = rows[targetFolderIdx] || currentActive?.folderRow || rows[0];

  // Create dropdown element
  const dropdown = document.createElement("div");
  dropdown.id = "zip-nav-dropdown";
  dropdown.className = "zip-nav-dropdown";

  const btnRect = btn.getBoundingClientRect();
  const maxW = Math.min(window.innerWidth * 0.9, 360);
  let centerX = btnRect.left + btnRect.width / 2;
  const halfW = maxW / 2;
  centerX = Math.max(halfW + 10, Math.min(window.innerWidth - halfW - 10, centerX));

  dropdown.style.position = "fixed";
  dropdown.style.top = `${btnRect.bottom + 8}px`;
  dropdown.style.left = `${centerX}px`;
  dropdown.style.transform = "translateX(-50%)";
  dropdown.style.maxHeight = "60vh";
  dropdown.style.overflowY = "auto";
  dropdown.style.zIndex = "2100";

  btn.classList.add("open");
  btn.classList.add("active");

  const appendHeader = (title, count) => {
    const header = document.createElement("div");
    header.className = "zip-nav-dropdown-header";
    header.innerHTML = `<span>${escapeHtml(title)}</span><span>${count}</span>`;
    dropdown.appendChild(header);
  };

  if (seg.type === "file") {
    // Show files inside current active folder row
    const items = Array.from(targetRow.querySelectorAll(".media-item:not([data-is-clone='true'])"));
    appendHeader(`Files in ${seg.parentName || active.folderName || seg.name}`, items.length);

    items.forEach((item, fileIdx) => {
      const isCurrent = fileIdx === active.fileIdx;
      const filename = item.dataset.filename || `File ${fileIdx + 1}`;
      const sizeNum = parseInt(item.dataset.size, 10);
      const sizeStr = !isNaN(sizeNum) && sizeNum > 0 ? formatBytes(sizeNum) : `#${fileIdx + 1}`;

      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.className = `zip-nav-dropdown-item ${isCurrent ? "current" : ""}`;
      itemBtn.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.7; flex-shrink: 0; color: ${isCurrent ? "#58a6ff" : "inherit"};"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          <span style="font-weight:${isCurrent ? "600" : "400"}; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
          <span style="color:#888; font-size:0.75rem; font-family:monospace;">${sizeStr}</span>
          ${isCurrent ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ""}
        </div>
      `;

      itemBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeZipNavDropdown();
        if (targetFolderIdx !== (getActiveMediaItem()?.folderIdx ?? -1)) {
          jumpToFolder(targetFolderIdx);
        }
        const finalRow = rows[targetFolderIdx] || targetRow;
        jumpToFile(finalRow, fileIdx);
      });

      dropdown.appendChild(itemBtn);
    });
  } else {
    // Check for immediate child folders under queryPrefix
    let subfolders = getSubfoldersUnder(allFolders, seg.queryPrefix);
    let headerTitle = `Folders in ${seg.parentName || seg.name}`;

    // If root segment and only 1 subfolder that matches seg.name, peek into that folder
    if (seg.type === "root" && subfolders.length === 1 && subfolders[0].name.toLowerCase() === seg.name.toLowerCase()) {
      subfolders = getSubfoldersUnder(allFolders, subfolders[0].fullPrefix);
      headerTitle = `Folders in ${seg.name}`;
    }

    if (subfolders.length > 0) {
      appendHeader(headerTitle, subfolders.length);

      const activeFolderPath = active?.folderPath || active?.folderName || "";
      subfolders.forEach((sub) => {
        const isCurrent = sub.name.toLowerCase() === seg.name.toLowerCase() ||
          activeFolderPath === sub.fullPrefix ||
          activeFolderPath.startsWith(sub.fullPrefix + "/");

        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.className = `zip-nav-dropdown-item ${isCurrent ? "current" : ""}`;

        const countLabel = sub.foldersCount > 1
          ? `${sub.totalFiles} files`
          : `${sub.totalFiles} file${sub.totalFiles > 1 ? "s" : ""}`;

        itemBtn.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0;">
            <svg width="15" height="24" viewBox="0 0 24 24" fill="currentColor" style="opacity: 0.7; flex-shrink: 0; color: ${isCurrent ? "#58a6ff" : "inherit"};"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            <span style="font-weight:${isCurrent ? "600" : "400"}; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(sub.name)}">${escapeHtml(sub.name)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
            <span style="color:#888; font-size:0.75rem; font-family:monospace;">${countLabel}</span>
            ${isCurrent ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ""}
          </div>
        `;

        itemBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          closeZipNavDropdown();
          jumpToFolder(sub.firstFolderIdx);
        });

        dropdown.appendChild(itemBtn);
      });
    } else {
      // Leaf directory with files directly inside
      const items = Array.from(targetRow.querySelectorAll(".media-item:not([data-is-clone='true'])"));
      appendHeader(`Files in ${seg.name}`, items.length);

      items.forEach((item, fileIdx) => {
        const isCurrent = fileIdx === active.fileIdx;
        const filename = item.dataset.filename || `File ${fileIdx + 1}`;
        const sizeNum = parseInt(item.dataset.size, 10);
        const sizeStr = !isNaN(sizeNum) && sizeNum > 0 ? formatBytes(sizeNum) : `#${fileIdx + 1}`;

        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.className = `zip-nav-dropdown-item ${isCurrent ? "current" : ""}`;
        itemBtn.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.7; flex-shrink: 0; color: ${isCurrent ? "#58a6ff" : "inherit"};"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            <span style="font-weight:${isCurrent ? "600" : "400"}; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
            <span style="color:#888; font-size:0.75rem; font-family:monospace;">${sizeStr}</span>
            ${isCurrent ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ""}
          </div>
        `;

        itemBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          closeZipNavDropdown();
          if (targetFolderIdx !== (getActiveMediaItem()?.folderIdx ?? -1)) {
            jumpToFolder(targetFolderIdx);
          }
          const finalRow = rows[targetFolderIdx] || targetRow;
          jumpToFile(finalRow, fileIdx);
        });

        dropdown.appendChild(itemBtn);
      });
    }
  }

  // Click outside and escape listeners
  const onDocClick = (e) => {
    if (e.target.closest("#zip-nav-dropdown") || e.target.closest(".zip-nav-tab-btn")) return;
    closeZipNavDropdown();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      closeZipNavDropdown();
    }
  };

  setTimeout(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
  }, 10);

  dropdown._cleanup = () => {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKeyDown);
  };

  document.body.appendChild(dropdown);
  activeZipNavDropdown = dropdown;
}

/**
 * Updates the nav tab inside zip-nav to display the main root folder, directory path, and current file.
 */
export function updateZipNavTabs(active) {
  const tabs = document.getElementById("zip-nav-tabs");
  if (!tabs) return;

  if (!zipContent || !zipContent.classList.contains("gallery-2d-mode") || !active) {
    tabs.classList.add("hidden");
    tabs.innerHTML = "";
    delete tabs.dataset.currentPath;
    return;
  }

  const activePath = active.folderPath || active.folderName || "";
  const rootTitle = zipContent.dataset.galleryTitle || zipTitle?.textContent || "Archive";

  tabs.classList.remove("hidden");

  // If directory path hasn't changed, just update the currently viewed file label
  if (tabs.dataset.currentPath === activePath) {
    const fileLabel = tabs.querySelector(".zip-nav-tab-btn[data-type='file'] .zip-nav-tab-label");
    if (fileLabel && active.filename && fileLabel.textContent !== active.filename) {
      fileLabel.textContent = active.filename;
      fileLabel.title = active.filename;
    }
    return;
  }

  tabs.dataset.currentPath = activePath;
  tabs.innerHTML = "";

  const pathParts = activePath.split("/").filter(Boolean);
  const segments = [];

  const startsWithRoot = pathParts.length > 0 && pathParts[0].toLowerCase() === rootTitle.toLowerCase();

  if (startsWithRoot) {
    segments.push({
      name: pathParts[0],
      type: pathParts.length === 1 ? "leaf" : "root",
      parentName: rootTitle,
      queryPrefix: "",
      folderPrefix: pathParts[0]
    });
    for (let j = 1; j < pathParts.length; j++) {
      segments.push({
        name: pathParts[j],
        type: j === pathParts.length - 1 ? "leaf" : "dir",
        parentName: pathParts[j - 1],
        queryPrefix: pathParts.slice(0, j).join("/"),
        folderPrefix: pathParts.slice(0, j + 1).join("/")
      });
    }
  } else {
    segments.push({
      name: rootTitle,
      type: pathParts.length === 0 ? "leaf" : "root",
      parentName: rootTitle,
      queryPrefix: "",
      folderPrefix: ""
    });
    for (let j = 0; j < pathParts.length; j++) {
      segments.push({
        name: pathParts[j],
        type: j === pathParts.length - 1 ? "leaf" : "dir",
        parentName: j === 0 ? rootTitle : pathParts[j - 1],
        queryPrefix: pathParts.slice(0, j).join("/"),
        folderPrefix: pathParts.slice(0, j + 1).join("/")
      });
    }
  }

  // 2. Currently Viewed File
  if (active.filename) {
    segments.push({
      name: active.filename,
      type: "file",
      parentName: pathParts.length > 0 ? pathParts[pathParts.length - 1] : rootTitle,
      folderPrefix: activePath
    });
  }

  segments.forEach((seg, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "zip-nav-tab-btn";
    btn.dataset.type = seg.type;

    const isExpandable = seg.type !== "root";
    if (isExpandable) {
      btn.innerHTML = `<span class="zip-nav-tab-label" title="${escapeHtml(seg.name)}">${escapeHtml(seg.name)}</span> <span class="zip-nav-arrow">▾</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openZipNavDropdown(btn, seg, getActiveMediaItem() || active);
      });
    } else {
      // Main root folder is not expandable since its contents are selectable via directory segments
      btn.innerHTML = `<span class="zip-nav-tab-label" title="${escapeHtml(seg.name)}">${escapeHtml(seg.name)}</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        jumpToFolder(0);
      });
    }

    tabs.appendChild(btn);

    if (idx < segments.length - 1) {
      const sep = document.createElement("span");
      sep.className = "zip-nav-tab-sep";
      sep.textContent = "/";
      tabs.appendChild(sep);
    }
  });
}

/**
 * Updates top indicator text, title, folder prev/next buttons, live info modal, and nav tabs.
 */
export function updateZipIndicatorsAndHUD() {
  const active = getActiveMediaItem();
  if (!active) return;

  // Update Indicator
  if (zipIndicator) {
    zipIndicator.style.display = "";
    zipIndicator.textContent = `${active.fileIdx + 1} / ${active.totalFiles}`;
  }

  // Update Title
  if (zipTitle && active.folderName) {
    zipTitle.textContent = active.folderName;
  }

  // Update Nav Tabs with Directory Path
  updateZipNavTabs(active);

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
  closeZipNavDropdown();
  const modal = document.getElementById("zip-file-info-modal");
  if (!modal) return;
  const shouldOpen = force !== undefined ? force : !modal.classList.contains("expanded");
  if (shouldOpen) {
    const active = getActiveMediaItem();
    updateActiveSlideInfo(active?.item);
    modal.classList.add("expanded");
  } else {
    modal.classList.remove("expanded");
  }
}

export function smoothScrollY(element, targetTop, duration = 160, onComplete = null) {
  if (window.pawAnimationsDisabled || duration <= 0) {
    element.scrollTop = targetTop;
    element.style.scrollSnapType = "";
    if (onComplete) onComplete();
    return;
  }

  if (element._animIdY) {
    cancelAnimationFrame(element._animIdY);
    element._animIdY = null;
  }

  element.style.scrollSnapType = "none";
  const startTop = element.scrollTop;
  const distance = targetTop - startTop;
  if (Math.abs(distance) < 1) {
    element.scrollTop = targetTop;
    element.style.scrollSnapType = "";
    if (onComplete) onComplete();
    return;
  }

  const startTime = performance.now();
  const easeOut = (t) => t * (2 - t);

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easeOut(progress);

    element.scrollTop = startTop + distance * easedProgress;

    if (progress < 1) {
      element._animIdY = requestAnimationFrame(step);
    } else {
      element._animIdY = null;
      element.scrollTop = targetTop;
      if (onComplete) {
        onComplete();
      }
      requestAnimationFrame(() => {
        element.style.scrollSnapType = "";
      });
    }
  }

  element._animIdY = requestAnimationFrame(step);
}

/**
 * Vertically scrolls the gallery container to the previous or next folder row.
 * Supports rapid clicks/spamming and wrap-around across folders.
 */
export function navigateFolder(direction) {
  if (!zipContent || !zipContent.classList.contains("gallery-2d-mode")) return;
  const rows = Array.from(zipContent.querySelectorAll(".zip-folder-row"));
  if (rows.length <= 1) return;

  const rowHeight = rows[0]?.clientHeight || zipContent.clientHeight || window.innerHeight;
  let baseIndex;
  if (zipContent._targetFolderIndex !== undefined) {
    baseIndex = zipContent._targetFolderIndex;
    if (zipContent._animIdY) {
      cancelAnimationFrame(zipContent._animIdY);
      zipContent._animIdY = null;
    }
  } else {
    const active = getActiveMediaItem();
    baseIndex = active ? active.folderIdx : Math.round(zipContent.scrollTop / rowHeight);
  }

  let nextIndex = direction === "down" ? baseIndex + 1 : baseIndex - 1;
  // Wrap around across folders
  nextIndex = (nextIndex + rows.length) % rows.length;

  zipContent._targetFolderIndex = nextIndex;
  const targetFolderRow = rows[nextIndex];
  if (targetFolderRow && targetFolderRow.children.length > 2 && targetFolderRow.scrollLeft === 0) {
    alignFolderRowToFirstSlide(targetFolderRow, parseInt(targetFolderRow.dataset.mediaCount || "0", 10));
  }
  const targetY = targetFolderRow && targetFolderRow.offsetTop !== undefined && targetFolderRow.offsetTop >= 0
    ? targetFolderRow.offsetTop
    : nextIndex * rowHeight;

  closeZipNavDropdown();

  const isMultiStep = Math.abs(nextIndex - baseIndex) > 1;
  if (isMultiStep) {
    window._isJumpingZipGallery = true;
    if (window.zipMediaObserver) {
      window.zipMediaObserver.disconnect();
    }
  }

  smoothScrollY(zipContent, targetY, window.pawAnimationsDisabled ? 0 : 160, () => {
    zipContent._targetFolderIndex = undefined;
    zipContent.scrollTop = targetY;
    if (isMultiStep) {
      window._isJumpingZipGallery = false;
      if (window.zipMediaObserver && zipContent) {
        rows.forEach((row) => {
          row.querySelectorAll(".media-item").forEach((slide) => {
            if (slide.dataset.loaded !== "true") {
              window.zipMediaObserver.observe(slide);
            }
          });
        });
      }
    }
    updateZipIndicatorsAndHUD();
  });
}

/**
 * Aligns a folder row's horizontal scroll position to the first actual media slide (skipping cloneLast).
 */
export function alignFolderRowToFirstSlide(folderRow, filesCount) {
  if (!folderRow || filesCount <= 1) return;

  const itemWidth = folderRow.clientWidth || zipContent?.clientWidth || window.innerWidth || 1024;
  const nonClones = Array.from(folderRow.querySelectorAll(".media-item:not([data-is-clone='true'])"));
  const firstSlide = nonClones[0] || folderRow.children[1];

  let targetX = 0;
  if (firstSlide && firstSlide.offsetLeft > 0) {
    targetX = firstSlide.offsetLeft;
  } else {
    // 100% item width + 20px gap defined in style.css
    targetX = itemWidth + 20;
  }

  folderRow.style.scrollSnapType = "none";
  folderRow.scrollLeft = targetX;
  folderRow._restingScrollLeft = targetX;

  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (typeof window !== "undefined" && window.requestAnimationFrame ? window.requestAnimationFrame : ((fn) => setTimeout(fn, 0)));
  raf(() => {
    if (!folderRow.isConnected) return;
    const resolvedSlide = folderRow.children[1] || nonClones[0];
    const resolvedX = (resolvedSlide && resolvedSlide.offsetLeft > 0)
      ? resolvedSlide.offsetLeft
      : (folderRow.clientWidth ? folderRow.clientWidth + 20 : targetX);

    if (resolvedX > 0) {
      folderRow.scrollLeft = resolvedX;
      folderRow._restingScrollLeft = resolvedX;
    }
    folderRow.style.scrollSnapType = "";
    updateZipIndicatorsAndHUD();
  });
}

/**
 * Creates and configures a single 2D matrix folder row element with slides, circular clones, and gestures.
 */
export function createFolderRowElement(group, folderIdx, options = {}) {
  const pCount = Math.max(1, window.pawPreloadCount || 1);
  if (!window.zipMediaObserver) {
    window.zipMediaObserver = new IntersectionObserver((entries) => {
      if (window._isJumpingZipGallery) return;
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const target = entry.target;
          if (target.dataset.loaded === "true" || target.dataset.loading === "true") return;
          if (target.dataset.isClone === "true" && entry.intersectionRatio < 0.5) return;
          const loader = target._loadMedia;
          if (typeof loader === "function") {
            loader(target, options.signal);
          }
        }
      });
    }, {
      root: null,
      rootMargin: `20% ${pCount * 100}% 20% ${pCount * 100}%`,
      threshold: [0, 0.5]
    });
  }

  const folderRow = document.createElement("div");
  folderRow.className = "zip-folder-row";
  folderRow.dataset.folderName = group.folderName;
  folderRow.dataset.folderPath = group.folderPath || group.folderName;
  folderRow.dataset.folderIdx = String(folderIdx);
  folderRow.dataset.mediaCount = String(group.files.length);

  group.files.forEach((file, fileIdx) => {
    const slide = document.createElement("div");
    slide.className = "media-item";
    slide.dataset.filename = file.filename;
    slide.dataset.folder = group.folderPath || group.folderName;
    slide.dataset.size = String(file.size || 0);
    slide.dataset.link = file.link || "";
    slide.dataset.fileIdx = String(fileIdx);
    if (file.fileId) slide.dataset.fileId = file.fileId;
    slide._loadMedia = file.loadMedia;

    const progress = document.createElement("div");
    progress.className = "media-progress";
    progress.style.display = "flex";
    renderMediaProgress(progress, "Loading...", null, file.filename, file.size ? formatBytes(file.size) : "", "");
    slide.appendChild(progress);

    folderRow.appendChild(slide);
    window.zipMediaObserver.observe(slide);
  });

  // Infinite loop clones for horizontal navigation
  if (group.files.length > 1 && folderRow.children.length > 1) {
    const firstChild = folderRow.children[0];
    const lastChild = folderRow.children[folderRow.children.length - 1];
    const cloneFirst = firstChild.cloneNode(true);
    const cloneLast = lastChild.cloneNode(true);

    cloneFirst.dataset.isClone = "true";
    cloneLast.dataset.isClone = "true";
    cloneFirst._loadMedia = firstChild._loadMedia;
    cloneLast._loadMedia = lastChild._loadMedia;

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

    folderRow.insertBefore(cloneLast, firstChild);
    folderRow.appendChild(cloneFirst);

    window.zipMediaObserver.observe(cloneFirst);
    window.zipMediaObserver.observe(cloneLast);
  }

  let rowSettleTimer;
  folderRow.addEventListener("touchstart", () => {
    folderRow._isTouching = true;
    folderRow._restingScrollLeft = folderRow.scrollLeft;
    clearTimeout(rowSettleTimer);
  }, { passive: true });

  folderRow.addEventListener("touchend", () => {
    folderRow._isTouching = false;
    if (group.files.length > 1 && !folderRow._animId) {
      clearTimeout(rowSettleTimer);
      rowSettleTimer = setTimeout(() => {
        handleCarouselScrollSettled(folderRow, group.files.length);
        folderRow._restingScrollLeft = folderRow.scrollLeft;
      }, 150);
    }
  }, { passive: true });

  folderRow.addEventListener("touchcancel", () => {
    folderRow._isTouching = false;
  }, { passive: true });

  folderRow.addEventListener("scroll", () => {
    if (folderRow._isVerticalScrolling && folderRow._restingScrollLeft !== undefined) {
      folderRow.scrollLeft = folderRow._restingScrollLeft;
      return;
    }
    closeZipNavDropdown();
    updateZipIndicatorsAndHUD();
    if (!folderRow._animId && !folderRow._isTouching && group.files.length > 1) {
      clearTimeout(rowSettleTimer);
      rowSettleTimer = setTimeout(() => {
        handleCarouselScrollSettled(folderRow, group.files.length);
        folderRow._restingScrollLeft = folderRow.scrollLeft;
      }, 150);
    }
  }, { passive: true });

  folderRow.addEventListener("scrollend", () => {
    if (!folderRow._animId && !folderRow._isTouching && group.files.length > 1) {
      handleCarouselScrollSettled(folderRow, group.files.length);
      folderRow._restingScrollLeft = folderRow.scrollLeft;
    }
  });

  const estimatedWidth = folderRow.clientWidth || window.innerWidth || 1024;
  const initialOffset = group.files.length > 1
    ? ((folderRow.children[1] && folderRow.children[1].offsetLeft > 0) ? folderRow.children[1].offsetLeft : estimatedWidth + 20)
    : 0;
  folderRow.scrollLeft = initialOffset;
  folderRow._restingScrollLeft = initialOffset;

  return folderRow;
}

/**
 * Progressively appends or inserts a folder group into the active 2D matrix gallery in sorted order.
 */
export function appendFolderGroupTo2DMatrix(group, options = {}) {
  if (!zipContent) return false;
  if (!group || !group.files || group.files.length === 0) return false;

  // If gallery-2d-mode is not set or zipContent has no rows, initialize cleanly
  if (!zipContent.classList.contains("gallery-2d-mode") || zipContent.querySelectorAll(".zip-folder-row").length === 0) {
    render2DMatrixGallery([group], options);
    return true;
  }

  const targetPath = group.folderPath || group.folderName;
  const existingRows = Array.from(zipContent.querySelectorAll(".zip-folder-row"));

  // Check if row already exists
  if (existingRows.some((r) => (r.dataset.folderPath || r.dataset.folderName) === targetPath)) {
    return false;
  }

  // Find alphabetical / natural insertion point
  let insertBeforeRow = null;
  for (const r of existingRows) {
    const p = r.dataset.folderPath || r.dataset.folderName || "";
    if (p.localeCompare(targetPath, undefined, { numeric: true, sensitivity: "base" }) > 0) {
      insertBeforeRow = r;
      break;
    }
  }

  const row = createFolderRowElement(group, 0, options);
  if (insertBeforeRow) {
    zipContent.insertBefore(row, insertBeforeRow);
  } else {
    zipContent.appendChild(row);
  }
  alignFolderRowToFirstSlide(row, group.files.length);

  // Re-index folderIdx
  const updatedRows = Array.from(zipContent.querySelectorAll(".zip-folder-row"));
  updatedRows.forEach((r, idx) => {
    r.dataset.folderIdx = String(idx);
  });

  updateZipIndicatorsAndHUD();
  return true;
}

/**
 * Non-blocking progress indicator in the gallery HUD for background folder discovery.
 */
export function updateZipScanProgress(statusText) {
  let badge = document.getElementById("zip-bg-scan-badge");
  if (!statusText) {
    if (badge) {
      badge.style.opacity = "0";
      setTimeout(() => {
        if (badge && badge.parentElement) badge.remove();
      }, 300);
    }
    return;
  }

  if (!badge) {
    badge = document.createElement("div");
    badge.id = "zip-bg-scan-badge";
    badge.className = "zip-bg-scan-badge";
    badge.style.cssText = "position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: rgba(20, 20, 25, 0.88); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(88, 166, 255, 0.4); color: #8be9fd; font-size: 0.8rem; font-weight: 600; padding: 5px 14px; border-radius: 20px; pointer-events: none; z-index: 2100; transition: opacity 0.3s ease; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.4);";
    if (zipViewer) {
      zipViewer.appendChild(badge);
    } else {
      document.body.appendChild(badge);
    }
  }

  badge.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg><span>${escapeHtml(statusText)}</span>`;
  badge.style.opacity = "1";
}

/**
 * Universal 2D Matrix Gallery Renderer:
 * - Vertical scrolling (Up/Down) switches between folder rows with wrap-around.
 * - Horizontal scrolling (Left/Right) switches between files in the current folder with carousel clones and wrap-around.
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
  delete zipContent._targetFolderIndex;
  if (zipContent._animIdY) {
    cancelAnimationFrame(zipContent._animIdY);
    zipContent._animIdY = null;
  }

  const rootTitle = options.galleryTitle || options.archiveName || (zipTitle?.textContent && zipTitle.textContent !== "Gallery" && zipTitle.textContent !== "Error" ? zipTitle.textContent : "") || "Archive";
  zipContent.dataset.galleryTitle = rootTitle;

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
    if (window._isJumpingZipGallery) return;
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const target = entry.target;
        if (target.dataset.loaded === "true" || target.dataset.loading === "true") return;
        if (target.dataset.isClone === "true" && entry.intersectionRatio < 0.5) return;
        const loader = target._loadMedia;
        if (typeof loader === "function") {
          loader(target, options.signal);
        }
      }
    });
  }, {
    root: null,
    rootMargin: `20% ${pCount * 100}% 20% ${pCount * 100}%`,
    threshold: [0, 0.5]
  });

  validGroups.forEach((group, folderIdx) => {
    const folderRow = createFolderRowElement(group, folderIdx, options);
    zipContent.appendChild(folderRow);
    alignFolderRowToFirstSlide(folderRow, group.files.length);
  });

  zipContent.addEventListener("scroll", () => {
    closeZipNavDropdown();
    updateZipIndicatorsAndHUD();
  }, { passive: true });

  zipContent.scrollTop = 0;
  zipContent.scrollLeft = 0;
  updateZipIndicatorsAndHUD();
}

export async function openZipGallery(zipUrl, filename, cachedBlob = null, post = null) {
  closeZipGallery();
  if (post) {
    state.currentGalleryPost = post;
  } else if (!state.currentGalleryPost) {
    state.currentGalleryPost = getCurrentGalleryPost();
  }
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
      if (relativePath.startsWith("__MACOSX/") || relativePath.split("/").some((p) => p.startsWith("."))) return;
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
        size: zipEntry.uncompressedSize !== undefined ? zipEntry.uncompressedSize : (zipEntry._data?.uncompressedSize || 0)
      });
    });

    const folderNames = Array.from(folderMap.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );

    const folderGroups = folderNames.map((folderName) => {
      const files = folderMap.get(folderName);
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

      return {
        folderName: folderName.split("/").pop() || folderName,
        folderPath: folderName,
        files: files.map((f) => ({
          filename: f.name,
          folder: folderName,
          size: f.size,
          link: "", // Local zip entries have no external cloud link
          loadMedia: async (container, sig) => {
            if (container.dataset.loaded === "true") return;

            const fileIdxStr = container.dataset.fileIdx;
            const parentRow = container.closest(".zip-folder-row");
            const allMatchingContainers = parentRow
              ? Array.from(parentRow.querySelectorAll(`[data-file-idx="${fileIdxStr}"]`))
              : [container];

            const alreadyLoaded = allMatchingContainers.find((c) => c.dataset.loaded === "true");
            if (alreadyLoaded) {
              container.dataset.loaded = "true";
              delete container.dataset.loading;
              const media = alreadyLoaded.querySelector("img, video");
              if (media) {
                container.querySelectorAll("img, video").forEach((el) => el.remove());
                container.appendChild(media.cloneNode(true));
              }
              const p = container.querySelector(".media-progress");
              if (p) p.style.display = "none";
              return;
            }

            if (container.dataset.loading === "true") return;
            allMatchingContainers.forEach((c) => {
              c.dataset.loading = "true";
              delete c.dataset.loaded;
            });

            try {
              const fileBlob = await f.entry.async("blob");
              if (sig && sig.aborted) return;
              const objUrl = URL.createObjectURL(fileBlob);
              state.currentZipObjectUrls.push(objUrl);

              const img = new Image();
              img.style.maxWidth = "100%";
              img.style.maxHeight = "100%";
              img.style.objectFit = "contain";
              img.decoding = "async";

              img.onload = () => {
                allMatchingContainers.forEach((target) => {
                  target.dataset.loaded = "true";
                  delete target.dataset.loading;
                  target.querySelectorAll("img, video").forEach((el) => el.remove());
                  target.appendChild(img.cloneNode(true));
                  const p = target.querySelector(".media-progress");
                  if (p) p.style.display = "none";
                });
              };
              img.onerror = () => {
                allMatchingContainers.forEach((target) => {
                  delete target.dataset.loading;
                  delete target.dataset.loaded;
                  target.querySelectorAll("img, video").forEach((el) => el.remove());
                  const p = target.querySelector(".media-progress");
                  if (p) {
                    p.style.display = "flex";
                    showMediaUnavailableWarning(p, {
                      type: "image",
                      filename: f.name,
                      errorStatus: "Corrupt",
                      message: "Failed to decode image from zip archive"
                    });
                  }
                });
              };
              img.src = objUrl;
            } catch (_) {
              allMatchingContainers.forEach((target) => {
                delete target.dataset.loading;
                delete target.dataset.loaded;
                target.querySelectorAll("img, video").forEach((el) => el.remove());
                const p = target.querySelector(".media-progress");
                if (p) {
                  p.style.display = "flex";
                  showMediaUnavailableWarning(p, {
                    type: "image",
                    filename: f.name,
                    errorStatus: "Error",
                    message: "Failed to extract file from archive"
                  });
                }
              });
            }
          }
        }))
      };
    });

    const cleanTitle = filename.replace(/\.zip$/i, "") || filename;
    render2DMatrixGallery(folderGroups, { galleryTitle: cleanTitle, signal });

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
/**
 * Edge Visualizer & Edge Configuration for Paw Reader
 * Displays color-coded navigation edge zones overlay on screen and manages edge sizes.
 * 
 * Available in DevTools Console:
 * - pawEdges() / edges : toggle visualizer on/off
 * - pawSetEdges(vertical, horizontal) : e.g. pawSetEdges(0.20, 0.25) or pawSetEdges(20, 25)
 * - pawSetEdges({ top, bottom, left, right }) : e.g. pawSetEdges({ top: 0.10, left: 0.25 })
 * - pawResetEdges() : reset to default (5% on all edges)
 * - pawEdgeConfig : inspect current configuration
 */

import { getActiveMediaItem } from "./zip.js";

export const DEFAULT_EDGE_CONFIG = {
  top: 0.10,
  bottom: 0.10,
  left: 0.10,
  right: 0.10
};

export const edgeConfig = { ...DEFAULT_EDGE_CONFIG };

// Restore saved edge configuration & sanitize any stale 50% split configs
try {
  const saved = localStorage.getItem("paw_edge_config");
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === "object") {
      if (parsed.left >= 0.45 || parsed.right >= 0.45 || (parsed.left + parsed.right) >= 0.8) {
        localStorage.removeItem("paw_edge_config");
      } else {
        if (typeof parsed.top === "number" && parsed.top > 0 && parsed.top <= 0.45) edgeConfig.top = parsed.top;
        if (typeof parsed.bottom === "number" && parsed.bottom > 0 && parsed.bottom <= 0.45) edgeConfig.bottom = parsed.bottom;
        if (typeof parsed.left === "number" && parsed.left > 0 && parsed.left <= 0.45) edgeConfig.left = parsed.left;
        if (typeof parsed.right === "number" && parsed.right > 0 && parsed.right <= 0.45) edgeConfig.right = parsed.right;
      }
    }
  }
} catch (_) {}

window.pawEdgeConfig = edgeConfig;

let visualizerEl = null;
let hudEl = null;
let activeZone = null;
let pointerListener = null;
let scrollListener = null;
let currentLayoutHasMultiple = null;

const ZONE_COLORS = {
  top: {
    name: "Top (Scroll Up / Prev Post)",
    bg: "rgba(0, 180, 216, 0.22)",
    bgActive: "rgba(0, 180, 216, 0.42)",
    border: "#00b4d8",
    badgeBg: "rgba(0, 180, 216, 0.92)",
    badgeText: "#ffffff"
  },
  bottom: {
    name: "Bottom (Scroll Down / Next Post)",
    bg: "rgba(239, 71, 111, 0.22)",
    bgActive: "rgba(239, 71, 111, 0.42)",
    border: "#ef476f",
    badgeBg: "rgba(239, 71, 111, 0.92)",
    badgeText: "#ffffff"
  },
  left: {
    name: "Left (Carousel Prev Media)",
    bg: "rgba(6, 214, 160, 0.22)",
    bgActive: "rgba(6, 214, 160, 0.42)",
    border: "#06d6a0",
    badgeBg: "rgba(6, 214, 160, 0.92)",
    badgeText: "#ffffff"
  },
  right: {
    name: "Right (Carousel Next Media)",
    bg: "rgba(157, 78, 221, 0.22)",
    bgActive: "rgba(157, 78, 221, 0.42)",
    border: "#9d4edd",
    badgeBg: "rgba(157, 78, 221, 0.92)",
    badgeText: "#ffffff"
  },
  center: {
    name: "Center (Toggle Controls & Nav)",
    bg: "rgba(255, 209, 102, 0.08)",
    bgActive: "rgba(255, 209, 102, 0.20)",
    border: "rgba(255, 209, 102, 0.5)",
    badgeBg: "rgba(255, 209, 102, 0.92)",
    badgeText: "#1a1a1a"
  }
};

export function getActivePostInfo() {
  const zipViewer = document.getElementById("zip-viewer");
  const zipContent = document.getElementById("zip-content");

  if (zipViewer && !zipViewer.classList.contains("hidden")) {
    if (zipContent && zipContent.classList.contains("gallery-2d-mode")) {
      const active = getActiveMediaItem();
      if (active && active.folderRow) {
        const count = active.totalFiles || 1;
        return { hasMultiple: count > 1, count, isZip: true };
      }
    }
    const count = parseInt(zipContent?.dataset?.mediaCount || "0", 10) || 1;
    return { hasMultiple: count > 1, count, isZip: true };
  }

  const feed = document.getElementById("feed");
  if (!feed) return { hasMultiple: false, count: 1, isZip: false };

  const h = (feed && feed.clientHeight) || window.innerHeight || 1;
  const currentIndex = Math.round(feed.scrollTop / h);
  const card = feed.children[currentIndex] || feed.querySelector(".post-card");
  if (!card) return { hasMultiple: false, count: 1, isZip: false };

  const carousel = card.querySelector(".media-carousel");
  if (!carousel) return { hasMultiple: false, count: 1, isZip: false };

  const rawCount = parseInt(carousel.dataset.mediaCount || "0", 10);
  if (rawCount > 0) return { hasMultiple: rawCount > 1, count: rawCount, isZip: false };

  const nonClones = carousel.querySelectorAll(".media-item:not([data-is-clone='true'])").length;
  return { hasMultiple: nonClones > 1, count: nonClones || 1, isZip: false };
}

function createOverlay() {
  if (visualizerEl) return visualizerEl;

  const container = document.createElement("div");
  container.id = "paw-edge-visualizer";
  container.style.cssText = `
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none !important;
    z-index: 1000000;
    box-sizing: border-box;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace, sans-serif;
    user-select: none;
    -webkit-user-select: none;
  `;

  const topZone = document.createElement("div");
  topZone.className = "paw-zone paw-zone-top";

  const bottomZone = document.createElement("div");
  bottomZone.className = "paw-zone paw-zone-bottom";

  const leftZone = document.createElement("div");
  leftZone.className = "paw-zone paw-zone-left";

  const rightZone = document.createElement("div");
  rightZone.className = "paw-zone paw-zone-right";

  const centerZone = document.createElement("div");
  centerZone.className = "paw-zone paw-zone-center";

  const hud = document.createElement("div");
  hud.className = "paw-edge-hud";
  hud.style.cssText = `
    position: absolute;
    top: 16%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(15, 23, 42, 0.92);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 999px;
    padding: 5px 14px;
    color: #ffffff;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    white-space: nowrap;
    pointer-events: none;
    max-width: 95vw;
    box-sizing: border-box;
    transition: opacity 0.2s ease;
  `;
  hud.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:5px;">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#00e5ff;box-shadow:0 0 8px #00e5ff;"></span>
      <strong>Edges</strong>
    </span>
    <span style="color:rgba(255,255,255,0.4);">|</span>
    <span id="paw-hud-mode" style="font-weight:600;color:#38bdf8;">Mode</span>
    <span style="color:rgba(255,255,255,0.4);">|</span>
    <span id="paw-hud-zone" style="font-weight:bold;color:#ffd166;">Zone: Center</span>
    <span style="color:rgba(255,255,255,0.4);">|</span>
    <span id="paw-hud-coords" style="font-family:monospace;color:rgba(255,255,255,0.75);">X: -- Y: --</span>
  `;

  container.appendChild(topZone);
  container.appendChild(bottomZone);
  container.appendChild(leftZone);
  container.appendChild(rightZone);
  container.appendChild(centerZone);
  container.appendChild(hud);

  document.body.appendChild(container);
  visualizerEl = container;
  hudEl = hud;

  currentLayoutHasMultiple = null;
  updateOverlayLayout(getActivePostInfo(), true);

  return container;
}

function updateOverlayLayout(postInfo, force = false) {
  if (!visualizerEl) return;
  const hasMultiple = postInfo.hasMultiple;

  if (!force && currentLayoutHasMultiple === hasMultiple) return;
  currentLayoutHasMultiple = hasMultiple;

  const topPct = Math.round(edgeConfig.top * 100);
  const bottomPct = Math.round(edgeConfig.bottom * 100);
  const leftPct = Math.round(edgeConfig.left * 100);
  const rightPct = Math.round(edgeConfig.right * 100);
  const centerWidthPct = Math.round((1 - edgeConfig.left - edgeConfig.right) * 100);
  const centerHeightPct = Math.round((1 - edgeConfig.top - edgeConfig.bottom) * 100);

  const topZone = visualizerEl.querySelector(".paw-zone-top");
  const bottomZone = visualizerEl.querySelector(".paw-zone-bottom");
  const leftZone = visualizerEl.querySelector(".paw-zone-left");
  const rightZone = visualizerEl.querySelector(".paw-zone-right");
  const centerZone = visualizerEl.querySelector(".paw-zone-center");
  const modeLabel = hudEl?.querySelector("#paw-hud-mode");

  if (modeLabel) {
    modeLabel.textContent = hasMultiple
      ? `Multi-file (${postInfo.count} files) • Left/Right Corners Priority`
      : `Single file • Top/Bottom Corners Priority`;
    modeLabel.style.color = hasMultiple ? "#06d6a0" : "#38bdf8";
  }

  if (hasMultiple) {
    leftZone.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${leftPct}%;
      height: 100%;
      background: ${ZONE_COLORS.left.bg};
      border-right: 2px solid ${ZONE_COLORS.left.border};
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
      padding: 10px;
      z-index: 2;
    `;
    leftZone.innerHTML = `
      <div style="position:absolute;top:6px;left:6px;font-size:9px;font-weight:700;color:${ZONE_COLORS.left.border};background:rgba(0,0,0,0.6);padding:2px 6px;border-radius:4px;border:1px solid ${ZONE_COLORS.left.border};">
        ◀ Top Corner
      </div>
      <div style="background:${ZONE_COLORS.left.badgeBg};color:${ZONE_COLORS.left.badgeText};font-size:11px;font-weight:700;padding:6px 10px;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,0.4);text-align:center;line-height:1.3;">
        <span>◀</span> LEFT (${leftPct}%)<br>
        <span style="font-size:10px;font-weight:600;opacity:0.95;">Carousel Prev</span><br>
        <span style="font-size:9px;font-weight:700;color:#fff;background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:6px;margin-top:2px;display:inline-block;">Corners Priority</span>
      </div>
      <div style="position:absolute;bottom:6px;left:6px;font-size:9px;font-weight:700;color:${ZONE_COLORS.left.border};background:rgba(0,0,0,0.6);padding:2px 6px;border-radius:4px;border:1px solid ${ZONE_COLORS.left.border};">
        ◀ Bottom Corner
      </div>
    `;

    rightZone.style.cssText = `
      position: absolute;
      top: 0;
      right: 0;
      width: ${rightPct}%;
      height: 100%;
      background: ${ZONE_COLORS.right.bg};
      border-left: 2px solid ${ZONE_COLORS.right.border};
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
      padding: 10px;
      z-index: 2;
    `;
    rightZone.innerHTML = `
      <div style="position:absolute;top:6px;right:6px;font-size:9px;font-weight:700;color:${ZONE_COLORS.right.border};background:rgba(0,0,0,0.6);padding:2px 6px;border-radius:4px;border:1px solid ${ZONE_COLORS.right.border};">
        Top Corner ▶
      </div>
      <div style="background:${ZONE_COLORS.right.badgeBg};color:${ZONE_COLORS.right.badgeText};font-size:11px;font-weight:700;padding:6px 10px;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,0.4);text-align:center;line-height:1.3;">
        <span>▶</span> RIGHT (${rightPct}%)<br>
        <span style="font-size:10px;font-weight:600;opacity:0.95;">Carousel Next</span><br>
        <span style="font-size:9px;font-weight:700;color:#fff;background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:6px;margin-top:2px;display:inline-block;">Corners Priority</span>
      </div>
      <div style="position:absolute;bottom:6px;right:6px;font-size:9px;font-weight:700;color:${ZONE_COLORS.right.border};background:rgba(0,0,0,0.6);padding:2px 6px;border-radius:4px;border:1px solid ${ZONE_COLORS.right.border};">
        Bottom Corner ▶
      </div>
    `;

    topZone.style.cssText = `
      position: absolute;
      top: 0;
      left: ${leftPct}%;
      width: ${centerWidthPct}%;
      height: ${topPct}%;
      background: ${ZONE_COLORS.top.bg};
      border-bottom: 2px solid ${ZONE_COLORS.top.border};
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
      z-index: 1;
    `;
    topZone.innerHTML = `
      <div style="background:${ZONE_COLORS.top.badgeBg};color:${ZONE_COLORS.top.badgeText};font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,0.4);white-space:nowrap;display:flex;align-items:center;gap:5px;">
        <span>▲</span> TOP (${topPct}%) • Scroll Up
      </div>
    `;

    bottomZone.style.cssText = `
      position: absolute;
      bottom: 0;
      left: ${leftPct}%;
      width: ${centerWidthPct}%;
      height: ${bottomPct}%;
      background: ${ZONE_COLORS.bottom.bg};
      border-top: 2px solid ${ZONE_COLORS.bottom.border};
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
      z-index: 1;
    `;
    bottomZone.innerHTML = `
      <div style="background:${ZONE_COLORS.bottom.badgeBg};color:${ZONE_COLORS.bottom.badgeText};font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,0.4);white-space:nowrap;display:flex;align-items:center;gap:5px;">
        <span>▼</span> BOTTOM (${bottomPct}%) • Scroll Down
      </div>
    `;

    centerZone.style.cssText = `
      position: absolute;
      top: ${topPct}%;
      left: ${leftPct}%;
      width: ${centerWidthPct}%;
      height: ${centerHeightPct}%;
      background: ${ZONE_COLORS.center.bg};
      border: 2px dashed ${ZONE_COLORS.center.border};
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
    `;
    centerZone.innerHTML = `
      <div style="background:${ZONE_COLORS.center.badgeBg};color:${ZONE_COLORS.center.badgeText};font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,0.4);text-align:center;white-space:nowrap;">
        <span>✦</span> CENTER (${centerWidthPct}% × ${centerHeightPct}%)<br><span style="font-size:9px;font-weight:600;opacity:0.85;">Toggle Controls & Nav</span>
      </div>
    `;
  } else {
    topZone.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: ${topPct}%;
      background: ${ZONE_COLORS.top.bg};
      border-bottom: 2px solid ${ZONE_COLORS.top.border};
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
      z-index: 2;
    `;
    topZone.innerHTML = `
      <div style="background:${ZONE_COLORS.top.badgeBg};color:${ZONE_COLORS.top.badgeText};font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,0.4);letter-spacing:0.5px;display:flex;align-items:center;gap:6px;">
        <span>▲</span> TOP (${topPct}%) • Scroll Up / Previous Post (Full Width)
      </div>
    `;

    bottomZone.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: ${bottomPct}%;
      background: ${ZONE_COLORS.bottom.bg};
      border-top: 2px solid ${ZONE_COLORS.bottom.border};
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
      z-index: 2;
    `;
    bottomZone.innerHTML = `
      <div style="background:${ZONE_COLORS.bottom.badgeBg};color:${ZONE_COLORS.bottom.badgeText};font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,0.4);letter-spacing:0.5px;display:flex;align-items:center;gap:6px;">
        <span>▼</span> BOTTOM (${bottomPct}%) • Scroll Down / Next Post (Full Width)
      </div>
    `;

    leftZone.style.cssText = `
      position: absolute;
      top: ${topPct}%;
      left: 0;
      width: ${leftPct}%;
      height: ${centerHeightPct}%;
      background: rgba(255, 255, 255, 0.03);
      border-right: 1px dashed rgba(255, 255, 255, 0.2);
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
      padding: 10px;
    `;
    leftZone.innerHTML = `
      <div style="background:rgba(255,255,255,0.1);color:#aaa;font-size:10px;font-weight:600;padding:4px 8px;border-radius:10px;text-align:center;">
        Single file<br>(No carousel)
      </div>
    `;

    rightZone.style.cssText = `
      position: absolute;
      top: ${topPct}%;
      right: 0;
      width: ${rightPct}%;
      height: ${centerHeightPct}%;
      background: rgba(255, 255, 255, 0.03);
      border-left: 1px dashed rgba(255, 255, 255, 0.2);
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
      padding: 10px;
    `;
    rightZone.innerHTML = `
      <div style="background:rgba(255,255,255,0.1);color:#aaa;font-size:10px;font-weight:600;padding:4px 8px;border-radius:10px;text-align:center;">
        Single file<br>(No carousel)
      </div>
    `;

    centerZone.style.cssText = `
      position: absolute;
      top: ${topPct}%;
      left: ${leftPct}%;
      width: ${centerWidthPct}%;
      height: ${centerHeightPct}%;
      background: ${ZONE_COLORS.center.bg};
      border: 2px dashed ${ZONE_COLORS.center.border};
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
    `;
    centerZone.innerHTML = `
      <div style="background:${ZONE_COLORS.center.badgeBg};color:${ZONE_COLORS.center.badgeText};font-size:12px;font-weight:700;padding:6px 16px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,0.4);text-align:center;">
        <span>✦</span> CENTER & SIDES<br><span style="font-size:10px;font-weight:600;opacity:0.85;">Toggle Controls & Nav</span>
      </div>
    `;
  }
}

function updateHoveredZone(clientX, clientY) {
  if (!visualizerEl || clientX === undefined || clientY === undefined) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const postInfo = getActivePostInfo();

  updateOverlayLayout(postInfo);

  const leftThreshold = w * edgeConfig.left;
  const rightThreshold = w * (1 - edgeConfig.right);
  const topThreshold = h * edgeConfig.top;
  const bottomThreshold = h * (1 - edgeConfig.bottom);

  let zoneKey = "center";
  if (postInfo.hasMultiple) {
    if (clientX < leftThreshold) {
      zoneKey = "left";
    } else if (clientX > rightThreshold) {
      zoneKey = "right";
    } else if (clientY < topThreshold) {
      zoneKey = "top";
    } else if (clientY > bottomThreshold) {
      zoneKey = "bottom";
    }
  } else {
    if (clientY < topThreshold) {
      zoneKey = "top";
    } else if (clientY > bottomThreshold) {
      zoneKey = "bottom";
    } else {
      zoneKey = "center";
    }
  }

  if (zoneKey !== activeZone) {
    activeZone = zoneKey;
    const zones = visualizerEl.querySelectorAll(".paw-zone");
    zones.forEach((z) => {
      const isCurrent = z.classList.contains(`paw-zone-${zoneKey}`);
      if (ZONE_COLORS[zoneKey]) {
        z.style.background = isCurrent
          ? ZONE_COLORS[zoneKey].bgActive
          : (ZONE_COLORS[z.className.replace("paw-zone paw-zone-", "")]?.bg || "transparent");
      }
    });

    const zoneLabel = hudEl?.querySelector("#paw-hud-zone");
    if (zoneLabel && ZONE_COLORS[zoneKey]) {
      zoneLabel.textContent = `Zone: ${ZONE_COLORS[zoneKey].name}`;
      zoneLabel.style.color = ZONE_COLORS[zoneKey].border;
    }
  }

  const coordsLabel = hudEl?.querySelector("#paw-hud-coords");
  if (coordsLabel) {
    const xPct = Math.round((clientX / w) * 100);
    const yPct = Math.round((clientY / h) * 100);
    coordsLabel.textContent = `X:${clientX} (${xPct}%) Y:${clientY} (${yPct}%)`;
  }
}

export function setEdgeSizes(...args) {
  let newTop = edgeConfig.top;
  let newBottom = edgeConfig.bottom;
  let newLeft = edgeConfig.left;
  let newRight = edgeConfig.right;

  if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
    const opt = args[0];
    if (opt.top !== undefined) newTop = opt.top > 1 ? opt.top / 100 : opt.top;
    if (opt.bottom !== undefined) newBottom = opt.bottom > 1 ? opt.bottom / 100 : opt.bottom;
    if (opt.left !== undefined) newLeft = opt.left > 1 ? opt.left / 100 : opt.left;
    if (opt.right !== undefined) newRight = opt.right > 1 ? opt.right / 100 : opt.right;
    if (opt.vertical !== undefined) {
      const v = opt.vertical > 1 ? opt.vertical / 100 : opt.vertical;
      newTop = v;
      newBottom = v;
    }
    if (opt.horizontal !== undefined) {
      const h = opt.horizontal > 1 ? opt.horizontal / 100 : opt.horizontal;
      newLeft = h;
      newRight = h;
    }
  } else if (args.length >= 2 && typeof args[0] === "number" && typeof args[1] === "number") {
    const v = args[0] > 1 ? args[0] / 100 : args[0];
    const h = args[1] > 1 ? args[1] / 100 : args[1];
    newTop = v;
    newBottom = v;
    newLeft = h;
    newRight = h;
  }

  edgeConfig.top = Math.max(0.01, Math.min(0.45, newTop));
  edgeConfig.bottom = Math.max(0.01, Math.min(0.45, newBottom));
  edgeConfig.left = Math.max(0.01, Math.min(0.45, newLeft));
  edgeConfig.right = Math.max(0.01, Math.min(0.45, newRight));

  try {
    localStorage.setItem("paw_edge_config", JSON.stringify(edgeConfig));
  } catch (_) {}

  if (visualizerEl) {
    updateOverlayLayout(getActivePostInfo(), true);
  }

  console.log(
    `%c[Paw Reader] Edge Sizes Updated:\n` +
    `  • Top: ${Math.round(edgeConfig.top * 100)}%\n` +
    `  • Bottom: ${Math.round(edgeConfig.bottom * 100)}%\n` +
    `  • Left: ${Math.round(edgeConfig.left * 100)}%\n` +
    `  • Right: ${Math.round(edgeConfig.right * 100)}%`,
    "font-weight:bold;color:#00e5ff;"
  );
  return edgeConfig;
}

export function resetEdgeSizes() {
  return setEdgeSizes(DEFAULT_EDGE_CONFIG);
}

export function toggleEdgeVisualizer(forceState) {
  const shouldEnable = typeof forceState === "boolean" ? forceState : !visualizerEl;

  if (shouldEnable) {
    createOverlay();
    localStorage.setItem("paw_show_edges", "true");

    const settingCheckbox = document.getElementById("setting-visualize-edges");
    if (settingCheckbox && !settingCheckbox.checked) {
      settingCheckbox.checked = true;
    }

    if (!pointerListener) {
      pointerListener = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        updateHoveredZone(clientX, clientY);
      };
      window.addEventListener("pointermove", pointerListener, { passive: true });
      window.addEventListener("touchmove", pointerListener, { passive: true });
    }

    if (!scrollListener) {
      scrollListener = () => {
        if (!visualizerEl) return;
        updateOverlayLayout(getActivePostInfo());
      };
      const feed = document.getElementById("feed");
      if (feed) feed.addEventListener("scroll", scrollListener, { passive: true });
      const zipContent = document.getElementById("zip-content");
      if (zipContent) zipContent.addEventListener("scroll", scrollListener, { passive: true });
      window.addEventListener("scroll", scrollListener, { passive: true });
    }

    const t = Math.round(edgeConfig.top * 100);
    const b = Math.round(edgeConfig.bottom * 100);
    const l = Math.round(edgeConfig.left * 100);
    const r = Math.round(edgeConfig.right * 100);

    console.log(
      `%c[Paw Reader] Edge Navigation Visualizer ENABLED\n` +
      `%c◀ Left (${l}%): Carousel Previous %c[Green - Corners Priority on 2+ files]\n` +
      `%c▶ Right (${r}%): Carousel Next %c[Purple - Corners Priority on 2+ files]\n` +
      `%c▲ Top (${t}%): Scroll Up (Previous Post) %c[Blue]\n` +
      `%c▼ Bottom (${b}%): Scroll Down (Next Post) %c[Red]\n` +
      `%c✦ Center: Toggle Controls & Nav %c[Yellow]\n` +
      `%cChange sizes via pawSetEdges(vertical, horizontal) or pawSetEdges({ top, bottom, left, right })\n` +
      `Run pawEdges() or type edges to disable.`,
      "font-weight:bold;font-size:13px;color:#00e5ff;",
      "color:#06d6a0;font-weight:bold;", "color:#888;",
      "color:#9d4edd;font-weight:bold;", "color:#888;",
      "color:#00b4d8;font-weight:bold;", "color:#888;",
      "color:#ef476f;font-weight:bold;", "color:#888;",
      "color:#ffd166;font-weight:bold;", "color:#888;",
      "color:#38bdf8;font-style:italic;",
      "color:#aaa;font-style:italic;"
    );
    return "Edge visualizer enabled. Type pawEdges() to disable.";
  } else {
    if (visualizerEl) {
      visualizerEl.remove();
      visualizerEl = null;
      hudEl = null;
      activeZone = null;
      currentLayoutHasMultiple = null;
    }
    if (pointerListener) {
      window.removeEventListener("pointermove", pointerListener);
      window.removeEventListener("touchmove", pointerListener);
      pointerListener = null;
    }
    if (scrollListener) {
      const feed = document.getElementById("feed");
      if (feed) feed.removeEventListener("scroll", scrollListener);
      const zipContent = document.getElementById("zip-content");
      if (zipContent) zipContent.removeEventListener("scroll", scrollListener);
      window.removeEventListener("scroll", scrollListener);
      scrollListener = null;
    }
    localStorage.removeItem("paw_show_edges");

    const settingCheckbox = document.getElementById("setting-visualize-edges");
    if (settingCheckbox && settingCheckbox.checked) {
      settingCheckbox.checked = false;
    }

    console.log("%c[Paw Reader] Edge Navigation Visualizer DISABLED", "color:#888;font-style:italic;");
    return "Edge visualizer disabled.";
  }
}

export function initEdgeVisualizer() {
  const settingCheckbox = document.getElementById("setting-visualize-edges");
  if (settingCheckbox) {
    settingCheckbox.checked = localStorage.getItem("paw_show_edges") === "true";
  }
  window.pawEdges = toggleEdgeVisualizer;
  window.pawShowEdges = toggleEdgeVisualizer;
  window.pawToggleEdges = toggleEdgeVisualizer;
  window.toggleEdges = toggleEdgeVisualizer;
  window.showEdges = toggleEdgeVisualizer;
  window.visualizeEdges = toggleEdgeVisualizer;

  window.pawSetEdges = setEdgeSizes;
  window.pawSetEdgeSizes = setEdgeSizes;
  window.setEdges = setEdgeSizes;
  window.setEdgeSizes = setEdgeSizes;
  window.pawResetEdges = resetEdgeSizes;
  window.resetEdges = resetEdgeSizes;

  try {
    Object.defineProperty(window, "edges", {
      get: () => toggleEdgeVisualizer(),
      configurable: true
    });
  } catch (_) {}

  if (localStorage.getItem("paw_show_edges") === "true") {
    toggleEdgeVisualizer(true);
  }
}
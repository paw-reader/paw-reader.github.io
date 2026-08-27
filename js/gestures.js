import { state } from "./state.js";
import { closeAllPostInfo, feedView, creatorsView, welcomeScreen, showView, updateNavTabs } from "./nav.js";
import { feed, navigateCarousel, recycleOffscreenCards, resetFeed } from "./feed.js";
import { zipViewer, zipContent, setZipNavVisible } from "./zip.js";

export function initGestures() {
  let feedScrollTimeout;
  let recycleTimeout;
  
  let activeCardIndex = 0;
  let isResizing = false;
  let resizeTimer = null;

  window.addEventListener("resize", () => {
    if (!feed || !feedView || !feedView.classList.contains("active")) return;
    
    isResizing = true;
    feed.style.scrollSnapType = "none"; 
    
    // FIX 1: Instantly snap the vertical feed before the screen paints the new layout
    const h = window.innerHeight;
    feed.scrollTo({ top: activeCardIndex * h, behavior: "auto" });

    const carousels = feed.querySelectorAll(".media-carousel");
    carousels.forEach(c => {
      c.style.scrollSnapType = "none";
      if (!c.dataset.rawIndex) {
        c.dataset.rawIndex = c.children.length > 1 ? "1" : "0";
      }
      // FIX 2: Instantly snap the horizontal images so they don't flash the old pixel positions
      const w = c.clientWidth || window.innerWidth;
      const targetIndex = parseInt(c.dataset.rawIndex, 10) || 0;
      c.scrollTo({ left: targetIndex * w, behavior: "auto" });
    });
    
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Safety pass: Mobile browsers often change dimensions a second time as the URL bar hides/shows
      const finalH = window.innerHeight;
      feed.scrollTo({ top: activeCardIndex * finalH, behavior: "auto" });
      
      carousels.forEach(c => {
        const finalW = c.clientWidth || window.innerWidth;
        const targetIndex = parseInt(c.dataset.rawIndex, 10) || 0;
        c.scrollTo({ left: targetIndex * finalW, behavior: "auto" });
        c.style.scrollSnapType = "";
      });
      
      feed.style.scrollSnapType = "";
      isResizing = false;
    }, 150); 
  });

  if (feed) {
    feed.addEventListener("scroll", (e) => {
      if (!isResizing) {
        const h = window.innerHeight || 1;
        activeCardIndex = Math.round(feed.scrollTop / h);
      }

      closeAllPostInfo();
      const el = e.target;
      clearTimeout(feedScrollTimeout);
      feedScrollTimeout = setTimeout(() => {
        delete el.dataset.targetScroll;
        delete el.dataset.scrollDir;
        el.style.scrollSnapType = "";
      }, 150);

      clearTimeout(recycleTimeout);
      recycleTimeout = setTimeout(recycleOffscreenCards, 80);
    });
  }

  document.addEventListener(
    "scroll",
    (e) => {
      if (!e.target || !e.target.classList) return;
      if (e.target.classList.contains("media-carousel")) {
        closeAllPostInfo();
        if (!isResizing) {
          const w = e.target.clientWidth || window.innerWidth;
          e.target.dataset.rawIndex = Math.round(e.target.scrollLeft / w);
        }
      }
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName.toLowerCase() === "input") return;

    if (e.key === "Escape" || (e.key === "Shift" && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();

      if (zipViewer && !zipViewer.classList.contains("hidden")) {
        setZipNavVisible(false, true);
        zipViewer.classList.add("hidden");
        if (zipContent) zipContent.innerHTML = "";
        state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        state.currentZipObjectUrls = [];
        return;
      }

      if (feedView && feedView.classList.contains("active")) {
        const navBackBtn = document.getElementById("nav-back");
        const wasCreatorFeed = !!state.currentFeedCreatorName;
        
        state.currentFeedCreatorName = null;
        updateNavTabs(null);
        resetFeed();

        if (wasCreatorFeed) {
          showView(creatorsView, true);
        } else {
          showView(welcomeScreen, false);
          if (navBackBtn) navBackBtn.classList.add("hidden");
        }
        return;
      }

      if (creatorsView && creatorsView.classList.contains("active")) {
        state.currentFeedCreatorName = null;
        updateNavTabs(null);
        resetFeed();
        showView(welcomeScreen, false);
        const navBackBtn = document.getElementById("nav-back");
        if (navBackBtn) navBackBtn.classList.add("hidden");
        return;
      }
    }

    const h = window.innerHeight;

    if (zipViewer && !zipViewer.classList.contains("hidden")) {
      const count = state.currentZipObjectUrls.length;
      if (!zipContent || count <= 1) return;

      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
        e.preventDefault();
        navigateCarousel(zipContent, "left", count, true);
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
        e.preventDefault();
        navigateCarousel(zipContent, "right", count, true);
      }
      return;
    }

    if (!feedView || !feedView.classList.contains("active")) return;

    if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
      e.preventDefault();
      let target =
        feed.dataset.targetScroll !== undefined
          ? parseFloat(feed.dataset.targetScroll)
          : Math.round(feed.scrollTop / h) * h;
      target = Math.max(0, target - h);
      feed.dataset.targetScroll = target;
      feed.dataset.scrollDir = "up";
      feed.style.scrollSnapType = "none";
      feed.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? "auto" : "smooth" });
    } else if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") {
      e.preventDefault();
      let target =
        feed.dataset.targetScroll !== undefined
          ? parseFloat(feed.dataset.targetScroll)
          : Math.round(feed.scrollTop / h) * h;
      target = Math.min(target + h, feed.scrollHeight - feed.clientHeight);
      feed.dataset.targetScroll = target;
      feed.dataset.scrollDir = "down";
      feed.style.scrollSnapType = "none";
      feed.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? "auto" : "smooth" });
    } else if (
      e.key === "ArrowLeft" ||
      e.key.toLowerCase() === "a" ||
      e.key === "ArrowRight" ||
      e.key.toLowerCase() === "d"
    ) {
      const currentIndex = Math.round(feed.scrollTop / h);
      const currentCard = feed.children[currentIndex];
      if (!currentCard) return;
      const carousel = currentCard.querySelector(".media-carousel");
      if (!carousel || carousel.children.length <= 1) return;

      e.preventDefault();
      navigateCarousel(
        carousel,
        e.key === "ArrowLeft" || e.key.toLowerCase() === "a" ? "left" : "right",
        undefined,
        true
      );
    }
  });

  let wheelAccumX = 0;
  let wheelAccumY = 0;
  let wheelAccumTimer = null;
  const SCROLL_THRESHOLD = 50;

  document.addEventListener(
    "wheel",
    (e) => {
      if (!window.pawAnimationsDisabled) return;
      if (
        e.target.closest("#zip-settings-viewer") ||
        e.target.closest("#settings-menu") ||
        e.target.closest(".media-progress") ||
        e.target.closest("#creators-view") ||
        e.target.closest(".zip-info-text")
      )
        return;

      const textCard = e.target.closest(".post-text-card");
      if (textCard) {
        const atTop = textCard.scrollTop <= 0 && e.deltaY < 0;
        const atBottom = textCard.scrollHeight - textCard.scrollTop <= textCard.clientHeight + 1 && e.deltaY > 0;
        if (!atTop && !atBottom) return;
      }

      e.preventDefault();

      let multiplier = 1;
      if (e.deltaMode === 1) multiplier = 50; 
      else if (e.deltaMode === 2) multiplier = 800; 

      wheelAccumX += e.deltaX * multiplier;
      wheelAccumY += e.deltaY * multiplier;

      clearTimeout(wheelAccumTimer);
      wheelAccumTimer = setTimeout(() => {
        wheelAccumX = 0;
        wheelAccumY = 0;
      }, 150);

      let stepsX = Math.trunc(wheelAccumX / SCROLL_THRESHOLD);
      let stepsY = Math.trunc(wheelAccumY / SCROLL_THRESHOLD);

      if (stepsX === 0 && stepsY === 0) return;

      const carousel = e.target.closest(".media-carousel");
      const zipC = e.target.closest("#zip-content");
      const feedEl = e.target.closest("#feed");

      if (zipC && zipViewer && !zipViewer.classList.contains("hidden")) {
        wheelAccumX -= stepsX * SCROLL_THRESHOLD;
        wheelAccumY -= stepsY * SCROLL_THRESHOLD;
        
        let steps = Math.abs(stepsX) >= Math.abs(stepsY) ? stepsX : stepsY;
        
        let clampedStep = Math.sign(steps); 

        const w = window.innerWidth;
        let target = Math.round(zipC.scrollLeft / w) * w;
        target += clampedStep * w;
        target = Math.max(0, Math.min(target, zipC.scrollWidth - zipC.clientWidth));
        zipC.scrollTo({ left: target, behavior: "auto" });
      } else if (carousel && Math.abs(wheelAccumX) > Math.abs(wheelAccumY)) {
        wheelAccumX -= stepsX * SCROLL_THRESHOLD;

        let clampedStep = Math.sign(stepsX); 

        const w = window.innerWidth;
        let target = Math.round(carousel.scrollLeft / w) * w;
        target += clampedStep * w;
        target = Math.max(0, Math.min(target, carousel.scrollWidth - carousel.clientWidth));
        carousel.scrollTo({ left: target, behavior: "auto" });
        wheelAccumY = 0;
      } else if (feedEl && feedView && !feedView.classList.contains("hidden")) {
        wheelAccumY -= stepsY * SCROLL_THRESHOLD;

        const h = window.innerHeight;
        let target = Math.round(feedEl.scrollTop / h) * h;
        target += stepsY * h;
        target = Math.max(0, Math.min(target, feedEl.scrollHeight - feedEl.clientHeight));
        feedEl.scrollTo({ top: target, behavior: "auto" });
        wheelAccumX = 0;
      }
    },
    { passive: false }
  );

  let globalTouchStartX = 0;
  let globalTouchStartY = 0;
  let touchHijackHandled = false;

  document.addEventListener(
    "touchstart",
    (e) => {
      if (!window.pawAnimationsDisabled) return;
      if (e.touches.length !== 1) return;
      globalTouchStartX = e.touches[0].clientX;
      globalTouchStartY = e.touches[0].clientY;
      touchHijackHandled = false;
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!window.pawAnimationsDisabled) return;
      if (
        e.target.closest("#zip-settings-viewer") ||
        e.target.closest("#settings-menu") ||
        e.target.closest(".media-progress") ||
        e.target.closest("#creators-view") ||
        e.target.closest(".zip-info-text")
      )
        return;

      const textCard = e.target.closest(".post-text-card");
      if (textCard) {
        const dy = globalTouchStartY - e.touches[0].clientY;
        const atTop = textCard.scrollTop <= 0 && dy < 0;
        const atBottom = textCard.scrollHeight - textCard.scrollTop <= textCard.clientHeight + 1 && dy > 0;
        if (!atTop && !atBottom) return;
      }

      if (e.cancelable) e.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener("touchend", (e) => {
    if (!window.pawAnimationsDisabled) return;
    if (
      e.target.closest("#zip-settings-viewer") ||
      e.target.closest("#settings-menu") ||
      e.target.closest(".media-progress") ||
      e.target.closest("#creators-view") ||
      e.target.closest(".zip-info-text")
    )
      return;

    const textCard = e.target.closest(".post-text-card");
    if (textCard) {
      const dy = globalTouchStartY - e.changedTouches[0].clientY;
      const atTop = textCard.scrollTop <= 0 && dy < 0;
      const atBottom = textCard.scrollHeight - textCard.scrollTop <= textCard.clientHeight + 1 && dy > 0;
      if (!atTop && !atBottom) return;
    }

    if (touchHijackHandled) return;

    const dx = globalTouchStartX - e.changedTouches[0].clientX;
    const dy = globalTouchStartY - e.changedTouches[0].clientY;

    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return;
    touchHijackHandled = true;

    const carousel = e.target.closest(".media-carousel");
    const zipC = e.target.closest("#zip-content");
    const feedEl = e.target.closest("#feed");

    if (zipC && zipViewer && !zipViewer.classList.contains("hidden")) {
      if (Math.abs(dx) > Math.abs(dy)) {
        const w = window.innerWidth;
        let target = Math.round(zipC.scrollLeft / w) * w;
        if (dx > 30) target += w;
        else if (dx < -30) target -= w;
        target = Math.max(0, Math.min(target, zipC.scrollWidth - zipC.clientWidth));
        zipC.scrollTo({ left: target, behavior: "auto" });
      }
    } else if (carousel && Math.abs(dx) > Math.abs(dy)) {
      const w = window.innerWidth;
      let target = Math.round(carousel.scrollLeft / w) * w;
      if (dx > 30) target += w;
      else if (dx < -30) target -= w;
      target = Math.max(0, Math.min(target, carousel.scrollWidth - carousel.clientWidth));
      carousel.scrollTo({ left: target, behavior: "auto" });
    } else if (feedEl && feedView && !feedView.classList.contains("hidden")) {
      const h = window.innerHeight;
      let target = Math.round(feedEl.scrollTop / h) * h;
      if (dy > 30) target += h;
      else if (dy < -30) target -= h;
      target = Math.max(0, Math.min(target, feedEl.scrollHeight - feedEl.clientHeight));
      feedEl.scrollTo({ top: target, behavior: "auto" });
    }
  });
}

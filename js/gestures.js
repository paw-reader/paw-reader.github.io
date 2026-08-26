import { state } from './state.js';
import { closeAllPostInfo, feedView } from './nav.js';
import { feed } from './feed.js';
import { zipViewer, zipContent } from './zip.js';

export function initGestures() {
  let feedScrollTimeout;
  if (feed) {
    feed.addEventListener('scroll', (e) => {
      closeAllPostInfo();
      const el = e.target;
      clearTimeout(feedScrollTimeout);
      feedScrollTimeout = setTimeout(() => {
        delete el.dataset.targetScroll;
        delete el.dataset.scrollDir;
        el.style.scrollSnapType = '';
      }, 150);
    });
  }

  document.addEventListener('scroll', (e) => {
    if (!e.target || !e.target.classList) return;
    
    if (e.target.classList.contains('media-carousel') || e.target.id === 'zip-content' || e.target.id === 'feed') {
      if (e.target.classList.contains('media-carousel')) {
        closeAllPostInfo();
      }
      const container = e.target;
      if (!window.containerScrollTimeouts) window.containerScrollTimeouts = new Map();
      clearTimeout(window.containerScrollTimeouts.get(container));
      window.containerScrollTimeouts.set(container, setTimeout(() => {
        delete container.dataset.targetScroll;
        delete container.dataset.scrollDir;
        if (container.id === 'feed') {
          container.style.scrollSnapType = '';
        } else if (container.id === 'zip-content') {
          container.style.scrollSnapType = 'x mandatory';
        } else {
          container.style.scrollSnapType = '';
        }
      }, 150));
    }
  }, true);

  let isMouseSwiping = false;
  let swipeStartX = 0;
  let swipeStartY = 0;

  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.post-info.expanded')) return;
    
    const x = e.clientX;
    const y = e.clientY;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (y < h * 0.15 || y > h * 0.85 || x < w * 0.20 || x > w * 0.80) {
      return;
    }
    
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
    isMouseSwiping = true;
  });

  document.addEventListener('mouseup', (e) => {
    if (!isMouseSwiping) return;
    isMouseSwiping = false;
    
    const dx = e.clientX - swipeStartX;
    const dy = e.clientY - swipeStartY;
    
    if (Math.abs(dx) > 50 || Math.abs(dy) > 50) {
      const card = e.target.closest('.post-card');
      if (card) {
        card.dataset.isDragging = 'true';
        const carousel = card.querySelector('.media-carousel');
        const w = window.innerWidth;
        const h = window.innerHeight;
        
        if (Math.abs(dy) > Math.abs(dx)) {
          if (dy > 50) feed.scrollBy({ top: -h, behavior: window.pawAnimationsDisabled ? 'auto' : 'smooth' });
          else feed.scrollBy({ top: h, behavior: window.pawAnimationsDisabled ? 'auto' : 'smooth' });
        } else if (carousel) {
          let target = Math.round(carousel.scrollLeft / w) * w;
          let isWrap = false;
          if (dx > 50) {
             target -= w;
             if (target < 0) {
               target = carousel.scrollWidth - carousel.clientWidth;
               isWrap = true;
             }
          } else {
             target += w;
             if (target > carousel.scrollWidth - carousel.clientWidth) {
               target = 0;
               isWrap = true;
             }
          }
          carousel.dataset.targetScroll = target;
          carousel.style.scrollSnapType = 'none';
          carousel.scrollTo({ left: target, behavior: window.pawAnimationsDisabled ? 'auto' : 'smooth' });
        }
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName.toLowerCase() === 'input') return;

    const h = window.innerHeight;
    const w = window.innerWidth;

    if (zipViewer && !zipViewer.classList.contains('hidden')) {
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        e.preventDefault();
        let target = zipContent.dataset.targetScroll !== undefined ? parseFloat(zipContent.dataset.targetScroll) : Math.round(zipContent.scrollLeft / w) * w;
        target = target - w;
        let isWrap = false;
        if (target < 0) {
          target = zipContent.scrollWidth - zipContent.clientWidth;
          isWrap = true;
        }
        zipContent.dataset.targetScroll = target;
        zipContent.dataset.scrollDir = 'left';
        zipContent.style.scrollSnapType = 'none';
        zipContent.scrollTo({ left: target, behavior: (isWrap || window.pawAnimationsDisabled) ? 'auto' : 'smooth' });
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
        e.preventDefault();
        let target = zipContent.dataset.targetScroll !== undefined ? parseFloat(zipContent.dataset.targetScroll) : Math.round(zipContent.scrollLeft / w) * w;
        target = target + w;
        let isWrap = false;
        if (target > zipContent.scrollWidth - zipContent.clientWidth) {
          target = 0;
          isWrap = true;
        }
        zipContent.dataset.targetScroll = target;
        zipContent.dataset.scrollDir = 'right';
        zipContent.style.scrollSnapType = 'none';
        zipContent.scrollTo({ left: target, behavior: (isWrap || window.pawAnimationsDisabled) ? 'auto' : 'smooth' });
      }
      return;
    }

    if (!feedView || !feedView.classList.contains('active')) return;
    
    if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') {
      e.preventDefault();
      let target = feed.dataset.targetScroll !== undefined ? parseFloat(feed.dataset.targetScroll) : Math.round(feed.scrollTop / h) * h;
      target = Math.max(0, target - h);
      feed.dataset.targetScroll = target;
      feed.dataset.scrollDir = 'up';
      feed.style.scrollSnapType = 'none';
      feed.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? 'auto' : 'smooth' });
    } 
    else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') {
      e.preventDefault();
      let target = feed.dataset.targetScroll !== undefined ? parseFloat(feed.dataset.targetScroll) : Math.round(feed.scrollTop / h) * h;
      target = Math.min(target + h, feed.scrollHeight - feed.clientHeight);
      feed.dataset.targetScroll = target;
      feed.dataset.scrollDir = 'down';
      feed.style.scrollSnapType = 'none';
      feed.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? 'auto' : 'smooth' });
    }
    else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a' || e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
      const currentIndex = Math.round(feed.scrollTop / h);
      const currentCard = feed.children[currentIndex];
      if (!currentCard) return;
      const carousel = currentCard.querySelector('.media-carousel');
      if (!carousel || carousel.children.length <= 1) return;

      e.preventDefault();

      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        let target = carousel.dataset.targetScroll !== undefined ? parseFloat(carousel.dataset.targetScroll) : Math.round(carousel.scrollLeft / w) * w;
        target = target - w;
        let isWrap = false;
        if (target < 0) {
           target = carousel.scrollWidth - carousel.clientWidth;
           isWrap = true;
        }
        carousel.dataset.targetScroll = target;
        carousel.dataset.scrollDir = 'left';
        carousel.style.scrollSnapType = 'none';
        carousel.scrollTo({ left: target, behavior: (isWrap || window.pawAnimationsDisabled) ? 'auto' : 'smooth' });
      } 
      else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
        let target = carousel.dataset.targetScroll !== undefined ? parseFloat(carousel.dataset.targetScroll) : Math.round(carousel.scrollLeft / w) * w;
        target = target + w;
        let isWrap = false;
        if (target > carousel.scrollWidth - carousel.clientWidth) {
           target = 0;
           isWrap = true;
        }
        carousel.dataset.targetScroll = target;
        carousel.dataset.scrollDir = 'right';
        carousel.style.scrollSnapType = 'none';
        carousel.scrollTo({ left: target, behavior: (isWrap || window.pawAnimationsDisabled) ? 'auto' : 'smooth' });
      }
    }
  });

  // --- Scroll Momentum Hijacker for Disabled Animations ---
  let wheelAccumX = 0;
  let wheelAccumY = 0;
  let wheelAccumTimer = null;
  const SCROLL_THRESHOLD = 80;

  document.addEventListener('wheel', (e) => {
    if (!window.pawAnimationsDisabled) return;
    if (e.target.closest('#zip-settings-viewer') || e.target.closest('#settings-menu') || e.target.closest('.media-progress') || e.target.closest('.creator-list') || e.target.closest('.zip-info-text') || e.target.closest('.post-text-card')) return;
    
    e.preventDefault();
    
    wheelAccumX += e.deltaX;
    wheelAccumY += e.deltaY;
    
    clearTimeout(wheelAccumTimer);
    wheelAccumTimer = setTimeout(() => {
      wheelAccumX = 0;
      wheelAccumY = 0;
    }, 150);
    
    let stepsX = Math.trunc(wheelAccumX / SCROLL_THRESHOLD);
    let stepsY = Math.trunc(wheelAccumY / SCROLL_THRESHOLD);
    
    if (stepsX === 0 && stepsY === 0) return;
    
    const carousel = e.target.closest('.media-carousel');
    const zipC = e.target.closest('#zip-content');
    const feedEl = e.target.closest('#feed');
    
    if (zipC && zipViewer && !zipViewer.classList.contains('hidden')) {
      wheelAccumX -= stepsX * SCROLL_THRESHOLD;
      wheelAccumY -= stepsY * SCROLL_THRESHOLD;
      let steps = Math.abs(stepsX) >= Math.abs(stepsY) ? stepsX : stepsY;
      
      const w = window.innerWidth;
      let target = Math.round(zipC.scrollLeft / w) * w;
      target += steps * w;
      target = Math.max(0, Math.min(target, zipC.scrollWidth - zipC.clientWidth));
      zipC.scrollTo({ left: target, behavior: 'auto' });
      
    } else if (carousel && Math.abs(wheelAccumX) > Math.abs(wheelAccumY)) {
      wheelAccumX -= stepsX * SCROLL_THRESHOLD;
      
      const w = window.innerWidth;
      let target = Math.round(carousel.scrollLeft / w) * w;
      target += stepsX * w;
      target = Math.max(0, Math.min(target, carousel.scrollWidth - carousel.clientWidth));
      carousel.scrollTo({ left: target, behavior: 'auto' });
      wheelAccumY = 0;
      
    } else if (feedEl && feedView && !feedView.classList.contains('hidden')) {
      wheelAccumY -= stepsY * SCROLL_THRESHOLD;
      
      const h = window.innerHeight;
      let target = Math.round(feedEl.scrollTop / h) * h;
      target += stepsY * h;
      target = Math.max(0, Math.min(target, feedEl.scrollHeight - feedEl.clientHeight));
      feedEl.scrollTo({ top: target, behavior: 'auto' });
      wheelAccumX = 0;
    }
  }, { passive: false });

  let globalTouchStartX = 0;
  let globalTouchStartY = 0;
  let touchHijackHandled = false;

  document.addEventListener('touchstart', (e) => {
    if (!window.pawAnimationsDisabled) return;
    if (e.touches.length !== 1) return;
    globalTouchStartX = e.touches[0].clientX;
    globalTouchStartY = e.touches[0].clientY;
    touchHijackHandled = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!window.pawAnimationsDisabled) return;
    if (e.target.closest('#zip-settings-viewer') || e.target.closest('#settings-menu') || e.target.closest('.media-progress') || e.target.closest('.creator-list') || e.target.closest('.zip-info-text') || e.target.closest('.post-text-card')) return;
    
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (!window.pawAnimationsDisabled) return;
    if (e.target.closest('#zip-settings-viewer') || e.target.closest('#settings-menu') || e.target.closest('.media-progress') || e.target.closest('.creator-list') || e.target.closest('.zip-info-text') || e.target.closest('.post-text-card')) return;
    if (touchHijackHandled) return;
    
    const dx = globalTouchStartX - e.changedTouches[0].clientX;
    const dy = globalTouchStartY - e.changedTouches[0].clientY;
    
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return;
    touchHijackHandled = true;
    
    const carousel = e.target.closest('.media-carousel');
    const zipC = e.target.closest('#zip-content');
    const feedEl = e.target.closest('#feed');
    
    if (zipC && zipViewer && !zipViewer.classList.contains('hidden')) {
      if (Math.abs(dx) > Math.abs(dy)) {
         const w = window.innerWidth;
         let target = Math.round(zipC.scrollLeft / w) * w;
         if (dx > 30) target += w;
         else if (dx < -30) target -= w;
         target = Math.max(0, Math.min(target, zipC.scrollWidth - zipC.clientWidth));
         zipC.scrollTo({ left: target, behavior: 'auto' });
      }
    } else if (carousel && Math.abs(dx) > Math.abs(dy)) {
      const w = window.innerWidth;
      let target = Math.round(carousel.scrollLeft / w) * w;
      if (dx > 30) target += w;
      else if (dx < -30) target -= w;
      target = Math.max(0, Math.min(target, carousel.scrollWidth - carousel.clientWidth));
      carousel.scrollTo({ left: target, behavior: 'auto' });
    } else if (feedEl && feedView && !feedView.classList.contains('hidden')) {
      const h = window.innerHeight;
      let target = Math.round(feedEl.scrollTop / h) * h;
      if (dy > 30) target += h;
      else if (dy < -30) target -= h;
      target = Math.max(0, Math.min(target, feedEl.scrollHeight - feedEl.clientHeight));
      feedEl.scrollTo({ top: target, behavior: 'auto' });
    }
  });
}

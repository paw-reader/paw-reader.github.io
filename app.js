import { PROXY_URL, state } from './js/state.js';
import {
  welcomeScreen,
  creatorsView,
  feedView,
  nav,
  navHome,
  navBack,
  navInfo,
  navSettings,
  settingsMenu,
  siteSelector,
  isNavInteractive,
  updateNavVisibility,
  updateSiteSpecificUI,
  updateNavTabs,
  showView
} from './js/nav.js';
import {
  searchInput,
  sortSelect,
  sortDirBtn,
  serviceFilterSelect,
  contentFilterSelect,
  genderFilterSelect,
  loadCreators,
  filterAndSortCreators
} from './js/creators.js';
import { resetFeed, fetchPosts, navigateCarousel, handleCarouselScrollSettled } from './js/feed.js';
import {
  zipViewer,
  zipContent,
  zipIndicator,
  closeZipViewer,
  zipHomeViewer,
  zipSettingsViewer,
  isZipNavInteractive,
  setZipNavVisible,
  updateZipNavVisibility,
  closeZipGallery
} from './js/zip.js';
import { initGestures } from './js/gestures.js';

window.pawAnimationsDisabled = localStorage.getItem('paw_animations_disabled') === 'true';
window.pawAutoDownloadZip = localStorage.getItem('paw_auto_download_zip') === 'true';
window.pawHideCovers = localStorage.getItem('paw_hide_covers') === 'true';
const savedPreload = localStorage.getItem('paw_preload_count');
window.pawPreloadCount = savedPreload !== null ? parseInt(savedPreload, 10) : 1;
if (window.pawAnimationsDisabled) document.body.classList.add('no-animations');

function formatWorkerVersion(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  const uuidMatch = trimmed.match(/^([0-9a-f]{8})-[0-9a-f]{4}/i);
  if (uuidMatch) {
    return uuidMatch[1].toLowerCase();
  }
  const hexMatch = trimmed.match(/^[0-9a-f]{8}$/i);
  if (hexMatch) {
    return hexMatch[0].toLowerCase();
  }
  return trimmed;
}

(async function checkWorkerVersion() {
  try {
    const res = await fetch(`${PROXY_URL}/version`);
    if (res.ok) {
      const data = await res.json();
      const rawVersion = (data && data.version) ? data.version : (data && data.id ? data.id : data);
      const version = formatWorkerVersion(rawVersion);
      window.pawWorkerVersion = version;
      console.log(`Worker deployed version: ${version}`);
    } else {
      const headerVersion = res.headers.get('X-Worker-Version');
      if (headerVersion) {
        const version = formatWorkerVersion(headerVersion);
        window.pawWorkerVersion = version;
        console.log(`Worker deployed version: ${version}`);
      } else {
        console.warn(`Worker deployed version: Unknown (HTTP ${res.status})`);
      }
    }
  } catch (err) {
    console.warn('Worker deployed version: Unable to connect to worker', err);
  }
})();

const settingHideNoMedia = document.getElementById('setting-hide-no-media');
if (settingHideNoMedia) {
  settingHideNoMedia.checked = localStorage.getItem('paw_hideNoMedia') === 'true';
  settingHideNoMedia.addEventListener('change', () => {
    localStorage.setItem('paw_hideNoMedia', settingHideNoMedia.checked);
    if (feedView && feedView.classList.contains('active')) {
      resetFeed();
      fetchPosts();
    }
  });
}

const settingDisableAnimations = document.getElementById('setting-disable-animations');
if (settingDisableAnimations) {
  settingDisableAnimations.checked = window.pawAnimationsDisabled;
  settingDisableAnimations.addEventListener('change', (e) => {
    window.pawAnimationsDisabled = e.target.checked;
    localStorage.setItem('paw_animations_disabled', window.pawAnimationsDisabled);
    if (window.pawAnimationsDisabled) {
      document.body.classList.add('no-animations');
    } else {
      document.body.classList.remove('no-animations');
    }
  });
}

const settingAutoDownloadZip = document.getElementById('setting-auto-download-zip');
if (settingAutoDownloadZip) {
  settingAutoDownloadZip.checked = window.pawAutoDownloadZip;
  settingAutoDownloadZip.addEventListener('change', (e) => {
    window.pawAutoDownloadZip = e.target.checked;
    localStorage.setItem('paw_auto_download_zip', window.pawAutoDownloadZip);
  });
}

const settingHideCovers = document.getElementById('setting-hide-covers');
if (settingHideCovers) {
  settingHideCovers.checked = window.pawHideCovers;
  settingHideCovers.addEventListener('change', (e) => {
    window.pawHideCovers = e.target.checked;
    localStorage.setItem('paw_hide_covers', window.pawHideCovers);
    if (feedView && feedView.classList.contains('active')) {
      resetFeed();
      fetchPosts();
    }
  });
}

const settingPreloadCount = document.getElementById('setting-preload-count');
if (settingPreloadCount) {
  settingPreloadCount.value = String(window.pawPreloadCount);
  settingPreloadCount.addEventListener('change', (e) => {
    window.pawPreloadCount = parseInt(e.target.value, 10);
    localStorage.setItem('paw_preload_count', window.pawPreloadCount);
  });
}

document.addEventListener('mousemove', (e) => {
  window.lastMouseY = e.clientY;
  updateNavVisibility();
});

if (navInfo) {
  navInfo.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isNavInteractive()) return;
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    if (el) {
      const card = el.closest('.post-card');
      if (card) {
        const info = card.querySelector('.post-info');
        if (info) {
          info.classList.toggle('expanded');
          updateNavVisibility();
        }
      }
    }
  });
}

if (navSettings && settingsMenu) {
  navSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isNavInteractive()) return;
    settingsMenu.classList.toggle('active');
  });
  
  document.addEventListener('click', (e) => {
    const isZipSettings = document.getElementById('zip-settings-viewer') && e.target === document.getElementById('zip-settings-viewer');
    if (!settingsMenu.contains(e.target) && e.target !== navSettings && !isZipSettings) {
      settingsMenu.classList.remove('active');
    }
  });
}

if (siteSelector) {
  state.currentSite = siteSelector.value;
  updateSiteSpecificUI();
  siteSelector.addEventListener('change', (e) => { 
    state.currentSite = e.target.value; 
    updateSiteSpecificUI();
  });
}

const navTabsEl = document.getElementById('nav-tabs');
if (navTabsEl) {
  navTabsEl.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0 && e.deltaX === 0) {
      let multiplier = 1;
      if (e.deltaMode === 1) multiplier = 35;
      else if (e.deltaMode === 2) multiplier = 600;
      navTabsEl.scrollLeft += e.deltaY * multiplier;
      e.preventDefault();
    }
  }, { passive: false });
}

if (navHome) {
  navHome.addEventListener('click', () => {
    if (!isNavInteractive()) return;
    state.navManualVisible = false;
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    showView(welcomeScreen, false);
    if (navBack) navBack.classList.add('hidden');
    
    resetFeed();
    
    state.creatorPage = 1;
    if (searchInput) searchInput.value = '';
    if (sortSelect) sortSelect.value = 'popularity';
    if (contentFilterSelect) contentFilterSelect.value = state.currentSite === 'cum' ? 'content' : 'all';
    if (genderFilterSelect) genderFilterSelect.value = 'all';
    if (serviceFilterSelect) {
      const checkboxes = serviceFilterSelect.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => cb.checked = false);
    }
  });
}

if (navBack) {
  navBack.addEventListener('click', () => {
    if (!isNavInteractive()) return;
    
    if (feedView && feedView.classList.contains('active')) {
      const wasCreatorFeed = !!state.currentFeedCreatorName;
      
      state.currentFeedCreatorName = null;
      updateNavTabs(null);
      resetFeed();
      
      if (wasCreatorFeed) {
        showView(creatorsView, true);
      } else {
        showView(welcomeScreen, false);
        navBack.classList.add('hidden');
      }
    } 
    else if (creatorsView && creatorsView.classList.contains('active')) {
      showView(welcomeScreen, false);
      navBack.classList.add('hidden');
    }
  });
}

const btnLatest = document.getElementById('btn-latest');
if (btnLatest) {
  btnLatest.addEventListener('click', () => {
    resetFeed();
    state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/posts`;
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    if (navBack) navBack.classList.remove('hidden'); 
    showView(feedView, true);
    loadCreators();
    fetchPosts();
  });
}

const btnCreators = document.getElementById('btn-creators');
if (btnCreators) {
  btnCreators.addEventListener('click', () => {
    showView(creatorsView, true);
    if (navBack) navBack.classList.remove('hidden'); 
    loadCreators();
  });
}

let searchTimeout;
if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.creatorPage = 1;
      filterAndSortCreators();
    }, 400);
  });
}

if (sortSelect) {
  sortSelect.addEventListener('change', () => {
    state.creatorPage = 1;
    filterAndSortCreators();
  });
}

if (sortDirBtn) {
  sortDirBtn.addEventListener('click', () => {
    state.creatorSortDir = (state.creatorSortDir === 'asc' ? 'desc' : 'asc');
    sortDirBtn.innerHTML = (state.creatorSortDir === 'asc' 
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>' 
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>');
    state.creatorPage = 1;
    filterAndSortCreators();
  });
}

if (serviceFilterSelect) {
  serviceFilterSelect.addEventListener('change', () => {
    state.creatorPage = 1;
    filterAndSortCreators();
  });
}

if (contentFilterSelect) {
  contentFilterSelect.addEventListener('change', () => {
    state.creatorPage = 1;
    filterAndSortCreators();
  });
}

if (genderFilterSelect) {
  genderFilterSelect.addEventListener('change', () => {
    state.creatorPage = 1;
    filterAndSortCreators();
  });
}

if (closeZipViewer) {
  closeZipViewer.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isZipNavInteractive()) return;
    closeZipGallery();
  });
}

if (zipSettingsViewer && settingsMenu) {
  zipSettingsViewer.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isZipNavInteractive()) return;
    settingsMenu.classList.toggle('active');
  });
}

if (zipHomeViewer) {
  zipHomeViewer.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isZipNavInteractive()) return;
    closeZipGallery();
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    showView(welcomeScreen, false);
    if (navBack) navBack.classList.add('hidden');
    
    resetFeed();
  });
}

if (zipIndicator && zipContent) {
  zipIndicator.addEventListener('click', (e) => {
    e.stopPropagation();
    setZipNavVisible(!state.zipNavManualVisible, true);
  });
}

if (zipViewer) {
  zipViewer.addEventListener('mousemove', updateZipNavVisibility);

  zipViewer.addEventListener('click', (e) => {
    if (
      e.target.tagName.toLowerCase() === 'button' ||
      e.target.closest('#zip-nav') ||
      e.target.closest('#settings-menu')
    ) {
      return;
    }

    if (e.target.id === 'zip-indicator' || e.target.closest('#zip-indicator')) {
      setZipNavVisible(!state.zipNavManualVisible, true);
      return;
    }

    const x = e.clientX;
    const w = window.innerWidth;
    const count = parseInt(zipContent?.dataset?.mediaCount || "0", 10) || state.currentZipObjectUrls.length;

    if (count > 1) {
      if (x < w * 0.2) {
        navigateCarousel(zipContent, 'left', count);
        return;
      } else if (x > w * 0.8) {
        navigateCarousel(zipContent, 'right', count);
        return;
      }
    }

    setZipNavVisible(!state.zipNavManualVisible, true);
  });
}

if (zipContent) {
  let zipScrollSettleTimer;
  zipContent.addEventListener('scroll', () => {
    const count = parseInt(zipContent.dataset.mediaCount || "0", 10) || state.currentZipObjectUrls.length;
    if (count <= 1) return;
    const itemWidth = zipContent.clientWidth || window.innerWidth;
    if (!itemWidth) return;
    const rawIndex = Math.round(zipContent.scrollLeft / itemWidth);
    const realIndex = (rawIndex - 1 + count) % count;
    if (zipIndicator) zipIndicator.textContent = `${realIndex + 1} / ${count}`;

    if (!zipContent._animId) {
      clearTimeout(zipScrollSettleTimer);
      zipScrollSettleTimer = setTimeout(() => {
        handleCarouselScrollSettled(zipContent, count);
      }, 60);
    }
  });
}

initGestures();
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
  openZipGallery
} from './js/zip.js';
import { initGestures } from './js/gestures.js';

// --- Global Settings Init ---
window.pawAnimationsDisabled = localStorage.getItem('paw_animations_disabled') === 'true';
window.pawAutoDownloadZip = localStorage.getItem('paw_auto_download_zip') === 'true';
window.pawHideCovers = localStorage.getItem('paw_hide_covers') === 'true';
if (window.pawAnimationsDisabled) document.body.classList.add('no-animations');

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

// --- Navigation & Header Listeners ---
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

if (navHome) {
  navHome.addEventListener('click', () => {
    if (!isNavInteractive()) return;
    state.navManualVisible = false;
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    showView(welcomeScreen, false);
    if (navBack) navBack.classList.add('hidden');
    
    state.creatorPage = 1;
    if (searchInput) searchInput.value = '';
    if (sortSelect) sortSelect.value = 'followers-desc';
    if (contentFilterSelect) contentFilterSelect.value = 'all';
    if (serviceFilterSelect) {
      const checkboxes = serviceFilterSelect.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(cb => cb.checked = false);
    }
  });
}

if (navBack) {
  navBack.addEventListener('click', () => {
    if (!isNavInteractive()) return;
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    showView(creatorsView, true);
    navBack.classList.add('hidden');
  });
}

// --- Welcome Screen Buttons ---
const btnLatest = document.getElementById('btn-latest');
if (btnLatest) {
  btnLatest.addEventListener('click', async () => {
    resetFeed();
    state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/posts`;
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    if (navBack) navBack.classList.add('hidden');
    showView(feedView, true);
    await loadCreators();
    fetchPosts();
  });
}

const btnCreators = document.getElementById('btn-creators');
if (btnCreators) {
  btnCreators.addEventListener('click', () => {
    showView(creatorsView, true);
    loadCreators();
  });
}

// --- Creators Filter & Search Listeners ---
let searchTimeout;
if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      state.creatorPage = 1;
      
      if (state.currentSite === 'cum' && searchInput.value.trim().length > 1) {
        try {
          const res = await fetch(`${PROXY_URL}/cum/api/v1/creators?q=${encodeURIComponent(searchInput.value.trim())}`);
          if (res.ok) {
            const data = await res.json();
            if (data.creators) {
              const existingIds = new Set(state.allCreators.map(c => c.id));
              data.creators.forEach(c => {
                if (c.service === 'discord') return;
                if (!existingIds.has(c.id)) {
                  c.allPlatforms = [c];
                  state.allCreators.push(c);
                }
              });
            }
          }
        } catch (e) {
          console.warn("Failed to fetch server-side search for cum.st", e);
        }
      }
      
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

// --- ZIP Viewer Modal Listeners ---
if (closeZipViewer) {
  closeZipViewer.addEventListener('click', () => {
    if (!isZipNavInteractive()) return;
    setZipNavVisible(false, true);
    if (zipViewer) zipViewer.classList.add('hidden');
    if (zipContent) zipContent.innerHTML = '';
    state.currentZipObjectUrls.forEach(url => URL.revokeObjectURL(url));
    state.currentZipObjectUrls = [];
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
  zipHomeViewer.addEventListener('click', () => {
    if (!isZipNavInteractive()) return;
    setZipNavVisible(false, true);
    if (zipViewer) zipViewer.classList.add('hidden');
    if (zipContent) zipContent.innerHTML = '';
    state.currentZipObjectUrls.forEach(url => URL.revokeObjectURL(url));
    state.currentZipObjectUrls = [];
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    showView(welcomeScreen, false);
    if (navBack) navBack.classList.add('hidden');
  });
}

if (zipIndicator && zipContent) {
  zipIndicator.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.currentZipObjectUrls.length === 0) return;
    zipContent.dataset.targetScroll = 0;
    zipContent.dataset.scrollDir = 'left';
    zipContent.style.scrollSnapType = 'none';
    zipContent.scrollTo({ left: 0, behavior: window.pawAnimationsDisabled ? 'auto' : 'smooth' });
  });
}

if (zipViewer) {
  zipViewer.addEventListener('mousemove', updateZipNavVisibility);

  zipViewer.addEventListener('click', (e) => {
    if (e.target.tagName.toLowerCase() === 'button' || e.target.id === 'zip-indicator' || e.target.closest('#zip-nav')) return;
    const x = e.clientX;
    const w = window.innerWidth;
    const count = state.currentZipObjectUrls.length;
    if (!zipContent || count <= 1) return;

    if (x < w * 0.2) {
      navigateCarousel(zipContent, 'left', count);
    } else if (x > w * 0.8) {
      navigateCarousel(zipContent, 'right', count);
    } else {
      setZipNavVisible(!state.zipNavManualVisible, true);
    }
  });
}

if (zipContent) {
  let zipScrollSettleTimer;
  zipContent.addEventListener('scroll', () => {
    const count = state.currentZipObjectUrls.length;
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

  zipContent.addEventListener('scrollend', () => {
    if (!zipContent._animId) {
      handleCarouselScrollSettled(zipContent, state.currentZipObjectUrls.length);
    }
  });
}

// --- Initialize Gestures & Shortcuts ---
initGestures();

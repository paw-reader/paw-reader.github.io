
function showMediaUnavailableWarning(container, type = 'media') {
  const displayNames = { pawchive: 'Pawchive', kemono: 'Kemono', cum: 'Coomer' };
  const siteName = displayNames[currentSite] || currentSite;
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; gap: 10px; padding: 20px; text-align: center; background: rgba(0,0,0,0.5); border-radius: 12px; box-sizing: border-box;">
      <span style="color: #ffb86c; font-size: 2rem;">⚠️</span>
      <span style="color: #ffb86c; font-size: 1.2rem; font-weight: bold;">${type === 'zip' ? 'Archive' : 'Media'} Unavailable</span>
      <span style="color: #ccc; font-size: 0.95rem; font-weight: normal; max-width: 250px; line-height: 1.4;">
        This file has not yet been imported to ${siteName}, or the server is busy/unavailable.
      </span>
    </div>
  `;
}

const PROXY_URL = 'https://paw-worker.syrupderg.workers.dev';
let currentSite = 'pawchive';

const DB_VERSION = 1;
const DB_NAME = 'pawchive_downloads';
let _db;
async function initDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('chunks', { keyPath: 'url' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

async function getDbItem(url) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const req = tx.objectStore('chunks').get(url);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function setDbItem(url, chunks, contentType, totalSize) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    tx.objectStore('chunks').put({ url, chunks, contentType, totalSize, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteDbItem(url) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    tx.objectStore('chunks').delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getServiceColor(service) {
  const s = (service || '').toLowerCase();
  if (s === 'fanbox') return '#0096FA';
  if (s === 'patreon') return '#F96854';
  if (s === 'discord') return '#5865F2';
  if (s === 'onlyfans') return '#00AEEF';
  if (s === 'fansly') return '#2699F7';
  if (s === 'subscribestar') return '#009688';
  if (s === 'dlsite') return '#052A83';
  if (s === 'gumroad') return '#FF90E8';
  if (s === 'boosty') return 'linear-gradient(to bottom, #EF7829, #EC5B2B)';
  if (s === 'fantia') return 'linear-gradient(to right, #8CC13F, #E1097F, #8D2680, #00A098, #383877, #F05B26)';
  return '#222';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const topProgress = document.getElementById('top-progress');
function startProgress() {
  topProgress.classList.remove('done');
  topProgress.classList.add('loading');
}
function stopProgress() {
  topProgress.classList.remove('loading');
  topProgress.classList.add('done');
}

// Views
const welcomeScreen = document.getElementById('welcome-screen');
const creatorsView = document.getElementById('creators-view');
const feedView = document.getElementById('feed-view');

window.addEventListener('beforeunload', () => {
  // If there are active zip streams, we should theoretically save them, but async IDB in beforeunload is tricky.
  // The pause button is the reliable way to save progress.
});

// Nav
const nav = document.getElementById('nav');

function closeAllPostInfo() {
  const expanded = document.querySelectorAll('.post-info.expanded');
  if (expanded.length > 0) {
    expanded.forEach(el => el.classList.remove('expanded'));
    updateNavVisibility();
  }
}

window.lastMouseY = window.innerHeight;

function updateNavVisibility(mouseY = window.lastMouseY) {
  if (!nav.classList.contains('auto-hide')) return;
  const anyInfoExpanded = !!document.querySelector('.post-info.expanded');
  const dropdownOpen = !!document.getElementById('linked-accounts-dropdown');
  if (anyInfoExpanded || dropdownOpen || mouseY < 80) {
    nav.classList.add('visible');
    document.body.classList.add('nav-visible');
  } else {
    nav.classList.remove('visible');
    document.body.classList.remove('nav-visible');
  }
}

document.addEventListener('mousemove', (e) => {
  window.lastMouseY = e.clientY;
  updateNavVisibility();
});

const navHome = document.getElementById('nav-home');
const navBack = document.getElementById('nav-back');
const navInfo = document.getElementById('nav-info');
const navSettings = document.getElementById('nav-settings');

if (navInfo) {
  navInfo.addEventListener('click', (e) => {
    e.stopPropagation();
    // find the currently centered post-card
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
const settingsMenu = document.getElementById('settings-menu');

if (navSettings && settingsMenu) {
  navSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.toggle('active');
  });
  
  document.addEventListener('click', (e) => {
    const isZipSettings = document.getElementById('zip-settings-viewer') && e.target === document.getElementById('zip-settings-viewer');
    if (!settingsMenu.contains(e.target) && e.target !== navSettings && !isZipSettings) {
      settingsMenu.classList.remove('active');
    }
  });
}

// Elements
const feed = document.getElementById('feed');
const feedLoading = document.getElementById('feed-loading');
const creatorsList = document.getElementById('creators-list');
const creatorsLoading = document.getElementById('creators-loading');
const btnLatest = document.getElementById('btn-latest');
const btnCreators = document.getElementById('btn-creators');
const siteSelector = document.getElementById('site-selector');

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

window.pawAnimationsDisabled = localStorage.getItem('paw_animations_disabled') === 'true';
window.pawAutoDownloadZip = localStorage.getItem('paw_auto_download_zip') === 'true';
if (window.pawAnimationsDisabled) document.body.classList.add('no-animations');

const settingDisableAnimations = document.getElementById('setting-disable-animations');
const settingAutoDownloadZip = document.getElementById('setting-auto-download-zip');
if (settingAutoDownloadZip) {
  settingAutoDownloadZip.checked = window.pawAutoDownloadZip;
  settingAutoDownloadZip.addEventListener('change', (e) => {
    window.pawAutoDownloadZip = e.target.checked;
    localStorage.setItem('paw_auto_download_zip', window.pawAutoDownloadZip);
  });
}

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

if (siteSelector) {
  currentSite = siteSelector.value;
  
  function updateSiteSpecificUI() {
    const contentFilter = document.getElementById('creator-content-filter');
    if (contentFilter) {
      if (currentSite === 'cum') {
        contentFilter.style.display = '';
        contentFilter.value = 'content'; // Default to with content for cum.st
      } else {
        contentFilter.style.display = 'none';
        contentFilter.value = 'all'; // Default to all for Kemono/Pawchive
      }
    }
    
    const creatorsTitle = document.getElementById('creators-title');
    if (creatorsTitle) {
      const displayNames = {
        pawchive: 'Pawchive',
        kemono: 'Kemono',
        cum: 'Coomer'
      };
      creatorsTitle.textContent = `${displayNames[currentSite] || 'Selected'} creators`;
    }
  }
  
  updateSiteSpecificUI();
  siteSelector.addEventListener('change', (e) => { 
    currentSite = e.target.value; 
    updateSiteSpecificUI();
  });
}

function updateNavTabs(creator) {
  const navTabs = document.getElementById('nav-tabs');
  if (!navTabs) return;
  navTabs.innerHTML = '';
  
  if (!creator) return;
  
  let tabs = [];
  if (currentSite === 'kemono' || currentSite === 'pawchive') {
    tabs = ['Posts', 'Announcements', 'Tags', 'DMs', 'Linked Accounts', 'Similar Artists'];
  } else if (currentSite === 'cum') {
    tabs = ['Posts', 'DMs', 'Linked Accounts', 'Similar Creators'];
  }
  
  // Filter tabs based on creator metadata if available
  tabs = tabs.filter(tab => {
    // Only strictly hide if the count is explicitly 0 or null (since Kemono returns undefined for these counts)
    if (tab === 'DMs' && (creator.dmCount === 0 || creator.dmCount === null)) return false;
    if (tab === 'Posts' && (creator.postCount === 0 || creator.postCount === null)) return false;
    if (tab === 'Linked Accounts' && (!creator.allPlatforms || creator.allPlatforms.length <= 1)) return false;
    return true;
  });
  
   tabs.forEach((tab, index) => {
    const btn = document.createElement('button');
    btn.style.flexShrink = '0';
    btn.textContent = tab;
    if (index === 0) btn.style.background = 'rgba(0, 123, 255, 0.6)';
    
    btn.addEventListener('click', (e) => {
      // Linked Accounts is a dropdown — handle entirely separately
      if (tab === 'Linked Accounts') {
        const existingDropdown = document.getElementById('linked-accounts-dropdown');
        if (existingDropdown) { existingDropdown.remove(); return; }

        const dropdown = document.createElement('div');
        dropdown.id = 'linked-accounts-dropdown';

        // Position below the button using fixed coords so it's outside btn's stacking context
        const btnRect = btn.getBoundingClientRect();
        dropdown.style.cssText = `
          position: fixed;
          top: ${btnRect.bottom + 6}px;
          left: ${btnRect.left + btnRect.width / 2}px;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 14px;
          padding: 8px;
          display: flex; flex-direction: column; gap: 6px;
          min-width: 180px;
          z-index: 1100;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        `;

        if (creator.allPlatforms && creator.allPlatforms.length > 1) {
          creator.allPlatforms.forEach(p => {
            const isActive = p.service === creator.service && p.id === creator.id;
            const row = document.createElement('button');
            row.style.cssText = `
              display:flex; align-items:center; gap:10px;
              padding: 8px 12px; border-radius: 10px; border: none;
              background: ${isActive ? 'rgba(0,123,255,0.6)' : 'rgba(255,255,255,0.08)'};
              color: #fff; font-size: 0.9rem; font-weight: ${isActive ? 'bold' : 'normal'};
              cursor: pointer; text-align: left; width: 100%;
              transition: background 0.15s;
            `;
            row.onmouseenter = () => { if (!isActive) row.style.background = 'rgba(255,255,255,0.18)'; };
            row.onmouseleave = () => { if (!isActive) row.style.background = 'rgba(255,255,255,0.08)'; };

            const icon = document.createElement('img');
            icon.src = `icons/${p.service}.svg`;
            icon.style.cssText = 'width:20px; height:20px; object-fit:contain; flex-shrink:0;';
            icon.onerror = () => icon.style.display = 'none';

            const labelWrap = document.createElement('span');
            labelWrap.style.cssText = 'display:flex; flex-direction:column; line-height:1.3;';
            labelWrap.innerHTML = `<span>${p.service.charAt(0).toUpperCase() + p.service.slice(1)}</span><span style="opacity:0.6;font-size:0.78rem;">${p.name}</span>`;

            row.appendChild(icon);
            row.appendChild(labelWrap);
            if (isActive) {
              const check = document.createElement('span');
              check.textContent = '✓';
              check.style.marginLeft = 'auto';
              row.appendChild(check);
            }

            row.addEventListener('click', (ev) => {
              ev.stopPropagation(); // prevent bubbling to btn which would re-toggle
              dropdown.remove();
              document.removeEventListener('mousedown', outsideClose);
              updateNavVisibility(); // restore normal auto-hide
              resetFeed();
              currentFeedEndpoint = `${PROXY_URL}/${currentSite}/api/v1/${p.service}/user/${p.id}/posts`;
              currentFeedCreatorName = p.name;
              updateNavTabs({ ...p, allPlatforms: creator.allPlatforms });
              fetchPosts();
            });

            dropdown.appendChild(row);
          });
        }

        document.body.appendChild(dropdown);

        // Lock nav visible while dropdown is open
        const navEl = document.getElementById('nav');
        if (navEl) navEl.classList.add('visible');

        // Close on mousedown outside (fires before click, more reliable)
        function outsideClose(ev) {
          if (!dropdown.contains(ev.target) && ev.target !== btn) {
            dropdown.remove();
            document.removeEventListener('mousedown', outsideClose);
            // Restore normal auto-hide
            if (navEl) updateNavVisibility();
          }
        }
        setTimeout(() => document.addEventListener('mousedown', outsideClose), 0);
        return;
      }

      // For all other tabs: highlight and reset feed
      Array.from(navTabs.children).forEach(c => c.style.background = '');
      btn.style.background = 'rgba(0, 123, 255, 0.6)';
      
      resetFeed();
      if (tab === 'Posts' || tab === 'DMs' || tab === 'Announcements') {
        currentFeedEndpoint = `${PROXY_URL}/${currentSite}/api/v1/${creator.service}/user/${creator.id}/${tab.toLowerCase()}`;
        fetchPosts();
      } else if (tab === 'Similar Creators' || tab === 'Similar Artists') {
        if (currentSite === 'kemono' || currentSite === 'pawchive') {
          const tld = currentSite === 'kemono' ? 'su' : 'pw';
          window.open(`https://${currentSite}.${tld}/${creator.service}/user/${creator.id}/recommended`, '_blank');
          return;
        }
        
        feed.innerHTML = '<div style="text-align:center; padding: 40px; color: #aaa;">Loading similar creators...</div>';
        const endpoint = `${PROXY_URL}/${currentSite}/api/v1/${creator.service}/user/${creator.id}/similar`;
        fetch(endpoint)
          .then(res => {
            if (!res.ok) throw new Error('Not found');
            return res.json();
          })
          .then(data => {
            feed.innerHTML = '';
            const similarCreators = data.creators || (Array.isArray(data) ? data : null);
            
            if (similarCreators && similarCreators.length > 0) {
              const grid = document.createElement('div');
              grid.className = 'creators-grid';
              grid.style.marginTop = '20px';
              
              similarCreators.forEach(c => {
                c.allPlatforms = [c];
                const card = buildCreatorCard(c);
                grid.appendChild(card);
              });
              
              feed.appendChild(grid);
            } else {
              const placeholder = document.createElement('div');
              placeholder.style.color = '#ccc';
              placeholder.style.textAlign = 'center';
              placeholder.style.padding = '40px';
              placeholder.style.fontSize = '1.2rem';
              placeholder.textContent = `No similar creators found for this profile.`;
              feed.appendChild(placeholder);
            }
          })
          .catch(err => {
            feed.innerHTML = '';
            const placeholder = document.createElement('div');
            placeholder.style.color = '#ccc';
            placeholder.style.textAlign = 'center';
            placeholder.style.padding = '40px';
            placeholder.style.fontSize = '1.2rem';
            placeholder.textContent = `Similar artists are not yet supported for this source.`;
            feed.appendChild(placeholder);
          });
      } else {
        const placeholder = document.createElement('div');
        placeholder.style.color = '#ccc';
        placeholder.style.textAlign = 'center';
        placeholder.style.padding = '40px';
        placeholder.style.fontSize = '1.2rem';
        placeholder.textContent = `${tab} are not yet supported by Paw Reader.`;
        feed.appendChild(placeholder);
      }
    });
    
    // For Kemono/Pawchive, we don't know upfront if DMs/Announcements exist. Hide initially and check in background.
    if ((currentSite === 'kemono' || currentSite === 'pawchive') && (tab === 'DMs' || tab === 'Announcements')) {
      btn.style.display = 'none';
      fetch(`${PROXY_URL}/${currentSite}/api/v1/${creator.service}/user/${creator.id}/${tab.toLowerCase()}?limit=1`)
        .then(res => res.json())
        .then(data => {
          const arr = data.posts || data.announcements || data.dms || (Array.isArray(data) ? data : []);
          if (arr.length > 0) {
            btn.style.display = '';
          }
        }).catch(() => {}); // silently ignore 404s, leaving it hidden
    }
    
    navTabs.appendChild(btn);
  });
}

// State

function wrapCarousel(carousel, direction) {
  const w = window.innerWidth;
  let target = 0;
  if (direction === 'end') {
    target = carousel.scrollWidth - carousel.clientWidth;
  }
  carousel.dataset.targetScroll = target;
  carousel.dataset.scrollDir = direction === 'end' ? 'left' : 'right';
  carousel.style.scrollSnapType = 'none';
  carousel.scrollTo({ left: target, behavior: 'auto' });
}

let offset = 0;
let isFetching = false;
let hasMore = true;
const limit = 50;
let currentFeedEndpoint = `${PROXY_URL}/${currentSite}/api/v1/posts`; // Default to global latest
let currentFeedCreatorName = null;

// Intersection observer for feed
const observerOptions = {
  root: feed,
  rootMargin: '0px',
  threshold: 0.1
};
const observer = new IntersectionObserver((entries) => {
  const lastEntry = entries[entries.length - 1];
  if (lastEntry.isIntersecting && !isFetching && hasMore) {
    fetchPosts();
  }
}, observerOptions);

function showView(viewElement, showNav = true, showToggle = false) {
  [welcomeScreen, creatorsView, feedView].forEach(v => v.classList.remove('active'));
  viewElement.classList.add('active');
  
  if (showNav) nav.classList.remove('hidden');
  else nav.classList.add('hidden');
  
  const navTabs = document.getElementById('nav-tabs');
  
  if (viewElement === feedView) {
    nav.classList.add('auto-hide');
    if (navInfo) navInfo.classList.remove('hidden');
    // Only show creator tabs when viewing a specific creator — not the global latest feed
    if (navTabs) {
      if (currentFeedCreatorName) {
        navTabs.classList.remove('hidden');
      } else {
        navTabs.classList.add('hidden');
      }
    }
    updateNavVisibility();
  } else {
    nav.classList.remove('auto-hide');
    nav.classList.remove('visible');
    if (navTabs) navTabs.classList.add('hidden');
    if (navInfo) navInfo.classList.add('hidden');
  }
}

navHome.addEventListener('click', () => {
  currentFeedCreatorName = null;
  updateNavTabs(null); // Hide creator tabs when going home
  showView(welcomeScreen, false);
  if(navBack) navBack.classList.add('hidden');
  
  // Clear creator view state
  creatorPage = 1;
  if (searchInput) searchInput.value = '';
  if (sortSelect) sortSelect.value = 'followers-desc';
  if (contentFilterSelect) contentFilterSelect.value = 'all';
  if (serviceFilterSelect) {
    const checkboxes = serviceFilterSelect.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
  }
});

if(navBack) {
  navBack.addEventListener('click', () => {
    currentFeedCreatorName = null;
    updateNavTabs(null); // Hide creator tabs when going back to list
    showView(creatorsView, true);
    navBack.classList.add('hidden');
  });
}

btnLatest.addEventListener('click', async () => {
  resetFeed();
  currentFeedEndpoint = `${PROXY_URL}/${currentSite}/api/v1/posts`;
  currentFeedCreatorName = null;
  updateNavTabs(null); // Hide tabs — we're on global feed now
  if(navBack) navBack.classList.add('hidden');
  showView(feedView, true, true);
  await loadCreators(); // Ensure global creator list is ready before rendering posts
  fetchPosts();
});

btnCreators.addEventListener('click', () => {
  showView(creatorsView, true, false);
  loadCreators();
});

let allCreators = [];
let loadedCreatorsSite = '';
let filteredCreators = [];
let creatorPage = 1;
const creatorsPerPage = 50;

const searchInput = document.getElementById('creator-search');
const sortSelect = document.getElementById('creator-sort');
const serviceFilterSelect = document.getElementById('creator-service-filter');
const contentFilterSelect = document.getElementById('creator-content-filter');
const paginationContainer = document.getElementById('creator-pagination');

let searchTimeout;
if(searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      creatorPage = 1;
      
      // Moxxy API (cum.st) paginates, so client-side search won't find missing creators.
      // Trigger a server-side search and dynamically inject them into the client grid.
      if (currentSite === 'cum' && searchInput.value.trim().length > 1) {
        try {
          const res = await fetch(`${PROXY_URL}/cum/api/v1/creators?q=${encodeURIComponent(searchInput.value.trim())}`);
          if (res.ok) {
            const data = await res.json();
            if (data.creators) {
              const existingIds = new Set(allCreators.map(c => c.id));
              data.creators.forEach(c => {
                if (c.service === 'discord') return;
                if (!existingIds.has(c.id)) {
                  c.allPlatforms = [c];
                  allCreators.push(c);
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

if(sortSelect) {
  sortSelect.addEventListener('change', () => {
    creatorPage = 1;
    filterAndSortCreators();
  });
}

if(serviceFilterSelect) {
  serviceFilterSelect.addEventListener('change', () => {
    creatorPage = 1;
    filterAndSortCreators();
  });
}

if(contentFilterSelect) {
  contentFilterSelect.addEventListener('change', () => {
    creatorPage = 1;
    filterAndSortCreators();
  });
}

let isSyncing = false;
async function syncCumCreators() {
  if (isSyncing) return;
  isSyncing = true;
  let offset = 0;
  try {
    const initRes = await fetch(`${PROXY_URL}/cum/api/v1/creators`);
    const initData = await initRes.json();
    const total = initData.total || 14000;
    
    while (offset < total && currentSite === 'cum') {
      const fetchPromises = [];
      for (let i = 0; i < 5 && offset < total; i++) {
        fetchPromises.push(fetch(`${PROXY_URL}/cum/api/v1/creators?limit=50&o=${offset}`).then(r => r.json()));
        offset += 50;
      }
      const results = await Promise.allSettled(fetchPromises);
      let added = false;
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value.creators) {
          const existingIds = new Set(allCreators.map(c => c.id));
          res.value.creators.forEach(c => {
            if (c.service === 'discord') return;
            if (!existingIds.has(c.id)) {
              c.allPlatforms = [c];
              allCreators.push(c);
              added = true;
            }
          });
        }
      }
      if (added && currentSite === 'cum' && document.getElementById('creators-view') && document.getElementById('creators-view').classList.contains('active')) {
        filterAndSortCreators(); // Update the view live as creators pour in!
      }
    }
  } catch(e) {
    console.warn("Background sync failed", e);
  }
  isSyncing = false;
}

async function loadCreators() {
  if (allCreators.length > 0 && loadedCreatorsSite === currentSite) return;
  loadedCreatorsSite = currentSite;
  allCreators = [];
  creatorsList.innerHTML = '';
  creatorsLoading.classList.add('active'); startProgress();
  try {
    let rawCreators = [];
    if (currentSite === 'cum') {
      // Moxxy API paginates the creators list to 50 items, so standard fetch misses other services.
      // Explicitly fetch the top creators for known services to populate the client-side filter and grid.
      const moxxyServices = ['onlyfans', 'fansly', 'patreon'];
      for (const s of moxxyServices) {
        try {
          const res = await fetch(`${PROXY_URL}/${currentSite}/api/v1/creators?service=${s}&limit=50`);
          if (res.ok) {
            const data = await res.json();
            if (data.creators) rawCreators.push(...data.creators);
          }
        } catch (e) {
          console.warn(`Failed to fetch ${s} creators for cum.st`, e);
        }
      }
      // Start background sync for the remaining ~13,500 creators
      syncCumCreators();
    } else {
      const res = await fetch(`${PROXY_URL}/${currentSite}/api/v1/creators`);
      if (!res.ok) throw new Error('Failed to fetch creators: ' + res.status + ' ' + res.statusText);
      rawCreators = await res.json();
    }
    const uniqueCreators = new Map();
    rawCreators.forEach(c => {
      if (c.service === 'discord') return;
      const key = c.name.toLowerCase().trim();
      if (!uniqueCreators.has(key)) {
        uniqueCreators.set(key, { platforms: [c] });
      } else {
        uniqueCreators.get(key).platforms.push(c);
      }
    });
    
    allCreators = Array.from(uniqueCreators.values()).map(uc => {
      uc.platforms.sort((a, b) => (b.favorited || 0) - (a.favorited || 0));
      return {
        ...uc.platforms[0],
        allPlatforms: uc.platforms
      };
    });
    
    if (serviceFilterSelect) {
      const services = new Set();
      allCreators.forEach(c => {
        services.add(c.service);
        if (c.allPlatforms) c.allPlatforms.forEach(p => services.add(p.service));
      });
      
      // Preserve current checked state
      const checkedBoxes = Array.from(serviceFilterSelect.querySelectorAll('input:checked')).map(cb => cb.value);
      
      serviceFilterSelect.innerHTML = '';
      Array.from(services).sort().forEach(service => {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = service;
        if (checkedBoxes.includes(service)) {
          cb.checked = true;
        }
        const text = document.createTextNode(' ' + service.charAt(0).toUpperCase() + service.slice(1));
        label.appendChild(cb);
        label.appendChild(text);
        serviceFilterSelect.appendChild(label);
      });
    }
    
    filterAndSortCreators();
  } catch (error) {
    console.error("Error fetching creators:", error);
    creatorsLoading.textContent = "Failed to load creators.";
  } finally {
    creatorsLoading.classList.remove('active'); stopProgress();
  }
}

function filterAndSortCreators() {
  const query = (searchInput ? searchInput.value.toLowerCase() : '');
  const sort = (sortSelect ? sortSelect.value : 'followers-desc');
  const contentFilter = (contentFilterSelect ? contentFilterSelect.value : 'content');
  
  // Get all checked services. If none are checked, we assume the user wants to see everything.
  const checkedServices = serviceFilterSelect 
    ? Array.from(serviceFilterSelect.querySelectorAll('input:checked')).map(cb => cb.value)
    : [];
  
  filteredCreators = allCreators.filter(c => {
    const matchesQuery = c.name.toLowerCase().includes(query);
    
    const matchesService = checkedServices.length === 0 || 
      checkedServices.includes(c.service) || 
      (c.allPlatforms && c.allPlatforms.some(p => checkedServices.includes(p.service)));
    
    let hasContent = false;
    if (currentSite === 'cum') {
       hasContent = c.postCount > 0 || c.imageCount > 0 || c.videoCount > 0 || c.dmCount > 0;
    } else {
       hasContent = c.updated !== 0;
    }
    
    let matchesContent = true;
    if (contentFilter === 'content') matchesContent = hasContent;
    else if (contentFilter === 'empty') matchesContent = !hasContent;
    
    return matchesQuery && matchesService && matchesContent;
  });
  
  filteredCreators.sort((a, b) => {
    if (sort === 'followers-desc') {
      return (b.favorited || 0) - (a.favorited || 0);
    } else if (sort === 'followers-asc') {
      return (a.favorited || 0) - (b.favorited || 0);
    } else if (sort === 'name-asc') {
      return a.name.localeCompare(b.name);
    } else if (sort === 'name-desc') {
      return b.name.localeCompare(a.name);
    }
    return 0;
  });
  
  renderCreatorsPage();
}

function buildCreatorCard(creator, checkedServices = []) {
  const card = document.createElement('div');
  card.className = 'creator-card';
  
  let currentPlatformIndex = 0;
  if (checkedServices.length > 0 && creator.allPlatforms) {
    const idx = creator.allPlatforms.findIndex(p => checkedServices.includes(p.service));
    if (idx !== -1) currentPlatformIndex = idx;
  }
  
  const initialPlatform = creator.allPlatforms ? creator.allPlatforms[currentPlatformIndex] : creator;
  
  card.style.background = getServiceColor(initialPlatform.service);
  
  const img = document.createElement('img');
  img.className = 'creator-image';
  if (currentSite === 'cum') {
    img.src = `https://img.cum.st/creator/${initialPlatform.service}/${initialPlatform.id}/avatar.webp`;
  } else {
    img.src = `${PROXY_URL}/${currentSite}/icons/${initialPlatform.service}/${initialPlatform.id}`;
  }
  img.loading = 'lazy';
  img.onerror = () => { img.style.display = 'none'; };
  
  const name = document.createElement('div');
  name.className = 'creator-name';
  name.textContent = initialPlatform.name;
  
  const service = document.createElement('div');
  service.className = 'creator-service';
  service.textContent = initialPlatform.service;
  
  card.appendChild(img);
  card.appendChild(name);
  card.appendChild(service);
  
  if (creator.allPlatforms && creator.allPlatforms.length > 1) {
    const switchBtn = document.createElement('div');
    switchBtn.textContent = '🔄';
    switchBtn.style.position = 'absolute';
    switchBtn.style.top = '10px';
    switchBtn.style.right = '10px';
    switchBtn.style.cursor = 'pointer';
    switchBtn.style.fontSize = '1.2rem';
    switchBtn.style.background = 'rgba(0,0,0,0.5)';
    switchBtn.style.borderRadius = '50%';
    switchBtn.style.padding = '5px';
    switchBtn.title = 'Switch Service';
    
    switchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentPlatformIndex = (currentPlatformIndex + 1) % creator.allPlatforms.length;
      const newPlatform = creator.allPlatforms[currentPlatformIndex];
      if (currentSite === 'cum') {
        img.src = `https://img.cum.st/creator/${newPlatform.service}/${newPlatform.id}/avatar.webp`;
      } else {
        img.src = `${PROXY_URL}/${currentSite}/icons/${newPlatform.service}/${newPlatform.id}`;
      }
      img.style.display = 'block';
      name.textContent = newPlatform.name;
      service.textContent = newPlatform.service;
      card.style.background = getServiceColor(newPlatform.service);
    });
    card.appendChild(switchBtn);
  }
  
  card.addEventListener('click', () => {
    resetFeed();
    const selectedPlatform = creator.allPlatforms ? creator.allPlatforms[currentPlatformIndex] : creator;
    currentFeedEndpoint = `${PROXY_URL}/${currentSite}/api/v1/${selectedPlatform.service}/user/${selectedPlatform.id}/posts`;
    currentFeedCreatorName = creator.name;
    // Pass the full creator object (with allPlatforms) so Linked Accounts tab can see all services
    updateNavTabs({ ...selectedPlatform, allPlatforms: creator.allPlatforms });
    if(navBack) navBack.classList.remove('hidden');
    showView(feedView, true, true);
    fetchPosts();
  });
  
  return card;
}

function renderCreatorsPage() {
  creatorsList.innerHTML = '';
  paginationContainer.innerHTML = '';
  
  const totalPages = Math.ceil(filteredCreators.length / creatorsPerPage);
  if (creatorPage > totalPages) creatorPage = totalPages;
  if (creatorPage < 1) creatorPage = 1;
  
  const start = (creatorPage - 1) * creatorsPerPage;
  const end = start + creatorsPerPage;
  const pageCreators = filteredCreators.slice(start, end);
  
  const checkedServices = serviceFilterSelect 
    ? Array.from(serviceFilterSelect.querySelectorAll('input:checked')).map(cb => cb.value)
    : [];
  
  pageCreators.forEach(creator => {
    creatorsList.appendChild(buildCreatorCard(creator, checkedServices));
  });
  
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  if (totalPages <= 1) return;
  
  // To avoid hundreds of buttons, just show a few around current page
  const maxButtons = 7;
  let startPage = Math.max(1, creatorPage - Math.floor(maxButtons / 2));
  let endPage = startPage + maxButtons - 1;
  
  if (endPage > totalPages) {
    endPage = totalPages;
    startPage = Math.max(1, endPage - maxButtons + 1);
  }
  
  if (startPage > 1) {
    paginationContainer.appendChild(createPageBtn(1));
    if (startPage > 2) {
      const dots = document.createElement('span');
      dots.textContent = '...';
      dots.style.padding = '5px';
      paginationContainer.appendChild(dots);
    }
  }
  
  for (let i = startPage; i <= endPage; i++) {
    paginationContainer.appendChild(createPageBtn(i));
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      const dots = document.createElement('span');
      dots.textContent = '...';
      dots.style.padding = '5px';
      paginationContainer.appendChild(dots);
    }
    paginationContainer.appendChild(createPageBtn(totalPages));
  }
}

function createPageBtn(pageNum) {
  const btn = document.createElement('button');
  btn.className = 'page-btn';
  btn.textContent = pageNum;
  if (pageNum === creatorPage) {
    btn.classList.add('active');
  }
  btn.addEventListener('click', () => {
    creatorPage = pageNum;
    renderCreatorsPage();
    // Scroll to top of creators view
    document.getElementById('creators-view').scrollTop = 0;
  });
  return btn;
}

function resetFeed() {
  // Cleanly stop any fetching/playing videos to avoid DOMExceptions
  const videos = feed.querySelectorAll('video');
  videos.forEach(v => {
    v.pause();
    v.removeAttribute('src');
    v.load();
  });
  feed.innerHTML = '';
  offset = 0;
  hasMore = true;
  isFetching = false;
  observer.disconnect();
}

function getMediaUrl(path) {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (currentSite === 'kemono') {
    // Kemono's main CDN (n3) is currently down/dropping connections. 
    // We use their thumbnail server as a fallback so images at least load!
    const ext = path.split('.').pop().toLowerCase();
    if (['mp4', 'webm', 'mov'].includes(ext)) {
      return `https://kemono.cr/data${path}`;
    }
    return `https://img.kemono.cr/thumbnail/data${path}`;
  } else if (currentSite === 'cum') {
    return `https://e1.cum.st${path}`;
  }
  return `${PROXY_URL}/${currentSite}/file/data${path}`;
}

const playbackObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.target.tagName.toLowerCase() === 'video') {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        const playPromise = entry.target.play();
        if (playPromise !== undefined) {
          playPromise.catch(e => { /* Ignore harmless interruption errors */ });
        }
      } else {
        entry.target.pause();
      }
    }
  });
}, { threshold: [0, 0.6] });

const mediaObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const item = entry.target;
      if (item.dataset.loaded) return;
      item.dataset.loaded = 'true';
      loadMediaWithProgress(item);
    }
  });
}, { rootMargin: '100px' });

async function loadMediaWithProgress(item) {
  const url = item.dataset.url;
  const type = item.dataset.type;
  const progressOverlay = item.querySelector('.media-progress');
  
  if (!url) {
    progressOverlay.textContent = 'No Media';
    return;
  }

  if (type === 'zip') {
    progressOverlay.style.display = 'none';
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.background = '#111';
    container.style.padding = '20px';
    container.style.boxSizing = 'border-box';
    
    const filename = item.dataset.originalName || (item.dataset.path || url).split('/').pop() || 'Archive.zip';
    
    const infoText = document.createElement('div');
    infoText.style.color = '#fff';
    infoText.style.fontFamily = 'monospace';
    infoText.style.whiteSpace = 'pre-wrap';
    infoText.style.background = 'rgba(0,0,0,0.5)';
    infoText.style.padding = '15px';
    infoText.style.borderRadius = '10px';
    infoText.style.marginBottom = '20px';
    infoText.style.maxWidth = '100%';
    infoText.style.overflow = 'auto';
    infoText.style.maxHeight = '40%';
    infoText.style.fontSize = '0.9rem';
    infoText.style.textAlign = 'left';
    infoText.textContent = `📦 ${filename}\nScanning contents...`;
    
    container.appendChild(infoText);
    
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '10px';
    btnRow.style.flexWrap = 'wrap';
    btnRow.style.justifyContent = 'center';
    
    const btnDownload = document.createElement('button');
    btnDownload.textContent = '🔽 Download';
    btnDownload.className = 'zip-action-btn';
    
    const btnPause = document.createElement('button');
    btnPause.textContent = '⏸ Pause';
    btnPause.className = 'zip-action-btn';
    btnPause.style.display = 'none';
    
    const btnAbort = document.createElement('button');
    btnAbort.textContent = '⏹ Abort';
    btnAbort.className = 'zip-action-btn';
    btnAbort.style.display = 'none';
    
    const btnSave = document.createElement('button');
    btnSave.textContent = '💾 Save to Device';
    btnSave.className = 'zip-action-btn';
    btnSave.style.display = 'none';
    
    const btnView = document.createElement('button');
    btnView.textContent = '🖼 View Gallery';
    btnView.className = 'zip-action-btn';
    btnView.style.display = 'none';
    
    btnRow.appendChild(btnDownload);
    btnRow.appendChild(btnPause);
    btnRow.appendChild(btnAbort);
    btnRow.appendChild(btnSave);
    btnRow.appendChild(btnView);
    container.appendChild(btnRow);
    
    const progressContainer = document.createElement('div');
    progressContainer.style.width = '80%';
    progressContainer.style.marginTop = '15px';
    progressContainer.style.display = 'none';
    
    const progressText = document.createElement('div');
    progressText.style.color = '#fff';
    progressText.style.fontSize = '0.8rem';
    progressText.style.marginBottom = '5px';
    progressText.style.textAlign = 'center';
    progressContainer.appendChild(progressText);
    
    const progressBar = document.createElement('div');
    progressBar.style.width = '100%';
    progressBar.style.height = '10px';
    progressBar.style.background = '#444';
    progressBar.style.borderRadius = '5px';
    
    const progressFill = document.createElement('div');
    progressFill.style.width = '0%';
    progressFill.style.height = '100%';
    progressFill.style.background = '#00AEEF';
    progressFill.style.borderRadius = '5px';
    progressFill.style.transition = 'width 0.1s linear';
    progressBar.appendChild(progressFill);
    progressContainer.appendChild(progressBar);
    
    container.appendChild(progressContainer);
    
    item.appendChild(container);
    
    let isPaused = false;
    let abortController = null;
    let zipBlob = null;
    let totalSize = 0;
    
    async function scanZip() {
      try {
        if (!window.unzipit) throw new Error('unzipit not loaded');
        const { entries } = await window.unzipit.unzip(url);
        const filenames = Object.keys(entries).filter(p => !p.endsWith('/') && !p.startsWith('__MACOSX/')).map(p => p.split('/').pop());
        
        let contentStr = `📦 ${filename}\n`;
        const MAX_FILES = 10;
        
        if (filenames.length > 0) {
          if (filenames.length > MAX_FILES) {
            contentStr += `${filenames.length} files\n`;
          }
          const displayCount = Math.min(MAX_FILES, filenames.length);
          for (let i = 0; i < displayCount; i++) {
             const isLast = (i === displayCount - 1);
             if (isLast) {
                contentStr += `└─${filenames[i]}\n`;
             } else {
                contentStr += `├─${filenames[i]}\n`;
             }
          }
          if (filenames.length > MAX_FILES) {
             contentStr += `└─ +${filenames.length - MAX_FILES} more...`;
          }
        } else {
          contentStr += `└─ (Empty or unreadable archive)`;
        }
        infoText.textContent = contentStr.trim();
        
        if (window.pawAutoDownloadZip) {
          startDownload();
        }
      } catch (err) {
        console.warn('unzipit failed, falling back', err);
        infoText.textContent = `📦 ${filename}\n(Click Download to fetch)`;
        if (window.pawAutoDownloadZip) {
          startDownload();
        }
      }
    }
    
    async function startDownload() {
      btnDownload.style.display = 'none';
      btnPause.style.display = 'inline-block';
      btnAbort.style.display = 'inline-block';
      btnSave.style.display = 'none';
      btnView.style.display = 'none';
      progressContainer.style.display = 'block';
      isPaused = false;
      btnPause.textContent = '⏸ Pause';
      
      abortController = new AbortController();
      let chunks = [];
      let downloaded = 0;
      let startTime = Date.now();
      
      try {
        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok) throw new Error('Network error');
        totalSize = parseInt(response.headers.get('content-length') || '0', 10);
        const reader = response.body.getReader();
        
        while (true) {
          if (isPaused) {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            continue;
          }
          
          const { done, value } = await reader.read();
          if (done) break;
          
          chunks.push(value);
          downloaded += value.length;
          
          if (totalSize) {
             progressFill.style.width = Math.min(100, (downloaded / totalSize) * 100) + '%';
             
             const elapsed = (Date.now() - startTime) / 1000;
             const speed = downloaded / elapsed;
             const remaining = (totalSize - downloaded) / speed;
             
             progressText.textContent = `${formatBytes(downloaded)} / ${formatBytes(totalSize)} - ${formatBytes(speed)}/s - ${Math.round(remaining)}s left`;
          } else {
             progressText.textContent = `${formatBytes(downloaded)} downloaded`;
          }
        }
        
        zipBlob = new Blob(chunks);
        btnPause.style.display = 'none';
        btnAbort.style.display = 'none';
        btnSave.style.display = 'inline-block';
        btnView.style.display = 'inline-block';
        progressContainer.style.display = 'none';
        
      } catch (err) {
        if (err.name === 'AbortError') {
          progressText.textContent = 'Aborted.';
          btnDownload.style.display = 'inline-block';
          btnPause.style.display = 'none';
          btnAbort.style.display = 'none';
        } else {
          progressText.textContent = 'Error downloading.';
          btnDownload.style.display = 'inline-block';
          btnPause.style.display = 'none';
          btnAbort.style.display = 'none';
        }
      }
    }
    
    btnDownload.addEventListener('click', (e) => { e.stopPropagation(); startDownload(); });
    
    btnPause.addEventListener('click', (e) => {
      e.stopPropagation();
      isPaused = !isPaused;
      btnPause.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
    });
    
    btnAbort.addEventListener('click', (e) => {
      e.stopPropagation();
      if (abortController) abortController.abort();
    });
    
    btnSave.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!zipBlob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    });
    
    btnView.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!zipBlob) return;
      openZipGallery(url, filename, zipBlob);
    });
    
    scanZip();
    return;
  }
  
  if (type === 'video' || type === 'audio') {
    progressOverlay.innerHTML = `Loading...<br><span style="font-size:1rem; font-weight:normal; color:#ccc">Buffering Video</span>`;
    const video = document.createElement(type === 'video' ? 'video' : 'audio');
    video.className = 'post-media';
    if (type === 'video') video.loop = true;
    if (type === 'video') video.muted = true;
    video.playsInline = true;
    video.controls = true;
    video.addEventListener('error', () => {
      showMediaUnavailableWarning(progressOverlay, type);
    });
    
    video.addEventListener('canplay', () => {
      progressOverlay.style.display = 'none';
    });
    
    video.src = url;
    item.appendChild(video);
    playbackObserver.observe(video);
    return;
  }

  try {
    // Only attempt fetch-based progress tracking if the URL is routed through our proxy.
    // Direct CDNs (Kemono, Cum.st) block CORS, which causes the browser to spam the console with 
    // uncatchable red CORS errors before Javascript can even catch the exception.
    if (!url.startsWith(PROXY_URL)) {
      throw new Error('Direct CDN URL (Bypassing fetch to prevent CORS spam)');
    }

    const response = await fetch(url);
    if (!response.ok) {
      // Check for a 404 to avoid triggering an ORB block in the fallback
      if (response.status === 404) {
        throw new Error('404_NOT_FOUND');
      }
      throw new Error('Network response was not ok');
    }
    
    const contentLength = response.headers.get('content-length');
    let total = 0;
    if (contentLength) {
      total = parseInt(contentLength, 10);
    }
    
    let loaded = 0;
    
    if (total === 0) {
      progressOverlay.innerHTML = `Loading...<br><span style="font-size:1rem; font-weight:normal; color:#ccc">Unknown Size</span>`;
      const blob = await response.blob();
      attachMedia(item, blob, type);
      progressOverlay.style.display = 'none';
      return;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let lastTime = performance.now();
    let lastLoaded = 0;
    let speedStr = "0 B/s";
    
    while(true) {
      const {done, value} = await reader.read();
      if (done) break;
      
      chunks.push(value);
      loaded += value.length;
      
      const now = performance.now();
      if (now - lastTime >= 500) {
        const bytesPerSec = (loaded - lastLoaded) / ((now - lastTime) / 1000);
        speedStr = formatBytes(bytesPerSec) + '/s';
        lastTime = now;
        lastLoaded = loaded;
        const percent = Math.round((loaded / total) * 100);
        const loadedStr = formatBytes(loaded);
        const totalStr = formatBytes(total);
        progressOverlay.innerHTML = `${percent}%<br><span style="font-size:1rem; font-weight:normal; color:#ccc">${loadedStr} / ${totalStr} &bull; ${speedStr}</span>`;
      }
    }
    
    const blob = new Blob(chunks);
    attachMedia(item, blob, type);
    progressOverlay.style.display = 'none';
  } catch (error) {
    if (error.message === '404_NOT_FOUND') {
      const path = item.dataset.path;
      
      // Helper function to show the warning if the thumbnail also fails
      const showWarning = () => showMediaUnavailableWarning(progressOverlay, type);

      // Attempt to load a thumbnail fallback directly from the native CDNs
      if (path && (currentSite === 'pawchive' || currentSite === 'kemono')) {
        let thumbUrl = '';
        
        if (currentSite === 'pawchive') {
          // Hit the Pawchive image CDN directly
          thumbUrl = `https://img.pawchive.pw/thumbnail/data${path}`;
        } else if (currentSite === 'kemono') {
          // Note: For kemono, our getMediaUrl() already defaults to thumbnails for images.
          // If an image 404s on Kemono, the thumbnail is definitely gone, so we skip straight to the warning.
          if (type !== 'video') {
            showWarning();
            return;
          }
          // Hit the Kemono image CDN directly for missing videos
          thumbUrl = `https://img.kemono.cr/thumbnail/data${path}`;
        }

        progressOverlay.innerHTML = `Loading Thumbnail...<br><span style="font-size:1rem; font-weight:normal; color:#ccc">Original missing</span>`;
        
        const thumbImg = document.createElement('img');
        thumbImg.className = 'post-media';
        
        // If the thumbnail successfully loads, hide the progress overlay
        thumbImg.onload = () => { 
          progressOverlay.style.display = 'none'; 
        };
        
        // If the thumbnail ALSO fails (e.g., the direct CDN returns a 404), show the yellow warning
        thumbImg.onerror = () => {
          showWarning(); 
        };
        
        thumbImg.src = thumbUrl;
        item.appendChild(thumbImg);
        return;
      }

      // If it's Cum.st (which lacks a reliable thumbnail endpoint), just show the warning
      showWarning();
      return;
    }

    // Original fallback logic for CORS or opaque stream failures
    progressOverlay.innerHTML = `Loading...<br><span style="font-size:1rem; font-weight:normal; color:#ccc">Direct Load</span>`;
    const img = document.createElement('img');
    img.className = 'post-media';
    img.onload = () => { progressOverlay.style.display = 'none'; };
    img.onerror = () => { img.style.display = 'none'; showMediaUnavailableWarning(progressOverlay, type); };
    img.src = url;
    item.appendChild(img);
  }
}

function attachMedia(item, blob, type) {
  const objUrl = URL.createObjectURL(blob);
  if (type === 'video' || type === 'audio') {
    const video = document.createElement(type === 'video' ? 'video' : 'audio');
    video.className = 'post-media';
    video.src = objUrl;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.controls = true;
    item.appendChild(video);
    playbackObserver.observe(video);
  } else {
    const img = document.createElement('img');
    img.className = 'post-media';
    img.src = objUrl;
    item.appendChild(img);
  }
}

function createPostCard(post) {
  const card = document.createElement('div');
  card.className = 'post-card';
  
  const carousel = document.createElement('div');
    carousel.className = 'media-carousel';

    // Native Trackpad / Scroll Wheel Wraparound
    carousel.addEventListener('wheel', (e) => {
      if (allMedia.length <= 1) return;
      if (e.deltaX < 0 && carousel.scrollLeft <= 1) {
        e.preventDefault();
        wrapCarousel(carousel, 'end');
      } else if (e.deltaX > 0 && carousel.scrollLeft >= carousel.scrollWidth - carousel.clientWidth - 2) {
        e.preventDefault();
        wrapCarousel(carousel, 'start');
      }
    }, {passive: false});

    // Native Mobile Touch Wraparound
    let touchStartX = 0;
    carousel.addEventListener('touchstart', (e) => {
      if (allMedia.length <= 1) return;
      touchStartX = e.touches[0].clientX;
    }, {passive: true});
    
    carousel.addEventListener('touchmove', (e) => {
      if (allMedia.length <= 1) return;
      const dx = touchStartX - e.touches[0].clientX;
      if (dx < 0 && carousel.scrollLeft <= 1) {
        e.preventDefault();
      } else if (dx > 0 && carousel.scrollLeft >= carousel.scrollWidth - carousel.clientWidth - 2) {
        e.preventDefault();
      }
    }, {passive: false});
    
    carousel.addEventListener('touchend', (e) => {
      if (allMedia.length <= 1) return;
      const dx = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(dx) > 40) {
        if (dx < 0 && carousel.scrollLeft <= 1) {
          wrapCarousel(carousel, 'end');
        } else if (dx > 0 && carousel.scrollLeft >= carousel.scrollWidth - carousel.clientWidth - 2) {
          wrapCarousel(carousel, 'start');
        }
      }
    });
  
  let allMedia = [];
  const supportedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'mp4', 'webm', 'mov', 'zip', 'mp3', 'ogg', 'wav', 'm4a'];
  function categorizeFile(fileObj) {
    if (!fileObj || !fileObj.path) return;
    const ext = fileObj.path.split('.').pop().toLowerCase();
    if (supportedExts.includes(ext) && !allMedia.some(m => m.path === fileObj.path)) {
      allMedia.push({ path: fileObj.path, name: fileObj.name || fileObj.path.split('/').pop() });
    }
  }

  if (post.file) categorizeFile(post.file);
  if (post.attachments && post.attachments.length > 0) {
    post.attachments.forEach(att => categorizeFile(att));
  }

  // Extract inline images from post content (very common in Announcements)
  let cleanContent = post.content || post.substring || "";
  if (cleanContent) {
    const tmp = document.createElement('div');
    tmp.innerHTML = cleanContent;
    const inlineImgs = tmp.querySelectorAll('img');
    inlineImgs.forEach(img => {
      const src = img.getAttribute('src');
      if (src && !allMedia.some(m => m.path === src)) {
        allMedia.push({ path: src, name: src.split('/').pop() });
      }
      img.remove(); // Strip it from the text info overlay!
    });
    // Re-serialize content without the inline images
    cleanContent = tmp.innerHTML;
  }

  if (allMedia.length === 0 && settingHideNoMedia && settingHideNoMedia.checked) {
    // Only apply the "Hide empty posts" rule to the main posts feed. 
    // Announcements and DMs are expected to be text-only!
    if (currentFeedEndpoint.endsWith('/posts') || currentFeedEndpoint.endsWith('/posts?o=0')) {
      return null; // Skip rendering this post
    }
  }

  if (allMedia.length > 0) {
    allMedia.forEach(mediaObj => {
      const mediaPath = mediaObj.path;
      const item = document.createElement('div');
      item.className = 'media-item';
      item.dataset.originalName = mediaObj.name;
      
      const ext = mediaPath.split('.').pop().toLowerCase();
      const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
      const isAudio = ['mp3', 'ogg', 'wav', 'm4a'].includes(ext);
      
      const progressOverlay = document.createElement('div');
      progressOverlay.className = 'media-progress';
      item.appendChild(progressOverlay);

      progressOverlay.innerHTML = `Loading...<br><span style="font-size:1rem; font-weight:normal; color:#ccc">Connecting...</span>`;
        item.dataset.url = getMediaUrl(mediaPath);
        item.dataset.path = mediaPath; // <--- ADD THIS LINE
        item.dataset.type = ext === 'zip' ? 'zip' : isVideo ? 'video' : isAudio ? 'audio' : 'image';
        carousel.appendChild(item);
        mediaObserver.observe(item);
    });
    
    const indicator = document.createElement('div');
    indicator.className = 'carousel-indicator';
    indicator.textContent = `1 / ${allMedia.length}`;
    indicator.style.cursor = 'pointer';
    
    // Only show indicator initially if >1 media
    if (allMedia.length > 1) {
      indicator.style.pointerEvents = 'auto';
    } else {
      indicator.style.display = 'none';
      indicator.style.pointerEvents = 'none';
    }

    indicator.addEventListener('click', (e) => {
      e.stopPropagation();
      carousel.dataset.targetScroll = 0;
      carousel.dataset.scrollDir = 'left';
      carousel.style.scrollSnapType = 'none';
      carousel.scrollTo({ left: 0, behavior: window.pawAnimationsDisabled ? 'auto' : 'smooth' });
    });
    
    setTimeout(() => {
      carousel.scrollLeft = 0;
    }, 0);
    card.appendChild(indicator);
    
    carousel.addEventListener('scroll', () => {
      const index = Math.round(carousel.scrollLeft / window.innerWidth);
      indicator.textContent = `${index + 1} / ${allMedia.length}`;
    });

  } else {
    const fallback = document.createElement('div');
    fallback.className = 'media-item';
    const fallbackMsg = document.createElement('div');
    fallbackMsg.className = 'post-no-media';
    fallbackMsg.textContent = 'No Media Available';
    fallback.appendChild(fallbackMsg);
    carousel.appendChild(fallback);
  }

  card.appendChild(carousel);

  const info = document.createElement('div');
  info.className = 'post-info';
  
  const author = document.createElement('div');
  author.className = 'post-author';
  author.style.display = 'flex';
  author.style.alignItems = 'center';
  author.style.gap = '8px';
  
  const creator = allCreators.find(c => c.id === post.user && c.service === post.service);
  const displayName = post.authorName || (creator ? creator.name : currentFeedCreatorName) || post.user;
  
  const authorNameSpan = document.createElement('span');
  authorNameSpan.textContent = `Creator: ${displayName}`;
  author.appendChild(authorNameSpan);
  
  const serviceIcon = document.createElement('img');
  serviceIcon.src = `icons/${post.service}.svg`;
  serviceIcon.style.objectFit = 'contain';
  serviceIcon.style.flexShrink = '0'; // Prevent icon from shrinking during flex layout changes
  
  if (post.service === 'fantia') {
    serviceIcon.style.width = '50px';
    serviceIcon.style.height = '24px';
    serviceIcon.style.marginBottom = '0px';
  } else if (post.service === 'dlsite') {
    serviceIcon.style.width = '50px';
    serviceIcon.style.height = '24px';
    serviceIcon.style.marginBottom = '4px';
  } else if (post.service === 'onlyfans') {
    serviceIcon.style.width = '24px';
    serviceIcon.style.height = '24px';
    serviceIcon.style.marginBottom = '4px';
  } else {
    serviceIcon.style.width = '18px';
    serviceIcon.style.height = '18px';
    serviceIcon.style.marginBottom = '4px'; // Optical alignment with text baseline
  }
  serviceIcon.title = post.service; // tooltip
  serviceIcon.onerror = () => {
    serviceIcon.style.display = 'none';
    const fallbackText = document.createElement('span');
    fallbackText.textContent = `(${post.service})`;
    fallbackText.style.opacity = '0.7';
    fallbackText.style.fontSize = '0.9em';
    author.appendChild(fallbackText);
  };
  author.appendChild(serviceIcon);

  const title = document.createElement('div');
  title.className = 'post-title';
  title.innerHTML = post.title || 'Untitled';

  info.appendChild(author);
  info.appendChild(title);

  const content = document.createElement('div');
  content.className = 'post-content';
  
  if (cleanContent) {
    cleanContent = cleanContent.replace(/<a /gi, '<a target="_blank" rel="noopener noreferrer" ');
    content.innerHTML = cleanContent;
    info.appendChild(content);
  }

  // Zip buttons are now rendered as standard media cards in the carousel
  card.addEventListener('click', (e) => {
    if (e.target.tagName.toLowerCase() === 'a') return;
    
    // Ignore clicks on video elements so native controls work
    if (e.target.tagName.toLowerCase() === 'video') return;
    
    if (card.dataset.isDragging === 'true') {
      card.dataset.isDragging = 'false';
      return;
    }

    if (!e.target.closest('.post-info') || !info.classList.contains('expanded')) {
      const x = e.clientX;
      const y = e.clientY;
      const w = window.innerWidth;
      const h = window.innerHeight;

      if (y < h * 0.15) {
        if (feed.dataset.scrollDir === 'down') return;
        let target = feed.dataset.targetScroll !== undefined ? parseFloat(feed.dataset.targetScroll) : Math.round(feed.scrollTop / h) * h;
        target = Math.max(0, target - h);
        feed.dataset.targetScroll = target;
        feed.dataset.scrollDir = 'up';
        feed.style.scrollSnapType = 'none';
        feed.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? 'auto' : 'smooth' });
        return;
      }
      if (y > h * 0.85) {
        if (feed.dataset.scrollDir === 'up') return;
        let target = feed.dataset.targetScroll !== undefined ? parseFloat(feed.dataset.targetScroll) : Math.round(feed.scrollTop / h) * h;
        target = Math.min(target + h, feed.scrollHeight - feed.clientHeight);
        feed.dataset.targetScroll = target;
        feed.dataset.scrollDir = 'down';
        feed.style.scrollSnapType = 'none';
        feed.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? 'auto' : 'smooth' });
        return;
      }
      if (x < w * 0.20 && allMedia.length > 1) {
        if (carousel.dataset.scrollDir === 'right') return;
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
        return;
      }
      if (x > w * 0.80 && allMedia.length > 1) {
        if (carousel.dataset.scrollDir === 'left') return;
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
        return;
      }
    }
    
    // Post info is only toggled via the ℹ️ nav button
  });

  card.appendChild(info);
  return card;
}

async function fetchPosts() {
  if (isFetching || !hasMore) return;
  isFetching = true;
  feedLoading.classList.add('active'); startProgress();

  try {
    // Announcements don't paginate — they always return all items at once
    const isAnnouncements = currentFeedEndpoint.includes('/announcements');
    const url = isAnnouncements ? currentFeedEndpoint : `${currentFeedEndpoint}?o=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch: ' + res.status + ' ' + res.statusText);
    let posts = await res.json();
    // kemono/cum.st wrap feeds under their respective keys
    if (!Array.isArray(posts)) {
      posts = posts.posts || posts.announcements || posts.dms || [];
    }
    
    // Announcements return everything at once — disable further pagination
    if (isAnnouncements) hasMore = false;
    
    if (!Array.isArray(posts) || posts.length === 0) {
      hasMore = false;
    } else {
      const currentCards = feed.querySelectorAll('.post-card');
      if (currentCards.length > 0) {
        observer.unobserve(currentCards[currentCards.length - 1]);
      }

      posts.forEach(post => {
        // Normalize announcement fields: they use user_id instead of user, and have no title
        if (!post.user && post.user_id) post.user = post.user_id;
        if (!post.title && post.added) {
          const d = new Date(post.added);
          post.title = `Announcement — ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
        }

        // Normalize Moxxy API (cum.st) to Kemono API format
        if (currentSite === 'cum') {
          post.user = post.user || post.creatorId;
          if (!post.user) {
            const match = currentFeedEndpoint.match(/\/user\/([^\/]+)/);
            if (match) post.user = match[1];
          }
          post.authorName = post.creatorName;
          // cum.st uses captionHtml for posts and contentHtml for DMs
          post.content = post.captionHtml || post.contentHtml || post.caption || post.content || '';
          if (!post.title && post.content) {
            // Derive a short title from the first text paragraph
            const tmp = document.createElement('div');
            tmp.innerHTML = post.content;
            let firstNode = null;
            for (const node of tmp.childNodes) {
              const text = (node.textContent || '').trim();
              if (text) { firstNode = node; break; }
            }
            if (firstNode) {
              // Use innerHTML to preserve <br> formatting within the first paragraph
              post.title = firstNode.innerHTML || (firstNode.textContent || '').trim();
              // Remove the first paragraph from content so it doesn't duplicate in description
              firstNode.remove();
              post.content = tmp.innerHTML.trim();
            }
          }
          if (!post.file && post.attachments && post.attachments.length > 0) {
             const first = post.attachments[0];
             if (first.storageKey && first.variants && first.variants.length > 0) {
                 post.file = { path: `/media/${first.storageKey}/${first.variants[0].name}` };
             } else {
                 let ext = 'jpg';
                 if (first.mimeType) ext = first.mimeType.split('/').pop().toLowerCase().replace('jpeg', 'jpg');
                 else if (first.kind === 'video') ext = 'mp4';
                 post.file = { path: `/unimported.${ext}` };
             }
          }
          
          if (post.attachments && post.attachments.length > 0) {
             post.attachments = post.attachments.map(att => {
                 if (att.storageKey && att.variants && att.variants.length > 0) {
                     return { path: `/media/${att.storageKey}/${att.variants[0].name}` };
                 } else {
                     let ext = 'jpg';
                     if (att.mimeType) ext = att.mimeType.split('/').pop().toLowerCase().replace('jpeg', 'jpg');
                     else if (att.kind === 'video') ext = 'mp4';
                     return { path: `/unimported.${ext}` };
                 }
             });
          }
        }

        const card = createPostCard(post);
        if (card) {
          feed.appendChild(card);
        }
      });

      offset += posts.length;
      
      const newCards = feed.querySelectorAll('.post-card');
      if (newCards.length > 0) {
        observer.observe(newCards[newCards.length - 1]);
      } else if (hasMore) {
        // We fetched a full chunk, but every single post was filtered out (e.g. by hideNoMedia).
        // Since there are no cards to observe, we must immediately fetch the next chunk!
        setTimeout(() => fetchPosts(), 100);
      }
    }
  } catch (error) {
    if (error.message.includes('404')) {
      if (offset === 0) {
        feed.innerHTML = '<div style="text-align:center; padding: 40px; color: #aaa;">No items found.</div>';
      }
    } else {
      console.error("Error fetching posts:", error);
    }
  } finally {
    isFetching = false;
    feedLoading.classList.remove('active'); stopProgress();
  }
}

// Mouse swipe simulation for desktop
let swipeStartX = 0;
let swipeStartY = 0;

let feedScrollTimeout;
document.getElementById('feed').addEventListener('scroll', (e) => {
  closeAllPostInfo();
  const feed = e.target;
  clearTimeout(feedScrollTimeout);
  feedScrollTimeout = setTimeout(() => {
    delete feed.dataset.targetScroll;
    delete feed.dataset.scrollDir;
    feed.style.scrollSnapType = '';
  }, 150);
});

let carouselScrollTimeouts = new Map();
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
let lastEdgeTap = 0;

document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.post-info.expanded')) return;
  
  // Ignore swipe gestures if starting in an edge tap zone to prevent accidental opposite swipes
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

  // Intercept navigation for ZIP viewer if open
  if (!zipViewer.classList.contains('hidden')) {
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

  if (!feedView.classList.contains('active')) return;
  
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
const zipViewer = document.getElementById('zip-viewer');
const zipTitle = document.getElementById('zip-title');
const zipContent = document.getElementById('zip-content');
const zipIndicator = document.getElementById('zip-indicator');
const closeZipViewer = document.getElementById('close-zip-viewer');
const zipNav = document.getElementById('zip-nav');
const zipHomeViewer = document.getElementById('zip-home-viewer');
let currentZipObjectUrls = [];

if (closeZipViewer) {
  closeZipViewer.addEventListener('click', () => {
    zipViewer.classList.add('hidden');
    zipContent.innerHTML = '';
    currentZipObjectUrls.forEach(url => URL.revokeObjectURL(url));
    currentZipObjectUrls = [];
  });
}

const zipSettingsViewer = document.getElementById('zip-settings-viewer');
if (zipSettingsViewer && settingsMenu) {
  zipSettingsViewer.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.toggle('active');
  });
}

if (zipHomeViewer) {
  zipHomeViewer.addEventListener('click', () => {
    zipViewer.classList.add('hidden');
    zipContent.innerHTML = '';
    currentZipObjectUrls.forEach(url => URL.revokeObjectURL(url));
    currentZipObjectUrls = [];
    currentFeedCreatorName = null;
    updateNavTabs(null);
    showView(welcomeScreen, false);
    if(navBack) navBack.classList.add('hidden');
  });
}

if (zipIndicator) {
  zipIndicator.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentZipObjectUrls.length === 0) return;
    zipContent.dataset.targetScroll = 0;
    zipContent.dataset.scrollDir = 'left';
    zipContent.style.scrollSnapType = 'none';
    zipContent.scrollTo({ left: 0, behavior: window.pawAnimationsDisabled ? 'auto' : 'smooth' });
  });
}

function updateZipNavVisibility(e) {
  let isTop = false;
  if (e.type === 'touchstart') {
     isTop = e.touches[0].clientY < 100;
  } else {
     isTop = e.clientY < 100;
  }
  
  if (isTop) {
     if(zipNav) zipNav.style.opacity = '1';
     if(closeZipViewer) closeZipViewer.style.pointerEvents = 'auto';
     if(zipHomeViewer) zipHomeViewer.style.pointerEvents = 'auto';
     if(zipIndicator) zipIndicator.style.transform = 'translateY(45px)';
  } else {
     if(zipNav) zipNav.style.opacity = '0';
     if(closeZipViewer) closeZipViewer.style.pointerEvents = 'none';
     if(zipHomeViewer) zipHomeViewer.style.pointerEvents = 'none';
     if(zipIndicator) zipIndicator.style.transform = 'translateY(0)';
  }
}

zipViewer.addEventListener('mousemove', updateZipNavVisibility);
zipViewer.addEventListener('touchstart', updateZipNavVisibility, {passive: true});

zipContent.addEventListener('scroll', () => {
  if (currentZipObjectUrls.length <= 1) return;
  const index = Math.round(zipContent.scrollLeft / zipContent.clientWidth) + 1;
  zipIndicator.textContent = `${index} / ${currentZipObjectUrls.length}`;
});

zipViewer.addEventListener('click', (e) => {
  if (e.target.tagName.toLowerCase() === 'button' || e.target.id === 'zip-indicator') return;
  const x = e.clientX;
  const w = window.innerWidth;
  
  if (x < w * 0.2) { // left 20%
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
  } else if (x > w * 0.8) { // right 20%
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
});

async function openZipGallery(zipUrl, filename, cachedBlob = null) {
  zipViewer.classList.remove('hidden');
  zipTitle.textContent = filename;
  zipIndicator.textContent = '';
  zipContent.innerHTML = '<div id="zip-progress-text" style="color:white; margin: auto; text-align: center;">Connecting...</div>';
  
  try {
    let blob = cachedBlob;
    
    if (!blob) {
      const response = await fetch(zipUrl);
      if (!response.ok) throw new Error('Network response was not ok');
      
      const contentLength = response.headers.get('content-length');
      const total = parseInt(contentLength, 10);
      let loaded = 0;
      const startTime = Date.now();
      const reader = response.body.getReader();
      const chunks = [];
      
      while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        
        const progressText = document.getElementById('zip-progress-text');
        if (progressText && total) {
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? formatBytes(loaded / elapsed) + '/s' : '...';
          const percent = Math.round((loaded / total) * 100);
          progressText.innerHTML = `Downloading Archive...<br><br><span style="font-size:1.5rem">${percent}%</span><br><br>${formatBytes(loaded)} / ${formatBytes(total)}<br>${speed}`;
        } else if (progressText) {
          progressText.innerHTML = `Downloading Archive...<br><br>${formatBytes(loaded)} downloaded`;
        }
      }
      blob = new Blob(chunks);
    }
    
    const progressText = document.getElementById('zip-progress-text');
    if (progressText) progressText.innerHTML = 'Extracting files...';
    const zip = await JSZip.loadAsync(blob);
    
    zipContent.innerHTML = '';
    currentZipObjectUrls.forEach(url => URL.revokeObjectURL(url));
    currentZipObjectUrls = [];
    
    const imageFiles = [];
    zip.forEach((relativePath, zipEntry) => {
      const ext = relativePath.split('.').pop().toLowerCase();
      if (!zipEntry.dir && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext)) {
        imageFiles.push(zipEntry);
      }
    });
    
    // Sort files naturally by name
    imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    
    if (imageFiles.length === 0) {
      zipIndicator.textContent = '';
      zipContent.innerHTML = '<div style="color:white; margin: auto;">No images found in this ZIP archive.</div>';
      return;
    }
    
    zipIndicator.textContent = `1 / ${imageFiles.length}`;
    
    for (const file of imageFiles) {
      const fileBlob = await file.async("blob");
      const objUrl = URL.createObjectURL(fileBlob);
      currentZipObjectUrls.push(objUrl);
      
      const imgContainer = document.createElement('div');
      imgContainer.style.flex = '0 0 100vw';
      imgContainer.style.height = '100%';
      imgContainer.style.scrollSnapAlign = 'start';
      imgContainer.style.display = 'flex';
      imgContainer.style.alignItems = 'center';
      imgContainer.style.justifyContent = 'center';
      imgContainer.style.position = 'relative';
      
      const img = document.createElement('img');
      img.src = objUrl;
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.objectFit = 'contain';
      img.loading = 'lazy';
      
      imgContainer.appendChild(img);
      zipContent.appendChild(imgContainer);
    }
    
    // Add wrap-around and snap behavior similar to carousel
    zipContent.addEventListener('wheel', (e) => {
      if (imageFiles.length <= 1) return;
      if (e.deltaX < 0 && zipContent.scrollLeft <= 1) {
        e.preventDefault();
        wrapCarousel(zipContent, 'end');
      } else if (e.deltaX > 0 && zipContent.scrollLeft >= zipContent.scrollWidth - zipContent.clientWidth - 2) {
        e.preventDefault();
        wrapCarousel(zipContent, 'start');
      }
    }, {passive: false});

    let touchStartX = 0;
    zipContent.addEventListener('touchstart', (e) => {
      if (imageFiles.length <= 1) return;
      touchStartX = e.touches[0].clientX;
    }, {passive: true});
    
    zipContent.addEventListener('touchmove', (e) => {
      if (imageFiles.length <= 1) return;
      const dx = touchStartX - e.touches[0].clientX;
      if (dx < 0 && zipContent.scrollLeft <= 1) {
        e.preventDefault();
      } else if (dx > 0 && zipContent.scrollLeft >= zipContent.scrollWidth - zipContent.clientWidth - 2) {
        e.preventDefault();
      }
    }, {passive: false});
    
    zipContent.addEventListener('touchend', (e) => {
      if (imageFiles.length <= 1) return;
      const dx = touchStartX - e.changedTouches[0].clientX;
      if (dx < -50 && zipContent.scrollLeft <= 1) {
        wrapCarousel(zipContent, 'end');
      } else if (dx > 50 && zipContent.scrollLeft >= zipContent.scrollWidth - zipContent.clientWidth - 2) {
        wrapCarousel(zipContent, 'start');
      }
    }, {passive: true});
    
  } catch (err) {
    console.error(err);
    zipTitle.textContent = 'Error';
    zipIndicator.textContent = '';
    zipContent.innerHTML = '';
    showMediaUnavailableWarning(zipContent, 'zip');
  }
}


// --- Scroll Hijacker for Disabled Animations ---
let lastHijackTime = 0;
document.addEventListener('wheel', (e) => {
  if (!window.pawAnimationsDisabled) return;
  if (e.target.closest('#zip-settings-viewer') || e.target.closest('#settings-menu') || e.target.closest('.media-progress') || e.target.closest('.creator-list')) return;
  
  // Throttle wheel events so a trackpad swipe doesn't fly through 10 posts
  const now = Date.now();
  if (now - lastHijackTime < 400) {
    e.preventDefault();
    return;
  }
  
  const carousel = e.target.closest('.media-carousel');
  const zipContent = e.target.closest('#zip-content');
  const feed = e.target.closest('#feed');
  
  if (zipContent && !document.getElementById('zip-viewer').classList.contains('hidden')) {
    e.preventDefault();
    lastHijackTime = now;
    const w = window.innerWidth;
    let target = Math.round(zipContent.scrollLeft / w) * w;
    if (e.deltaY > 0 || e.deltaX > 0) target += w;
    else if (e.deltaY < 0 || e.deltaX < 0) target -= w;
    target = Math.max(0, Math.min(target, zipContent.scrollWidth - zipContent.clientWidth));
    zipContent.scrollTo({ left: target, behavior: 'auto' });
  } else if (carousel) {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      lastHijackTime = now;
      const w = window.innerWidth;
      let target = Math.round(carousel.scrollLeft / w) * w;
      if (e.deltaX > 0) target += w;
      else if (e.deltaX < 0) target -= w;
      target = Math.max(0, Math.min(target, carousel.scrollWidth - carousel.clientWidth));
      carousel.scrollTo({ left: target, behavior: 'auto' });
    }
  } else if (feed && !document.getElementById('feed-view').classList.contains('hidden')) {
    e.preventDefault();
    lastHijackTime = now;
    const h = window.innerHeight;
    let target = Math.round(feed.scrollTop / h) * h;
    if (e.deltaY > 0) target += h;
    else if (e.deltaY < 0) target -= h;
    target = Math.max(0, Math.min(target, feed.scrollHeight - feed.clientHeight));
    feed.scrollTo({ top: target, behavior: 'auto' });
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
  if (e.target.closest('#zip-settings-viewer') || e.target.closest('#settings-menu') || e.target.closest('.media-progress') || e.target.closest('.creator-list')) return;
  
  const dx = e.touches[0].clientX - globalTouchStartX;
  const dy = e.touches[0].clientY - globalTouchStartY;
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
     if (e.cancelable) e.preventDefault();
  }
}, { passive: false });

document.addEventListener('touchend', (e) => {
  if (!window.pawAnimationsDisabled) return;
  if (e.target.closest('#zip-settings-viewer') || e.target.closest('#settings-menu') || e.target.closest('.media-progress') || e.target.closest('.creator-list')) return;
  if (touchHijackHandled) return;
  
  const dx = globalTouchStartX - e.changedTouches[0].clientX;
  const dy = globalTouchStartY - e.changedTouches[0].clientY;
  
  if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return; // Not a swipe
  touchHijackHandled = true;
  
  const carousel = e.target.closest('.media-carousel');
  const zipContent = e.target.closest('#zip-content');
  const feed = e.target.closest('#feed');
  
  if (zipContent && !document.getElementById('zip-viewer').classList.contains('hidden')) {
    if (Math.abs(dx) > Math.abs(dy)) {
       const w = window.innerWidth;
       let target = Math.round(zipContent.scrollLeft / w) * w;
       if (dx > 30) target += w;
       else if (dx < -30) target -= w;
       target = Math.max(0, Math.min(target, zipContent.scrollWidth - zipContent.clientWidth));
       zipContent.scrollTo({ left: target, behavior: 'auto' });
    }
  } else if (carousel) {
    if (Math.abs(dx) > Math.abs(dy)) {
       const w = window.innerWidth;
       let target = Math.round(carousel.scrollLeft / w) * w;
       if (dx > 30) target += w;
       else if (dx < -30) target -= w;
       target = Math.max(0, Math.min(target, carousel.scrollWidth - carousel.clientWidth));
       carousel.scrollTo({ left: target, behavior: 'auto' });
    } else if (feed) {
       const h = window.innerHeight;
       let target = Math.round(feed.scrollTop / h) * h;
       if (dy > 30) target += h;
       else if (dy < -30) target -= h;
       target = Math.max(0, Math.min(target, feed.scrollHeight - feed.clientHeight));
       feed.scrollTo({ top: target, behavior: 'auto' });
    }
  } else if (feed && !document.getElementById('feed-view').classList.contains('hidden')) {
    const h = window.innerHeight;
    let target = Math.round(feed.scrollTop / h) * h;
    if (dy > 30) target += h;
    else if (dy < -30) target -= h;
    target = Math.max(0, Math.min(target, feed.scrollHeight - feed.clientHeight));
    feed.scrollTo({ top: target, behavior: 'auto' });
  }
});
// --- End Scroll Hijacker ---

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
  if (anyInfoExpanded || mouseY < 80) {
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
const navSettings = document.getElementById('nav-settings');
const settingsMenu = document.getElementById('settings-menu');

if (navSettings && settingsMenu) {
  navSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.toggle('active');
  });
  
  document.addEventListener('click', (e) => {
    if (!settingsMenu.contains(e.target) && e.target !== navSettings) {
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
  }
  
  updateSiteSpecificUI();
  siteSelector.addEventListener('change', (e) => { 
    currentSite = e.target.value; 
    updateSiteSpecificUI();
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
  carousel.scrollTo({ left: target, behavior: 'smooth' });
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
  
  if (viewElement === feedView) {
    nav.classList.add('auto-hide');
    updateNavVisibility();
  } else {
    nav.classList.remove('auto-hide');
  }
}

navHome.addEventListener('click', () => {
  showView(welcomeScreen, false);
  if(navBack) navBack.classList.add('hidden');
});

if(navBack) {
  navBack.addEventListener('click', () => {
    showView(creatorsView, true);
    navBack.classList.add('hidden');
  });
}

btnLatest.addEventListener('click', async () => {
  resetFeed();
  currentFeedEndpoint = `${PROXY_URL}/${currentSite}/api/v1/posts`;
  currentFeedCreatorName = null;
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
    const card = document.createElement('div');
    card.className = 'creator-card';
    
    let currentPlatformIndex = 0;
    if (checkedServices.length > 0 && creator.allPlatforms) {
      const idx = creator.allPlatforms.findIndex(p => checkedServices.includes(p.service));
      if (idx !== -1) currentPlatformIndex = idx;
    }
    
    const initialPlatform = creator.allPlatforms ? creator.allPlatforms[currentPlatformIndex] : creator;
    
    card.style.backgroundColor = getServiceColor(initialPlatform.service);
    
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
      
      switchBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent card click
        currentPlatformIndex = (currentPlatformIndex + 1) % creator.allPlatforms.length;
        const newPlatform = creator.allPlatforms[currentPlatformIndex];
        
        if (currentSite === 'cum') {
          img.src = `https://img.cum.st/creator/${newPlatform.service}/${newPlatform.id}/avatar.webp`;
        } else {
          img.src = `${PROXY_URL}/${currentSite}/icons/${newPlatform.service}/${newPlatform.id}`;
        }
        service.textContent = newPlatform.service;
        card.style.backgroundColor = getServiceColor(newPlatform.service);
      });
      card.appendChild(switchBtn);
    }
    
    card.addEventListener('click', () => {
      resetFeed();
      const selectedPlatform = creator.allPlatforms ? creator.allPlatforms[currentPlatformIndex] : creator;
      currentFeedEndpoint = `${PROXY_URL}/${currentSite}/api/v1/${selectedPlatform.service}/user/${selectedPlatform.id}/posts`;
      currentFeedCreatorName = creator.name;
      if(navBack) navBack.classList.remove('hidden');
      showView(feedView, true, true);
      fetchPosts();
    });
    
    creatorsList.appendChild(card);
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
  
  if (type === 'video') {
    progressOverlay.innerHTML = `Loading...<br><span style="font-size:1rem; font-weight:normal; color:#ccc">Buffering Video</span>`;
    const video = document.createElement('video');
    video.className = 'post-media';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.controls = true;
    video.addEventListener('error', () => {
      progressOverlay.innerHTML = '<span style="color:#ff4444">Video Error</span>';
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
    if (!response.ok) throw new Error('Network response was not ok');
    
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
    progressOverlay.innerHTML = `Loading...<br><span style="font-size:1rem; font-weight:normal; color:#ccc">Direct Load</span>`;
    const img = document.createElement('img');
    img.className = 'post-media';
    img.onload = () => { progressOverlay.style.display = 'none'; };
    img.onerror = () => { progressOverlay.innerHTML = '<span style="color:#ff4444">Image Error</span>'; };
    img.src = url;
    item.appendChild(img);
  }
}

function attachMedia(item, blob, type) {
  const objUrl = URL.createObjectURL(blob);
  if (type === 'video') {
    const video = document.createElement('video');
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
  const supportedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'mp4', 'webm', 'mov'];
  function isValidMedia(path) {
    if (!path) return false;
    const ext = path.split('.').pop().toLowerCase();
    return supportedExts.includes(ext);
  }

  if (post.file && isValidMedia(post.file.path)) allMedia.push(post.file.path);
  if (post.attachments && post.attachments.length > 0) {
    post.attachments.forEach(att => {
      if (att && isValidMedia(att.path) && !allMedia.includes(att.path)) {
        allMedia.push(att.path);
      }
    });
  }

  if (allMedia.length > 0) {
    allMedia.forEach(mediaPath => {
      const item = document.createElement('div');
      item.className = 'media-item';
      
      const ext = mediaPath.split('.').pop().toLowerCase();
      const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
      
      const progressOverlay = document.createElement('div');
      progressOverlay.className = 'media-progress';
      item.appendChild(progressOverlay);

      progressOverlay.innerHTML = `Loading...<br><span style="font-size:1rem; font-weight:normal; color:#ccc">Connecting...</span>`;
        item.dataset.url = getMediaUrl(mediaPath);
        item.dataset.type = isVideo ? 'video' : 'image';
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
      carousel.scrollTo({ left: 0, behavior: 'smooth' });
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
  title.textContent = post.title || 'Untitled';

  info.appendChild(author);
  info.appendChild(title);

  const content = document.createElement('div');
  content.className = 'post-content';
  let cleanContent = post.content || post.substring || "";
  
  if (cleanContent) {
    cleanContent = cleanContent.replace(/<a /gi, '<a target="_blank" rel="noopener noreferrer" ');
    content.innerHTML = cleanContent;
    info.appendChild(content);
  }

  
  
  

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
        feed.scrollTo({ top: target, behavior: 'smooth' });
        return;
      }
      if (y > h * 0.85) {
        if (feed.dataset.scrollDir === 'up') return;
        let target = feed.dataset.targetScroll !== undefined ? parseFloat(feed.dataset.targetScroll) : Math.round(feed.scrollTop / h) * h;
        target = Math.min(target + h, feed.scrollHeight - feed.clientHeight);
        feed.dataset.targetScroll = target;
        feed.dataset.scrollDir = 'down';
        feed.style.scrollSnapType = 'none';
        feed.scrollTo({ top: target, behavior: 'smooth' });
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
        carousel.scrollTo({ left: target, behavior: 'smooth' });
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
        carousel.scrollTo({ left: target, behavior: 'smooth' });
        return;
      }
    }
    
    info.classList.toggle('expanded');
    updateNavVisibility();
  });

  card.appendChild(info);
  return card;
}



async function fetchPosts() {
  if (isFetching || !hasMore) return;
  isFetching = true;
  feedLoading.classList.add('active'); startProgress();

  try {
    const res = await fetch(`${currentFeedEndpoint}?o=${offset}`);
    if (!res.ok) throw new Error('Failed to fetch: ' + res.status + ' ' + res.statusText);
    let posts = await res.json();
    // kemono/cum.st wrap posts in { posts: [...] }
    if (!Array.isArray(posts) && posts.posts) {
      posts = posts.posts;
    }
    
    if (!Array.isArray(posts) || posts.length === 0) {
      hasMore = false;
    } else {
      const currentCards = feed.querySelectorAll('.post-card');
      if (currentCards.length > 0) {
        observer.unobserve(currentCards[currentCards.length - 1]);
      }

      posts.forEach(post => {
        // Normalize Moxxy API (cum.st) to Kemono API format
        if (currentSite === 'cum') {
          post.user = post.user || post.creatorId;
          if (!post.user) {
            const match = currentFeedEndpoint.match(/\/user\/([^\/]+)/);
            if (match) post.user = match[1];
          }
          post.authorName = post.creatorName;
          // Map Moxxy storageKeys to the correct e1.cum.st path format
          post.content = post.content || post.captionHtml || post.caption || '';
          if (!post.title && post.content) {
            const tmp = document.createElement('div');
            tmp.innerHTML = post.content;
            let plainText = (tmp.textContent || tmp.innerText || '').trim();
            if (plainText) {
              post.title = plainText; // No truncation so no text is lost
              post.content = ''; // Clear description to prevent duplication
            }
          }
          if (!post.file && post.attachments && post.attachments.length > 0) {
             const first = post.attachments.find(a => a.storageKey && a.variants && a.variants.length > 0);
             if (first) {
                 post.file = { path: `/media/${first.storageKey}/${first.variants[0].name}` };
             }
          }
          
          if (post.attachments && post.attachments.length > 0) {
             post.attachments = post.attachments.filter(a => a.storageKey && a.variants && a.variants.length > 0).map(att => {
                 return { path: `/media/${att.storageKey}/${att.variants[0].name}` };
             });
          }
        }

        const card = createPostCard(post);
        feed.appendChild(card);
      });

      offset += posts.length;
      
      const newCards = feed.querySelectorAll('.post-card');
      if (newCards.length > 0) {
        observer.observe(newCards[newCards.length - 1]);
      }
    }
  } catch (error) {
    console.error("Error fetching posts:", error);
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
  if (e.target && e.target.classList && e.target.classList.contains('media-carousel')) {
    closeAllPostInfo();
    const carousel = e.target;
    clearTimeout(carouselScrollTimeouts.get(carousel));
    carouselScrollTimeouts.set(carousel, setTimeout(() => {
      delete carousel.dataset.targetScroll;
      delete carousel.dataset.scrollDir;
      carousel.style.scrollSnapType = '';
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
        if (dy > 50) feed.scrollBy({ top: -h, behavior: 'smooth' });
        else feed.scrollBy({ top: h, behavior: 'smooth' });
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
        carousel.scrollTo({ left: target, behavior: 'smooth' });
      }
    }
  }
});


document.addEventListener('keydown', (e) => {
  if (!feedView.classList.contains('active')) return;
  if (e.target.tagName.toLowerCase() === 'input') return;

  const h = window.innerHeight;
  const w = window.innerWidth;
  
  if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') {
    e.preventDefault();
    let target = feed.dataset.targetScroll !== undefined ? parseFloat(feed.dataset.targetScroll) : Math.round(feed.scrollTop / h) * h;
    target = Math.max(0, target - h);
    feed.dataset.targetScroll = target;
    feed.dataset.scrollDir = 'up';
    feed.style.scrollSnapType = 'none';
    feed.scrollTo({ top: target, behavior: 'smooth' });
  } 
  else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') {
    e.preventDefault();
    let target = feed.dataset.targetScroll !== undefined ? parseFloat(feed.dataset.targetScroll) : Math.round(feed.scrollTop / h) * h;
    target = Math.min(target + h, feed.scrollHeight - feed.clientHeight);
    feed.dataset.targetScroll = target;
    feed.dataset.scrollDir = 'down';
    feed.style.scrollSnapType = 'none';
    feed.scrollTo({ top: target, behavior: 'smooth' });
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
      if (target < 0) {
         target = carousel.scrollWidth - carousel.clientWidth;
      }
      carousel.dataset.targetScroll = target;
      carousel.dataset.scrollDir = 'left';
      carousel.style.scrollSnapType = 'none';
      carousel.scrollTo({ left: target, behavior: 'smooth' });
    } 
    else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
      let target = carousel.dataset.targetScroll !== undefined ? parseFloat(carousel.dataset.targetScroll) : Math.round(carousel.scrollLeft / w) * w;
      target = target + w;
      if (target > carousel.scrollWidth - carousel.clientWidth) {
         target = 0;
      }
      carousel.dataset.targetScroll = target;
      carousel.dataset.scrollDir = 'right';
      carousel.style.scrollSnapType = 'none';
      carousel.scrollTo({ left: target, behavior: 'smooth' });
    }
  }
});

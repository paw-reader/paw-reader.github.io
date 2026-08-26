import { PROXY_URL, state } from './state.js';
import { getServiceColor, startProgress, stopProgress } from './utils.js';
import { updateNavTabs, showView, navBack, feedView } from './nav.js';
import { resetFeed, fetchPosts } from './feed.js';

export const creatorsList = document.getElementById('creators-list');
export const creatorsLoading = document.getElementById('creators-loading');
export const searchInput = document.getElementById('creator-search');
export const sortSelect = document.getElementById('creator-sort');
export const sortDirBtn = document.getElementById('creator-sort-dir');
export const serviceFilterSelect = document.getElementById('creator-service-filter');
export const contentFilterSelect = document.getElementById('creator-content-filter');
export const genderFilterSelect = document.getElementById('creator-gender-filter');
export const paginationContainer = document.getElementById('creator-pagination');

let isSyncing = false;
export async function syncCumCreators() {
  if (isSyncing) return;
  isSyncing = true;
  let offset = 0;
  try {
    const initRes = await fetch(`${PROXY_URL}/cum/api/v1/creators`);
    const initData = await initRes.json();
    const total = initData.total || 14000;
    
    while (offset < total && state.currentSite === 'cum') {
      const fetchPromises = [];
      for (let i = 0; i < 5 && offset < total; i++) {
        fetchPromises.push(fetch(`${PROXY_URL}/cum/api/v1/creators?limit=50&o=${offset}`).then(r => r.json()));
        offset += 50;
      }
      const results = await Promise.allSettled(fetchPromises);
      let added = false;
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value.creators) {
          const existingIds = new Set(state.allCreators.map(c => c.id));
          res.value.creators.forEach(c => {
            if (c.service === 'discord') return;
            if (!existingIds.has(c.id)) {
              c.allPlatforms = [c];
              state.allCreators.push(c);
              added = true;
            }
          });
        }
      }
      if (added && state.currentSite === 'cum' && document.getElementById('creators-view') && document.getElementById('creators-view').classList.contains('active')) {
        filterAndSortCreators();
      }
    }
  } catch(e) {
    console.warn("Background sync failed", e);
  }
  isSyncing = false;
}

export async function loadCreators() {
  if (state.allCreators.length > 0 && state.loadedCreatorsSite === state.currentSite) return;
  state.loadedCreatorsSite = state.currentSite;
  state.allCreators = [];
  if (creatorsList) creatorsList.innerHTML = '';
  if (creatorsLoading) creatorsLoading.classList.add('active'); 
  startProgress();

  try {
    let rawCreators = [];
    if (state.currentSite === 'cum') {
      const moxxyServices = ['onlyfans', 'fansly', 'patreon'];
      for (const s of moxxyServices) {
        try {
          const res = await fetch(`${PROXY_URL}/${state.currentSite}/api/v1/creators?service=${s}&limit=50`);
          if (res.ok) {
            const data = await res.json();
            if (data.creators) rawCreators.push(...data.creators);
          }
        } catch (e) {
          console.warn(`Failed to fetch ${s} creators for cum.st`, e);
        }
      }
      syncCumCreators();
    } else {
      const res = await fetch(`${PROXY_URL}/${state.currentSite}/api/v1/creators`);
      if (!res.ok) throw new Error('Failed to fetch creators: ' + res.status + ' ' + res.statusText);
      rawCreators = await res.json();
    }
    const uniqueCreators = new Map();
    const nameToRelationId = new Map();

    // Pass 1: Build name -> relation_id mapping so order doesn't matter
    rawCreators.forEach(c => {
      if (c.service === 'discord') return;
      if (c.relation_id !== undefined && c.relation_id !== null) {
        nameToRelationId.set(c.name.toLowerCase().trim(), c.relation_id);
      }
    });

    // Pass 2: Group creators
    rawCreators.forEach(c => {
      if (c.service === 'discord') return;
      const lowerName = c.name.toLowerCase().trim();
      const heuristicName = lowerName.replace(/[\s_\-]/g, '');
      let key = '';

      if (c.relation_id !== undefined && c.relation_id !== null) {
        key = 'rel_' + c.relation_id;
      } else if (nameToRelationId.has(lowerName)) {
        key = 'rel_' + nameToRelationId.get(lowerName);
      } else {
        key = 'name_' + heuristicName;
      }

      if (!uniqueCreators.has(key)) {
        uniqueCreators.set(key, { platforms: [c] });
      } else {
        uniqueCreators.get(key).platforms.push(c);
      }
    });
    
    state.allCreators = Array.from(uniqueCreators.values()).map(uc => {
      uc.platforms.sort((a, b) => (b.favorited || 0) - (a.favorited || 0));
      return {
        ...uc.platforms[0],
        allPlatforms: uc.platforms
      };
    });
    
    if (serviceFilterSelect) {
      const services = new Set();
      state.allCreators.forEach(c => {
        services.add(c.service);
        if (c.allPlatforms) c.allPlatforms.forEach(p => services.add(p.service));
      });
      
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
    if (creatorsLoading) creatorsLoading.textContent = "Failed to load creators.";
  } finally {
    if (creatorsLoading) creatorsLoading.classList.remove('active'); 
    stopProgress();
  }
}

export function filterAndSortCreators() {
  const query = (searchInput ? searchInput.value.toLowerCase() : '');
  const sort = (sortSelect ? sortSelect.value : 'followers-desc');
  const contentFilter = (contentFilterSelect ? contentFilterSelect.value : 'content');
  const genderFilter = (genderFilterSelect ? genderFilterSelect.value : 'all');
  
  const checkedServices = serviceFilterSelect 
    ? Array.from(serviceFilterSelect.querySelectorAll('input:checked')).map(cb => cb.value)
    : [];
  
  state.filteredCreators = state.allCreators.filter(c => {
    const matchesQuery = c.name.toLowerCase().includes(query);
    
    const matchesService = checkedServices.length === 0 || 
      checkedServices.includes(c.service) || 
      (c.allPlatforms && c.allPlatforms.some(p => checkedServices.includes(p.service)));
    
    let hasContent = false;
    if (state.currentSite === 'cum') {
       hasContent = c.postCount > 0 || c.imageCount > 0 || c.videoCount > 0 || c.dmCount > 0;
    } else {
       hasContent = c.updated !== 0;
    }
    
    let matchesContent = true;
    if (contentFilter === 'content') matchesContent = hasContent;
    else if (contentFilter === 'empty') matchesContent = !hasContent;
    
    let matchesGender = true;
    if (state.currentSite === 'cum' && genderFilter && genderFilter !== 'all') {
      const g = (c.gender || '').toLowerCase().replace(/[- ]/g, '_');
      matchesGender = (g === genderFilter);
    }
    
    return matchesQuery && matchesService && matchesContent && matchesGender;
  });
  
  const isAsc = state.creatorSortDir === 'asc';
  const getTime = v => {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    const t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
  };
  
  state.filteredCreators.sort((a, b) => {
    let diff = 0;
    if (sort === 'popularity' || sort === 'followers-desc' || sort === 'followers-asc') {
      diff = (b.favorited || b.bookmarked || 0) - (a.favorited || a.bookmarked || 0);
    } else if (sort === 'indexed') {
      diff = getTime(b.indexed) - getTime(a.indexed);
    } else if (sort === 'updated') {
      diff = getTime(b.updated) - getTime(a.updated);
    } else if (sort === 'alphabetical' || sort === 'name-asc' || sort === 'name-desc') {
      diff = (a.name || '').localeCompare(b.name || '');
      return isAsc ? -diff : diff;
    } else if (sort === 'service') {
      diff = (a.service || '').localeCompare(b.service || '') || (a.name || '').localeCompare(b.name || '');
      return isAsc ? -diff : diff;
    } else if (sort === 'dms') {
      diff = (b.dmCount || 0) - (a.dmCount || 0);
    } else if (sort === 'posts') {
      diff = (b.postCount || 0) - (a.postCount || 0);
    }
    return isAsc ? -diff : diff;
  });
  
  renderCreatorsPage();
}

export function buildCreatorCard(creator, checkedServices = []) {
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
  if (state.currentSite === 'cum') {
    img.src = `https://img.cum.st/creator/${initialPlatform.service}/${initialPlatform.id}/avatar.webp`;
  } else {
    img.src = `${PROXY_URL}/${state.currentSite}/icons/${initialPlatform.service}/${initialPlatform.id}`;
  }
  img.loading = 'lazy';
  img.onerror = () => { img.style.display = 'none'; };
  
  const name = document.createElement('div');
  name.className = 'creator-name';
  name.textContent = initialPlatform.name;
  
  const getFavCount = (p) => (p.favorited !== undefined ? p.favorited : (p.bookmarked !== undefined ? p.bookmarked : (creator.favorited || creator.bookmarked || 0))) || 0;

  const service = document.createElement('div');
  service.className = 'creator-service';
  service.textContent = initialPlatform.service;

  const favorites = document.createElement('div');
  favorites.className = 'creator-favorites';
  favorites.textContent = `⭐ ${getFavCount(initialPlatform).toLocaleString()}`;
  
  card.appendChild(img);
  card.appendChild(name);
  card.appendChild(service);
  card.appendChild(favorites);
  
  if (creator.allPlatforms && creator.allPlatforms.length > 1) {
    const switchBtn = document.createElement('div');
    switchBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`;
    switchBtn.style.position = 'absolute';
    switchBtn.style.top = '10px';
    switchBtn.style.right = '10px';
    switchBtn.style.cursor = 'pointer';
    switchBtn.style.background = 'rgba(0,0,0,0.5)';
    switchBtn.style.borderRadius = '50%';
    switchBtn.style.width = '32px';
    switchBtn.style.height = '32px';
    switchBtn.style.display = 'flex';
    switchBtn.style.alignItems = 'center';
    switchBtn.style.justifyContent = 'center';
    switchBtn.title = 'Switch Service';
    
    switchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentPlatformIndex = (currentPlatformIndex + 1) % creator.allPlatforms.length;
      const newPlatform = creator.allPlatforms[currentPlatformIndex];
      if (state.currentSite === 'cum') {
        img.src = `https://img.cum.st/creator/${newPlatform.service}/${newPlatform.id}/avatar.webp`;
      } else {
        img.src = `${PROXY_URL}/${state.currentSite}/icons/${newPlatform.service}/${newPlatform.id}`;
      }
      img.style.display = 'block';
      name.textContent = newPlatform.name;
      service.textContent = newPlatform.service;
      favorites.textContent = `⭐ ${getFavCount(newPlatform).toLocaleString()}`;
      card.style.background = getServiceColor(newPlatform.service);
    });
    card.appendChild(switchBtn);
  }
  
  card.addEventListener('click', () => {
    resetFeed();
    const selectedPlatform = creator.allPlatforms ? creator.allPlatforms[currentPlatformIndex] : creator;
    state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${selectedPlatform.service}/user/${selectedPlatform.id}/posts`;
    state.currentFeedCreatorName = creator.name;
    updateNavTabs({ ...selectedPlatform, allPlatforms: creator.allPlatforms });
    if(navBack) navBack.classList.remove('hidden');
    showView(feedView, true);
    fetchPosts();
  });
  
  return card;
}

export function renderCreatorsPage() {
  if (!creatorsList || !paginationContainer) return;
  creatorsList.innerHTML = '';
  paginationContainer.innerHTML = '';
  
  const totalPages = Math.ceil(state.filteredCreators.length / state.creatorsPerPage);
  if (state.creatorPage > totalPages) state.creatorPage = totalPages;
  if (state.creatorPage < 1) state.creatorPage = 1;
  
  const start = (state.creatorPage - 1) * state.creatorsPerPage;
  const end = start + state.creatorsPerPage;
  const pageCreators = state.filteredCreators.slice(start, end);
  
  const checkedServices = serviceFilterSelect 
    ? Array.from(serviceFilterSelect.querySelectorAll('input:checked')).map(cb => cb.value)
    : [];
  
  pageCreators.forEach(creator => {
    creatorsList.appendChild(buildCreatorCard(creator, checkedServices));
  });
  
  renderPagination(totalPages);
}

export function renderPagination(totalPages) {
  if (totalPages <= 1 || !paginationContainer) return;
  
  const maxButtons = 7;
  let startPage = Math.max(1, state.creatorPage - Math.floor(maxButtons / 2));
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

export function createPageBtn(pageNum) {
  const btn = document.createElement('button');
  btn.className = 'page-btn';
  btn.textContent = pageNum;
  if (pageNum === state.creatorPage) {
    btn.classList.add('active');
  }
  btn.addEventListener('click', () => {
    state.creatorPage = pageNum;
    renderCreatorsPage();
    const cv = document.getElementById('creators-view');
    if (cv) cv.scrollTop = 0;
  });
  return btn;
}

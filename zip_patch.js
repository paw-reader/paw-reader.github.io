const zipNav = document.getElementById('zip-nav');
const zipHomeViewer = document.getElementById('zip-home-viewer');

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
    zipContent.dataset.targetScroll = 0;
    zipContent.dataset.scrollDir = 'left';
    zipContent.style.scrollSnapType = 'none';
    zipContent.scrollTo({ left: 0, behavior: 'smooth' });
  });
}

let zipNavTimeout;
function showZipNav() {
  if (zipNav) {
    zipNav.style.opacity = '1';
    zipNav.style.pointerEvents = 'auto';
    clearTimeout(zipNavTimeout);
    zipNavTimeout = setTimeout(() => {
      zipNav.style.opacity = '0';
      zipNav.style.pointerEvents = 'none';
    }, 2500);
  }
}

zipViewer.addEventListener('mousemove', showZipNav);
zipViewer.addEventListener('touchstart', showZipNav, {passive: true});
zipViewer.addEventListener('click', showZipNav);

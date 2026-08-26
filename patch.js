const zipViewer = document.getElementById('zip-viewer');
const zipTitle = document.getElementById('zip-title');
const zipContent = document.getElementById('zip-content');
const zipIndicator = document.getElementById('zip-indicator');
const closeZipViewer = document.getElementById('close-zip-viewer');
let currentZipObjectUrls = [];

if (closeZipViewer) {
  closeZipViewer.addEventListener('click', () => {
    zipViewer.classList.add('hidden');
    zipContent.innerHTML = '';
    currentZipObjectUrls.forEach(url => URL.revokeObjectURL(url));
    currentZipObjectUrls = [];
  });
}

zipContent.addEventListener('scroll', () => {
  if (currentZipObjectUrls.length <= 1) return;
  const index = Math.round(zipContent.scrollLeft / zipContent.clientWidth) + 1;
  zipIndicator.textContent = `${index} / ${currentZipObjectUrls.length}`;
});

async function openZipGallery(zipUrl, filename) {
  zipViewer.classList.remove('hidden');
  zipTitle.textContent = filename;
  zipIndicator.textContent = '';
  zipContent.innerHTML = '<div id="zip-progress-text" style="color:white; margin: auto; text-align: center;">Connecting...</div>';
  
  try {
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
    
    const progressText = document.getElementById('zip-progress-text');
    if (progressText) progressText.innerHTML = 'Extracting files...';
    
    const blob = new Blob(chunks);
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
      imgContainer.style.height = '100vh';
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
    zipContent.innerHTML = '<div style="color:#ff4444; margin: auto;">Failed to load ZIP archive.</div>';
  }
}

let zipNavTimeout;
function showZipNav() {} // we will just overwrite this

function updateZipNavVisibility(e) {
  let isTop = false;
  if (e.type === 'touchstart') {
     isTop = e.touches[0].clientY < 100;
  } else {
     isTop = e.clientY < 100;
  }
  
  if (isTop) {
     zipNav.style.opacity = '1';
     if(closeZipViewer) closeZipViewer.style.pointerEvents = 'auto';
     if(zipHomeViewer) zipHomeViewer.style.pointerEvents = 'auto';
     if(zipIndicator) zipIndicator.style.transform = 'translateY(45px)';
  } else {
     zipNav.style.opacity = '0';
     if(closeZipViewer) closeZipViewer.style.pointerEvents = 'none';
     if(zipHomeViewer) zipHomeViewer.style.pointerEvents = 'none';
     if(zipIndicator) zipIndicator.style.transform = 'translateY(0)';
  }
}

zipViewer.addEventListener('mousemove', updateZipNavVisibility);
zipViewer.addEventListener('touchstart', updateZipNavVisibility, {passive: true});

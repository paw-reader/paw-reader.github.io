const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

const navHomeOriginal = `navHome.addEventListener('click', () => {
  currentFeedCreatorName = null;
  updateNavTabs(null); // Hide creator tabs when going home
  showView(welcomeScreen, false);
  if(navBack) navBack.classList.add('hidden');
});`;

const navHomeNew = `navHome.addEventListener('click', () => {
  currentFeedCreatorName = null;
  updateNavTabs(null); // Hide creator tabs when going home
  showView(welcomeScreen, false);
  if(navBack) navBack.classList.add('hidden');
  
  // Clear creator view state
  creatorPage = 1;
  if (searchInput) searchInput.value = '';
  if (sortSelect) sortSelect.value = 'followers-desc';
});`;

code = code.replace(navHomeOriginal, navHomeNew);
fs.writeFileSync('app.js', code);

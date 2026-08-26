const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

const original = `  // Clear creator view state
  creatorPage = 1;
  if (searchInput) searchInput.value = '';
  if (sortSelect) sortSelect.value = 'followers-desc';`;

const replacement = `  // Clear creator view state
  creatorPage = 1;
  if (searchInput) searchInput.value = '';
  if (sortSelect) sortSelect.value = 'followers-desc';
  if (contentFilterSelect) contentFilterSelect.value = 'all';
  if (serviceFilterSelect) {
    const checkboxes = serviceFilterSelect.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
  }`;

code = code.replace(original, replacement);
fs.writeFileSync('app.js', code);

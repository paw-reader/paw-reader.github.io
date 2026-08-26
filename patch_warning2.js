const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

code = code.replace(
  "const siteName = currentSite.charAt(0).toUpperCase() + currentSite.slice(1);",
  "const displayNames = { pawchive: 'Pawchive', kemono: 'Kemono', cum: 'Coomer' };\n  const siteName = displayNames[currentSite] || currentSite;"
);

code = code.replace(
  "img.onerror = () => { showMediaUnavailableWarning(progressOverlay, type); };",
  "img.onerror = () => { img.style.display = 'none'; showMediaUnavailableWarning(progressOverlay, type); };"
);

fs.writeFileSync('app.js', code);

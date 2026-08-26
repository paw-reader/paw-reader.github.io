const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

code = code.replace(
  "zipContent.innerHTML = '<div style=\"color:#ff4444; margin: auto;\">Failed to load ZIP archive.</div>';",
  "zipContent.innerHTML = '';\n    showMediaUnavailableWarning(zipContent, 'zip');"
);
fs.writeFileSync('app.js', code);

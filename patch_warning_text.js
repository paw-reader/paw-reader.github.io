const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

code = code.replace(
  "This file has not yet been imported to ${siteName}, or it has been removed.",
  "This file has not yet been imported to ${siteName}, or the server is busy/unavailable."
);
fs.writeFileSync('app.js', code);

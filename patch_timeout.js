const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

code = code.replace(
  "const timeoutId = setTimeout(() => controller.abort(), 15000);",
  "const timeoutId = setTimeout(() => controller.abort(), 60000);"
);
fs.writeFileSync('app.js', code);

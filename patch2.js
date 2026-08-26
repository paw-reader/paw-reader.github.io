const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

code = code.replace(
  "fetch(url)\n      .then(async res => {\n        const size =",
  "fetch(url)\n      .then(async res => {\n        if (!res.ok) throw new Error('Failed');\n        const size ="
);
fs.writeFileSync('app.js', code);

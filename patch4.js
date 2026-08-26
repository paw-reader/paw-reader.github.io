const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

code = code.replace(
  "video.addEventListener('error', () => {\n      progressOverlay.innerHTML = '<span style=\"color:#ff4444\">Video Error</span>';\n    });",
  "video.addEventListener('error', () => {\n      showMediaUnavailableWarning(progressOverlay, type);\n    });"
);
fs.writeFileSync('app.js', code);

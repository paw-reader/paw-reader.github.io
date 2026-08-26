const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(
  /<button id="nav-back" class="hidden">⬅️<\/button>\s*<button id="nav-info" class="hidden">ℹ️<\/button>/,
  `<div id="nav-left" style="position: fixed; top: 20px; left: 20px; display: flex; gap: 9px; z-index: 1000; pointer-events: auto;">
      <button id="nav-back" class="hidden">⬅️</button>
      <button id="nav-info" class="hidden">ℹ️</button>
    </div>`
);
fs.writeFileSync('index.html', html);

let css = fs.readFileSync('style.css', 'utf8');
css = css.replace(
  /#nav-back \{ top: 20px; left: 20px; \}\n#nav-info \{ top: 20px; left: 65px; \}/,
  `#nav-back, #nav-info { position: static; }`
);
fs.writeFileSync('style.css', css);

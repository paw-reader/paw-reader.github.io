const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

const warningFunc = `
function showMediaUnavailableWarning(container, type = 'media') {
  const siteName = currentSite.charAt(0).toUpperCase() + currentSite.slice(1);
  container.innerHTML = \`
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; gap: 10px; padding: 20px; text-align: center; background: rgba(0,0,0,0.5); border-radius: 12px; box-sizing: border-box;">
      <span style="color: #ffb86c; font-size: 2rem;">⚠️</span>
      <span style="color: #ffb86c; font-size: 1.2rem; font-weight: bold;">\${type === 'zip' ? 'Archive' : 'Media'} Unavailable</span>
      <span style="color: #ccc; font-size: 0.95rem; font-weight: normal; max-width: 250px; line-height: 1.4;">
        This file has not yet been imported to \${siteName}, or it has been removed.
      </span>
    </div>
  \`;
}
`;

// Insert after categoriseFile
code = code.replace(/function categorizeFile\(filename\) \{/, warningFunc + '\nfunction categorizeFile(filename) {');

fs.writeFileSync('app.js', code);

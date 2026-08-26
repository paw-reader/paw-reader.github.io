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

code = code.replace(/function categorizeFile\(filename\) \{/, warningFunc + '\nfunction categorizeFile(filename) {');

const oldShowWarning = `      const showWarning = () => {
        const siteName = currentSite.charAt(0).toUpperCase() + currentSite.slice(1);
        progressOverlay.innerHTML = \`
          <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 20px; text-align: center; background: rgba(0,0,0,0.5); border-radius: 12px;">
            <span style="color: #ffb86c; font-size: 2rem;">⚠️</span>
            <span style="color: #ffb86c; font-size: 1.2rem; font-weight: bold;">Media Unavailable</span>
            <span style="color: #ccc; font-size: 0.95rem; font-weight: normal; max-width: 250px; line-height: 1.4;">
              This file has not yet been imported to \${siteName}, or it has been removed.
            </span>
          </div>
        \`;
      };`;
code = code.replace(oldShowWarning, "      const showWarning = () => showMediaUnavailableWarning(progressOverlay, type);");

code = code.replace(
  "img.onerror = () => { progressOverlay.innerHTML = '<span style=\"color:#ff4444\">Image Error</span>'; };",
  "img.onerror = () => { showMediaUnavailableWarning(progressOverlay, type); };"
);

// Zip fetch catch
code = code.replace(
  "zipBtn.innerHTML = `📦 Open ZIP Gallery<br><small style=\"opacity:0.8; font-weight:normal;\">${filename}<br>Ready</small>`;",
  "item.innerHTML = '';\n        item.appendChild(progressOverlay);\n        progressOverlay.style.display = 'flex';\n        showMediaUnavailableWarning(progressOverlay, type);"
);
fs.writeFileSync('app.js', code);

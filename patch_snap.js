const fs = require('fs');

let css = fs.readFileSync('style.css', 'utf8');
css = css.replace(
  'body.no-animations * {\\n  transition: none !important;\\n  animation: none !important;\\n  scroll-behavior: auto !important;\\n}',
  'body.no-animations * {\\n  transition: none !important;\\n  animation: none !important;\\n  scroll-behavior: auto !important;\\n}\\nbody.no-animations #feed, body.no-animations .media-carousel, body.no-animations #zip-content {\\n  scroll-snap-type: none !important;\\n}'
);
fs.writeFileSync('style.css', css);


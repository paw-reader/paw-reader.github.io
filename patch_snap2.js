const fs = require('fs');
let css = fs.readFileSync('style.css', 'utf8');

css = css.replace(
  /body\.no-animations \* \{[^}]+\}/,
  `body.no-animations * {
  transition: none !important;
  animation: none !important;
  scroll-behavior: auto !important;
}
body.no-animations #feed, body.no-animations .media-carousel, body.no-animations #zip-content {
  scroll-snap-type: none !important;
}`
);
fs.writeFileSync('style.css', css);

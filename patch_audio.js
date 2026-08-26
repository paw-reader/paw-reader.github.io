const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

code = code.replace(
  "const supportedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'mp4', 'webm', 'mov', 'zip'];",
  "const supportedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'mp4', 'webm', 'mov', 'zip', 'mp3', 'ogg', 'wav', 'm4a'];"
);

code = code.replace(
  "const isVideo = ['mp4', 'webm', 'mov'].includes(ext);",
  "const isVideo = ['mp4', 'webm', 'mov'].includes(ext);\n      const isAudio = ['mp3', 'ogg', 'wav', 'm4a'].includes(ext);"
);

code = code.replace(
  "item.dataset.type = ext === 'zip' ? 'zip' : isVideo ? 'video' : 'image';",
  "item.dataset.type = ext === 'zip' ? 'zip' : isVideo ? 'video' : isAudio ? 'audio' : 'image';"
);

code = code.replace(
  "if (type === 'video') {",
  "if (type === 'video' || type === 'audio') {"
);

code = code.replace(
  "const video = document.createElement('video');",
  "const video = document.createElement(type === 'video' ? 'video' : 'audio');"
);

code = code.replace(
  "video.loop = true;",
  "if (type === 'video') video.loop = true;"
);

code = code.replace(
  "video.muted = true;",
  "if (type === 'video') video.muted = true;"
);

code = code.replace(
  "if (type === 'video') {\\n    const video = document.createElement('video');",
  "if (type === 'video' || type === 'audio') {\\n    const video = document.createElement(type === 'video' ? 'video' : 'audio');"
);

code = code.replace(
  "if (type === 'video') {\n    const video = document.createElement('video');",
  "if (type === 'video' || type === 'audio') {\n    const video = document.createElement(type === 'video' ? 'video' : 'audio');"
);

fs.writeFileSync('app.js', code);

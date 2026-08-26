const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

const replacement = `
          if (!post.file && post.attachments && post.attachments.length > 0) {
             const first = post.attachments[0];
             if (first.storageKey && first.variants && first.variants.length > 0) {
                 post.file = { path: \`/media/\${first.storageKey}/\${first.variants[0].name}\` };
             } else {
                 let ext = 'jpg';
                 if (first.mimeType) ext = first.mimeType.split('/').pop().toLowerCase().replace('jpeg', 'jpg');
                 else if (first.kind === 'video') ext = 'mp4';
                 post.file = { path: \`/unimported.\${ext}\` };
             }
          }
          
          if (post.attachments && post.attachments.length > 0) {
             post.attachments = post.attachments.map(att => {
                 if (att.storageKey && att.variants && att.variants.length > 0) {
                     return { path: \`/media/\${att.storageKey}/\${att.variants[0].name}\` };
                 } else {
                     let ext = 'jpg';
                     if (att.mimeType) ext = att.mimeType.split('/').pop().toLowerCase().replace('jpeg', 'jpg');
                     else if (att.kind === 'video') ext = 'mp4';
                     return { path: \`/unimported.\${ext}\` };
                 }
             });
          }
`;

code = code.replace(/if \(!post\.file && post\.attachments && post\.attachments\.length > 0\) \{[\s\S]*?\}\s*if \(post\.attachments && post\.attachments\.length > 0\) \{[\s\S]*?\}\s*\}/, replacement.trim() + '\n        }');

fs.writeFileSync('app.js', code);

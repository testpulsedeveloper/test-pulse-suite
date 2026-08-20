const fs = require('fs');
let content = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const oldCode = `background: 'var(--ds-background-neutral)'`;
const newCode = `background: 'var(--bg-surface-hover)'`;

if (content.includes(oldCode)) {
  content = content.replace(new RegExp(oldCode, 'g'), newCode);
  fs.writeFileSync('static/hello-world/src/App.js', content);
  console.log('Patched evidence badge background');
} else {
  console.log('Could not find old code');
}

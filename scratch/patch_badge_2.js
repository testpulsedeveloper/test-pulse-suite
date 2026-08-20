const fs = require('fs');
let content = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const oldCode = "background: 'var(--ds-background-neutral)'";
const newCode = "background: 'var(--bg-surface-hover)'";

if (content.includes(oldCode)) {
  content = content.replaceAll(oldCode, newCode);
  fs.writeFileSync('static/hello-world/src/App.js', content);
  console.log('Patched evidence badge background PROPERLY');
} else {
  console.log('Could not find old code');
}

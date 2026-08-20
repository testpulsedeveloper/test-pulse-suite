const fs = require('fs');
let content = fs.readFileSync('static/hello-world/src/index.css', 'utf8');

const oldCode = `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));`;
const newCode = `grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync('static/hello-world/src/index.css', content);
  console.log('Patched kpi CSS');
} else {
  console.log('Could not find old code');
}

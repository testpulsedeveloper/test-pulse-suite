const fs = require('fs');
const path = 'static/hello-world/src/index.css';
let content = fs.readFileSync(path, 'utf8');

const target = `@media (max-width: 768px) {`;
const replacement = `@media (max-width: 768px) {
  body, .app-container {
    height: auto !important;
    min-height: 100vh;
    overflow: visible !important;
    position: static !important;
  }
  .tab-layout, .main-content {
    height: auto !important;
    overflow: visible !important;
    flex: none !important;
  }`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched mobile scroll behavior!");
} else {
    console.error("Could not find target");
}

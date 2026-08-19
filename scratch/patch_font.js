const fs = require('fs');
let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// Patch font-family inherit on textarea and input inside Iterations
appContent = appContent.replace(
  /border: '1px solid var\(--ds-border\)', background: 'var\(--bg-main\)', color: 'var\(--text-primary\)'/g,
  "border: '1px solid var(--ds-border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontFamily: 'inherit'"
);

fs.writeFileSync('static/hello-world/src/App.js', appContent);
console.log("Patched fonts.");

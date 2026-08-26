const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Fix string expand to array in getExecutionData or wherever it is
content = content.replace(/expand:\s*'renderedFields'/g, "expand: ['renderedFields']");

fs.writeFileSync(path, content);
console.log("Patched expand string to array globally");

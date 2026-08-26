const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/reportSelectedCycle \?/g, "reportSelectedCycles.length === 1 ?");
fs.writeFileSync(path, content);
console.log("Patched undefined variable");

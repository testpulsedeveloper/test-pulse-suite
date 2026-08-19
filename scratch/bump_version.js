const fs = require('fs');

// 1. App.js
let app = fs.readFileSync('static/hello-world/src/App.js', 'utf8');
app = app.replace(/v0\.1\.77-next\.8/g, 'v0.1.77-next.9');
fs.writeFileSync('static/hello-world/src/App.js', app);

// 2. static/hello-world/package.json
let pjson = fs.readFileSync('static/hello-world/package.json', 'utf8');
pjson = pjson.replace(/"version": "0\.1\.77-next\.8"/g, '"version": "0.1.77-next.9"');
fs.writeFileSync('static/hello-world/package.json', pjson);

// 3. package.json
let rootPjson = fs.readFileSync('package.json', 'utf8');
rootPjson = rootPjson.replace(/"version": "1\.1\.19"/g, '"version": "1.1.20"');
fs.writeFileSync('package.json', rootPjson);

console.log("Bumped versions.");

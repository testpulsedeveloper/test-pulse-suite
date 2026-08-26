const fs = require('fs');
let appJs = fs.readFileSync('static/hello-world/src/App.js', 'utf8');
appJs = appJs.replace(/>BETA<\/span>/, '>v1.2.0</span>');
fs.writeFileSync('static/hello-world/src/App.js', appJs);
console.log("Updated version badge");

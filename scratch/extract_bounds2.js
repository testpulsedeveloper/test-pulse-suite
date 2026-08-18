const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');
console.log("REPORTS:");
console.log(code.substring(124502, 124528 + 1));
console.log("CONFIG:");
console.log(code.substring(150921, 150946 + 1));

const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /if \(expand\) body\.expand = expand;/g,
  `if (expand) body.expand = Array.isArray(expand) ? expand : [expand];`
);

content = content.replace(
  /if \(properties\) body\.properties = properties;/g,
  `if (properties) body.properties = Array.isArray(properties) ? properties : [properties];`
);

fs.writeFileSync(path, content);
console.log("Patched fetchAllIssues arrays");

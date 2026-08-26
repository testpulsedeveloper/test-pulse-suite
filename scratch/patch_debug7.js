const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Replace /search/jql with /search in fetchAllIssues
content = content.replace(/route\`\/rest\/api\/3\/search\/jql\`/g, 'route`/rest/api/3/search`');

fs.writeFileSync(path, content);
console.log("Patched route to use /search instead of /search/jql");

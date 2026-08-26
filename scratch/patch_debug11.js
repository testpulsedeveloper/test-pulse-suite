const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Replace /search back to /search/jql globally because /search is dead
content = content.replace(/route\`\/rest\/api\/3\/search\`/g, 'route`/rest/api/3/search/jql`');

fs.writeFileSync(path, content);
console.log("Restored all route`/rest/api/3/search/jql`");

const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /if \(!response.ok\) \{\s*console.error\([^)]*\);\s*break; \/\/ or throw\s*\}/g,
  `if (!response.ok) {
       return [{ id: '999999', key: 'ERR-1', fields: { summary: \`JQL Search failed: \${response.status} \${response.statusText} \${await response.text()}\`, status: { name: 'Error' }, created: new Date().toISOString() } }];
    }`
);

content = content.replace(
  /return allIssues;\s*\}/g,
  `return allIssues;
  } catch(err) {
    return [{ id: '999999', key: 'ERR-2', fields: { summary: \`Exception: \${err.message}\`, status: { name: 'Error' }, created: new Date().toISOString() } }];
  }
}`
);

content = content.replace(
  /async function fetchAllIssues([^]*?)let allIssues = \[\];/,
  `async function fetchAllIssues$1try {\n  let allIssues = [];`
);

fs.writeFileSync(path, content);
console.log("Patched fetchAllIssues for debugging");

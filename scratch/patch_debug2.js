const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /return \[\{ id: '999999', key: 'ERR-1', fields: \{ summary: \`JQL Search failed: \$\{response\.status\} \$\{response\.statusText\} \$\{await response\.text\(\)\}\`, status: \{ name: 'Error' \}, created: new Date\(\)\.toISOString\(\) \} \}\];/g,
  `return [{ id: '999999', key: 'ERR-1', fields: { summary: \`Payload: \${JSON.stringify(body)} | JQL Search failed: \${response.status} \${response.statusText} \${await response.text()}\`, status: { name: 'Error' }, created: new Date().toISOString() } }];`
);

fs.writeFileSync(path, content);
console.log("Patched fetchAllIssues for debugging payload");

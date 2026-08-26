const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// Patch All Tests
content = content.replace(
  /All Tests\s*<\/li>/g,
  `All Tests <span style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '0.25rem'}}>({testCases.length})</span>\n          </li>`
);

// Patch specific folder
content = content.replace(
  /<span style=\{\{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'\}\} title=\{folder\.name\}>\{folder\.name\}<\/span>/g,
  `<span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={folder.name}>{folder.name}</span>\n                        <span style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>({testCases.filter(t => t.folderId === folder.id).length})</span>`
);

fs.writeFileSync(path, content);
console.log("Patched App.js folders");

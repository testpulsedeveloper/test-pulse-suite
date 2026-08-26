const fs = require('fs');

const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /const updated = \{ \.\.\.t \};\s*updatedTests\.push\(updated\);\s*return updated;/g,
  `const updated = { 
               ...t, 
               description: descMap[t.id], 
               expectedResult: renderedFieldsMap[t.id]?.environment || rawFieldsMap[t.id]?.environment || ''
           };
           updatedTests.push(updated);
           return updated;`
);

fs.writeFileSync(path, content);
console.log("Patched backfillDescriptions in index.js");

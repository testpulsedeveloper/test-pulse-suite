const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Remove the bad insertion
content = content.replace(
  "  // Overwrite missingIds check to use testIds instead of value\n  const missingIds = testIds.filter(id => !mergedProps[`exec_${id}`]);",
  ""
);

// Fix the actual missingIds declaration
content = content.replace(
  "const missingIds = value.filter(id => !mergedProps[`exec_${id}`]);",
  "const missingIds = testIds.filter(id => !mergedProps[`exec_${id}`]);"
);

fs.writeFileSync(path, content);
console.log("Fixed syntax error");

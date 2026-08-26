const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// Guard in safeSetCycleTests
content = content.replace(
  "          if (!newExecutionData) return prev;",
  "          if (!newExecutionData || !Array.isArray(newExecutionData)) { console.error('safeSetCycleTests got non-array:', newExecutionData); return prev; }"
);

// Guard in renderReportsTab 1
content = content.replace(
  "    filteredCycles.forEach(cycle => {\n      if(cycle.execution) {",
  "    filteredCycles.forEach(cycle => {\n      if(cycle.execution && Array.isArray(cycle.execution)) {"
);
content = content.replace(
  "    filteredCycles.forEach(cycle => {\n      if (cycle.execution) {",
  "    filteredCycles.forEach(cycle => {\n      if (cycle.execution && Array.isArray(cycle.execution)) {"
);
// Guard in renderReportsTab 3
content = content.replace(
  "                         if (cycle.execution) {",
  "                         if (cycle.execution && Array.isArray(cycle.execution)) {"
);

fs.writeFileSync(path, content);
console.log("Patched App.js to guard against non-array forEach crashes");

const indexPath = 'src/index.js';
let indexContent = fs.readFileSync(indexPath, 'utf8');
indexContent = indexContent.replace(
  "     cycles.forEach(c => {\n       c.execution?.forEach(ex => {",
  "     cycles.forEach(c => {\n       if (Array.isArray(c.execution)) c.execution.forEach(ex => {"
);
indexContent = indexContent.replace(
  "  if (testIds.length === 0) return [];",
  "  if (!Array.isArray(testIds) || testIds.length === 0) return [];"
);
fs.writeFileSync(indexPath, indexContent);
console.log("Patched index.js");

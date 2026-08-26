const fs = require('fs');

const index_path = 'src/index.js';
let index_content = fs.readFileSync(index_path, 'utf8');

index_content = index_content.replace(
  /properties: \['\*all'\]/g,
  `properties: ['testops-plan-link', 'execution']`
);

fs.writeFileSync(index_path, index_content);
console.log("Patched src/index.js");

const app_path = 'static/hello-world/src/App.js';
let app_content = fs.readFileSync(app_path, 'utf8');

app_content = app_content.replace(
  /<h1>Design: Folders &amp; Test Cases<\/h1>/g,
  `<h1>Design: Folders &amp; Test Cases <span style={{fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal'}}>({testCases.length} casos)</span></h1>`
);

app_content = app_content.replace(
  /<h1>Planning: \{selectedCycle\.summary\}<\/h1>/g,
  `<h1>Planning: {selectedCycle.summary} <span style={{fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal'}}>({cycleTests.length} casos en ciclo)</span></h1>`
);

app_content = app_content.replace(
  /<h3>Tests in this Cycle<\/h3>/g,
  `<h3>Tests in this Cycle ({cycleTests.length})</h3>`
);

app_content = app_content.replace(
  /<h3>Available Test Cases<\/h3>/g,
  `<h3>Available Test Cases ({testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && (planningPriority === '' || tc.rawFields?.priority?.name === planningPriority) && !cycleTests.some(ct => ct.id === tc.id)).length})</h3>`
);

app_content = app_content.replace(
  /<h1>Execution: \{selectedCycle\.summary\}<\/h1>/g,
  `<h1>Execution: {selectedCycle.summary} <span style={{fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal'}}>({cycleTests.length} casos)</span></h1>`
);

// We should also add it to the sidebar cycles list to fulfill "planning (tanto los que tienen ciclo como los que no)"
// But wait, do we know the count of tests in each cycle in the sidebar?
// The cycle list in Planning is `filteredTestCycles.map(cycle => ...)`
// But `cycle` doesn't have the length of tests natively in frontend unless we check its `execution` property.
// In getCycles/getExecutionReport, `cycle.execution` might not be populated in `filteredTestCycles` which comes from `getTestCycles`.
// Actually, `getTestCycles` does not fetch `execution`. 
// So let's stick to the headers.

fs.writeFileSync(app_path, app_content);
console.log("Patched App.js with counters");

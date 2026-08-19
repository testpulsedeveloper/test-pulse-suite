const fs = require('fs');
let indexContent = fs.readFileSync('src/index.js', 'utf8');

indexContent = indexContent.replace(
  /history\.push\(\{/g,
  "console.log('Found history for cycle:', cycle.key, testExec); history.push({"
);

indexContent = indexContent.replace(
  /const testExec = value\.find\(t => String\(t\.id\) === String\(testId\)\);/,
  "console.log('Cycle:', cycle.key, 'Value length:', value.length, 'Looking for:', testId); const testExec = value.find(t => String(t.id) === String(testId));"
);

indexContent = indexContent.replace(
  /const data = await response\.json\(\);/,
  "const data = await response.json(); console.log('Cycles found:', data.issues ? data.issues.length : 0);"
);

fs.writeFileSync('src/index.js', indexContent);
console.log("Added debug logs to history");

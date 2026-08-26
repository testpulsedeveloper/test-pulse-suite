const fs = require('fs');

const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Patch addBulkTestsToCycle
content = content.replace(
  /    \/\/ Y luego actualizamos el array principal[\s\S]*?body: JSON\.stringify\(testIds\)\s*}\);\s*}\s*if \(!exRes\.ok\) {[\s\S]*?errText\}\`\);\s*}/g,
  `    await updateLightweightIndex(cycleId, (lw) => {
        newTests.forEach(nt => {
            if (!lw.find(t => String(t.id) === String(nt.id))) {
                lw.push({ id: String(nt.id), status: nt.status, linkedBugs: nt.linkedBugs || [] });
            }
        });
        return lw;
    });`
);

// Patch addTestToCycle
content = content.replace(
  /  \/\/ Get current full data to reconstruct lightweight index[\s\S]*?body: JSON\.stringify\(testIds\)\s*}\);\s*}\s*if \(!exRes\.ok\) {[\s\S]*?errText\}\`\);\s*}/g,
  `  await updateLightweightIndex(cycleId, (lw) => {
      if (!lw.find(t => String(t.id) === String(newTest.id))) {
          lw.push({ id: String(newTest.id), status: newTest.status, linkedBugs: newTest.linkedBugs || [] });
      }
      return lw;
  });`
);

// Patch removeTestFromCycle
content = content.replace(
  /  testIds = testIds\.filter\(id => String\(id\) !== String\(testId\)\);\s*\/\/ Overwrite the execution array[\s\S]*?body: JSON\.stringify\(testIds\)\s*}\);/g,
  `  await updateLightweightIndex(cycleId, (lw) => lw.filter(t => String(t.id) !== String(testId)));`
);

// Patch updateTestStatus
content = content.replace(
  /  const executionData = await getExecutionData\(cycleId\);\s*let updatedTest = null;[\s\S]*?return updatedTest;\s*}\s*return t;\s*}\);\s*if \(updatedTest\) {/g,
  `  let resTest = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${testId}\`);
  let t = null;
  if (resTest.ok) {
      t = (await resTest.json()).value;
  }
  
  let updatedTest = null;
  if (t) {
      if (!takeover && t.executedBy && userData && t.executedBy.accountId !== userData.accountId && !isAdmin) {
          throw new Error('Solo el usuario que ejecutó la prueba original o un administrador puede modificarla.');
      }
      updatedTest = { 
          ...t, 
          status: status !== undefined ? status : t.status, 
          comment: comment !== undefined ? comment : t.comment,
          evidence: evidence !== undefined ? evidence : t.evidence,
          evidences: evidences !== undefined ? evidences : t.evidences,
          linkedBugs: linkedBugs !== undefined ? linkedBugs : t.linkedBugs,
          steps: steps !== undefined ? steps : t.steps,
          iterations: iterations !== undefined ? iterations : t.iterations,
          executedBy: executorInfo !== undefined ? executorInfo : t.executedBy
      };
  }
  
  if (updatedTest) {`
);

content = content.replace(
  /    \/\/ Update the lightweight index\s*const lightWeight = updatedData\.map[\s\S]*?body: JSON\.stringify\(lightWeight\)\s*}\);/g,
  `    await updateLightweightIndex(cycleId, (lw) => {
        const item = lw.find(l => String(l.id) === String(testId));
        if (item) {
            item.status = updatedTest.status;
            item.linkedBugs = updatedTest.linkedBugs || [];
        } else {
            lw.push({ id: String(testId), status: updatedTest.status, linkedBugs: updatedTest.linkedBugs || [] });
        }
        return lw;
    });`
);


fs.writeFileSync(path, content);
console.log("Patched all writers in index.js to use updateLightweightIndex");

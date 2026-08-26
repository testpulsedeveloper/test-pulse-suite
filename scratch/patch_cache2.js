const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// The goal is to replace any GET request to properties/exec_* to include cache-busting
// We must NOT touch PUT requests!

// In getExecutionData: missingIds map
const getTarget = "let res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${id}`);";
const getReplacement = "let res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${id}?t=${Date.now()}`);";
if (content.includes(getTarget)) {
    content = content.replace(getTarget, getReplacement);
    console.log("Patched getExecutionData exec_ fetch");
}

// In addBulkTestsToCycle: checkRes
const checkBulkTarget = "let checkRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}`);";
const checkBulkReplacement = "let checkRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}?t=${Date.now()}`);";
// Since there's multiple instances, we replace all
content = content.split(checkBulkTarget).join(checkBulkReplacement);
console.log("Patched checkRes in bulk");

// In addTestToCycle: checkRes
const checkSingleTarget = "let checkRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${newTest.id}`);";
const checkSingleReplacement = "let checkRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${newTest.id}?t=${Date.now()}`);";
content = content.split(checkSingleTarget).join(checkSingleReplacement);
console.log("Patched checkRes in single");

fs.writeFileSync(path, content);

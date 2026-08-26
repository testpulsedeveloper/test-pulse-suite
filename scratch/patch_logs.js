const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `    // Parse execution data locally instead of making N network requests
    const executionIds = properties['execution'] || [];
    let execution = [];
    if (Array.isArray(executionIds)) {
       if (executionIds.length > 0 && typeof executionIds[0] === 'object') {
           execution = executionIds;
       } else {
           execution = executionIds.map(id => properties[\`exec_\${id}\`]).filter(Boolean);
       }
    }`;

const replace = `    // Parse execution data locally instead of making N network requests
    console.log("ISSUE PROPERTIES KEYS:", Object.keys(properties));
    const executionIds = properties['execution'] || [];
    console.log("EXECUTION IDS:", executionIds);
    let execution = [];
    if (Array.isArray(executionIds)) {
       if (executionIds.length > 0 && typeof executionIds[0] === 'object') {
           execution = executionIds;
       } else {
           execution = executionIds.map(id => properties[\`exec_\${id}\`]).filter(Boolean);
           console.log("MAPPED EXECUTION LENGTH:", execution.length);
       }
    }`;

content = content.replace(target, replace);
fs.writeFileSync(path, content);
console.log("Added logging");

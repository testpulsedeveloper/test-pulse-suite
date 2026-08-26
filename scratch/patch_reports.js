const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `    // Parse execution data locally instead of making N network requests
    const executionIds = properties['execution'] || [];
    let execution = [];
    if (Array.isArray(executionIds)) {
       execution = executionIds.map(id => properties[\`exec_\${id}\`]).filter(Boolean);
    } else {
       // Fallback para datos muy antiguos que puedan no estar migrados
       execution = Array.isArray(properties['execution']) ? properties['execution'] : [];
    }`;
    
const replace = `    // Parse execution data locally instead of making N network requests
    const executionIds = properties['execution'] || [];
    let execution = [];
    if (Array.isArray(executionIds)) {
       if (executionIds.length > 0 && typeof executionIds[0] === 'object') {
           execution = executionIds;
       } else {
           execution = executionIds.map(id => properties[\`exec_\${id}\`]).filter(Boolean);
       }
    }`;

content = content.replace(target, replace);
fs.writeFileSync(path, content);
console.log("Patched getExecutionReport");

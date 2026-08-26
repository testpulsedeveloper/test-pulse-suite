const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  if (changed) {
    for (const nt of newTests) {
      await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${nt.id}\`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(nt)
      });
    }`;

const replacement = `  if (changed) {
    const CHUNK_SIZE = 10;
    for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
        const chunk = newTests.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(nt => 
           api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${nt.id}\`, {
             method: 'PUT',
             headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
             body: JSON.stringify(nt)
           })
        ));
    }`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched addMultipleTestsToCycle to be faster");
} else {
    console.error("Could not find target in addMultipleTestsToCycle for speed fix");
}

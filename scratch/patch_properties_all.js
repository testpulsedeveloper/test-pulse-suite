const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Also removing the debug logs if they exist
const fetchTarget = `  const bulkRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}?properties=exec_*\`);`;
const fetchReplacement = `  const bulkRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}?properties=*all\`);`;

if (content.includes(fetchTarget)) {
    content = content.replace(fetchTarget, fetchReplacement);
    fs.writeFileSync(path, content);
    console.log("Patched to use *all !");
} else {
    console.error("Could not find fetchTarget in index.js");
}

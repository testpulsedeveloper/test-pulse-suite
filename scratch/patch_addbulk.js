const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target1 = `    // Solo hacemos PUT para los NUEVOS tests
    await Promise.all(newTests.map(t => 
       api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
         method: 'PUT',
         headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
         body: JSON.stringify(t)
       })
    ));`;

const replacement1 = `    // Escribir los nuevos uno por uno (o de forma segura) para no tronar por 429
    for (const t of newTests) {
       await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
         method: 'PUT',
         headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
         body: JSON.stringify(t)
       });
    }`;

if (content.includes(target1)) {
    content = content.replace(target1, replacement1);
    fs.writeFileSync(path, content);
    console.log("Patched addBulkTestsToCycle");
} else {
    console.error("Could not find target1");
}

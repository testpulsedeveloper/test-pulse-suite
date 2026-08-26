const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  if (newTests.length > 0) {
    // Escribir los nuevos uno por uno (o de forma segura) para no tronar por 429
    for (const t of newTests) {
       await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
         method: 'PUT',
         headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
         body: JSON.stringify(t)
       });
    }`;

const replacement = `  if (newTests.length > 0) {
    // Procesar los nuevos concurrentemente en bloques de 10 para mayor velocidad sin timeout
    const CHUNK_SIZE = 10;
    for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
        const chunk = newTests.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(t => 
           api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
             method: 'PUT',
             headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
             body: JSON.stringify(t)
           })
        ));
    }`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched addBulkTestsToCycle to be faster");
} else {
    console.error("Could not find target in addBulkTestsToCycle for speed fix");
}

const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `          const chunkPromises = chunk.map(async (id) => {
              const res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${id}\`);
              if (res.ok) {
                  const data = await res.json();
                  return { key: \`exec_\${id}\`, value: data.value };
              }
              return null;
          });`;

const replacement = `          const chunkPromises = chunk.map(async (id) => {
              let res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${id}\`);
              if (res.status === 429) {
                  console.log(\`Hit 429 on exec_\${id}, retrying once after 2 seconds...\`);
                  await new Promise(r => setTimeout(r, 2000));
                  res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${id}\`);
              }
              if (res.ok) {
                  const data = await res.json();
                  return { key: \`exec_\${id}\`, value: data.value };
              }
              console.error(\`Failed to fetch exec_\${id} with status \${res.status}\`);
              return null;
          });`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched getExecutionData with 429 retry");
} else {
    console.error("Could not find target in getExecutionData for retry fix");
}

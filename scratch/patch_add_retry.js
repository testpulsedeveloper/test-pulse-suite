const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Fix addTestToCycle to actually have the retry block!
const target = `  await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });`;

const replacement = `  let exRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });
  if (exRes.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      exRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(testIds)
      });
  }
  if (!exRes.ok) {
      const errText = await exRes.text();
      throw new Error(\`Jira PUT execution failed with \${exRes.status}: \${errText}\`);
  }`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    console.log("Patched addTestToCycle execution retry");
}

fs.writeFileSync(path, content);

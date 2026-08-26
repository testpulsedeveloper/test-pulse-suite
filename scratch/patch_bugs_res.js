const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target1 = `  let countTotal = 0;
  let bugsReopened = 0;

  for (const key of bugKeys) {
    try {
      const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${key}?expand=changelog\`);
      if (response.status === 200) {
        const issue = await response.json();
        const changelog = issue.changelog?.histories || [];
        const createdTime = new Date(issue.fields?.created || Date.now()).getTime();`;

const replacement1 = `  let countTotal = 0;
  let bugsReopened = 0;

  try {
    const jql = \`key in (\${bugKeys.join(',')})\`;
    const response = await api.asUser().requestJira(route\`/rest/api/3/search/jql\`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql,
        expand: ['changelog'],
        fields: ['created'],
        maxResults: 100
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      for (const issue of (data.issues || [])) {
        const changelog = issue.changelog?.histories || [];
        const createdTime = new Date(issue.fields?.created || Date.now()).getTime();`;

const target1_end = `        if (finalTime && finalTime > createdTime) {
          totalHours += getBusinessMilliseconds(createdTime, finalTime) / (1000 * 60 * 60);
          countTotal++;
        }
      }
    } catch (e) {
      console.log(\`Failed to fetch changelog for \${key}\`, e);
    }
  }`;

const replacement1_end = `        if (finalTime && finalTime > createdTime) {
          totalHours += getBusinessMilliseconds(createdTime, finalTime) / (1000 * 60 * 60);
          countTotal++;
        }
      }
    }
  } catch (e) {
    console.log(\`Failed to fetch bulk changelog\`, e);
  }`;

if (content.includes(target1) && content.includes(target1_end)) {
    content = content.replace(target1, replacement1);
    content = content.replace(target1_end, replacement1_end);
    fs.writeFileSync(path, content);
    console.log("Patched getBugsResolutionTime!");
} else {
    console.error("Could not find targets for getBugsResolutionTime");
}

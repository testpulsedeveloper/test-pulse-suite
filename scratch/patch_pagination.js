const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Insert fetchAllIssues function
const fetchAllIssuesString = `
async function fetchAllIssues(jql, fields, expand, properties, maxPages = 20) {
  let allIssues = [];
  let startAt = 0;
  let maxResults = 100;
  let page = 0;
  
  while (page < maxPages) {
    const body = {
      jql,
      fields,
      startAt,
      maxResults
    };
    if (expand) body.expand = expand;
    if (properties) body.properties = properties;
    
    const response = await api.asUser().requestJira(route\`/rest/api/3/search/jql\`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
       console.error(\`JQL Search failed: \${response.status} \${response.statusText} for jql: \${jql}\`);
       break; // or throw
    }
    
    const data = await response.json();
    const issues = data.issues || [];
    allIssues = allIssues.concat(issues);
    
    if (startAt + issues.length >= data.total || issues.length === 0) {
      break;
    }
    startAt += issues.length;
    page++;
  }
  
  return allIssues;
}
`;

content = content.replace("import api, { route } from '@forge/api';", "import api, { route } from '@forge/api';\n" + fetchAllIssuesString);

// Patch getTestCases
content = content.replace(
/const response = await api.asUser\(\).requestJira\(route\`\/rest\/api\/3\/search\/jql\`, \{\s*method: 'POST',\s*headers: \{ 'Accept': 'application\/json', 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{\s*jql,\s*fields: \['\*all'\],\s*expand: 'renderedFields',\s*properties: \['testops-folder-link'\],\s*maxResults: 200\s*\}\)\s*\}\);\s*if \(!response.ok\) \{\s*console.error\([^)]*\);\s*return \{ _isError: true, status: response.status, message: await response.text\(\) \};\s*\}\s*const data = await response\.json\(\);\s*console\.log\("getTestCases response data:", JSON\.stringify\(data\)\);\s*let cases = \(data\.issues \|\| \[\]\).map\(issue => \(\{/g,
`const allIssues = await fetchAllIssues(jql, ['*all'], 'renderedFields', ['testops-folder-link']);
    let cases = allIssues.map(issue => ({`
);

// Patch getTestPlans
content = content.replace(
/const response = await api.asUser\(\).requestJira\(route\`\/rest\/api\/3\/search\/jql\`, \{\s*method: 'POST',\s*headers: \{ 'Accept': 'application\/json', 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{\s*jql: \`\$\{projectJql\}issuetype = "\$\{planType\}" ORDER BY created DESC\`,\s*fields: \['summary', 'status', 'created'\],\s*maxResults: 200\s*\}\)\s*\}\);\s*if \(!response\.ok\) \{\s*console\.error\(\`getTestPlans failed: \$\{response\.status\} \$\{response\.statusText\}\`\);\s*return \{ _isError: true, status: response\.status, message: await response\.text\(\) \};\s*\}\s*const data = await response\.json\(\);\s*return \(data\.issues \|\| \[\]\).map\(issue => \(\{/g,
`const jql = \`\$\{projectJql\}issuetype = "\$\{planType\}" ORDER BY created DESC\`;
    const allIssues = await fetchAllIssues(jql, ['summary', 'status', 'created'], null, null);
    return allIssues.map(issue => ({`
);

// Patch getTestCycles
content = content.replace(
/const response = await api.asUser\(\).requestJira\(route\`\/rest\/api\/3\/search\/jql\`, \{\s*method: 'POST',\s*headers: \{ 'Accept': 'application\/json', 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{\s*jql: \`\$\{projectJql\}issuetype = "\$\{cycleType\}" ORDER BY created DESC\`,\s*fields: \['summary', 'status', 'created'\],\s*properties: \['testops-plan-link'\],\s*maxResults: 200\s*\}\)\s*\}\);\s*if \(!response\.ok\) \{\s*console\.error\(\`getTestCycles failed: \$\{response\.status\} \$\{response\.statusText\}\`\);\s*return \{ _isError: true, status: response\.status, message: await response\.text\(\) \};\s*\}\s*const data = await response\.json\(\);\s*return \(data\.issues \|\| \[\]\).map\(issue => \(\{/g,
`const jql = \`\$\{projectJql\}issuetype = "\$\{cycleType\}" ORDER BY created DESC\`;
    const allIssues = await fetchAllIssues(jql, ['summary', 'status', 'created'], null, ['testops-plan-link']);
    return allIssues.map(issue => ({`
);

// Patch getRequirements
content = content.replace(
/const response = await api.asUser\(\).requestJira\(route\`\/rest\/api\/3\/search\/jql\`, \{\s*method: 'POST',\s*headers: \{ 'Accept': 'application\/json', 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{\s*jql,\s*fields: \['summary', 'status', 'created'\],\s*maxResults: 200\s*\}\)\s*\}\);\s*if \(!response\.ok\) \{\s*console\.error\(\`getRequirements failed: \$\{response\.status\} \$\{response\.statusText\}\`\);\s*return \{ _isError: true, status: response\.status, message: await response\.text\(\) \};\s*\}\s*const data = await response\.json\(\);\s*return \(data\.issues \|\| \[\]\).map\(issue => \(\{/g,
`const allIssues = await fetchAllIssues(jql, ['summary', 'status', 'created'], null, null);
    return allIssues.map(issue => ({`
);

// Patch getExecutionReport
content = content.replace(
/const response = await api.asUser\(\).requestJira\(route\`\/rest\/api\/3\/search\/jql\`, \{\s*method: 'POST',\s*headers: \{ 'Accept': 'application\/json', 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{\s*jql,\s*fields: \['summary', 'issuetype'\],\s*properties: \['testops-plan-link', 'execution'\],\s*maxResults: 100\s*\}\)\s*\}\);\s*const data = await response\.json\(\);\s*\/\/ Load execution data from memory directly using the \*all properties fetched in O\(1\)\s*const cycles = \(data\.issues \|\| \[\]\)\.map\(issue => \{/g,
`const allIssues = await fetchAllIssues(jql, ['summary', 'issuetype'], null, ['testops-plan-link', 'execution']);
  // Load execution data from memory directly using the properties fetched in O(1)
  const cycles = allIssues.map(issue => {`
);

fs.writeFileSync(path, content);
console.log("Patched src/index.js for pagination");

const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Completely rewrite fetchAllIssues to strictly match the exact JSON structure that worked before for page 0
const fetchAllIssuesReplacement = `async function fetchAllIssues(jql, fields, expand, properties, maxPages = 20) {
  try {
    let allIssues = [];
    let startAt = 0;
    let maxResults = 100; // previously 200, but Jira truncates to 100 anyway
    let page = 0;
    
    while (page < maxPages) {
      const body = {
        jql,
        fields,
        maxResults
      };
      
      // ONLY include startAt if > 0 to match exactly what worked before!
      if (startAt > 0) {
        body.startAt = startAt;
      }
      
      // expand MUST be a string, not an array
      if (expand) {
         body.expand = Array.isArray(expand) ? expand.join(',') : expand;
      }
      
      if (properties) {
         body.properties = Array.isArray(properties) ? properties : [properties];
      }
      
      const response = await api.asUser().requestJira(route\`/rest/api/3/search/jql\`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
         return [{ id: '999999', key: 'ERR-1', fields: { summary: \`Payload: \${JSON.stringify(body)} | JQL Search failed: \${response.status} \${response.statusText} \${await response.text()}\`, status: { name: 'Error' }, created: new Date().toISOString() } }];
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
  } catch(err) {
    return [{ id: '999999', key: 'ERR-2', fields: { summary: \`Exception: \${err.message}\`, status: { name: 'Error' }, created: new Date().toISOString() } }];
  }
}`;

content = content.replace(/async function fetchAllIssues[\s\S]*?return allIssues;\n\s*\}\s*catch\(err\)\s*\{\n\s*return \[\{\s*id:\s*'999999'[^]*?\}\];\n\s*\}\n\}/m, fetchAllIssuesReplacement);

fs.writeFileSync(path, content);
console.log("Patched fetchAllIssues properly");

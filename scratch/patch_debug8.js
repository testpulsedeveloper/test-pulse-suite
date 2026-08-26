const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const fetchAllIssuesReplacement = `async function fetchAllIssues(jql, fields, expand, properties, maxPages = 20) {
  try {
    let allIssues = [];
    let startAt = 0;
    let maxResults = 100;
    let page = 0;
    
    // Transform *all to specific fields to prevent Jira API strict validation crashes on pagination
    let safeFields = fields;
    if (Array.isArray(fields) && fields.includes('*all')) {
        safeFields = ['summary', 'description', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution'];
    } else if (fields === '*all') {
        safeFields = ['summary', 'description', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution'];
    }
    
    while (page < maxPages) {
      const body = {
        jql,
        fields: Array.isArray(safeFields) ? safeFields : [safeFields],
        maxResults,
        startAt
      };
      
      if (expand) {
         body.expand = Array.isArray(expand) ? expand : [expand];
      }
      if (properties) {
         body.properties = Array.isArray(properties) ? properties : [properties];
      }
      
      const response = await api.asUser().requestJira(route\`/rest/api/3/search\`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
         return [{ id: '999999', key: 'ERR-1', fields: { summary: \`Payload: \${JSON.stringify(body)} | HTTP \${response.status} \${await response.text()}\`, status: { name: 'Error' }, created: new Date().toISOString() } }];
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

content = content.replace(/async function fetchAllIssues[\s\S]*?return \[\{\s*id:\s*'999999'[^]*?\}\];\n\s*\}\n\}/m, fetchAllIssuesReplacement);

fs.writeFileSync(path, content);
console.log("Patched fetchAllIssues to strictly use arrays for Jira validation");

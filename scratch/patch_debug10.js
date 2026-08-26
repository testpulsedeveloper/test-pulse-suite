const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const fetchAllIssuesReplacement = `async function fetchAllIssues(jql, fields, expand, properties, maxPages = 20) {
  try {
    let allIssues = [];
    let maxResults = 100;
    let page = 0;
    let nextPageToken = null;
    let isLast = false;
    
    // Transform *all to specific fields
    let safeFields = fields;
    if (Array.isArray(fields) && fields.includes('*all')) {
        safeFields = ['summary', 'description', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution'];
    } else if (fields === '*all') {
        safeFields = ['summary', 'description', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution'];
    }
    
    while (page < maxPages && !isLast) {
      const body = {
        jql,
        maxResults,
        fields: Array.isArray(safeFields) ? safeFields : [safeFields]
      };
      
      if (nextPageToken) {
         body.nextPageToken = nextPageToken;
      }
      
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
         return [{ id: '999999', key: 'ERR-1', fields: { summary: \`JQL Search failed: \${response.status} \${await response.text()}\`, status: { name: 'Error' }, created: new Date().toISOString() } }];
      }
      
      const data = await response.json();
      const issues = data.issues || [];
      allIssues = allIssues.concat(issues);
      
      // Update pagination cursor for the next iteration
      nextPageToken = data.nextPageToken;
      
      // Stop if there are no more pages
      if (data.nextPageToken == null || data.isLast === true || issues.length === 0) {
          isLast = true;
          break;
      }
      
      page++;
    }
    
    return allIssues;
  } catch(err) {
    return [{ id: '999999', key: 'ERR-2', fields: { summary: \`Exception: \${err.message}\`, status: { name: 'Error' }, created: new Date().toISOString() } }];
  }
}`;

content = content.replace(/async function fetchAllIssues[\s\S]*?return \[\{\s*id:\s*'999999'[^]*?\}\];\n\s*\}\n\}/m, fetchAllIssuesReplacement);

fs.writeFileSync(path, content);
console.log("Patched fetchAllIssues to use cursor pagination with search/jql");

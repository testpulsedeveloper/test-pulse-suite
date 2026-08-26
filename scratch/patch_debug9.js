const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const fetchAllIssuesReplacement = `async function fetchAllIssues(jql, fields, expand, properties, maxPages = 20) {
  try {
    let allIssues = [];
    let startAt = 0;
    let maxResults = 100;
    let page = 0;
    
    let safeFields = fields;
    if (Array.isArray(fields) && fields.includes('*all')) {
        safeFields = ['summary', 'description', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution'];
    } else if (fields === '*all') {
        safeFields = ['summary', 'description', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution'];
    }
    
    const fieldsStr = Array.isArray(safeFields) ? safeFields.join(',') : safeFields;
    const expandStr = Array.isArray(expand) ? expand.join(',') : (expand || '');
    const propsStr = Array.isArray(properties) ? properties.join(',') : (properties || '');
    
    while (page < maxPages) {
      // Forge route literal safely encodes all interpolated values
      const response = await api.asUser().requestJira(
         route\`/rest/api/3/search?jql=\${jql}&startAt=\${startAt}&maxResults=\${maxResults}&fields=\${fieldsStr}&expand=\${expandStr}&properties=\${propsStr}\`
      );
      
      if (!response.ok) {
         return [{ id: '999999', key: 'ERR-1', fields: { summary: \`GET Search failed: HTTP \${response.status} \${await response.text()}\`, status: { name: 'Error' }, created: new Date().toISOString() } }];
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
console.log("Patched fetchAllIssues to use GET request");

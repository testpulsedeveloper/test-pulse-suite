const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const fetchAllIssuesReplacement = `async function fetchAllIssues(jql, fields, expand, properties, maxPages = 20) {
  try {
    let allIssues = [];
    let startAt = 0;
    let maxResults = 100;
    let page = 0;
    
    while (page < maxPages) {
      const params = new URLSearchParams();
      params.append('jql', jql);
      params.append('maxResults', maxResults.toString());
      params.append('startAt', startAt.toString());
      
      if (fields) {
         params.append('fields', Array.isArray(fields) ? fields.join(',') : fields);
      }
      if (expand) {
         params.append('expand', Array.isArray(expand) ? expand.join(',') : expand);
      }
      if (properties) {
         const props = Array.isArray(properties) ? properties : [properties];
         props.forEach(p => params.append('properties', p));
      }
      
      const queryString = params.toString();
      const response = await api.asUser().requestJira(route\`/rest/api/3/search?\${queryString}\`);
      
      if (!response.ok) {
         return [{ id: '999999', key: 'ERR-1', fields: { summary: \`GET Search failed: \${response.status} \${response.statusText} \${await response.text()} | query: \${queryString}\`, status: { name: 'Error' }, created: new Date().toISOString() } }];
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
console.log("Patched fetchAllIssues to use GET");

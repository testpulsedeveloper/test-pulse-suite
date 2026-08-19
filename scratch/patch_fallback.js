const fs = require('fs');

const replacement = `        } else {
          // Fallback if createmeta fails
          const fields = await invoke('getFields');
          if (fields && Array.isArray(fields)) {
            if (fields.length === 0) {
              setJiraFields([{ id: 'debug-empty', name: 'Error: API devolvió 0 campos' }]);
            } else {
              const excluded = ['id', 'key', 'project', 'issuetype', 'summary', 'description', 'status', 'resolution', 'created', 'updated'];
              const filtered = fields.filter(f => !excluded.includes(f.id));
              if (filtered.length === 0) {
                setJiraFields([{ id: 'debug-filtered', name: \`Error: Todos los \${fields.length} campos fueron filtrados\` }]);
              } else {
                setJiraFields(filtered);
                // BUILD bulkFieldSchema from getFields!
                const schemaDict = {};
                filtered.forEach(f => { schemaDict[f.id] = f; });
                setBulkFieldSchema(schemaDict);
              }
            }
          } else {`;

let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');
const regex = /\} else \{\s*\/\/\s*Fallback if createmeta fails\s*const fields = await invoke\('getFields'\);\s*if \(fields && Array\.isArray\(fields\)\) \{\s*if \(fields\.length === 0\) \{\s*setJiraFields\(\[\{ id: 'debug-empty', name: 'Error: API devolvió 0 campos' \}\]\);\s*\} else \{\s*const excluded = \['id', 'key', 'project', 'issuetype', 'summary', 'description', 'status', 'resolution', 'created', 'updated'\];\s*const filtered = fields\.filter\(f => !excluded\.includes\(f\.id\)\);\s*if \(filtered\.length === 0\) \{\s*setJiraFields\(\[\{ id: 'debug-filtered', name: `Error: Todos los \$\{fields\.length\} campos fueron filtrados` \}\]\);\s*\} else \{\s*setJiraFields\(filtered\);\s*\}\s*\}\s*\} else \{/m;

if (appContent.match(regex)) {
  appContent = appContent.replace(regex, replacement);
  fs.writeFileSync('static/hello-world/src/App.js', appContent);
  console.log('Fallback patched successfully!');
} else {
  console.log('Regex did not match.');
}

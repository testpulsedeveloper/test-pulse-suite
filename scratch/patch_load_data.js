const fs = require('fs');

const replacement = `            if (filtered.length === 0) {
              setJiraFields([{ id: 'debug-filtered', name: \`Error: Todos los \${fields.length} campos fueron filtrados\` }]);
            } else {
              setJiraFields(filtered);
              const schemaDict = {};
              filtered.forEach(f => { schemaDict[f.id] = f; });
              setBulkFieldSchema(schemaDict);
            }
          }
          const typeField = (fields.length ? fields : []).find(f => f.name === 'Tipo de ejecución');
          if (typeField) setExecutionTypeFieldId(typeField.id);
        } else {
          setJiraFields([{ id: 'debug-error', name: \`Error: \${JSON.stringify(fields)}\` }]);
        }
        // Removed setBulkMappingLoaded(true) here so handleOpenBulkPanel can fetch true createmeta schema
      }`;

let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');
const regex = /if \(filtered\.length === 0\) \{[\s\S]*?setBulkMappingLoaded\(true\);\s*\}/m;

if (appContent.match(regex)) {
  appContent = appContent.replace(regex, replacement);
  fs.writeFileSync('static/hello-world/src/App.js', appContent);
  console.log('App.js loadData patched successfully!');
} else {
  console.log('Regex did not match.');
}

const fs = require('fs');
let content = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const regex = /const val = r\.all\[header\]\.trim\(\);\s*if \(schema && schema\.allowedValues && Array\.isArray\(schema\.allowedValues\)\) \{[\s\S]*?\} else \{\s*fields\[fieldId\] = val;\s*\}/m;

const replacement = `const val = r.all[header].trim();
            if (schema && schema.schema && schema.schema.type) {
              const isArray = schema.schema.type === 'array';
              
              let valuesToProcess = isArray ? val.split(',').map(s => s.trim()).filter(Boolean) : [val];
              let fieldObjects = [];

              valuesToProcess.forEach(singleVal => {
                let optObj = {};
                if (schema.allowedValues && Array.isArray(schema.allowedValues)) {
                  const matchedOption = schema.allowedValues.find(v => (v.value || v.name || '').toLowerCase() === singleVal.toLowerCase());
                  if (matchedOption) {
                    if (matchedOption.id !== undefined) optObj.id = String(matchedOption.id);
                    if (matchedOption.name !== undefined) optObj.name = String(matchedOption.name);
                    if (matchedOption.value !== undefined) optObj.value = String(matchedOption.value);
                  }
                }
                
                if (Object.keys(optObj).length === 0) {
                  // Fallback: If we didn't match anything or allowedValues is missing
                  if (schema.schema.type === 'version' || schema.schema.type === 'component' || schema.schema.items === 'version' || schema.schema.items === 'component') {
                    optObj = { name: singleVal };
                  } else if (schema.schema.custom && schema.schema.custom.includes('select')) {
                    optObj = { value: singleVal };
                  } else {
                    optObj = { id: singleVal, name: singleVal };
                  }
                }
                fieldObjects.push(optObj);
              });

              if (isArray) {
                fields[fieldId] = fieldObjects;
              } else {
                fields[fieldId] = fieldObjects[0] || val;
              }
            } else {
              fields[fieldId] = val;
            }`;

if (content.match(regex)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync('static/hello-world/src/App.js', content);
  console.log('Patched App.js successfully.');
} else {
  console.log('Regex did not match.');
}

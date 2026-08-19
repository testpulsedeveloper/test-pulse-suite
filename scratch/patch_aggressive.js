const fs = require('fs');

const replacement = `            if (schema) {
              const isArray = schema.schema ? schema.schema.type === 'array' : false;
              
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
                  // Fallback: Si el campo es custom y no tiene metadata, asumimos que es un select.
                  if (schema.schema && (schema.schema.type === 'version' || schema.schema.type === 'component' || schema.schema.items === 'version' || schema.schema.items === 'component')) {
                    optObj = { name: singleVal };
                  } else if (schema.schema && schema.schema.custom && schema.schema.custom.includes('select')) {
                    optObj = { value: singleVal };
                  } else if (!schema.schema && fieldId.startsWith('customfield_')) {
                    // Xray fields often lack schema in fallback, so force { value: val }
                    optObj = { value: singleVal };
                  } else {
                    optObj = singleVal; // If all else fails, use the raw string
                  }
                }
                fieldObjects.push(optObj);
              });

              if (isArray) {
                fields[fieldId] = fieldObjects;
              } else {
                fields[fieldId] = fieldObjects[0] || val;
              }
            } else {`;

let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');
const regex = /if \(schema && \(schema\.schema \|\| schema\.allowedValues\)\) \{[\s\S]*?\} else \{/m;

if (appContent.match(regex)) {
  appContent = appContent.replace(regex, replacement);
  fs.writeFileSync('static/hello-world/src/App.js', appContent);
  console.log('App.js aggressive patched successfully!');
} else {
  console.log('Regex did not match.');
}

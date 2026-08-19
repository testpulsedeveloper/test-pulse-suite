const fs = require('fs');

const replacement = `                if (Object.keys(optObj).length === 0) {
                  // Fallback: Si el campo es custom y no tiene metadata, asumimos que es un select.
                  if (schema.schema && (schema.schema.type === 'version' || schema.schema.type === 'component' || schema.schema.items === 'version' || schema.schema.items === 'component')) {
                    optObj = { name: singleVal };
                  } else if (schema.schema && (schema.schema.type === 'string' || schema.schema.type === 'number' || schema.schema.type === 'datetime' || schema.schema.type === 'date')) {
                    optObj = schema.schema.type === 'number' ? Number(singleVal) : singleVal;
                  } else if (fieldId.startsWith('customfield_')) {
                    // It's a custom field, but not a basic string/number. It's likely a radio button, select list, or Xray type.
                    optObj = { value: singleVal };
                  } else {
                    optObj = singleVal; // If all else fails, use the raw string
                  }
                }`;

let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');
const regex = /if \(Object\.keys\(optObj\)\.length === 0\) \{[\s\S]*?\/\/ If all else fails, use the raw string\s*\}\s*\}/m;

if (appContent.match(regex)) {
  appContent = appContent.replace(regex, replacement);
  fs.writeFileSync('static/hello-world/src/App.js', appContent);
  console.log('App.js final patched successfully!');
} else {
  console.log('Regex did not match.');
}

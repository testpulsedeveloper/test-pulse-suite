const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `        // Add mapped description (or fallback)
        const descText = descCol ? r.all[descCol] : r.description;
        if (descText) {
          fields.description = textToAdf(descText);
        }`;

const replacement = `        // Add mapped description (or fallback)
        const descText = descCol ? r.all[descCol] : r.description;
        // Si el campo esta vacio pero Jira lo exige, mandamos un espacio en blanco para que no falle.
        fields.description = textToAdf(descText || " ");`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched description empty fallback");
} else {
    console.error("Could not find description target");
}

const target2 = `                if (Object.keys(optObj).length === 0) {
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

const replacement2 = `                if (Object.keys(optObj).length === 0) {
                  // Fallback: Si el campo es custom y no tiene metadata, asumimos que es un select.
                  if (schema.schema && (schema.schema.type === 'version' || schema.schema.type === 'component' || schema.schema.items === 'version' || schema.schema.items === 'component' || schema.schema.type === 'priority')) {
                    optObj = { name: singleVal };
                  } else if (schema.schema && (schema.schema.type === 'string' || schema.schema.type === 'number' || schema.schema.type === 'datetime' || schema.schema.type === 'date')) {
                    optObj = schema.schema.type === 'number' ? Number(singleVal) : singleVal;
                  } else if (fieldId.startsWith('customfield_')) {
                    // It's a custom field, but not a basic string/number. It's likely a radio button, select list, or Xray type.
                    optObj = { value: singleVal };
                  } else if (fieldId === 'priority') {
                    optObj = { name: singleVal };
                  } else {
                    optObj = singleVal; // If all else fails, use the raw string
                  }
                }`;

if (content.includes(target2)) {
    content = content.replace(target2, replacement2);
    fs.writeFileSync(path, content);
    console.log("Patched priority fallback");
} else {
    console.error("Could not find priority target");
}

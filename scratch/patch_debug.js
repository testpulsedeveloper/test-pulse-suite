const fs = require('fs');

const replacement = `      if (allErrors.length > 0 && issues && issues.length > 0) {
        const debugInfo = {
          payload: issues[0].fields,
          schema10534: bulkFieldSchema['customfield_10534'] || "MISSING",
          schemaKeys: Object.keys(bulkFieldSchema)
        };
        allErrors.push({ message: "DEBUG (Envia foto de esto a Gustavo): " + JSON.stringify(debugInfo) });
      }`;

let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');
const regex = /if \(allErrors\.length > 0 && issues && issues\.length > 0\) \{\s*allErrors\.push\(\{ message: "DEBUG \(Envia foto de esto a Gustavo\): " \+ JSON\.stringify\(issues\[0\]\.fields\) \}\);\s*\}/m;

if (appContent.match(regex)) {
  appContent = appContent.replace(regex, replacement);
  fs.writeFileSync('static/hello-world/src/App.js', appContent);
  console.log('App.js debug patched successfully!');
} else {
  console.log('Regex did not match.');
}

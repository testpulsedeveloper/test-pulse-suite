const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `      const attachments = await response.json();
      if (attachments && attachments.length > 0) {`;

const replacement = `      const attachments = await response.json();
      if (!response.ok) {
          console.error("Jira upload error:", attachments);
          alert("Jira rechazó el archivo: " + (attachments.errorMessages ? attachments.errorMessages.join(", ") : "Error desconocido"));
          return;
      }
      if (attachments && attachments.length > 0) {`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched error handling in upload!");
} else {
    console.error("Could not find target");
}

const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `    if (!response.ok) {
      const errText = await response.text();
      throw new Error('Failed to save test data: ' + errText);
    }
  }
  
  return updatedData;
});`;

const replacement = `    if (!response.ok) {
      const errText = await response.text();
      throw new Error('Failed to save test data: ' + errText);
    }
  }
  
  return { success: true };
});`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched updateTestStatus return");
} else {
    console.error("Could not find target in updateTestStatus");
}

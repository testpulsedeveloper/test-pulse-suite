const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `    } finally {
      setLoading(false);
    }
  };`;
const replacement = `    } finally {
      setRefreshTrigger(prev => prev + 1);
      setLoading(false);
    }
  };`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched refresh trigger!");
} else {
    console.error("Could not find target");
}

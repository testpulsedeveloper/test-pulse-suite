const fs = require('fs');
const path = 'static/hello-world/src/index.css';
let content = fs.readFileSync(path, 'utf8');

// Use order to put nav-actions next to nav-brand!
const replaceFrom = `  .nav-brand {
    margin-right: 0 !important;
  }
  .nav-actions {
    margin-left: 0 !important;
  }
  .top-nav .nav-tabs {`;
const replaceTo = `  .nav-brand {
    margin-right: 0 !important;
    order: 1;
  }
  .nav-actions {
    margin-left: 0 !important;
    order: 2;
  }
  .top-nav .nav-tabs {
    order: 3;`;

if (content.includes(replaceFrom)) {
    content = content.replace(replaceFrom, replaceTo);
    fs.writeFileSync(path, content);
    console.log("Fixed flex order!");
} else {
    console.error("Could not find block to replace");
}

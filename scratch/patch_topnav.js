const fs = require('fs');
const path = 'static/hello-world/src/index.css';
let content = fs.readFileSync(path, 'utf8');

// I will append more CSS rules to the existing @media block
content = content.replace('.nav-tabs {', `
  .top-nav {
    flex-wrap: wrap !important;
    height: auto !important;
    padding: 1rem !important;
    gap: 1rem;
  }
  .nav-tabs {`);

fs.writeFileSync(path, content);
console.log("Appended top-nav mobile css");

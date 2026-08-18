const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// Fix router.open for gmail
code = code.replace(/window\.open\(\`https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&su=\$\{subject\}\`, '_blank'\);/g,
  "router.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}`);");

fs.writeFileSync('static/hello-world/src/App.js', code);

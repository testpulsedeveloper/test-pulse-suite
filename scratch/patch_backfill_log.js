const fs = require('fs');
const indexJs = fs.readFileSync('src/index.js', 'utf8');

const patch = `
    const data = await response.json();
    console.log("BACKFILL DATA:", JSON.stringify(data).substring(0, 500));
    const issues = data.issues || [];
`;

const newIndexJs = indexJs.replace('const data = await response.json();\n    const issues = data.issues || [];', patch);
fs.writeFileSync('src/index.js', newIndexJs);

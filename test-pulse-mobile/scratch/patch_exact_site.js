const fs = require('fs');
let content = fs.readFileSync('src/screens/LoginScreen.js', 'utf8');

const oldCode = `      const targetSite = resourcesData.find(r => r.url && r.url.toLowerCase().includes('liverpool'));`;

// Match exactly the production URL if available, otherwise match any liverpool, otherwise fallback
const newCode = `      let targetSite = resourcesData.find(r => r.url === 'https://liverpooldigital.atlassian.net');
      if (!targetSite) {
        targetSite = resourcesData.find(r => r.url && r.url.toLowerCase().includes('liverpool'));
      }`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync('src/screens/LoginScreen.js', content);
  console.log('Patched targetSite for exact match');
} else {
  console.log('Could not find old code');
}

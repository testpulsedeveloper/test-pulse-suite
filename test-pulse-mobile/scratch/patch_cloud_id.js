const fs = require('fs');
let content = fs.readFileSync('src/screens/LoginScreen.js', 'utf8');

const oldCode = `      // Normally we'd let the user select a site, but we assume the first one (Liverpool Digital)
      const cloudId = resourcesData[0].id;`;

const newCode = `      // Find the Liverpool Digital site specifically, otherwise fallback to the first one
      console.log('Available sites:', resourcesData.map(r => r.name || r.url));
      const targetSite = resourcesData.find(r => r.url && r.url.toLowerCase().includes('liverpool'));
      const cloudId = targetSite ? targetSite.id : resourcesData[0].id;`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync('src/screens/LoginScreen.js', content);
  console.log('Patched cloudId selection');
} else {
  console.log('Could not find old code');
}

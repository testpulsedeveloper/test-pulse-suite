const fs = require('fs');
let content = fs.readFileSync('src/screens/LoginScreen.js', 'utf8');

const oldCode = `      let targetSite = resourcesData.find(r => r.url === 'https://liverpooldigital.atlassian.net');
      if (!targetSite) {
        targetSite = resourcesData.find(r => r.url && r.url.toLowerCase().includes('liverpool'));
      }`;

const newCode = `      // Buscar explícitamente "liverpooldeveloper" o la primera instancia disponible
      let targetSite = resourcesData.find(r => (r.name && r.name.toLowerCase().includes('liverpool')) || (r.url && r.url.toLowerCase().includes('liverpool')));
      if (!targetSite) {
        targetSite = resourcesData[0];
      }`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync('src/screens/LoginScreen.js', content);
  console.log('Patched targetSite for liverpooldeveloper');
} else {
  console.log('Could not find old code');
}

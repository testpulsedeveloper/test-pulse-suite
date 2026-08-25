const fs = require('fs');
const path = 'src/screens/LoginScreen.js';
let content = fs.readFileSync(path, 'utf8');

const oldCode = `      // Buscar explícitamente "liverpooldeveloper" o la primera instancia disponible
      let targetSite = resourcesData.find(r => (r.name && r.name.toLowerCase().includes('liverpool')) || (r.url && r.url.toLowerCase().includes('liverpool')));`;

const newCode = `      // Buscar explícitamente "liverpooldigital" primero
      let targetSite = resourcesData.find(r => (r.name && r.name.toLowerCase().includes('liverpooldigital')) || (r.url && r.url.toLowerCase().includes('liverpooldigital')));
      // Si no existe, buscar cualquier otra de liverpool
      if (!targetSite) {
        targetSite = resourcesData.find(r => (r.name && r.name.toLowerCase().includes('liverpool')) || (r.url && r.url.toLowerCase().includes('liverpool')));
      }`;

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync(path, content);
    console.log("Patched LoginScreen successfully");
} else {
    console.error("Old code not found");
}

const fs = require('fs');
const path = 'src/screens/LoginScreen.js';
let content = fs.readFileSync(path, 'utf8');

const oldCode = `      // Buscar explícitamente "liverpooldigital" primero
      let targetSite = resourcesData.find(r => (r.name && r.name.toLowerCase().includes('liverpooldigital')) || (r.url && r.url.toLowerCase().includes('liverpooldigital')));
      // Si no existe, buscar cualquier otra de liverpool
      if (!targetSite) {
        targetSite = resourcesData.find(r => (r.name && r.name.toLowerCase().includes('liverpool')) || (r.url && r.url.toLowerCase().includes('liverpool')));
      }
      const cloudId = targetSite ? targetSite.id : resourcesData[0].id;`;

const newCode = `      // Buscar explícitamente "liverpooldigital" primero
      let targetSite = resourcesData.find(r => (r.name && r.name.toLowerCase().includes('liverpooldigital')) || (r.url && r.url.toLowerCase().includes('liverpooldigital')));
      // Si no existe, buscar cualquier otra de liverpool
      if (!targetSite) {
        targetSite = resourcesData.find(r => (r.name && r.name.toLowerCase().includes('liverpool')) || (r.url && r.url.toLowerCase().includes('liverpool')));
      }
      
      // FORZAR EL CLOUD ID DE PRODUCCIÓN SI ATLASSIAN LO OCULTA
      // Cloud ID de liverpooldigital.atlassian.net
      let cloudId = targetSite ? targetSite.id : resourcesData[0].id;
      if (!targetSite || !JSON.stringify(targetSite).includes('liverpooldigital')) {
        console.warn("Atlassian no devolvió liverpooldigital en accessible-resources. Forzando Cloud ID de producción...");
        cloudId = "fff286b5-74d1-4f96-9f7c-173b914b2776";
      }`;

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync(path, content);
    console.log("Patched LoginScreen successfully with Cloud ID force override");
} else {
    console.error("Old code not found");
}

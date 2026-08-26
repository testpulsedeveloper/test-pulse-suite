const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target1 = `    const csvContent = "\\uFEFF" + \`Resumen,Descripción,Link (is tested by),Nivel de Prueba,Tipo de Prueba,Tipo de Ejecución,Prioridad`;
const replacement1 = `    const csvContent = "\\uFEFF" + \`Resumen,Description,Link (is tested by),Nivel de Prueba,Tipo de Prueba,Tipo de Ejecución,Prioridad`;

if (content.includes(target1)) {
    content = content.replace(target1, replacement1);
    console.log("Replaced CSV header to Description");
} else {
    console.error("Could not find CSV header target");
}

const target2Regex = /const handleDownloadJiraConfig = \(\) => \{[\s\S]*?document\.body\.removeChild\(link\);\s*\};/;
if (content.match(target2Regex)) {
    content = content.replace(target2Regex, '');
    console.log("Removed handleDownloadJiraConfig function");
} else {
    console.error("Could not find handleDownloadJiraConfig function");
}

const target3Regex = /<button[\s\S]*?onClick=\{handleDownloadJiraConfig\}[\s\S]*?<\/button>/;
if (content.match(target3Regex)) {
    content = content.replace(target3Regex, '');
    console.log("Removed handleDownloadJiraConfig button");
} else {
    console.error("Could not find handleDownloadJiraConfig button");
}

fs.writeFileSync(path, content);

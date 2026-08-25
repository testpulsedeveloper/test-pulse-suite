const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const oldCode = `  const handlePreviewEvidence = async (ev) => {
    const id = typeof ev === 'string' ? ev : ev.id;
    const filename = typeof ev === 'string' ? \`evidence_\${id}.jpg\` : (ev.filename || \`evidence_\${id}.jpg\`);

    if (filename.match(/\\.(png|jpg|jpeg|gif|pdf|mp4|mov|webm)$/i)) {
      setPreviewModalData({ id, filename, loading: true });`;

const newCode = `  const handlePreviewEvidence = async (ev) => {
    const id = typeof ev === 'string' ? ev : ev.id;
    let filename = typeof ev === 'string' ? \`evidence_\${id}.jpg\` : (ev.filename || \`evidence_\${id}.jpg\`);
    
    // Si no tiene extensión (ej. porque el usuario lo renombró "Evidencia 1"), asumimos que es imagen/video
    const hasExtension = /\\.[a-zA-Z0-9]+$/.test(filename);
    const isMedia = filename.match(/\\.(png|jpg|jpeg|gif|pdf|mp4|mov|webm)$/i);

    if (isMedia || !hasExtension) {
      if (!hasExtension) filename += '.png'; // Para que el modal sepa renderizarlo
      
      setPreviewModalData({ id, filename, loading: true });`;

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync(path, content);
    console.log("Patched handlePreviewEvidence");
} else {
    console.error("Could not find handlePreviewEvidence");
}

const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// Patch handleCaptureScreen
const captureTarget = `  const handleCaptureScreen = async (testId, testKey, iterId) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert("Tu navegador no soporta captura de pantalla nativa.");
      return;
    }`;

const captureReplacement = `  const handleCaptureScreen = async (testId, testKey, iterId) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert("Tu dispositivo móvil no soporta grabar pantalla. Usa el botón 'Archivo' para subir o tomar una foto de la evidencia.");
      return;
    }`;

if (content.includes(captureTarget)) {
    content = content.replace(captureTarget, captureReplacement);
    console.log("Patched handleCaptureScreen");
} else {
    console.error("Could not find captureTarget");
}

// Patch handleRunTest
const runTarget = `  const handleRunTest = async (testId, testKey, test) => {
    try {
      if (test) await handleTakeover(test);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert("Tu navegador o entorno no soporta captura de pantalla nativa. Sube la evidencia manualmente.");
        setRunningTests(prev => ({ ...prev, [testId]: 'active' }));
        return;
      }`;

const runReplacement = `  const handleRunTest = async (testId, testKey, test) => {
    try {
      if (test) await handleTakeover(test);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        // En móviles, simplemente habilitamos la prueba sin intentar grabar pantalla ni lanzar alertas molestas
        setRunningTests(prev => ({ ...prev, [testId]: 'active' }));
        return;
      }`;

if (content.includes(runTarget)) {
    content = content.replace(runTarget, runReplacement);
    console.log("Patched handleRunTest");
} else {
    console.error("Could not find runTarget");
}

fs.writeFileSync(path, content);
console.log("Done patching media devices!");

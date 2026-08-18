const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// 1. Add handleCaptureScreen and handleRenameEvidence
const newFunctions = `
  const handleRenameEvidence = async (testId, index, newName) => {
    const currentTest = cycleTests.find(t => t.id === testId);
    if (!currentTest) return;
    
    let currentEvidences = currentTest.evidences ? [...currentTest.evidences] : [];
    if (currentTest.evidence && currentEvidences.length === 0) {
      currentEvidences.push(currentTest.evidence);
    }
    
    if (typeof currentEvidences[index] === 'object') {
      currentEvidences[index] = { ...currentEvidences[index], filename: newName };
    }
    
    setCycleTests(cycleTests.map(t => t.id === testId ? { ...t, evidences: currentEvidences, evidence: null } : t));
    await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
  };

  const handleCaptureScreen = async (testId, testKey) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert("Tu navegador no soporta captura de pantalla nativa.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      document.body.appendChild(video);
      video.srcObject = stream;
      
      video.onloadedmetadata = () => {
        setTimeout(async () => {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          stream.getTracks().forEach(track => track.stop());
          document.body.removeChild(video);
          
          canvas.toBlob(async (blob) => {
            if (blob) {
              const file = new File([blob], \`screenshot_\${Date.now()}.jpg\`, { type: 'image/jpeg' });
              await handleUploadEvidence(testId, testKey, file);
            }
          }, 'image/jpeg', 0.9);
        }, 500);
      };
    } catch(err) {
      console.error("Captura cancelada", err);
    }
  };
`;

code = code.replace(/const handleRunTest = async/, newFunctions + '\n  const handleRunTest = async');

// 2. Add rename button and fix SVG to camera
const evidenceRegex = /<button[\s\S]*?onClick=\{\(e\) => \{[\s\S]*?e\.stopPropagation\(\);[\s\S]*?handleDeleteEvidence\(test\.id, evId, idx\);[\s\S]*?\}\}[\s\S]*?title="Quitar evidencia"[\s\S]*?>✕<\/button>/g;

code = code.replace(evidenceRegex, (match) => {
  return `<button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newName = prompt("Nuevo nombre para la evidencia:", evName);
                                      if (newName && newName !== evName) {
                                        handleRenameEvidence(test.id, idx, newName);
                                      }
                                    }}
                                    title="Renombrar evidencia"
                                    style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0 4px', lineHeight: 1}}
                                  >✏️</button>
                                  ${match}`;
});

// Replace the video SVG with Camera SVG in Grabar pantalla buttons
code = code.replace(/<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"><\/polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"><\/rect><\/svg>/g, 
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>');

fs.writeFileSync('static/hello-world/src/App.js', code);

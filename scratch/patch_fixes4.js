const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// Update handleRenameEvidence
code = code.replace(/const handleRenameEvidence = async \(testId, index, newName\) => \{[\s\S]*?await invoke\('updateTestStatus', \{ cycleId: selectedCycle\.id, testId, evidences: currentEvidences \}\);\n  \};/,
`const handleRenameEvidence = async (testId, index, newName, iterId) => {
    const currentTest = cycleTests.find(t => t.id === testId);
    if (!currentTest) return;
    
    if (iterId) {
       const iters = [...(currentTest.iterations || [])];
       const iterIdx = iters.findIndex(i => i.id === iterId);
       if (iterIdx > -1) {
          const evs = iters[iterIdx].evidences ? [...iters[iterIdx].evidences] : [];
          if (typeof evs[index] === 'object') {
             evs[index] = { ...evs[index], filename: newName };
          }
          iters[iterIdx] = { ...iters[iterIdx], evidences: evs };
          setCycleTests(cycleTests.map(t => t.id === testId ? { ...t, iterations: iters } : t));
          await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
       }
       return;
    }

    let currentEvidences = currentTest.evidences ? [...currentTest.evidences] : [];
    if (currentTest.evidence && currentEvidences.length === 0) {
      currentEvidences.push(currentTest.evidence);
    }
    
    if (typeof currentEvidences[index] === 'object') {
      currentEvidences[index] = { ...currentEvidences[index], filename: newName };
    }
    
    setCycleTests(cycleTests.map(t => t.id === testId ? { ...t, evidences: currentEvidences, evidence: null } : t));
    await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
  };`);

// Update handleCaptureScreen
code = code.replace(/const handleCaptureScreen = async \(testId, testKey\) => \{/,
  'const handleCaptureScreen = async (testId, testKey, iterId) => {');

code = code.replace(/await handleUploadEvidence\(testId, testKey, file\);/,
  'await handleUploadEvidence(testId, testKey, file, iterId);');

// Update handleUploadEvidence
code = code.replace(/const handleUploadEvidence = async \(testId, testKey, file\) => \{/,
  'const handleUploadEvidence = async (testId, testKey, file, iterId) => {');

code = code.replace(/currentEvidences\.push\(newEvidence\);\n         \n         const execution = await invoke\('updateTestStatus', \{ cycleId: selectedCycle\.id, testId, evidences: currentEvidences \}\);\n         setCycleTests\(execution \|\| \[\]\);/,
`currentEvidences.push(newEvidence);
         
         if (iterId) {
            const iters = [...(currentTest.iterations || [])];
            const iterIdx = iters.findIndex(i => i.id === iterId);
            if (iterIdx > -1) {
               iters[iterIdx] = { ...iters[iterIdx], evidences: iters[iterIdx].evidences ? [...iters[iterIdx].evidences, newEvidence] : [newEvidence] };
               const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
               setCycleTests(execution || []);
            }
         } else {
            const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
            setCycleTests(execution || []);
         }`);

// Update handleDeleteEvidence
code = code.replace(/const handleDeleteEvidence = async \(testId, attachmentId, index\) => \{[\s\S]*?await invoke\('updateTestStatus', \{ cycleId: selectedCycle\.id, testId, evidences: currentEvidences \}\);\n  \};/,
`const handleDeleteEvidence = async (testId, attachmentId, index, iterId) => {
    const currentTest = cycleTests.find(t => t.id === testId);
    if (!currentTest) return;
    
    if (iterId) {
       const iters = [...(currentTest.iterations || [])];
       const iterIdx = iters.findIndex(i => i.id === iterId);
       if (iterIdx > -1) {
          const evs = iters[iterIdx].evidences ? [...iters[iterIdx].evidences] : [];
          evs.splice(index, 1);
          iters[iterIdx] = { ...iters[iterIdx], evidences: evs };
          setCycleTests(cycleTests.map(t => t.id === testId ? { ...t, iterations: iters } : t));
          await invoke('deleteAttachment', { attachmentId });
          await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
       }
       return;
    }

    let currentEvidences = currentTest.evidences ? [...currentTest.evidences] : [];
    if (currentTest.evidence && currentEvidences.length === 0) {
      currentEvidences.push(currentTest.evidence);
    }
    
    currentEvidences.splice(index, 1);
    setCycleTests(cycleTests.map(t => t.id === testId ? { ...t, evidences: currentEvidences, evidence: null } : t));

    await invoke('deleteAttachment', { attachmentId });
    await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
  };`);

// Update handleDeleteEvidence call in general block
code = code.replace(/handleDeleteEvidence\(test\.id, evId, idx\);/g,
  'handleDeleteEvidence(test.id, evId, idx, undefined);');

// Update handleRenameEvidence call in general block
code = code.replace(/handleRenameEvidence\(test\.id, idx, newName\);/g,
  'handleRenameEvidence(test.id, idx, newName, undefined);');

// Add evidences rendering to Iterations
const iterUploadButton = /<label className="btn-secondary" style=\{\{padding: '0\.3rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: '1px solid var\(--ds-border\)'\}\} title="Adjuntar evidencia">/g;

code = code.replace(iterUploadButton, (match) => {
  return `{(iter.evidences && iter.evidences.length > 0) && (
                                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginTop: '0.5rem', width: '100%'}}>
                                      {iter.evidences.map((ev, idx) => {
                                        const evId = typeof ev === 'string' ? ev : ev.id;
                                        const evName = typeof ev === 'string' ? \`evidence_\${evId}.jpg\` : (ev.filename || \`evidence_\${evId}.jpg\`);
                                        return (
                                          <div 
                                            key={idx}
                                            onClick={() => handlePreviewEvidence(ev)}
                                            style={{
                                              display: 'flex', alignItems: 'center', gap: '0.25rem', 
                                              padding: '0.25rem 0.5rem', background: 'var(--ds-background-neutral)', 
                                              borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem',
                                              border: '1px solid var(--ds-border)', color: 'var(--text-secondary)'
                                            }}
                                            title={evName}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                            <span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {evName}
                                            </span>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const newName = prompt("Nuevo nombre para la evidencia:", evName);
                                                if (newName && newName !== evName) {
                                                  handleRenameEvidence(test.id, idx, newName, iter.id);
                                                }
                                              }}
                                              title="Renombrar evidencia"
                                              style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                            >✏️</button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteEvidence(test.id, evId, idx, iter.id);
                                              }}
                                              title="Quitar evidencia"
                                              style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                            >✕</button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  ` + match;
});

// Also fix the icons in iterations
code = code.replace(/<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"><\/polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"><\/rect><\/svg>/g,
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>');

fs.writeFileSync('static/hello-world/src/App.js', code);

const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Add polling interval to useEffect
const effectTarget = `  useEffect(() => {
    if (activeTab === 'execution' && selectedCycle) {
      setLoading(true);
      invoke('getCycleExecution', { cycleId: selectedCycle.id })`;
const effectReplacement = `  useEffect(() => {
    if (activeTab === 'execution' && selectedCycle) {
      setLoading(true);
      
      const fetchExec = () => {
        invoke('getCycleExecution', { cycleId: selectedCycle.id })
          .then(async (execution) => {
            if (!execution || execution.length === 0) {
              setCycleTests([]);
              setLoading(false);
              return;
            }
            const needsBackfill = execution.filter(t => !t.description);
            if (needsBackfill.length > 0) {
              const updated = await invoke('backfillDescriptions', {
                cycleId: selectedCycle.id,
                testIds: needsBackfill.map(t => t.id)
              });
              setCycleTests(updated || execution);
            } else {
              setCycleTests(execution);
            }
            setLoading(false);
          });
      };
      
      fetchExec();
      const interval = setInterval(fetchExec, 10000); // 10-second polling
      
      return () => clearInterval(interval);
    } else if (activeTab === 'reports') {`;

// We also need to remove the old body of the useEffect
const oldEffectTarget = `  useEffect(() => {
    if (activeTab === 'execution' && selectedCycle) {
      setLoading(true);
      invoke('getCycleExecution', { cycleId: selectedCycle.id })
        .then(async (execution) => {
          if (!execution || execution.length === 0) {
            setCycleTests([]);
            setLoading(false);
            return;
          }

          // Backfill: if any test in the cycle is missing its description snapshot,
          // fetch it now from Jira and save it so the snapshot is created.
          const needsBackfill = execution.filter(t => !t.description);
          if (needsBackfill.length > 0) {
            const updated = await invoke('backfillDescriptions', {
              cycleId: selectedCycle.id,
              testIds: needsBackfill.map(t => t.id)
            });
            setCycleTests(updated || execution);
          } else {
            setCycleTests(execution);
          }
          setLoading(false);
        });
    } else if (activeTab === 'reports') {`;

if (content.includes(oldEffectTarget)) {
    content = content.replace(oldEffectTarget, effectReplacement);
    console.log("Patched polling interval");
} else {
    console.error("Could not find oldEffectTarget");
}


// 2. Fix handleDeleteEvidence to fetch fresh state and filter by attachmentId
const deleteEvTarget = `  const handleDeleteEvidence = async (testId, attachmentId, index, iterId) => {
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
  };`;

const deleteEvReplacement = `  const handleDeleteEvidence = async (testId, attachmentId, index, iterId) => {
    await invoke('deleteAttachment', { attachmentId });
    
    const freshExec = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
    const currentTest = freshExec.find(t => t.id === testId);
    if (!currentTest) return;
    
    if (iterId) {
       const iters = [...(currentTest.iterations || [])];
       const iterIdx = iters.findIndex(i => i.id === iterId);
       if (iterIdx > -1) {
          const evs = (iters[iterIdx].evidences || []).filter(e => e.id !== attachmentId && e !== attachmentId);
          iters[iterIdx] = { ...iters[iterIdx], evidences: evs };
          const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
          setCycleTests(updated);
       }
       return;
    }

    let currentEvidences = currentTest.evidences ? [...currentTest.evidences] : [];
    if (currentTest.evidence && currentEvidences.length === 0) {
      currentEvidences.push(currentTest.evidence);
    }
    currentEvidences = currentEvidences.filter(e => e.id !== attachmentId && e !== attachmentId);
    const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
    setCycleTests(updated);
  };`;

if (content.includes(deleteEvTarget)) {
    content = content.replace(deleteEvTarget, deleteEvReplacement);
    console.log("Patched handleDeleteEvidence");
} else {
    console.error("Could not find deleteEvTarget");
}


// 3. Fix handleUploadEvidence to fetch fresh state
const uploadEvTarget = `         const currentTest = cycleTests.find(t => t.id === testId);
         const currentEvidences = currentTest?.evidences ? [...currentTest.evidences] : [];
         if (currentTest?.evidence && currentEvidences.length === 0) {
             currentEvidences.push(currentTest.evidence);
         }
         currentEvidences.push(newEvidence);
         
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
         }`;

const uploadEvReplacement = `         const freshExec = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
         const currentTest = freshExec.find(t => t.id === testId);
         const currentEvidences = currentTest?.evidences ? [...currentTest.evidences] : [];
         if (currentTest?.evidence && currentEvidences.length === 0) {
             currentEvidences.push(currentTest.evidence);
         }
         currentEvidences.push(newEvidence);
         
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
         }`;

if (content.includes(uploadEvTarget)) {
    content = content.replace(uploadEvTarget, uploadEvReplacement);
    console.log("Patched handleUploadEvidence");
} else {
    console.error("Could not find uploadEvTarget");
}


// 4. Fix handleIterationChange to fetch fresh state before saving iterations array
const iterChangeTarget = `  const handleIterationChange = async (test, iterId, field, value) => {
    const currentIters = [...(test.iterations || [])];
    const idx = currentIters.findIndex(i => i.id === iterId);
    if (idx > -1) {
      currentIters[idx] = { ...currentIters[idx], [field]: value };
      
      // Update UI optimistically
      setCycleTests(cycleTests.map(t => t.id === test.id ? { ...t, iterations: currentIters } : t));
      
      const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: currentIters });
      setCycleTests(execution || []);
    }
  };`;

const iterChangeReplacement = `  const handleIterationChange = async (test, iterId, field, value) => {
    // Update UI optimistically using old state for responsiveness
    const optimisticIters = [...(test.iterations || [])];
    const optIdx = optimisticIters.findIndex(i => i.id === iterId);
    if (optIdx > -1) {
      optimisticIters[optIdx] = { ...optimisticIters[optIdx], [field]: value };
      setCycleTests(cycleTests.map(t => t.id === test.id ? { ...t, iterations: optimisticIters } : t));
    }
    
    // Fetch fresh state to prevent overwriting evidence
    const freshExec = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
    const currentTest = freshExec.find(t => t.id === test.id);
    if (!currentTest) return;
    
    const currentIters = [...(currentTest.iterations || [])];
    const idx = currentIters.findIndex(i => i.id === iterId);
    if (idx > -1) {
      currentIters[idx] = { ...currentIters[idx], [field]: value };
      const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: currentIters });
      setCycleTests(execution || []);
    }
  };`;

if (content.includes(iterChangeTarget)) {
    content = content.replace(iterChangeTarget, iterChangeReplacement);
    console.log("Patched handleIterationChange");
} else {
    console.error("Could not find iterChangeTarget");
}

fs.writeFileSync(path, content);
console.log("Done patching race conditions!");

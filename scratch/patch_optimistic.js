const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const targetBulk = `                      const finalExecution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
                      setCycleTests(finalExecution || []);
                      setSelectedTestsForCycle([]); // clear selection after adding
                    } catch(err) {
                      console.error(err);
                      alert("Error al añadir casos: " + err.message);
                    }
                    setIsAddingAll(false);`;

const replacementBulk = `                      // Optimistic UI update
                      const locallyAdded = testsToAdd.map(tc => ({
                         id: tc.id,
                         key: tc.key,
                         summary: tc.summary,
                         status: 'Not Run'
                      }));
                      
                      setCycleTests(prev => {
                         const newArr = [...prev];
                         locallyAdded.forEach(lt => {
                             if (!newArr.some(existing => existing.id === lt.id)) {
                                 newArr.push(lt);
                             }
                         });
                         return newArr;
                      });
                      
                      setSelectedTestsForCycle([]); // clear selection after adding
                      
                      // Fetch background after a delay to ensure replication
                      setTimeout(async () => {
                          const finalExecution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
                          if (finalExecution) setCycleTests(finalExecution);
                      }, 3000);
                      
                    } catch(err) {
                      console.error(err);
                      alert("Error al añadir casos: " + err.message);
                    }
                    setIsAddingAll(false);`;

if (content.includes(targetBulk)) {
    content = content.replace(targetBulk, replacementBulk);
    console.log("Patched optimistic UI for bulk add");
}

const targetSingle = `  const handleAddTestToCycle = async (testCase) => {
    if (!selectedCycle) return;
    await invoke('addTestToCycle', { cycleId: selectedCycle.id, testCase });
    const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
    setCycleTests(execution || []);
  };`;

const replacementSingle = `  const handleAddTestToCycle = async (testCase) => {
    if (!selectedCycle) return;
    
    // Optimistic UI
    const locallyAdded = {
        id: testCase.id,
        key: testCase.key,
        summary: testCase.summary,
        status: 'Not Run'
    };
    setCycleTests(prev => {
        if (!prev.some(existing => existing.id === locallyAdded.id)) {
            return [...prev, locallyAdded];
        }
        return prev;
    });
    
    try {
        await invoke('addTestToCycle', { cycleId: selectedCycle.id, testCase });
        setTimeout(async () => {
            const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
            if (execution) setCycleTests(execution);
        }, 3000);
    } catch(err) {
        console.error(err);
        alert("Error al añadir caso: " + err.message);
        // revert optimistic on error by reloading
        const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
        setCycleTests(execution || []);
    }
  };`;

if (content.includes(targetSingle)) {
    content = content.replace(targetSingle, replacementSingle);
    console.log("Patched optimistic UI for single add");
}

fs.writeFileSync(path, content);

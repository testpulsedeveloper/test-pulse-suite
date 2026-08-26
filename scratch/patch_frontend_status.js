const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Fix handleCycleSelect
const cycleSelectTarget = "    safeSetCycleTests([]); // clear old tests immediately\\n    setSelectedCycle(cycle);";
content = content.replace("    safeSetCycleTests([]); // clear old tests immediately\n    setSelectedCycle(cycle);", "    setCycleTests([]); // clear old tests immediately\n    setSelectedCycle(cycle);");

// 2. Consume historical status in addTestToCycle
const singleAddTarget = `        await invoke('addTestToCycle', { cycleId: selectedCycle.id, testCase });
        setTimeout(async () => {
            const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });`;

const singleAddReplace = `        const addRes = await invoke('addTestToCycle', { cycleId: selectedCycle.id, testCase });
        if (addRes && addRes.addedTest && addRes.addedTest._historicalData) {
            setCycleTests(prev => prev.map(t => t.id === testCase.id ? { ...t, ...addRes.addedTest._historicalData } : t));
        }
        setTimeout(async () => {
            const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });`;
content = content.replace(singleAddTarget, singleAddReplace);

// 3. Consume historical status in addBulkTestsToCycle
const bulkAddTarget = `                      await invoke('addMultipleTestsToCycle', { cycleId: selectedCycle.id, testCases: selectedTestsForCycle });
                      
                      setCycleTests(prev => {`;

const bulkAddReplace = `                      const bulkRes = await invoke('addMultipleTestsToCycle', { cycleId: selectedCycle.id, testCases: selectedTestsForCycle });
                      
                      setCycleTests(prev => {`;
                      
content = content.replace(bulkAddTarget, bulkAddReplace);

const bulkMergeTarget = `                         locallyAdded.forEach(lt => {
                             if (!newArr.some(existing => existing.id === lt.id)) {
                                 newArr.push(lt);
                             }
                         });
                         return newArr;`;
                         
const bulkMergeReplace = `                         locallyAdded.forEach(lt => {
                             let finalItem = lt;
                             // Use historical data if backend returned it!
                             if (bulkRes && bulkRes.addedTests) {
                                 const matched = bulkRes.addedTests.find(t => t.id === lt.id);
                                 if (matched && matched._historicalData) {
                                     finalItem = { ...lt, ...matched._historicalData };
                                 }
                             }
                             
                             if (!newArr.some(existing => existing.id === lt.id)) {
                                 newArr.push(finalItem);
                             }
                         });
                         return newArr;`;

content = content.replace(bulkMergeTarget, bulkMergeReplace);

content = content.replace(/v1\.4\.6/g, 'v1.4.7');

fs.writeFileSync(path, content);
console.log("Patched App.js to consume historical statuses and fix cycle clear");

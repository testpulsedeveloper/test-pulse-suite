const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// Fix the bulkAdd loop to accumulate results and not crash
const bulkAddCrashTarget = `                      for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                          const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                          await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: chunk });
                      }
                      
                      const locallyAdded = testsToAdd.map(tc => ({`;

const bulkAddCrashReplace = `                      let allAddedTests = [];
                      for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                          const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                          const bRes = await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: chunk });
                          if (bRes && bRes.addedTests) {
                              allAddedTests = allAddedTests.concat(bRes.addedTests);
                          }
                      }
                      
                      const locallyAdded = testsToAdd.map(tc => ({`;

content = content.replace(bulkAddCrashTarget, bulkAddCrashReplace);

// Fix the merge logic to use allAddedTests instead of undefined bulkRes
const bulkMergeTarget = `                             // Use historical data if backend returned it!
                             if (bulkRes && bulkRes.addedTests) {
                                 const matched = bulkRes.addedTests.find(t => t.id === lt.id);
                                 if (matched && matched._historicalData) {
                                     finalItem = { ...lt, ...matched._historicalData };
                                 }
                             }`;

const bulkMergeReplace = `                             // Use historical data if backend returned it!
                             if (allAddedTests && allAddedTests.length > 0) {
                                 const matched = allAddedTests.find(t => t.id === lt.id);
                                 if (matched && matched._historicalData) {
                                     finalItem = { ...lt, ...matched._historicalData };
                                 }
                             }`;

content = content.replace(bulkMergeTarget, bulkMergeReplace);

content = content.replace(/v1\.4\.7/g, 'v1.4.8');

fs.writeFileSync(path, content);
console.log("Patched React crash in bulk add");

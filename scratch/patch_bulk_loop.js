const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `                      for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                          const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                          await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: chunk });
                      }
                      
                      // Optimistic UI update`;
                      
const replace = `                      let allAddedTests = [];
                      for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                          const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                          const bRes = await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: chunk });
                          if (bRes && bRes.addedTests) {
                              allAddedTests = allAddedTests.concat(bRes.addedTests);
                          }
                      }
                      
                      // Optimistic UI update`;

content = content.replace(target, replace);
content = content.replace(/v1\.4\.8/g, 'v1.4.9');
fs.writeFileSync(path, content);
console.log("Patched loop");

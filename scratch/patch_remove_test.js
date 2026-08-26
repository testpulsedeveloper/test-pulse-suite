const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `resolver.define('removeTestFromCycle', async ({ payload }) => {
  const { cycleId, testId } = payload;
  let executionData = await getExecutionData(cycleId);
  
  const updatedData = executionData.filter(t => t.id !== testId);
  const testIds = updatedData.map(t => t.id);`;

const replacement = `resolver.define('removeTestFromCycle', async ({ payload }) => {
  const { cycleId, testId } = payload;
  let executionData = await getExecutionData(cycleId);
  
  const updatedData = executionData.filter(t => String(t.id) !== String(testId));
  const testIds = updatedData.map(t => t.id);`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched removeTestFromCycle strict equality");
}

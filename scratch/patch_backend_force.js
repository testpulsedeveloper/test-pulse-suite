const fs = require('fs');
let indexJs = fs.readFileSync('src/index.js', 'utf8');

const replacement = `resolver.define('backfillDescriptions', async ({ payload }) => {
  const { cycleId, testIds, force } = payload;`;

indexJs = indexJs.replace(`resolver.define('backfillDescriptions', async ({ payload }) => {\n  const { cycleId, testIds } = payload;`, replacement);

const forceReplacement = `       if (descMap[t.id] !== undefined || force) {
           const updated = { 
               ...t, 
               description: descMap[t.id] !== undefined ? descMap[t.id] : t.description, 
               expectedResult: renderedFieldsMap[t.id]?.environment || rawFieldsMap[t.id]?.environment || t.expectedResult || ''
           };`;
indexJs = indexJs.replace(`       if (descMap[t.id] !== undefined) {\n           const updated = { \n               ...t, \n               description: descMap[t.id], \n               expectedResult: renderedFieldsMap[t.id]?.environment || rawFieldsMap[t.id]?.environment || ''\n           };`, forceReplacement);

fs.writeFileSync('src/index.js', indexJs);
console.log("Patched backend force backfill");

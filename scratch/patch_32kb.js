const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const targetBulk = `      const newTest = {
        id: tc.id,
        key: tc.key,
        summary: tc.summary,
        description: tc.description,
        status: 'Not Run',
        rawFields: tc.rawFields,
        renderedFields: tc.renderedFields
      };`;

const replacementBulk = `      const newTest = {
        id: tc.id,
        key: tc.key,
        summary: tc.summary,
        description: tc.description,
        status: 'Not Run'
      };`;

if (content.includes(targetBulk)) {
    content = content.replace(targetBulk, replacementBulk);
}

const targetMultiple = `      newTests.push({
        id: testCase.id,
        key: testCase.key,
        summary: testCase.summary,
        description: testCase.description,
        status: 'Not Run',
        rawFields: testCase.rawFields,
        renderedFields: testCase.renderedFields
      });`;

const replacementMultiple = `      newTests.push({
        id: testCase.id,
        key: testCase.key,
        summary: testCase.summary,
        description: testCase.description,
        status: 'Not Run'
      });`;

if (content.includes(targetMultiple)) {
    content = content.replace(targetMultiple, replacementMultiple);
}

const targetSingle = `  const newTest = {
    id: testCase.id,
    key: testCase.key,
    summary: testCase.summary,
    description: testCase.description,
    status: 'Not Run',
    rawFields: testCase.rawFields,
    renderedFields: testCase.renderedFields
  };`;

const replacementSingle = `  const newTest = {
    id: testCase.id,
    key: testCase.key,
    summary: testCase.summary,
    description: testCase.description,
    status: 'Not Run'
  };`;

if (content.includes(targetSingle)) {
    content = content.replace(targetSingle, replacementSingle);
}

const targetUpdate = `       if (descMap[t.id] !== undefined) {
           const updated = { ...t, description: descMap[t.id], rawFields: rawFieldsMap[t.id], renderedFields: renderedFieldsMap[t.id] };`;

const replacementUpdate = `       if (descMap[t.id] !== undefined) {
           const updated = { ...t, description: descMap[t.id] };`;

if (content.includes(targetUpdate)) {
    content = content.replace(targetUpdate, replacementUpdate);
}

fs.writeFileSync(path, content);
console.log("Patched endpoints to stop saving rawFields and renderedFields");

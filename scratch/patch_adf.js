const fs = require('fs');

const adfParserCode = `
function textToAdf(text) {
  if (!text) return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] };
  const lines = text.split('\\n');
  const content = [];
  
  let currentTable = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (currentTable) { content.push(currentTable); currentTable = null; }
      continue;
    }

    if (line.startsWith('||') && line.endsWith('||')) {
      if (!currentTable) {
        currentTable = { type: 'table', attrs: { isNumberColumnEnabled: false, layout: "default" }, content: [] };
      }
      const cells = line.split('||').filter(Boolean).map(cell => ({
        type: 'tableHeader',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: cell.trim() }] }]
      }));
      currentTable.content.push({ type: 'tableRow', content: cells });
    } else if (line.startsWith('|') && line.endsWith('|')) {
      if (!currentTable) {
        currentTable = { type: 'table', attrs: { isNumberColumnEnabled: false, layout: "default" }, content: [] };
      }
      const cells = line.split('|').filter(Boolean).map(cell => ({
        type: 'tableCell',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: cell.trim() }] }]
      }));
      currentTable.content.push({ type: 'tableRow', content: cells });
    } else {
      if (currentTable) { content.push(currentTable); currentTable = null; }
      
      const match = line.match(/^([^:]+):(.*)$/);
      if (match) {
        const strongText = match[1] + ':';
        const restText = match[2];
        const paraContent = [
          { type: 'text', text: strongText, marks: [{ type: 'strong' }] }
        ];
        if (restText) {
          paraContent.push({ type: 'text', text: restText });
        }
        content.push({ type: 'paragraph', content: paraContent });
      } else {
        content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: line }]
        });
      }
    }
  }
  if (currentTable) content.push(currentTable);

  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: ' ' }] });
  }

  return { type: 'doc', version: 1, content };
}
`;

let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// Insert textToAdf function near the top (e.g. after imports)
const importRegex = /import\s+.*?;\s*\n(?!import)/m;
appContent = appContent.replace(importRegex, match => match + '\n' + adfParserCode + '\n');

// Replace the old description logic
const oldDescRegex = /if \(descText\) \{\s*fields\.description = \{\s*type: 'doc', version: 1,\s*content: \[\{ type: 'paragraph', content: \[\{ type: 'text', text: descText \}\] \}\]\s*\};\s*\}/m;
const newDescLogic = `if (descText) {
          fields.description = textToAdf(descText);
        }`;
appContent = appContent.replace(oldDescRegex, newDescLogic);

fs.writeFileSync('static/hello-world/src/App.js', appContent);
console.log('ADF Parser injected successfully!');

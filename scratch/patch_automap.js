const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `    reader.onload = (ev) => {
      const { headers, rows } = parseCSV(ev.target.result);
      setBulkHeaders(headers);
      setBulkPreview(rows);
      setBulkStatus(rows.length === 0 ? 'error' : 'idle');
    };`;

const replacement = `    reader.onload = (ev) => {
      const { headers, rows } = parseCSV(ev.target.result);
      setBulkHeaders(headers);
      setBulkPreview(rows);
      setBulkStatus(rows.length === 0 ? 'error' : 'idle');
      
      // Auto-mapeo inteligente por nombre exacto
      const autoMap = {};
      headers.forEach(h => {
          const lower = h.toLowerCase().trim();
          if (lower.includes('resumen') || lower === 'summary') autoMap[h] = 'summary';
          else if (lower.includes('descripci') || lower === 'description') autoMap[h] = 'description';
          else if (lower.includes('prioridad') || lower === 'priority') autoMap[h] = 'priority';
          else {
              // Buscar en jiraFields por nombre exacto (ignorando mayusculas)
              const match = jiraFields.find(jf => jf.name.toLowerCase() === lower);
              if (match) {
                 autoMap[h] = match.id;
              }
          }
      });
      // Mezclar autoMap con el estado actual (priorizando lo que ya existía, pero llenando los vacíos)
      setBulkFieldMapping(prev => ({ ...autoMap, ...prev }));
    };`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched App.js with autoMap");
} else {
    console.error("Could not find target for autoMap");
}

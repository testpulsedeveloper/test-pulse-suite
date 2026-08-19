// Basic ADF Parser
function textToAdf(text) {
  const lines = text.split('\n');
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
      
      // Let's check if it's a heading (e.g. "Pre-conditions:")
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

const sample = `Summary (Título): LOGIN | Acceso exitoso al sistema con credenciales válidas.
Component: Seguridad / Autenticación
Priority: High

Pre-conditions:
Terminal POS (Fijo o Móvil) con conectividad a red.

Test Steps:
||#||Acción (Paso)||Datos de Prueba||Resultado Esperado||
|1|Iniciar sesión.|N/A|El usuario se encuentra logueado.|
|2|Dejar la terminal.|N/A|Cierre automático.|
`;

console.log(JSON.stringify(textToAdf(sample), null, 2));

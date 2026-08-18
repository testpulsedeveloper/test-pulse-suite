const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// Fix ALL summary fallbacks
code = code.replace(/<span className="test-summary">\{test\.summary\}<\/span>/g, 
  '<span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>');

// Fix DEFECTOS (BUGS) -> DEFECTOS
code = code.replace(/DEFECTOS \(BUGS\)/g, 'DEFECTOS');

// Fix Enviar reporte de Estatus (Reports tab)
// The user says "No hace nada, no copia al portapapeles ni abre el mail de gmail".
// So we must open the gmail compose window!
// mailto:?subject=Reporte de Estatus&body=... or open a url?
// The user says "abre el mail de gmail".
// Let's modify handleCopyReportToClipboard to ALSO open Gmail.
const handleCopyRegex = /const handleCopyReportToClipboard = \(\) => \{[\s\S]*?document\.body\.removeChild\(tempDiv\);\n\s*\}\n\s*alert\('Plantilla copiada al portapapeles\.'\);\n\s*\};/;

const handleCopyReplacement = `const handleCopyReportToClipboard = () => {
    const tableHtml = \`
      <table border="1" style="border-collapse: collapse; width: 100%; font-family: sans-serif;">
        <thead style="background-color: #f4f5f7;">
          <tr>
            <th>ID del Bug</th>
            <th>Descripción</th>
            <th>Severidad</th>
            <th>Responsable</th>
            <th>Resolución</th>
            <th>Estado</th>
            <th>Caso Asociado</th>
          </tr>
        </thead>
        <tbody>
          \${reportData.bugs.map(bug => \`
            <tr>
              <td>\${bug.key}</td>
              <td>\${bug.summary}</td>
              <td>\${bug.severity || 'N/A'}</td>
              <td>\${bug.assignee || 'Unassigned'}</td>
              <td>\${bug.resolution || 'Unresolved'}</td>
              <td>\${bug.status}</td>
              <td>\${bug.testKeys ? bug.testKeys.join(', ') : 'N/A'}</td>
            </tr>
          \`).join('')}
        </tbody>
      </table>
    \`;

    const tempDiv = document.createElement('div');
    tempDiv.contentEditable = true;
    tempDiv.innerHTML = tableHtml;
    document.body.appendChild(tempDiv);
    
    const range = document.createRange();
    range.selectNodeContents(tempDiv);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    
    try {
      document.execCommand('copy');
      alert('Plantilla copiada al portapapeles. Abriendo Gmail...');
      window.open('https://mail.google.com/mail/?view=cm&fs=1&su=Reporte+de+Estatus', '_blank');
    } catch (err) {
      console.error('Failed to copy', err);
      alert('Error al copiar la plantilla.');
    } finally {
      document.body.removeChild(tempDiv);
    }
  };`;

code = code.replace(handleCopyRegex, handleCopyReplacement);

fs.writeFileSync('static/hello-world/src/App.js', code);

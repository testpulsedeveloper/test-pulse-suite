const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

let target = `    const htmlTemplate = \`
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Resumen de Pruebas: \${reportSelectedCycle ? filteredCycles[0]?.summary : 'Todos los ciclos'}</h2>
        <p>A continuación se presenta el resumen ejecutivo de la ejecución de pruebas.</p>
        
        <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
          <tr style="background-color: #f4f5f7;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Total Casos</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left; color: #22A06B;">Pasados</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left; color: #E34935;">Fallados</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Defectos</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Cobertura</th>
          </tr>
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">\${allTotal}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${passed}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${failed}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${totalBugs} (Cerrados: \${closedBugs})</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${coverageRate}%</td>
          </tr>
        </table>
        
        <h3>Detalle de Defectos Reportados</h3>
        \${totalBugs > 0 ? \`
        <table style="border-collapse: collapse; width: 100%;">
          <tr style="background-color: #f4f5f7;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Id del bug</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Descripción</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Severidad</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Estado</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Responsable</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Resolución</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Link al caso</th>
          </tr>
          \${tableRows}
        </table>
        \` : '<p>No se encontraron defectos en este ciclo.</p>'}
      </div>
    \`;`;

let replacement = `    const htmlTemplate = \`
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Resumen de Pruebas: \${reportSelectedCycle ? filteredCycles[0]?.summary : 'Todos los ciclos'}</h2>
        <p>A continuación se presenta el resumen ejecutivo de la ejecución de pruebas:</p>
        
        <ul style="list-style-type: none; padding-left: 0; line-height: 1.8;">
          <li>📋 <strong>Total de Casos:</strong> \${allTotal}</li>
          <li>🟢 <strong>Pasados:</strong> \${passed} <em>(\${pPct.toFixed(1)}%)</em></li>
          <li>🔴 <strong>Fallados:</strong> \${failed} <em>(\${fPct.toFixed(1)}%)</em></li>
          <li>🟡 <strong>Bloqueados:</strong> \${blocked} <em>(\${bPct.toFixed(1)}%)</em></li>
          <li>🔵 <strong>No Ejecutados:</strong> \${notRun} <em>(\${nPct.toFixed(1)}%)</em></li>
          <li>🎯 <strong>Cobertura de Ejecución:</strong> \${coverageRate}%</li>
          <li>🐞 <strong>Defectos Reportados:</strong> \${totalBugs} <em>(Cerrados: \${closedBugs})</em></li>
        </ul>
        
        <h3 style="margin-top: 20px;">Detalle de Defectos Reportados</h3>
        \${totalBugs > 0 ? \`
        <table style="border-collapse: collapse; width: 100%;">
          <tr style="background-color: #f4f5f7;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Id del bug</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Descripción</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Severidad</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Estado</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Responsable</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Resolución</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Link al caso</th>
          </tr>
          \${tableRows}
        </table>
        \` : '<p>No se encontraron defectos en este ciclo.</p>'}

        <h3 style="margin-top: 20px;">Riesgos o Bloqueos</h3>
        <ul>
          <li>[Ingresa aquí cualquier riesgo identificado...]</li>
        </ul>

        <h3 style="margin-top: 20px;">Siguientes Pasos</h3>
        <ul>
          <li>[Ingresa aquí las siguientes acciones...]</li>
        </ul>
      </div>
    \`;`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('static/hello-world/src/App.js', code);
    console.log("Success");
} else {
    console.log("Not found");
}

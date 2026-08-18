const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// 1. Fix closedBugs calculation
const oldClosed = "if (bug.status && ['Done', 'Closed', 'Resolved'].includes(bug.status)) closedBugs++;";
const newClosed = "const s = (bug.status || '').toLowerCase(); if (['done', 'closed', 'resolved', 'cerrada', 'cerrado', 'resuelta', 'resuelto', 'terminado'].includes(s)) closedBugs++;";
code = code.replace(oldClosed, newClosed);

// 2. Add links to clipboard report
// Find handleCopyReportToClipboard
const oldHandle = `const handleCopyReportToClipboard = () => {`;
const newHandle = `const handleCopyReportToClipboard = async () => {
    const context = await view.getContext();
    const baseUrl = context.siteUrl;`;
code = code.replace(oldHandle, newHandle);

const oldTableRow = `                <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.key}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.summary || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.severity || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.status || 'Desconocido'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.assignee || 'Sin asignar'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.resolution || 'Unresolved'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${ex.key}</td>
                </tr>`;

const newTableRow = `                <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;"><a href="\${baseUrl}/browse/\${bug.key}">\${bug.key}</a></td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.summary || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.severity || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.status || 'Desconocido'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.assignee || 'Sin asignar'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.resolution || 'Unresolved'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;"><a href="\${baseUrl}/browse/\${ex.key}">\${ex.key}</a></td>
                </tr>`;
code = code.replace(oldTableRow, newTableRow);

fs.writeFileSync('static/hello-world/src/App.js', code);

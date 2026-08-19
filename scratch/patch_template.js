const fs = require('fs');

const csvContent = fs.readFileSync('scratch/template.csv', 'utf8');

const replacement = `  const handleDownloadTemplate = () => {
    const csvContent = "\\uFEFF" + \`${csvContent.replace(/`/g, '\\`')}\`;
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'TestPulse_Plantilla_Carga_Masiva.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };`;

let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');
const regex = /const handleDownloadTemplate = \(\) => \{[\s\S]*?\}\;/m;

if (appContent.match(regex)) {
  appContent = appContent.replace(regex, replacement);
  fs.writeFileSync('static/hello-world/src/App.js', appContent);
  console.log('App.js patched successfully!');
} else {
  console.log('Regex did not match.');
}

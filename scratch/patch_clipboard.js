const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  const handleCopyReportToClipboard = async () => {
    const context = await view.getContext();
    const baseUrl = context.siteUrl;
    let tableRows = '';`;
    
const replace = `  const handleCopyReportToClipboard = () => {
    try {
      const baseUrl = context?.siteUrl || '';
      let tableRows = '';`;

const targetEnd = `    try {
      const el = document.createElement('div');
      el.innerHTML = htmlTemplate;
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      
      document.execCommand('copy');
      
      selection.removeAllRanges();
      document.body.removeChild(el);

      const subject = encodeURIComponent(\`Resumen de Pruebas: \${reportSelectedCycle ? filteredCycles[0]?.summary : 'Todos los ciclos'}\`);
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      alert(\`Plantilla copiada al portapapeles. Usa \${isMac ? 'Cmd + V' : 'Ctrl + V'} en el correo para pegar la tabla. Abriendo Gmail...\`);
      router.open(\`https://mail.google.com/mail/?view=cm&fs=1&su=\${subject}\`);
    } catch(err) {
      console.error('Error al copiar:', err);
      alert("Hubo un error al copiar la plantilla.");
    }
  };`;
  
const replaceEnd = `      const el = document.createElement('div');
      el.innerHTML = htmlTemplate;
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      
      const success = document.execCommand('copy');
      
      selection.removeAllRanges();
      document.body.removeChild(el);
      
      if (!success) {
         console.warn("execCommand returned false, possible permission issue.");
      }

      const subject = encodeURIComponent(\`Resumen de Pruebas: \${reportSelectedCycle ? filteredCycles[0]?.summary : 'Todos los ciclos'}\`);
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      alert(\`Plantilla copiada al portapapeles. Usa \${isMac ? 'Cmd + V' : 'Ctrl + V'} en el correo para pegar la tabla. Abriendo Gmail...\`);
      router.open(\`https://mail.google.com/mail/?view=cm&fs=1&su=\${subject}\`);
    } catch(err) {
      console.error('Error al copiar:', err);
      alert("Error crítico al exportar reporte: " + err.message);
    }
  };`;

content = content.replace(target, replace);
content = content.replace(targetEnd, replaceEnd);
fs.writeFileSync(path, content);
console.log("Patched clipboard");

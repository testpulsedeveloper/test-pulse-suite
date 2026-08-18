const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const regex = /document\.execCommand\('copy'\);\n\s*alert\('Plantilla copiada al portapapeles. Abriendo Gmail\.\.\.'\);/;
const replacement = `try {
        navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlTemplate], { type: 'text/html' }),
            'text/plain': new Blob([htmlTemplate.replace(/<[^>]+>/g, '')], { type: 'text/plain' })
          })
        ]);
      } catch (err) {
        document.execCommand('copy');
      }
      alert('Plantilla copiada al portapapeles. Abriendo Gmail...');`;

code = code.replace(regex, replacement);

fs.writeFileSync('static/hello-world/src/App.js', code);

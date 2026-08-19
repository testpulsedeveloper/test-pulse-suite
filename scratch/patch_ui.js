const fs = require('fs');
let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// Replace the downloadTemplate logic and insert downloadManual
const newFunctions = `  const downloadTemplate = () => {
    const csvContent = \`Summary,Gherkin Scenario / Test Steps (description),Link (is tested by),Nivel de Prueba,Tipo de Prueba,Tipo de Ejecución
LOGINING**** | Acceso exitoso al sistema con credenciales válidas.,"Summary (Título): LOGIN | Acceso exitoso al sistema con credenciales válidas.
Component: Seguridad / Autenticación
Priority: High

Nivel de Ejecución: ITERATIVO (Data-Driven)
Este caso se ejecuta N veces sustituyendo las variables [ID_Usuario] y [Password] con los valores del Dataset. Cada iteración valida un perfil distinto (Cajero, Vendedor, Jefe).

Pre-conditions:

Terminal POS (Fijo o Móvil) con conectividad a red.
Usuario activo en base de datos con permisos de Cajero/Vendedor/Jefe.
Test Type: BDD (Gherkin)
Test Script:

Given que el POS muestra la pantalla de ingreso de credenciales.
When el usuario ingresa un [ID_Usuario] y [Password] correctos.
Then el sistema valida la identidad contra el servidor.
And redirige al usuario al menú principal de operaciones.
Dataset (Iteraciones):",,Integración SIT,Funcional ,Manual
LOGOUT**** | Cierre de sesión por reglas de sistema (Timeout).,"Summary (Título): LOGOUT | Cierre de sesión por reglas de sistema (Timeout).
Component: Seguridad / Sesión
Priority: Medium

Nivel de Ejecución: SECUENCIAL (Paso a Paso)
Este caso se ejecuta una sola vez validando el comportamiento automático del sistema. No requiere dataset ni iteraciones.

Pre-conditions:

Sesión activa en el POS.
Parámetro de inactividad configurado en el BackOffice (Ej. 300 segundos / 5 minutos).

Test Steps:

||#||Acción (Paso)||Datos de Prueba||Resultado Esperado||
|1|Iniciar sesión exitosamente en el POS y acceder al menú principal.|N/A|El usuario se encuentra logueado y el cronómetro interno de inactividad comienza a correr.|
|2|Dejar la terminal POS sin ninguna interacción física ni lógica durante el tiempo configurado (Ej. 5 minutos).|N/A|El sistema detecta la inactividad y ejecuta el cierre automático de la sesión.|",,UAT,Regresión,Automatizado\`;
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'TestPulse_Plantilla.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadManual = () => {
    const manualContent = \`# Manual de Usuario: Test Pulse
Bienvenido a Test Pulse.

1. Descarga la plantilla CSV utilizando el botón 'Plantilla CSV'.
2. Llena los datos respetando las columnas.
3. Asegúrate de guardar el archivo como 'CSV UTF-8 (delimitado por comas)'.
4. Sube el archivo y mapea las columnas.
5. Haz clic en 'Subir N casos'.\`;
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), manualContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Manual_Usuario.md');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };\n`;

appContent = appContent.replace(/const downloadTemplate = \(\) => \{[\s\S]*?document\.body\.removeChild\(link\);\s*\};/, newFunctions);

// Replace button HTML
const oldBtnRegex = /<button[\s\n]*onClick=\{downloadTemplate\}[\s\S]*?Descargar Plantilla CSV\s*<\/button>/m;
const newBtnHtml = `<div style={{display: 'flex', gap: '15px'}}>
              <button
                onClick={downloadTemplate}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', fontSize: '0.9rem'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Plantilla CSV
              </button>
              <button
                onClick={downloadManual}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: '#6B778C', cursor: 'pointer', fontSize: '0.9rem'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                </svg>
                Manual de Usuario
              </button>
            </div>`;

if (appContent.match(oldBtnRegex)) {
  appContent = appContent.replace(oldBtnRegex, newBtnHtml);
  fs.writeFileSync('static/hello-world/src/App.js', appContent);
  console.log("Replaced UI successfully");
} else {
  console.log("Could not find button to replace!");
}

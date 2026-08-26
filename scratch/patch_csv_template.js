const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `    const csvContent = "\\uFEFF" + \`Summary,Gherkin Scenario / Test Steps (description),Link (is tested by),Nivel de Prueba,Tipo de Prueba,Tipo de Ejecución
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
|2|Dejar la terminal POS sin ninguna interacción física ni lógica durante el tiempo configurado (Ej. 5 minutos).|N/A|El sistema detecta la inactividad y ejecuta el cierre automático de la sesión.|",,UAT,Regresión,Automatizado
\`;`;

const replacement = `    const csvContent = "\\uFEFF" + \`Summary,Gherkin Scenario / Test Steps (description),Link (is tested by),Nivel de Prueba,Tipo de Prueba,Tipo de Ejecución,Prioridad
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
Dataset (Iteraciones):",,Integración SIT,Funcional ,Manual,Alta
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
|2|Dejar la terminal POS sin ninguna interacción física ni lógica durante el tiempo configurado (Ej. 5 minutos).|N/A|El sistema detecta la inactividad y ejecuta el cierre automático de la sesión.|",,UAT,Regresión,Automatizado,Media
\`;`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched csv template!");
} else {
    console.error("Could not find target!");
}

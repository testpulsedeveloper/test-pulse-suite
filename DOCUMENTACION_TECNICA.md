# Documentación Técnica: Jira Test Management (Test Pulse)

Este documento sirve como respaldo textual y guía arquitectónica sobre cómo está construida la aplicación, cómo se extrae la información y cómo se presenta. El objetivo es proporcionar un mapa claro de las lógicas fundamentales en caso de que se necesite reconstruir, depurar o expandir la aplicación en el futuro.

## 1. Arquitectura de Almacenamiento y Solución de Límites (Backend)
La aplicación está construida sobre **Jira Forge**. Debido a las limitaciones de esta plataforma, el almacenamiento de datos personalizados se realiza utilizando las **Entity Properties** de los issues de Jira.

* **El Límite de los 32KB:** Inicialmente, guardar todo un ciclo de pruebas en una sola propiedad de Jira causaba errores porque se superaba rápidamente el límite de 32KB para las propiedades de entidades.
* **La Solución Implementada:** Cambiamos la estructura para que **cada ejecución de caso de prueba se guarde en una Entity Property separada** (por ejemplo, `testops-execution-{testId}`). El ciclo solo guarda las referencias básicas. Esto permite escalar sin problemas.
* **Evidencias e Imágenes:** Para no consumir cuota en las propiedades de entidad, los archivos y capturas de pantalla se suben directamente como **Adjuntos Nativos de Jira (Attachments)** al issue correspondiente del ciclo.

## 2. Lógica de Extracción de Datos (Backend - `src/index.js`)

La aplicación no posee una base de datos propia; Jira es la única fuente de la verdad.

### Extracción de Ciclos y Casos de Prueba
* Se utiliza una consulta de **JQL** (Jira Query Language) para buscar todos los issues que pertenezcan al tipo configurado (Ej: "Test Cycle").
* La función `getExecutionReport` consolida todos estos ciclos para generar métricas.

### Recuperación en Tiempo Real de Defectos (Bugs)
* Durante la ejecución, cuando un tester asocia un defecto (Bug), la app solo guarda el identificador (Ej: `PVAS-303`) en el arreglo `linkedBugs`.
* **Proceso de hidratación (Hydration):** Para evitar mostrar "N/A" o información desactualizada, al abrir la pestaña de "Reportes", el backend intercepta todas las "Keys" de los bugs del ciclo. Se hace un llamado en paralelo usando `api.asUser().requestJira` solicitando los campos clave.
* **Mapeo de Campos del Defecto:**
  * `summary` -> Descripción
  * `status.name` -> Estado
  * `assignee.displayName` -> Responsable (Fallback: "Sin asignar")
  * `resolution.name` -> Resolución (Fallback: "Unresolved")
  * `customfield_10004` o `priority.name` -> Severidad (Si no existe el campo personalizado, recae en la prioridad del issue).

## 3. Lógica de Presentación e Interfaz (Frontend - `App.js`)

El frontend está desarrollado en React y divide la operación en 5 pestañas principales: Design, Planning, Execution, Reports, y Config.

### Reglas de Negocio en la UI (Execution Tab)
* **Permisos y Control de Ejecución:** Los controles para cambiar el estado (Passed, Failed, Blocked) o para añadir evidencias están **bloqueados intencionalmente** para todos los usuarios, incluso para los administradores.
* **Botón Play / Run (▶️):** Para desbloquear los controles, el usuario debe hacer clic en el botón de Ejecutar. Esto lo registra internamente en `executedBy` como el dueño de la ejecución de ese caso en ese ciclo, habilitando el menú de estados.
* **Badges de Defectos:** El icono de la mariquita (🐞) se inyecta dinámicamente justo a la derecha del título del caso (Summary) para evitar el desplazamiento visual de los botones de ejecución a la derecha.

### Reglas del Tab de Reportes
* **KPIs (Indicadores):** Muestran total de casos pasados, fallidos, bloqueados, y la tasa de cobertura.
* **Interlineado de Bugs Cerrados:** Para evitar superposición de la UI ("encimado"), el contador de defectos grandes y la leyenda de cerrados se manejan en un contenedor `flex-direction: column` con `line-height: 1`.
* **Tabla de Defectos Reportados:** Se inyecta siempre en la **parte inferior** de todo el dashboard para no obstruir las gráficas de progreso.

## 4. Limitaciones Conocidas y "Workarounds" de Forge

Existen ciertos comportamientos extraños de Forge que se resolvieron mediante "parches" de diseño:

1. **Enlaces (Links) rotos:** En una Custom UI de Forge (que vive en un iframe hiper-seguro), las etiquetas tradicionales HTML `<a target="_blank">` fallan de manera impredecible o son bloqueadas. 
   * *Solución:* Todos los enlaces (como los IDs de la tabla de bugs) capturan el evento clic y utilizan el enrutador nativo de la plataforma: `router.open('/browse/TICKET-ID')`.
2. **Acceso al Portapapeles (`navigator.clipboard`):** Forge bloquea la API moderna del portapapeles desde iframes por seguridad.
   * *Solución:* Cuando el usuario da clic en "Copiar Plantilla", la app genera una tabla HTML oculta, la inyecta al DOM, la selecciona programáticamente, ejecuta el comando antiguo `document.execCommand('copy')`, y luego elimina la tabla.
   * *UX:* Dado que no podemos lanzar el correo automáticamente de manera silenciosa junto con el texto formateado en HTML, se detiene el flujo con una **Alerta Adaptable OS** (`Cmd+V` para Mac o `Ctrl+V` para Windows) instruyendo al usuario qué hacer al llegar a Gmail.

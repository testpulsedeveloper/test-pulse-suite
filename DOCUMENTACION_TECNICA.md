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

### Algoritmo de Tiempo de Resolución de Defectos (Horario Laboral)
Para obtener la métrica de tiempo de resolución, el Backend procesa el *Changelog* del defecto (`?expand=changelog`) y realiza cálculos precisos:
* **Iteración Histórica:** Analiza los cambios en el campo de estado (Status).
* **Calendario Laboral Mexicano:** Existe un arreglo `mxHolidays` (Feriados 2024-2027) incluido directamente en el código.
* **Lógica `getBusinessHours`:** 
  * Ignora fines de semana (Sábados y Domingos).
  * Ignora días festivos del arreglo `mxHolidays`.
  * **Lunes a Jueves:** Cuenta solo horas transcurridas de 7:00 AM a 6:00 PM (18:00 no inclusivo).
  * **Viernes:** Cuenta solo horas de 7:00 AM a 1:00 PM (13:00 no inclusivo).
* Estos datos se agrupan en el Backend por "estado" para devolver al Frontend un resumen optimizado y preciso de horas consumidas, evitando saturar el cliente con cálculos de fechas.

## 3. Lógica de Presentación e Interfaz (Frontend - `App.js`)

El frontend está desarrollado en React y divide la operación en 5 pestañas principales: Design, Planning, Execution, Reports, y Config.

### Reglas de Negocio en la UI (Execution Tab)
* **Permisos y Control de Ejecución:** Los controles para cambiar el estado (Passed, Failed, Blocked) o para añadir evidencias están **bloqueados intencionalmente** para todos los usuarios, incluso para los administradores.
* **Botón Play / Run (▶️):** Para desbloquear los controles, el usuario debe hacer clic en el botón de Ejecutar. Esto lo registra internamente en `executedBy` como el dueño de la ejecución de ese caso en ese ciclo, habilitando el menú de estados.
* **Badges de Defectos:** El icono de la mariquita (🐞) se inyecta dinámicamente justo a la derecha del título del caso (Summary) para evitar el desplazamiento visual de los botones de ejecución a la derecha.

### Reglas del Tab de Reportes y Configuración Dinámica
* **Métricas Personalizables:** En la pestaña **Config** (Solo para Administradores), se guardan en variables las preferencias para apagar/prender secciones del reporte visual.
* **KPIs (Indicadores):** Muestran total de casos pasados, fallidos, bloqueados, y la tasa de cobertura de manera estática y fija.
* **Casos por Tester y Tipo de Ejecución:** El Frontend agrupa programáticamente las ejecuciones del ciclo basándose en el parámetro `executedBy` (Tester) y en el array de `components` (Busca strings que incluyan "auto" para determinar si es Automatizado o Manual). 
* **Interlineado de Bugs Cerrados:** Para evitar superposición de la UI ("encimado"), el contador de defectos grandes y la leyenda de cerrados se manejan en un contenedor `flex-direction: column` con `line-height: 1`.
* **Tabla de Defectos Reportados:** Se inyecta siempre en la **parte inferior** de todo el dashboard para no obstruir las gráficas de progreso.

## 4. Limitaciones Conocidas y "Workarounds" de Forge

Existen ciertos comportamientos extraños de Forge que se resolvieron mediante "parches" de diseño:

1. **Enlaces (Links) rotos:** En una Custom UI de Forge (que vive en un iframe hiper-seguro), las etiquetas tradicionales HTML `<a target="_blank">` fallan de manera impredecible o son bloqueadas. 
   * *Solución:* Todos los enlaces (como los IDs de la tabla de bugs) capturan el evento clic y utilizan el enrutador nativo de la plataforma: `router.open('/browse/TICKET-ID')`.
2. **Acceso al Portapapeles (`navigator.clipboard`):** Forge bloquea la API moderna del portapapeles desde iframes por seguridad.
   * *Solución:* Cuando el usuario da clic en "Copiar Plantilla", la app genera una tabla HTML oculta, la inyecta al DOM, la selecciona programáticamente, ejecuta el comando antiguo `document.execCommand('copy')`, y luego elimina la tabla.
   * *UX:* Dado que no podemos lanzar el correo automáticamente de manera silenciosa junto con el texto formateado en HTML, se detiene el flujo con una **Alerta Adaptable OS** (`Cmd+V` para Mac o `Ctrl+V` para Windows) instruyendo al usuario qué hacer al llegar a Gmail.


## Actualización 26 de Agosto 2026: Correcciones en Campos Personalizados y Reportes

### 1. Hardcodeo de Campos Personalizados en Backend (src/index.js)
Se detectó que el backend de Jira Forge transformaba la solicitud de '*all' (todos los campos) a una lista restringida de 'safeFields' por motivos de rendimiento y permisos, lo que causaba que los campos personalizados mapeados vía CSV fueran omitidos en la carga de la aplicación.
Se actualizaron los 'safeFields' para forzar la carga en la API de los siguientes campos clave para Test Pulse:
- customfield_10534 (Tipo de Ejecución)
- customfield_10530 (Nivel de Prueba)
- customfield_10535 (Tipo de Prueba)
- customfield_10568 (Precondición)
- customfield_10569 (Pasos)
- customfield_10570 (Resultados Esperados)

### 2. Filtro de Ejecución y Reportes (static/hello-world/src/App.js)
- **Tipo de Ejecución (getExecVal):** El sistema fue configurado para leer explícitamente customfield_10534 y determinar si una prueba es Manual o Automatizada basándose en la base de datos nativa de Jira.
- Se reincorporó la etiqueta de texto en cursiva a la par del ID (ej. *CEL-938 (Automatizado)*) para facilitar la rápida identificación visual en todas las listas.
- **Portapapeles de Bugs:** Se corrigió un error en handleCopyReportToClipboard donde se agrupaban mal los conteos. Se cambió la llave interna a ex.id garantizando que los reportes copiados calculen la suma exacta de 'Casos Impactados' por cada defecto agrupado de acuerdo a lo que se ve en la tabla de la interfaz.

### 3. Respaldos
La información de 'Tipo de Ejecución' y los demás Custom Fields reside **nativamente en la base de datos de Jira**, por lo cual están permanentemente respaldados por la plataforma Atlassian. La función interna de 'Backup & Restore' dentro de Configuración almacena correctamente las propiedades y jerarquías (Ciclos, Planes, Folders) de la aplicación.

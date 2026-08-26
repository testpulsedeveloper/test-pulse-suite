# Plan de Optimización Final: Eliminar cuellos de botella O(N)

Tras un barrido exhaustivo del backend (`src/index.js`), he identificado los **últimos dos grandes cuellos de botella** que podrían alentar la aplicación (o causar baneos por límite de peticiones) en diferentes secciones.

## 1. Módulo: Tiempos de Resolución de Defectos (Reportes)
**Problema:** En el componente de KPIs de Reportes, existe una función `getBugsResolutionTime`. Esta función recibe la lista de todos los Bugs detectados en la ejecución y **consulta su historial de cambios (changelog) uno por uno**. Si un ciclo tiene 50 bugs reportados, hará 50 consultas a Jira, lo que tardará mucho y arriesgará otro baneo.
**Solución (O(1)):** Cambiaremos el ciclo `for` individual por una sola búsqueda masiva usando JQL (`key IN (BUG-1, BUG-2, ...)`), solicitando a Jira que expanda el `changelog` de todos ellos en **una sola petición**.

## 2. Módulo: Historial de Ejecución de un Caso (Design / Modal)
**Problema:** Cuando haces clic en un "Test Case" para abrir el panel lateral de detalles, la pestaña de "Historial de Ejecución" escanea **todos** los Test Cycles del proyecto para ver en cuáles participó ese caso y cómo le fue. El código actual hace un bucle y le pregunta a cada ciclo individualmente si contiene el caso (2 consultas por cada ciclo que exista en tu proyecto). Si tienes 30 ciclos, hace 60 consultas secuenciales antes de mostrarte la tabla.
**Solución (O(1)):** Usaremos nuevamente el truco maestro del JQL. Haremos una sola búsqueda solicitando todos los ciclos, pero con la instrucción explícita de incluir únicamente la propiedad `exec_IDDELCASO`. Jira nos devolverá el historial completo de ese caso a través de todos los ciclos en **una sola respuesta de fracción de segundo**.

## Plan de Acción
Ambas funciones se reescribirán para usar peticiones masivas.

- [ ] Modificar `getBugsResolutionTime` para usar JQL Bulk Fetch con changelog expandido.
- [ ] Modificar `getTestCaseHistory` para usar JQL Bulk Fetch con propiedades.
- [ ] No alterar el resto de la lógica de análisis de horarios hábiles.
- [ ] Compilar y desplegar.

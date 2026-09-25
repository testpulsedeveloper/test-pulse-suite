# 📘 Manual de Usuario — Test Pulse Suite
**Versión de la Suite:** 5.36.0  
**Entorno:** Atlassian Jira Cloud (Forge Native)  
**Audiencia:** QA Engineers, Testers, Scrum Masters, Product Owners y Líderes de Proyecto.

---

## 📑 Tabla de Contenido
1. [Introducción y Navegación General](#1-introducción-y-navegación-general)
2. [Módulo 1: Repositorio y Diseño de Casos de Prueba (Design)](#2-módulo-1-repositorio-y-diseño-de-casos-de-prueba-design)
3. [Módulo 2: Planificación de Pruebas (Planning)](#3-módulo-2-planificación-de-pruebas-planning)
4. [Módulo 3: Ejecución de Pruebas (Execution)](#4-módulo-3-ejecución-de-pruebas-execution)
5. [Módulo 4: Informes, Métricas y Dashboard Ejecutivo (Reports)](#5-módulo-4-informes-métricas-y-dashboard-ejecutivo-reports)
6. [Módulo 5: Automatización e Integración CI/CD (Test Automation)](#6-módulo-5-automatización-e-integración-cicd-test-automation)
7. [Buenas Prácticas para el Equipo de QA](#7-buenas-prácticas-para-el-equipo-de-qa)

---

## 1. Introducción y Navegación General

### 1.1 Barra Superior y Selector de Proyecto
En la parte superior de la aplicación encontrarás la barra de navegación principal:
- **Selector de Proyecto:** Permite alternar entre los diferentes proyectos de Jira en los que tienes acceso. Al cambiar de proyecto, todas las carpetas, casos de prueba, planes, ciclos y métricas se adaptarán inmediatamente.
- **Pestañas Principales:**
  - 🎨 **Diseño (Design):** Repositorio maestro de casos de prueba, árbol de carpetas, importación/exportación y autoría de pruebas.
  - 📅 **Planificación (Planning):** Definición de Planes de Prueba (*Test Plans*) y Ciclos de Prueba (*Test Cycles*), con asignación de casos y testers.
  - ⚡ **Ejecución (Execution):** Panel de pruebas en tiempo real, registro de iteraciones, evidencias multimedia, cambios de estado y gestión de bugs vinculados.
  - 📊 **Informes (Reports):** Dashboard ejecutivo, métricas de calidad, gráficos de distribución, matriz de trazabilidad y reporte de defectos.
- **Indicador de Sincronización:** Muestra el estado de conexión activa con el entorno Forge de Atlassian.

---

## 2. Módulo 1: Repositorio y Diseño de Casos de Prueba (Design)

El módulo de **Diseño** es la biblioteca centralizada donde reside todo el patrimonio de pruebas de tu proyecto.

```
📁 Repositorio de Pruebas
├── 📂 01. Autenticación y Seguridad
│   ├── 📄 TC-101: Login exitoso con MFA
│   └── 📄 TC-102: Bloqueo de cuenta tras 3 intentos
├── 📂 02. Pagos y Facturación
│   ├── 📄 TC-201: Pago con Tarjeta de Crédito (Visa/Mastercard)
│   └── 📄 TC-202: Aplicación de cupón de descuento
└── 📂 03. Notificaciones Push
```

---

### 2.1 Árbol Jerárquico de Carpetas
El panel izquierdo permite organizar tus casos de prueba en estructuras lógicas (módulos, componentes, épicas o sprints):
- **Crear Carpeta:** Haz clic en el botón `+ Nueva Carpeta` o en el icono `+` junto a una carpeta existente para crear una subcarpeta.
- **Renombrar Carpeta:** Haz clic en los tres puntos `•••` de la carpeta y selecciona *Renombrar*.
- **Mover Carpetas:** Arrastra y suelta (*Drag & Drop*) carpetas para reordenar la jerarquía.
- **Eliminar Carpeta:** Haz clic en los tres puntos `•••` y selecciona *Eliminar*. *(Los casos contenidos pueden moverse a la raíz o eliminarse según tu confirmación)*.
- **Filtrado por Carpeta:** Al hacer clic en cualquier carpeta, la tabla principal mostrará únicamente los casos de prueba contenidos en ella y en sus subcarpetas.

---

### 2.2 Creación de Casos de Prueba
Haz clic en el botón azul **`+ Crear Caso de Prueba`** en la esquina superior derecha. Se abrirá el formulario de creación:

#### A. Campos Principales y Metadatos
| Campo | Descripción | Opciones / Ejemplos |
| :--- | :--- | :--- |
| **Título / Resumen** | Nombre claro y conciso del objetivo de la prueba. | *Validar checkout con saldo insuficiente* |
| **Carpeta Destino** | Carpeta del árbol donde se almacenará el caso. | */Pagos/Checkout* |
| **Tipo de Prueba** | Categoría funcional o técnica. | *Funcional*, *No Funcional*, *Regresión*, *Humo*, *Integración* |
| **Prioridad** | Nivel de criticidad del caso. | 🔴 *Bloqueante (Blocker)*, 🟠 *Alta (High)*, 🟡 *Media (Medium)*, 🟢 *Baja (Low)* |
| **Estado del Caso** | Ciclo de vida de diseño del caso. | *Draft (Borrador)*, *Ready (Listo para ejecutar)*, *Deprecated (Obsoleto)* |
| **Componente** | Componente de Jira asociado. | *Frontend*, *Backend API*, *Mobile App* |
| **Etiquetas (Tags)** | Palabras clave para filtros rápidos. | `#smoke`, `#sprint-24`, `#p1-release` |
| **Tiempo Estimado** | Duración estimada de ejecución manual. | *5m*, *15m*, *1h* |
| **Precondiciones** | Estado previo requerido antes de ejecutar. | *El usuario debe tener una cuenta activa con tarjeta registrada.* |
| **Descripción** | Contexto detallado de la prueba. | Formato enriquecido (negrita, listas, código). |

---

#### B. Modos de Especificación de Pasos
Test Pulse soporta dos modalidades de diseño:

##### 1. Modo Tradicional (Paso a Paso)
Permite desglosar la prueba en una secuencia ordenada de pasos tabulares:
- **Paso / Acción:** ¿Qué debe hacer el tester? *(Ej: "Hacer clic en el botón Pagar")*.
- **Datos de Prueba:** Parámetros o credenciales a utilizar *(Ej: "Tarjeta: 4532... CVV: 123")*.
- **Resultado Esperado:** Comportamiento esperado del sistema *(Ej: "Se muestra el modal de confirmación con el ID de transacción")*.

##### 2. Modo BDD / Gherkin
Ideal para equipos ágiles que trabajan con desarrollo guiado por comportamiento (*Behavior-Driven Development*):
```gherkin
Scenario: Pago exitoso con tarjeta de crédito
  Given que el usuario tiene productos en el carrito por un total de $150.00
  And se encuentra autenticado en la plataforma
  When selecciona el método de pago "Tarjeta de Crédito"
  And ingresa los datos válidos de su tarjeta
  And presiona el botón "Confirmar Pedido"
  Then el sistema procesa el pago exitosamente
  And genera la orden de compra con estado "Aprobado"
```

---

### 2.3 Operaciones sobre Casos de Prueba
En la tabla de casos de prueba dispones de las siguientes acciones directas:
- **Búsqueda en Tiempo Real:** Barra de búsqueda que filtra instantáneamente por ID (`TC-101`), clave de Jira, título o descripción.
- **Filtros Avanzados:** Filtra por prioridad, estado, componente, tipo de prueba o etiquetas.
- **Vistas de Visualización:**
  - 📋 **Vista Tabla:** Máxima densidad de datos, ideal para auditorías y revisiones masivas.
  - 🗂️ **Vista Cuadrícula / Tarjetas:** Visualización gráfica con tarjetas informativas.
- **Clonar Caso de Prueba:** Crea una copia exacta de un caso existente para acelerar la creación de variantes.
- **Acciones Masivas (*Bulk Operations*):** Selecciona múltiples casos mediante las casillas de verificación para moverlos de carpeta o eliminarlos en bloque.

---

### 2.4 Importación y Exportación de Casos
- **📥 Importar desde CSV / Excel:**
  1. Haz clic en el botón `Importar`.
  2. Selecciona tu archivo `.csv` o `.xlsx`.
  3. Mapea las columnas de tu archivo con los campos de Test Pulse (Título, Pasos, Resultado Esperado, Prioridad, etc.).
  4. Confirma la importación.
- **📤 Exportar a CSV / Excel:**
  - Descarga el repositorio completo o la selección filtrada para compartir con clientes o generar copias de seguridad locales.

---

## 3. Módulo 2: Planificación de Pruebas (Planning)

El módulo de **Planificación** permite estructurar las fases de prueba en **Planes de Prueba** y **Ciclos de Prueba**, asignando casos y recursos antes de comenzar la ejecución.

```
🎯 Test Plan: "Release v3.5 - Pagos y Checkout"
│
├── 🔄 Ciclo 1: "Smoke Test - Ambiente QA" (50 casos) -> Asignado a: QA Team
├── 🔄 Ciclo 2: "Regresión Completa - Staging" (320 casos) -> Asignado a: Gustavo B.
└── 🔄 Ciclo 3: "Pruebas de Rendimiento y Carga" (30 casos) -> Asignado a: Performance Team
```

---

### 3.1 Planes de Prueba (*Test Plans*)
Un **Test Plan** agrupa los objetivos generales de calidad para una versión, hito (*Milestone*) o entrega importante:
- **Crear Plan:** Haz clic en `+ Crear Plan de Prueba`, asigna un nombre (*Ej: "Sprint 42 - Core Banking"*), objetivo, versión de Jira vinculada (*Fix Version*) y fechas estimadas.
- **Visualización de Planes:** Panel lateral izquierdo con listado de planes activos y archivados.

---

### 3.2 Ciclos de Prueba (*Test Cycles*)
Un **Ciclo de Prueba** representa una iteración de pruebas concreta ejecutada en un entorno específico:
- **Crear Ciclo:** Haz clic en `+ Crear Ciclo de Prueba`.
- **Campos del Ciclo:**
  - **Nombre del Ciclo:** *Ej: "Regresión Sprint 42 - Build 1.0.8"*.
  - **Plan Asociado:** Selecciona el Test Plan al que pertenece (opcional).
  - **Entorno / Ambiente:** *Desarrollo*, *QA*, *Staging*, *UAT*, *Producción*.
  - **Fechas:** Fecha de inicio y fecha fin planificada.

---

### 3.3 Asignación de Casos a un Ciclo
1. Selecciona el Ciclo en el panel izquierdo.
2. En el panel principal, haz clic en **`+ Asignar Casos de Prueba`**.
3. Utiliza el selector con árbol de carpetas y filtros para elegir los casos de prueba del repositorio.
4. Puedes asignar un **Tester Responsable** a cada caso individualmente o a toda la selección en masa.
5. Haz clic en **`Guardar Asignación`**. La barra inferior de progreso del ciclo actualizará el total de casos planificados en tiempo real.

---

## 4. Módulo 3: Ejecución de Pruebas (Execution)

El módulo de **Ejecución** es el espacio de trabajo diario del tester, donde se registran los resultados, se documentan iteraciones, se adjuntan evidencias y se reportan defectos en Jira.

---

### 4.1 Estados de Ejecución
Cada caso de prueba y cada iteración puede tener uno de los siguientes estados:

| Estado | Color / Badge | Significado |
| :--- | :--- | :--- |
| **Passed (Aprobado)** | 🟢 Verde | La prueba se ejecutó y cumplió con todos los resultados esperados. |
| **Failed (Fallido)** | 🔴 Rojo | Se detectó una discrepancia, fallo funcional o error en el sistema. |
| **Blocked (Bloqueado)** | 🟠 Naranja | La prueba no puede completarse debido a un bloqueo externo (ej. caída de servicio, falta de datos). |
| **In Progress (En Progreso)** | 🔵 Azul | El tester se encuentra ejecutando activamente la prueba. |
| **Not Run (No Ejecutado)** | ⚪ Gris | La prueba está asignada pero aún no ha iniciado su ejecución. |

---

### 4.2 Ejecución por Iteraciones (Paso a Paso / Multi-iteración)
Test Pulse permite ejecutar múltiples iteraciones sobre un mismo caso de prueba (por ejemplo, probando con diferentes conjuntos de datos o ejecutando pasos secuenciales):

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ TC-101: Login exitoso con MFA                                   [ Estado: Failed ]│
├─────────────────────────────────────────────────────────────────────────────────┤
│ Iteración 1: Usuario estándar con SMS Token                                     │
│   • Datos Esperados: SMS recibido en < 30 seg     • Estado: Passed 🟢            │
│   • Resultado Real: Login correcto con token SMS.                               │
│                                                                                 │
│ Iteración 2: Usuario corporativo con Google Authenticator                       │
│   • Datos Esperados: Token TOTP de 6 dígitos      • Estado: Failed 🔴            │
│   • Resultado Real: Error 500 "Invalid TOTP Secret Key".                        │
│   • Evidencias: 📎 error_totp.png, 📎 server_log.txt                             │
│   • Bugs Vinculados: 🐛 BUG-849: Fallo en validación TOTP [Mayor]               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Cómo utilizar las Iteraciones:
1. Haz clic sobre el caso de prueba para expandir su panel de ejecución.
2. Haz clic en el botón **`+ Agregar Iteración`**.
3. Completa los campos:
   - **Datos Esperados / Procedimiento:** Datos ingresados en esta corrida.
   - **Resultado Obtenido (*Actual Result*):** Comportamiento observado del sistema.
   - **Estado de la Iteración:** Selecciona `Passed`, `Failed`, `Blocked`, `In Progress` o `Not Run`.
4. **Cálculo Inteligente del Estado Global:**
   - Si **cualquier iteración** tiene estado `Failed`, el estado global del caso de prueba cambiará automáticamente a **Failed**.
   - Si **cualquier iteración** tiene estado `Blocked` (y ninguna fallida), el estado global será **Blocked**.
   - Si **todas las iteraciones** tienen estado `Passed`, el caso global se marcará como **Passed**.

---

### 4.3 Gestión de Evidencias y Archivos Adjuntos
Es fundamental respaldar los resultados de prueba con evidencias multimedia:
- **Subir Evidencia:** Haz clic en el icono de clip `📎 Adjuntar Evidencia` o arrastra archivos directamente al panel.
- **Tipos de archivo soportados:** Imágenes (`PNG`, `JPG`, `GIF`), Documentos (`PDF`, `TXT`, `LOG`, `JSON`) y Videos (`MP4`, `WEBM`).
- **Nivel de Evidencia:** Puedes adjuntar evidencias a nivel global del caso de prueba o dentro de una iteración específica.
- **Renombrar y Eliminar:** Puedes cambiar el nombre del archivo adjunto para facilitar su lectura o eliminarlo haciendo clic en el icono de papelera.

---

### 4.4 Gestión y Vinculación de Defectos (Bugs)
Cuando una prueba falla, puedes gestionar los defectos directamente sin salir de la pantalla de ejecución:

#### A. Crear un Nuevo Bug en Jira
1. Haz clic en el botón **`+ Crear Defecto (Bug)`** dentro del caso de prueba o iteración.
2. Completa el resumen, descripción (se precarga automáticamente con los pasos e iteración actual) y severidad.
3. El bug se creará nativamente en Jira y quedará enlazado al caso de prueba y al ciclo actual de forma bidireccional.

#### B. Vincular un Bug Existente
1. Haz clic en **`Vincular Bug`**.
2. Escribe la clave (`PROJ-123`) o texto del resumen para buscar en Jira.
3. Selecciónalo para vincularlo.

#### C. Visualización de Severidad de Defectos
Cada bug vinculado muestra su etiqueta de severidad estandarizada con color identificativo:
- 🔴 **Bloqueante / Crítico:** Defecto que impide la continuidad operativa.
- 🟠 **Mayor / Alta:** Defecto grave en una funcionalidad principal sin solución alternativa inmediata.
- 🟡 **Medio:** Defecto funcional con solución alternativa temporal.
- 🟢 **Menor / Baja:** Defecto visual, cosmético o de baja prioridad.

---

### 4.5 Control de Sesión y Asignación (*Takeover*)
Para proteger la integridad de los datos, Test Pulse registra la identidad del tester que ejecutó la prueba y la fecha/hora exacta.
- Si otro tester necesita continuar o modificar una prueba iniciada por un compañero, la aplicación mostrará la opción **"Tomar el control" (*Takeover*)**, actualizando la autoría de forma transparente.

---

## 5. Módulo 4: Informes, Métricas y Dashboard Ejecutivo (Reports)

El módulo de **Informes** consolida en tiempo real la información de todas las ejecuciones, ciclos y defectos, ofreciendo tableros ejecutivos y analíticos para la toma de decisiones.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 📊 DASHBOARD EJECUTIVO DE CALIDAD                                                      │
├───────────────────┬───────────────────┬───────────────────┬────────────────────────────┤
│ Total Casos: 974  │ Aprobados: 812    │ Fallidos: 98      │ Bloqueados: 21  (Sin Run: 43)│
│ Cobertura: 95.6%  │ % Éxito: 83.4%    │ Bugs Abiertos: 34 │ Tiempo Promedio: 4.2h      │
└───────────────────┴───────────────────┴───────────────────┴────────────────────────────┘
```

---

### 5.1 Filtros del Dashboard
En la parte superior del módulo de reportes puedes segmentar los datos:
- **Filtro por Plan de Prueba:** Visualiza las métricas acumuladas de uno o más planes específicos.
- **Filtro por Ciclos de Prueba:** Selecciona ciclos individuales para análisis granular.
- **Filtro por Tipo de Prueba:** Alterna entre pruebas *Funcionales* y *No Funcionales*.

---

### 5.2 Secciones y Tableros Analíticos

#### 1. Resumen Ejecutivo de Métricas (KPI Cards)
- **Total de Pruebas Ejecutadas:** Volumen de casos planificados vs. ejecutados.
- **Tasa de Aprobación (*Pass Rate*):** Porcentaje de pruebas en estado `Passed`.
- **Tasa de Fallos (*Fail Rate*):** Porcentaje de pruebas fallidas sobre el total.
- **Pruebas Bloqueadas:** Alerta temprana de dependencias e impedimentos técnicos.

#### 2. Gráficos de Distribución de Estado
- **Gráfico de Dona (*Donut Chart*):** Proporción visual de `Passed`, `Failed`, `Blocked`, `In Progress` y `Not Run`.
- **Progreso Temporal (*Execution Velocity*):** Curva de casos ejecutados a lo largo de los días del ciclo.

#### 3. Panel de Control de Defectos (*Bugs Analytics*)
- **Defectos por Severidad:** Gráfica de barras dividida en *Bloqueante, Crítico, Mayor, Medio y Menor*.
- **Defectos Abiertos vs. Resueltos:** Seguimiento del ritmo de corrección del equipo de desarrollo.
- **Listado de Defectos Críticos de Ciclo:** Tabla interactiva con enlace directo a Jira, tester asignado, casos afectados y estado de resolución.
- **Defectos Huérfanos / Sin Vincular:** Detección de bugs reportados en el proyecto de Jira que no están asociados a ningún caso de prueba formal.

#### 4. Estadísticas por Tester y Componente
- **Productividad del Equipo:** Número de ejecuciones y defectos reportados por cada tester.
- **Calidad por Componente:** Identificación de los módulos de software con mayor tasa de defectos (*Hotspots* de riesgo).

#### 5. Matriz de Trazabilidad Requisitos - Pruebas - Defectos
Permite auditar la cobertura de extremo a extremo:
$$\text{Requisito / Historia de Usuario} \longrightarrow \text{Casos de Prueba} \longrightarrow \text{Ejecuciones} \longrightarrow \text{Bugs Encontrados}$$

---

### 5.3 Exportación de Reportes
Puedes compartir el estado de la calidad con stakeholders mediante los botones de exportación:
- **📄 Exportar a PDF:** Genera un informe ejecutivo con membrete, gráficos y tablas formateadas.
- **📊 Exportar a Excel / CSV:** Descarga la data cruda con todas las métricas para análisis personalizados en BI o auditorías externas.

---

## 6. Módulo 5: Automatización e Integración CI/CD (Test Automation)

Test Pulse Suite permite consolidar los resultados de pruebas manuales y automatizadas en una única fuente de verdad.

### 6.1 Frameworks Soportados
La suite puede recibir resultados de los frameworks más populares del mercado:
- **Java / JVM:** JUnit 4/5, TestNG, Cucumber-JVM.
- **JavaScript / TypeScript:** Cypress, Playwright, Jest, Mocha.
- **Python:** PyTest, Robot Framework, Behave.
- **C# / .NET:** NUnit, xUnit, SpecFlow.

### 6.2 Consulta de Historial Automatizado
Dentro de la pestaña de Automatización puedes:
- Consultar las corridas de pruebas enviadas por tus pipelines de integración continua (**GitHub Actions, GitLab CI, Jenkins, Azure DevOps, Bitbucket Pipelines**).
- Ver la correspondencia automática entre los métodos de prueba del código y los casos de prueba de Test Pulse.

---

## 7. Buenas Prácticas para el Equipo de QA

1. **Estandarización de Títulos:** Inicia los títulos con verbos en infinitivo que describan claramente el objetivo *(ej. "Validar recuperación de contraseña con correo inválido")*.
2. **Uso de Iteraciones para Pruebas de Datos (*Data-Driven*):** En lugar de crear 10 casos de prueba idénticos para 10 valores de entrada distintos, crea 1 caso de prueba con 10 **iteraciones**.
3. **Evidencias Claras en Fallos:** Adjunta siempre una captura de pantalla del mensaje de error y el archivo de log correspondiente antes de marcar una iteración como `Failed`.
4. **Vincular siempre los Bugs al Caso:** No reportes bugs aislados en Jira; créalos o vincúlalos directamente desde la ejecución de Test Pulse para que se reflejen en la Matriz de Trazabilidad.
5. **Cierre de Ciclos:** Al finalizar un sprint o release, verifica que ningún caso permanezca en estado `In Progress` o `Not Run`.

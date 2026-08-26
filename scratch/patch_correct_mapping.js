const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target1 = `const handleDownloadTemplate = () => {
    const csvContent = "\\uFEFF" + \`PROCESO*,NIVEL DE PRUEBA*,NEGOCIO*,RESULTADOS ESPERADOS*,DESCRIPCIÓN*,PRECONDICIÓN,PRIORIDAD*,CICLO*,TIPO DE EJECUCIÓN*,NOMBRE DE CASO DE PRUEBA*,PROYECTO,TIPO DE PRUEBA*,Tipo de Incidencia,PASOS*,VERSION AFECTADA,AMBIENTE
Autenticación,Integración SIT,Retail,"El usuario ingresa exitosamente.","Validar acceso al POS.","Usuario activo.",Alta,CICLO-1,Manual,"LOGINING**** | Acceso exitoso al sistema con credenciales válidas.",RET,Funcional,Test Case,"1. Abrir POS\\n2. Ingresar credenciales\\n3. Validar ingreso",1.0,SIT\`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Template_Carga_Regresion_MPA_Auto4690.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };`;

const replacement1 = `const handleDownloadTemplate = () => {
    const csvContent = "\\uFEFF" + \`Resumen,Descripción,Link (is tested by),Nivel de Prueba,Tipo de Prueba,Tipo de Ejecución,Prioridad
LOGINING | Acceso exitoso al sistema con credenciales válidas.,"Pre-conditions:
Usuario activo en base de datos.

Test Script:
Given que el POS muestra la pantalla de ingreso.
When el usuario ingresa un Usuario y Password correctos.
Then el sistema valida la identidad.
",,Integración SIT,Funcional,Manual,Alta\`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Plantilla_Test_Cases.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };`;

const target2 = `  const handleDownloadJiraConfig = () => {
    const configContent = \`{
  "config.version" : "2.0",
  "config.project.from.csv" : "false",
  "config.encoding" : "UTF-8",
  "config.file.id" : "a9683bcb-2e6d-4eea-b8c1-0a2d91005991",
  "config.email.suffix" : "@",
  "config.file.name" : "Template Carga Regresion MPA_Auto4690.csv",
  "config.field.mappings" : {
    "PROCESO*" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10532" },
    "NIVEL DE PRUEBA*" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10530" },
    "NEGOCIO*" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10531" },
    "RESULTADOS ESPERADOS*" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10570" },
    "DESCRIPCIÓN*" : { "jira.field" : "description", "userChanged" : "true", "manualMapping" : "false" },
    "PRECONDICIÓN" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10568" },
    "PRIORIDAD*" : { "jira.field" : "priority", "userChanged" : "true", "manualMapping" : "false" },
    "CICLO*" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10298" },
    "TIPO DE EJECUCIÓN*" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10534" },
    "NOMBRE DE CASO DE PRUEBA*" : { "jira.field" : "summary", "userChanged" : "true", "manualMapping" : "false" },
    "PROYECTO" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10700" },
    "TIPO DE PRUEBA*" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10535" },
    "Tipo de Incidencia" : { "jira.field" : "issuetype", "userChanged" : "true", "manualMapping" : "false" },
    "PASOS*" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10569" },
    "VERSION AFECTADA" : { "jira.field" : "versions", "userChanged" : "true", "manualMapping" : "false" },
    "AMBIENTE" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10302" }
  },
  "config.csv.file.id" : null,
  "config.value.mappings" : { },
  "config.delimiter" : ",",
  "config.project" : {
    "project.type" : null,
    "project.key" : "RET",
    "project.description" : null,
    "project.url" : null,
    "project.name" : "Retail",
    "project.lead" : "63c6b2d80036340dcb5ca0d6"
  },
  "config.date.format" : "dd/MMM/yy h:mm a"
}\`;

    const blob = new Blob([configContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Mapeo_Jira_Regresion_MPA.txt');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };`;

const replacement2 = `  const handleDownloadJiraConfig = () => {
    const configContent = \`{
  "config.version" : "2.0",
  "config.project.from.csv" : "false",
  "config.encoding" : "UTF-8",
  "config.file.id" : "a9683bcb-2e6d-4eea-b8c1-0a2d91005991",
  "config.email.suffix" : "@",
  "config.file.name" : "Plantilla_Test_Cases.csv",
  "config.field.mappings" : {
    "Resumen" : { "jira.field" : "summary", "userChanged" : "true", "manualMapping" : "false" },
    "Descripción" : { "jira.field" : "description", "userChanged" : "true", "manualMapping" : "false" },
    "Prioridad" : { "jira.field" : "priority", "userChanged" : "true", "manualMapping" : "false" },
    "Nivel de Prueba" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10530" },
    "Tipo de Prueba" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10535" },
    "Tipo de Ejecución" : { "userChanged" : "true", "manualMapping" : "false", "existing.custom.field" : "10534" },
    "Link (is tested by)" : { "jira.field" : "issuelink", "userChanged" : "true", "manualMapping" : "false" }
  },
  "config.csv.file.id" : null,
  "config.value.mappings" : { },
  "config.delimiter" : ",",
  "config.date.format" : "dd/MMM/yy h:mm a"
}\`;

    const blob = new Blob([configContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Configuracion_Jira_TestPulse.txt');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };`;

if (content.includes(target1) && content.includes(target2)) {
    content = content.replace(target1, replacement1);
    content = content.replace(target2, replacement2);
    fs.writeFileSync(path, content);
    console.log("Patched App.js with correct user template!");
} else {
    console.error("Could not find targets in App.js");
}

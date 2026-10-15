# Guía de Migración, Respaldo e Instalación — Test Pulse Suite (`v3.12.4`)

Este documento contiene toda la información técnica, rutas, respaldos locales y comandos necesarios para restaurar y continuar el desarrollo de **Test Pulse Suite (Test Manager Jira)** y el historial de sesiones de **Antigravity** en una máquina nueva.

---

## 1. Información General del Proyecto

| Concepto | Valor |
| :--- | :--- |
| **Nombre del Proyecto** | Test Pulse Suite (`jira-project-page-custom-ui`) |
| **Versión del Proyecto** | `3.12.4` |
| **Versión en Forge (`production`)** | `4.59.0` |
| **Forge App ID (`manifest.yml`)** | `ari:cloud:ecosystem::app/8b6d544c-98eb-44ef-b037-8eb3a7a26148` |
| **Repositorio GitHub (`origin`)** | `https://github.com/testpulsedeveloper/test-pulse-suite.git` |
| **Rama Principal** | `main` (más rama de respaldo `backup-before-rollback-9cf81ec`) |
| **Ruta Local Original** | `/Users/GBARBOSAM/jira-test-management` |

---

## 2. Estructura del Proyecto y Carpetas Locales

```text
jira-test-management/
├── manifest.yml                          # Manifiesto de Atlassian Forge (permisos, módulos, App ID)
├── package.json                          # Dependencias del backend Forge (@forge/api, @forge/kvs, @forge/resolver)
├── src/
│   ├── index.js                          # Backend principal (Resolvers Forge, KVS, Jira REST API v3, JQL, Trazabilidad)
│   └── utils/                            # Utilidades compartidas del backend (constants, helpers, storage)
├── static/hello-world/                   # Aplicación Frontend (React 18 + Vite + Atlaskit + TanStack Query)
│   ├── package.json                      # Dependencias y scripts de compilación frontend
│   ├── vite.config.mjs                   # Configuración de empaquetado con Vite
│   ├── index.html                        # Punto de entrada HTML para Vite
│   └── src/
│       ├── App.js                        # Componente principal de Test Pulse
│       ├── index.js                      # Inicialización de React y QueryClientProvider
│       ├── index.css                     # Estilos globales y sistema de diseño Atlaskit
│       ├── components/CommonComponents.jsx
│       └── utils/                        # adfUtils.js, constants.js, queryClient.js
├── test-pulse-mobile/                    # App móvil complementaria (Expo / React Native)
├── backups_dev_phase/                    # Respaldos locales de fases previas (ignorado en Git, incluido en el backup .tar.gz)
├── scratch/                              # Scripts y respaldos locales de depuración (ignorado en Git, incluido en el backup .tar.gz)
├── DOCUMENTACION_TECNICA.md              # Arquitectura técnica del sistema
├── INTEGRACION_AUTOMATIZACION.md         # Guía de integración CI/CD y automatización
├── MANUAL_DE_USUARIO_TEST_PULSE_SUITE.md # Manual de usuario completo
└── GUIA_MIGRACION_Y_RESPALDO.md          # Esta guía de migración e instalación
```

---

## 3. Archivos de Respaldo Generados (Backup Local Completo)

Además de tener todo el código fuente actualizado en GitHub (`origin/main`), se generó una carpeta de respaldo integral en:

- **Carpeta de respaldos**: `/Users/GBARBOSAM/RESPALDO_MIGRACION_TEST_PULSE/`
  1. `test-pulse-proyecto-completo.tar.gz`:
     - Incluye **todo** el directorio `/Users/GBARBOSAM/jira-test-management` (código fuente, `.git` completo con historial y ramas, `backups_dev_phase/`, `scratch/`, documentación y `test-pulse-mobile/`, excluyendo únicamente `node_modules` para mantenerlo ligero).
  2. `antigravity-chats-y-config.tar.gz`:
     - Incluye todos los **chats, transcripciones (`transcript.jsonl` / `transcript_full.jsonl`), artefactos, imágenes subidas y scripts scratch** de Antigravity (`~/.gemini/antigravity/brain/`, `~/.gemini/antigravity/scratch/`, `~/.gemini/antigravity/mcp/`) así como los plugins y skills configurados (`~/.gemini/config/`).

> **Importante**: Copia la carpeta `/Users/GBARBOSAM/RESPALDO_MIGRACION_TEST_PULSE/` a tu unidad externa, Google Drive o envíala por AirDrop a tu nueva máquina.

---

## 4. Comandos de Instalación en la Nueva Máquina (Paso a Paso)

### Paso 1: Instalar herramientas base (macOS)

1. **Homebrew** (si no está instalado):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Git y Node.js (v20 LTS o v22 recomendada para Forge)**:
   ```bash
   brew install git node@20
   node -v
   npm -v
   ```

3. **Atlassian Forge CLI**:
   ```bash
   npm install -g @forge/cli@latest
   forge --version
   ```

---

### Paso 2: Autenticarse en Atlassian Forge y GitHub

1. **Generar o usar tu API Token de Atlassian**:
   - Ve a: `https://id.atlassian.com/manage-profile/security/api-tokens`
   - Inicia sesión en Forge CLI:
     ```bash
     forge login
     ```
     *(Te pedirá el correo de tu cuenta Atlassian y tu API Token).*

2. **Configurar Git**:
   ```bash
   git config --global user.name "Tu Nombre"
   git config --global user.email "tu-correo@dominio.com"
   ```

---

### Paso 3: Restaurar el Proyecto (Opción A: Desde GitHub + Archivos Locales, u Opción B: Desde el `.tar.gz`)

#### Opción A — Clonar desde GitHub:
```bash
git clone https://github.com/testpulsedeveloper/test-pulse-suite.git ~/jira-test-management
```
*(Si deseas recuperar también las carpetas locales ignoradas por Git como `backups_dev_phase/` y `scratch/`, descomprime `test-pulse-proyecto-completo.tar.gz`).*

#### Opción B — Restaurar directamente desde el archivo `.tar.gz` (incluye `.git`, `backups_dev_phase/` y `scratch/`):
```bash
mkdir -p ~/
tar -xzvf test-pulse-proyecto-completo.tar.gz -C ~/
```

---

### Paso 4: Instalar Dependencias del Proyecto y Compilar

Ejecuta los siguientes comandos dentro de `~/jira-test-management`:

```bash
# 1. Instalar dependencias del backend de Forge (raíz)
npm --prefix ~/jira-test-management install

# 2. Instalar dependencias del frontend React + Vite
npm --prefix ~/jira-test-management/static/hello-world install

# 3. (Opcional) Instalar dependencias de la app móvil
npm --prefix ~/jira-test-management/test-pulse-mobile install

# 4. Probar que el build de producción compile correctamente
npm --prefix ~/jira-test-management run build
```

---

### Paso 5: Comandos de Uso Diario (Compilación y Despliegue en Jira)

| Acción | Comando |
| :--- | :--- |
| **Compilar Frontend (Vite)** | `npm --prefix ~/jira-test-management run build` |
| **Desplegar en Desarrollo (`development`)** | `npm --prefix ~/jira-test-management run deploy` |
| **Desplegar en Producción (`production`)** | `npm --prefix ~/jira-test-management run deploy:prod` |
| **Ver logs en vivo de Producción** | `forge logs -e production` |
| **Ejecutar túnel local de desarrollo** | `forge tunnel` |

---

### Paso 6: Restaurar Historial de Chats, Artefactos y Configuración de Antigravity

En la máquina nueva, después de instalar **Antigravity**, cierra la aplicación y ejecuta en la terminal:

```bash
mkdir -p ~/.gemini
tar -xzvf antigravity-chats-y-config.tar.gz -C ~/.gemini/
```

Esto restaurará:
- `~/.gemini/antigravity/brain/` → Todas tus conversaciones previas (`transcript.jsonl` y `transcript_full.jsonl`), capturas de pantalla y artefactos (incluyendo esta conversación `f4e3cae2-deeb-4d62-9b44-9a03ed0a46fc`).
- `~/.gemini/antigravity/mcp/` → Configuraciones de servidores MCP (Atlassian, Gemini API Docs, Data Agent Kit, etc.).
- `~/.gemini/config/` → Plugins y skills instalados.

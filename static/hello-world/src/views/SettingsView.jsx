import React from 'react';
import { view, router, requestJira } from '@forge/bridge';
import { CreateIssueModal } from '@forge/jira-bridge';
import Lozenge from '@atlaskit/lozenge';
import Badge from '@atlaskit/badge';
import Button from '@atlaskit/button';
import Spinner from '@atlaskit/spinner';
import TestPulseLoader from '../components/TestPulseLoader';
import { LIVERPOOL_LOGO_WHITE_ANIMATED_B64, LIVERPOOL_LOGO_WHITE_B64, LIVERPOOL_LOGO_PINK_B64 } from '../assets/liverpool-logo-b64';
import packageJson from '../../package.json';
import { generateQrSvg, generateQrDataUrl } from '../utils/qrCodeGenerator';
import {
  generateUUID,
  normalizeUiStatus,
  REMOVED_WIDGET_TYPES,
  DEFAULT_DASHBOARD_WIDGETS,
  AVAILABLE_WIDGET_CATALOG,
  formatAttachmentSize,
  MX_HOLIDAYS_SET,
  getBusinessHoursBetween,
  formatBugCreatedDate,
  formatBugAge
} from '../utils/constants';
import { textToAdf, sanitizeRenderedHtml, sanitizeHtml, adfToHtml, fetchAttachmentBlobData } from '../utils/adfUtils';
import {
  RichTextEditor,
  SearchableSelect,
  BugAttachmentImageCard,
  PdfDocumentPreview,
  useNotification,
  ConfirmModal,
  TextInputModal,
  AtlaskitStatusLozenge,
  LIST_BATCH_SIZE,
  LoadMoreSentinel
} from '../components/CommonComponents';
import { invoke, queryClient, clearPersistentCache } from '../utils/queryClient';
import { extractEpicAndRequirement } from '../utils/traceabilityHelpers';

const APP_VERSION = `v${packageJson.version || '4.10.0'}`;

export default function SettingsView({ ctx }) {
  const {
    DEFAULT_EXECUTION_ENVIRONMENTS = [],
    addNotification,
    availableEnvironments = [],
    context,
    editingEnvDesc,
    editingEnvId,
    editingEnvName,
    findTc,
    handleResyncCycleRuns,
    handleSaveConfig,
    handleUpdateEnvironmentsCatalog,
    isAdmin,
    isCycleInPlan,
    isHydratingReport,
    isProjectAllowed,
    isRefreshingReport,
    isSavingConfig,
    isSavingEnvCatalog,
    linkTypes = [],
    loadReportAutomationConfig,
    loadReportData,
    newEnvDesc,
    newEnvName,
    projectConfig,
    projectIssueTypes = [],
    projects = [],
    reportAutomationConfig,
    reportData,
    reportLoading,
    resyncCycleId,
    resyncProgress,
    resyncResult,
    resyncRunning,
    selectedProjectId,
    setActiveTab,
    setAllowedProjects,
    setEditingEnvDesc,
    setEditingEnvId,
    setEditingEnvName,
    setIsProjectAllowed,
    setNewEnvDesc,
    setNewEnvName,
    setProjectConfig,
    setResyncCycleId,
    setResyncResult,
    setSelectedCycle,
    setSelectedPlanId,
    setShowReportAutomationModal,
    snapshotFieldMap,
    testCases = [],
    testCycles = [],
    testPlans = [],
    unlinkedBugs = []
  } = ctx || {};

    const currentProject = (projects || []).find(p => String(p.id) === String(selectedProjectId));
    const projectName = currentProject?.name || 'Proyecto';
    const projectKey = currentProject?.key || selectedProjectId;

    // ============================================================================
    // TESTING EXIT REPORT Y CALCULADORA DE CALIDAD (ESTADO Y LÓGICA)
    // ============================================================================
    // Permite evaluar el cierre de pruebas seleccionando Plan, Ciclos y Ambiente,
    // calculando automáticamente el Resumen de Ejecuciones, Resumen de Defectos
    // y el Semáforo de Calidad bajo la matriz de puntuación oficial (máx. 15 pts).
    // Incluye advertencia explícita de que NO es un VoBo, sólo Recomendación de Calidad.
    const [exitReportPlanId, setExitReportPlanId] = React.useState('ALL');
    const [exitReportCycleIds, setExitReportCycleIds] = React.useState([]);
    const [exitReportEnv, setExitReportEnv] = React.useState('QA / UAT');
    const [exitReportBuild, setExitReportBuild] = React.useState('');
    const [exitReportBugScope, setExitReportBugScope] = React.useState('SCOPED'); // 'SCOPED' (ciclos evaluados) | 'ALL_PROJECT' (todo el proyecto)
    const [exitReportObservations, setExitReportObservations] = React.useState('');
    const [exitReportSubject, setExitReportSubject] = React.useState('');
    const [exitReportModalOpen, setExitReportModalOpen] = React.useState(false);
    const [exitReportIsEditing, setExitReportIsEditing] = React.useState(false);
    const [exitReportTargetIssue, setExitReportTargetIssue] = React.useState('');
    const [exitReportPublishing, setExitReportPublishing] = React.useState(false);

    // Modo simulador opcional para la Calculadora de Calidad (permite probar escenarios "What-if")
    const [exitSimEnabled, setExitSimEnabled] = React.useState(false);
    const [exitSimCoverage, setExitSimCoverage] = React.useState(95);
    const [exitSimOpenBugsPct, setExitSimOpenBugsPct] = React.useState(0.5);
    const [exitSimOpenBlockers, setExitSimOpenBlockers] = React.useState(0);

    const exitReportCardRef = React.useRef(null);
    const exitReportContainerRef = React.useRef(null);

    // Resolver URL base del sitio Jira para construir los hipervínculos hacia los ciclos y defectos
    const siteBaseUrl = React.useMemo(() => {
      if (context?.siteUrl) return String(context.siteUrl).replace(/\/$/, '');
      if (typeof window !== 'undefined' && window.location?.ancestorOrigins?.length > 0) {
        return String(window.location.ancestorOrigins[0]).replace(/\/$/, '');
      }
      return '';
    }, [context]);

    // Limpia cualquier prefijo de clave Jira (ej. "PROJ-123 — ", "PROJ-123: ") para mostrar únicamente el nombre del Plan o Ciclo
    const formatCleanName = React.useCallback((entity, fallbackLabel = '') => {
      if (!entity) return fallbackLabel;
      const raw = String(entity.name || entity.summary || fallbackLabel || '').trim();
      if (!raw) return fallbackLabel;
      const key = String(entity.key || '').trim();
      let cleaned = raw;
      if (key) {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleaned = cleaned.replace(new RegExp(`^\\s*\\[?${escapedKey}\\]?\\s*[-—:·|]+\\s*`, 'i'), '').trim();
      }
      cleaned = cleaned
        .replace(/^\s*\[?(?:Test\s*Plan|Test\s*Cycle|Plan\s*de\s*Pruebas|Ciclo\s*de\s*Pruebas)\]?\s*[-—:·|]*\s*/i, '')
        .replace(/^[A-Z][A-Z0-9_]*-\d+\s*[-—:·|]+\s*/i, '')
        .trim();
      return cleaned || raw;
    }, []);

    // Fuente hidratada de ciclos: combina reportData.cycles con testCycles para preservar ejecuciones, bugs y planId
    const sourceCycles = React.useMemo(() => {
      const baseReport = Array.isArray(reportData?.cycles) ? reportData.cycles : [];
      const baseCycles = Array.isArray(testCycles) ? testCycles : [];
      if (baseReport.length === 0) return baseCycles;

      const merged = baseReport.map(rc => {
        const tcCycle = baseCycles.find(
          tc => String(tc.id) === String(rc.id) || (tc.key && rc.key && String(tc.key) === String(rc.key))
        );
        if (!tcCycle) return rc;
        return {
          ...tcCycle,
          ...rc,
          id: rc.id || tcCycle.id,
          key: rc.key || tcCycle.key,
          summary: rc.summary || tcCycle.summary || rc.name || tcCycle.name,
          name: rc.name || tcCycle.name || rc.summary || tcCycle.summary,
          planId: rc.planId || tcCycle.planId || null,
          schedule: rc.schedule || tcCycle.schedule || null,
          environment: rc.environment || tcCycle.environment || '',
          execution: (Array.isArray(rc.execution) && rc.execution.length > 0)
            ? rc.execution
            : (Array.isArray(tcCycle.execution) ? tcCycle.execution : [])
        };
      });

      // Incluir también cualquier ciclo de testCycles que aún no aparezca en reportData.cycles
      baseCycles.forEach(tcCycle => {
        const exists = merged.some(
          mc => String(mc.id) === String(tcCycle.id) || (mc.key && tcCycle.key && String(mc.key) === String(tcCycle.key))
        );
        if (!exists) {
          merged.push(tcCycle);
        }
      });

      return merged;
    }, [reportData, testCycles]);

    // Evalúa si un ciclo pertenece a un Plan de Pruebas (comparando por id y por key usando el mismo criterio de Planning/Execution/Reports)
    const doesCycleMatchPlan = React.useCallback((cycle, planIdOrKey) => {
      if (!cycle || !planIdOrKey || planIdOrKey === 'ALL') return true;
      const targetStr = String(planIdOrKey).trim();
      const tcCycle = (testCycles || []).find(
        tc => String(tc.id) === String(cycle.id) || (tc.key && cycle.key && String(tc.key) === String(cycle.key))
      );
      const effectivePlanId = cycle.planId || tcCycle?.planId || cycle.planKey || tcCycle?.planKey || '';
      const cycleWithPlan = effectivePlanId ? { ...cycle, planId: effectivePlanId } : cycle;

      if (typeof isCycleInPlan === 'function' && isCycleInPlan(cycleWithPlan, targetStr)) {
        return true;
      }
      const selectedPlanObj = (testPlans || []).find(
        p => String(p.id) === targetStr || (p.key && String(p.key).toUpperCase() === targetStr.toUpperCase())
      );
      if (selectedPlanObj) {
        if (typeof isCycleInPlan === 'function') {
          if (isCycleInPlan(cycleWithPlan, selectedPlanObj.id)) return true;
          if (selectedPlanObj.key && isCycleInPlan(cycleWithPlan, selectedPlanObj.key)) return true;
        }
        if (effectivePlanId) {
          const effStr = String(effectivePlanId).trim();
          if (effStr === String(selectedPlanObj.id)) return true;
          if (selectedPlanObj.key && effStr.toUpperCase() === String(selectedPlanObj.key).toUpperCase()) return true;
        }
      }
      return effectivePlanId ? String(effectivePlanId).trim() === targetStr : false;
    }, [testCycles, testPlans, isCycleInPlan]);

    // Filtrar ciclos disponibles según Plan seleccionado
    const planAndEnvFilteredCycles = React.useMemo(() => {
      const list = Array.isArray(sourceCycles) ? sourceCycles : [];
      if (!exitReportPlanId || exitReportPlanId === 'ALL') {
        return list;
      }
      return list.filter(c => doesCycleMatchPlan(c, exitReportPlanId));
    }, [sourceCycles, exitReportPlanId, doesCycleMatchPlan]);

    // Ciclos efectivamente evaluados (todos los del alcance o los marcados manualmente)
    const evaluatedCycles = React.useMemo(() => {
      if (!exitReportCycleIds || exitReportCycleIds.length === 0) {
        return planAndEnvFilteredCycles;
      }
      const idSet = new Set(exitReportCycleIds.map(String));
      return planAndEnvFilteredCycles.filter(c => idSet.has(String(c.id)) || idSet.has(String(c.key)));
    }, [planAndEnvFilteredCycles, exitReportCycleIds]);

    // Cálculo integral de métricas de Ejecución, Defectos y Calculadora de Calidad
    const exitReportData = React.useMemo(() => {
      let totalCases = 0;
      let passed = 0;
      let failed = 0;
      let blocked = 0;
      let notRun = 0;

      const upperProjKey = projectKey ? String(projectKey).trim().toUpperCase() : '';

      // Validación estricta para asegurar que sólo se contabilicen Bugs reales del proyecto
      const isActualBugItem = (bug) => {
        if (!bug || !bug.key) return false;
        if (upperProjKey && !String(bug.key).trim().toUpperCase().startsWith(upperProjKey + '-')) {
          return false;
        }
        if ((testCases || []).some(t => String(t.id) === String(bug.id) || String(t.key) === String(bug.key))) return false;
        if ((testCycles || []).some(c => String(c.id) === String(bug.id) || String(c.key) === String(bug.key))) return false;
        if ((testPlans || []).some(p => String(p.id) === String(bug.id) || String(p.key) === String(bug.key))) return false;
        if (bug.summary && (
          bug.summary.startsWith('[Test Case]') ||
          bug.summary.startsWith('TC-') ||
          bug.summary.startsWith('[Test Plan]') ||
          bug.summary.startsWith('[Test Cycle]')
        )) {
          return false;
        }
        const rawType = String(bug.issuetype || bug.issueType?.name || bug.issueType || bug.rawFields?.issuetype?.name || '').toLowerCase().trim();
        if (rawType) {
          const validBugKeywords = ['bug', 'error', 'defecto', 'defect', 'falla', 'incidente', 'incident', 'problem', 'problema', 'fallo', 'anomalia', 'anomalía'];
          if (!validBugKeywords.some(kw => rawType.includes(kw))) return false;
        }
        return true;
      };

      // Normalización de severidad homologada con el Reporte Ejecutivo
      const normalizeBugSeverity = (rawSev, rawFields, priorityVal) => {
        let s = '';
        if (rawFields?.['customfield_10238']) {
          const sf = rawFields['customfield_10238'];
          s = typeof sf === 'object' ? (sf.value || sf.name || sf.label || String(sf)) : String(sf);
        } else if (rawFields) {
          for (const [fKey, fVal] of Object.entries(rawFields)) {
            if (fKey.startsWith('customfield_') && fVal) {
              const vStr = typeof fVal === 'object' ? (fVal.value || fVal.name || '') : String(fVal);
              if (['bloqueante', 'crítico', 'critico', 'mayor', 'menor', 'medio', 'media', 'blocker', 'critical', 'major', 'minor', 'medium', 'alta', 'high', 'low'].includes(String(vStr).toLowerCase())) {
                s = vStr;
                break;
              }
            }
          }
        }
        if (!s && rawSev && rawSev !== 'N/A' && rawSev !== 'Sin definir') {
          s = String(rawSev).trim();
        }
        if (!s && priorityVal) {
          s = typeof priorityVal === 'object' ? (priorityVal.name || priorityVal.value || '') : String(priorityVal);
        }
        if (!s || s === 'Sin definir' || s === 'N/A') return 'Sin definir';
        const low = s.toLowerCase();
        if (low.includes('bloq') || low.includes('blocker') || low.includes('highest')) return 'Bloqueante';
        if (low.includes('crit') || low.includes('crític')) return 'Crítico';
        if (low.includes('may') || low.includes('major') || low.includes('alta') || low.includes('high')) return 'Mayor';
        if (low.includes('med') || low.includes('medio') || low.includes('media')) return 'Medio';
        if (low.includes('men') || low.includes('minor') || low.includes('baja') || low.includes('low') || low.includes('trivial')) return 'Menor';
        return s;
      };

      // Regla de negocio: sólo 'closed', 'cerrado', 'cerrada' se consideran cerrados; cualquier otro estatus sigue Abierto
      const isBugClosed = (b) => {
        if (!b) return false;
        const st = String(typeof b === 'string' ? b : (b.status || b.fields?.status?.name || b.rawFields?.status?.name || '')).toLowerCase().trim();
        return ['closed', 'cerrado', 'cerrada'].includes(st);
      };

      const bugsMap = new Map();
      const cycleBreakdown = [];

      // 1. Recorrer ciclos evaluados para sumar ejecuciones y recolectar defectos vinculados
      evaluatedCycles.forEach(cycle => {
        let cTotal = 0;
        let cPassed = 0;
        let cFailed = 0;
        let cBlocked = 0;
        let cNotRun = 0;
        const cycleName = formatCleanName(cycle, `Ciclo ${cycle.id || ''}`.trim());

        if (Array.isArray(cycle.execution) && cycle.execution.length > 0) {
          const seenInCycle = new Set();
          cycle.execution.forEach((ex, idx) => {
            const tcObj = typeof findTc === 'function' ? findTc(ex.id) : null;
            const tcKey = ex.key || ex.testCaseKey || tcObj?.key || '';
            const tcId = String(ex.id || ex.testCaseId || '');
            const dedupeKey = tcKey ? `key_${tcKey}` : (tcId ? `id_${tcId}` : `item_${idx}`);
            if (seenInCycle.has(dedupeKey)) return;
            seenInCycle.add(dedupeKey);

            const st = normalizeUiStatus(ex.status);
            cTotal++;
            totalCases++;
            if (st === 'Passed') { cPassed++; passed++; }
            else if (st === 'Failed') { cFailed++; failed++; }
            else if (st === 'Blocked') { cBlocked++; blocked++; }
            else { cNotRun++; notRun++; }

            if (Array.isArray(ex.linkedBugs)) {
              ex.linkedBugs.forEach(rawBug => {
                if (!rawBug || !rawBug.key || !isActualBugItem(rawBug)) return;
                const bKey = rawBug.key;
                const projBug = (unlinkedBugs || []).find(ub => ub.key === bKey);
                const mapBug = reportData?.bugMap?.[bKey];
                const merged = {
                  ...rawBug,
                  ...(mapBug || {}),
                  ...(projBug || {})
                };
                const done = isBugClosed(merged);
                const sev = normalizeBugSeverity(merged.severity, merged.rawFields, merged.priority);
                const statusName = merged.status || merged.rawFields?.status?.name || (done ? 'Cerrado' : 'Abierto');
                const assigneeName = (typeof merged.assignee === 'object' && merged.assignee !== null)
                  ? (merged.assignee.displayName || merged.assignee.name || 'Sin asignar')
                  : (merged.assignee || 'Sin asignar');

                if (!bugsMap.has(bKey)) {
                  bugsMap.set(bKey, {
                    key: bKey,
                    summary: merged.summary || rawBug.summary || 'Defecto detectado en ejecución',
                    severity: sev,
                    priority: sev,
                    status: statusName,
                    isDone: done,
                    assignee: assigneeName,
                    created: merged.created || merged.rawFields?.created || null,
                    cycles: new Set([cycle.key || cycleName])
                  });
                } else {
                  bugsMap.get(bKey).cycles.add(cycle.key || cycleName);
                }
              });
            }
          });
        } else if (typeof cycle.totalTests === 'number' && cycle.totalTests > 0) {
          // Respaldo si el ciclo aún no ha terminado de hidratar su arreglo execution
          cTotal = cycle.totalTests || 0;
          cPassed = cycle.passed || 0;
          cFailed = cycle.failed || 0;
          cBlocked = cycle.blocked || 0;
          cNotRun = Math.max(0, cTotal - (cPassed + cFailed + cBlocked));
          totalCases += cTotal;
          passed += cPassed;
          failed += cFailed;
          blocked += cBlocked;
          notRun += cNotRun;
        }

        const cExecuted = cPassed + cFailed + cBlocked;
        const cCoveragePct = cTotal > 0 ? Math.round((cExecuted / cTotal) * 100) : 0;
        const cSuccessPct = cExecuted > 0 ? Math.round((cPassed / cExecuted) * 100) : 0;
        const cycleUrl = siteBaseUrl && cycle.key ? `${siteBaseUrl}/browse/${cycle.key}` : '';

        cycleBreakdown.push({
          id: cycle.id,
          key: cycle.key || `CYC-${cycle.id}`,
          summary: cycleName,
          name: cycleName,
          environment: cycle.environment || 'QA',
          version: cycle.version || cycle.build || '—',
          status: cycle.status || (cTotal > 0 && cExecuted === cTotal ? 'Completado' : cExecuted > 0 ? 'En Progreso' : 'Pendiente'),
          total: cTotal,
          executed: cExecuted,
          passed: cPassed,
          failed: cFailed,
          blocked: cBlocked,
          notRun: cNotRun,
          coveragePct: cCoveragePct,
          successPct: cSuccessPct,
          url: cycleUrl,
          browseUrl: cycleUrl
        });
      });

      // 2. Si el alcance de defectos incluye todos los del proyecto ('PROJECT' / 'ALL_PROJECT') o si hay bugs en unlinkedBugs vinculados a los ciclos evaluados
      const evaluatedCycleKeys = new Set(evaluatedCycles.map(c => String(c.key || '').trim()).filter(Boolean));

      (unlinkedBugs || []).forEach(ub => {
        if (!isActualBugItem(ub)) return;
        const bKey = ub.key;
        if (bugsMap.has(bKey)) return;

        // Verificar si pertenece a alguno de los ciclos evaluados o si el modo es todo el proyecto
        let matchesEvaluatedScope = exitReportBugScope === 'PROJECT' || exitReportBugScope === 'ALL_PROJECT';
        if (!matchesEvaluatedScope && Array.isArray(ub.linkedTests) && ub.linkedTests.length > 0) {
          // Si no se restringió a ciclos específicos y no hay filtro de plan, incluir bugs vinculados a pruebas del proyecto
          if (exitReportPlanId === 'ALL' && (!exitReportCycleIds || exitReportCycleIds.length === 0)) {
            matchesEvaluatedScope = true;
          }
        }
        if (!matchesEvaluatedScope) return;

        const done = isBugClosed(ub);
        const sev = normalizeBugSeverity(ub.severity, ub.rawFields, ub.priority);
        const statusName = ub.status || ub.rawFields?.status?.name || (done ? 'Cerrado' : 'Abierto');
        const assigneeName = (typeof ub.assignee === 'object' && ub.assignee !== null)
          ? (ub.assignee.displayName || ub.assignee.name || 'Sin asignar')
          : (ub.assignee || 'Sin asignar');

        bugsMap.set(bKey, {
          key: bKey,
          summary: ub.summary || 'Defecto del proyecto',
          severity: sev,
          priority: sev,
          status: statusName,
          isDone: done,
          assignee: assigneeName,
          created: ub.created || ub.rawFields?.created || null,
          cycles: new Set(evaluatedCycleKeys.size > 0 ? ['Proyecto'] : ['General'])
        });
      });

      const allBugsList = Array.from(bugsMap.values()).map(b => ({
        ...b,
        cyclesList: Array.from(b.cycles || [])
      }));
      const openBugsList = allBugsList.filter(b => !b.isDone);
      const closedBugsList = allBugsList.filter(b => b.isDone);

      // Identificar Blockers / Bloqueantes abiertos
      const isBlockerBug = (b) => {
        const sevLow = String(b.severity || '').toLowerCase();
        return sevLow.includes('bloq') || sevLow.includes('blocker') || sevLow === 'highest';
      };
      const openBlockersList = openBugsList.filter(isBlockerBug);
      const totalBlockersList = allBugsList.filter(isBlockerBug);

      // Métricas reales de Ejecución
      const executedCases = passed + failed + blocked;
      const realCoveragePct = totalCases > 0 ? Number(((executedCases / totalCases) * 100).toFixed(1)) : 0;
      const realSuccessPct = executedCases > 0 ? Number(((passed / executedCases) * 100).toFixed(1)) : 0;
      const realSuccessTotalPct = totalCases > 0 ? Number(((passed / totalCases) * 100).toFixed(1)) : 0;

      // Métricas reales de Defectos
      const totalBugsCount = allBugsList.length;
      const openBugsCount = openBugsList.length;
      const closedBugsCount = closedBugsList.length;
      const openBlockersCount = openBlockersList.length;

      // Tasa de Error (% Bugs abiertos = Bugs abiertos entre casos de prueba)
      const realOpenBugsPct = totalCases > 0
        ? Number(((openBugsCount / totalCases) * 100).toFixed(2))
        : (openBugsCount > 0 ? 100 : 0);

      // % Bugs blockers (Bugs abiertos blockers / bugs abiertos)
      const realBlockersPct = openBugsCount > 0
        ? Number(((openBlockersCount / openBugsCount) * 100).toFixed(1))
        : 0;

      // ========================================================================
      // CALCULADORA DE CALIDAD (REGLAS OFICIALES DE PUNTUACIÓN — MÁX. 15 PUNTOS)
      // ========================================================================
      const evalCoveragePct = exitSimEnabled ? Number(exitSimCoverage || 0) : realCoveragePct;
      const evalOpenBugsPct = exitSimEnabled ? Number(exitSimOpenBugsPct || 0) : realOpenBugsPct;
      const evalOpenBlockersCount = exitSimEnabled ? Number(exitSimOpenBlockers || 0) : openBlockersCount;
      const evalBlockersPct = exitSimEnabled
        ? (evalOpenBlockersCount > 0 ? 100 : 0)
        : realBlockersPct;

      // 1. % Cobertura: > 90% -> 5 pts (Verde) | 80% - 90% -> 3 pts (Amarillo) | < 80% -> 1 pt (Rojo)
      let coveragePoints = 1;
      let coverageColor = 'RED';
      if (evalCoveragePct > 90) {
        coveragePoints = 5;
        coverageColor = 'GREEN';
      } else if (evalCoveragePct >= 80 && evalCoveragePct <= 90) {
        coveragePoints = 3;
        coverageColor = 'YELLOW';
      } else {
        coveragePoints = 1;
        coverageColor = 'RED';
      }

      // 2. % Bugs abiertos (Tasa de Error): 0% - 1% -> 5 pts (Verde) | 2% - 5% -> 3 pts (Amarillo) | > 5% -> 1 pt (Rojo)
      let openBugsPoints = 1;
      let openBugsColor = 'RED';
      if (evalOpenBugsPct <= 1) {
        openBugsPoints = 5;
        openBugsColor = 'GREEN';
      } else if (evalOpenBugsPct > 1 && evalOpenBugsPct <= 5) {
        openBugsPoints = 3;
        openBugsColor = 'YELLOW';
      } else {
        openBugsPoints = 1;
        openBugsColor = 'RED';
      }

      // 3. % Bugs blockers: 0% (0 blockers abiertos) -> 5 pts (Verde) | >= 1 blocker abierto -> 1 pt (Rojo)
      let blockersPoints = 1;
      let blockersColor = 'RED';
      if (evalOpenBlockersCount === 0) {
        blockersPoints = 5;
        blockersColor = 'GREEN';
      } else {
        blockersPoints = 1;
        blockersColor = 'RED';
      }

      // Puntaje Total (Suma de las 3 métricas, máx. 15 puntos)
      const totalPoints = coveragePoints + openBugsPoints + blockersPoints;

      // Asignación de Resultado de Calidad:
      // Alta: 13 a 15 puntos (Verde) | Media: 11 a 12 puntos (Amarillo) | Baja: 0 a 10 puntos (Rojo)
      let qualityLevel = 'Baja';
      let qualitySemaphore = 'RED';
      let qualityBadgeBg = '#FFEBE6';
      let qualityBadgeColor = '#BF2600';
      let qualityBorderColor = '#DE350B';
      let qualityHex = '#DE350B';
      let qualityRecommendationText = 'Calidad Baja — No se recomienda la salida a producción en el estado actual debido a riesgos críticos en cobertura, tasa de error o defectos bloqueantes abiertos.';

      if (totalPoints >= 13) {
        qualityLevel = 'Alta';
        qualitySemaphore = 'GREEN';
        qualityBadgeBg = '#E3FCEF';
        qualityBadgeColor = '#006644';
        qualityBorderColor = '#36B37E';
        qualityHex = '#00875A';
        qualityRecommendationText = 'Calidad Alta — Recomendación de Calidad FAVORABLE. Las métricas de cobertura y estabilidad cumplen los umbrales establecidos.';
      } else if (totalPoints >= 11) {
        qualityLevel = 'Media';
        qualitySemaphore = 'YELLOW';
        qualityBadgeBg = '#FFFAE6';
        qualityBadgeColor = '#974F0C';
        qualityBorderColor = '#FFAB00';
        qualityHex = '#FF8B00';
        qualityRecommendationText = 'Calidad Media — Recomendación de Calidad CON RESERVAS. Se sugiere revisar las observaciones y mitigar los hallazgos pendientes.';
      }

      // Generar hipervínculo JQL consolidado hacia los ciclos ejecutados
      const validCycleKeys = cycleBreakdown
        .map(c => c.key)
        .filter(k => k && !String(k).startsWith('CYC-'));
      const cyclesJqlUrl = (siteBaseUrl && validCycleKeys.length > 0)
        ? `${siteBaseUrl}/issues/?jql=${encodeURIComponent(`key in (${validCycleKeys.join(',')}) ORDER BY key ASC`)}`
        : (siteBaseUrl && projectKey ? `${siteBaseUrl}/jira/software/c/projects/${projectKey}/issues` : '');

      const selectedPlanObj = exitReportPlanId !== 'ALL'
        ? (testPlans || []).find(p => String(p.id) === String(exitReportPlanId) || String(p.key) === String(exitReportPlanId))
        : null;
      const planLabel = selectedPlanObj
        ? formatCleanName(selectedPlanObj, 'Plan de Pruebas')
        : 'Todos los Planes de Prueba';

      const semaphoreEmoji = qualitySemaphore === 'GREEN' ? '🟢' : qualitySemaphore === 'YELLOW' ? '🟡' : '🔴';
      const semaphoreTitle = qualitySemaphore === 'GREEN'
        ? 'SEMÁFORO VERDE'
        : qualitySemaphore === 'YELLOW'
          ? 'SEMÁFORO AMARILLO'
          : 'SEMÁFORO ROJO';

      return {
        totalCases,
        executedCases,
        passed,
        failed,
        blocked,
        notRun,
        unexecuted: notRun,
        inProgress: 0,
        coveragePct: evalCoveragePct,
        realCoveragePct,
        successPct: realSuccessPct,
        successTotalPct: realSuccessTotalPct,
        totalBugsCount,
        totalBugs: totalBugsCount,
        openBugsCount,
        closedBugsCount,
        openBlockersCount: evalOpenBlockersCount,
        openBlockerBugsCount: evalOpenBlockersCount,
        realOpenBlockerBugsCount: openBlockersCount,
        totalBlockersCount: totalBlockersList.length,
        hasOpenBlockers: evalOpenBlockersCount > 0,
        openBugsPct: evalOpenBugsPct,
        errorRatePct: evalOpenBugsPct,
        realErrorRatePct: realOpenBugsPct,
        blockersPct: evalBlockersPct,
        blockerBugsPct: evalBlockersPct,
        allBugsList,
        openBugsList,
        openBlockersList,
        openBlockerBugs: openBlockersList,
        cycleBreakdown,
        cycleSummaries: cycleBreakdown,
        cyclesInPlan: planAndEnvFilteredCycles,
        cyclesJqlUrl,
        validCycleKeys,
        cycleKeys: validCycleKeys,
        coveragePoints,
        openBugsPoints,
        blockersPoints,
        blockerPoints: blockersPoints,
        totalPoints,
        maxPoints: 15,
        qualityLevel: qualityLevel.toUpperCase(),
        semaphoreEmoji,
        semaphoreTitle,
        recommendationText: qualityRecommendationText,
        planLabel,
        calculator: {
          evalCoveragePct,
          evalOpenBugsPct,
          evalOpenBlockersCount,
          evalBlockersPct,
          coveragePoints,
          coverageColor,
          openBugsPoints,
          openBugsColor,
          blockersPoints,
          blockersColor,
          totalPoints,
          maxPoints: 15,
          qualityLevel,
          qualitySemaphore,
          qualityBadgeBg,
          qualityBadgeColor,
          qualityBorderColor,
          qualityHex,
          qualityRecommendationText
        }
      };
    }, [
      evaluatedCycles,
      planAndEnvFilteredCycles,
      unlinkedBugs,
      reportData,
      projectKey,
      testCases,
      testCycles,
      testPlans,
      findTc,
      siteBaseUrl,
      exitReportBugScope,
      exitReportPlanId,
      exitReportCycleIds,
      exitSimEnabled,
      exitSimCoverage,
      exitSimOpenBugsPct,
      exitSimOpenBlockers,
      formatCleanName
    ]);

    // Aplica estilos CSSOM en línea para respetar el CSP estricto de Atlassian Forge (style-src 'self')
    // Primero captura los atributos [style] originales antes de aplicar las reglas de document.styleSheets,
    // evitando que el navegador sobrescriba el atributo style antes de leerlo.
    const applyExitReportInlineStyles = React.useCallback((rootEl) => {
      if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
      try {
        // 1. Capturar todos los atributos style="..." originales antes de mutar el.style
        const styledNodes = [rootEl, ...Array.from(rootEl.querySelectorAll('[style]'))];
        const originalStyles = styledNodes.map((el) => ({
          el,
          raw: (el && el.getAttribute) ? (el.getAttribute('style') || '') : ''
        }));

        // 2. Aplicar reglas de hojas de estilo activas (.tp-er-*, .tp-exit-*, .tp-print-*)
        for (const sheet of Array.from(document.styleSheets || [])) {
          let rules;
          try { rules = sheet.cssRules; } catch (_) { continue; }
          if (!rules) continue;
          for (const rule of Array.from(rules)) {
            if (rule.type !== 1 || !rule.selectorText) continue;
            if (
              !rule.selectorText.includes('tp-er') &&
              !rule.selectorText.includes('tp-exit') &&
              !rule.selectorText.includes('tp-print')
            ) {
              continue;
            }
            let matched = [];
            try { matched = Array.from(rootEl.querySelectorAll(rule.selectorText)); } catch (_) { continue; }
            for (const el of matched) {
              for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                const val = rule.style.getPropertyValue(prop);
                const prio = rule.style.getPropertyPriority(prop);
                try { el.style.setProperty(prop, val, prio); } catch (_) {}
              }
            }
          }
        }

        // 3. Reaplicar los atributos style="..." originales con prioridad !important
        originalStyles.forEach(({ el, raw }) => {
          if (!el || !raw) return;
          raw.split(';').forEach((decl) => {
            const colonIdx = decl.indexOf(':');
            if (colonIdx === -1) return;
            const prop = decl.slice(0, colonIdx).trim();
            let val = decl.slice(colonIdx + 1).trim();
            if (!prop || !val) return;
            if (/!important$/i.test(val)) {
              val = val.replace(/!important$/i, '').trim();
            }
            try {
              el.style.setProperty(prop, val, 'important');
            } catch (_) {}
          });
        });
      } catch (err) {
        console.warn('[TestingExitReport] applyExitReportInlineStyles warning:', err);
      }
    }, []);

    // Construye el documento HTML del Testing Exit Report homologado 100% con la Vista General y el Formato Ejecutivo Liverpool
    const buildTestingExitReportHtml = React.useCallback(() => {
      const d = exitReportData;
      const calc = d.calculator;
      const todayStr = new Date().toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const selectedPlanObj = exitReportPlanId !== 'ALL'
        ? (testPlans || []).find(p => String(p.id) === String(exitReportPlanId) || String(p.key) === String(exitReportPlanId))
        : null;
      const planLabel = selectedPlanObj
        ? formatCleanName(selectedPlanObj, 'Plan de Pruebas')
        : 'Todos los Planes de Prueba';
      const envLabel = exitReportEnv === 'ALL' ? 'Todos los Ambientes' : exitReportEnv;
      const buildLabel = exitReportBuild?.trim() || 'Release Actual';

      const pPass = d.totalCases > 0 ? ((d.passed / d.totalCases) * 100).toFixed(1) : '0.0';
      const pFail = d.totalCases > 0 ? ((d.failed / d.totalCases) * 100).toFixed(1) : '0.0';
      const pBlock = d.totalCases > 0 ? ((d.blocked / d.totalCases) * 100).toFixed(1) : '0.0';
      const pNotRun = d.totalCases > 0 ? ((d.notRun / d.totalCases) * 100).toFixed(1) : '100.0';

      const semaphoreIcon = calc.qualitySemaphore === 'GREEN' ? '🟢' : calc.qualitySemaphore === 'YELLOW' ? '🟡' : '🔴';
      const semaphoreClass = calc.qualitySemaphore === 'GREEN' ? 'green' : calc.qualitySemaphore === 'YELLOW' ? 'yellow' : 'red';

      const verdictTheme = calc.qualitySemaphore === 'GREEN'
        ? { bg: '#DCFCE7', border: '#16A34A', titleColor: '#15803D', textColor: '#14532D', labelColor: '#166534', dashColor: '#86EFAC' }
        : calc.qualitySemaphore === 'YELLOW'
          ? { bg: '#FEF3C7', border: '#D97706', titleColor: '#B45309', textColor: '#78350F', labelColor: '#92400E', dashColor: '#FCD34D' }
          : { bg: '#FEE2E2', border: '#DC2626', titleColor: '#B91C1C', textColor: '#7F1D1D', labelColor: '#991B1B', dashColor: '#FCA5A5' };

      const observationsHtml = (exitReportObservations && exitReportObservations.trim())
        ? exitReportObservations.trim().replace(/\n/g, '<br/>')
        : 'Sin observaciones adicionales registradas al momento de emitir este Testing Exit Report.';

      const cycleLinksPillsHtml = d.cycleBreakdown.length > 0
        ? d.cycleBreakdown.map((c) => {
          const cleanCycleTitle = formatCleanName(c, 'Ciclo de Pruebas');
          if (c.url) {
            return `<a href="${c.url}" target="_blank" rel="noopener noreferrer" class="tp-exit-cycle-pill" style="display: inline-block; padding: 2px 7px; margin: 2px 3px 2px 0; border-radius: 10px; background-color: #ffffff; border: 1px solid #CBD5E1; font-size: 9.5px; font-weight: 700; color: #E1007A; text-decoration: none;">🔗 ${cleanCycleTitle} ↗</a>`;
          }
          return `<span class="tp-exit-cycle-pill" style="display: inline-block; padding: 2px 7px; margin: 2px 3px 2px 0; border-radius: 10px; background-color: #ffffff; border: 1px solid #CBD5E1; font-size: 9.5px; font-weight: 700; color: #002D62;">${cleanCycleTitle}</span>`;
        }).join('')
        : `<span style="font-size: 10.5px; color: #64748B; font-style: italic;">No hay ciclos registrados en este alcance.</span>`;

      return `
<div class="tp-exit-root" style="max-width: 780px; margin: 0 auto; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #172B4D; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0, 45, 98, 0.07);">
  
  <!-- HEADER BANNER CORPORATIVO LIVERPOOL COMPACTO (1 HOJA PDF) -->
  <div class="tp-exit-header-banner" style="background: linear-gradient(135deg, #E1007A 0%, #002D62 100%); background-color: #E1007A; color: #ffffff; padding: 10px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-er-header-table" style="width: 100%; border-collapse: collapse;">
      <tr>
        <td class="tp-er-header-left" style="vertical-align: middle;">
          <div style="font-size: 10.5px; font-weight: 800; letter-spacing: 0.9px; text-transform: uppercase; color: #FFE0F0; margin-bottom: 3px;">
            ⚡ TEST PULSE SUITE • TESTING EXIT REPORT (CIERRE DE PRUEBAS)
          </div>
          <div style="margin-top: 2px;">
            <img src="${LIVERPOOL_LOGO_WHITE_B64}" alt="El Puerto de Liverpool" class="liverpool-animated-logo" style="height: 22px; width: auto; max-width: 125px; display: block; border: 0;" />
          </div>
        </td>
        <td class="tp-er-header-right" style="vertical-align: middle; text-align: right;">
          <span style="display: inline-block; padding: 4px 10px; background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 14px; font-size: 10.5px; font-weight: 600; color: #ffffff;">
            📅 ${todayStr}
          </span>
        </td>
      </tr>
    </table>
  </div>

  <div class="tp-exit-body" style="padding: 10px 14px; background-color: #ffffff;">

    <!-- LEYENDA OFICIAL: NO ES UN VoBo, SÓLO UNA RECOMENDACIÓN DE CALIDAD -->
    <div class="tp-exit-warning-box" style="margin-bottom: 8px; background-color: #FFFBEB; border: 1px solid #FDE68A; border-left: 4px solid #D97706; border-radius: 6px; padding: 6px 10px;">
      <div class="tp-exit-warning-title" style="font-size: 10px; font-weight: 800; color: #B45309; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px;">
        ⚠️ AVISO IMPORTANTE — NO ES UN VoBo (VISTO BUENO)
      </div>
      <div class="tp-exit-warning-body" style="font-size: 10.5px; color: #78350F; line-height: 1.35;">
        Este <strong>Testing Exit Report</strong> y el resultado del <strong>Semáforo de Calidad</strong> <u>NO constituyen un Visto Bueno (VoBo)</u> ni una autorización formal de liberación a Producción. Representan únicamente una <strong>recomendación de Calidad (QA)</strong> basada en las métricas registradas al momento del corte.
      </div>
    </div>

    <!-- ENCABEZADO DEL PROYECTO Y SEMÁFORO DE CALIDAD (FONDO PINTADO DEL COLOR DEL SEMÁFORO) -->
    <div class="tp-exit-project-banner tp-exit-project-banner-${semaphoreClass}" style="background-color: ${verdictTheme.bg}; border: 1.5px solid ${verdictTheme.border}; border-left: 5px solid ${verdictTheme.border}; border-radius: 8px; padding: 9px 12px; margin-bottom: 8px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin-bottom: 6px;">
        <tr>
          <td width="38%" style="padding: 0 6px 5px 0; vertical-align: top;">
            <div style="font-size: 9px; font-weight: 800; color: ${verdictTheme.labelColor}; text-transform: uppercase; letter-spacing: 0.4px;">PROYECTO</div>
            <div style="font-size: 13.5px; font-weight: 900; color: ${verdictTheme.textColor}; margin-top: 1px;">${projectName} (${projectKey})</div>
          </td>
          <td width="34%" style="padding: 0 6px 5px 6px; vertical-align: top;">
            <div style="font-size: 9px; font-weight: 800; color: ${verdictTheme.labelColor}; text-transform: uppercase; letter-spacing: 0.4px;">PLAN DE PRUEBAS</div>
            <div style="font-size: 11.5px; font-weight: 800; color: ${verdictTheme.textColor}; margin-top: 1px;">${planLabel}</div>
          </td>
          <td width="28%" style="padding: 0 0 5px 6px; vertical-align: top;">
            <div style="font-size: 9px; font-weight: 800; color: ${verdictTheme.labelColor}; text-transform: uppercase; letter-spacing: 0.4px;">AMBIENTE / VERSIÓN</div>
            <div style="font-size: 11.5px; font-weight: 800; color: ${verdictTheme.textColor}; margin-top: 1px;">${envLabel} • ${buildLabel}</div>
          </td>
        </tr>
      </table>

      <!-- SEMÁFORO DE CALIDAD CON GRÁFICO DE 3 LUCES HOMOLOGADO CON LA VISTA GENERAL -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin: 0; border-top: 1px dashed ${verdictTheme.dashColor};">
        <tr>
          <td width="34" style="padding: 6px 10px 0 0; vertical-align: middle; width: 34px;">
            <div class="tp-exit-traffic-pill" style="display: inline-block; background-color: #090d11; padding: 5px; border-radius: 16px; border: 1px solid #30363d;">
              <span class="tp-exit-light ${d.qualityLevel === 'BAJA' ? 'tp-exit-light-red-on' : 'tp-exit-light-red-off'}" style="display: block; width: 12px; height: 12px; border-radius: 50%; margin-bottom: 3px; background-color: ${d.qualityLevel === 'BAJA' ? '#ff4d4f' : '#3b1d1d'}; ${d.qualityLevel === 'BAJA' ? 'box-shadow: 0 0 8px #ff4d4f;' : ''}"></span>
              <span class="tp-exit-light ${d.qualityLevel === 'MEDIA' ? 'tp-exit-light-yellow-on' : 'tp-exit-light-yellow-off'}" style="display: block; width: 12px; height: 12px; border-radius: 50%; margin-bottom: 3px; background-color: ${d.qualityLevel === 'MEDIA' ? '#faad14' : '#3b3118'}; ${d.qualityLevel === 'MEDIA' ? 'box-shadow: 0 0 8px #faad14;' : ''}"></span>
              <span class="tp-exit-light ${d.qualityLevel === 'ALTA' ? 'tp-exit-light-green-on' : 'tp-exit-light-green-off'}" style="display: block; width: 12px; height: 12px; border-radius: 50%; background-color: ${d.qualityLevel === 'ALTA' ? '#52c41a' : '#183820'}; ${d.qualityLevel === 'ALTA' ? 'box-shadow: 0 0 8px #52c41a;' : ''}"></span>
            </div>
          </td>
          <td style="padding: 6px 0 0 0; vertical-align: middle;">
            <div style="font-size: 13.5px; font-weight: 900; color: ${verdictTheme.titleColor}; margin-bottom: 2px;">
              ${semaphoreIcon} ${d.semaphoreTitle} — CALIDAD ${d.qualityLevel}
            </div>
            <div style="font-size: 11px; color: ${verdictTheme.textColor}; line-height: 1.35; margin-bottom: 2px;">
              ${d.recommendationText}
            </div>
            <div style="font-size: 9.5px; font-weight: 700; color: ${verdictTheme.labelColor};">
              * Nota: Este resultado NO es un VoBo, únicamente representa una recomendación de Calidad.
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- 1. RESUMEN DE EJECUCIONES -->
    <div class="tp-exit-section-card" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 9px 12px; margin-bottom: 8px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin: 0 0 6px 0;">
        <tr>
          <td style="padding: 0; text-align: left; vertical-align: middle;">
            <span class="tp-exit-section-title" style="font-size: 11px; font-weight: 800; color: #002D62; text-transform: uppercase; letter-spacing: 0.3px;">
              📊 1. RESUMEN DE EJECUCIONES
            </span>
          </td>
          <td style="padding: 0; text-align: right; vertical-align: middle;">
            <span style="display: inline-block; font-size: 10px; color: #475569; font-weight: 700; background-color: #E2E8F0; padding: 2px 8px; border-radius: 10px;">
              ${d.cycleBreakdown.length} ciclo(s)
            </span>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-exit-kpi-table" style="width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 6px 0;">
        <tr>
          <td width="33.333%" class="tp-exit-kpi-td-3-first" style="width: 33.333%; padding: 0 4px 0 0; vertical-align: top;">
            <div class="tp-exit-kpi-box tp-exit-kpi-box-pink" style="background-color: #FFF0F7; border: 1px solid #FBCFE8; border-top: 3px solid #E1007A; border-radius: 6px; padding: 6px 6px; text-align: center; box-sizing: border-box;">
              <div style="font-size: 18px; font-weight: 900; color: #E1007A; line-height: 1.15;">${d.totalCases}</div>
              <div style="font-size: 9.5px; font-weight: 800; color: #9D174D; text-transform: uppercase; margin-top: 2px; line-height: 1.2;">Total de Casos</div>
            </div>
          </td>
          <td width="33.333%" class="tp-exit-kpi-td-3-mid" style="width: 33.333%; padding: 0 4px; vertical-align: top;">
            <div class="tp-exit-kpi-box tp-exit-kpi-box-blue" style="background-color: #F0F9FF; border: 1px solid #BAE6FD; border-top: 3px solid #0284C7; border-radius: 6px; padding: 6px 6px; text-align: center; box-sizing: border-box;">
              <div style="font-size: 18px; font-weight: 900; color: #0284C7; line-height: 1.15;">${d.coveragePct}%</div>
              <div style="font-size: 9.5px; font-weight: 800; color: #075985; text-transform: uppercase; margin-top: 2px; line-height: 1.2;">Cobertura (${d.executedCases}/${d.totalCases})</div>
            </div>
          </td>
          <td width="33.333%" class="tp-exit-kpi-td-3-last" style="width: 33.333%; padding: 0 0 0 4px; vertical-align: top;">
            <div class="tp-exit-kpi-box tp-exit-kpi-box-green" style="background-color: #F0FDF4; border: 1px solid #BBF7D0; border-top: 3px solid #16A34A; border-radius: 6px; padding: 6px 6px; text-align: center; box-sizing: border-box;">
              <div style="font-size: 18px; font-weight: 900; color: #16A34A; line-height: 1.15;">${d.successPct}%</div>
              <div style="font-size: 9.5px; font-weight: 800; color: #166534; text-transform: uppercase; margin-top: 2px; line-height: 1.2;">Éxito (${d.passed}/${d.executedCases})</div>
            </div>
          </td>
        </tr>
      </table>

      <div style="border-radius: 4px; overflow: hidden; border: 1px solid #CBD5E1; margin-bottom: 4px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin: 0; height: 7px;">
          <tr>
            ${Number(pPass) > 0 ? `<td width="${pPass}%" style="padding: 0; background-color: #16A34A; height: 7px;" title="Pasados: ${d.passed} (${pPass}%)"></td>` : ''}
            ${Number(pFail) > 0 ? `<td width="${pFail}%" style="padding: 0; background-color: #DC2626; height: 7px;" title="Fallidos: ${d.failed} (${pFail}%)"></td>` : ''}
            ${Number(pBlock) > 0 ? `<td width="${pBlock}%" style="padding: 0; background-color: #F59E0B; height: 7px;" title="Bloqueados: ${d.blocked} (${pBlock}%)"></td>` : ''}
            ${Number(pNotRun) > 0 ? `<td width="${pNotRun}%" style="padding: 0; background-color: #94A3B8; height: 7px;" title="Sin Ejecutar: ${d.notRun} (${pNotRun}%)"></td>` : ''}
            ${d.totalCases === 0 ? `<td width="100%" style="padding: 0; background-color: #94A3B8; height: 7px;"></td>` : ''}
          </tr>
        </table>
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin: 0; font-size: 10.5px; color: #334155;">
        <tr>
          <td width="25%" style="padding: 1px 2px 0 0; vertical-align: middle;">
            ✅ <strong style="color: #16A34A;">${d.passed}</strong> Pasados (${pPass}%)
          </td>
          <td width="25%" style="padding: 1px 2px 0 2px; vertical-align: middle;">
            ❌ <strong style="color: #DC2626;">${d.failed}</strong> Fallidos (${pFail}%)
          </td>
          <td width="25%" style="padding: 1px 2px 0 2px; vertical-align: middle;">
            🚫 <strong style="color: #D97706;">${d.blocked}</strong> Bloqueados (${pBlock}%)
          </td>
          <td width="25%" style="padding: 1px 0 0 2px; vertical-align: middle;">
            ⏳ <strong>${d.notRun}</strong> Sin Ejecutar (${pNotRun}%)
          </td>
        </tr>
      </table>
    </div>

    <!-- 2. RESUMEN DE DEFECTOS -->
    <div class="${d.hasOpenBlockers ? 'tp-exit-section-card-alert' : 'tp-exit-section-card'}" style="background-color: ${d.hasOpenBlockers ? '#FEF2F2' : '#F8FAFC'}; border: 1px solid ${d.hasOpenBlockers ? '#FECACA' : '#E2E8F0'}; border-radius: 8px; padding: 9px 12px; margin-bottom: 8px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin: 0 0 6px 0;">
        <tr>
          <td style="padding: 0; text-align: left; vertical-align: middle;">
            <span class="tp-exit-section-title" style="font-size: 11px; font-weight: 800; color: #002D62; text-transform: uppercase; letter-spacing: 0.3px;">
              🐞 2. RESUMEN DE DEFECTOS
            </span>
          </td>
          <td style="padding: 0; text-align: right; vertical-align: middle;">
            <span style="display: inline-block; font-size: 9.5px; font-weight: 800; padding: 2px 8px; border-radius: 10px; background-color: ${d.hasOpenBlockers ? '#FEE2E2' : '#DCFCE7'}; color: ${d.hasOpenBlockers ? '#B91C1C' : '#15803D'}; border: 1px solid ${d.hasOpenBlockers ? '#FCA5A5' : '#86EFAC'};">
              ${d.hasOpenBlockers ? `🚨 BLOCKERS ABIERTOS: SÍ (${d.openBlockersCount})` : '✅ BLOCKERS ABIERTOS: NO (0)'}
            </span>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-exit-kpi-table-no-mb" style="width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0;">
        <tr>
          <td width="25%" class="tp-exit-kpi-td-4-first" style="width: 25%; padding: 0 4px 0 0; vertical-align: top;">
            <div class="tp-exit-kpi-box tp-exit-kpi-box-slate" style="background-color: #ffffff; border: 1px solid #CBD5E1; border-top: 3px solid #475569; border-radius: 6px; padding: 6px 6px; text-align: center; box-sizing: border-box;">
              <div style="font-size: 17px; font-weight: 900; color: #0F172A; line-height: 1.15;">${d.totalBugsCount}</div>
              <div style="font-size: 9px; font-weight: 800; color: #475569; text-transform: uppercase; margin-top: 2px; line-height: 1.2;">Total Defectos</div>
            </div>
          </td>
          <td width="25%" class="tp-exit-kpi-td-4-mid" style="width: 25%; padding: 0 4px; vertical-align: top;">
            <div class="tp-exit-kpi-box ${d.openBugsCount > 0 ? 'tp-exit-kpi-box-amber' : 'tp-exit-kpi-box-green'}" style="background-color: ${d.openBugsCount > 0 ? '#FFFBEB' : '#F0FDF4'}; border: 1px solid ${d.openBugsCount > 0 ? '#FDE68A' : '#BBF7D0'}; border-top: 3px solid ${d.openBugsCount > 0 ? '#D97706' : '#16A34A'}; border-radius: 6px; padding: 6px 6px; text-align: center; box-sizing: border-box;">
              <div style="font-size: 17px; font-weight: 900; color: ${d.openBugsCount > 0 ? '#B45309' : '#15803D'}; line-height: 1.15;">${d.openBugsCount}</div>
              <div style="font-size: 9px; font-weight: 800; color: ${d.openBugsCount > 0 ? '#92400E' : '#166534'}; text-transform: uppercase; margin-top: 2px; line-height: 1.2;">Defectos Abiertos</div>
            </div>
          </td>
          <td width="25%" class="tp-exit-kpi-td-4-mid" style="width: 25%; padding: 0 4px; vertical-align: top;">
            <div class="tp-exit-kpi-box ${d.openBugsPct > 5 ? 'tp-exit-kpi-box-red' : d.openBugsPct > 1 ? 'tp-exit-kpi-box-amber' : 'tp-exit-kpi-box-green'}" style="background-color: ${d.openBugsPct > 5 ? '#FEF2F2' : d.openBugsPct > 1 ? '#FFFBEB' : '#F0FDF4'}; border: 1px solid ${d.openBugsPct > 5 ? '#FECACA' : d.openBugsPct > 1 ? '#FDE68A' : '#BBF7D0'}; border-top: 3px solid ${d.openBugsPct > 5 ? '#DC2626' : d.openBugsPct > 1 ? '#D97706' : '#16A34A'}; border-radius: 6px; padding: 6px 6px; text-align: center; box-sizing: border-box;">
              <div style="font-size: 17px; font-weight: 900; color: ${d.openBugsPct > 5 ? '#DC2626' : d.openBugsPct > 1 ? '#B45309' : '#15803D'}; line-height: 1.15;">${d.openBugsPct}%</div>
              <div style="font-size: 9px; font-weight: 800; color: ${d.openBugsPct > 5 ? '#991B1B' : d.openBugsPct > 1 ? '#92400E' : '#166534'}; text-transform: uppercase; margin-top: 2px; line-height: 1.2;">Tasa de Error</div>
            </div>
          </td>
          <td width="25%" class="tp-exit-kpi-td-4-last" style="width: 25%; padding: 0 0 0 4px; vertical-align: top;">
            <div class="tp-exit-kpi-box ${d.hasOpenBlockers ? 'tp-exit-kpi-box-red' : 'tp-exit-kpi-box-green'}" style="background-color: ${d.hasOpenBlockers ? '#FEF2F2' : '#F0FDF4'}; border: 1px solid ${d.hasOpenBlockers ? '#FECACA' : '#BBF7D0'}; border-top: 3px solid ${d.hasOpenBlockers ? '#DC2626' : '#16A34A'}; border-radius: 6px; padding: 6px 6px; text-align: center; box-sizing: border-box;">
              <div style="font-size: 17px; font-weight: 900; color: ${d.hasOpenBlockers ? '#DC2626' : '#15803D'}; line-height: 1.15;">${d.hasOpenBlockers ? `SÍ (${d.openBlockersCount})` : 'NO (0)'}</div>
              <div style="font-size: 9px; font-weight: 800; color: ${d.hasOpenBlockers ? '#991B1B' : '#166534'}; text-transform: uppercase; margin-top: 2px; line-height: 1.2;">Blockers Abiertos</div>
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- 3. APARTADO DE OBSERVACIONES Y 4. LINK A LOS CICLOS EN 2 COLUMNAS (IGUAL A VISTA GENERAL Y COMPACTO 1 HOJA) -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 8px 0;">
      <tr>
        <td width="49%" class="tp-exit-col-left" style="width: 49%; padding: 0 5px 0 0; vertical-align: top;">
          <div class="tp-exit-section-card" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 9px 11px; margin-bottom: 0;">
            <div class="tp-exit-section-title" style="font-size: 11px; font-weight: 800; color: #002D62; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 5px;">
              📝 3. APARTADO DE OBSERVACIONES
            </div>
            <div style="font-size: 11px; color: #1E293B; line-height: 1.4; background-color: #ffffff; border: 1px solid #CBD5E1; border-radius: 6px; padding: 7px 9px; min-height: 44px;">
              ${observationsHtml}
            </div>
          </div>
        </td>
        <td width="49%" class="tp-exit-col-right" style="width: 49%; padding: 0 0 0 5px; vertical-align: top;">
          <div class="tp-exit-section-card" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 9px 11px; margin-bottom: 0;">
            <div class="tp-exit-section-title" style="font-size: 11px; font-weight: 800; color: #002D62; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 5px;">
              🔗 4. LINK A LOS CICLOS PARA REVISAR LO EJECUTADO
            </div>
            <div style="font-size: 10.5px; color: #1E293B; background-color: #F0F9FF; border: 1px solid #BAE6FD; border-radius: 6px; padding: 7px 9px; min-height: 44px;">
              <div style="margin-bottom: 5px;">
                ${d.cyclesJqlUrl
                  ? `<a href="${d.cyclesJqlUrl}" target="_blank" rel="noopener noreferrer" class="tp-er-issue-link-pink" style="color: #E1007A; font-weight: 800; font-size: 11px; text-decoration: underline;">🔗 Ver todos los ciclos evaluados en Jira (${d.cycleBreakdown.length} ciclo(s)) ↗</a>`
                  : 'Seleccione un proyecto con ciclos sincronizados en Jira para habilitar el enlace directo.'
                }
              </div>
              <div>
                ${cycleLinksPillsHtml}
              </div>
            </div>
          </div>
        </td>
      </tr>
    </table>

    <!-- FOOTER CORPORATIVO COMPACTO -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-exit-footer-table" style="width: 100%; border-top: 1px solid #E2E8F0; padding-top: 5px; font-size: 9.5px; color: #94A3B8; border-collapse: collapse;">
      <tr>
        <td class="tp-exit-footer-td-left" style="text-align: left; padding: 3px 0 0 0;">
          Generado por <strong>Test Pulse Suite ${APP_VERSION} © El Puerto de Liverpool</strong> • Testing Exit Report
        </td>
        <td class="tp-exit-footer-td-right" style="text-align: right; padding: 3px 0 0 0;">
          ⚠️ No es un VoBo — Sólo una Recomendación de Calidad
        </td>
      </tr>
    </table>

  </div>
</div>
      `.trim();
    }, [
      exitReportData,
      exitReportPlanId,
      exitReportEnv,
      exitReportBuild,
      exitReportObservations,
      projectName,
      projectKey,
      testPlans,
      siteBaseUrl
    ]);

    // Garantiza que cada actualización del HTML aplique los estilos CSSOM inline bajo el CSP de Atlassian Forge
    React.useEffect(() => {
      if (exitReportContainerRef.current) {
        applyExitReportInlineStyles(exitReportContainerRef.current);
      }
      const inlineCanvas = document.getElementById('tp-testing-exit-report-inline-canvas');
      if (inlineCanvas) {
        applyExitReportInlineStyles(inlineCanvas);
      }
    }, [buildTestingExitReportHtml, exitReportModalOpen, exitReportIsEditing, applyExitReportInlineStyles]);

    // Copiar Testing Exit Report en formato HTML enriquecido al portapapeles (listo para pegar en Gmail/Outlook)
    const handleCopyExitReportHtml = React.useCallback(async () => {
      try {
        const container = exitReportContainerRef.current || document.getElementById('tp-testing-exit-report-inline-canvas');
        if (container) {
          applyExitReportInlineStyles(container);
        }
        const htmlContent = container ? container.innerHTML : buildTestingExitReportHtml();
        if (navigator.clipboard && window.ClipboardItem) {
          const blobHtml = new Blob([htmlContent], { type: 'text/html' });
          const blobText = new Blob([container ? container.innerText : 'Testing Exit Report'], { type: 'text/plain' });
          await navigator.clipboard.write([
            new window.ClipboardItem({
              'text/html': blobHtml,
              'text/plain': blobText
            })
          ]);
          addNotification({
            type: 'success',
            title: 'Testing Exit Report copiado',
            description: 'El reporte con el formato del Reporte Ejecutivo fue copiado. Pégalo (Ctrl+V / Cmd+V) en tu correo.'
          });
          return;
        }
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = sanitizeHtml(htmlContent);
        document.body.appendChild(tempDiv);
        applyExitReportInlineStyles(tempDiv);
        const range = document.createRange();
        range.selectNodeContents(tempDiv);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        document.body.removeChild(tempDiv);
        addNotification({
          type: 'success',
          title: 'Testing Exit Report copiado',
          description: 'El reporte fue copiado al portapapeles listo para pegar en tu cliente de correo.'
        });
      } catch (err) {
        console.error('[TestingExitReport] Copy error:', err);
        addNotification({
          type: 'error',
          title: 'Error al copiar',
          description: 'No se pudo copiar automáticamente el reporte al portapapeles.'
        });
      }
    }, [applyExitReportInlineStyles, buildTestingExitReportHtml, addNotification]);

    // Imprimir o Guardar como PDF ajustado a 1 sola hoja (con auto-escala de respaldo si hay observaciones extensas)
    const handlePrintExitReportPdf = React.useCallback(() => {
      const container = exitReportContainerRef.current || document.getElementById('tp-testing-exit-report-inline-canvas');
      if (container) {
        applyExitReportInlineStyles(container);
      }
      const htmlToPrint = sanitizeHtml(container ? container.innerHTML : buildTestingExitReportHtml());
      const docTitle = `Testing_Exit_Report_${projectKey}_${new Date().toISOString().slice(0, 10)}`;

      try {
        const iframe = document.createElement('iframe');
        iframe.className = 'tp-print-iframe-hidden';
        document.body.appendChild(iframe);

        const iframeDoc = iframe.contentWindow || iframe.contentDocument;
        const doc = iframeDoc.document || iframeDoc;
        doc.open();
        doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docTitle}</title></head><body class="tp-print-iframe-body"><div id="tp-exit-print-root">${htmlToPrint}</div></body></html>`);
        doc.close();

        const styleNodes = document.querySelectorAll('link[rel="stylesheet"], style');
        styleNodes.forEach(node => {
          try { doc.head.appendChild(node.cloneNode(true)); } catch (_) {}
        });

        const singlePageStyle = doc.createElement('style');
        singlePageStyle.textContent = `
          @page { size: A4 portrait; margin: 5mm 7mm; }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #tp-exit-print-root, .tp-exit-root {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 auto !important;
            box-shadow: none !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: avoid !important;
          }
        `;
        doc.head.appendChild(singlePageStyle);

        const triggerPrint = () => {
          try {
            const rootNode = doc.getElementById('tp-exit-print-root');
            if (rootNode) {
              applyExitReportInlineStyles(rootNode);
              // Garantía de 1 sola hoja PDF: si el contenido supera el alto imprimible (~960px), auto-ajusta el zoom proporcionalmente
              const contentHeight = rootNode.scrollHeight || rootNode.offsetHeight || 0;
              const maxSinglePageHeight = 960;
              if (contentHeight > maxSinglePageHeight) {
                const zoomFactor = Math.max(0.68, Math.floor((maxSinglePageHeight / contentHeight) * 100) / 100);
                rootNode.style.setProperty('zoom', String(zoomFactor), 'important');
              }
            }
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) {
            window.print();
          } finally {
            setTimeout(() => {
              if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
            }, 2500);
          }
        };

        setTimeout(triggerPrint, 350);
      } catch (err) {
        console.error('[TestingExitReport] Print PDF error:', err);
        window.print();
      }
    }, [applyExitReportInlineStyles, buildTestingExitReportHtml, projectKey]);

    // Publicar resumen del Testing Exit Report como comentario en un Ciclo o Plan en Jira
    const handlePublishExitReportToJira = React.useCallback(async () => {
      const targetKey = exitReportTargetIssue || exitReportData.validCycleKeys[0];
      if (!targetKey) {
        addNotification({
          type: 'warning',
          title: 'Selecciona un Ciclo o Plan',
          description: 'Elige el Ciclo o Plan de Pruebas donde deseas publicar el Testing Exit Report en Jira.'
        });
        return;
      }
      setExitReportPublishing(true);
      try {
        const d = exitReportData;
        const calc = d.calculator;
        const semEmoji = calc.qualitySemaphore === 'GREEN' ? '🟢' : calc.qualitySemaphore === 'YELLOW' ? '🟡' : '🔴';
        const lines = [
          `🏁 TESTING EXIT REPORT — ${projectName} (${projectKey})`,
          `⚠️ AVISO IMPORTANTE: Este documento NO es un VoBo (Visto Bueno). Es únicamente una Recomendación de Calidad.`,
          `──────────────────────────────────────────────────`,
          `${semEmoji} SEMÁFORO DE CALIDAD: CALIDAD ${calc.qualityLevel.toUpperCase()}`,
          `• ${calc.qualityRecommendationText}`,
          `──────────────────────────────────────────────────`,
          `📊 RESUMEN DE EJECUCIONES:`,
          `• Total de Casos: ${d.totalCases} | Ejecutados: ${d.executedCases} | Cobertura: ${d.coveragePct}% | Éxito: ${d.successPct}%`,
          `• Aprobados: ${d.passed} | Fallidos: ${d.failed} | Bloqueados: ${d.blocked} | Sin Ejecutar: ${d.notRun}`,
          `🐞 RESUMEN DE DEFECTOS:`,
          `• Total de Defectos: ${d.totalBugsCount} | Defectos Abiertos: ${d.openBugsCount} | Tasa de Error: ${d.openBugsPct}%`,
          `• ¿Hay Blockers Abiertos?: ${d.hasOpenBlockers ? `SÍ (${d.openBlockersCount})` : 'NO (0)'}`,
          `📝 OBSERVACIONES:`,
          `${exitReportObservations?.trim() || 'Sin observaciones adicionales.'}`,
          `🔗 CICLOS EVALUADOS (${d.cycleBreakdown.length}): ${d.validCycleKeys.join(', ') || 'N/A'}`,
          d.cyclesJqlUrl ? `🔗 Link a los ciclos ejecutados: ${d.cyclesJqlUrl}` : ''
        ].filter(Boolean).join('\n');

        const adfBody = textToAdf(lines);
        const res = await requestJira(`/rest/api/3/issue/${targetKey}/comment`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: adfBody })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        addNotification({
          type: 'success',
          title: 'Publicado en Jira',
          description: `El Testing Exit Report se publicó exitosamente como comentario en ${targetKey}.`
        });
      } catch (err) {
        console.error('[TestingExitReport] Publish error:', err);
        addNotification({
          type: 'error',
          title: 'Error al publicar en Jira',
          description: `No se pudo publicar el comentario en ${targetKey}: ${err.message}`
        });
      } finally {
        setExitReportPublishing(false);
      }
    }, [exitReportTargetIssue, exitReportData, exitReportObservations, projectName, projectKey, addNotification]);

    return (
      <div className="tab-layout" style={{ background: 'var(--bg-main, #0d1117)', minHeight: 'calc(100vh - 120px)', padding: '1.5rem 2rem 4rem 2rem' }}>
        <main className="main-content" style={{ maxWidth: '1080px', margin: '0 auto' }}>
          
          {/* Header Banner */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '1.2rem',
            paddingBottom: '1.5rem',
            marginBottom: '1.75rem',
            borderBottom: '1px solid var(--ds-border, #30363d)'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '1.6rem' }}>⚙️</span>
                <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary, #e6edf3)' }}>
                  Configuración del Proyecto
                </h1>
                {projectKey && (
                  <span style={{
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    background: 'rgba(56, 139, 253, 0.15)',
                    color: '#58a6ff',
                    border: '1px solid rgba(56, 139, 253, 0.3)',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '12px'
                  }}>
                    {projectName} ({projectKey})
                  </span>
                )}
              </div>
              <p style={{ margin: 0, color: 'var(--text-secondary, #8b949e)', fontSize: '0.92rem', lineHeight: '1.4' }}>
                Administra el mapeo de entidades nativas de Jira, trazabilidad de requerimientos, métricas visibles del tablero y permisos de acceso para Test Pulse Suite {APP_VERSION}.
              </p>
            </div>

            {selectedProjectId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById('tp-testing-exit-report-card');
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    else setExitReportModalOpen(true);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.65rem 1.15rem',
                    fontSize: '0.9rem',
                    fontWeight: '700',
                    borderRadius: '6px',
                    background: 'linear-gradient(135deg, #E1007A 0%, #9b0054 100%)',
                    color: '#ffffff',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(225, 0, 122, 0.3)',
                    transition: 'all 0.2s ease'
                  }}
                  title="Ir al generador de Testing Exit Report"
                >
                  <span>🏁</span>
                  <span>Testing Exit Report</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={isSavingConfig}
                  className="btn-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.65rem 1.4rem',
                    fontSize: '0.95rem',
                    fontWeight: '600',
                    borderRadius: '6px',
                    background: isSavingConfig ? '#484f58' : '#238636',
                    color: '#ffffff',
                    border: '1px solid rgba(240, 246, 252, 0.1)',
                    cursor: isSavingConfig ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <span>{isSavingConfig ? '⏳' : '💾'}</span>
                  <span>{isSavingConfig ? 'Guardando...' : 'Guardar Configuración'}</span>
                </button>
              </div>
            )}
          </div>

          {!selectedProjectId ? (
            <div className="glass" style={{ padding: '3.5rem 2rem', textAlign: 'center', borderRadius: '12px', border: '1px dashed var(--ds-border, #30363d)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📂</div>
              <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary, #e6edf3)' }}>Selecciona un Proyecto de Jira</h3>
              <p style={{ margin: 0, color: 'var(--text-secondary, #8b949e)', fontSize: '0.95rem' }}>
                Por favor selecciona un proyecto en la barra superior para acceder y personalizar su configuración.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
              
              {/* Card 1: Mapeo de Tipos de Incidencia */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>🧩</span>
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                    Mapeo de Tipos de Incidencias Nativas de Jira
                  </h2>
                </div>
                <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' }}>
                  Asocia los tipos de issue de tu proyecto con las entidades principales de Test Pulse. Toda la información se almacena y sincroniza de forma nativa en Jira.
                </p>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '1.25rem'
                }}>
                  {/* Test Case */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Casos de Prueba</span>
                      <span style={{ fontSize: '0.72rem', color: '#f85149', background: 'rgba(248,81,73,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Requerido</span>
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                      value={projectConfig.testCaseType || ''}
                      onChange={(e) => setProjectConfig({ ...projectConfig, testCaseType: e.target.value })}
                      required
                    >
                      <option value="">Selecciona un tipo de incidencia...</option>
                      {projectIssueTypes.map(it => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Define los pasos, precondiciones y especificaciones del caso.
                    </span>
                  </div>

                  {/* Test Cycle */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Ciclos de Prueba</span>
                      <span style={{ fontSize: '0.72rem', color: '#f85149', background: 'rgba(248,81,73,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Requerido</span>
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                      value={projectConfig.testCycleType || ''}
                      onChange={(e) => setProjectConfig({ ...projectConfig, testCycleType: e.target.value })}
                      required
                    >
                      <option value="">Selecciona un tipo de incidencia...</option>
                      {projectIssueTypes.map(it => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Agrupa ejecuciones para un sprint, versión o entrega de QA.
                    </span>
                  </div>

                  {/* Test Plan */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Planes de Prueba / Sets</span>
                      <span style={{ fontSize: '0.72rem', color: '#f85149', background: 'rgba(248,81,73,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Requerido</span>
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                      value={projectConfig.planIssueType || ''}
                      onChange={(e) => setProjectConfig({ ...projectConfig, planIssueType: e.target.value })}
                      required
                    >
                      <option value="">Selecciona un tipo de incidencia...</option>
                      {projectIssueTypes.map(it => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Estructura los conjuntos maestros de pruebas y ciclos asociados.
                    </span>
                  </div>

                  {/* Test Run */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Ejecución Nativa (Test Run)</span>
                      <span style={{ fontSize: '0.72rem', color: '#2da44e', background: 'rgba(45,164,78,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Nativo V2</span>
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                      value={projectConfig.testRunType || 'Test Run'}
                      onChange={(e) => setProjectConfig({ ...projectConfig, testRunType: e.target.value })}
                    >
                      <option value="Test Run">Test Run (Recomendado / Predeterminado)</option>
                      {projectIssueTypes.map(it => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Almacena snapshots 1:1, pasos, evidencias y comentarios en Jira.
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 1.5: Catálogo de Ambientes de Ejecución (Formato Tabla para Administradores) */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '1.3rem' }}>🌐</span>
                    <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                      Catálogo de Ambientes de Ejecución (Ciclos de Prueba)
                    </h2>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '999px',
                      background: 'rgba(12, 102, 228, 0.12)',
                      color: '#2563EB',
                      border: '1px solid rgba(37, 99, 235, 0.28)'
                    }}>
                      {availableEnvironments.length} {availableEnvironments.length === 1 ? 'ambiente' : 'ambientes'}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={isSavingEnvCatalog}
                    onClick={() => {
                      handleUpdateEnvironmentsCatalog(
                        DEFAULT_EXECUTION_ENVIRONMENTS,
                        'Se restauraron los ambientes predeterminados (QA, UAT, Staging, SIT, Producción).'
                      );
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--ds-border, #CBD5E1)',
                      color: 'var(--text-secondary, #475569)',
                      borderRadius: '6px',
                      padding: '5px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: isSavingEnvCatalog ? 'wait' : 'pointer'
                    }}
                  >
                    ↺ Restaurar predeterminados
                  </button>
                </div>
                <p style={{ margin: '0 0 1.1rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' }}>
                  Da de alta, edita o administra los ambientes disponibles para configurar en el banner de cada Ciclo de Prueba (se guardan en las propiedades del ciclo en Jira).
                </p>

                {/* Formulario rápido para dar de alta un nuevo ambiente */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 2fr) auto',
                  gap: '0.75rem',
                  alignItems: 'end',
                  marginBottom: '1rem',
                  padding: '0.85rem 1rem',
                  background: 'var(--bg-subtle, rgba(248, 250, 252, 0.6))',
                  border: '1px solid var(--ds-border, #E2E8F0)',
                  borderRadius: '8px'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)' }}>
                      Nombre del Ambiente <span style={{ color: '#E11D48' }}>*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. QA, UAT, Pre-Prod, Sandbox..."
                      value={newEnvName}
                      onChange={(e) => setNewEnvName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const cleanName = newEnvName.trim();
                          if (!cleanName) return;
                          if (availableEnvironments.some(env => env.name.toLowerCase() === cleanName.toLowerCase())) {
                            addNotification({ type: 'warning', title: 'Ambiente duplicado', description: `El ambiente "${cleanName}" ya existe en el catálogo.` });
                            return;
                          }
                          const nextList = [
                            ...availableEnvironments,
                            {
                              id: `env-${Date.now()}`,
                              name: cleanName,
                              description: newEnvDesc.trim(),
                              active: true
                            }
                          ];
                          setNewEnvName('');
                          setNewEnvDesc('');
                          handleUpdateEnvironmentsCatalog(nextList, `Ambiente "${cleanName}" dado de alta en el catálogo.`);
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--ds-border, #CBD5E1)',
                        background: 'var(--bg-surface, #FFFFFF)',
                        color: 'var(--text-primary, #0F172A)',
                        fontSize: '0.85rem',
                        fontWeight: 600
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)' }}>
                      Descripción / URL / Notas (Opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Servidor de pruebas integrales o URL del entorno..."
                      value={newEnvDesc}
                      onChange={(e) => setNewEnvDesc(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const cleanName = newEnvName.trim();
                          if (!cleanName) return;
                          if (availableEnvironments.some(env => env.name.toLowerCase() === cleanName.toLowerCase())) {
                            addNotification({ type: 'warning', title: 'Ambiente duplicado', description: `El ambiente "${cleanName}" ya existe en el catálogo.` });
                            return;
                          }
                          const nextList = [
                            ...availableEnvironments,
                            {
                              id: `env-${Date.now()}`,
                              name: cleanName,
                              description: newEnvDesc.trim(),
                              active: true
                            }
                          ];
                          setNewEnvName('');
                          setNewEnvDesc('');
                          handleUpdateEnvironmentsCatalog(nextList, `Ambiente "${cleanName}" dado de alta en el catálogo.`);
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--ds-border, #CBD5E1)',
                        background: 'var(--bg-surface, #FFFFFF)',
                        color: 'var(--text-primary, #0F172A)',
                        fontSize: '0.85rem'
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={!newEnvName.trim() || isSavingEnvCatalog}
                    onClick={() => {
                      const cleanName = newEnvName.trim();
                      if (!cleanName) return;
                      if (availableEnvironments.some(env => env.name.toLowerCase() === cleanName.toLowerCase())) {
                        addNotification({ type: 'warning', title: 'Ambiente duplicado', description: `El ambiente "${cleanName}" ya existe en el catálogo.` });
                        return;
                      }
                      const nextList = [
                        ...availableEnvironments,
                        {
                          id: `env-${Date.now()}`,
                          name: cleanName,
                          description: newEnvDesc.trim(),
                          active: true
                        }
                      ];
                      setNewEnvName('');
                      setNewEnvDesc('');
                      handleUpdateEnvironmentsCatalog(nextList, `Ambiente "${cleanName}" dado de alta en el catálogo.`);
                    }}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      background: !newEnvName.trim() ? '#94A3B8' : '#0C66E4',
                      color: '#FFFFFF',
                      fontSize: '0.84rem',
                      fontWeight: 700,
                      cursor: !newEnvName.trim() || isSavingEnvCatalog ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      height: '36px'
                    }}
                  >
                    + Agregar Ambiente
                  </button>
                </div>

                {/* Tabla de Ambientes Configurados */}
                <div style={{
                  border: '1px solid var(--ds-border, #E2E8F0)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: 'var(--bg-surface, #FFFFFF)'
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-subtle, #F8FAFC)', borderBottom: '1px solid var(--ds-border, #E2E8F0)' }}>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)', width: '28%' }}>
                          Ambiente
                        </th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)' }}>
                          Descripción / Notas
                        </th>
                        <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)', width: '120px' }}>
                          Disponibilidad
                        </th>
                        <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)', width: '170px' }}>
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {availableEnvironments.map((envItem, idx) => {
                        const isEditingRow = editingEnvId === envItem.id;
                        return (
                          <tr
                            key={envItem.id || idx}
                            style={{
                              borderBottom: idx < availableEnvironments.length - 1 ? '1px solid var(--ds-border, #F1F5F9)' : 'none',
                              background: isEditingRow ? 'rgba(37, 99, 235, 0.04)' : 'transparent'
                            }}
                          >
                            <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                              {isEditingRow ? (
                                <input
                                  type="text"
                                  value={editingEnvName}
                                  onChange={(e) => setEditingEnvName(e.target.value)}
                                  style={{
                                    width: '100%',
                                    padding: '5px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid #2563EB',
                                    fontSize: '0.84rem',
                                    fontWeight: 700
                                  }}
                                />
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                    padding: '3px 9px',
                                    borderRadius: '6px',
                                    background: '#EFF6FF',
                                    color: '#1D4ED8',
                                    border: '1px solid #BFDBFE',
                                    fontWeight: 700,
                                    fontSize: '0.8rem'
                                  }}>
                                    🌐 {envItem.name}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '10px 14px', verticalAlign: 'middle', color: 'var(--text-secondary, #64748B)' }}>
                              {isEditingRow ? (
                                <input
                                  type="text"
                                  value={editingEnvDesc}
                                  onChange={(e) => setEditingEnvDesc(e.target.value)}
                                  placeholder="Descripción o URL..."
                                  style={{
                                    width: '100%',
                                    padding: '5px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid #CBD5E1',
                                    fontSize: '0.84rem'
                                  }}
                                />
                              ) : (
                                <span>{envItem.description || '—'}</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center', verticalAlign: 'middle' }}>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: '999px',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                background: '#ECFDF5',
                                color: '#047857',
                                border: '1px solid #A7F3D0'
                              }}>
                                Activo
                              </span>
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', verticalAlign: 'middle' }}>
                              {isEditingRow ? (
                                <div style={{ display: 'inline-flex', gap: '6px' }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const cleanName = editingEnvName.trim();
                                      if (!cleanName) return;
                                      const nextList = availableEnvironments.map(item =>
                                        item.id === envItem.id
                                          ? { ...item, name: cleanName, description: editingEnvDesc.trim() }
                                          : item
                                      );
                                      setEditingEnvId(null);
                                      handleUpdateEnvironmentsCatalog(nextList, `Ambiente "${cleanName}" actualizado.`);
                                    }}
                                    style={{
                                      padding: '4px 10px',
                                      borderRadius: '4px',
                                      border: 'none',
                                      background: '#0C66E4',
                                      color: '#FFFFFF',
                                      fontSize: '0.76rem',
                                      fontWeight: 700,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Guardar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingEnvId(null)}
                                    style={{
                                      padding: '4px 8px',
                                      borderRadius: '4px',
                                      border: '1px solid #CBD5E1',
                                      background: '#FFFFFF',
                                      color: '#475569',
                                      fontSize: '0.76rem',
                                      fontWeight: 600,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'inline-flex', gap: '6px' }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingEnvId(envItem.id);
                                      setEditingEnvName(envItem.name);
                                      setEditingEnvDesc(envItem.description || '');
                                    }}
                                    style={{
                                      padding: '4px 9px',
                                      borderRadius: '4px',
                                      border: '1px solid var(--ds-border, #CBD5E1)',
                                      background: 'var(--bg-surface, #FFFFFF)',
                                      color: 'var(--text-primary, #334155)',
                                      fontSize: '0.76rem',
                                      fontWeight: 600,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    ✏️ Editar
                                  </button>
                                  <button
                                    type="button"
                                    disabled={availableEnvironments.length <= 1 || isSavingEnvCatalog}
                                    title={availableEnvironments.length <= 1 ? 'Debe existir al menos un ambiente en el catálogo' : 'Eliminar ambiente'}
                                    onClick={() => {
                                      if (availableEnvironments.length <= 1) return;
                                      const nextList = availableEnvironments.filter(item => item.id !== envItem.id);
                                      handleUpdateEnvironmentsCatalog(nextList, `Ambiente "${envItem.name}" eliminado del catálogo.`);
                                    }}
                                    style={{
                                      padding: '4px 9px',
                                      borderRadius: '4px',
                                      border: '1px solid #FECDD3',
                                      background: '#FFF1F2',
                                      color: '#E11D48',
                                      fontSize: '0.76rem',
                                      fontWeight: 600,
                                      cursor: availableEnvironments.length <= 1 ? 'not-allowed' : 'pointer',
                                      opacity: availableEnvironments.length <= 1 ? 0.5 : 1
                                    }}
                                  >
                                    🗑️ Eliminar
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Card 2: Trazabilidad y Requerimientos */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>🔗</span>
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                    Trazabilidad de Requerimientos y Enlaces
                  </h2>
                </div>
                <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' }}>
                  Configura qué incidencias representan requerimientos de negocio y el tipo de enlace para la matriz de trazabilidad y cobertura.
                </p>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '1.25rem'
                }}>
                  {/* Requirement Types */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                      Tipos de Incidencias de Requisitos
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        minHeight: '110px',
                        padding: '0.5rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.88rem'
                      }}
                      multiple
                      value={projectConfig.requirementIssueTypes || []}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
                        setProjectConfig({ ...projectConfig, requirementIssueTypes: selected });
                      }}
                    >
                      {projectIssueTypes.map(it => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Mantén presionado <kbd style={{ background: '#21262d', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>Ctrl</kbd> o <kbd style={{ background: '#21262d', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>Cmd</kbd> para seleccionar varios (ej: Story, Epic, Task).
                    </span>
                  </div>

                  {/* Link Type */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                      Tipo de Enlace en Jira (Issue Link Type)
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                      value={projectConfig.requirementLinkType || 'ANY'}
                      onChange={(e) => setProjectConfig({ ...projectConfig, requirementLinkType: e.target.value })}
                    >
                      <option value="ANY">Cualquier tipo de enlace (Automático)</option>
                      {linkTypes.map(lt => (
                        <option key={lt.id} value={lt.name}>{lt.name} ({lt.outward} / {lt.inward})</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Tipo de relación Jira que vincula los casos de prueba con las historias/epics.
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 3: Gestión de Defectos (Bugs) */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>🐞</span>
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                    Gestión y Detección de Defectos (Bugs)
                  </h2>
                </div>
                <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' }}>
                  Filtro de incidencias para contabilizar defectos y calcular métricas de fallas en los reportes y dashboards.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                    Tipos de Incidencias de Defecto
                  </label>
                  <select
                    className="form-control"
                    style={{
                      width: '100%',
                      minHeight: '100px',
                      padding: '0.5rem',
                      background: 'var(--bg-main, #0d1117)',
                      color: 'var(--text-primary, #e6edf3)',
                      border: '1px solid var(--ds-border, #30363d)',
                      borderRadius: '6px',
                      fontSize: '0.88rem'
                    }}
                    multiple
                    value={projectConfig.bugIssueTypes || []}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
                      setProjectConfig({ ...projectConfig, bugIssueTypes: selected });
                    }}
                  >
                    {projectIssueTypes.map(it => (
                      <option key={it.id} value={it.name}>{it.name}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                    {projectConfig.bugIssueTypes && projectConfig.bugIssueTypes.length > 0
                      ? `Seleccionados: ${projectConfig.bugIssueTypes.join(', ')}`
                      : 'Ninguno seleccionado: Detectará automáticamente tipos comunes (Bug, Defect, Defecto, Falla, Error, Incident, Incidente).'}
                  </span>
                </div>
              </div>

              {/* Card 4: Widgets y Métricas del Tablero */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>📊</span>
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                    Personalización de Widgets del Dashboard
                  </h2>
                </div>
                <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' }}>
                  Elige qué widgets y análisis gráficos estarán activos y visibles para el equipo en el Dashboard de Ejecución.
                </p>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  gap: '0.9rem'
                }}>
                  {/* Widget 1 */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    background: projectConfig.showProgreso !== false ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-main, #0d1117)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={projectConfig.showProgreso !== false}
                      onChange={e => setProjectConfig({ ...projectConfig, showProgreso: e.target.checked })}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        📈 Progreso por Ciclo de Pruebas
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Visualiza el avance global, tasa de aprobación y distribución por estatus.
                      </div>
                    </div>
                  </label>

                  {/* Widget 2 */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    background: projectConfig.showTesterStats !== false ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-main, #0d1117)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={projectConfig.showTesterStats !== false}
                      onChange={e => setProjectConfig({ ...projectConfig, showTesterStats: e.target.checked })}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        👥 Distribución por Tester
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Gráfica de productividad y balance de carga de trabajo por tester asignado.
                      </div>
                    </div>
                  </label>

                  {/* Widget 3 */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    background: projectConfig.showExecTypeStats !== false ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-main, #0d1117)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={projectConfig.showExecTypeStats !== false}
                      onChange={e => setProjectConfig({ ...projectConfig, showExecTypeStats: e.target.checked })}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        ⚙️ Pruebas Manuales vs Automatizadas
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Compara la proporción de cobertura entre tipos de ejecución.
                      </div>
                    </div>
                  </label>

                  {/* Widget 4 */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    background: projectConfig.showBugTimes !== false ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-main, #0d1117)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={projectConfig.showBugTimes !== false}
                      onChange={e => setProjectConfig({ ...projectConfig, showBugTimes: e.target.checked })}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        ⏱️ Tiempo de Resolución de Defectos (MTTR)
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Calcula el promedio de horas laborales para la corrección de fallas.
                      </div>
                    </div>
                  </label>

                  {/* Widget 5 */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    background: projectConfig.showFeatureStats !== false ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-main, #0d1117)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={projectConfig.showFeatureStats !== false}
                      onChange={e => setProjectConfig({ ...projectConfig, showFeatureStats: e.target.checked })}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        📁 Estado por Módulo o Funcionalidad
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Analiza la cobertura funcional agrupada por carpetas y suites de prueba.
                      </div>
                    </div>
                  </label>
                </div>

                {/* Subsección: Visibilidad de Severidades y Contadores de Bugs */}
                <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--ds-border, #30363d)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>🐞</span>
                    <span style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text-primary, #e6edf3)' }}>
                      Visibilidad de Severidades y Contadores de Bugs en Dashboard
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #8b949e)', marginBottom: '0.85rem' }}>
                    Activa o desactiva qué niveles de severidad y contadores estarán visibles en el gráfico circular y tarjetas KPI del Dashboard para este proyecto.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    {/* Bloqueante */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevBloqueante !== false ? 'rgba(222, 53, 11, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevBloqueante !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevBloqueante: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#DE350B', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#DE350B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ✱ Bloqueante
                      </span>
                    </label>

                    {/* Crítico */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevCritico !== false ? 'rgba(229, 73, 58, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevCritico !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevCritico: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#E5493A', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#E5493A', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ▲ Crítico
                      </span>
                    </label>

                    {/* Mayor */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevMayor !== false ? 'rgba(255, 139, 0, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevMayor !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevMayor: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#FF8B00', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#FF8B00', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ● Mayor
                      </span>
                    </label>

                    {/* Medio */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevMedio !== false ? 'rgba(226, 178, 3, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevMedio !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevMedio: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#E2B203', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#E2B203', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ◆ Medio
                      </span>
                    </label>

                    {/* Menor */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevMenor !== false ? 'rgba(0, 102, 68, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevMenor !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevMenor: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#006644', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#006644', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ○ Menor
                      </span>
                    </label>

                    {/* Sin definir */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevSinDefinir !== false ? 'rgba(98, 111, 134, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevSinDefinir !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevSinDefinir: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#626F86', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-secondary, #8b949e)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ○ Sin Definir
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Card 4.5: Automatización y Envío Programado de Reportes Ejecutivos */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.8rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '1.3rem' }}>⏰</span>
                      <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        Automatización y Programación de Reportes Ejecutivos
                      </h2>
                    </div>
                    <p style={{ margin: 0, color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem', maxWidth: '650px' }}>
                      Programa el envío recurrente del reporte ejecutivo de QA por correo mediante el disparador horario de Atlassian Forge y reglas de <strong>Jira Automation</strong> con estilo corporativo de El Puerto de Liverpool.
                    </p>
                  </div>

                  <span style={{
                    padding: '0.35rem 0.8rem',
                    borderRadius: '20px',
                    fontSize: '0.82rem',
                    fontWeight: '600',
                    background: reportAutomationConfig.enabled ? 'rgba(225, 0, 122, 0.15)' : 'rgba(139, 148, 158, 0.15)',
                    color: reportAutomationConfig.enabled ? '#E1007A' : '#8b949e',
                    border: `1px solid ${reportAutomationConfig.enabled ? 'rgba(225, 0, 122, 0.3)' : 'rgba(139, 148, 158, 0.3)'}`
                  }}>
                    {reportAutomationConfig.enabled ? '🟢 Programador Activo' : '⚪ Programador en Pausa'}
                  </span>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                  padding: '1rem 1.25rem',
                  background: 'var(--bg-main, #0d1117)',
                  borderRadius: '8px',
                  border: '1px solid var(--ds-border, #30363d)',
                  marginTop: '0.5rem'
                }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary, #e6edf3)' }}>
                    <div>
                      <strong>Horario Programado:</strong> {reportAutomationConfig.frequency === 'daily' ? 'Diario (Lun - Dom)' : reportAutomationConfig.frequency === 'weekly' ? 'Semanal (Viernes)' : 'Lunes a Viernes'} a las <strong>{reportAutomationConfig.hour || 18}:00 hrs CDMX</strong>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)', marginTop: '2px' }}>
                      Webhook: {reportAutomationConfig.webhookUrl ? (reportAutomationConfig.webhookUrl.substring(0, 45) + '...') : 'No configurado'}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      loadReportAutomationConfig();
                      setShowReportAutomationModal(true);
                    }}
                    className="btn-primary"
                    style={{
                      padding: '0.5rem 1.25rem',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      background: '#E1007A',
                      borderColor: '#E1007A'
                    }}
                  >
                    ⚙️ Configurar Automatización
                  </button>
                </div>
              </div>

              {/* Card 4.6: 🏁 Testing Exit Report */}
              <div
                id="tp-testing-exit-report-card"
                className="glass"
                style={{
                  background: 'var(--bg-surface, #161b22)',
                  border: '1px solid rgba(225, 0, 122, 0.45)',
                  borderRadius: '12px',
                  padding: '1.6rem 1.75rem',
                  boxShadow: '0 4px 18px rgba(0,0,0,0.22)'
                }}
              >
                {/* Header del Testing Exit Report */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '1.45rem' }}>🏁</span>
                      <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800', color: 'var(--text-primary, #e6edf3)' }}>
                        Testing Exit Report
                      </h2>
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: '700',
                        padding: '0.18rem 0.6rem',
                        borderRadius: '12px',
                        background: 'rgba(225, 0, 122, 0.16)',
                        color: '#ff6bc1',
                        border: '1px solid rgba(225, 0, 122, 0.35)'
                      }}>
                        Formato Ejecutivo Liverpool
                      </span>
                      {(reportLoading || isHydratingReport || isRefreshingReport) && (
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: '600',
                          padding: '0.18rem 0.55rem',
                          borderRadius: '12px',
                          background: 'rgba(56, 139, 253, 0.15)',
                          color: '#58a6ff'
                        }}>
                          ⏳ Sincronizando métricas…
                        </span>
                      )}
                    </div>
                    <p style={{ margin: 0, color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem', lineHeight: '1.45', maxWidth: '760px' }}>
                      Genera el informe ejecutivo de cierre de pruebas con <strong>Semáforo de Calidad</strong>, <strong>Resumen de Ejecuciones</strong>, <strong>Resumen de Defectos (incluyendo alerta de Blockers abiertos)</strong>, <strong>Observaciones</strong> y <strong>links directos a los ciclos ejecutados</strong>.
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                    {typeof loadReportData === 'function' && (
                      <button
                        type="button"
                        onClick={() => loadReportData(null, null, true)}
                        disabled={reportLoading || isRefreshingReport}
                        style={{
                          padding: '0.5rem 0.85rem',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          background: 'var(--bg-main, #0d1117)',
                          color: 'var(--text-primary, #e6edf3)',
                          border: '1px solid var(--ds-border, #30363d)',
                          cursor: (reportLoading || isRefreshingReport) ? 'not-allowed' : 'pointer'
                        }}
                        title="Recargar ejecuciones y defectos desde Jira"
                      >
                        {reportLoading || isRefreshingReport ? '⏳ Actualizando…' : '🔄 Actualizar Métricas'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExitReportModalOpen(true)}
                      style={{
                        padding: '0.55rem 1.1rem',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        fontWeight: '700',
                        background: '#E1007A',
                        color: '#ffffff',
                        border: '1px solid #E1007A',
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(225, 0, 122, 0.35)'
                      }}
                    >
                      📄 Abrir Reporte Ejecutivo (Vista Previa / Correo / PDF)
                    </button>
                  </div>
                </div>

                {/* Leyenda Obligatoria: NO ES UN VOBO */}
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  padding: '0.85rem 1.1rem',
                  marginBottom: '1.25rem',
                  borderRadius: '8px',
                  background: 'rgba(210, 153, 34, 0.12)',
                  border: '1px solid rgba(210, 153, 34, 0.45)',
                  borderLeft: '4px solid #d29922'
                }}>
                  <span style={{ fontSize: '1.25rem', lineHeight: 1.2 }}>⚠️</span>
                  <div style={{ fontSize: '0.83rem', color: 'var(--text-primary, #e6edf3)', lineHeight: '1.45' }}>
                    <strong style={{ color: '#e3b341', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                      Aviso Importante — No es un VoBo (Visto Bueno):
                    </strong>{' '}
                    Este <strong>Testing Exit Report</strong> y el resultado del <strong>Semáforo de Calidad</strong>{' '}
                    <u>NO constituyen un Visto Bueno (VoBo)</u> ni una autorización formal de liberación a Producción. Representan únicamente una{' '}
                    <strong>recomendación técnica de Calidad (QA)</strong> basada en las métricas objetivas registradas al momento del corte.
                  </div>
                </div>

                {/* Controles de Alcance (Plan, Ciclos, Ambiente, Alcance de Bugs) */}
                <div style={{
                  background: 'var(--bg-main, #0d1117)',
                  border: '1px solid var(--ds-border, #30363d)',
                  borderRadius: '10px',
                  padding: '1.1rem 1.25rem',
                  marginBottom: '1.25rem'
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.9rem', marginBottom: '0.9rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                        📋 Plan de Pruebas
                      </label>
                      <select
                        value={exitReportPlanId}
                        onChange={(e) => {
                          setExitReportPlanId(e.target.value);
                          setExitReportCycleIds([]);
                        }}
                        style={{
                          width: '100%',
                          padding: '0.5rem 0.65rem',
                          borderRadius: '6px',
                          background: 'var(--bg-surface, #161b22)',
                          color: 'var(--text-primary, #e6edf3)',
                          border: '1px solid var(--ds-border, #30363d)',
                          fontSize: '0.85rem'
                        }}
                      >
                        <option value="ALL">Todos los Planes ({sourceCycles.length} ciclos)</option>
                        {(Array.isArray(testPlans) ? testPlans : []).map(plan => {
                          const planCyclesCount = sourceCycles.filter(c => doesCycleMatchPlan(c, plan.id)).length;
                          return (
                            <option key={plan.id} value={plan.id}>
                              {formatCleanName(plan, 'Plan de Pruebas')} ({planCyclesCount} {planCyclesCount === 1 ? 'ciclo' : 'ciclos'})
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                        🐞 Alcance de Defectos (Bugs)
                      </label>
                      <select
                        value={exitReportBugScope}
                        onChange={(e) => setExitReportBugScope(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.5rem 0.65rem',
                          borderRadius: '6px',
                          background: 'var(--bg-surface, #161b22)',
                          color: 'var(--text-primary, #e6edf3)',
                          border: '1px solid var(--ds-border, #30363d)',
                          fontSize: '0.85rem'
                        }}
                      >
                        <option value="SCOPED">Defectos de los ciclos seleccionados (+ proyecto si son todos)</option>
                        <option value="ALL_PROJECT">Todos los defectos del proyecto Jira</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                        🌐 Ambiente Evaluado
                      </label>
                      <input
                        type="text"
                        value={exitReportEnv}
                        onChange={(e) => setExitReportEnv(e.target.value)}
                        placeholder="Ej. QA / UAT / Pre-Producción"
                        style={{
                          width: '100%',
                          padding: '0.5rem 0.65rem',
                          borderRadius: '6px',
                          background: 'var(--bg-surface, #161b22)',
                          color: 'var(--text-primary, #e6edf3)',
                          border: '1px solid var(--ds-border, #30363d)',
                          fontSize: '0.85rem',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                        🏷️ Release / Versión / Sprint (Opcional)
                      </label>
                      <input
                        type="text"
                        value={exitReportBuild}
                        onChange={(e) => setExitReportBuild(e.target.value)}
                        placeholder="Ej. Release v2.4 / Sprint 18"
                        style={{
                          width: '100%',
                          padding: '0.5rem 0.65rem',
                          borderRadius: '6px',
                          background: 'var(--bg-surface, #161b22)',
                          color: 'var(--text-primary, #e6edf3)',
                          border: '1px solid var(--ds-border, #30363d)',
                          fontSize: '0.85rem',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  </div>

                  {/* Selector de Ciclos de Prueba */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.45rem' }}>
                      <span style={{ fontSize: '0.76rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase' }}>
                        🔄 Filtrar Ciclos de Prueba ({exitReportCycleIds.length === 0 ? `Todos (${exitReportData.cyclesInPlan.length})` : `${exitReportCycleIds.length} seleccionados`})
                      </span>
                      {exitReportCycleIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExitReportCycleIds([])}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#58a6ff',
                            fontSize: '0.76rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            padding: 0
                          }}
                        >
                          Mostrar todos los ciclos del alcance
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', maxHeight: '110px', overflowY: 'auto', padding: '0.2rem 0' }}>
                      {exitReportData.cyclesInPlan.length === 0 ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #8b949e)' }}>
                          No hay ciclos de prueba registrados en este alcance.
                        </span>
                      ) : (
                        exitReportData.cyclesInPlan.map(c => {
                          const cid = String(c.id || c.key);
                          const isSelected = exitReportCycleIds.includes(cid);
                          return (
                            <button
                              key={cid}
                              type="button"
                              onClick={() => {
                                setExitReportCycleIds(prev =>
                                  prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]
                                );
                              }}
                              style={{
                                padding: '0.28rem 0.65rem',
                                borderRadius: '14px',
                                fontSize: '0.76rem',
                                fontWeight: isSelected ? '700' : '500',
                                cursor: 'pointer',
                                background: isSelected ? 'rgba(225, 0, 122, 0.2)' : 'var(--bg-surface, #161b22)',
                                color: isSelected ? '#ff6bc1' : 'var(--text-primary, #e6edf3)',
                                border: isSelected ? '1px solid #E1007A' : '1px solid var(--ds-border, #30363d)'
                              }}
                            >
                              {isSelected ? '✓ ' : ''}{formatCleanName(c, 'Ciclo de Pruebas')}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* ENCABEZADO DEL PROYECTO Y SEMÁFORO DE CALIDAD (FONDO PINTADO DEL COLOR DEL SEMÁFORO — HOMOLOGADO CON VISTA PRELIMINAR) */}
                <div style={{
                  padding: '1.15rem 1.35rem',
                  borderRadius: '10px',
                  marginBottom: '1.25rem',
                  background: exitReportData.qualityLevel === 'ALTA'
                    ? 'rgba(45, 164, 78, 0.16)'
                    : exitReportData.qualityLevel === 'MEDIA'
                    ? 'rgba(210, 153, 34, 0.16)'
                    : 'rgba(248, 81, 73, 0.16)',
                  border: `2px solid ${
                    exitReportData.qualityLevel === 'ALTA'
                      ? '#3fb950'
                      : exitReportData.qualityLevel === 'MEDIA'
                      ? '#d29922'
                      : '#f85149'
                  }`
                }}>
                  {/* Fila Superior: Proyecto, Plan de Pruebas y Ambiente */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '0.85rem',
                    paddingBottom: '0.85rem',
                    marginBottom: '0.9rem',
                    borderBottom: `1px solid ${
                      exitReportData.qualityLevel === 'ALTA'
                        ? 'rgba(63, 185, 80, 0.35)'
                        : exitReportData.qualityLevel === 'MEDIA'
                        ? 'rgba(210, 153, 34, 0.35)'
                        : 'rgba(248, 81, 73, 0.35)'
                    }`
                  }}>
                    <div>
                      <div style={{
                        fontSize: '0.7rem',
                        fontWeight: '800',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: exitReportData.qualityLevel === 'ALTA' ? '#3fb950' : exitReportData.qualityLevel === 'MEDIA' ? '#e3b341' : '#ff7b72'
                      }}>
                        PROYECTO
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: '900', color: 'var(--text-primary, #e6edf3)', marginTop: '0.15rem' }}>
                        {projectName || 'Proyecto Jira'} ({projectKey || 'N/A'})
                      </div>
                    </div>

                    <div>
                      <div style={{
                        fontSize: '0.7rem',
                        fontWeight: '800',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: exitReportData.qualityLevel === 'ALTA' ? '#3fb950' : exitReportData.qualityLevel === 'MEDIA' ? '#e3b341' : '#ff7b72'
                      }}>
                        PLAN DE PRUEBAS
                      </div>
                      <div style={{ fontSize: '0.92rem', fontWeight: '700', color: 'var(--text-primary, #e6edf3)', marginTop: '0.18rem' }}>
                        {exitReportData.planLabel}
                      </div>
                    </div>

                    <div>
                      <div style={{
                        fontSize: '0.7rem',
                        fontWeight: '800',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: exitReportData.qualityLevel === 'ALTA' ? '#3fb950' : exitReportData.qualityLevel === 'MEDIA' ? '#e3b341' : '#ff7b72'
                      }}>
                        AMBIENTE / VERSIÓN
                      </div>
                      <div style={{ fontSize: '0.92rem', fontWeight: '700', color: 'var(--text-primary, #e6edf3)', marginTop: '0.18rem' }}>
                        {exitReportEnv || 'QA / UAT'} · {exitReportBuild || 'Actual'}
                      </div>
                    </div>
                  </div>

                  {/* Fila Inferior: Semáforo de Calidad Destacado (3 Luces) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.95rem' }}>
                    {/* Luces del Semáforo */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                      background: '#090d11',
                      padding: '8px',
                      borderRadius: '20px',
                      border: '1px solid #30363d',
                      flexShrink: 0
                    }}>
                      <span style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: exitReportData.qualityLevel === 'BAJA' ? '#ff4d4f' : '#3b1d1d',
                        boxShadow: exitReportData.qualityLevel === 'BAJA' ? '0 0 10px #ff4d4f' : 'none'
                      }} title="Calidad Baja" />
                      <span style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: exitReportData.qualityLevel === 'MEDIA' ? '#faad14' : '#3b3118',
                        boxShadow: exitReportData.qualityLevel === 'MEDIA' ? '0 0 10px #faad14' : 'none'
                      }} title="Calidad Media" />
                      <span style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: exitReportData.qualityLevel === 'ALTA' ? '#52c41a' : '#183820',
                        boxShadow: exitReportData.qualityLevel === 'ALTA' ? '0 0 10px #52c41a' : 'none'
                      }} title="Calidad Alta" />
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: '1.15rem',
                          fontWeight: '900',
                          color: exitReportData.qualityLevel === 'ALTA' ? '#3fb950' : exitReportData.qualityLevel === 'MEDIA' ? '#e3b341' : '#ff7b72'
                        }}>
                          {exitReportData.semaphoreEmoji} {exitReportData.semaphoreTitle} — CALIDAD {exitReportData.qualityLevel}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.84rem', color: 'var(--text-primary, #e6edf3)', marginTop: '0.28rem', lineHeight: '1.45' }}>
                        {exitReportData.recommendationText}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#e3b341', marginTop: '0.25rem', fontWeight: '700' }}>
                        * Nota: Este resultado NO es un VoBo, únicamente representa una recomendación de Calidad.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Grid Principal: 1) Resumen de Ejecuciones + 2) Resumen de Defectos */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.1rem', marginBottom: '1.25rem' }}>
                  
                  {/* 1. RESUMEN DE EJECUCIONES */}
                  <div style={{
                    background: 'var(--bg-main, #0d1117)',
                    border: '1px solid var(--ds-border, #30363d)',
                    borderRadius: '10px',
                    padding: '1.15rem 1.25rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--text-primary, #e6edf3)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                        📊 1. Resumen de Ejecuciones
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #8b949e)' }}>
                        {exitReportData.cycleSummaries.length} ciclo(s)
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem', marginBottom: '0.9rem', alignItems: 'stretch' }}>
                      <div style={{ background: 'var(--bg-surface, #161b22)', border: '1px solid var(--ds-border, #30363d)', borderRadius: '8px', padding: '0.75rem 0.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ fontSize: '1.45rem', fontWeight: '800', color: 'var(--text-primary, #e6edf3)', lineHeight: 1.15 }}>
                          {exitReportData.totalCases}
                        </div>
                        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginTop: '0.2rem', lineHeight: 1.2 }}>
                          Total de Casos
                        </div>
                      </div>

                      <div style={{ background: 'var(--bg-surface, #161b22)', border: '1px solid rgba(56, 139, 253, 0.35)', borderRadius: '8px', padding: '0.75rem 0.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ fontSize: '1.45rem', fontWeight: '800', color: '#58a6ff', lineHeight: 1.15 }}>
                          {exitReportData.coveragePct}%
                        </div>
                        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginTop: '0.2rem', lineHeight: 1.2 }}>
                          Cobertura ({exitReportData.executedCases}/{exitReportData.totalCases})
                        </div>
                      </div>

                      <div style={{ background: 'var(--bg-surface, #161b22)', border: '1px solid rgba(63, 185, 80, 0.35)', borderRadius: '8px', padding: '0.75rem 0.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ fontSize: '1.45rem', fontWeight: '800', color: '#3fb950', lineHeight: 1.15 }}>
                          {exitReportData.successPct}%
                        </div>
                        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginTop: '0.2rem', lineHeight: 1.2 }}>
                          Éxito ({exitReportData.passed}/{exitReportData.executedCases})
                        </div>
                      </div>
                    </div>

                    {/* Barra de progreso de estados */}
                    <div style={{ height: '8px', borderRadius: '4px', background: '#21262d', overflow: 'hidden', display: 'flex', marginBottom: '0.7rem' }}>
                      {exitReportData.totalCases > 0 && (
                        <>
                          <div style={{ width: `${(exitReportData.passed / exitReportData.totalCases) * 100}%`, background: '#3fb950' }} title={`Pasados: ${exitReportData.passed}`} />
                          <div style={{ width: `${(exitReportData.failed / exitReportData.totalCases) * 100}%`, background: '#f85149' }} title={`Fallidos: ${exitReportData.failed}`} />
                          <div style={{ width: `${(exitReportData.blocked / exitReportData.totalCases) * 100}%`, background: '#d29922' }} title={`Bloqueados: ${exitReportData.blocked}`} />
                        </>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.76rem', color: 'var(--text-secondary, #8b949e)' }}>
                      <span>✅ <strong style={{ color: '#3fb950' }}>{exitReportData.passed}</strong> Pasados</span>
                      <span>❌ <strong style={{ color: '#f85149' }}>{exitReportData.failed}</strong> Fallidos</span>
                      <span>🚫 <strong style={{ color: '#d29922' }}>{exitReportData.blocked}</strong> Bloqueados</span>
                      <span>⏳ <strong>{exitReportData.unexecuted + exitReportData.inProgress}</strong> Sin Ejecutar</span>
                    </div>
                  </div>

                  {/* 2. RESUMEN DE DEFECTOS */}
                  <div style={{
                    background: 'var(--bg-main, #0d1117)',
                    border: exitReportData.hasOpenBlockers ? '1px solid rgba(248, 81, 73, 0.55)' : '1px solid var(--ds-border, #30363d)',
                    borderRadius: '10px',
                    padding: '1.15rem 1.25rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--text-primary, #e6edf3)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                        🐞 2. Resumen de Defectos
                      </span>
                      <span style={{
                        fontSize: '0.73rem',
                        fontWeight: '800',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '12px',
                        background: exitReportData.hasOpenBlockers ? 'rgba(248, 81, 73, 0.18)' : 'rgba(63, 185, 80, 0.15)',
                        color: exitReportData.hasOpenBlockers ? '#ff7b72' : '#3fb950',
                        border: `1px solid ${exitReportData.hasOpenBlockers ? 'rgba(248, 81, 73, 0.4)' : 'rgba(63, 185, 80, 0.35)'}`
                      }}>
                        {exitReportData.hasOpenBlockers
                          ? `🚨 BLOCKERS ABIERTOS: SÍ (${exitReportData.openBlockerBugsCount})`
                          : '✅ BLOCKERS ABIERTOS: NO (0)'}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.55rem', alignItems: 'stretch' }}>
                      <div style={{ background: 'var(--bg-surface, #161b22)', border: '1px solid var(--ds-border, #30363d)', borderRadius: '8px', padding: '0.65rem 0.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ fontSize: '1.3rem', fontWeight: '800', color: 'var(--text-primary, #e6edf3)', lineHeight: 1.15 }}>
                          {exitReportData.totalBugs}
                        </div>
                        <div style={{ fontSize: '0.66rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginTop: '0.15rem', lineHeight: 1.2 }}>
                          Total Defectos
                        </div>
                        <div style={{ fontSize: '0.63rem', color: 'var(--text-secondary, #8b949e)', marginTop: '0.1rem', lineHeight: 1.2 }}>
                          En el alcance
                        </div>
                      </div>

                      <div style={{ background: 'var(--bg-surface, #161b22)', border: '1px solid rgba(210, 153, 34, 0.35)', borderRadius: '8px', padding: '0.65rem 0.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ fontSize: '1.3rem', fontWeight: '800', color: exitReportData.openBugsCount > 0 ? '#e3b341' : '#3fb950', lineHeight: 1.15 }}>
                          {exitReportData.openBugsCount}
                        </div>
                        <div style={{ fontSize: '0.66rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginTop: '0.15rem', lineHeight: 1.2 }}>
                          Defectos Abiertos
                        </div>
                        <div style={{ fontSize: '0.63rem', color: 'var(--text-secondary, #8b949e)', marginTop: '0.1rem', lineHeight: 1.2 }}>
                          Cerrados: {exitReportData.closedBugsCount}
                        </div>
                      </div>

                      <div style={{ background: 'var(--bg-surface, #161b22)', border: '1px solid rgba(248, 81, 73, 0.35)', borderRadius: '8px', padding: '0.65rem 0.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ fontSize: '1.3rem', fontWeight: '800', color: exitReportData.errorRatePct > 5 ? '#f85149' : exitReportData.errorRatePct > 1 ? '#e3b341' : '#3fb950', lineHeight: 1.15 }}>
                          {exitReportData.errorRatePct}%
                        </div>
                        <div style={{ fontSize: '0.66rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginTop: '0.15rem', lineHeight: 1.2 }}>
                          Tasa de Error
                        </div>
                        <div style={{ fontSize: '0.63rem', color: 'var(--text-secondary, #8b949e)', marginTop: '0.1rem', lineHeight: 1.2 }}>
                          % Defectos Abiertos
                        </div>
                      </div>

                      <div style={{ background: 'var(--bg-surface, #161b22)', border: `1px solid ${exitReportData.hasOpenBlockers ? 'rgba(248, 81, 73, 0.6)' : 'rgba(63, 185, 80, 0.35)'}`, borderRadius: '8px', padding: '0.65rem 0.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ fontSize: '1.3rem', fontWeight: '800', color: exitReportData.hasOpenBlockers ? '#f85149' : '#3fb950', lineHeight: 1.15 }}>
                          {exitReportData.hasOpenBlockers ? `SÍ (${exitReportData.openBlockerBugsCount})` : 'NO (0)'}
                        </div>
                        <div style={{ fontSize: '0.66rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', textTransform: 'uppercase', marginTop: '0.15rem', lineHeight: 1.2 }}>
                          Blockers Abiertos
                        </div>
                        <div style={{ fontSize: '0.63rem', color: 'var(--text-secondary, #8b949e)', marginTop: '0.1rem', lineHeight: 1.2 }}>
                          ¿Hay Blockers Abiertos?
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. OBSERVACIONES Y 4. LINK A LOS CICLOS EJECUTADOS */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.1rem', marginBottom: '1.1rem' }}>
                  {/* Apartado de Observaciones */}
                  <div style={{
                    background: 'var(--bg-main, #0d1117)',
                    border: '1px solid var(--ds-border, #30363d)',
                    borderRadius: '10px',
                    padding: '1.1rem 1.25rem'
                  }}>
                    <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: '800', color: 'var(--text-primary, #e6edf3)', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
                      📝 3. Apartado de Observaciones
                    </label>
                    <p style={{ margin: '0 0 0.6rem 0', fontSize: '0.77rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Documenta observaciones relevantes del cierre, riesgos residuales, acuerdos o condiciones de salida. Se incluye automáticamente en el Testing Exit Report ejecutivo.
                    </p>
                    <textarea
                      rows={4}
                      value={exitReportObservations}
                      onChange={(e) => setExitReportObservations(e.target.value)}
                      placeholder="Ej. Se completaron las pruebas funcionales y de regresión del alcance. Queda pendiente seguimiento no bloqueante de..."
                      style={{
                        width: '100%',
                        padding: '0.65rem 0.75rem',
                        borderRadius: '8px',
                        background: 'var(--bg-surface, #161b22)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        fontSize: '0.84rem',
                        lineHeight: '1.45',
                        resize: 'vertical',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>

                  {/* Link a los Ciclos Ejecutados */}
                  <div style={{
                    background: 'var(--bg-main, #0d1117)',
                    border: '1px solid var(--ds-border, #30363d)',
                    borderRadius: '10px',
                    padding: '1.1rem 1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: '800', color: 'var(--text-primary, #e6edf3)', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
                        🔗 4. Link a los Ciclos para Revisar lo Ejecutado
                      </div>
                      <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.77rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Comparte o abre directamente los ciclos evaluados para revisar el detalle de cada ejecución en Test Pulse Suite o en el navegador de Jira:
                      </p>

                      {/* Link global JQL a los ciclos */}
                      {exitReportData.cyclesJqlUrl && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.5rem',
                          flexWrap: 'wrap',
                          padding: '0.55rem 0.75rem',
                          borderRadius: '8px',
                          background: 'rgba(56, 139, 253, 0.1)',
                          border: '1px solid rgba(56, 139, 253, 0.3)',
                          marginBottom: '0.75rem'
                        }}>
                          <a
                            href={exitReportData.cyclesJqlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#58a6ff', fontSize: '0.8rem', fontWeight: '700', textDecoration: 'underline', wordBreak: 'break-all' }}
                          >
                            🔗 Ver todos los ciclos evaluados en Jira ({exitReportData.cycleSummaries.length}) ↗
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              if (navigator.clipboard && navigator.clipboard.writeText) {
                                navigator.clipboard.writeText(exitReportData.cyclesJqlUrl);
                                addNotification({
                                  type: 'success',
                                  title: 'Link copiado',
                                  description: 'El hipervínculo JQL a los ciclos ejecutados se copió al portapapeles.'
                                });
                              }
                            }}
                            style={{
                              padding: '0.25rem 0.6rem',
                              borderRadius: '6px',
                              fontSize: '0.74rem',
                              fontWeight: '600',
                              background: 'var(--bg-surface, #161b22)',
                              color: '#58a6ff',
                              border: '1px solid rgba(56, 139, 253, 0.4)',
                              cursor: 'pointer'
                            }}
                          >
                            📋 Copiar Link
                          </button>
                        </div>
                      )}

                      {/* Lista de ciclos con acceso rápido a Ejecución y a Jira */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '135px', overflowY: 'auto' }}>
                        {exitReportData.cycleSummaries.map(c => (
                          <div
                            key={c.id || c.key}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '0.5rem',
                              padding: '0.4rem 0.65rem',
                              borderRadius: '6px',
                              background: 'var(--bg-surface, #161b22)',
                              border: '1px solid var(--ds-border, #30363d)',
                              fontSize: '0.78rem'
                            }}
                          >
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary, #e6edf3)' }}>
                              <strong style={{ color: '#ff6bc1' }}>{c.name}</strong>{' '}
                              <span style={{ color: 'var(--text-secondary, #8b949e)', fontSize: '0.72rem' }}>
                                ({c.executed}/{c.total} ejec. · {c.coveragePct}% cob. · {c.successPct}% éxito)
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                              {typeof setActiveTab === 'function' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const rawCycle = testCycles.find(tc => String(tc.id || tc.key) === String(c.id || c.key));
                                    if (rawCycle && typeof setSelectedCycle === 'function') {
                                      setSelectedCycle(rawCycle);
                                    }
                                    if (exitReportPlanId && exitReportPlanId !== 'ALL' && typeof setSelectedPlanId === 'function') {
                                      setSelectedPlanId(exitReportPlanId);
                                    }
                                    setActiveTab('execution');
                                  }}
                                  style={{
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: '5px',
                                    fontSize: '0.72rem',
                                    fontWeight: '700',
                                    background: 'rgba(225, 0, 122, 0.16)',
                                    color: '#ff6bc1',
                                    border: '1px solid rgba(225, 0, 122, 0.4)',
                                    cursor: 'pointer'
                                  }}
                                  title="Ir al módulo de Ejecución para revisar los casos ejecutados en este ciclo"
                                >
                                  ▶️ Revisar en Ejecución
                                </button>
                              )}
                              {c.browseUrl && (
                                <a
                                  href={c.browseUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    padding: '0.2rem 0.45rem',
                                    borderRadius: '5px',
                                    fontSize: '0.72rem',
                                    fontWeight: '600',
                                    background: 'rgba(56, 139, 253, 0.14)',
                                    color: '#58a6ff',
                                    border: '1px solid rgba(56, 139, 253, 0.35)',
                                    textDecoration: 'none'
                                  }}
                                  title={`Abrir ciclo ${c.name} en Jira`}
                                >
                                  Jira ↗
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* VISTA PREVIA EN VIVO DEL DOCUMENTO OFICIAL (FORMATO REPORTE EJECUTIVO LIVERPOOL) */}
                <div style={{
                  background: '#e5e7eb',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '1rem',
                  marginBottom: '1rem'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.6rem',
                    marginBottom: '0.75rem',
                    padding: '0.5rem 0.75rem',
                    background: 'linear-gradient(90deg, #8B1E41 0%, #C8102E 55%, #E1007A 100%)',
                    borderRadius: '8px',
                    color: '#ffffff'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: '800' }}>
                        📄 Documento Oficial — Formato Reporte Ejecutivo El Puerto de Liverpool
                      </div>
                      <div style={{ fontSize: '0.72rem', opacity: 0.92 }}>
                        ⚠️ NO ES UN VoBo (Visto Bueno) · Recomendación Técnica de Calidad (QA) lista para Correo o PDF
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={handleCopyExitReportHtml}
                        style={{
                          padding: '0.38rem 0.75rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: '800',
                          border: 'none',
                          background: '#ffffff',
                          color: '#8B1E41',
                          cursor: 'pointer'
                        }}
                      >
                        📋 Copiar para Correo (HTML)
                      </button>
                      <button
                        type="button"
                        onClick={handlePrintExitReportPdf}
                        style={{
                          padding: '0.38rem 0.75rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          border: '1px solid rgba(255,255,255,0.45)',
                          background: 'rgba(0,0,0,0.28)',
                          color: '#ffffff',
                          cursor: 'pointer'
                        }}
                      >
                        🖨️ Imprimir / Guardar PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => setExitReportModalOpen(true)}
                        style={{
                          padding: '0.38rem 0.75rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          border: '1px solid rgba(255,255,255,0.45)',
                          background: 'rgba(255,255,255,0.16)',
                          color: '#ffffff',
                          cursor: 'pointer'
                        }}
                      >
                        🔍 Abrir en Pantalla Completa / Editar
                      </button>
                    </div>
                  </div>

                  <div
                    id="tp-testing-exit-report-inline-canvas"
                    ref={(el) => {
                      if (el) applyExitReportInlineStyles(el);
                    }}
                    style={{
                      maxHeight: '640px',
                      overflowY: 'auto',
                      borderRadius: '8px'
                    }}
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(buildTestingExitReportHtml()) }}
                  />
                </div>

                {/* Footer de Acciones Rápidas del Testing Exit Report */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  paddingTop: '0.9rem',
                  borderTop: '1px solid var(--ds-border, #30363d)'
                }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                    💡 El reporte utiliza la plantilla oficial del <strong>Reporte Ejecutivo El Puerto de Liverpool</strong> lista para pegar en Gmail/Outlook o exportar a PDF.
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setExitReportModalOpen(true)}
                      style={{
                        padding: '0.55rem 1.15rem',
                        borderRadius: '6px',
                        fontSize: '0.84rem',
                        fontWeight: '700',
                        background: '#E1007A',
                        color: '#ffffff',
                        border: '1px solid #E1007A',
                        cursor: 'pointer'
                      }}
                    >
                      👁️ Vista Previa y Edición Ejecutiva
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 5: Control de Acceso al Proyecto (Admin Only) */}
              {isAdmin && (
                <div className="glass" style={{
                  background: 'var(--bg-surface, #161b22)',
                  border: '1px solid var(--ds-border, #30363d)',
                  borderRadius: '10px',
                  padding: '1.5rem 1.75rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '1.3rem' }}>🛡️</span>
                        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                          Control de Acceso y Estado de la Suite
                        </h2>
                      </div>
                      <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem', maxWidth: '650px' }}>
                        Habilita o deshabilita el acceso a Test Pulse Suite para este proyecto. Si está deshabilitado, los usuarios no administradores no podrán ver ni interactuar con la app en este proyecto.
                      </p>
                    </div>

                    <span style={{
                      padding: '0.35rem 0.8rem',
                      borderRadius: '20px',
                      fontSize: '0.82rem',
                      fontWeight: '600',
                      background: isProjectAllowed ? 'rgba(45, 164, 78, 0.15)' : 'rgba(248, 81, 73, 0.15)',
                      color: isProjectAllowed ? '#3fb950' : '#f85149',
                      border: `1px solid ${isProjectAllowed ? 'rgba(45, 164, 78, 0.3)' : 'rgba(248, 81, 73, 0.3)'}`
                    }}>
                      {isProjectAllowed ? '🟢 Activo en este Proyecto' : '⚪ Inactivo en este Proyecto'}
                    </span>
                  </div>

                  <label style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    background: 'var(--bg-main, #0d1117)',
                    padding: '0.75rem 1.25rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    fontWeight: '500',
                    color: 'var(--text-primary, #e6edf3)',
                    fontSize: '0.9rem'
                  }}>
                    <input
                      type="checkbox"
                      checked={isProjectAllowed}
                      onChange={async (e) => {
                        const enabled = e.target.checked;
                        setIsProjectAllowed(enabled);
                        try {
                          await invoke('setAllowedProjects', { projectId: selectedProjectId, enabled });
                          addNotification({
                            type: enabled ? 'success' : 'info',
                            title: enabled ? 'Proyecto Habilitado' : 'Proyecto Deshabilitado',
                            description: `Test Pulse Suite ha sido ${enabled ? 'habilitado' : 'deshabilitado'} para este proyecto.`
                          });
                        } catch (err) {
                          console.error("Error setting allowed project:", err);
                          addNotification({
                            type: 'error',
                            title: 'Error de permisos',
                            description: err.message || 'No se pudo actualizar el estado de acceso del proyecto.'
                          });
                        }
                      }}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <span>Habilitar Test Pulse Suite para usuarios de este proyecto</span>
                  </label>
                </div>
              )}

              {/* Card 5b: Vista por defecto en Ejecución (Admin Only) */}
              {isAdmin && (
                <div className="glass" style={{
                  background: 'var(--bg-surface, #161b22)',
                  border: '1px solid var(--ds-border, #30363d)',
                  borderRadius: '10px',
                  padding: '1.5rem 1.75rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1.3rem' }}>👤</span>
                    <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                      Vista por defecto en Ejecución
                    </h2>
                  </div>
                  <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem', maxWidth: '650px' }}>
                    Define qué casos ve cada usuario al abrir un ciclo en Ejecución. "Mis asignaciones" muestra los casos asignados al usuario o ejecutados por él; si no tiene ninguno en el ciclo, se muestran todos con un aviso. El usuario siempre puede cambiar el filtro.
                  </p>
                  <select
                    value={projectConfig?.executionDefaultView === 'MINE' ? 'MINE' : 'ALL'}
                    onChange={e => setProjectConfig(prev => ({ ...(prev || {}), executionDefaultView: e.target.value }))}
                    style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem', borderRadius: '6px', border: '1px solid var(--ds-border, #30363d)', background: 'var(--bg-main, #0d1117)', color: 'var(--text-primary, #e6edf3)', minWidth: '260px' }}
                  >
                    <option value="ALL">Todos los casos del ciclo</option>
                    <option value="MINE">Mis asignaciones / ejecuciones</option>
                  </select>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                    Se guarda con el botón "Guardar Configuración".
                  </div>
                </div>
              )}

              {/* Card 6: Mantenimiento de Test Runs (Admin Only) */}
              {isAdmin && (
                <div className="glass" style={{
                  background: 'var(--bg-surface, #161b22)',
                  border: '1px solid var(--ds-border, #30363d)',
                  borderRadius: '10px',
                  padding: '1.5rem 1.75rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1.3rem' }}>🔄</span>
                    <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                      Actualizar Test Runs desde el Test Case
                    </h2>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '10px', background: 'rgba(210,153,34,0.15)', color: '#d29922', border: '1px solid rgba(210,153,34,0.3)' }}>Solo Admin</span>
                  </div>
                  <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem', maxWidth: '760px' }}>
                    Toma una nueva "foto" (snapshot) del Test Case actual y la aplica a los Test Runs del ciclo: descripción + Precondiciones, Pasos y Resultados Esperados.
                    El snapshot anterior se guarda en el historial de auditoría del Run (quién y cuándo) y Jira conserva el cambio en su historial. Estados, evidencias e iteraciones <strong>no se modifican</strong>.
                  </p>

                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary, #8b949e)', marginBottom: '1rem' }}>
                    <strong style={{ color: 'var(--text-primary, #e6edf3)' }}>Campos detectados:</strong>{' '}
                    {!snapshotFieldMap ? 'Cargando…' : (() => {
                      const labels = { precondition: 'Precondiciones', steps: 'Pasos', expected: 'Resultados Esperados' };
                      return Object.keys(labels).map(k => {
                        const f = (snapshotFieldMap[k] || [])[0];
                        return (
                          <span key={k} style={{ display: 'inline-block', margin: '0.2rem 0.35rem 0.2rem 0', padding: '0.15rem 0.55rem', borderRadius: '10px', border: '1px solid var(--ds-border, #30363d)', color: f ? '#3fb950' : '#8b949e' }}>
                            {f ? '✓' : '—'} {labels[k]}{f ? ` (${f.name})` : ' (no encontrado)'}
                          </span>
                        );
                      });
                    })()}
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={resyncCycleId}
                      onChange={(e) => { setResyncCycleId(e.target.value); setResyncResult(null); }}
                      disabled={resyncRunning}
                      style={{ minWidth: '320px', padding: '0.55rem 0.75rem', borderRadius: '6px', background: 'var(--bg-main, #0d1117)', color: 'var(--text-primary, #e6edf3)', border: '1px solid var(--ds-border, #30363d)' }}
                    >
                      <option value="">Selecciona un ciclo…</option>
                      {testCycles.map(c => (
                        <option key={c.id} value={c.id}>{formatCleanName(c, 'Ciclo de Pruebas')}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleResyncCycleRuns}
                      disabled={!resyncCycleId || resyncRunning}
                      style={{ padding: '0.55rem 1.2rem', borderRadius: '6px', fontWeight: 600, border: '1px solid rgba(240,246,252,0.1)', background: (!resyncCycleId || resyncRunning) ? '#484f58' : '#1f6feb', color: '#fff', cursor: (!resyncCycleId || resyncRunning) ? 'not-allowed' : 'pointer' }}
                    >
                      {resyncRunning ? `⏳ Actualizando ${resyncProgress.done}/${resyncProgress.total}…` : '🔄 Actualizar Test Runs del ciclo'}
                    </button>
                  </div>

                  {resyncRunning && resyncProgress.total > 0 && (
                    <div style={{ marginTop: '0.9rem', height: '6px', borderRadius: '3px', background: 'var(--bg-main, #0d1117)', overflow: 'hidden', maxWidth: '520px' }}>
                      <div style={{ height: '100%', width: `${Math.round(resyncProgress.done / resyncProgress.total * 100)}%`, background: '#1f6feb', transition: 'width 0.3s ease' }} />
                    </div>
                  )}

                  {resyncResult && (
                    <div style={{ marginTop: '0.9rem', fontSize: '0.85rem', color: 'var(--text-primary, #e6edf3)' }}>
                      ✅ {resyncResult.ok} actualizados
                      {resyncResult.failed.length > 0 && <span style={{ color: '#f85149' }}> · ❌ {resyncResult.failed.length} con error</span>}
                      {resyncResult.withoutRun > 0 && <span style={{ color: '#8b949e' }}> · {resyncResult.withoutRun} casos sin Test Run (omitidos)</span>}
                      {resyncResult.failed.length > 0 && (
                        <ul style={{ margin: '0.4rem 0 0 1rem', color: '#8b949e', fontSize: '0.8rem' }}>
                          {resyncResult.failed.slice(0, 10).map(f => <li key={f.testRunId}>{f.testRunKey || f.testRunId}: {f.reason}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Bottom Action Bar */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: '1rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--ds-border, #30363d)',
                marginBottom: '2rem'
              }}>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="btn-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem 2rem',
                    fontSize: '1rem',
                    fontWeight: '600',
                    borderRadius: '6px',
                    background: isSavingConfig ? '#484f58' : '#238636',
                    color: '#ffffff',
                    border: '1px solid rgba(240, 246, 252, 0.1)',
                    cursor: isSavingConfig ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
                  }}
                >
                  <span>{isSavingConfig ? '⏳' : '💾'}</span>
                  <span>{isSavingConfig ? 'Guardando cambios...' : 'Guardar Configuración'}</span>
                </button>
              </div>

            </form>
          )}

          {/* MODAL DE VISTA PREVIA DEL TESTING EXIT REPORT (FORMATO EJECUTIVO LIVERPOOL) */}
          {exitReportModalOpen && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.78)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1.25rem'
              }}
              onClick={() => setExitReportModalOpen(false)}
            >
              <div
                style={{
                  width: '96%',
                  maxWidth: '1040px',
                  maxHeight: '92vh',
                  background: 'var(--bg-surface, #161b22)',
                  border: '1px solid var(--ds-border, #30363d)',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Barra superior del Modal */}
                <div style={{
                  padding: '1rem 1.35rem',
                  background: 'linear-gradient(90deg, #8B1E41 0%, #C8102E 55%, #E1007A 100%)',
                  color: '#ffffff',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  <div>
                    <div style={{ fontSize: '1.05rem', fontWeight: '800' }}>
                      🏁 Testing Exit Report — Formato Ejecutivo El Puerto de Liverpool
                    </div>
                    <div style={{ fontSize: '0.76rem', opacity: 0.9 }}>
                      ⚠️ Este documento NO es un VoBo (Visto Bueno) · Representa únicamente una recomendación técnica de Calidad (QA)
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setExitReportIsEditing(prev => !prev)}
                      style={{
                        padding: '0.42rem 0.85rem',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: '700',
                        border: '1px solid rgba(255,255,255,0.4)',
                        background: exitReportIsEditing ? '#ffffff' : 'rgba(255,255,255,0.16)',
                        color: exitReportIsEditing ? '#8B1E41' : '#ffffff',
                        cursor: 'pointer'
                      }}
                    >
                      {exitReportIsEditing ? '✅ Terminar Edición Inline' : '✏️ Editar Textos en el Reporte'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyExitReportHtml}
                      style={{
                        padding: '0.42rem 0.9rem',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: '800',
                        border: 'none',
                        background: '#ffffff',
                        color: '#8B1E41',
                        cursor: 'pointer'
                      }}
                    >
                      📋 Copiar para Correo (HTML)
                    </button>
                    <button
                      type="button"
                      onClick={handlePrintExitReportPdf}
                      style={{
                        padding: '0.42rem 0.9rem',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: '700',
                        border: '1px solid rgba(255,255,255,0.4)',
                        background: 'rgba(0,0,0,0.28)',
                        color: '#ffffff',
                        cursor: 'pointer'
                      }}
                    >
                      🖨️ Imprimir / Guardar PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => setExitReportModalOpen(false)}
                      style={{
                        padding: '0.42rem 0.75rem',
                        borderRadius: '6px',
                        fontSize: '0.82rem',
                        fontWeight: '800',
                        border: '1px solid rgba(255,255,255,0.35)',
                        background: 'transparent',
                        color: '#ffffff',
                        cursor: 'pointer'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Barra de Asunto sugerido y Publicación en Jira */}
                <div style={{
                  padding: '0.75rem 1.35rem',
                  background: 'var(--bg-main, #0d1117)',
                  borderBottom: '1px solid var(--ds-border, #30363d)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 380px' }}>
                    <span style={{ fontSize: '0.76rem', fontWeight: '700', color: 'var(--text-secondary, #8b949e)', whiteSpace: 'nowrap' }}>
                      ✉️ Asunto sugerido:
                    </span>
                    <input
                      type="text"
                      value={
                        exitReportSubject ||
                        `[Testing Exit Report] ${projectName || projectKey || 'Proyecto'} — ${exitReportData.planLabel} (${exitReportData.semaphoreEmoji} Calidad ${exitReportData.qualityLevel})`
                      }
                      onChange={(e) => setExitReportSubject(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '0.35rem 0.6rem',
                        borderRadius: '6px',
                        background: 'var(--bg-surface, #161b22)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        fontSize: '0.78rem'
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const subj =
                          exitReportSubject ||
                          `[Testing Exit Report] ${projectName || projectKey || 'Proyecto'} — ${exitReportData.planLabel} (${exitReportData.semaphoreEmoji} Calidad ${exitReportData.qualityLevel})`;
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                          navigator.clipboard.writeText(subj);
                          addNotification({ type: 'success', title: 'Asunto copiado', description: subj });
                        }
                      }}
                      style={{
                        padding: '0.35rem 0.65rem',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: '600',
                        background: 'var(--bg-surface, #161b22)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        cursor: 'pointer'
                      }}
                    >
                      Copiar Asunto
                    </button>
                  </div>

                  {/* Publicar como comentario en un Issue/Ciclo de Jira */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <input
                      type="text"
                      value={exitReportTargetIssue}
                      onChange={(e) => setExitReportTargetIssue(e.target.value)}
                      placeholder={exitReportData.cycleKeys[0] ? `Ej. ${exitReportData.cycleKeys[0]}` : 'Clave Jira (ej. QA-101)'}
                      style={{
                        width: '150px',
                        padding: '0.35rem 0.6rem',
                        borderRadius: '6px',
                        background: 'var(--bg-surface, #161b22)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        fontSize: '0.78rem'
                      }}
                    />
                    <button
                      type="button"
                      onClick={handlePublishExitReportToJira}
                      disabled={exitReportPublishing}
                      style={{
                        padding: '0.36rem 0.75rem',
                        borderRadius: '6px',
                        fontSize: '0.76rem',
                        fontWeight: '700',
                        background: '#1f6feb',
                        color: '#ffffff',
                        border: 'none',
                        cursor: exitReportPublishing ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {exitReportPublishing ? '⏳ Publicando…' : '💬 Publicar en Jira'}
                    </button>
                  </div>
                </div>

                {/* Lienzo del Reporte Ejecutivo */}
                <div style={{
                  padding: '1.25rem',
                  overflowY: 'auto',
                  background: '#e5e7eb',
                  flex: 1
                }}>
                  {exitReportIsEditing && (
                    <div style={{
                      maxWidth: '900px',
                      margin: '0 auto 0.75rem auto',
                      padding: '0.5rem 0.85rem',
                      background: '#fffbdd',
                      border: '1px solid #f59e0b',
                      borderRadius: '6px',
                      color: '#92400e',
                      fontSize: '0.78rem',
                      fontWeight: '600'
                    }}>
                      ✏️ Modo Edición Inline activo: Haz clic directamente sobre cualquier texto del reporte para personalizarlo antes de copiar para correo o imprimir a PDF.
                    </div>
                  )}
                  <div
                    id="tp-testing-exit-report-canvas"
                    ref={(el) => {
                      exitReportContainerRef.current = el;
                      if (el) applyExitReportInlineStyles(el);
                    }}
                    contentEditable={exitReportIsEditing}
                    suppressContentEditableWarning={true}
                    style={{
                      outline: exitReportIsEditing ? '2px dashed #E1007A' : 'none',
                      borderRadius: '8px'
                    }}
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(buildTestingExitReportHtml()) }}
                  />
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    );
}

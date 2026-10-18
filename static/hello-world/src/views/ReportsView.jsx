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
import { textToAdf, sanitizeRenderedHtml, adfToHtml, fetchAttachmentBlobData } from '../utils/adfUtils';
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

const APP_VERSION = `v${packageJson.version || '4.3.0'}`;

export default function ReportsView({ ctx }) {
  const {
    addNotification,
    availableEnvironments,
    calcScheduleDays,
    circuitBreakerActive,
    context,
    dashboardBugSearch,
    dashboardCycleBugFilter,
    dashboardGeneralBugSearch,
    dashboardGeneralBugStatusTab,
    dashboardSubView,
    dashboardTraceabilitySearch,
    dashboardWidgets,
    draggedWidgetIndex,
    executiveReportBuild,
    executiveReportContainerRef,
    executiveReportModalOpen,
    executiveReportNotes,
    executiveReportSubject,
    expandedTraceabilityEpics,
    findTc,
    folderPaths,
    folders,
    formatShortDateEs,
    getExecVal,
    handleAddWidget,
    handleConfirmLinkUnlinkedBug,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleMoveWidget,
    handleRemoveWidget,
    handleRemoveWidgetByType,
    handleResetDashboardLayout,
    handleSaveDashboardLayout,
    handleToggleWidgetWidth,
    isCustomizingDashboard,
    isCycleInPlan,
    isFolderSidebarVisible,
    isHydratingReport,
    isLinkingUnlinkedBugLoading,
    isRefreshingReport,
    isResizing,
    linkingUnlinkedBug,
    loadReportData,
    openTraceabilityItemModal,
    perCycleCacheRef,
    planScheduleForm,
    projectConfig,
    projects,
    reportAutomationConfig,
    reportData,
    reportLoading,
    reportSelectedCycles,
    reportSelectedPlans,
    reportSelectedVersions,
    requirementsMap,
    runsCycleCarouselRef,
    runsPlanDropdownOpen,
    selectedDashboardSeverityFilter,
    selectedPlanId,
    selectedProjectId,
    setDashboardBugSearch,
    setDashboardCycleBugFilter,
    setDashboardGeneralBugSearch,
    setDashboardGeneralBugStatusTab,
    setDashboardSubView,
    setDashboardTraceabilitySearch,
    setExecutiveReportBuild,
    setExecutiveReportModalOpen,
    setExecutiveReportNotes,
    setExecutiveReportSubject,
    setExpandedTraceabilityEpics,
    setIsCustomizingDashboard,
    setIsResizing,
    setLinkingUnlinkedBug,
    setReportAutomationLastDispatch,
    setReportAutomationTesting,
    setReportSelectedCycles,
    setReportSelectedPlans,
    setRunsPlanDropdownOpen,
    setSelectedBug,
    setSelectedDashboardSeverityFilter,
    setShowAddWidgetModal,
    setShowUnlinkedBugsModal,
    setTargetCycleForBug,
    setTargetTestForBug,
    showAddWidgetModal,
    showUnlinkedBugsModal,
    sidebarWidth,
    targetCycleForBug,
    targetTestForBug,
    testCases,
    testCycles,
    testPlans,
    toggleFolderSidebar,
    traceabilityHierarchy,
    traceabilityHierarchyLoading,
    unlinkedBugs
  } = ctx;

    // Show TestPulseLoader only on initial load if no reportData is available yet
    if (reportLoading && (!reportData.cycles || reportData.cycles.length === 0)) {
      return (
        <TestPulseLoader
          size={110}
          text="Cargando métricas y tableros de Reports..."
        />
      );
    }

    if (reportData._loadError && (!reportData.cycles || reportData.cycles.length === 0)) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1rem', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '2rem' }}>⚠️</div>
          <div style={{ fontWeight: 500 }}>El reporte tardó demasiado en cargar</div>
          <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Intenta de nuevo con el botón de abajo</div>
          <button className="btn-primary" onClick={loadReportData} style={{ padding: '0.5rem 1.2rem' }}>
            🔄 Reintentar
          </button>
        </div>
      );
    }

    // 1. Plan Cycles (all cycles within the selected plan(s), or all cycles if no plan filter)
    const baseReportCycles = reportData.cycles || [];
    let planCycles = baseReportCycles.map(c => {
      const tcCycle = (testCycles || []).find(tc => String(tc.id) === String(c.id));
      const rawCSched = c.schedule?.value || c.schedule;
      const rawTcSched = tcCycle?.schedule?.value || tcCycle?.schedule;
      const mergedSchedule = (rawCSched && (rawCSched.startDate || rawCSched.endDate))
        ? rawCSched
        : ((rawTcSched && (rawTcSched.startDate || rawTcSched.endDate)) ? rawTcSched : (rawCSched || rawTcSched || null));
      const cMerged = {
        ...tcCycle,
        ...c,
        planId: c.planId || tcCycle?.planId || null,
        schedule: mergedSchedule,
        version: c.version || tcCycle?.version,
        versions: c.versions || tcCycle?.versions,
        fixVersions: c.fixVersions || tcCycle?.fixVersions,
        build: c.build || tcCycle?.build,
        buildVersion: c.buildVersion || tcCycle?.buildVersion,
        rawFields: c.rawFields || tcCycle?.rawFields
      };
      const cIdStr = String(c.id);
      const cached = perCycleCacheRef.current[cIdStr];
      if (cached && Array.isArray(cached) && cached.length > 0) {
        const execMap = new Map();
        (c.execution || []).forEach(item => {
          const k = item.testCaseKey || item.key || item.id;
          if (k) execMap.set(String(k), item);
        });
        // Live in-memory execution from Planning/Execution takes precedence for completeness & latest status, while preserving enriched bug details
        (cached || []).forEach(item => {
          const k = item.testCaseKey || item.key || item.id;
          if (k) {
            const existing = execMap.get(String(k));
            if (existing) {
              const mergedBugs = (item.linkedBugs || existing.linkedBugs || []).map(b => {
                const eb = (existing.linkedBugs || []).find(x => x.key === b.key) || reportData?.bugMap?.[b.key] || {};
                return { ...eb, ...b, severity: eb.severity || b.severity, summary: eb.summary || b.summary };
              });
              execMap.set(String(k), { ...existing, ...item, linkedBugs: mergedBugs });
            } else {
              execMap.set(String(k), item);
            }
          }
        });
        return {
          ...cMerged,
          execution: Array.from(execMap.values())
        };
      }
      return cMerged;
    });

    // Also include any cycles from testCycles that might belong to the plan but aren't yet in reportData
    (testCycles || []).forEach(tcCycle => {
      const exists = planCycles.some(pc => String(pc.id) === String(tcCycle.id));
      if (!exists) {
        const cIdStr = String(tcCycle.id);
        const cached = perCycleCacheRef.current[cIdStr] || [];
        planCycles.push({
          ...tcCycle,
          id: tcCycle.id,
          key: tcCycle.key,
          summary: tcCycle.summary,
          planId: tcCycle.planId,
          schedule: tcCycle.schedule?.value || tcCycle.schedule || null,
          version: tcCycle.version,
          versions: tcCycle.versions,
          fixVersions: tcCycle.fixVersions,
          build: tcCycle.build,
          buildVersion: tcCycle.buildVersion,
          rawFields: tcCycle.rawFields,
          execution: cached
        });
      }
    });

    if (reportSelectedPlans && reportSelectedPlans.length > 0) {
      planCycles = planCycles.filter(c => reportSelectedPlans.some(pId => isCycleInPlan(c, pId) || String(pId) === String(c.planId)));
    }

    // Helper to extract clean version strings and semantic versions from an entity (bug, cycle, etc.)
    const extractVersions = (entity, isBug = false) => {
      if (!entity) return { versions: [], semanticVersions: [] };
      const rawList = [];
      const addVal = (val) => {
        if (!val) return;
        if (typeof val === 'string') {
          val.split(',').forEach(s => {
            const trimmed = s.trim();
            if (trimmed && trimmed.toLowerCase() !== 'sin versión' && trimmed.toLowerCase() !== 'sin version') {
              rawList.push(trimmed);
            }
          });
        } else if (typeof val === 'object' && val !== null) {
          const name = val.name || val.value || val.label || '';
          if (name && typeof name === 'string') {
            const trimmed = name.trim();
            if (trimmed && trimmed.toLowerCase() !== 'sin versión' && trimmed.toLowerCase() !== 'sin version') {
              rawList.push(trimmed);
            }
          }
        }
      };

      const processList = (list) => {
        if (!list) return;
        if (Array.isArray(list)) list.forEach(addVal);
        else addVal(list);
      };

      processList(entity.versions);
      processList(entity.fixVersions);
      processList(entity.version);
      processList(entity.build);
      processList(entity.buildVersion);
      if (entity.rawFields) {
        processList(entity.rawFields.versions);
        processList(entity.rawFields.fixVersions);
      }

      // ONLY extract version from summary/name for non-bugs (e.g. cycles, plans, test suites)
      if (!isBug) {
        const entityName = String(entity.summary || entity.name || '').trim();
        if (entityName) {
          const semVerRegex = /\b\d+(\.\d+)+\b/g;
          const matches = entityName.match(semVerRegex);
          if (matches) {
            matches.forEach(m => rawList.push(m));
          }
        }
      }

      const normalized = Array.from(new Set(rawList.map(v => v.trim().toLowerCase())));
      const semanticVersions = Array.from(new Set(
        normalized.flatMap(v => {
          const m = v.match(/\b\d+(\.\d+)+\b/g);
          return m ? m : [];
        })
      ));

      return { versions: normalized, semanticVersions };
    };

    // Helper to test if any item (bug, cycle, execution, test case) matches reportSelectedVersions
    const matchSelectedVersions = (item, selectedVers) => {
      if (!selectedVers || !Array.isArray(selectedVers) || selectedVers.length === 0) return true;
      if (!item) return false;

      const isBugItem = isActualBug(item);
      const itemVer = extractVersions(item, isBugItem);
      const targetsLower = selectedVers.map(t => String(t).trim().toLowerCase());
      const wantsSinVersion = targetsLower.includes('sin versión') || targetsLower.includes('sin version');

      if (itemVer.versions.length === 0 && itemVer.semanticVersions.length === 0) {
        return wantsSinVersion;
      }

      for (const t of targetsLower) {
        if (t === 'sin versión' || t === 'sin version') continue;
        const tSemVers = t.match(/\b\d+(\.\d+)+\b/g) || [];
        if (tSemVers.length > 0 && itemVer.semanticVersions.length > 0) {
          if (tSemVers.some(tsv => itemVer.semanticVersions.includes(tsv))) {
            return true;
          }
        }
        for (const ex of itemVer.versions) {
          if (ex === t || ex.includes(t) || t.includes(ex)) {
            return true;
          }
        }
      }

      return false;
    };

    // Helper to determine if a bug belongs to a specific cycle
    const bugMatchesCycle = (bug, cycle) => {
      if (!bug || !cycle) return false;

      const bugVer = extractVersions(bug, true);
      const cycleVer = extractVersions(cycle, false);

      const bugHasExplicitVersion = bugVer.versions.length > 0 || bugVer.semanticVersions.length > 0;
      const cycleHasExplicitVersion = cycleVer.versions.length > 0 || cycleVer.semanticVersions.length > 0;

      // Check if bug was explicitly recorded in this cycle's test executions
      const isDirectlyExecutedInCycle = Array.isArray(cycle.execution) && cycle.execution.some(ex => 
        Array.isArray(ex.linkedBugs) && ex.linkedBugs.some(lb => lb && (lb.key === bug.key || String(lb.id) === String(bug.id)))
      );

      // 1. If BOTH bug and cycle have semantic version numbers (e.g. Bug: 3.72.12.07 vs Cycle: 3.72.12.12)
      if (bugVer.semanticVersions.length > 0 && cycleVer.semanticVersions.length > 0) {
        const hasMatchingSemVer = bugVer.semanticVersions.some(bv => cycleVer.semanticVersions.includes(bv));
        if (hasMatchingSemVer) return true;
        // HARD CONFLICT: Bug is explicitly for a different version than this cycle!
        // Never include in this cycle even if a test case has historical links.
        return false;
      }

      // 2. If BOTH have named versions (e.g. Bug: "Release Sprint 4" vs Cycle: "Release Sprint 5")
      if (bugVer.versions.length > 0 && cycleVer.versions.length > 0) {
        const hasMatchingVer = bugVer.versions.some(bv => 
          cycleVer.versions.some(cv => cv === bv || cv.includes(bv) || bv.includes(cv))
        );
        if (hasMatchingVer) return true;
        // HARD CONFLICT: Named versions differ
        return false;
      }

      // 3. If Bug has an explicit version, but Cycle has NO version info:
      if (bugHasExplicitVersion && !cycleHasExplicitVersion) {
        const cycleSummaryLower = String(cycle.summary || cycle.key || '').toLowerCase();
        const matchesSummary = bugVer.versions.some(bv => cycleSummaryLower.includes(bv)) ||
                               bugVer.semanticVersions.some(bv => cycleSummaryLower.includes(bv));
        if (matchesSummary) return true;
        // If not in summary, only include if directly executed in this unversioned cycle
        return isDirectlyExecutedInCycle;
      }

      // 4. If Bug has NO version ("Sin versión"):
      // It belongs to this cycle ONLY IF it was directly linked/executed in this cycle
      if (!bugHasExplicitVersion) {
        return isDirectlyExecutedInCycle;
      }

      return false;
    };

    // 2. Cycle-filtered Cycles (cycles filtered by specific cycle selection for Runs & Cycle Bugs)
    let filteredCycles = planCycles;
    if (reportSelectedCycles && reportSelectedCycles.length > 0) {
      filteredCycles = filteredCycles.filter(c => reportSelectedCycles.some(rcId => String(rcId) === String(c.id)));
    }

    // ── Bug & Field Extraction Helpers ──
    const isActualBug = (bug) => {
      if (!bug || !bug.key) return false;
      // 1. Exclude if key/id matches any known test case in the system
      if (testCases.some(t => String(t.id) === String(bug.id) || String(t.key) === String(bug.key))) {
        return false;
      }
      // 2. Exclude if key/id matches any known test cycle or test plan
      if (testCycles.some(c => String(c.id) === String(bug.id) || String(c.key) === String(bug.key))) {
        return false;
      }
      if (testPlans.some(p => String(p.id) === String(bug.id) || String(p.key) === String(bug.key))) {
        return false;
      }
      // 3. Exclude if summary has test management prefix
      if (bug.summary && (bug.summary.startsWith('[Test Case]') || bug.summary.startsWith('TC-') || bug.summary.startsWith('[Test Plan]') || bug.summary.startsWith('[Test Cycle]'))) {
        return false;
      }
      // 4. Strict issue type verification (only bug, error, defecto, defect, falla, incidente, incident, problem)
      const rawType = (bug.issuetype || bug.issueType?.name || bug.issueType || bug.rawFields?.issuetype?.name || '').toLowerCase().trim();
      if (rawType) {
        const validBugKeywords = ['bug', 'error', 'defecto', 'defect', 'falla', 'incidente', 'incident', 'problem', 'problema', 'fallo', 'anomalia', 'anomalía'];
        const isBug = validBugKeywords.some(kw => rawType.includes(kw));
        if (!isBug) return false;
      }
      // 5. If it is only a raw stub from linkedBugs without matching real Jira issue in bugMap, unlinkedBugs, or rawFields
      const mapBug = reportData?.bugMap?.[bug.key];
      const projBug = (unlinkedBugs || []).find(ub => ub.key === bug.key);
      if (!mapBug && !projBug && !bug.rawFields && (!bug.summary || bug.summary === 'Defecto detectado en ciclo')) {
        return false;
      }
      return true;
    };

    // Strict *Severity normalization: checks customfield_10238, customfields holding severity, or explicit severity
    const normalizeSeverity = (rawSev, rawFields) => {
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

      if (!s || s === 'Sin definir' || s === 'N/A') return 'Sin definir';

      const low = s.toLowerCase();
      if (low.includes('bloq') || low.includes('blocker')) return 'Bloqueante';
      if (low.includes('crit') || low.includes('crític')) return 'Crítico';
      if (low.includes('may') || low.includes('major') || low.includes('alta') || low.includes('high')) return 'Mayor';
      if (low.includes('med') || low.includes('medio') || low.includes('media')) return 'Medio';
      if (low.includes('men') || low.includes('minor') || low.includes('baja') || low.includes('low') || low.includes('trivial')) return 'Menor';
      return s;
    };

    // Strict business rule: ONLY 'closed', 'cerrado', 'cerrada' are considered closed; everything else is open!
    const isBugDone = (b) => {
      if (!b) return false;
      const statusStr = (typeof b === 'string' ? b : (b.status || b.fields?.status?.name || b.rawFields?.status?.name || '')).toLowerCase().trim();
      return ['closed', 'cerrado', 'cerrada'].includes(statusStr);
    };

    // Validates whether the bug's current status actually corresponds to a resolved/validation/closed state.
    // Prevents inventing or displaying stale Jira resolutions (e.g. "Listo" when status is "Análisis" or "Abierto").
    const isBugStatusResolved = (statusStr, isDoneFlag) => {
      const low = String(statusStr || '').toLowerCase().trim();
      return (
        Boolean(isDoneFlag) ||
        low.includes('resuelta') ||
        low.includes('resuelto') ||
        low.includes('resolved') ||
        low.includes('validaci') ||
        low.includes('validation') ||
        low.includes('cerrada') ||
        low.includes('cerrado') ||
        low.includes('closed') ||
        low.includes('done') ||
        low.includes('listo') ||
        low.includes('finalizad') ||
        low.includes('completad') ||
        low.includes('solucionad')
      );
    };

    const resolveValidBugResolution = (bugObj, isDoneFlag) => {
      const statusStr = bugObj?.status || bugObj?.fields?.status?.name || bugObj?.rawFields?.status?.name || '';
      if (!isBugStatusResolved(statusStr, isDoneFlag)) {
        return 'Sin resolver';
      }
      let rawRes = 'Sin resolver';
      if (bugObj?.resolution && typeof bugObj.resolution === 'string' && bugObj.resolution !== 'Unresolved' && bugObj.resolution !== 'Sin resolver') {
        rawRes = bugObj.resolution;
      } else if (bugObj?.rawFields?.resolution?.name && bugObj.rawFields.resolution.name !== 'Unresolved') {
        rawRes = bugObj.rawFields.resolution.name;
      } else if (typeof bugObj?.resolution === 'object' && bugObj.resolution?.name && bugObj.resolution.name !== 'Unresolved') {
        rawRes = bugObj.resolution.name;
      }
      return rawRes || 'Sin resolver';
    };

    const renderBugStatusLozenge = (statusStr, isDone) => {
      const st = (statusStr || '').trim();
      const low = st.toLowerCase();
      if (['closed', 'cerrada', 'cerrado'].includes(low) || isDone) {
        return <span className="ads-lozenge ads-lozenge-success" style={{ fontSize: '10px', fontWeight: 700 }}>{st || 'Cerrado'}</span>;
      }
      if (low.includes('on hold') || low.includes('on-hold') || low.includes('onhold') || low.includes('en espera') || low.includes('pausad') || low === 'hold') {
        return (
          <span
            className="ads-lozenge ads-lozenge-subtle"
            style={{ fontSize: '10px', fontWeight: 700, backgroundColor: '#E9F2FF', color: '#0C66E4', border: '1px solid #CCE0FF' }}
            title="Reloj de atención en pausa (On Hold)"
          >
            ⏸️ {st || 'ON HOLD'}
          </span>
        );
      }
      if (low.includes('prog') || low.includes('curs') || low.includes('desarr') || low.includes('dev')) {
        return <span className="ads-lozenge ads-lozenge-brand" style={{ fontSize: '10px', fontWeight: 700 }}>{st || 'En progreso'}</span>;
      }
      if (low.includes('anal') || low.includes('rev') || low.includes('block') || low.includes('bloq') || low.includes('qa') || low.includes('test') || low.includes('resuel') || low.includes('resolv') || low.includes('done')) {
        return <span className="ads-lozenge ads-lozenge-warning" style={{ fontSize: '10px', fontWeight: 700 }}>{st || 'En análisis'}</span>;
      }
      return <span className="ads-lozenge ads-lozenge-danger" style={{ fontSize: '10px', fontWeight: 700 }}>{st || 'Abierto'}</span>;
    };

    const renderBugDueDate = (dueDateStr, isDone) => {
      if (!dueDateStr) {
        return <span style={{ color: 'var(--jira-subtle, #626F86)', fontStyle: 'italic', fontSize: '11px' }}>No definida</span>;
      }
      try {
        const d = new Date(dueDateStr + (dueDateStr.includes('T') ? '' : 'T23:59:59'));
        if (isNaN(d.getTime())) {
          return <span style={{ color: 'var(--jira-subtle, #626F86)', fontSize: '11px' }}>{dueDateStr}</span>;
        }
        const formatted = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
        const isOverdue = !isDone && (d.getTime() < Date.now());
        
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ fontSize: '11px', color: isOverdue ? '#BF2600' : 'var(--jira-dark, #172B4D)', fontWeight: isOverdue ? 700 : 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>📅</span> <span>{formatted}</span>
            </div>
            {isOverdue ? (
              <span className="ads-lozenge ads-lozenge-danger" style={{ fontSize: '9px', fontWeight: 700, width: 'fit-content', padding: '1px 5px' }} title="Fecha estimada de resolución vencida">
                ⚠️ VENCIDA
              </span>
            ) : !isDone ? (
              <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '9px', fontWeight: 600, width: 'fit-content', padding: '1px 5px' }}>
                En tiempo
              </span>
            ) : null}
          </div>
        );
      } catch (e) {
        return <span style={{ color: 'var(--jira-subtle, #626F86)', fontSize: '11px' }}>{dueDateStr}</span>;
      }
    };

    // Test Type extraction helper for filtering Functional tests
    const getTestType = (tc, ex) => {
      const raw = tc?.rawFields?.['customfield_10535'] || 
                  (projectConfig?.testTypeFieldId && tc?.rawFields?.[projectConfig.testTypeFieldId]) ||
                  tc?.testType ||
                  tc?.tipoPrueba ||
                  ex?.rawFields?.['customfield_10535'] ||
                  ex?.testType ||
                  '';
      if (typeof raw === 'object' && raw !== null) {
        return (raw.value || raw.name || raw.label || String(raw)).trim();
      }
      return String(raw || '').trim();
    };

    const isFunctionalTest = (tc, ex) => {
      const tType = getTestType(tc, ex).toLowerCase();
      // If empty/undefined, Test Pulse defaults to 'Funcional'
      if (!tType) return true;
      if (tType.includes('no funcional') || tType.includes('no-funcional') || tType.includes('non-functional')) {
        return false;
      }
      return tType.includes('func') || tType === 'funcional' || tType === 'functional';
    };

    let totalCases = 0;
    let passed = 0;
    let failed = 0;
    let blocked = 0;
    let notRun = 0;
    let totalResolutionHours = 0;
    let resolvedCount = 0;
    
    // Config
    const conf = projectConfig || {};
    const showProgreso = conf.showProgreso !== false;
    const showTesterStats = conf.showTesterStats !== false;
    const showExecTypeStats = conf.showExecTypeStats !== false;
    const showBugTimes = conf.showBugTimes !== false;
    const showFeatureStats = conf.showFeatureStats !== false;

    // Custom metrics
    const testerStats = {};
    const moduleStats = {};
    const featureStats = {};
    const bugTimes = {};
    const execStats = {
      manual: { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 },
      auto: { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 }
    };

    // ── 1. Plan-Level Bugs (Consolidated across all cycles in plan, all statuses) ──
    const planAllBugsMap = new Map();
    planCycles.forEach(cycle => {
      if (cycle.execution && Array.isArray(cycle.execution)) {
        const seenTcInCycle = new Set();
        cycle.execution.forEach((ex, idx) => {
          const tcKey = ex.key || ex.testCaseKey || (findTc(ex.id)?.key) || '';
          const tcId = String(ex.id || ex.testCaseId || '');
          const dedupeKey = tcKey ? `key_${tcKey}` : (tcId ? `id_${tcId}` : `item_${idx}`);
          if (seenTcInCycle.has(dedupeKey)) return;
          seenTcInCycle.add(dedupeKey);

          if (ex.linkedBugs && Array.isArray(ex.linkedBugs)) {
            const tc = findTc(ex.id);
            const tcKeyDisplay = tc ? tc.key : (ex.key || `TC-${ex.id}`);
            const tcSummary = tc ? tc.summary : (ex.summary || 'Caso de prueba');

            ex.linkedBugs.forEach(rawBug => {
              if (!rawBug || !rawBug.key || !isActualBug(rawBug)) return;

              const bugKey = rawBug.key;
              const projectBug = (unlinkedBugs || []).find(ub => ub.key === bugKey);
              const mapBug = reportData?.bugMap?.[bugKey];
              const bug = {
                ...rawBug,
                ...(mapBug || {}),
                ...(projectBug || {}),
                summary: mapBug?.summary || projectBug?.summary || ((rawBug.summary && rawBug.summary !== 'Defecto detectado en ciclo') ? rawBug.summary : 'Defecto detectado en ciclo'),
                severity: mapBug?.severity || projectBug?.severity || ((rawBug.severity && rawBug.severity !== 'Sin definir') ? rawBug.severity : 'Sin definir'),
                assignee: mapBug?.assignee || projectBug?.assignee || ((rawBug.assignee && rawBug.assignee !== 'Sin asignar') ? rawBug.assignee : 'Sin asignar'),
                status: mapBug?.status || projectBug?.status || rawBug.status || 'Abierto',
                resolution: mapBug?.resolution || projectBug?.resolution || rawBug.resolution || 'Sin resolver',
                created: mapBug?.created || projectBug?.created || rawBug.created || rawBug.rawFields?.created || null,
                resolutiondate: mapBug?.resolutiondate || projectBug?.resolutiondate || rawBug.resolutiondate || rawBug.rawFields?.resolutiondate || null,
                duedate: mapBug?.duedate || projectBug?.duedate || rawBug.duedate || rawBug.rawFields?.duedate || null,
                version: mapBug?.version || projectBug?.version || rawBug.version || 'Sin versión',
                versions: mapBug?.versions || projectBug?.versions || rawBug.versions || [],
                fixVersions: mapBug?.fixVersions || projectBug?.fixVersions || rawBug.fixVersions || [],
                rawFields: mapBug?.rawFields || projectBug?.rawFields || rawBug.rawFields
              };

              // Ensure bug belongs to this cycle (checks version compatibility and execution)
              if (!bugMatchesCycle(bug, cycle)) return;

              const isDone = isBugDone(bug);
              const finalSeverity = normalizeSeverity(bug.severity, bug.rawFields);
              const resName = resolveValidBugResolution(bug, isDone);

              const rawAff = bug.versions || bug.rawFields?.versions || [];
              const rawFix = bug.fixVersions || bug.rawFields?.fixVersions || [];
              const affectsVersions = (Array.isArray(rawAff) ? rawAff : [rawAff]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
              const fixVersions = (Array.isArray(rawFix) ? rawFix : [rawFix]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
              const versionDisplay = (bug.version && bug.version !== 'Sin versión')
                ? bug.version 
                : (affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión'));

              const cycleName = cycle.summary || cycle.key || String(cycle.id);
              const cycleMatchesVersion = !reportSelectedVersions || reportSelectedVersions.length === 0 || matchSelectedVersions(cycle, reportSelectedVersions);
              const shouldAddCycle = cycleMatchesVersion || !reportSelectedVersions || reportSelectedVersions.length === 0;

              if (!planAllBugsMap.has(bugKey)) {
                planAllBugsMap.set(bugKey, {
                  key: bugKey,
                  summary: bug.summary || 'Defecto detectado en ciclo',
                  severity: finalSeverity,
                  assignee: (typeof bug.assignee === 'object' && bug.assignee !== null) ? (bug.assignee.displayName || bug.assignee.name || 'Sin asignar') : (bug.assignee || 'Sin asignar'),
                  status: bug.status || (isDone ? 'Cerrado' : 'Abierto'),
                  resolution: resName,
                  isDone: isDone,
                  version: versionDisplay,
                  versions: affectsVersions,
                  fixVersions: fixVersions,
                  created: bug.created || bug.rawFields?.created || null,
                  resolutiondate: bug.resolutiondate || bug.rawFields?.resolutiondate || null,
                  duedate: bug.duedate || null,
                  isReopened: Boolean(bug.isReopened),
                  reopenedAt: bug.reopenedAt || null,
                  reopenCount: bug.reopenCount || 0,
                  isOnHold: Boolean(bug.isOnHold),
                  onHoldSince: bug.onHoldSince || null,
                  onHoldBusinessHours: typeof bug.onHoldBusinessHours === 'number' ? bug.onHoldBusinessHours : null,
                  activeBusinessHours: typeof bug.activeBusinessHours === 'number' ? bug.activeBusinessHours : null,
                  resolutionBusinessHours: typeof bug.resolutionBusinessHours === 'number' ? bug.resolutionBusinessHours : null,
                  lastTerminalAt: bug.lastTerminalAt || null,
                  cycles: shouldAddCycle ? new Set([cycleName]) : new Set(),
                  affectedCases: new Map()
                });

                if (isDone) {
                  // Pass `bug` metadata as 4th argument so MTTR excludes closed intervals and On Hold pauses
                  const bugAgeInfo = formatBugAge(
                    bug.created || bug.rawFields?.created,
                    bug.resolutiondate || bug.rawFields?.resolutiondate,
                    true,
                    bug
                  );
                  if (bugAgeInfo && typeof bugAgeInfo.hours === 'number' && bugAgeInfo.hours > 0) {
                    totalResolutionHours += bugAgeInfo.hours;
                    resolvedCount++;
                  }
                } else if (bug.timesSpent && Object.keys(bug.timesSpent).length > 0) {
                  for (const [state, hours] of Object.entries(bug.timesSpent)) {
                    if (!bugTimes[state]) bugTimes[state] = { totalHours: 0, count: 0 };
                    bugTimes[state].totalHours += hours;
                    bugTimes[state].count++;
                    
                    const stateLow = state.toLowerCase();
                    if (stateLow === 'in progress' || stateLow === 'en curso') {
                      totalResolutionHours += hours;
                    }
                  }
                  resolvedCount++;
                }
              } else {
                if (shouldAddCycle) {
                  planAllBugsMap.get(bugKey).cycles.add(cycleName);
                }
              }

              const entry = planAllBugsMap.get(bugKey);
              entry.affectedCases.set(String(ex.id), {
                id: ex.id,
                key: tcKeyDisplay,
                summary: tcSummary,
                status: ex.status,
                cycleName: cycleName
              });
            });
          }
        });
      }
    });

    // ── 2. Cycle-Level Runs & Bugs (Scoped to filteredCycles) ──
    const cycleOpenBugsMap = new Map();
    const cycleAllBugsMap = new Map();

    filteredCycles.forEach(cycle => {
      if (cycle.execution && Array.isArray(cycle.execution)) {
        const cycleName = cycle.summary || cycle.key || `Ciclo-${cycle.id}`;
        const seenTcInCycle = new Set();
        cycle.execution.forEach((ex, idx) => {
          const tcKey = ex.key || ex.testCaseKey || (findTc(ex.id)?.key) || '';
          const tcId = String(ex.id || ex.testCaseId || '');
          const dedupeKey = tcKey ? `key_${tcKey}` : (tcId ? `id_${tcId}` : `item_${idx}`);
          if (seenTcInCycle.has(dedupeKey)) return;
          seenTcInCycle.add(dedupeKey);

          const tc = findTc(ex.id);

          const normExStatus = normalizeUiStatus(ex.status);
          totalCases++;
          if (normExStatus === 'Passed') passed++;
          else if (normExStatus === 'Failed') failed++;
          else if (normExStatus === 'Blocked') blocked++;
          else notRun++;
          
          // Exec Type
          let isAuto = false;
          if (getExecVal && typeof getExecVal === 'function' && getExecVal({ rawFields: ex.rawFields }).includes('auto')) {
             isAuto = true;
          }
          if (tc && getExecVal(tc).includes('auto')) {
             isAuto = true;
          }
          const stats = isAuto ? execStats.auto : execStats.manual;
          stats.total++;
          if (normExStatus === 'Passed') stats.passed++;
          else if (normExStatus === 'Failed') stats.failed++;
          else if (normExStatus === 'Blocked') stats.blocked++;
          else stats.notRun++;

          // Tester
          const tester = (ex.executedBy && typeof ex.executedBy === 'object') ? (ex.executedBy.displayName || ex.executedBy.name || 'Sin asignar') : (ex.executedBy || 'Sin asignar');
          if (!testerStats[tester]) testerStats[tester] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
          testerStats[tester].total++;
          if (normExStatus === 'Passed') testerStats[tester].passed++;
          else if (normExStatus === 'Failed') testerStats[tester].failed++;
          else if (normExStatus === 'Blocked') testerStats[tester].blocked++;
          else testerStats[tester].notRun++;

          // Module / Folder Stats (Only Functional Tests)
          if (isFunctionalTest(tc, ex)) {
            const folderObj = folders.find(f => String(f.id) === String(tc?.folderId || tc?.folder));
            const folderName = folderObj?.name || tc?.folderName || tc?.folder || 'General';
            if (!moduleStats[folderName]) moduleStats[folderName] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
            moduleStats[folderName].total++;
            if (normExStatus === 'Passed') moduleStats[folderName].passed++;
            else if (normExStatus === 'Failed') moduleStats[folderName].failed++;
            else if (normExStatus === 'Blocked') moduleStats[folderName].blocked++;
            else moduleStats[folderName].notRun++;
          }

          // Feature / Module (Only Functional Tests)
          const tcFeature = tc || findTc(ex.id);
          if (tcFeature && tcFeature.folderId && isFunctionalTest(tcFeature, ex)) {
            const fObj = folderPaths.find(f => f.id === tcFeature.folderId);
            if (fObj) {
              const folderPath = fObj.path;
              if (!featureStats[folderPath]) featureStats[folderPath] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
              featureStats[folderPath].total++;
              if (normExStatus === 'Passed') featureStats[folderPath].passed++;
              else if (normExStatus === 'Failed') featureStats[folderPath].failed++;
              else if (normExStatus === 'Blocked') featureStats[folderPath].blocked++;
              else featureStats[folderPath].notRun++;
            }
          }

          // Bugs tracking (Scoped to selected cycle(s))
          if (ex.linkedBugs && Array.isArray(ex.linkedBugs)) {
            const tcKeyDisplay = tc ? tc.key : (ex.key || `TC-${ex.id}`);
            const tcSummary = tc ? tc.summary : (ex.summary || 'Caso de prueba');

            ex.linkedBugs.forEach(rawBug => {
              if (!rawBug || !rawBug.key || !isActualBug(rawBug)) return;

              const bugKey = rawBug.key;
              const projectBug = (unlinkedBugs || []).find(ub => ub.key === bugKey);
              const mapBug = reportData?.bugMap?.[bugKey];
              const bug = {
                ...rawBug,
                ...(mapBug || {}),
                ...(projectBug || {}),
                summary: mapBug?.summary || projectBug?.summary || ((rawBug.summary && rawBug.summary !== 'Defecto detectado en ciclo') ? rawBug.summary : 'Defecto detectado en ciclo'),
                severity: mapBug?.severity || projectBug?.severity || ((rawBug.severity && rawBug.severity !== 'Sin definir') ? rawBug.severity : 'Sin definir'),
                assignee: mapBug?.assignee || projectBug?.assignee || ((rawBug.assignee && rawBug.assignee !== 'Sin asignar') ? rawBug.assignee : 'Sin asignar'),
                status: mapBug?.status || projectBug?.status || rawBug.status || 'Abierto',
                resolution: mapBug?.resolution || projectBug?.resolution || rawBug.resolution || 'Sin resolver',
                created: mapBug?.created || projectBug?.created || rawBug.created || rawBug.rawFields?.created || null,
                resolutiondate: mapBug?.resolutiondate || projectBug?.resolutiondate || rawBug.resolutiondate || rawBug.rawFields?.resolutiondate || null,
                duedate: mapBug?.duedate || projectBug?.duedate || rawBug.duedate || rawBug.rawFields?.duedate || null,
                version: mapBug?.version || projectBug?.version || rawBug.version || 'Sin versión',
                versions: mapBug?.versions || projectBug?.versions || rawBug.versions || [],
                fixVersions: mapBug?.fixVersions || projectBug?.fixVersions || rawBug.fixVersions || [],
                rawFields: mapBug?.rawFields || projectBug?.rawFields || rawBug.rawFields
              };

              // Ensure bug belongs to this cycle (checks version compatibility and execution)
              if (!bugMatchesCycle(bug, cycle)) return;

              const isDone = isBugDone(bug);
              const finalSeverity = normalizeSeverity(bug.severity, bug.rawFields);
              const resName = resolveValidBugResolution(bug, isDone);

              const rawAff = bug.versions || bug.rawFields?.versions || [];
              const rawFix = bug.fixVersions || bug.rawFields?.fixVersions || [];
              const affectsVersions = (Array.isArray(rawAff) ? rawAff : [rawAff]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
              const fixVersions = (Array.isArray(rawFix) ? rawFix : [rawFix]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
              const versionDisplay = (bug.version && bug.version !== 'Sin versión')
                ? bug.version 
                : (affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión'));

              // 1. Add to cycleAllBugsMap (All bugs found in the selected cycle runs)
              if (!cycleAllBugsMap.has(bugKey)) {
                cycleAllBugsMap.set(bugKey, {
                  key: bugKey,
                  summary: bug.summary || 'Defecto detectado en ciclo',
                  severity: finalSeverity,
                  assignee: (typeof bug.assignee === 'object' && bug.assignee !== null) ? (bug.assignee.displayName || bug.assignee.name || 'Sin asignar') : (bug.assignee || 'Sin asignar'),
                  status: bug.status || (isDone ? 'Cerrado' : 'Abierto'),
                  resolution: resName,
                  isDone: isDone,
                  version: versionDisplay,
                  versions: affectsVersions,
                  fixVersions: fixVersions,
                  created: bug.created || bug.rawFields?.created || null,
                  resolutiondate: bug.resolutiondate || bug.rawFields?.resolutiondate || null,
                  duedate: bug.duedate || null,
                  isReopened: Boolean(bug.isReopened),
                  reopenedAt: bug.reopenedAt || null,
                  reopenCount: bug.reopenCount || 0,
                  isOnHold: Boolean(bug.isOnHold),
                  onHoldSince: bug.onHoldSince || null,
                  onHoldBusinessHours: typeof bug.onHoldBusinessHours === 'number' ? bug.onHoldBusinessHours : null,
                  activeBusinessHours: typeof bug.activeBusinessHours === 'number' ? bug.activeBusinessHours : null,
                  resolutionBusinessHours: typeof bug.resolutionBusinessHours === 'number' ? bug.resolutionBusinessHours : null,
                  lastTerminalAt: bug.lastTerminalAt || null,
                  cycles: new Set([cycleName]),
                  affectedCases: new Map()
                });
              } else {
                cycleAllBugsMap.get(bugKey).cycles.add(cycleName);
              }

              const allEntry = cycleAllBugsMap.get(bugKey);
              allEntry.affectedCases.set(String(ex.id), {
                id: ex.id,
                key: tcKeyDisplay,
                summary: tcSummary,
                status: ex.status,
                cycleName: cycleName
              });

              // 2. Add to cycleOpenBugsMap if not closed
              if (!isDone) {
                if (!cycleOpenBugsMap.has(bugKey)) {
                  cycleOpenBugsMap.set(bugKey, {
                    key: bugKey,
                    summary: bug.summary || 'Defecto detectado en ciclo',
                    severity: finalSeverity,
                    assignee: (typeof bug.assignee === 'object' && bug.assignee !== null) ? (bug.assignee.displayName || bug.assignee.name || 'Sin asignar') : (bug.assignee || 'Sin asignar'),
                    status: bug.status || 'Abierto',
                    resolution: resName,
                    isDone: false,
                    version: versionDisplay,
                    versions: affectsVersions,
                    fixVersions: fixVersions,
                    created: bug.created || bug.rawFields?.created || null,
                    resolutiondate: bug.resolutiondate || bug.rawFields?.resolutiondate || null,
                    duedate: bug.duedate || null,
                    isReopened: Boolean(bug.isReopened),
                    reopenedAt: bug.reopenedAt || null,
                    reopenCount: bug.reopenCount || 0,
                    isOnHold: Boolean(bug.isOnHold),
                    onHoldSince: bug.onHoldSince || null,
                    onHoldBusinessHours: typeof bug.onHoldBusinessHours === 'number' ? bug.onHoldBusinessHours : null,
                    activeBusinessHours: typeof bug.activeBusinessHours === 'number' ? bug.activeBusinessHours : null,
                    resolutionBusinessHours: typeof bug.resolutionBusinessHours === 'number' ? bug.resolutionBusinessHours : null,
                    lastTerminalAt: bug.lastTerminalAt || null,
                    cycles: new Set([cycleName]),
                    affectedCases: new Map()
                  });
                } else {
                  cycleOpenBugsMap.get(bugKey).cycles.add(cycleName);
                }

                const openEntry = cycleOpenBugsMap.get(bugKey);
                openEntry.affectedCases.set(String(ex.id), {
                  id: ex.id,
                  key: tcKeyDisplay,
                  summary: tcSummary,
                  status: ex.status,
                  cycleName: cycleName
                });
              }
            });
          }
        });
      }
    });

    // Filter and consolidate project bugs
    const currentProjObj = projects.find(p => String(p.id) === String(selectedProjectId) || String(p.key) === String(selectedProjectId));
    const currentProjKey = currentProjObj?.key;

    // Filter project bugs by workspace project and valid bug type
    const relevantProjectBugs = unlinkedBugs.filter(b => {
      if (!isActualBug(b)) return false;
      if (b.project) {
        const pKey = typeof b.project === 'object' ? (b.project.key || b.project.id) : String(b.project);
        if (currentProjKey && pKey && pKey !== currentProjKey && !b.key.startsWith(currentProjKey + '-')) return false;
      } else if (currentProjKey && b.key && !b.key.startsWith(currentProjKey + '-')) {
        return false;
      }
      return true;
    });

    const allBugsMap = new Map(planAllBugsMap);
    const projectUnlinkedBugs = [];

    relevantProjectBugs.forEach(ub => {
      const isDone = isBugDone(ub);
      const finalSeverity = normalizeSeverity(ub.severity, ub.rawFields);
      const isLinkedToAnyTest = ub.isLinked || (ub.linkedTests && ub.linkedTests.length > 0);

      const rawAff = ub.versions || ub.rawFields?.versions || [];
      const rawFix = ub.fixVersions || ub.rawFields?.fixVersions || [];
      const affectsVersions = (Array.isArray(rawAff) ? rawAff : [rawAff]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
      const fixVersions = (Array.isArray(rawFix) ? rawFix : [rawFix]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
      const versionDisplay = (ub.version && ub.version !== 'Sin versión')
        ? ub.version 
        : (affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión'));

      // Resolve origin cycles for any linked tests / runs
      const foundCycles = new Set();
      const affectedMap = new Map();

      // Search target cycles: target cycles for Plan bugs should ALWAYS be planCycles (or all project cycles if no plan selected)
      const targetCyclesForBugs = (reportSelectedPlans && reportSelectedPlans.length > 0)
        ? (planCycles || [])
        : (testCycles && testCycles.length > 0 ? testCycles : (reportData?.cycles || []));

      // 1. Populate affectedMap if bug has linked test cases in Jira
      if (ub.linkedTests && ub.linkedTests.length > 0) {
        ub.linkedTests.forEach(lt => {
          const tcKey = lt.key || lt.id;
          if (tcKey) {
            affectedMap.set(tcKey, {
              key: lt.key,
              summary: lt.summary,
              status: lt.status || 'Ejecutado',
              type: lt.type
            });
          }
        });
      }

      // 2. Associate bug to cycle ONLY if bug belongs to that cycle (via execution or version match)
      targetCyclesForBugs.forEach(c => {
        const cName = c.summary || c.key || String(c.id);
        if (bugMatchesCycle(ub, c)) {
          foundCycles.add(cName);
        }
      });

      if (allBugsMap.has(ub.key)) {
        // Bug was already registered in a cycle execution of this plan — enrich its linked test details
        const existing = allBugsMap.get(ub.key);
        affectedMap.forEach((val, k) => {
          if (!existing.affectedCases.has(k)) {
            existing.affectedCases.set(k, val);
          }
        });
        // Only add inferred cycle if existing has no direct execution cycle
        if (!existing.cycles || existing.cycles.size === 0) {
          foundCycles.forEach(cName => {
            existing.cycles.add(cName);
          });
        }
        if (!existing.version || existing.version === 'Sin versión') {
          existing.version = versionDisplay;
        }
        if (!existing.created) {
          existing.created = ub.created || ub.rawFields?.created || null;
        }
        if (!existing.resolutiondate) {
          existing.resolutiondate = ub.resolutiondate || ub.rawFields?.resolutiondate || null;
        }
        if (!existing.duedate) {
          existing.duedate = ub.duedate || ub.rawFields?.duedate || null;
        }
        if (ub.isReopened && !existing.isReopened) {
          existing.isReopened = true;
          existing.reopenedAt = ub.reopenedAt || existing.reopenedAt;
          existing.reopenCount = ub.reopenCount || existing.reopenCount;
        }
        if (ub.isOnHold && !existing.isOnHold) {
          existing.isOnHold = true;
          existing.onHoldSince = ub.onHoldSince || existing.onHoldSince;
        }
        if (typeof ub.activeBusinessHours === 'number' && typeof existing.activeBusinessHours !== 'number') {
          existing.activeBusinessHours = ub.activeBusinessHours;
        }
        if (typeof ub.resolutionBusinessHours === 'number' && typeof existing.resolutionBusinessHours !== 'number') {
          existing.resolutionBusinessHours = ub.resolutionBusinessHours;
        }
      } else {
        // Bug is in the project but wasn't part of planAllBugsMap
        // ONLY include if it matched at least one target cycle in scope
        if (foundCycles.size > 0) {
          const ubResName = resolveValidBugResolution(ub, isDone);
          allBugsMap.set(ub.key, {
            key: ub.key,
            summary: ub.summary || (isLinkedToAnyTest ? 'Defecto vinculado a prueba' : 'Defecto sin vincular'),
            severity: finalSeverity,
            assignee: (typeof ub.assignee === 'object' && ub.assignee !== null) ? (ub.assignee.displayName || ub.assignee.name || 'Sin asignar') : (ub.assignee || 'Sin asignar'),
            status: ub.status || (isDone ? 'Cerrado' : 'Abierto'),
            resolution: ubResName,
            isDone: isDone,
            isUnlinked: !isLinkedToAnyTest && foundCycles.size === 0,
            version: versionDisplay,
            versions: affectsVersions,
            fixVersions: fixVersions,
            created: ub.created || ub.rawFields?.created || null,
            resolutiondate: ub.resolutiondate || ub.rawFields?.resolutiondate || null,
            duedate: ub.duedate || ub.rawFields?.duedate || null,
            isReopened: Boolean(ub.isReopened),
            reopenedAt: ub.reopenedAt || null,
            reopenCount: ub.reopenCount || 0,
            isOnHold: Boolean(ub.isOnHold),
            onHoldSince: ub.onHoldSince || null,
            onHoldBusinessHours: typeof ub.onHoldBusinessHours === 'number' ? ub.onHoldBusinessHours : null,
            activeBusinessHours: typeof ub.activeBusinessHours === 'number' ? ub.activeBusinessHours : null,
            resolutionBusinessHours: typeof ub.resolutionBusinessHours === 'number' ? ub.resolutionBusinessHours : null,
            lastTerminalAt: ub.lastTerminalAt || null,
            cycles: foundCycles,
            affectedCases: affectedMap
          });
        }

        if (!isLinkedToAnyTest) {
          projectUnlinkedBugs.push({
            ...ub,
            version: versionDisplay,
            versions: affectsVersions,
            fixVersions: fixVersions,
            created: ub.created || ub.rawFields?.created || null,
            resolutiondate: ub.resolutiondate || ub.rawFields?.resolutiondate || null,
            duedate: ub.duedate || ub.rawFields?.duedate || null
          });
        }
      }
    });

    const sortBugsByCreatedDesc = (a, b) => {
      const timeA = a && a.created ? new Date(a.created).getTime() : 0;
      const timeB = b && b.created ? new Date(b.created).getTime() : 0;
      const validA = isNaN(timeA) ? 0 : timeA;
      const validB = isNaN(timeB) ? 0 : timeB;
      if (validA !== validB) return validB - validA;
      const numA = parseInt((a?.key || '').split('-')[1] || '0', 10);
      const numB = parseInt((b?.key || '').split('-')[1] || '0', 10);
      if (numA !== numB) return numB - numA;
      return (b?.key || '').localeCompare(a?.key || '');
    };

    projectUnlinkedBugs.sort(sortBugsByCreatedDesc);

    const openUnlinkedBugs = projectUnlinkedBugs.filter(b => !isBugDone(b));
    const closedUnlinkedBugs = projectUnlinkedBugs.filter(b => isBugDone(b));

    let planGeneralBugsList = Array.from(allBugsMap.values()).map(item => ({
      ...item,
      cycleList: item.cycles && item.cycles.size > 0 ? Array.from(item.cycles).join(', ') : 'Sin vincular',
      affectedCount: item.affectedCases ? item.affectedCases.size : 0,
      affectedCasesList: item.affectedCases ? Array.from(item.affectedCases.values()) : []
    })).sort(sortBugsByCreatedDesc);

    // Strictly scope planGeneralBugsList to the selected test plan(s)
    // NOTE: It intentionally ignores the cycle filter (reportSelectedCycles) so that Table 2 represents the whole Plan
    if (reportSelectedPlans && reportSelectedPlans.length > 0) {
      planGeneralBugsList = planGeneralBugsList.filter(b => 
        planCycles.some(pc => bugMatchesCycle(b, pc))
      );
    }

    // Filter by affected version if selected
    if (reportSelectedVersions && reportSelectedVersions.length > 0) {
      planGeneralBugsList = planGeneralBugsList.filter(b => matchSelectedVersions(b, reportSelectedVersions));
    }

    // Cycle-specific Bug Totals (Used in Runs subview and Cycle bugs)
    let criticalCycleBugs = Array.from(cycleOpenBugsMap.values()).map(item => ({
      ...item,
      cycleList: item.cycles && item.cycles.size > 0 ? Array.from(item.cycles).join(', ') : 'Sin vincular',
      affectedCount: item.affectedCases ? item.affectedCases.size : 0,
      affectedCasesList: item.affectedCases ? Array.from(item.affectedCases.values()) : []
    })).sort(sortBugsByCreatedDesc);

    let cycleAllBugsList = Array.from(cycleAllBugsMap.values()).map(item => ({
      ...item,
      cycleList: item.cycles && item.cycles.size > 0 ? Array.from(item.cycles).join(', ') : 'Sin vincular',
      affectedCount: item.affectedCases ? item.affectedCases.size : 0,
      affectedCasesList: item.affectedCases ? Array.from(item.affectedCases.values()) : []
    })).sort(sortBugsByCreatedDesc);

    const activeCyclesForVersions = (reportSelectedCycles && reportSelectedCycles.length > 0)
      ? filteredCycles
      : ((reportSelectedPlans && reportSelectedPlans.length > 0) ? planCycles : (planCycles.length > 0 ? planCycles : (testCycles || [])));

    // Extract available versions for filtering across dashboard entities
    const availableDashboardVersions = Array.from(new Set(
      [
        ...(planGeneralBugsList.flatMap(b => b.versions || (b.version && b.version !== 'Sin versión' ? [b.version] : []))),
        ...(activeCyclesForVersions.flatMap(c => {
          const cVers = extractVersions(c, false);
          return cVers.versions;
        }))
      ].filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    // Filter by affected version if selected
    if (reportSelectedVersions && reportSelectedVersions.length > 0) {
      criticalCycleBugs = criticalCycleBugs.filter(b => matchSelectedVersions(b, reportSelectedVersions));
      cycleAllBugsList = cycleAllBugsList.filter(b => matchSelectedVersions(b, reportSelectedVersions));
    }

    // Global / Plan-wide Bug Totals (Used in Bugs subview)
    const totalAllPlanBugs = planGeneralBugsList.length;
    const totalAllBugs = totalAllPlanBugs;
    const totalOpenPlanBugs = planGeneralBugsList.filter(b => !b.isDone).length;
    const totalOpenBugs = totalOpenPlanBugs;
    const totalClosedPlanBugs = planGeneralBugsList.filter(b => b.isDone).length;
    const totalClosedBugs = totalClosedPlanBugs;

    const totalCycleBugs = cycleAllBugsList.length;
    const openCycleBugs = cycleAllBugsList.filter(b => !b.isDone).length;
    const closedCycleBugs = cycleAllBugsList.filter(b => b.isDone).length;

    const evaluados = passed + failed + blocked;
    const ejecutados = evaluados;
    const successRate = evaluados > 0 ? ((passed / evaluados) * 100).toFixed(1) : '0.0';
    const allTotal = passed + failed + blocked + notRun;
    const coverageRate = allTotal > 0 ? ((evaluados / allTotal) * 100).toFixed(1) : '0.0';

    // Calc angles for donut
    const pPct = allTotal > 0 ? (passed / allTotal) * 100 : 0;
    const fPct = allTotal > 0 ? (failed / allTotal) * 100 : 0;
    const bPct = allTotal > 0 ? (blocked / allTotal) * 100 : 0;
    const nPct = allTotal > 0 ? (notRun / allTotal) * 100 : (allTotal === 0 ? 100 : 0);

    const avgResolutionHours = resolvedCount > 0 ? (totalResolutionHours / resolvedCount).toFixed(1) : '0.0';
    const ctxProj = context?.extension?.project;
    const currentProjectObj = projects.find(p => String(p.id) === String(selectedProjectId) || String(p.key) === String(selectedProjectId));
    
    // Project Name & Key resolution
    let currentProjectName = currentProjectObj?.name;
    if (!currentProjectName && ctxProj) {
      if (!selectedProjectId || String(ctxProj.id) === String(selectedProjectId) || String(ctxProj.key) === String(selectedProjectId)) {
        currentProjectName = ctxProj.name;
      }
    }
    if (!currentProjectName && ctxProj?.name) {
      currentProjectName = ctxProj.name;
    }

    let currentProjectKey = currentProjectObj?.key || ctxProj?.key || '';
    if (!currentProjectKey && selectedProjectId && isNaN(Number(selectedProjectId))) {
      currentProjectKey = selectedProjectId;
    }
    if (!currentProjectKey) {
      const sampleBug = Array.from(allBugsMap.values())[0];
      if (sampleBug?.key && sampleBug.key.includes('-')) {
        currentProjectKey = sampleBug.key.split('-')[0];
      } else if (testCases[0]?.key && testCases[0].key.includes('-')) {
        currentProjectKey = testCases[0].key.split('-')[0];
      }
    }

    // Clean up numeric-only names like "19919"
    if (!currentProjectName || /^\d+$/.test(String(currentProjectName).trim())) {
      if (ctxProj?.name && !/^\d+$/.test(String(ctxProj.name).trim())) {
        currentProjectName = ctxProj.name;
      } else if (currentProjectKey) {
        currentProjectName = currentProjectKey;
      } else {
        currentProjectName = 'Proyecto';
      }
    }

    const projectDisplay = (currentProjectName && currentProjectKey && currentProjectName !== currentProjectKey && !/^\d+$/.test(currentProjectKey))
      ? `${currentProjectName} (${currentProjectKey})`
      : currentProjectName;

    const buildExecutiveReportData = (customSubject = '', customNotes = '', customBuild = null) => {
      const baseUrl = context?.siteUrl || '';
      const now = new Date();
      const dateFormatted = now.toLocaleDateString('es-ES', { 
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' 
      });

      // Scope description
      let scopeCyclesText = 'Todos los ciclos del proyecto';
      if (reportSelectedCycles.length === 1) {
        scopeCyclesText = filteredCycles[0]?.summary || 'Ciclo seleccionado';
      } else if (reportSelectedCycles.length > 1) {
        scopeCyclesText = `${reportSelectedCycles.length} Ciclos seleccionados (${filteredCycles.map(c => c.summary).slice(0, 3).join(', ')}${filteredCycles.length > 3 ? '...' : ''})`;
      }

      let scopePlansText = 'Todos los planes';
      if (reportSelectedPlans.length === 1) {
        const pl = testPlans.find(p => String(p.id) === String(reportSelectedPlans[0]));
        scopePlansText = pl?.summary || 'Plan seleccionado';
      } else if (reportSelectedPlans.length > 1) {
        scopePlansText = `${reportSelectedPlans.length} Planes seleccionados`;
      }

      // Cycle bugs array (Scoped strictly to active cycle runs, filtered by version if selected)
      let cycleBugsArray = (cycleAllBugsList || []).slice().sort(sortBugsByCreatedDesc);

      // Blocker bugs from the general test plan bug table (Only Bloqueante / Blocker AND ONLY OPEN: "deberían ser sólo los abiertos. Los cerrados no importan.")
      const isBlockerBug = (bug) => {
        const s = String(bug.severity || '').toLowerCase();
        return s.includes('bloq') || s.includes('blocker');
      };
      let generalBlockerBugs = (planGeneralBugsList || []).filter(b => isBlockerBug(b) && !b.isDone);
      generalBlockerBugs.sort(sortBugsByCreatedDesc);
      const openGeneralBlockersCount = generalBlockerBugs.length;
      const closedGeneralBlockersCount = (planGeneralBugsList || []).filter(b => isBlockerBug(b) && b.isDone).length;

      // Version extraction strictly from the selected cycles (or user specified)
      let scopeVersionsText = '';
      if (customBuild !== null && customBuild !== undefined) {
        scopeVersionsText = customBuild.trim();
      } else if (reportSelectedVersions && reportSelectedVersions.length > 0) {
        scopeVersionsText = reportSelectedVersions.join(', ');
      } else {
        const cycleVersionsSet = new Set();
        (filteredCycles || []).forEach(c => {
          const cVers = extractVersions(c, false);
          (cVers.versions || []).forEach(v => v && cycleVersionsSet.add(v));
        });
        if (cycleVersionsSet.size === 0) {
          cycleBugsArray.forEach(b => {
            if (b.version && b.version !== 'Sin versión') cycleVersionsSet.add(b.version);
            if (Array.isArray(b.versions)) b.versions.forEach(v => v && cycleVersionsSet.add(v));
            if (Array.isArray(b.fixVersions)) b.fixVersions.forEach(v => v && cycleVersionsSet.add(v));
          });
        }
        scopeVersionsText = cycleVersionsSet.size > 0 ? Array.from(cycleVersionsSet).join(', ') : '';
      }

      // ── 1. Table Rows: Cycle Bugs ──
      let tableRows = '';
      if (cycleBugsArray.length === 0) {
        tableRows = `
          <tr class="tp-er-tr-even">
            <td colspan="6" class="tp-er-empty-td" style="border: 1px solid #DFE1E6; padding: 14px; text-align: center; color: #006644; background-color: #E3FCEF; font-weight: 600;">
              🟢 No se registraron defectos vinculados en las ejecuciones del ciclo actual.
            </td>
          </tr>
        `;
      } else {
        cycleBugsArray.forEach((bug, idx) => {
          const isEven = idx % 2 === 0;
          const bgRow = isEven ? '#FFFFFF' : '#FAFBFC';
          const trClass = isEven ? 'tp-er-tr-even' : 'tp-er-tr-odd';
          
          // Severity styling (Liverpool & Jira harmonious tones)
          let sevBg = '#F4F5F7';
          let sevColor = '#172B4D';
          let sevClass = 'tp-er-sev-default';
          const sLow = (bug.severity || '').toLowerCase();
          if (sLow.includes('bloq') || sLow.includes('high') || sLow.includes('alt')) {
            sevBg = '#FFEBE6';
            sevColor = '#BF2600';
            sevClass = 'tp-er-sev-high';
          } else if (sLow.includes('crit')) {
            sevBg = '#FDF0F6';
            sevColor = '#C20062';
            sevClass = 'tp-er-sev-crit';
          } else if (sLow.includes('med') || sLow.includes('may')) {
            sevBg = '#FFF0B3';
            sevColor = '#172B4D';
            sevClass = 'tp-er-sev-med';
          } else if (sLow.includes('min') || sLow.includes('low') || sLow.includes('baj')) {
            sevBg = '#EAE6FF';
            sevColor = '#403294';
            sevClass = 'tp-er-sev-low';
          }

          // Dates, Aging & TTR (pass `bug` metadata for reopened counter reset & On Hold pause)
          const bugCreated = formatBugCreatedDate(bug.created);
          const bugAge = formatBugAge(bug.created, bug.resolutiondate, bug.isDone, bug);
          let resFormatted = null;
          if (bug.isDone && bug.resolutiondate) {
            resFormatted = formatBugCreatedDate(bug.resolutiondate);
          }

          // Status styling (On Hold uses blue/paused badge instead of red)
          const isBugOnHold = bugAge.tone === 'onhold';
          const statusBg = bug.isDone ? '#E3FCEF' : (isBugOnHold ? '#E9F2FF' : '#FFEBE6');
          const statusColor = bug.isDone ? '#006644' : (isBugOnHold ? '#0C66E4' : '#BF2600');
          const statusClass = bug.isDone ? 'tp-er-status-done' : (isBugOnHold ? 'tp-er-status-onhold' : 'tp-er-status-open');

          let agePillBg = '#E3FCEF';
          let agePillColor = '#006644';
          let agePillBorder = '#ABF5D1';
          let agePillClass = 'tp-er-age-green';
          if (!bug.isDone) {
            if (bugAge.tone === 'onhold') {
              agePillBg = '#E9F2FF';
              agePillColor = '#0C66E4';
              agePillBorder = '#CCE0FF';
              agePillClass = 'tp-er-age-onhold';
            } else if (bugAge.tone === 'orange') {
              agePillBg = '#FFF0B3';
              agePillColor = '#172B4D';
              agePillBorder = '#FFE380';
              agePillClass = 'tp-er-age-orange';
            } else if (bugAge.tone === 'red') {
              agePillBg = '#FFEBE6';
              agePillColor = '#BF2600';
              agePillBorder = '#FFBDAD';
              agePillClass = 'tp-er-age-red';
            }
          }

          const verVal = bug.version || (Array.isArray(bug.versions) && bug.versions.length > 0 ? bug.versions.join(', ') : (Array.isArray(bug.fixVersions) && bug.fixVersions.length > 0 ? bug.fixVersions.join(', ') : ''));

          tableRows += `
            <tr class="${trClass}" style="background-color: ${bgRow};">
              <td class="tp-er-td tp-er-fw-700 tp-er-w-15" style="border: 1px solid #DFE1E6; padding: 8px 8px; font-weight: 700; width: 15%; vertical-align: top;">
                <a href="${baseUrl}/browse/${bug.key}" class="tp-er-issue-link-pink" style="color: #E1007A; text-decoration: underline; font-size: 13px;" target="_blank">
                  ${bug.key}
                </a>
                ${verVal && verVal !== 'Sin versión' ? `
                  <div class="tp-er-mt-4" style="margin-top: 4px;">
                    <span class="tp-er-version-tag" style="font-size: 10px; font-weight: 700; color: #0C66E4; background-color: #E9F2FF; border: 1px solid #CCE0FF; padding: 1px 5px; border-radius: 4px; display: inline-block;">
                      🏷️ ${verVal}
                    </span>
                  </div>` : ''}
              </td>
              <td class="tp-er-td tp-er-fs-12 tp-er-w-31" style="border: 1px solid #DFE1E6; padding: 8px 8px; color: #172B4D; font-size: 12px; line-height: 1.35; width: 31%; word-break: break-word; overflow-wrap: break-word; vertical-align: top;">
                ${bug.summary || 'Sin resumen'}
              </td>
              <td class="tp-er-td tp-er-td-center tp-er-w-11" style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; width: 11%; vertical-align: top;">
                <span class="tp-er-badge ${sevClass}" style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${sevBg}; color: ${sevColor}; white-space: nowrap;">
                  ${bug.severity || 'Media'}
                </span>
              </td>
              <td class="tp-er-td tp-er-td-center tp-er-w-11" style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; width: 11%; vertical-align: top;">
                <span class="tp-er-badge ${statusClass}" style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${statusBg}; color: ${statusColor}; white-space: nowrap;">
                  ${isBugOnHold ? `⏸️ ${bug.status || 'ON HOLD'}` : (bug.status || (bug.isDone ? 'Cerrado' : 'Abierto'))}
                </span>
              </td>
              <td class="tp-er-td tp-er-fs-11 tp-er-w-20" style="border: 1px solid #DFE1E6; padding: 8px 8px; width: 20%; vertical-align: top; font-size: 11px;">
                <div class="tp-er-c-muted tp-er-mb-3" style="color: #626F86; margin-bottom: 3px;">
                  📅 <strong>Creado:</strong> ${bugCreated.dateStr}${bugCreated.timeStr ? ` ${bugCreated.timeStr}` : ''}
                </div>
                <div class="tp-er-age-pill ${agePillClass}" style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${agePillBg}; color: ${agePillColor}; border: 1px solid ${agePillBorder};">
                  ${bug.isDone ? `✅ ${bugAge.label}` : (isBugOnHold ? `⏸️ ${bugAge.label}` : `⏱️ ${bugAge.label}`)}
                </div>
                ${bug.isDone && resFormatted?.dateStr ? `
                  <div class="tp-er-c-green tp-er-fs-10 tp-er-mt-3" style="color: #006644; font-size: 10px; margin-top: 3px;">
                    🏁 Resuelto: ${resFormatted.dateStr}${resFormatted.timeStr ? ` ${resFormatted.timeStr}` : ''}
                  </div>` : ''}
              </td>
              <td class="tp-er-td tp-er-fs-11 tp-er-c-body-sub tp-er-w-12" style="border: 1px solid #DFE1E6; padding: 8px 8px; color: #44546F; font-size: 11px; width: 12%; word-break: break-word; vertical-align: top;">
                <div class="tp-er-fw-600 tp-er-c-dark" style="font-weight: 600; color: #172B4D;">${bug.assignee || 'Sin asignar'}</div>
                <div class="tp-er-c-muted tp-er-fs-10 tp-er-mt-2" style="color: #626F86; font-size: 10px; margin-top: 2px;">${bug.resolution || (bug.isDone ? 'Resuelto' : 'Sin resolver')}</div>
              </td>
            </tr>
          `;
        });
      }

      // ── 2. Table Rows: General Plan Blocker Bugs (Only Bloqueantes Abiertos) ──
      let generalBlockerTableRows = '';
      if (generalBlockerBugs.length === 0) {
        generalBlockerTableRows = `
          <tr class="tp-er-tr-even">
            <td colspan="6" class="tp-er-empty-td" style="border: 1px solid #DFE1E6; padding: 14px; text-align: center; color: #006644; background-color: #E3FCEF; font-weight: 600;">
              🟢 No se registran defectos bloqueantes abiertos en la relación general del plan de pruebas.
            </td>
          </tr>
        `;
      } else {
        generalBlockerBugs.forEach((bug, idx) => {
          const isEven = idx % 2 === 0;
          const bgRow = isEven ? '#FFFFFF' : '#FAFBFC';
          const trClass = isEven ? 'tp-er-tr-even' : 'tp-er-tr-odd';
          
          // Severity styling (Bloqueante Red Badge)
          const sevBg = '#FFEBE6';
          const sevColor = '#BF2600';

          // Dates, Aging & TTR (pass `bug` metadata for reopened counter reset & On Hold pause)
          const bugCreated = formatBugCreatedDate(bug.created);
          const bugAge = formatBugAge(bug.created, bug.resolutiondate, bug.isDone, bug);
          let resFormatted = null;
          if (bug.isDone && bug.resolutiondate) {
            resFormatted = formatBugCreatedDate(bug.resolutiondate);
          }

          // Status styling (On Hold uses blue/paused badge instead of red)
          const isBugOnHold = bugAge.tone === 'onhold';
          const statusBg = bug.isDone ? '#E3FCEF' : (isBugOnHold ? '#E9F2FF' : '#FFEBE6');
          const statusColor = bug.isDone ? '#006644' : (isBugOnHold ? '#0C66E4' : '#BF2600');
          const statusClass = bug.isDone ? 'tp-er-status-done' : (isBugOnHold ? 'tp-er-status-onhold' : 'tp-er-status-open');

          let agePillBg = '#E3FCEF';
          let agePillColor = '#006644';
          let agePillBorder = '#ABF5D1';
          let agePillClass = 'tp-er-age-green';
          if (!bug.isDone) {
            if (bugAge.tone === 'onhold') {
              agePillBg = '#E9F2FF';
              agePillColor = '#0C66E4';
              agePillBorder = '#CCE0FF';
              agePillClass = 'tp-er-age-onhold';
            } else if (bugAge.tone === 'orange') {
              agePillBg = '#FFF0B3';
              agePillColor = '#172B4D';
              agePillBorder = '#FFE380';
              agePillClass = 'tp-er-age-orange';
            } else if (bugAge.tone === 'red') {
              agePillBg = '#FFEBE6';
              agePillColor = '#BF2600';
              agePillBorder = '#FFBDAD';
              agePillClass = 'tp-er-age-red';
            }
          }

          const verVal = bug.version || (Array.isArray(bug.versions) && bug.versions.length > 0 ? bug.versions.join(', ') : (Array.isArray(bug.fixVersions) && bug.fixVersions.length > 0 ? bug.fixVersions.join(', ') : ''));
          const cycleDisplay = bug.cycleList && bug.cycleList !== 'Sin vincular' ? bug.cycleList : 'General del Plan';

          generalBlockerTableRows += `
            <tr class="${trClass}" style="background-color: ${bgRow};">
              <td class="tp-er-td tp-er-fw-700 tp-er-w-14" style="border: 1px solid #DFE1E6; padding: 8px 8px; font-weight: 700; width: 14%; vertical-align: top;">
                <a href="${baseUrl}/browse/${bug.key}" class="tp-er-issue-link-red" style="color: #DE350B; text-decoration: underline; font-size: 13px; font-weight: 800;" target="_blank">
                  ${bug.key}
                </a>
                ${verVal && verVal !== 'Sin versión' ? `
                  <div class="tp-er-mt-4" style="margin-top: 4px;">
                    <span class="tp-er-version-tag" style="font-size: 10px; font-weight: 700; color: #0C66E4; background-color: #E9F2FF; border: 1px solid #CCE0FF; padding: 1px 5px; border-radius: 4px; display: inline-block;">
                      🏷️ ${verVal}
                    </span>
                  </div>` : ''}
              </td>
              <td class="tp-er-td tp-er-fs-12 tp-er-w-28" style="border: 1px solid #DFE1E6; padding: 8px 8px; color: #172B4D; font-size: 12px; line-height: 1.35; width: 28%; word-break: break-word; overflow-wrap: break-word; vertical-align: top;">
                ${bug.summary || 'Sin resumen'}
              </td>
              <td class="tp-er-td tp-er-td-center tp-er-w-12" style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; width: 12%; vertical-align: top;">
                <span class="tp-er-badge tp-er-sev-blocker" style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${sevBg}; color: ${sevColor}; border: 1px solid #FFBDAD; white-space: nowrap;">
                  ✱ Bloqueante
                </span>
              </td>
              <td class="tp-er-td tp-er-td-center tp-er-w-11" style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; width: 11%; vertical-align: top;">
                <span class="tp-er-badge ${statusClass}" style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${statusBg}; color: ${statusColor}; white-space: nowrap;">
                  ${isBugOnHold ? `⏸️ ${bug.status || 'ON HOLD'}` : (bug.status || (bug.isDone ? 'Cerrado' : 'Abierto'))}
                </span>
              </td>
              <td class="tp-er-td tp-er-fs-11 tp-er-c-body-sub tp-er-w-15" style="border: 1px solid #DFE1E6; padding: 8px 6px; width: 15%; vertical-align: top; font-size: 11px; color: #44546F; word-break: break-word;">
                <div class="tp-er-fw-600 tp-er-c-dark" style="font-weight: 600; color: #172B4D;">🔄 ${cycleDisplay}</div>
                ${bug.affectedCount > 0 ? `<div class="tp-er-c-muted tp-er-fs-10 tp-er-mt-2" style="font-size: 10px; color: #626F86; margin-top: 2px;">${bug.affectedCount} caso(s) afectado(s)</div>` : ''}
              </td>
              <td class="tp-er-td tp-er-fs-11 tp-er-w-20" style="border: 1px solid #DFE1E6; padding: 8px 8px; width: 20%; vertical-align: top; font-size: 11px;">
                <div class="tp-er-c-muted tp-er-mb-3" style="color: #626F86; margin-bottom: 3px;">
                  📅 <strong>Creado:</strong> ${bugCreated.dateStr}${bugCreated.timeStr ? ` ${bugCreated.timeStr}` : ''}
                </div>
                <div class="tp-er-age-pill ${agePillClass}" style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${agePillBg}; color: ${agePillColor}; border: 1px solid ${agePillBorder};">
                  ${bug.isDone ? `✅ ${bugAge.label}` : (isBugOnHold ? `⏸️ ${bugAge.label}` : `⏱️ ${bugAge.label}`)}
                </div>
                ${bug.isDone && resFormatted?.dateStr ? `
                  <div class="tp-er-c-green tp-er-fs-10 tp-er-mt-2" style="color: #006644; font-size: 10px; margin-top: 2px;">
                    🏁 Resuelto: ${resFormatted.dateStr}${resFormatted.timeStr ? ` ${resFormatted.timeStr}` : ''}
                  </div>` : ''}
                <div class="tp-er-c-body-sub tp-er-fs-10 tp-er-mt-4" style="color: #44546F; font-size: 10px; margin-top: 4px;">
                  👤 <strong>Resp:</strong> ${bug.assignee || 'Sin asignar'}
                </div>
              </td>
            </tr>
          `;
        });
      }

      // Modules breakdown (Functional tests only)
      let moduleSectionHtml = '';
      const featureKeys = Object.keys(featureStats || {});
      if (featureKeys.length > 0) {
        let modRows = '';
        featureKeys.forEach((fk, idx) => {
          const mod = featureStats[fk];
          const mRate = mod.total > 0 ? ((mod.passed / mod.total) * 100).toFixed(0) : '0';
          const isEven = idx % 2 === 0;
          const trClass = isEven ? 'tp-er-tr-even' : 'tp-er-tr-odd';
          const rateColorClass = Number(mRate) >= 80 ? 'tp-er-c-green' : 'tp-er-c-danger';
          modRows += `
            <tr class="${trClass}" style="background-color: ${isEven ? '#FFFFFF' : '#FAFBFC'};">
              <td class="tp-er-td tp-er-fw-600 tp-er-c-dark" style="border: 1px solid #DFE1E6; padding: 6px 8px; font-weight: 600; color: #172B4D;">${fk}</td>
              <td class="tp-er-td tp-er-td-center tp-er-fw-700" style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; font-weight: 700;">${mod.total}</td>
              <td class="tp-er-td tp-er-td-center tp-er-fw-700 tp-er-c-green" style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; color: #006644; font-weight: 700;">${mod.passed}</td>
              <td class="tp-er-td tp-er-td-center tp-er-fw-700 tp-er-c-danger" style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; color: #DE350B; font-weight: 700;">${mod.failed}</td>
              <td class="tp-er-td tp-er-td-center tp-er-fw-700 tp-er-c-orange" style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; color: #FF8B00; font-weight: 700;">${mod.blocked}</td>
              <td class="tp-er-td tp-er-td-center tp-er-fw-700 ${rateColorClass}" style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; font-weight: 700; color: ${Number(mRate) >= 80 ? '#006644' : '#DE350B'};">${mRate}%</td>
            </tr>
          `;
        });

        moduleSectionHtml = `
          <div class="tp-er-section-block" style="margin-bottom: 22px;">
            <div class="tp-er-section-title-navy" style="font-size: 13px; font-weight: 700; color: #002D62; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">
              📁 Cobertura Funcional por Módulo / Funcionalidad
            </div>
            <table width="100%" cellpadding="6" cellspacing="0" border="0" class="tp-er-data-table" style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #DFE1E6; border-radius: 6px; overflow: hidden;">
              <thead class="tp-er-thead-gray">
                <tr style="background-color: #F4F5F7; color: #172B4D;">
                  <th class="tp-er-th-left" style="border: 1px solid #DFE1E6; padding: 8px 10px; text-align: left; font-weight: 700;">Módulo / Carpeta</th>
                  <th class="tp-er-th-center" style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; font-weight: 700;">Total</th>
                  <th class="tp-er-th-center tp-er-c-green" style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; font-weight: 700; color: #006644;">Pasados</th>
                  <th class="tp-er-th-center tp-er-c-danger" style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; font-weight: 700; color: #DE350B;">Fallidos</th>
                  <th class="tp-er-th-center tp-er-c-orange" style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; font-weight: 700; color: #FF8B00;">Bloqueados</th>
                  <th class="tp-er-th-center" style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; font-weight: 700;">% Éxito</th>
                </tr>
              </thead>
              <tbody>
                ${modRows}
              </tbody>
            </table>
          </div>
        `;
      }

      // Verdict Text
      let verdictText = '';
      const numSuccess = Number(successRate);
      if (numSuccess >= 90 && openCycleBugs === 0 && openGeneralBlockersCount === 0) {
        verdictText = '🟢 <strong>Estado Favorable (Aprobado):</strong> La suite de pruebas presenta una alta tasa de éxito y no se registran defectos bloqueantes abiertos en el ciclo ni en el plan. El avance se encuentra en condiciones óptimas para pase a producción o liberación.';
      } else if (openGeneralBlockersCount > 0) {
        verdictText = `🔴 <strong>Estado Crítico (Defectos Bloqueantes Activos):</strong> Se detectaron <strong>${openGeneralBlockersCount} defecto(s) bloqueante(s) abiertos</strong> en el plan general que impiden la liberación segura. La tasa de éxito actual es del ${successRate}%.`;
      } else if (numSuccess >= 75) {
        verdictText = `🟡 <strong>Estado con Observaciones (Riesgo Moderado):</strong> Se alcanzó una tasa de éxito del ${successRate}%, con ${openCycleBugs} defecto(s) abierto(s) en el ciclo que requieren seguimiento antes del cierre final.`;
      } else {
        verdictText = `🔴 <strong>Estado Crítico (Riesgo Alto):</strong> La tasa de éxito actual es del ${successRate}% con ${openCycleBugs} defecto(s) abierto(s) y ${failed} caso(s) fallido(s). Se recomienda estabilizar las incidencias reportadas antes de autorizar la liberación.`;
      }

      const htmlTemplate = `
        <div class="tp-er-root" style="max-width: 780px; margin: 0 auto; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #172B4D; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0, 45, 98, 0.08);">
          
          <!-- Header Banner (Liverpool Gradient & Logo) -->
          <div class="tp-er-header-banner" style="background: linear-gradient(135deg, #E1007A 0%, #002D62 100%); background-color: #E1007A; color: #ffffff; padding: 22px 26px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-er-header-table" style="width: 100%; border-collapse: collapse;">
              <tr>
                <td class="tp-er-header-left" style="vertical-align: middle;">
                  <div class="tp-er-header-subtitle" style="font-size: 13px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: #FFE0F0; margin-bottom: 8px;">
                    ⚡ TEST PULSE SUITE • REPORTE DE ESTATUS
                  </div>
                  <div class="tp-er-header-logo-wrap" style="margin-top: 4px;">
                    <img src="${LIVERPOOL_LOGO_WHITE_B64 || LIVERPOOL_LOGO_WHITE_ANIMATED_B64}" alt="Liverpool" class="liverpool-animated-logo tp-er-header-logo" style="height: 30px; width: auto; max-width: 150px; display: block; border: 0;" />
                  </div>
                </td>
                <td class="tp-er-header-right" style="vertical-align: middle; text-align: right;">
                  <span class="tp-er-header-date" style="display: inline-block; padding: 6px 14px; background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 20px; font-size: 12px; font-weight: 600; color: #ffffff;">
                    📅 ${dateFormatted}
                  </span>
                </td>
              </tr>
            </table>
          </div>

          <div class="tp-er-body" style="padding: 24px 26px;">
            
            <!-- Project & Scope Meta Box -->
            <div class="tp-er-meta-box" style="background-color: #FDF8FA; border: 1px solid #F3D3E2; border-radius: 8px; margin-bottom: 22px; padding: 12px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-er-meta-table" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td class="tp-er-meta-td" style="padding: 4px 8px; font-size: 13px; vertical-align: top;">
                    <strong class="tp-er-meta-label" style="color: #626F86; font-size: 11px; text-transform: uppercase;">Proyecto:</strong><br/>
                    <span class="tp-er-meta-val-pink" style="font-weight: 700; color: #E1007A; font-size: 14px;">${projectDisplay}</span>
                  </td>
                  <td class="tp-er-meta-td" style="padding: 4px 8px; font-size: 13px; vertical-align: top;">
                    <strong class="tp-er-meta-label" style="color: #626F86; font-size: 11px; text-transform: uppercase;">Ambiente:</strong><br/>
                    <span class="tp-er-meta-val-navy" style="font-weight: 700; color: #002D62; font-size: 14px;">🟢 QA</span>
                  </td>
                  <td class="tp-er-meta-td" style="padding: 4px 8px; font-size: 13px; vertical-align: top;">
                    <strong class="tp-er-meta-label" style="color: #626F86; font-size: 11px; text-transform: uppercase;">Plan(es):</strong><br/>
                    <span class="tp-er-meta-val-dark" style="font-weight: 600; color: #172B4D;">${scopePlansText}</span>
                  </td>
                  <td class="tp-er-meta-td" style="padding: 4px 8px; font-size: 13px; vertical-align: top;">
                    <strong class="tp-er-meta-label" style="color: #626F86; font-size: 11px; text-transform: uppercase;">Ciclo(s):</strong><br/>
                    <span class="tp-er-meta-val-dark" style="font-weight: 600; color: #172B4D;">${scopeCyclesText}</span>
                  </td>
                  <td class="tp-er-meta-td" style="padding: 4px 8px; font-size: 13px; vertical-align: top;">
                    <strong class="tp-er-meta-label" style="color: #626F86; font-size: 11px; text-transform: uppercase;">Versión / Build:</strong><br/>
                    <span class="${scopeVersionsText ? 'tp-er-meta-val-blue' : 'tp-er-meta-val-muted'}" style="font-weight: 700; color: ${scopeVersionsText ? '#0C66E4' : '#626F86'}; font-size: 13px;">${scopeVersionsText || '(No especificado)'}</span>
                  </td>
                </tr>
              </table>
            </div>

            <!-- Executive KPI Grid (Cards) -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-er-kpi-table" style="margin-bottom: 22px;">
              <tr>
                <!-- Card 1: Total Casos -->
                <td width="20%" class="tp-er-kpi-td-first" style="padding: 0 4px 0 0;">
                  <div class="tp-er-kpi-card tp-er-kpi-total" style="background: #F8F9FA; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div class="tp-er-kpi-title tp-er-c-muted" style="font-size: 11px; font-weight: 700; color: #626F86; text-transform: uppercase; margin-bottom: 4px;">Total Casos</div>
                    <div class="tp-er-kpi-num tp-er-c-navy" style="font-size: 22px; font-weight: 800; color: #002D62; line-height: 1.1;">${allTotal}</div>
                    <div class="tp-er-kpi-sub tp-er-c-muted" style="font-size: 11px; color: #626F86; margin-top: 4px;">${evaluados} evaluados</div>
                  </div>
                </td>

                <!-- Card 2: Tasa de Éxito -->
                <td width="20%" class="tp-er-kpi-td" style="padding: 0 4px;">
                  <div class="tp-er-kpi-card tp-er-kpi-success" style="background: #E8F8F0; border: 1px solid #B7EBCE; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div class="tp-er-kpi-title tp-er-c-success" style="font-size: 11px; font-weight: 700; color: #0E8A4C; text-transform: uppercase; margin-bottom: 4px;">Tasa Éxito</div>
                    <div class="tp-er-kpi-num tp-er-c-success" style="font-size: 22px; font-weight: 800; color: #0E8A4C; line-height: 1.1;">${successRate}%</div>
                    <div class="tp-er-kpi-sub tp-er-c-success" style="font-size: 11px; color: #0E8A4C; margin-top: 4px;">${passed} Pasados</div>
                  </div>
                </td>

                <!-- Card 3: Cobertura -->
                <td width="20%" class="tp-er-kpi-td" style="padding: 0 4px;">
                  <div class="tp-er-kpi-card tp-er-kpi-coverage" style="background: #FDF2F7; border: 1px solid #F5B8D8; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div class="tp-er-kpi-title tp-er-c-cov-sub" style="font-size: 11px; font-weight: 700; color: #C20062; text-transform: uppercase; margin-bottom: 4px;">Cobertura</div>
                    <div class="tp-er-kpi-num tp-er-c-pink" style="font-size: 22px; font-weight: 800; color: #E1007A; line-height: 1.1;">${coverageRate}%</div>
                    <div class="tp-er-kpi-sub tp-er-c-cov-sub" style="font-size: 11px; color: #C20062; margin-top: 4px;">${evaluados} ejecutados</div>
                  </div>
                </td>

                <!-- Card 4: Defectos del Ciclo -->
                <td width="20%" class="tp-er-kpi-td" style="padding: 0 4px;">
                  <div class="tp-er-kpi-card tp-er-kpi-defects" style="background: #FFF1F0; border: 1px solid #FFCCC7; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div class="tp-er-kpi-title tp-er-c-crimson" style="font-size: 11px; font-weight: 700; color: #BF2600; text-transform: uppercase; margin-bottom: 4px;">Defectos Ciclo</div>
                    <div class="tp-er-kpi-num tp-er-c-red-val" style="font-size: 22px; font-weight: 800; color: #CF1322; line-height: 1.1;">${totalCycleBugs}</div>
                    <div class="tp-er-kpi-sub tp-er-c-crimson" style="font-size: 11px; color: #BF2600; margin-top: 4px;"><strong>${openCycleBugs}</strong> abiertos (${closedCycleBugs} cerrados)</div>
                  </div>
                </td>

                <!-- Card 5: MTTR -->
                <td width="20%" class="tp-er-kpi-td-last" style="padding: 0 0 0 4px;">
                  <div class="tp-er-kpi-card tp-er-kpi-mttr" style="background: #EEF2FB; border: 1px solid #CCD7F2; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div class="tp-er-kpi-title tp-er-c-navy" style="font-size: 11px; font-weight: 700; color: #002D62; text-transform: uppercase; margin-bottom: 4px;">MTTR Prom.</div>
                    <div class="tp-er-kpi-num tp-er-c-navy" style="font-size: 22px; font-weight: 800; color: #002D62; line-height: 1.1;">${avgResolutionHours}h</div>
                    <div class="tp-er-kpi-sub tp-er-c-navy" style="font-size: 11px; color: #002D62; margin-top: 4px;">Resolución</div>
                  </div>
                </td>
              </tr>
            </table>

            ${(customNotes && typeof customNotes === 'string' && customNotes.trim().length > 0) ? `
            <!-- Observaciones y Notas Ejecutivas -->
            <div class="tp-er-notes-box" style="background-color: #F0F7FF; border: 1px solid #B9D5FF; border-left: 5px solid #002D62; border-radius: 8px; padding: 14px 18px; margin-bottom: 22px;">
              <div class="tp-er-notes-title" style="font-size: 13px; font-weight: 800; color: #002D62; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
                📝 Observaciones y Notas Ejecutivas
              </div>
              <div class="tp-er-notes-body" style="font-size: 13px; color: #172B4D; line-height: 1.6; white-space: pre-wrap;">${customNotes.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            </div>
            ` : ''}

            <!-- Resumen de Cambios & Actividad del Ciclo -->
            <div class="tp-er-activity-box" style="background-color: #F8F9FA; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px 18px; margin-bottom: 22px;">
              <div class="tp-er-activity-header" style="margin-bottom: 10px;">
                <span class="tp-er-section-title-navy" style="font-size: 13px; font-weight: 800; color: #002D62; text-transform: uppercase; letter-spacing: 0.5px;">
                  📋 Resumen de Cambios & Actividad
                </span>
                <span class="tp-er-pill-gray tp-er-ml-8" style="font-size: 11px; font-weight: 600; color: #626F86; background: #EBECF0; padding: 2px 8px; border-radius: 12px; margin-left: 8px;">
                  Corte: ${dateFormatted}
                </span>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-er-activity-table" style="font-size: 12px; line-height: 1.6; color: #172B4D;">
                <tr>
                  <td width="33%" class="tp-er-activity-col" style="vertical-align: top; padding-right: 12px;">
                    <div class="tp-er-activity-col-title tp-er-c-success" style="font-weight: 700; color: #0E8A4C; margin-bottom: 4px;">✅ Avance de Ejecución</div>
                    <div class="tp-er-activity-col-text" style="color: #44546F; font-size: 11.5px;">
                      • <strong>${evaluados}</strong> de ${allTotal} casos evaluados (<strong>${coverageRate}%</strong> cobertura).<br/>
                      • <strong>${passed}</strong> aprobados (${successRate}% éxito).
                    </div>
                  </td>
                  <td width="33%" class="tp-er-activity-col-sep" style="vertical-align: top; padding-right: 12px; border-left: 1px solid #E2E8F0; padding-left: 12px;">
                    <div class="tp-er-activity-col-title tp-er-c-danger" style="font-weight: 700; color: #DE350B; margin-bottom: 4px;">🐞 Estatus de Defectos</div>
                    <div class="tp-er-activity-col-text" style="color: #44546F; font-size: 11.5px;">
                      • <strong>${openCycleBugs}</strong> defecto(s) abiertos en el ciclo actual.<br/>
                      • <strong>${openGeneralBlockersCount}</strong> defecto(s) bloqueante(s) abiertos en el plan general.<br/>
                      • MTTR de resolución: <strong>${avgResolutionHours}h</strong> hábiles.
                    </div>
                  </td>
                  <td width="34%" class="tp-er-activity-col-last" style="vertical-align: top; border-left: 1px solid #E2E8F0; padding-left: 12px;">
                    <div class="tp-er-activity-col-title tp-er-c-blue" style="font-weight: 700; color: #0C66E4; margin-bottom: 4px;">🎯 Estabilidad & Cierre</div>
                    <div class="tp-er-activity-col-text" style="color: #44546F; font-size: 11.5px;">
                      ${notRun > 0 ? `• Restan <strong>${notRun}</strong> caso(s) por ejecutar.<br/>` : `• <strong>100% de los casos</strong> evaluados en el ciclo.<br/>`}
                      ${openGeneralBlockersCount > 0 ? `• ⛔ <strong>${openGeneralBlockersCount} Bloqueante(s) Abierto(s) en Plan</strong> impiden liberación.` : (openCycleBugs === 0 ? `• 🟢 Sin defectos bloqueantes ni abiertos que impidan liberación.` : `• ⚠️ Requiere seguimiento de defectos antes de liberar.`)}
                    </div>
                  </td>
                </tr>
              </table>
            </div>

            <!-- Desglose de Ejecución (Visual Bar) -->
            <div class="tp-er-section-block" style="margin-bottom: 22px;">
              <div class="tp-er-section-title-navy" style="font-size: 13px; font-weight: 700; color: #002D62; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">
                📊 Distribución de Ejecución
              </div>
              
              <!-- Progress Multi-Segment Bar -->
              <div class="tp-er-progress-wrap" style="height: 14px; border-radius: 6px; overflow: hidden; background-color: #EBECF0; margin-bottom: 8px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-er-progress-table" style="width: 100%; height: 14px; background-color: #EBECF0;">
                  <tr>
                    ${pPct > 0 ? `<td width="${pPct}%" class="tp-er-bar-seg tp-er-bar-pass" style="width: ${pPct}%; background-color: #28A745;"></td>` : ''}
                    ${fPct > 0 ? `<td width="${fPct}%" class="tp-er-bar-seg tp-er-bar-fail" style="width: ${fPct}%; background-color: #E1007A;"></td>` : ''}
                    ${bPct > 0 ? `<td width="${bPct}%" class="tp-er-bar-seg tp-er-bar-block" style="width: ${bPct}%; background-color: #FF9800;"></td>` : ''}
                    ${nPct > 0 ? `<td width="${nPct}%" class="tp-er-bar-seg tp-er-bar-notrun" style="width: ${nPct}%; background-color: #CBD5E1;"></td>` : ''}
                  </tr>
                </table>
              </div>

              <!-- Status Legend Grid -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-er-legend-table" style="font-size: 12px;">
                <tr>
                  <td width="25%" class="tp-er-legend-td" style="color: #172B4D;">
                    <span class="tp-er-dot tp-er-bar-pass" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #28A745; margin-right: 6px;"></span>
                    <strong>Pasados:</strong> ${passed} (${pPct.toFixed(1)}%)
                  </td>
                  <td width="25%" class="tp-er-legend-td" style="color: #172B4D;">
                    <span class="tp-er-dot tp-er-bar-fail" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #E1007A; margin-right: 6px;"></span>
                    <strong>Fallidos:</strong> ${failed} (${fPct.toFixed(1)}%)
                  </td>
                  <td width="25%" class="tp-er-legend-td" style="color: #172B4D;">
                    <span class="tp-er-dot tp-er-bar-block" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #FF9800; margin-right: 6px;"></span>
                    <strong>Bloqueados:</strong> ${blocked} (${bPct.toFixed(1)}%)
                  </td>
                  <td width="25%" class="tp-er-legend-td-muted" style="color: #626F86;">
                    <span class="tp-er-dot tp-er-bar-notrun" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #CBD5E1; margin-right: 6px;"></span>
                    <strong>Sin Ejecutar:</strong> ${notRun} (${nPct.toFixed(1)}%)
                  </td>
                </tr>
              </table>
            </div>

            <!-- Defect Matrix Table (Scoped Strictly to Active Cycle) -->
            <div class="tp-er-section-block" style="margin-bottom: 22px;">
              <div class="tp-er-section-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div class="tp-er-section-title-navy" style="font-size: 13px; font-weight: 700; color: #002D62; text-transform: uppercase; letter-spacing: 0.5px;">
                  🐞 DEFECTOS DEL CICLO ACTUAL (${cycleBugsArray.length})
                </div>
                <span class="tp-er-pill-gray" style="font-size: 11px; font-weight: 600; color: #626F86; background: #EBECF0; padding: 2px 8px; border-radius: 12px;">
                  Todos los defectos vinculados al ciclo
                </span>
              </div>
              <table width="100%" cellpadding="6" cellspacing="0" border="0" class="tp-er-data-table" style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #DFE1E6; border-radius: 6px; overflow: hidden; table-layout: fixed;">
                <thead class="tp-er-thead-navy">
                  <tr style="background-color: #002D62; color: #ffffff;">
                    <th class="tp-er-th-left tp-er-w-15" style="border: 1px solid #002D62; padding: 8px 8px; text-align: left; font-weight: 700; width: 15%;">Incidencia</th>
                    <th class="tp-er-th-left tp-er-w-31" style="border: 1px solid #002D62; padding: 8px 8px; text-align: left; font-weight: 700; width: 31%;">Resumen</th>
                    <th class="tp-er-th-center tp-er-w-11" style="border: 1px solid #002D62; padding: 8px 6px; text-align: center; font-weight: 700; width: 11%;">Severidad</th>
                    <th class="tp-er-th-center tp-er-w-11" style="border: 1px solid #002D62; padding: 8px 6px; text-align: center; font-weight: 700; width: 11%;">Estado</th>
                    <th class="tp-er-th-left tp-er-w-20" style="border: 1px solid #002D62; padding: 8px 8px; text-align: left; font-weight: 700; width: 20%;">Línea de Tiempo / TTR</th>
                    <th class="tp-er-th-left tp-er-w-12" style="border: 1px solid #002D62; padding: 8px 8px; text-align: left; font-weight: 700; width: 12%;">Responsable</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows}
                </tbody>
              </table>
            </div>

            <!-- General Plan Blocker Defects Table (Only Bloqueantes Abiertos) -->
            <div class="tp-er-section-block" style="margin-bottom: 22px;">
              <div class="tp-er-section-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div class="tp-er-section-title-crimson" style="font-size: 13px; font-weight: 700; color: #BF2600; text-transform: uppercase; letter-spacing: 0.5px;">
                  ⛔ DEFECTOS BLOQUEANTES DE LA RELACIÓN GENERAL DEL PLAN (${generalBlockerBugs.length})
                </div>
                <span class="tp-er-pill-crimson" style="font-size: 11px; font-weight: 600; color: #BF2600; background: #FFEBE6; border: 1px solid #FFBDAD; padding: 2px 8px; border-radius: 12px;">
                  Filtrado estricto: Solo Bloqueantes Abiertos
                </span>
              </div>
              <table width="100%" cellpadding="6" cellspacing="0" border="0" class="tp-er-data-table" style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #DFE1E6; border-radius: 6px; overflow: hidden; table-layout: fixed;">
                <thead class="tp-er-thead-crimson">
                  <tr style="background-color: #BF2600; color: #ffffff;">
                    <th class="tp-er-th-left tp-er-w-14" style="border: 1px solid #BF2600; padding: 8px 8px; text-align: left; font-weight: 700; width: 14%;">Incidencia</th>
                    <th class="tp-er-th-left tp-er-w-28" style="border: 1px solid #BF2600; padding: 8px 8px; text-align: left; font-weight: 700; width: 28%;">Resumen</th>
                    <th class="tp-er-th-center tp-er-w-12" style="border: 1px solid #BF2600; padding: 8px 6px; text-align: center; font-weight: 700; width: 12%;">Severidad</th>
                    <th class="tp-er-th-center tp-er-w-11" style="border: 1px solid #BF2600; padding: 8px 6px; text-align: center; font-weight: 700; width: 11%;">Estado</th>
                    <th class="tp-er-th-left tp-er-w-15" style="border: 1px solid #BF2600; padding: 8px 6px; text-align: left; font-weight: 700; width: 15%;">Ciclos / Origen</th>
                    <th class="tp-er-th-left tp-er-w-20" style="border: 1px solid #BF2600; padding: 8px 8px; text-align: left; font-weight: 700; width: 20%;">Línea de Tiempo / TTR</th>
                  </tr>
                </thead>
                <tbody>
                  ${generalBlockerTableRows}
                </tbody>
              </table>
            </div>

            <!-- Status by Module (Functional Tests Only) -->
            ${moduleSectionHtml}

            <!-- QA Assessment & Next Steps Box -->
            <div class="tp-er-verdict-box" style="background-color: #FDF8FA; border-left: 4px solid #E1007A; border-radius: 0 8px 8px 0; padding: 14px 18px; margin-bottom: 20px;">
              <div class="tp-er-verdict-title" style="font-size: 13px; font-weight: 700; color: #E1007A; text-transform: uppercase; margin-bottom: 6px;">
                📌 Evaluación de Calidad & Próximos Pasos
              </div>
              <p class="tp-er-verdict-p" style="margin: 0 0 10px 0; font-size: 13px; color: #172B4D; line-height: 1.5;">
                ${verdictText}
              </p>
              <ul class="tp-er-verdict-ul" style="margin: 0; padding-left: 18px; font-size: 12px; color: #44546F; line-height: 1.6;">
                ${openGeneralBlockersCount > 0 ? `<li>⛔ <strong>Prioridad Crítica:</strong> Resolver de inmediato los <strong>${openGeneralBlockersCount}</strong> defecto(s) bloqueante(s) abiertos en el plan general.</li>` : ''}
                <li>Priorizar la atención y resolución de los <strong>${openCycleBugs}</strong> defectos abiertos en el ciclo con el equipo de desarrollo.</li>
                <li>Realizar re-test de casos fallidos tras el despliegue del siguiente build o corrección.</li>
                ${notRun > 0 ? `<li>Completar la ejecución de los <strong>${notRun}</strong> casos pendientes para alcanzar la cobertura total.</li>` : '<li>Cierre formal y firma del ciclo de pruebas tras verificación de criterios de aceptación.</li>'}
              </ul>
            </div>

          </div>

          <!-- Footer -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" class="tp-er-footer-table" style="background-color: #FAFBFC; border-top: 1px solid #EBECF0; padding: 14px 26px;">
            <tr>
              <td class="tp-er-footer-td-left" style="font-size: 11px; color: #626F86;">
                Test Pulse Suite ${APP_VERSION} • Jira Cloud Quality Management • El Puerto de Liverpool
              </td>
              <td class="tp-er-footer-td-right" style="font-size: 11px; color: #626F86; text-align: right;">
                Generado automáticamente
              </td>
            </tr>
          </table>

        </div>
      `;

      // Plain text fallback
      const notesPlainText = (customNotes && typeof customNotes === 'string' && customNotes.trim().length > 0)
        ? `\n\nNOTAS Y OBSERVACIONES EJECUTIVAS:\n${customNotes.trim()}\n`
        : '';
      const plainText = `TEST PULSE SUITE - REPORTE DE ESTATUS\nProyecto: ${projectDisplay}\nFecha: ${dateFormatted}\nVersión: ${scopeVersionsText || 'N/A'}\nCasos Totales: ${allTotal} | Éxito: ${successRate}% (${passed} Pasados)\nCobertura: ${coverageRate}% | Defectos del Ciclo: ${cycleBugsArray.length} (${openCycleBugs} abiertos, ${closedCycleBugs} cerrados) | Defectos Bloqueantes Abiertos en Plan: ${openGeneralBlockersCount} | MTTR Prom: ${avgResolutionHours}h\nAlcance: ${scopeCyclesText} / ${scopePlansText}${notesPlainText}`;
      const defaultEmailSubject = `[Reporte de Estatus] ${currentProjectName} - ${scopeCyclesText} (${successRate}% Éxito - ${openCycleBugs} Defectos en Ciclo${openGeneralBlockersCount > 0 ? ` | ⛔ ${openGeneralBlockersCount} Bloqueantes Abiertos` : ''})`;
      const emailSubject = (customSubject && typeof customSubject === 'string' && customSubject.trim().length > 0)
        ? customSubject.trim()
        : defaultEmailSubject;

      return {
        htmlReport: htmlTemplate,
        plainText,
        emailSubject,
        projectDisplay,
        projectName: currentProjectName,
        projectKey: currentProjectKey,
        dateFormatted,
        scopeCyclesText,
        scopePlansText,
        scopeVersionsText,
        stats: {
          total: allTotal,
          passed,
          failed,
          blocked,
          notRun,
          successRate,
          coverageRate,
          totalAllBugs,
          totalOpenBugs,
          totalClosedBugs,
          totalCycleBugs,
          openCycleBugs,
          closedCycleBugs,
          totalGeneralBlockerBugs: generalBlockerBugs.length,
          openGeneralBlockerBugs: openGeneralBlockersCount,
          closedGeneralBlockerBugs: closedGeneralBlockersCount,
          avgResolutionHours
        },
        generalBlockerBugs: generalBlockerBugs.map(b => ({
          key: b.key,
          summary: b.summary,
          severity: b.severity,
          status: b.status,
          isDone: b.isDone,
          assignee: b.assignee,
          created: b.created,
          cycles: Array.from(b.cycles || [])
        }))
      };
    };

    /**
     * Programmatically applies each element's `style="..."` attribute declarations via the
     * JavaScript CSSOM (`el.style.setProperty(prop, val, priority)`).
     *
     * Why this is needed:
     * Under strict Atlassian Forge Content Security Policy (`style-src 'self'`), HTML strings
     * injected via `innerHTML` or `iframeDoc.write()` may have their raw `style="..."` attributes
     * ignored by the HTML parser, whereas JavaScript CSSOM property assignments (`el.style.setProperty`)
     * and external `'self'` stylesheets (`index.css`) are fully permitted.
     */
    const applyCssomInlineStyles = (rootEl) => {
      if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
      const elements = [rootEl, ...Array.from(rootEl.querySelectorAll('[style]'))];
      elements.forEach((el) => {
        if (!el || !el.getAttribute) return;
        const rawStyle = el.getAttribute('style');
        if (!rawStyle) return;
        rawStyle.split(';').forEach((decl) => {
          const colonIdx = decl.indexOf(':');
          if (colonIdx === -1) return;
          const prop = decl.slice(0, colonIdx).trim();
          let val = decl.slice(colonIdx + 1).trim();
          if (!prop || !val) return;
          let priority = '';
          if (/!important$/i.test(val)) {
            val = val.replace(/!important$/i, '').trim();
            priority = 'important';
          }
          try {
            el.style.setProperty(prop, val, priority);
          } catch (_) {
            // Ignore malformed individual CSS properties
          }
        });
      });
    };

    /**
     * Generates and triggers a native PDF / Print dialog directly inside the
     * Atlassian Forge Custom UI iframe so the printed PDF looks 100% identical to the
     * HTML email report (`buildExecutiveReportData`).
     *
     * Key architectural details for Forge CSP (`style-src 'self'`):
     * 1. Clones all `<link rel="stylesheet">` tags from `window.document.head` into the print
     *    iframe's `<head>`, so the Vite-bundled `index.css` (`.tp-er-*` classes and `@media print`
     *    rules) is loaded from `'self'` inside the print iframe.
     * 2. Runs `applyCssomInlineStyles` on the print DOM so any dynamic inline styles (e.g.,
     *    progress bar percentage widths) are also applied via JavaScript CSSOM.
     * 3. Blurs the active button before opening the print preview so no native browser tooltip
     *    floats over the captured PDF preview.
     */
    const handlePrintPdf = (reportHtml, docTitle) => {
      // Blur any focused button immediately to prevent native browser tooltips from appearing over the print dialog
      try {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
      } catch (_) {}

      const cleanTitle = (docTitle || 'Reporte Ejecutivo - Test Pulse').replace(/"/g, '&quot;');

      // Collect all external 'self' stylesheets compiled by Vite in the parent document
      const stylesheetLinksHtml = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map((link) => (link.href ? `<link rel="stylesheet" href="${link.href}" />` : ''))
        .filter(Boolean)
        .join('\n');

      const fullPrintDocument = `
        <!DOCTYPE html>
        <html lang="es">
          <head>
            <meta charset="utf-8" />
            <title>${cleanTitle}</title>
            ${stylesheetLinksHtml}
          </head>
          <body class="tp-print-iframe-body">
            <div class="tp-print-report-wrapper">
              ${reportHtml}
            </div>
          </body>
        </html>
      `;

      // Helper for Fallback Strategy: Direct @media print DOM container on current window (styled by index.css)
      const triggerDirectDomPrintFallback = () => {
        try {
          const prevTitle = document.title;
          document.title = docTitle || 'Reporte Ejecutivo - Test Pulse';

          const existingContainer = document.getElementById('tp-print-direct-container');
          if (existingContainer) existingContainer.remove();

          const printContainer = document.createElement('div');
          printContainer.id = 'tp-print-direct-container';
          printContainer.className = 'tp-print-report-wrapper';
          printContainer.innerHTML = reportHtml;

          document.documentElement.classList.add('tp-printing-exec-report');
          document.body.classList.add('tp-printing-exec-report');
          document.body.appendChild(printContainer);

          // Apply CSSOM styles in case CSP blocked raw style="" attributes on innerHTML
          applyCssomInlineStyles(printContainer);

          const cleanupDirectPrint = () => {
            document.title = prevTitle;
            document.documentElement.classList.remove('tp-printing-exec-report');
            document.body.classList.remove('tp-printing-exec-report');
            if (printContainer.parentNode) printContainer.parentNode.removeChild(printContainer);
            window.removeEventListener('afterprint', cleanupDirectPrint);
          };

          window.addEventListener('afterprint', cleanupDirectPrint);
          window.focus();
          window.print();
          // Safety cleanup in case afterprint does not fire in some browsers
          setTimeout(cleanupDirectPrint, 60000);
        } catch (fallbackErr) {
          console.error('[Test Pulse] Error en impresión directa de PDF:', fallbackErr);
          addNotification({
            type: 'error',
            title: 'Error al generar PDF',
            description: 'No se pudo iniciar el diálogo de impresión del navegador.'
          });
        }
      };

      try {
        const prevIframe = document.getElementById('tp-print-pdf-iframe');
        if (prevIframe && prevIframe.parentNode) {
          prevIframe.parentNode.removeChild(prevIframe);
        }

        const printIframe = document.createElement('iframe');
        printIframe.id = 'tp-print-pdf-iframe';
        printIframe.title = cleanTitle;
        printIframe.style.setProperty('position', 'fixed');
        printIframe.style.setProperty('right', '0');
        printIframe.style.setProperty('bottom', '0');
        printIframe.style.setProperty('width', '820px');
        printIframe.style.setProperty('height', '1100px');
        printIframe.style.setProperty('border', '0');
        printIframe.style.setProperty('opacity', '0');
        printIframe.style.setProperty('pointer-events', 'none');
        printIframe.style.setProperty('z-index', '-9999');
        document.body.appendChild(printIframe);

        const iframeWin = printIframe.contentWindow;
        const iframeDoc = printIframe.contentDocument || (iframeWin && iframeWin.document);
        if (!iframeDoc || !iframeWin) {
          triggerDirectDomPrintFallback();
          return;
        }

        const prevTitle = document.title;
        document.title = docTitle || 'Reporte Ejecutivo - Test Pulse';

        iframeDoc.open();
        iframeDoc.write(fullPrintDocument);
        iframeDoc.close();

        // Apply CSSOM inline styles onto all elements inside the print iframe
        if (iframeDoc.body) {
          applyCssomInlineStyles(iframeDoc.body);
        }

        let printed = false;
        const executeIframePrint = () => {
          if (printed) return;
          printed = true;
          try {
            if (iframeDoc.body) {
              applyCssomInlineStyles(iframeDoc.body);
            }
            iframeWin.focus();
            iframeWin.print();
            addNotification({
              type: 'info',
              title: '🖨️ Diálogo de PDF listo',
              description: 'Selecciona "Guardar como PDF" en el destino de impresión para descargar tu reporte.'
            });
          } catch (printErr) {
            console.warn('[Test Pulse] Fallback a impresión directa DOM:', printErr);
            triggerDirectDomPrintFallback();
          } finally {
            setTimeout(() => {
              document.title = prevTitle;
            }, 2500);
          }
        };

        // Wait for cloned external stylesheet links and images inside the iframe before invoking print()
        const waitAndPrint = () => {
          const links = Array.from(iframeDoc.querySelectorAll('link[rel="stylesheet"]'));
          const pendingLinks = links.filter((l) => !l.sheet);
          if (pendingLinks.length === 0) {
            setTimeout(executeIframePrint, 180);
            return;
          }
          let remaining = pendingLinks.length;
          const onSettled = () => {
            remaining -= 1;
            if (remaining <= 0) {
              setTimeout(executeIframePrint, 180);
            }
          };
          pendingLinks.forEach((l) => {
            l.addEventListener('load', onSettled, { once: true });
            l.addEventListener('error', onSettled, { once: true });
          });
        };

        printIframe.onload = waitAndPrint;
        waitAndPrint();
        // Safety fallback timer if stylesheet load events already fired
        setTimeout(executeIframePrint, 650);
      } catch (err) {
        console.warn('[Test Pulse] Error en iframe print, usando fallback DOM:', err);
        triggerDirectDomPrintFallback();
      }
    };

    const copyReportHtmlToClipboard = async (htmlTemplate, plainText) => {
      let copied = false;
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          const item = new ClipboardItem({
            'text/html': new Blob([htmlTemplate], { type: 'text/html' }),
            'text/plain': new Blob([plainText || ''], { type: 'text/plain' })
          });
          await navigator.clipboard.write([item]);
          copied = true;
        }
      } catch (clipErr) {
        console.warn("navigator.clipboard.write failed, trying DOM fallback:", clipErr);
      }

      if (!copied) {
        const el = document.createElement('div');
        el.innerHTML = htmlTemplate;
        el.style.position = 'fixed';
        el.style.left = '-9999px';
        el.style.top = '0';
        document.body.appendChild(el);
        
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
        
        document.execCommand('copy');
        selection.removeAllRanges();
        document.body.removeChild(el);
      }
      return true;
    };

    const handleOpenExecutiveReportModal = () => {
      try {
        const reportData = buildExecutiveReportData();
        setExecutiveReportSubject(reportData.emailSubject);
        setExecutiveReportBuild(reportData.scopeVersionsText || '');
        setExecutiveReportModalOpen(true);
      } catch (err) {
        console.error('Error al abrir modal de reporte:', err);
        addNotification({
          type: 'error',
          title: 'Error al preparar reporte',
          description: err.message
        });
      }
    };

    const handleCopyReportToClipboard = handleOpenExecutiveReportModal;

    const handleTestAutomatedReportDispatch = async () => {
      if (!reportAutomationConfig.webhookUrl || !reportAutomationConfig.webhookUrl.startsWith('http')) {
        addNotification({
          type: 'warning',
          title: 'Webhook Inválido',
          description: 'Por favor ingresa una URL de Webhook válida de Jira Automation (ej. https://automation.atlassian.com/pro/hooks/...)'
        });
        return;
      }

      try {
        setReportAutomationTesting(true);
        const report = buildExecutiveReportData();
        const payload = {
          timestamp: new Date().toISOString(),
          source: `Test Pulse Suite ${APP_VERSION} (Manual Test Dispatch)`,
          projectId: selectedProjectId,
          projectName: report.projectName,
          projectKey: report.projectKey,
          recipients: reportAutomationConfig.recipients || '',
          emailSubject: report.emailSubject,
          htmlReport: report.htmlReport,
          plainText: report.plainText,
          summary: {
            scopePlans: report.scopePlansText,
            scopeCycles: report.scopeCyclesText,
            generatedAt: report.dateFormatted
          },
          stats: report.stats
        };

        const res = await invoke('triggerManualReportDispatch', {
          projectId: selectedProjectId,
          webhookUrl: reportAutomationConfig.webhookUrl,
          reportData: payload
        });

        if (res && res.success) {
          setReportAutomationLastDispatch(res.lastDispatch || null);
          addNotification({
            type: 'success',
            title: '⚡ ¡Prueba de Envío Exitosa!',
            description: `Se despachó el reporte al Webhook de Jira Automation (HTTP ${res.status || 200}). Revisa la regla y tu correo.`
          });
        } else {
          setReportAutomationLastDispatch(res?.lastDispatch || null);
          addNotification({
            type: 'error',
            title: 'Error al Despachar',
            description: res?.error || 'Jira Automation rechazó la petición.'
          });
        }
      } catch (err) {
        addNotification({
          type: 'error',
          title: 'Error de Despacho',
          description: err.message || String(err)
        });
      } finally {
        setReportAutomationTesting(false);
      }
    };

    const getInitials = (name) => {
      if (!name || name === 'Sin asignar') return 'QA';
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    };

    const autoPassPct = execStats.auto.total > 0 ? Math.round((execStats.auto.passed / execStats.auto.total) * 100) : 100;
    const manualPassPct = execStats.manual.total > 0 ? Math.round((execStats.manual.passed / execStats.manual.total) * 100) : 98;
    const getSevRank = (sev) => {
      const s = String(sev || '').toLowerCase();
      if (s.includes('bloq') || s.includes('blocker')) return 1;
      if (s.includes('crit') || s.includes('crític')) return 2;
      if (s.includes('may') || s.includes('major') || s.includes('alta') || s.includes('high')) return 3;
      if (s.includes('med') || s.includes('medio') || s.includes('media') || s.includes('medium')) return 4;
      if (s.includes('men') || s.includes('minor') || s.includes('baja') || s.includes('low') || s.includes('trivial')) return 5;
      return 6;
    };

    const getSeverityClass = (sev) => {
      const s = String(sev || '').toLowerCase();
      if (s.includes('bloq') || s.includes('blocker')) return 'bloqueante';
      if (s.includes('crit') || s.includes('crític')) return 'critico';
      if (s.includes('may') || s.includes('major') || s.includes('alta') || s.includes('high')) return 'mayor';
      if (s.includes('med') || s.includes('medio') || s.includes('media') || s.includes('medium')) return 'medio';
      if (s.includes('men') || s.includes('minor') || s.includes('baja') || s.includes('low') || s.includes('trivial')) return 'menor';
      return 'sin-definir';
    };

    const getSeverityLabel = (sev) => {
      const s = String(sev || '').trim();
      if (!s || s === 'Sin definir' || s === 'N/A') return '○ Sin definir';
      const low = s.toLowerCase();
      if (low.includes('bloq') || low.includes('blocker')) return '✱ BLOQUEANTE';
      if (low.includes('crit') || low.includes('crític')) return '▲ CRÍTICO';
      if (low.includes('may') || low.includes('major') || low.includes('alta') || low.includes('high')) return '● MAYOR';
      if (low.includes('med') || low.includes('medio') || low.includes('media') || low.includes('medium')) return '◆ MEDIO';
      if (low.includes('men') || low.includes('minor') || low.includes('baja') || low.includes('low') || low.includes('trivial')) return '○ MENOR';
      return `● ${s}`;
    };

    // Severity breakdown of OPEN bugs for interactive widget (Opción A)
    const openPlanBugs = planGeneralBugsList.filter(b => !b.isDone);
    const sevOpenCounts = {
      bloqueante: openPlanBugs.filter(b => getSevRank(b.severity) === 1).length,
      critico: openPlanBugs.filter(b => getSevRank(b.severity) === 2).length,
      mayor: openPlanBugs.filter(b => getSevRank(b.severity) === 3).length,
      medio: openPlanBugs.filter(b => getSevRank(b.severity) === 4).length,
      menor: openPlanBugs.filter(b => getSevRank(b.severity) === 5).length,
      sinDefinir: openPlanBugs.filter(b => getSevRank(b.severity) >= 6).length,
      total: openPlanBugs.length
    };

    const allDonutSegments = [
      { key: 'Bloqueante', label: 'Bloqueante', count: sevOpenCounts.bloqueante, color: '#DE350B', bg: '#FFEBE6', border: '#FFBDAD', enabled: conf.showSevBloqueante !== false },
      { key: 'Crítico', label: 'Crítico', count: sevOpenCounts.critico, color: '#E5493A', bg: '#FFF0ED', border: '#FFC4BA', enabled: conf.showSevCritico !== false },
      { key: 'Mayor', label: 'Mayor', count: sevOpenCounts.mayor, color: '#FF8B00', bg: '#FFFAE6', border: '#FFE380', enabled: conf.showSevMayor !== false },
      { key: 'Medio', label: 'Medio', count: sevOpenCounts.medio, color: '#E2B203', bg: '#FFFBE6', border: '#F5CD47', enabled: conf.showSevMedio !== false },
      { key: 'Menor', label: 'Menor', count: sevOpenCounts.menor, color: '#006644', bg: '#E3FCEF', border: '#ABF5D1', enabled: conf.showSevMenor !== false },
      { key: 'Sin definir', label: 'Sin Definir', count: sevOpenCounts.sinDefinir, color: '#626F86', bg: '#F1F2F4', border: '#DCDFE4', enabled: conf.showSevSinDefinir !== false }
    ];
    const donutSegments = allDonutSegments.filter(s => s.enabled);
    const visibleSevOpenTotal = donutSegments.reduce((sum, seg) => sum + seg.count, 0);

    // ── Traceability matrix rows (Top-Down: Épica ➔ Historia ➔ Plan de Pruebas / Ciclo / Estado / Defectos) ──
    const traceabilityRows = [];

    // 1. Index all Cycle Executions (Test Runs) by Test Case Key and ID
    const tcExecutionsMap = new Map(); // tcKeyOrId -> Array<{ cycleId, cycleName, planId, planName, planKey, status, bugs, tcKey, tcId }>
    const addTcExecution = (k, execObj) => {
      if (!k) return;
      const keyStr = String(k).trim().toUpperCase();
      if (!keyStr) return;
      if (!tcExecutionsMap.has(keyStr)) tcExecutionsMap.set(keyStr, []);
      const list = tcExecutionsMap.get(keyStr);
      if (!list.some(item => String(item.cycleId) === String(execObj.cycleId))) {
        list.push(execObj);
      }
    };

    filteredCycles.forEach(cycle => {
      if (cycle.execution && Array.isArray(cycle.execution)) {
        const seenTcInCycle = new Set();
        const cPlanId = cycle.planId || cycle.plan?.id || cycle.plan?.key || (typeof cycle.plan === 'string' ? cycle.plan : null);
        const cyclePlan = testPlans.find(p => String(p.id) === String(cPlanId) || String(p.key) === String(cPlanId));
        const planName = cyclePlan ? (cyclePlan.name || cyclePlan.summary || cyclePlan.key) : 'General (Sin Plan)';
        const planKey = cyclePlan?.key || null;

        cycle.execution.forEach((ex, idx) => {
          const tc = findTc(ex.testCaseId) || findTc(ex.testCaseKey) || findTc(ex.id) || (ex.key ? findTc(ex.key) : undefined);
          const tcKey = tc ? tc.key : (ex.testCaseKey || ex.key || null);
          const tcId = String(tc?.id || ex.testCaseId || ex.id || '');
          const dedupeKey = tcKey ? `key_${tcKey}` : (tcId ? `id_${tcId}` : `item_${idx}`);
          if (seenTcInCycle.has(dedupeKey)) return;
          seenTcInCycle.add(dedupeKey);

          const exBugs = (ex.linkedBugs && Array.isArray(ex.linkedBugs)) ? ex.linkedBugs.filter(isActualBug) : [];
          const execEntry = {
            cycleId: cycle.id,
            cycleName: cycle.summary || cycle.key || `Ciclo-${cycle.id}`,
            planId: cyclePlan?.id || cPlanId || null,
            planName,
            planKey,
            status: ex.status || 'NOT_RUN',
            bugs: exBugs,
            tcKey,
            tcId
          };

          if (tcKey) addTcExecution(tcKey, execEntry);
          if (tcId) addTcExecution(tcId, execEntry);
          if (ex.testCaseKey && ex.testCaseKey !== tcKey) addTcExecution(ex.testCaseKey, execEntry);
          if (ex.key && ex.key !== tcKey) addTcExecution(ex.key, execEntry);
        });
      }
    });

    // 2. Consolidate all Epics and Stories from traceabilityHierarchy + requirementsMap + testCases
    const consolidatedEpicsMap = new Map(); // epicKeyUpper -> { key, summary, workflowStatus, workflowStatusCategory }
    const consolidatedStoriesMap = new Map(); // storyKeyUpper -> { key, summary, workflowStatus, workflowStatusCategory, epicKey, epicSummary, tcRefSet: Set<string> }

    (traceabilityHierarchy?.epics || []).forEach(ep => {
      if (ep?.key) {
        consolidatedEpicsMap.set(ep.key.toUpperCase(), {
          key: ep.key,
          summary: ep.summary || '',
          workflowStatus: ep.status || '',
          workflowStatusCategory: ep.statusCategory || ''
        });
      }
    });

    const ensureStoryEntry = (sKey, sSummary, eKey, eSummary, sWorkflowStatus = '', sWorkflowCategory = '') => {
      if (!sKey) return null;
      const sUpper = sKey.toUpperCase();
      if (consolidatedEpicsMap.has(sUpper)) return null; // Never treat an Epic as a Story
      if (!consolidatedStoriesMap.has(sUpper)) {
        consolidatedStoriesMap.set(sUpper, {
          key: sKey,
          summary: sSummary || '',
          workflowStatus: sWorkflowStatus || '',
          workflowStatusCategory: sWorkflowCategory || '',
          epicKey: eKey || null,
          epicSummary: eSummary || null,
          tcRefSet: new Set()
        });
      } else {
        const cur = consolidatedStoriesMap.get(sUpper);
        if (!cur.summary && sSummary) cur.summary = sSummary;
        if (!cur.workflowStatus && sWorkflowStatus) cur.workflowStatus = sWorkflowStatus;
        if (!cur.workflowStatusCategory && sWorkflowCategory) cur.workflowStatusCategory = sWorkflowCategory;
        if (!cur.epicKey && eKey) cur.epicKey = eKey;
        if (!cur.epicSummary && eSummary) cur.epicSummary = eSummary;
      }
      if (eKey) {
        const eUpper = eKey.toUpperCase();
        if (!consolidatedEpicsMap.has(eUpper)) {
          consolidatedEpicsMap.set(eUpper, { key: eKey, summary: eSummary || '', workflowStatus: '', workflowStatusCategory: '' });
        } else if (!consolidatedEpicsMap.get(eUpper).summary && eSummary) {
          consolidatedEpicsMap.get(eUpper).summary = eSummary;
        }
      }
      return consolidatedStoriesMap.get(sUpper);
    };

    (traceabilityHierarchy?.stories || []).forEach(st => {
      if (!st?.key) return;
      const entry = ensureStoryEntry(st.key, st.summary, st.epicKey, st.epicSummary, st.status || '', st.statusCategory || '');
      if (entry && Array.isArray(st.linkedTestCases)) {
        st.linkedTestCases.forEach(tc => {
          if (tc?.key) entry.tcRefSet.add(tc.key.toUpperCase());
          if (tc?.id) entry.tcRefSet.add(String(tc.id).toUpperCase());
        });
      }
    });

    Object.values(requirementsMap || {}).forEach(req => {
      if (!req?.key) return;
      const rType = (req.issueType || '').toLowerCase();
      if (rType === 'epic' || rType === 'épica' || rType.includes('epic') || rType.includes('épica')) {
        const eUpper = req.key.toUpperCase();
        if (!consolidatedEpicsMap.has(eUpper)) {
          consolidatedEpicsMap.set(eUpper, {
            key: req.key,
            summary: req.summary || '',
            workflowStatus: req.status || '',
            workflowStatusCategory: req.statusCategory || ''
          });
        } else {
          const epCur = consolidatedEpicsMap.get(eUpper);
          if (!epCur.workflowStatus && req.status) epCur.workflowStatus = req.status;
          if (!epCur.workflowStatusCategory && req.statusCategory) epCur.workflowStatusCategory = req.statusCategory;
        }
      } else {
        ensureStoryEntry(req.key, req.summary, req.epicKey, req.epicSummary, req.status || '', req.statusCategory || '');
      }
    });

    // Also inspect tcMap from traceabilityHierarchy and frontend testCases to ensure all TC <-> Story links are captured
    Object.entries(traceabilityHierarchy?.tcMap || {}).forEach(([tcRef, info]) => {
      if (info?.storyKey) {
        const stEntry = ensureStoryEntry(
          info.storyKey,
          info.storySummary,
          info.epicKey,
          info.epicSummary,
          info.storyStatus || '',
          info.storyStatusCategory || ''
        );
        if (stEntry) stEntry.tcRefSet.add(String(tcRef).toUpperCase());
      }
    });

    (testCases || []).forEach(tc => {
      if (!tc) return;
      const extracted = extractEpicAndRequirement(tc, projectConfig, requirementsMap);
      if (extracted?.reqKey) {
        const reqFromMap = requirementsMap?.[extracted.reqKey];
        const stEntry = ensureStoryEntry(
          extracted.reqKey,
          extracted.reqSummary,
          extracted.epicKey,
          extracted.epicSummary,
          reqFromMap?.status || '',
          reqFromMap?.statusCategory || ''
        );
        if (stEntry) {
          if (tc.key) stEntry.tcRefSet.add(tc.key.toUpperCase());
          if (tc.id) stEntry.tcRefSet.add(String(tc.id).toUpperCase());
        }
      }
    });

    // Resolve any missing Epic summaries on Stories
    consolidatedStoriesMap.forEach(st => {
      if (st.epicKey && !st.epicSummary) {
        const ep = consolidatedEpicsMap.get(st.epicKey.toUpperCase());
        if (ep?.summary) st.epicSummary = ep.summary;
      }
    });

    // Group Stories by Epic (and collect Stories without Epic)
    const storiesByEpicUpper = new Map(); // epicKeyUpper -> Array<story>
    const storiesWithoutEpic = [];

    consolidatedStoriesMap.forEach(st => {
      if (st.epicKey) {
        const eUpper = st.epicKey.toUpperCase();
        if (!storiesByEpicUpper.has(eUpper)) storiesByEpicUpper.set(eUpper, []);
        storiesByEpicUpper.get(eUpper).push(st);
      } else {
        storiesWithoutEpic.push(st);
      }
    });

    const hasActivePlanOrCycleFilter =
      (reportSelectedPlans && reportSelectedPlans.length > 0) ||
      (reportSelectedCycles && reportSelectedCycles.length > 0);

    // Status aggregation helper when a Story has multiple Test Cases executed in the same Cycle
    const aggregateCycleStatus = (statuses) => {
      if (!statuses || statuses.length === 0) return 'NOT_RUN';
      const norms = statuses.map(s => normalizeUiStatus(s));
      if (norms.includes('Failed')) return 'FAILED';
      if (norms.includes('Blocked')) return 'BLOCKED';
      if (norms.every(n => n === 'Passed')) return 'PASSED';
      if (norms.some(n => n === 'Passed')) return 'IN_PROGRESS';
      return 'NOT_RUN';
    };

    const emitStoryRows = (epicObj, storyObj, forceEmit = false) => {
      const epicKey = epicObj?.key || storyObj?.epicKey || null;
      const epicSummary = epicObj?.summary || storyObj?.epicSummary || null;
      const epicWorkflowStatus = epicObj?.workflowStatus || '';
      const reqKey = storyObj?.key || null;
      const reqSummary = storyObj?.summary || null;
      const reqWorkflowStatus = storyObj?.workflowStatus || '';
      const reqWorkflowStatusCategory = storyObj?.workflowStatusCategory || '';

      // Gather all cycle executions for Test Cases linked to this Story
      const cycleExecutionsForStory = new Map(); // cycleId -> { cycleId, cycleName, planId, planName, planKey, statuses: [], bugsMap: Map, tcCount: number }
      if (storyObj && storyObj.tcRefSet && storyObj.tcRefSet.size > 0) {
        storyObj.tcRefSet.forEach(tcRef => {
          const execs = tcExecutionsMap.get(tcRef) || [];
          execs.forEach(ex => {
            const cIdStr = String(ex.cycleId);
            if (!cycleExecutionsForStory.has(cIdStr)) {
              cycleExecutionsForStory.set(cIdStr, {
                cycleId: ex.cycleId,
                cycleName: ex.cycleName,
                planId: ex.planId,
                planName: ex.planName,
                planKey: ex.planKey,
                statuses: [],
                bugsMap: new Map(),
                tcKeys: new Set()
              });
            }
            const group = cycleExecutionsForStory.get(cIdStr);
            const tcDedup = ex.tcKey || ex.tcId || tcRef;
            if (!group.tcKeys.has(tcDedup)) {
              group.tcKeys.add(tcDedup);
              group.statuses.push(ex.status);
            }
            (ex.bugs || []).forEach(b => {
              if (b?.key && !group.bugsMap.has(b.key)) {
                group.bugsMap.set(b.key, b);
              }
            });
          });
        });
      }

      if (cycleExecutionsForStory.size > 0) {
        cycleExecutionsForStory.forEach(group => {
          traceabilityRows.push({
            id: `story-${reqKey || 'no-req'}-cycle-${group.cycleId}`,
            epic: epicKey,
            epicKey,
            epicSummary,
            epicWorkflowStatus,
            requirement: reqKey,
            requirementKey: reqKey,
            requirementSummary: reqSummary,
            requirementWorkflowStatus: reqWorkflowStatus,
            requirementWorkflowStatusCategory: reqWorkflowStatusCategory,
            planId: group.planId,
            planName: group.planName,
            planKey: group.planKey,
            cycleId: group.cycleId,
            cycleName: group.cycleName,
            status: aggregateCycleStatus(group.statuses),
            linkedTcCount: storyObj?.tcRefSet?.size || 0,
            executedTcCount: group.tcKeys.size,
            bugs: Array.from(group.bugsMap.values())
          });
        });
      } else if (!hasActivePlanOrCycleFilter || forceEmit) {
        // Show the Epic + Story even if its Test Cases haven't been added to a Cycle yet (or if it has no Test Cases yet)
        const hasLinkedTcs = storyObj && storyObj.tcRefSet && storyObj.tcRefSet.size > 0;
        traceabilityRows.push({
          id: `story-${reqKey || epicKey || Math.random()}`,
          epic: epicKey,
          epicKey,
          epicSummary,
          epicWorkflowStatus,
          requirement: reqKey,
          requirementKey: reqKey,
          requirementSummary: reqSummary,
          requirementWorkflowStatus: reqWorkflowStatus,
          requirementWorkflowStatusCategory: reqWorkflowStatusCategory,
          planId: null,
          planName: hasLinkedTcs ? 'Sin plan asignado' : 'Sin casos vinculados',
          planKey: null,
          cycleId: null,
          cycleName: hasLinkedTcs ? 'Sin ciclo de ejecución' : 'Pendiente de cobertura',
          status: 'NOT_RUN',
          linkedTcCount: storyObj?.tcRefSet?.size || 0,
          executedTcCount: 0,
          bugs: []
        });
      }
    };

    // 3. Emit rows starting from Epics -> Linked Stories
    consolidatedEpicsMap.forEach((epicObj, epicKeyUpper) => {
      const linkedStories = storiesByEpicUpper.get(epicKeyUpper) || [];
      if (linkedStories.length > 0) {
        linkedStories.forEach(storyObj => {
          emitStoryRows(epicObj, storyObj);
        });
      } else if (!hasActivePlanOrCycleFilter) {
        // Epic exists in Jira but has no Stories linked yet
        traceabilityRows.push({
          id: `epic-only-${epicObj.key}`,
          epic: epicObj.key,
          epicKey: epicObj.key,
          epicSummary: epicObj.summary,
          epicWorkflowStatus: epicObj.workflowStatus || '',
          requirement: null,
          requirementKey: null,
          requirementSummary: null,
          requirementWorkflowStatus: '',
          requirementWorkflowStatusCategory: '',
          planId: null,
          planName: 'Sin plan asignado',
          planKey: null,
          cycleId: null,
          cycleName: 'Sin historias vinculadas',
          status: 'NOT_RUN',
          linkedTcCount: 0,
          executedTcCount: 0,
          bugs: []
        });
      }
    });

    // 4. Emit rows for Stories in the project that don't have an Epic assigned yet (Orphan Stories)
    storiesWithoutEpic.forEach(storyObj => {
      emitStoryRows(null, storyObj, true);
    });

    const filteredBugsList = cycleAllBugsList.filter(bug => {
      if (dashboardCycleBugFilter === 'OPEN' && bug.isDone) return false;
      if (dashboardCycleBugFilter === 'CLOSED' && !bug.isDone) return false;
      if (dashboardCycleBugFilter === 'BLOCKER' && getSevRank(bug.severity) > 2) return false;
      if (dashboardCycleBugFilter === 'MEDIUM' && getSevRank(bug.severity) <= 2) return false;

      if (!dashboardBugSearch) return true;
      const q = dashboardBugSearch.toLowerCase().trim();
      return (
        bug.key.toLowerCase().includes(q) ||
        bug.summary.toLowerCase().includes(q) ||
        bug.assignee.toLowerCase().includes(q) ||
        String(bug.severity).toLowerCase().includes(q) ||
        String(bug.status).toLowerCase().includes(q) ||
        String(bug.resolution).toLowerCase().includes(q) ||
        (bug.version && String(bug.version).toLowerCase().includes(q)) ||
        (bug.cycleList && String(bug.cycleList).toLowerCase().includes(q))
      );
    }).sort(sortBugsByCreatedDesc);

    const filteredPlanGeneralBugsList = planGeneralBugsList.filter(bug => {
      if (dashboardGeneralBugStatusTab === 'OPEN' && bug.isDone) return false;
      if (dashboardGeneralBugStatusTab === 'CLOSED' && !bug.isDone) return false;

      // Filter by interactive severity widget if selected
      if (selectedDashboardSeverityFilter) {
        const rank = getSevRank(bug.severity);
        if (selectedDashboardSeverityFilter === 'Bloqueante' && rank !== 1) return false;
        if (selectedDashboardSeverityFilter === 'Crítico' && rank !== 2) return false;
        if (selectedDashboardSeverityFilter === 'Mayor' && rank !== 3) return false;
        if (selectedDashboardSeverityFilter === 'Medio' && rank !== 4) return false;
        if (selectedDashboardSeverityFilter === 'Menor' && rank !== 5) return false;
        if (selectedDashboardSeverityFilter === 'Sin definir' && rank < 6) return false;
      }

      if (!dashboardGeneralBugSearch) return true;
      const q = dashboardGeneralBugSearch.toLowerCase().trim();
      return (
        bug.key.toLowerCase().includes(q) ||
        bug.summary.toLowerCase().includes(q) ||
        bug.assignee.toLowerCase().includes(q) ||
        String(bug.severity).toLowerCase().includes(q) ||
        String(bug.status).toLowerCase().includes(q) ||
        String(bug.resolution).toLowerCase().includes(q) ||
        (bug.version && String(bug.version).toLowerCase().includes(q)) ||
        (bug.cycleList && bug.cycleList.toLowerCase().includes(q))
      );
    }).sort(sortBugsByCreatedDesc);

    const filteredTraceabilityRows = traceabilityRows.filter(row => {
      if (!dashboardTraceabilitySearch) return true;
      const q = dashboardTraceabilitySearch.toLowerCase().trim();
      return (
        (row.planName && row.planName.toLowerCase().includes(q)) ||
        (row.cycleName && row.cycleName.toLowerCase().includes(q)) ||
        (row.epicKey && row.epicKey.toLowerCase().includes(q)) ||
        (row.epicSummary && row.epicSummary.toLowerCase().includes(q)) ||
        (row.requirementKey && row.requirementKey.toLowerCase().includes(q)) ||
        (row.requirementSummary && row.requirementSummary.toLowerCase().includes(q)) ||
        (row.requirementWorkflowStatus && row.requirementWorkflowStatus.toLowerCase().includes(q)) ||
        row.bugs.some(b => (b.key && b.key.toLowerCase().includes(q)) || (b.summary && b.summary.toLowerCase().includes(q)))
      );
    });

    const renderExecutiveReportModal = () => {
      if (!executiveReportModalOpen) return null;
      const previewRep = buildExecutiveReportData(executiveReportSubject, executiveReportNotes, executiveReportBuild);

      const getActiveReportHtml = () => {
        return executiveReportContainerRef.current ? executiveReportContainerRef.current.innerHTML : previewRep.htmlReport;
      };

      return (
        <div
          className="modal-overlay"
          style={{
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(9, 30, 66, 0.65)'
          }}
          onClick={() => setExecutiveReportModalOpen(false)}
        >
          <div
            className="modal-content glass"
            style={{
              width: '92%',
              maxWidth: '980px',
              height: '92vh',
              maxHeight: '920px',
              display: 'flex',
              flexDirection: 'column',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 12px 36px rgba(0, 45, 98, 0.25)',
              overflow: 'hidden'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 24px',
              borderBottom: '1px solid #E2E8F0',
              background: 'linear-gradient(135deg, #002D62 0%, #0C66E4 100%)',
              color: '#ffffff'
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff' }}>
                  <span>📧</span>
                  <span>Preparar y Enviar Reporte Ejecutivo</span>
                </h2>
                <div style={{ fontSize: '12px', color: '#DEEBFF', marginTop: '3px' }}>
                  Todo el contenido del reporte es editable en línea. Puedes hacer clic en cualquier texto o celda del reporte para modificarlo.
                </div>
              </div>
              <button
                onClick={() => setExecutiveReportModalOpen(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '18px',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Cerrar"
              >
                ✕
              </button>
            </div>

            {/* Modal Body: Editable Form & Live Preview */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#F8F9FA' }}>
              
              {/* Form Card */}
              <div style={{ background: '#ffffff', border: '1px solid #DFE1E6', borderRadius: '8px', padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#002D62', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.5px' }}>
                  ✏️ Configuración General y Alcance
                </div>
                
                {/* Asunto Input */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546F', marginBottom: '4px' }}>
                    Asunto del Correo:
                  </label>
                  <input
                    type="text"
                    value={executiveReportSubject}
                    onChange={e => setExecutiveReportSubject(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '13px',
                      border: '1px solid #C1C7D0',
                      borderRadius: '6px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    placeholder="Asunto del correo..."
                  />
                </div>

                {/* Build / Version Input */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546F', marginBottom: '4px' }}>
                    Versión / Build (de los ciclos seleccionados; puedes modificarla o dejarla en blanco):
                  </label>
                  <input
                    type="text"
                    value={executiveReportBuild}
                    onChange={e => setExecutiveReportBuild(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '13px',
                      border: '1px solid #C1C7D0',
                      borderRadius: '6px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    placeholder="Ej. E2E 3.72.12.15 o déjalo en blanco"
                  />
                </div>

                {/* Notas / Observaciones Textarea */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546F', marginBottom: '4px' }}>
                    Notas y Observaciones Ejecutivas (Opcional - aparecerán al inicio del reporte):
                  </label>
                  <textarea
                    rows={3}
                    value={executiveReportNotes}
                    onChange={e => setExecutiveReportNotes(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '13px',
                      border: '1px solid #C1C7D0',
                      borderRadius: '6px',
                      outline: 'none',
                      resize: 'vertical',
                      boxSizing: 'border-box'
                    }}
                    placeholder="Ej. Se concluyeron las pruebas de regresión en QA con 95% de éxito. El bloqueo en pagos fue solventado y verificado en build #104. Listo para liberación."
                  />
                </div>
              </div>

              {/* Live Preview Container with Direct WYSIWYG Editing */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#002D62', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      👁️ Vista Previa & Edición en Línea (WYSIWYG)
                    </span>
                    <span style={{ fontSize: '11px', color: '#0C66E4', background: '#E9F2FF', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
                      ✏️ Haz clic en cualquier parte del reporte para editar
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#006644', fontWeight: 600, background: '#E3FCEF', padding: '2px 8px', borderRadius: '10px' }}>
                    ✓ Sincronizado para PDF y Correo
                  </span>
                </div>
                <div style={{
                  background: '#ffffff',
                  border: '2px solid #0C66E4',
                  borderRadius: '8px',
                  padding: '16px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                }}>
                  <div
                    ref={(el) => {
                      executiveReportContainerRef.current = el;
                      if (el) applyCssomInlineStyles(el);
                    }}
                    contentEditable={true}
                    suppressContentEditableWarning={true}
                    style={{ outline: 'none', cursor: 'text' }}
                    dangerouslySetInnerHTML={{ __html: previewRep.htmlReport }}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 24px',
              borderTop: '1px solid #E2E8F0',
              background: '#ffffff'
            }}>
              <button
                className="btn-secondary"
                onClick={() => setExecutiveReportModalOpen(false)}
                style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '6px', cursor: 'pointer' }}
              >
                Cancelar
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  className="btn-secondary"
                  onClick={() => handlePrintPdf(getActiveReportHtml(), previewRep.emailSubject)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: '#F4F5F7',
                    border: '1px solid #DFE1E6'
                  }}
                >
                  🖨️ Guardar PDF
                </button>

                <button
                  className="btn-secondary"
                  onClick={async () => {
                    await copyReportHtmlToClipboard(getActiveReportHtml(), previewRep.plainText);
                    addNotification({
                      type: 'success',
                      title: '📋 Reporte Copiado',
                      description: 'El reporte editado está en tu portapapeles listo para pegar en tu correo.'
                    });
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: '#F4F5F7',
                    border: '1px solid #DFE1E6'
                  }}
                >
                  📋 Solo Copiar
                </button>

                <button
                  className="btn-primary"
                  onClick={async () => {
                    const htmlToExport = getActiveReportHtml();
                    await copyReportHtmlToClipboard(htmlToExport, previewRep.plainText);
                    handlePrintPdf(htmlToExport, previewRep.emailSubject);
                    const subjectEnc = encodeURIComponent(previewRep.emailSubject);
                    setTimeout(() => {
                      router.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subjectEnc}`);
                    }, 600);
                    addNotification({
                      type: 'success',
                      title: '🚀 Reporte listo para enviar',
                      description: 'Diálogo de PDF iniciado y reporte copiado al portapapeles. Pégalo en Gmail (Ctrl+V) y adjunta tu archivo PDF.'
                    });
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 18px',
                    fontSize: '13px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: 'linear-gradient(135deg, #E1007A 0%, #002D62 100%)',
                    boxShadow: '0 2px 6px rgba(225, 0, 122, 0.3)'
                  }}
                >
                  🚀 Guardar PDF, Copiar y Abrir Gmail
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="tab-layout" style={{ height: 'calc(100vh - 56px)', overflow: 'hidden', display: 'flex', flex: 1 }}>
        {/* ─── Dashboard Sidebar: Runs, Bugs, Traceability ─── */}
        {isFolderSidebarVisible && (
          <>
            <aside
              className="sidebar glass"
              style={{
                width: sidebarWidth,
                minWidth: '220px',
                maxWidth: '360px',
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden',
                backgroundColor: '#FAFBFC',
                borderRight: '1px solid var(--jira-border, #DCDFE4)'
              }}
            >
              {/* Header */}
              <div style={{ padding: '1rem 1.1rem 0.75rem 1.1rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '15px' }}>📊</span>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--jira-dark, #172B4D)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    REPORTS
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="ads-lozenge ads-lozenge-success" style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '9999px' }}>
                    LIVE
                  </span>
                  <button
                    onClick={toggleFolderSidebar}
                    title="Ocultar panel lateral (Sidebar)"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '3px',
                      borderRadius: '4px',
                      color: 'var(--jira-subtle, #626F86)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--jira-bg-subtle, #F1F2F4)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                      <path d="M15 15l-3-3 3-3" />
                    </svg>
                  </button>
                </div>
              </div>

          {/* Navigation Menu */}
          <div style={{ padding: '0.75rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* 1. Runs */}
            <div
              onClick={() => setDashboardSubView('runs')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: dashboardSubView === 'runs' ? 700 : 500,
                backgroundColor: dashboardSubView === 'runs' ? '#E9F2FF' : 'transparent',
                color: dashboardSubView === 'runs' ? '#0C66E4' : 'var(--jira-dark, #172B4D)',
                borderLeft: dashboardSubView === 'runs' ? '3px solid #0C66E4' : '3px solid transparent',
                transition: 'all 0.15s ease'
              }}
              title="Métricas de ejecución y avance de pruebas"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '15px' }}>📊</span>
                  <span>Runs</span>
                </div>
                <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px', fontWeight: 700 }}>
                  {totalCases}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--jira-subtle, #626F86)', paddingLeft: '23px', fontWeight: 500 }}>
                {filteredCycles.length} {filteredCycles.length === 1 ? 'ciclo' : 'ciclos'} · {totalCases} {totalCases === 1 ? 'ejecución' : 'ejecuciones'}
              </div>
            </div>

            {/* 2. Bugs */}
            <div
              onClick={() => setDashboardSubView('bugs')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: dashboardSubView === 'bugs' ? 700 : 500,
                backgroundColor: dashboardSubView === 'bugs' ? '#FFEBE6' : 'transparent',
                color: dashboardSubView === 'bugs' ? '#DE350B' : 'var(--jira-dark, #172B4D)',
                borderLeft: dashboardSubView === 'bugs' ? '3px solid #DE350B' : '3px solid transparent',
                transition: 'all 0.15s ease'
              }}
              title="Gestión de defectos vinculados a pruebas"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '15px' }}>🐞</span>
                  <span>Bugs</span>
                </div>
                <span className={`ads-lozenge ${openCycleBugs > 0 ? 'ads-lozenge-danger' : 'ads-lozenge-subtle'}`} style={{ fontSize: '10px', fontWeight: 700 }}>
                  {totalCycleBugs}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--jira-subtle, #626F86)', paddingLeft: '23px', fontWeight: 500 }}>
                {openCycleBugs} {openCycleBugs === 1 ? 'activo' : 'activos'} · {closedCycleBugs} {closedCycleBugs === 1 ? 'cerrado' : 'cerrados'}
              </div>
            </div>

            {/* 3. Traceability */}
            <div
              onClick={() => setDashboardSubView('traceability')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: dashboardSubView === 'traceability' ? 700 : 500,
                backgroundColor: dashboardSubView === 'traceability' ? '#E9F2FF' : 'transparent',
                color: dashboardSubView === 'traceability' ? '#0C66E4' : 'var(--jira-dark, #172B4D)',
                borderLeft: dashboardSubView === 'traceability' ? '3px solid #0C66E4' : '3px solid transparent',
                transition: 'all 0.15s ease'
              }}
              title="Matriz de trazabilidad y cobertura"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '15px' }}>🔗</span>
                  <span>Traceability</span>
                </div>
                <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px', fontWeight: 700 }}>
                  {consolidatedStoriesMap.size}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--jira-subtle, #626F86)', paddingLeft: '23px', fontWeight: 500 }}>
                {consolidatedEpicsMap.size} {consolidatedEpicsMap.size === 1 ? 'épica' : 'épicas'} · {consolidatedStoriesMap.size} {consolidatedStoriesMap.size === 1 ? 'historia' : 'historias'}
              </div>
            </div>
          </div>

          {/* Sidebar Footer */}
          <div style={{ marginTop: 'auto', padding: '0.85rem 1rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--jira-subtle, #626F86)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <span style={{ fontSize: '13px' }}>📁</span>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                {projects.find(p => String(p.id) === String(selectedProjectId))?.name || currentProjectKey}
              </span>
            </div>
            <span style={{ fontSize: '10px', background: '#EBECF0', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
              {currentProjectKey}
            </span>
          </div>
        </aside>

        {/* Resizer */}
        <div
          onMouseDown={() => setIsResizing(true)}
          style={{
            width: '5px',
            cursor: 'col-resize',
            backgroundColor: isResizing ? 'var(--jira-blue, #0C66E4)' : 'transparent',
            zIndex: 10,
            borderRight: '1px solid var(--jira-border, #DCDFE4)',
            marginLeft: '-1px'
          }}
        />
        </>
        )}

        {/* ─── Main Dashboard View Container ─── */}
        <main className="dashboard-container" style={{ flex: 1, height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: '1.5rem 2rem 6rem 2rem' }}>
          {/* Top Header & Toolbar */}
          <div className="dashboard-top-header">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {!isFolderSidebarVisible && (
                  <button
                    onClick={toggleFolderSidebar}
                    className="btn-secondary"
                    title="Mostrar panel lateral de Reports"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '0.78rem',
                      padding: '0.35rem 0.65rem',
                      borderRadius: '6px'
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                      <path d="M13 9l3 3-3 3" />
                    </svg>
                    <span>Reports</span>
                  </button>
                )}
                {!isFolderSidebarVisible && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', background: '#F1F2F4', padding: '2px', borderRadius: '6px', gap: '2px' }}>
                    <button
                      onClick={() => setDashboardSubView('runs')}
                      style={{
                        background: dashboardSubView === 'runs' ? '#FFFFFF' : 'transparent',
                        color: dashboardSubView === 'runs' ? '#0C66E4' : '#626F86',
                        fontWeight: dashboardSubView === 'runs' ? 700 : 500,
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        boxShadow: dashboardSubView === 'runs' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                      }}
                    >
                      📊 Runs
                    </button>
                    <button
                      onClick={() => setDashboardSubView('bugs')}
                      style={{
                        background: dashboardSubView === 'bugs' ? '#FFFFFF' : 'transparent',
                        color: dashboardSubView === 'bugs' ? '#DE350B' : '#626F86',
                        fontWeight: dashboardSubView === 'bugs' ? 700 : 500,
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        boxShadow: dashboardSubView === 'bugs' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                      }}
                    >
                      🐞 Bugs
                    </button>
                    <button
                      onClick={() => setDashboardSubView('traceability')}
                      style={{
                        background: dashboardSubView === 'traceability' ? '#FFFFFF' : 'transparent',
                        color: dashboardSubView === 'traceability' ? '#0C66E4' : '#626F86',
                        fontWeight: dashboardSubView === 'traceability' ? 700 : 500,
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        boxShadow: dashboardSubView === 'traceability' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                      }}
                    >
                      🔗 Traceability
                    </button>
                  </div>
                )}

                <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
                  {dashboardSubView === 'runs' && 'Consola de Ejecución & Control Multi-Ciclo'}
                  {dashboardSubView === 'bugs' && 'Reports: Tablero de Defectos y Fallos Críticos (Bugs)'}
                  {dashboardSubView === 'traceability' && 'Reports: Matriz de Trazabilidad (Traceability)'}
                </h1>

                <span className="dashboard-live-badge">
                  <span className="dashboard-live-dot" />
                  ● {isHydratingReport 
                      ? `Sincronizando histórico (${reportData?.cycles?.length || 0}/${reportData?.totalCycles || '...'})` 
                      : isRefreshingReport 
                        ? 'Sincronizando...' 
                        : `En vivo · ${reportData._loadedAt ? new Date(reportData._loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Auto-sync silencioso'}`}
                </span>

                {circuitBreakerActive && (
                  <span style={{ fontSize: '12px', color: '#FF8B00', fontWeight: 600 }}>
                    ⏸ Rate limit activo (3 min)
                  </span>
                )}
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {dashboardSubView === 'runs' && (
                  <button
                    onClick={() => setIsCustomizingDashboard(!isCustomizingDashboard)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      background: isCustomizingDashboard ? '#E9F2FF' : '#FFFFFF',
                      border: '1px solid',
                      borderColor: isCustomizingDashboard ? '#0C66E4' : 'var(--jira-border, #DCDFE4)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      color: isCustomizingDashboard ? '#0C66E4' : 'var(--jira-dark, #172B4D)',
                      fontSize: '12px',
                      fontWeight: 600
                    }}
                    title="Personalizar, reordenar y agregar widgets en el dashboard"
                  >
                    ⚙️ {isCustomizingDashboard ? 'Terminar Personalización' : 'Personalizar Widgets'}
                  </button>
                )}

                <button 
                  className="btn-secondary" 
                  onClick={() => {
                    if (reportData && Array.isArray(reportData.cycles) && reportData.cycles.length > 0) {
                      try {
                        const snapshotKey = `tp_report_snapshot_${selectedProjectId}`;
                        localStorage.setItem(snapshotKey, JSON.stringify({
                          reportData: { cycles: reportData.cycles, bugMap: reportData.bugMap || {}, totalCycles: reportData.totalCycles || reportData.cycles.length },
                          allCycleSummaries: testCycles || [],
                          timestamp: Date.now()
                        }));
                        addNotification({
                          type: 'success',
                          title: '📸 Snapshot Guardado',
                          description: 'Corte de métricas guardado exitosamente. La app estará protegida ante bloqueos de Jira durante las sesiones de estatus.'
                        });
                      } catch (e) {
                        addNotification({
                          type: 'error',
                          title: 'Error al guardar snapshot',
                          description: e.message
                        });
                      }
                    } else {
                      addNotification({
                        type: 'warning',
                        title: 'Sin datos para snapshot',
                        description: 'Espera a que carguen las métricas antes de guardar el snapshot.'
                      });
                    }
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '6px'
                  }}
                  title="Congelar snapshot local para las sesiones de estatus (12:30 / 5:00 PM)"
                >
                  📸 Guardar Snapshot
                </button>

                <button 
                  className="btn-primary" 
                  onClick={handleCopyReportToClipboard}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '6px'
                  }}
                  title="Copiar reporte ejecutivo HTML y redactar en Gmail"
                >
                  📧 Enviar Reporte Ejecutivo
                </button>
              </div>
            </div>

            {/* Amber Banner when Snapshot mode is active */}
            {reportData?._isSnapshot && (
              <div style={{
                background: '#FFF0B3',
                border: '1px solid #FFE380',
                borderLeft: '5px solid #FFAB00',
                color: '#172B4D',
                padding: '10px 16px',
                borderRadius: '6px',
                margin: '12px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>⚠️</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: '#172B4D' }}>
                      Modo Respaldo Activo (Jira con alta demanda / bloqueo temporal)
                    </div>
                    <div style={{ fontSize: '12px', color: '#44546F' }}>
                      Mostrando corte congelado de métricas capturado a las {new Date(reportData._snapshotTimestamp || reportData._loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Puedes exponer tus métricas con seguridad.
                    </div>
                  </div>
                </div>
                <button
                  className="btn-secondary"
                  onClick={() => loadReportData(selectedProjectId, projectConfig, false)}
                  style={{
                    padding: '5px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: '#002D62',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px'
                  }}
                >
                  🔄 Intentar en vivo
                </button>
              </div>
            )}

            {/* Filter Toolbar (Only shown for Traceability; Runs and Bugs automatically synchronize with the Runs Plan/Cycle selector) */}
            {dashboardSubView !== 'runs' && dashboardSubView !== 'bugs' && (
              <div className="dashboard-filter-toolbar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  {/* 1. Plan de Pruebas */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-subtle, #626F86)' }}>Plan de Pruebas:</span>
                    <details style={{ position: 'relative' }}>
                      <summary style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--jira-border, #DCDFE4)', background: '#FAFBFC', cursor: 'pointer', minWidth: '180px', fontSize: '12px', fontWeight: 600, color: 'var(--jira-dark, #172B4D)' }}>
                        {reportSelectedPlans.length === 0 ? "Todos los Planes" : `${reportSelectedPlans.length} Planes seleccionados`}
                      </summary>
                      <div style={{ position: 'absolute', top: '100%', left: 0, background: '#FFFFFF', border: '1px solid var(--jira-border, #DCDFE4)', zIndex: 100, padding: '0.6rem', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', minWidth: '220px', boxShadow: '0 4px 12px rgba(9,30,66,0.15)' }}>
                         <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                           <input type="checkbox" checked={reportSelectedPlans.length === 0} onChange={() => { setReportSelectedPlans([]); setReportSelectedCycles([]); }} /> Todos los Planes
                         </label>
                         {testPlans.map(p => {
                           const isSelected = reportSelectedPlans.some(pId => String(pId) === String(p.id));
                           return (
                             <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '12px' }}>
                               <input type="checkbox" checked={isSelected} onChange={(e) => {
                                 let newVals = isSelected 
                                   ? reportSelectedPlans.filter(v => String(v) !== String(p.id))
                                   : [...reportSelectedPlans, String(p.id)];
                                 setReportSelectedPlans(newVals);
                                 setReportSelectedCycles([]);
                               }} />
                               {p.summary}
                             </label>
                           );
                         })}
                      </div>
                    </details>
                  </div>

                  {/* 2. Ciclo de Pruebas */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-subtle, #626F86)' }}>Ciclo de Pruebas:</span>
                    <details style={{ position: 'relative' }}>
                      <summary style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--jira-border, #DCDFE4)', background: '#FAFBFC', cursor: 'pointer', minWidth: '180px', fontSize: '12px', fontWeight: 600, color: 'var(--jira-dark, #172B4D)' }}>
                        {reportSelectedCycles.length === 0 ? "Todos los Ciclos" : `${reportSelectedCycles.length} Ciclos seleccionados`}
                      </summary>
                      <div style={{ position: 'absolute', top: '100%', left: 0, background: '#FFFFFF', border: '1px solid var(--jira-border, #DCDFE4)', zIndex: 100, padding: '0.6rem', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', minWidth: '220px', boxShadow: '0 4px 12px rgba(9,30,66,0.15)' }}>
                         <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                           <input type="checkbox" checked={reportSelectedCycles.length === 0} onChange={() => { setReportSelectedCycles([]); }} /> Todos los Ciclos
                         </label>
                         {(() => {
                           const allCyclesList = (testCycles && testCycles.length > 0) ? testCycles : (reportData?.cycles || []);
                           const filteredForDropdown = reportSelectedPlans.length > 0
                             ? allCyclesList.filter(c => reportSelectedPlans.some(pId => String(pId) === String(c.planId)))
                             : allCyclesList;
                           return filteredForDropdown.map(c => {
                             const isSelected = reportSelectedCycles.some(rcId => String(rcId) === String(c.id));
                             return (
                               <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '12px' }}>
                                 <input type="checkbox" checked={isSelected} onChange={(e) => {
                                   let newVals = isSelected
                                     ? reportSelectedCycles.filter(v => String(v) !== String(c.id))
                                     : [...reportSelectedCycles, String(c.id)];
                                   setReportSelectedCycles(newVals);
                                 }} />
                                 {c.summary}
                               </label>
                             );
                           });
                         })()}
                      </div>
                    </details>
                  </div>

                  {/* 4. Ambiente */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-subtle, #626F86)' }}>Ambiente:</span>
                    <span style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--jira-border, #DCDFE4)', background: '#FAFBFC', fontSize: '12px', fontWeight: 600, color: 'var(--jira-dark, #172B4D)' }}>
                      {(() => {
                        const cyclesSource = Array.isArray(filteredCycles) && filteredCycles.length > 0
                          ? filteredCycles
                          : (Array.isArray(testCycles) ? testCycles : []);
                        const envSet = new Set(
                          cyclesSource
                            .map(c => c.schedule?.environment || c.environment)
                            .filter(Boolean)
                        );
                        return envSet.size > 0 ? Array.from(envSet).join(', ') : (availableEnvironments[0]?.name || 'QA');
                      })()}
                    </span>
                  </div>
                </div>

                {/* Sincronización */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--jira-subtle, #626F86)' }}>
                  <span>🕒</span>
                  <span>
                    {reportData._loadedAt
                      ? (Math.floor((Date.now() - reportData._loadedAt) / 60000) < 1
                          ? 'Sincronizado hace un momento'
                          : `Sincronizado hace ${Math.floor((Date.now() - reportData._loadedAt) / 60000)} min`)
                      : 'Sincronizado'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* ─── SUBVIEW 1: RUNS (CUSTOMIZABLE WIDGETS) ─── */}
          {/* ═══════════════════════════════════════════════════════ */}
          {dashboardSubView === 'runs' && (() => {
            // Compute Plan-level metrics across ALL cycles of the selected plan (planCycles)
            // so clicking individual cycles in the matrix does NOT change the Plan's overall health/progress
            const activePlanObj = reportSelectedPlans.length === 1
              ? testPlans.find(p => String(p.id) === String(reportSelectedPlans[0]))
              : null;

            const scopedPlans = reportSelectedPlans.length > 0
              ? testPlans.filter(p => reportSelectedPlans.some(sp => String(sp) === String(p.id) || String(sp) === String(p.key)))
              : (() => {
                  const cPlanIds = new Set(planCycles.map(c => String(c.planId || c.testPlanId || '')).filter(Boolean));
                  const matched = testPlans.filter(p =>
                    cPlanIds.has(String(p.id)) ||
                    cPlanIds.has(String(p.key)) ||
                    planCycles.some(c => isCycleInPlan(c, p.id))
                  );
                  if (matched.length > 0) return matched;
                  if (selectedPlanId) {
                    const selP = testPlans.find(p => String(p.id) === String(selectedPlanId));
                    if (selP) return [selP];
                  }
                  return testPlans;
                })();

            const getCycleStatsForHero = (c) => {
              const cachedCycleCases = perCycleCacheRef.current
                ? (perCycleCacheRef.current[String(c.id)] || perCycleCacheRef.current[c.id])
                : null;
              const execArr = Array.isArray(c.execution) && c.execution.length > 0
                ? c.execution
                : (Array.isArray(cachedCycleCases) && cachedCycleCases.length > 0
                  ? cachedCycleCases
                  : (Array.isArray(c.testCases) ? c.testCases : []));
              let cTotal = 0, cPass = 0, cFail = 0, cBlock = 0, cNotRun = 0;
              const bugKeysSet = new Set();
              if (execArr.length > 0) {
                const seenTc = new Set();
                execArr.forEach((ex, idx) => {
                  const tcKey = ex.key || ex.testCaseKey || (findTc(ex.id)?.key) || '';
                  const tcId = String(ex.id || ex.testCaseId || '');
                  const dedupeKey = tcKey ? `key_${tcKey}` : (tcId ? `id_${tcId}` : `item_${idx}`);
                  if (seenTc.has(dedupeKey)) return;
                  seenTc.add(dedupeKey);
                  cTotal++;
                  const st = String(normalizeUiStatus(ex.status) || '').toUpperCase();
                  if (st === 'PASSED') cPass++;
                  else if (st === 'FAILED') cFail++;
                  else if (st === 'BLOCKED') cBlock++;
                  else cNotRun++;
                  const bugsArr = ex.linkedBugs || ex.defects || ex.bugs || [];
                  if (Array.isArray(bugsArr)) {
                    bugsArr.forEach(b => {
                      const bKey = typeof b === 'string' ? b : (b?.key || b?.id);
                      if (bKey) bugKeysSet.add(String(bKey));
                    });
                  }
                });
              } else {
                const em = c.executionMeta || {};
                cTotal = Number(em.total ?? c.testCount ?? c.totalCases ?? c.testCasesCount ?? 0);
                cPass = Number(em.passed ?? c.passed ?? 0);
                cFail = Number(em.failed ?? c.failed ?? 0);
                cBlock = Number(em.blocked ?? c.blocked ?? 0);
                cNotRun = Math.max(0, cTotal - (cPass + cFail + cBlock));
              }
              const cBugs = bugKeysSet.size;
              const cEval = cPass + cFail + cBlock;
              const cPct = cTotal > 0 ? Math.round((cEval / cTotal) * 100) : 0;
              const passW = cTotal > 0 ? (cPass / cTotal) * 100 : 0;
              const failW = cTotal > 0 ? (cFail / cTotal) * 100 : 0;
              const blockW = cTotal > 0 ? (cBlock / cTotal) * 100 : 0;

              let cStatusKey = 'PENDING';
              if (cTotal > 0 && cEval === cTotal) cStatusKey = 'COMPLETED';
              else if (String(c.status || '').toUpperCase().includes('PAUS') || (cBlock > 0 && cPass + cFail === 0)) cStatusKey = 'PAUSED';
              else if (cEval > 0 || String(c.status || '').toUpperCase().includes('CURSO') || String(c.status || '').toUpperCase().includes('ACTIVE')) cStatusKey = 'IN_PROGRESS';

              return {
                cTotal, cPass, cFail, cBlock, cNotRun, cEval, cPct,
                passW, failW, blockW, cBugs, cStatusKey
              };
            };

            const nowD = new Date();
            const todayIso = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`;

            let planTotalCases = 0, planPass = 0, planFail = 0, planBlock = 0;
            let planCompletedCyclesCount = 0, planActiveCyclesCount = 0, planPendingCyclesCount = 0;
            let cycleMinStartMs = null, cycleMaxEndMs = null;
            let completedCycleMaxEndMs = null;
            let overdueIncompleteCyclesCount = 0;

            planCycles.forEach(c => {
              const st = getCycleStatsForHero(c);
              planTotalCases += st.cTotal;
              planPass += st.cPass;
              planFail += st.cFail;
              planBlock += st.cBlock;
              if (st.cStatusKey === 'COMPLETED') planCompletedCyclesCount++;
              else if (st.cStatusKey === 'IN_PROGRESS') planActiveCyclesCount++;
              else planPendingCyclesCount++;

              const cSched = c.schedule?.value || c.schedule || {};
              const sDate = cSched.startDate || c.startDate || c.plannedStartDate;
              const eDate = cSched.endDate || c.endDate || c.plannedEndDate;
              if (sDate) {
                const ms = new Date(sDate).getTime();
                if (!isNaN(ms) && (cycleMinStartMs === null || ms < cycleMinStartMs)) cycleMinStartMs = ms;
              }
              if (eDate) {
                const ms = new Date(eDate).getTime();
                if (!isNaN(ms)) {
                  if (cycleMaxEndMs === null || ms > cycleMaxEndMs) cycleMaxEndMs = ms;
                  if (st.cStatusKey === 'COMPLETED' && (completedCycleMaxEndMs === null || ms > completedCycleMaxEndMs)) {
                    completedCycleMaxEndMs = ms;
                  }
                  const cEndIso = new Date(ms).toISOString().slice(0, 10);
                  if (st.cStatusKey !== 'COMPLETED' && cEndIso < todayIso) {
                    overdueIncompleteCyclesCount++;
                  }
                }
              }
            });

            let planStartMs = null, planEndMs = null;
            let planExcludeWeekends = true;
            let planHolidays = [];
            scopedPlans.forEach(p => {
              const isSelectedInPlanning = selectedPlanId && String(p.id) === String(selectedPlanId);
              const rawPSched = p.schedule?.value || p.schedule;
              const pSched = (rawPSched && (rawPSched.startDate || rawPSched.endDate))
                ? rawPSched
                : ((isSelectedInPlanning ? planScheduleForm : null) || rawPSched || {});
              const pS = pSched.startDate || p.startDate || p.plannedStartDate || (isSelectedInPlanning ? planScheduleForm?.startDate : null);
              const pE = pSched.endDate || p.endDate || p.plannedEndDate || (isSelectedInPlanning ? planScheduleForm?.endDate : null);
              if (pS) {
                const ms = new Date(pS).getTime();
                if (!isNaN(ms) && (planStartMs === null || ms < planStartMs)) planStartMs = ms;
              }
              if (pE) {
                const ms = new Date(pE).getTime();
                if (!isNaN(ms) && (planEndMs === null || ms < planEndMs)) planEndMs = ms;
              }
              if (pSched.excludeWeekends !== undefined) {
                planExcludeWeekends = pSched.excludeWeekends !== false;
              }
              if (Array.isArray(pSched.holidays) && pSched.holidays.length > 0) {
                planHolidays = pSched.holidays;
              }
            });
            if (planStartMs === null && planScheduleForm?.startDate) {
              const ms = new Date(planScheduleForm.startDate).getTime();
              if (!isNaN(ms)) planStartMs = ms;
            }
            if (planEndMs === null && planScheduleForm?.endDate) {
              const ms = new Date(planScheduleForm.endDate).getTime();
              if (!isNaN(ms)) planEndMs = ms;
            }

            const planEvalCount = planPass + planFail + planBlock;
            const planProgressPct = planTotalCases > 0 ? Math.round((planEvalCount / planTotalCases) * 100) : 0;
            const planPassW = planTotalCases > 0 ? (planPass / planTotalCases) * 100 : 0;
            const planFailW = planTotalCases > 0 ? (planFail / planTotalCases) * 100 : 0;
            const planBlockW = planTotalCases > 0 ? (planBlock / planTotalCases) * 100 : 0;

            const planStartIso = planStartMs ? new Date(planStartMs).toISOString().slice(0, 10) : null;
            const planEndIso = planEndMs ? new Date(planEndMs).toISOString().slice(0, 10) : null;
            const cycleMinStartIso = cycleMinStartMs ? new Date(cycleMinStartMs).toISOString().slice(0, 10) : null;
            const cycleMaxEndIso = cycleMaxEndMs ? new Date(cycleMaxEndMs).toISOString().slice(0, 10) : null;
            const completedCycleMaxEndIso = completedCycleMaxEndMs ? new Date(completedCycleMaxEndMs).toISOString().slice(0, 10) : null;

            const effectivePlanEndIso = (planEndIso && (!cycleMaxEndIso || planEndIso < cycleMaxEndIso))
              ? planEndIso
              : ((completedCycleMaxEndIso && cycleMaxEndIso && completedCycleMaxEndIso < cycleMaxEndIso && planCompletedCyclesCount > 0)
                ? completedCycleMaxEndIso
                : (planEndIso || cycleMaxEndIso));

            const startIso = planStartIso || cycleMinStartIso;
            const endIso = effectivePlanEndIso || cycleMaxEndIso;
            const hasCycleOverrun = Boolean(endIso && cycleMaxEndIso && cycleMaxEndIso > endIso);
            const extraCyclesAfterPlanEnd = endIso
              ? planCycles.filter(c => {
                  const cSched = c.schedule?.value || c.schedule || {};
                  const ce = cSched.endDate || c.endDate || c.plannedEndDate;
                  const cs = cSched.startDate || c.startDate || c.plannedStartDate;
                  return (ce && ce > endIso) || (cs && cs > endIso);
                }).length
              : 0;

            const planDaysObj = (startIso && endIso)
              ? calcScheduleDays(startIso, endIso, planExcludeWeekends, planHolidays)
              : { businessDays: 0 };
            const planTotalBizDays = Number(planDaysObj?.businessDays || 0);
            let planElapsedBizDays = 0;
            if (startIso && endIso && planTotalBizDays > 0) {
              if (todayIso <= startIso) {
                planElapsedBizDays = todayIso === startIso ? 1 : 0;
              } else if (todayIso >= endIso) {
                planElapsedBizDays = planTotalBizDays;
              } else {
                planElapsedBizDays = Number(calcScheduleDays(startIso, todayIso, planExcludeWeekends, planHolidays)?.businessDays || 0);
              }
            }
            const isPastPlanEnd = Boolean(endIso && todayIso > endIso);
            const isPlanOverdue = Boolean(
              (isPastPlanEnd && (planEvalCount < planTotalCases || hasCycleOverrun)) ||
              overdueIncompleteCyclesCount > 0
            );

            let planHealthLabel = 'ÓPTIMO';
            let planHealthBg = '#ECFDF5';
            let planHealthText = '#047857';
            let planHealthBorder = '#A7F3D0';
            let planSlackText = 'En tiempo';
            let planBurnSubtext = `${planEvalCount} de ${planTotalCases} casos evaluados`;

            if (planTotalCases > 0 && planEvalCount === planTotalCases && !hasCycleOverrun && !isPastPlanEnd) {
              planHealthLabel = 'COMPLETADO';
              planSlackText = '100% finalizado';
            } else if (planTotalBizDays > 0) {
              const elapsedDays = Math.max(1, planElapsedBizDays);
              const actualPerDay = Number((planEvalCount / elapsedDays).toFixed(1));
              const targetPerDay = Number((planTotalCases / Math.max(1, planTotalBizDays)).toFixed(1));
              const planExecPctVal = planTotalCases > 0 ? (planEvalCount / planTotalCases) * 100 : 0;
              const planElapsedPctVal = (planElapsedBizDays / planTotalBizDays) * 100;
              const slackDays = Number((((planExecPctVal - planElapsedPctVal) / 100) * planTotalBizDays).toFixed(1));
              planBurnSubtext = extraCyclesAfterPlanEnd > 0
                ? `+${extraCyclesAfterPlanEnd} ${extraCyclesAfterPlanEnd === 1 ? 'ciclo extra' : 'ciclos extra'} tras ${formatShortDateEs(endIso)} · Ritmo: ${actualPerDay}/día vs ${targetPerDay} meta`
                : `Ritmo de ejecución: ${actualPerDay} casos/día vs ${targetPerDay} meta`;
              if (isPlanOverdue) {
                planHealthLabel = 'RETRASADO';
                planHealthBg = '#FFF1F2';
                planHealthText = '#BE123C';
                planHealthBorder = '#FECDD3';
                planSlackText = hasCycleOverrun
                  ? `Debió cerrar ${formatShortDateEs(endIso)} (Ext. ${formatShortDateEs(cycleMaxEndIso)})`
                  : `Plazo vencido (${formatShortDateEs(endIso)})`;
              } else if (hasCycleOverrun) {
                planHealthLabel = (planTotalCases > 0 && planEvalCount === planTotalCases) ? 'CERRADO CON RETRASO' : 'EN RIESGO';
                planHealthBg = '#FFFBEB';
                planHealthText = '#B45309';
                planHealthBorder = '#FDE68A';
                planSlackText = `Desfase: ${formatShortDateEs(endIso)} → ${formatShortDateEs(cycleMaxEndIso)}`;
              } else if (slackDays < 0 || planFail + planBlock > planTotalCases * 0.25) {
                planHealthLabel = 'EN RIESGO';
                planHealthBg = '#FFFBEB';
                planHealthText = '#B45309';
                planHealthBorder = '#FDE68A';
                planSlackText = `Holgura: ${slackDays >= 0 ? `+${slackDays}` : slackDays} días`;
              } else {
                planSlackText = `Holgura: +${slackDays} días`;
              }
            } else if (planEvalCount === 0) {
              planHealthLabel = 'PENDIENTE';
              planHealthBg = '#F1F5F9';
              planHealthText = '#475569';
              planHealthBorder = '#E2E8F0';
              planSlackText = 'Sin iniciar';
            }

            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* ═════════════════════════════════════════════════════════════════════════ */}
              {/* SECTION 1: MASTER TEST PLAN SELECTOR & HORIZONTAL CYCLE DRILL-DOWN HERO */}
              {/* ═════════════════════════════════════════════════════════════════════════ */}
              <div style={{
                background: '#FFFFFF',
                borderRadius: '12px',
                border: '1px solid #E2E8F0',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                overflow: ' visible'
              }}>
                {/* Top Row: Active Test Plan Selector & Plan-Level Health */}
                <div style={{
                  padding: '20px',
                  background: 'linear-gradient(90deg, #F8FAFC 0%, #FFFFFF 50%, #F8FAFC 100%)',
                  borderBottom: '1px solid #E2E8F0',
                  borderTopLeftRadius: '12px',
                  borderTopRightRadius: '12px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px'
                }}>
                  {/* Left: Plan Selector Dropdown */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flex: '1 1 320px', position: 'relative' }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, #2563EB 0%, #1E40AF 100%)',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)',
                      flexShrink: 0
                    }}>
                      <svg style={{ width: '24px', height: '24px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#2563EB' }}>
                          TEST PLAN ACTIVO (NIVEL MAESTRO)
                        </span>
                        <span style={{ color: '#CBD5E1' }}>•</span>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          fontSize: '10px',
                          fontWeight: 700,
                          background: planEvalCount === planTotalCases && planTotalCases > 0 ? '#ECFDF5' : '#EFF6FF',
                          color: planEvalCount === planTotalCases && planTotalCases > 0 ? '#047857' : '#1D4ED8',
                          border: `1px solid ${planEvalCount === planTotalCases && planTotalCases > 0 ? '#A7F3D0' : '#BFDBFE'}`
                        }}>
                          <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '9999px',
                            background: planEvalCount === planTotalCases && planTotalCases > 0 ? '#10B981' : '#2563EB'
                          }} />
                          {planEvalCount === planTotalCases && planTotalCases > 0 ? 'COMPLETADO' : 'EN EJECUCIÓN'}
                        </span>
                        {(startIso || endIso || hasCycleOverrun) && (
                          <>
                            <span style={{ color: '#CBD5E1' }}>•</span>
                            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>
                              {(startIso || endIso) && (
                                <>({startIso ? formatShortDateEs(startIso) : '—'} – {endIso ? formatShortDateEs(endIso) : '—'})</>
                              )}
                              {hasCycleOverrun && (
                                <span style={{ color: '#BE123C', fontWeight: 700, marginLeft: (startIso || endIso) ? '4px' : 0 }}>
                                  {(startIso || endIso) ? '· ' : ''}Ext. {formatShortDateEs(cycleMaxEndIso)}{extraCyclesAfterPlanEnd > 0 ? ` (+${extraCyclesAfterPlanEnd} ${extraCyclesAfterPlanEnd === 1 ? 'ciclo' : 'ciclos'})` : ''}
                                </span>
                              )}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Interactive Plan Selector Button */}
                      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
                        <button
                          type="button"
                          onClick={() => setRunsPlanDropdownOpen(prev => !prev)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '10px',
                            background: 'transparent',
                            border: 'none',
                            padding: '2px 0',
                            cursor: 'pointer',
                            textAlign: 'left',
                            color: '#0F172A'
                          }}
                        >
                          <span style={{ fontSize: '16px', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.01em' }}>
                            {activePlanObj
                              ? activePlanObj.summary
                              : reportSelectedPlans.length > 1
                                ? `${reportSelectedPlans.length} Planes de Prueba Seleccionados`
                                : 'Todos los Planes de Prueba (Consolidado)'}
                          </span>
                          <span style={{
                            padding: '4px',
                            borderRadius: '6px',
                            background: runsPlanDropdownOpen ? '#EFF6FF' : '#F1F5F9',
                            color: runsPlanDropdownOpen ? '#2563EB' : '#475569',
                            border: '1px solid #CBD5E1',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'transform 0.2s ease',
                            transform: runsPlanDropdownOpen ? 'rotate(180deg)' : 'none'
                          }}>
                            <svg style={{ width: '16px', height: '16px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                          </span>
                        </button>

                        {runsPlanDropdownOpen && (
                          <div style={{
                            position: 'absolute',
                            top: 'calc(100% + 6px)',
                            left: 0,
                            minWidth: '340px',
                            maxWidth: '460px',
                            maxHeight: '320px',
                            overflowY: 'auto',
                            background: '#FFFFFF',
                            border: '1px solid #E2E8F0',
                            borderRadius: '10px',
                            boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.15)',
                            zIndex: 120,
                            padding: '6px'
                          }}>
                            <div style={{ padding: '6px 10px', fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #F1F5F9', marginBottom: '4px' }}>
                              Seleccionar Test Plan Maestro
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setReportSelectedPlans([]);
                                setReportSelectedCycles([]);
                                setRunsPlanDropdownOpen(false);
                              }}
                              style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '10px',
                                padding: '8px 10px',
                                borderRadius: '8px',
                                border: 'none',
                                background: reportSelectedPlans.length === 0 ? '#EFF6FF' : 'transparent',
                                color: reportSelectedPlans.length === 0 ? '#1D4ED8' : '#1E293B',
                                fontWeight: reportSelectedPlans.length === 0 ? 700 : 600,
                                fontSize: '12px',
                                cursor: 'pointer',
                                textAlign: 'left'
                              }}
                            >
                              <span>Todos los Planes de Prueba (Consolidado)</span>
                              <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>
                                {testPlans.length} planes
                              </span>
                            </button>
                            {testPlans.map(p => {
                              const isSelected = reportSelectedPlans.length === 1 && String(reportSelectedPlans[0]) === String(p.id);
                              const allCyclesList = (testCycles && testCycles.length > 0) ? testCycles : (reportData?.cycles || []);
                              const pCyclesCount = allCyclesList.filter(c => String(c.planId) === String(p.id)).length;
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => {
                                    setReportSelectedPlans([String(p.id)]);
                                    setReportSelectedCycles([]);
                                    setRunsPlanDropdownOpen(false);
                                  }}
                                  style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '10px',
                                    padding: '8px 10px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: isSelected ? '#EFF6FF' : 'transparent',
                                    color: isSelected ? '#1D4ED8' : '#1E293B',
                                    fontWeight: isSelected ? 700 : 500,
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    textAlign: 'left'
                                  }}
                                >
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.summary}</span>
                                  <span style={{ fontSize: '11px', color: '#64748B', flexShrink: 0 }}>
                                    {pCyclesCount} {pCyclesCount === 1 ? 'ciclo' : 'ciclos'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Plan-Level Global Progress & Schedule Health */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '20px' }}>
                    {/* Plan Progress */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>PROGRESO GLOBAL DEL PLAN</span>
                        <span style={{ fontWeight: 800, color: '#0F172A', fontSize: '14px' }}>{planProgressPct}%</span>
                      </div>
                      <div style={{ width: '100%', height: '8px', background: '#E2E8F0', borderRadius: '9999px', overflow: 'hidden', display: 'flex' }}>
                        <div style={{ width: `${planPassW}%`, height: '100%', background: '#10B981' }} title={`Passed: ${planPass}`} />
                        <div style={{ width: `${planFailW}%`, height: '100%', background: '#F43F5E' }} title={`Failed: ${planFail}`} />
                        <div style={{ width: `${planBlockW}%`, height: '100%', background: '#F59E0B' }} title={`Blocked: ${planBlock}`} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: '#64748B', fontWeight: 500 }}>
                        <span>{planEvalCount} / {planTotalCases} casos evaluados en {planCycles.length} {planCycles.length === 1 ? 'ciclo' : 'ciclos'}</span>
                      </div>
                    </div>

                    <div style={{ height: '40px', width: '1px', background: '#E2E8F0' }} />

                    {/* Schedule & Slack */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>SALUD DE CRONOGRAMA</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: planHealthBg,
                          color: planHealthText,
                          border: `1px solid ${planHealthBorder}`
                        }}>
                          {planHealthLabel === 'ÓPTIMO' || planHealthLabel === 'COMPLETADO' ? '✓' : '⚠'} {planHealthLabel}
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>{planSlackText}</span>
                      </div>
                      <span style={{ fontSize: '10px', color: '#64748B' }}>{planBurnSubtext}</span>
                    </div>
                  </div>
                </div>

                {/* Bottom Row: Horizontal Interactive Cycle Carousel (Single Row: Newest -> Oldest) */}
                <div style={{ padding: '12px 20px 14px 20px', background: 'rgba(248, 250, 252, 0.6)', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
                  {planCycles.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: '#64748B', fontSize: '13px' }}>
                      No hay ciclos de prueba registrados para este Test Plan.
                    </div>
                  ) : (
                    <div>
                      {/* Carousel Header & Navigation Controls */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '8px',
                        flexWrap: 'wrap',
                        gap: '8px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#475569' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            background: '#EFF6FF',
                            color: '#1D4ED8',
                            fontWeight: 700,
                            border: '1px solid #BFDBFE'
                          }}>
                            ← Más reciente a más antiguo →
                          </span>
                          <span style={{ color: '#64748B', fontWeight: 500 }}>
                            {planCycles.length} {planCycles.length === 1 ? 'ciclo en este plan' : 'ciclos en este plan'} · Pasa el cursor sobre los ciclos para ver el detalle o desliza horizontalmente
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (runsCycleCarouselRef.current) {
                                runsCycleCarouselRef.current.scrollTo({ left: 0, behavior: 'smooth' });
                              }
                            }}
                            title="Ir al ciclo más reciente (inicio)"
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: '#334155',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            ⏮ Más reciente
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (runsCycleCarouselRef.current) {
                                runsCycleCarouselRef.current.scrollBy({ left: -700, behavior: 'smooth' });
                              }
                            }}
                            title="Desplazar hacia la izquierda (más recientes)"
                            style={{
                              width: '28px',
                              height: '26px',
                              borderRadius: '6px',
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: '#0F172A',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            ◀
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (runsCycleCarouselRef.current) {
                                runsCycleCarouselRef.current.scrollBy({ left: 700, behavior: 'smooth' });
                              }
                            }}
                            title="Desplazar hacia la derecha (más antiguos)"
                            style={{
                              width: '28px',
                              height: '26px',
                              borderRadius: '6px',
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: '#0F172A',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            ▶
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (runsCycleCarouselRef.current) {
                                runsCycleCarouselRef.current.scrollTo({
                                  left: runsCycleCarouselRef.current.scrollWidth,
                                  behavior: 'smooth'
                                });
                              }
                            }}
                            title="Ir al ciclo más antiguo (final)"
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: '#334155',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            Más antiguo ⏭
                          </button>
                        </div>
                      </div>

                      {/* Single-Row Horizontal Carousel Track */}
                      <div className="runs-cycle-carousel-zone" style={{ position: 'relative' }}>
                        <div
                          ref={runsCycleCarouselRef}
                          style={{
                            display: 'flex',
                            flexWrap: 'nowrap',
                            gap: '12px',
                            overflowX: 'auto',
                            scrollBehavior: 'smooth',
                            padding: '2px 2px 8px 2px',
                            scrollbarWidth: 'thin'
                          }}
                        >
                          {planCycles.map((c, cIdx) => {
                            const st = getCycleStatsForHero(c);
                            const isExplicitlySelected = reportSelectedCycles.some(rcId => String(rcId) === String(c.id));
                            const isSelected = reportSelectedCycles.length === 0 || isExplicitlySelected;

                            let statusBadgeBg = '#F1F5F9', statusBadgeColor = '#475569', statusBadgeLabel = 'PENDIENTE';
                            if (st.cStatusKey === 'COMPLETED') {
                              statusBadgeBg = '#ECFDF5';
                              statusBadgeColor = '#047857';
                              statusBadgeLabel = 'COMPLETADO';
                            } else if (st.cStatusKey === 'IN_PROGRESS') {
                              statusBadgeBg = '#EFF6FF';
                              statusBadgeColor = '#1D4ED8';
                              statusBadgeLabel = 'EN CURSO';
                            } else if (st.cStatusKey === 'PAUSED') {
                              statusBadgeBg = '#FFFBEB';
                              statusBadgeColor = '#B45309';
                              statusBadgeLabel = 'PAUSADO';
                            }

                            const cycleEnvLabel = c.schedule?.environment || c.environment || availableEnvironments[0]?.name || 'QA';
                            const sDate = c.startDate || c.plannedStartDate;
                            const eDate = c.endDate || c.plannedEndDate;
                            const dateRangeLabel = (sDate || eDate)
                              ? `${sDate ? formatShortDateEs(sDate) : '—'} - ${eDate ? formatShortDateEs(eDate) : '—'}`
                              : `Ambiente ${cycleEnvLabel}`;

                            return (
                              <div
                                key={c.id}
                                className="runs-cycle-card"
                                onClick={() => {
                                  if (reportSelectedCycles.length === 0) {
                                    // First click focuses on this specific cycle
                                    setReportSelectedCycles([String(c.id)]);
                                  } else if (isExplicitlySelected) {
                                    const next = reportSelectedCycles.filter(rcId => String(rcId) !== String(c.id));
                                    setReportSelectedCycles(next);
                                  } else {
                                    setReportSelectedCycles([...reportSelectedCycles, String(c.id)]);
                                  }
                                }}
                                style={{
                                  flex: '0 0 225px',
                                  minWidth: '225px',
                                  maxWidth: '225px',
                                  position: 'relative',
                                  borderRadius: '12px',
                                  border: isSelected ? '2px solid #2563EB' : '1px solid #CBD5E1',
                                  background: isSelected ? '#FFFFFF' : '#F1F5F9',
                                  boxShadow: isSelected ? '0 2px 6px rgba(37, 99, 235, 0.08)' : 'none',
                                  opacity: isSelected ? 1 : 0.45,
                                  filter: isSelected ? 'none' : 'grayscale(100%)',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'space-between',
                                  boxSizing: 'border-box'
                                }}
                              >
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '4px',
                                        background: isSelected ? '#2563EB' : '#FFFFFF',
                                        border: isSelected ? 'none' : '1px solid #CBD5E1',
                                        color: '#FFFFFF',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                      }}>
                                        {isSelected && (
                                          <svg style={{ width: '10px', height: '10px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                          </svg>
                                        )}
                                      </span>
                                      {cIdx === 0 && (
                                        <span style={{
                                          fontSize: '9px',
                                          fontWeight: 700,
                                          color: '#2563EB',
                                          background: '#EFF6FF',
                                          padding: '1px 5px',
                                          borderRadius: '4px'
                                        }}>
                                          NUEVO
                                        </span>
                                      )}
                                    </div>
                                    <span style={{
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      fontSize: '9px',
                                      fontWeight: 700,
                                      background: statusBadgeBg,
                                      color: statusBadgeColor,
                                      border: st.cStatusKey === 'IN_PROGRESS' ? '1px solid #BFDBFE' : st.cStatusKey === 'PAUSED' ? '1px solid #FDE68A' : 'none',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}>
                                      {st.cStatusKey === 'IN_PROGRESS' && (
                                        <span style={{ width: '6px', height: '6px', borderRadius: '9999px', background: '#2563EB' }} />
                                      )}
                                      {statusBadgeLabel}
                                    </span>
                                  </div>
                                  <div
                                    title={c.summary}
                                    style={{
                                      fontSize: '12px',
                                      fontWeight: 700,
                                      color: '#0F172A',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis'
                                    }}
                                  >
                                    {c.summary}
                                  </div>
                                </div>

                                <div className="runs-cycle-card-collapsible">
                                  <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px', marginBottom: '10px' }}>
                                    {cycleEnvLabel} · {dateRangeLabel}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', marginBottom: '4px' }}>
                                    <span style={{
                                      fontWeight: 600,
                                      color: st.cStatusKey === 'IN_PROGRESS' ? '#1D4ED8' : st.cStatusKey === 'PAUSED' ? '#B45309' : '#475569'
                                    }}>
                                      {st.cStatusKey === 'IN_PROGRESS' ? 'En Ejecución' : st.cStatusKey === 'PAUSED' ? 'Detenido' : 'Progreso'}
                                    </span>
                                    <span style={{ fontWeight: 800, color: '#0F172A' }}>
                                      {st.cPct}% ({st.cEval}/{st.cTotal})
                                    </span>
                                  </div>
                                  <div style={{ width: '100%', height: '6px', background: '#F1F5F9', borderRadius: '9999px', overflow: 'hidden', display: 'flex', marginBottom: '8px' }}>
                                    <div style={{ width: `${st.passW}%`, height: '100%', background: '#10B981' }} />
                                    <div style={{ width: `${st.failW}%`, height: '100%', background: '#F43F5E' }} />
                                    <div style={{ width: `${st.blockW}%`, height: '100%', background: '#F59E0B' }} />
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', paddingTop: '6px', borderTop: '1px solid #F1F5F9' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ color: '#047857', fontWeight: 700 }}>✓ {st.cPass}</span>
                                      <span style={{ color: st.cFail > 0 ? '#BE123C' : '#94A3B8', fontWeight: 700 }}>✕ {st.cFail}</span>
                                      <span style={{ color: st.cBlock > 0 ? '#B45309' : '#94A3B8', fontWeight: 700 }}>⊘ {st.cBlock}</span>
                                    </div>
                                    <span style={{
                                      color: st.cBugs > 0 ? '#BE123C' : '#64748B',
                                      fontWeight: st.cBugs > 0 ? 700 : 600,
                                      background: st.cBugs > 0 ? '#FFF1F2' : 'transparent',
                                      padding: st.cBugs > 0 ? '1px 6px' : 0,
                                      borderRadius: '4px'
                                    }}>
                                      {st.cBugs > 0 ? `🐞 ${st.cBugs} Bugs` : 'Sin Bugs'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Active Selection Summary Bar */}
                  <div style={{
                    marginTop: '10px',
                    paddingTop: '10px',
                    borderTop: '1px solid rgba(226, 232, 240, 0.8)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    fontSize: '12px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: '#334155', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <svg style={{ width: '16px', height: '16px', color: '#2563EB' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Mostrando métricas consolidadas de:
                      </span>
                      {filteredCycles.slice(0, 4).map(fc => (
                        <span
                          key={fc.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            background: '#EFF6FF',
                            color: '#1D4ED8',
                            fontWeight: 700,
                            border: '1px solid #BFDBFE',
                            fontSize: '11px'
                          }}
                        >
                          {fc.summary}
                          {reportSelectedCycles.length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReportSelectedCycles(reportSelectedCycles.filter(rcId => String(rcId) !== String(fc.id)));
                              }}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#2563EB',
                                cursor: 'pointer',
                                fontWeight: 800,
                                padding: 0,
                                lineHeight: 1
                              }}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {filteredCycles.length > 4 && (
                        <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>
                          +{filteredCycles.length - 4} más
                        </span>
                      )}
                      {reportSelectedCycles.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setReportSelectedCycles([])}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#2563EB',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            textDecoration: 'underline'
                          }}
                        >
                          Ver todos ({planCycles.length})
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#475569', fontWeight: 500 }}>
                      <span>
                        Total Casos en Selección: <strong style={{ color: '#0F172A' }}>{allTotal} casos</strong> ({passed} Passed · {failed} Failed · {blocked} Blocked · {notRun} Not Run)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Customizer Mode Banner */}
              {isCustomizingDashboard && (
                <div className="dashboard-customizer-banner">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>🎨</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--jira-dark, #172B4D)' }}>
                        Modo de Personalización del Tablero
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)' }}>
                        Arrastra las tarjetas para reordenarlas (o usa ◀ ▶). Cambia su ancho (50% / 100%) u ocúltalas (✕).
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      className="btn-primary"
                      onClick={() => setShowAddWidgetModal(true)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', fontSize: '12px' }}
                    >
                      ➕ Agregar Widget
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={handleResetDashboardLayout}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', fontSize: '12px' }}
                      title="Restablecer disposición original"
                    >
                      ↺ Restablecer
                    </button>
                    <button
                      onClick={() => {
                        setIsCustomizingDashboard(false);
                        handleSaveDashboardLayout(dashboardWidgets);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 14px',
                        fontSize: '12px',
                        fontWeight: 700,
                        background: '#006644',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                    >
                      ✓ Guardar y Salir
                    </button>
                  </div>
                </div>
              )}

            {/* ⚠️ Defectos de Jira sin vincular a pruebas Banner */}
            {projectUnlinkedBugs.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  backgroundColor: '#FFF0ED',
                  border: '1px solid #FFBDAD',
                  borderRadius: '8px',
                  marginBottom: '1rem',
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>⚠️</span>
                  <div>
                    <div style={{ color: '#DE350B', fontSize: '13px', fontWeight: 700 }}>
                      Defectos de Jira sin vincular a pruebas ({projectUnlinkedBugs.length})
                    </div>
                    <div style={{ fontSize: '12px', color: '#44546F', marginTop: '2px' }}>
                      Existen {projectUnlinkedBugs.length} {projectUnlinkedBugs.length === 1 ? 'incidencia tipo Bug en Jira que no está asociada' : 'incidencias tipo Bug en Jira que no están asociadas'} a ningún Test Run o caso de prueba.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowUnlinkedBugsModal(true)}
                  style={{
                    backgroundColor: '#DE350B',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '6px 14px',
                    borderRadius: '6px',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(222, 53, 11, 0.3)'
                  }}
                >
                  🔍 Ver y Asociar ({projectUnlinkedBugs.length})
                </button>
              </div>
            )}

            {/* Dynamic Grid of Configured Widgets */}
              <div className="dashboard-widgets-grid">
                {dashboardWidgets
                  .filter(w => w.visible !== false && !['general_status', 'manual_vs_auto', 'cycles_progress'].includes(w.type))
                  .map((widget, index) => {
                    const isFull = widget.width === 'full';
                    const isDragging = draggedWidgetIndex === index;

                    return (
                      <div
                        key={widget.id || widget.type}
                        className={`dashboard-widget-wrapper ${isFull ? 'dashboard-widget-full' : 'dashboard-widget-half'} ${isCustomizingDashboard ? 'is-customizing' : ''} ${isDragging ? 'is-dragging' : ''}`}
                        draggable={isCustomizingDashboard}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, index)}
                      >
                        {/* Customizer Edit Toolbar on Top of Each Widget */}
                        {isCustomizingDashboard && (
                          <div className="dashboard-widget-toolbar">
                            <div className="dashboard-widget-drag-handle" title="Arrastrar para reordenar">
                              <span>⠿</span>
                              <span style={{ fontWeight: 700, fontSize: '12px' }}>{widget.title || widget.type}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <button
                                className="widget-mini-btn"
                                disabled={index === 0}
                                onClick={() => handleMoveWidget(index, -1)}
                                title="Mover arriba / izquierda"
                              >
                                ◀
                              </button>
                              <button
                                className="widget-mini-btn"
                                disabled={index === dashboardWidgets.length - 1}
                                onClick={() => handleMoveWidget(index, 1)}
                                title="Mover abajo / derecha"
                              >
                                ▶
                              </button>
                              <button
                                className="widget-mini-btn"
                                onClick={() => handleToggleWidgetWidth(widget.id)}
                                title={isFull ? 'Cambiar a 1 Columna (50%)' : 'Cambiar a 2 Columnas (100%)'}
                              >
                                {isFull ? '◫ 50%' : '▭ 100%'}
                              </button>
                              <button
                                className="widget-mini-btn delete"
                                onClick={() => handleRemoveWidget(widget.id)}
                                title="Quitar widget del tablero"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Widget Content Renderer */}
                        {widget.type === 'kpi_scorecard' && (
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                            gap: '16px'
                          }}>
                            {/* KPI 1: Casos Consolidados */}
                            <div style={{
                              background: '#FFFFFF',
                              padding: '16px',
                              borderRadius: '12px',
                              border: '1px solid #E2E8F0',
                              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <svg style={{ width: '14px', height: '14px', color: '#475569' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                  </svg>
                                  CASOS CONSOLIDADOS
                                </span>
                                <span style={{ padding: '2px 8px', borderRadius: '9999px', fontSize: '10px', fontWeight: 700, background: '#EFF6FF', color: '#1D4ED8' }}>
                                  {filteredCycles.length} {filteredCycles.length === 1 ? 'Ciclo Activo' : 'Ciclos Activos'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '4px 0' }}>
                                <span style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>{allTotal.toLocaleString()}</span>
                                <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>casos totales</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#64748B', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #F1F5F9' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ width: '8px', height: '8px', borderRadius: '9999px', background: '#10B981' }} />
                                  {execStats.auto.total} Auto ({allTotal > 0 ? Math.round((execStats.auto.total / allTotal) * 100) : 0}%)
                                </span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ width: '8px', height: '8px', borderRadius: '9999px', background: '#6366F1' }} />
                                  {execStats.manual.total} Manual ({allTotal > 0 ? Math.round((execStats.manual.total / allTotal) * 100) : 0}%)
                                </span>
                              </div>
                            </div>

                            {/* KPI 2: Tasa de Éxito */}
                            <div style={{
                              background: '#FFFFFF',
                              padding: '16px',
                              borderRadius: '12px',
                              border: '1px solid #E2E8F0',
                              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <svg style={{ width: '14px', height: '14px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  TASA DE ÉXITO
                                </span>
                                <span style={{ padding: '2px 8px', borderRadius: '9999px', fontSize: '10px', fontWeight: 700, background: '#ECFDF5', color: '#047857' }}>
                                  ▲ {successRate}%
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '4px 0' }}>
                                <span style={{ fontSize: '28px', fontWeight: 800, color: '#047857', letterSpacing: '-0.02em' }}>{successRate}%</span>
                                <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>{passed} passed</span>
                              </div>
                              <div style={{ width: '100%', background: '#F1F5F9', height: '6px', borderRadius: '9999px', overflow: 'hidden', marginTop: '8px' }}>
                                <div style={{ background: '#10B981', height: '100%', width: `${Math.min(100, Math.max(0, Number(successRate)))}%`, borderRadius: '9999px', transition: 'width 0.4s ease' }} />
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '8px', display: 'flex', justifyContent: 'space-between' }}>
                                <span>{passed} pasados de {ejecutados} evaluados</span>
                                <span style={{ fontWeight: 600, color: '#334155' }}>Meta: 90%</span>
                              </div>
                            </div>

                            {/* KPI 3: Defectos & Bloqueos */}
                            <div style={{
                              background: '#FFFFFF',
                              padding: '16px',
                              borderRadius: '12px',
                              border: '1px solid #E2E8F0',
                              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#BE123C', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <svg style={{ width: '14px', height: '14px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                  </svg>
                                  DEFECTOS &amp; BLOQUEOS
                                </span>
                                <span style={{ padding: '2px 8px', borderRadius: '9999px', fontSize: '10px', fontWeight: 700, background: '#FFF1F2', color: '#BE123C' }}>
                                  {`${openCycleBugs} Activos`}
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '4px 0' }}>
                                <span style={{ fontSize: '28px', fontWeight: 800, color: '#BE123C', letterSpacing: '-0.02em' }}>{totalCycleBugs}</span>
                                <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>bugs totales ({blocked} casos bloqueados)</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #F1F5F9' }}>
                                <span style={{ color: '#047857', fontWeight: 600 }}>{closedCycleBugs} Cerrados</span>
                                <span style={{ color: '#BE123C', fontWeight: 700 }}>{openCycleBugs} En Curso</span>
                                <button
                                  type="button"
                                  onClick={() => setDashboardSubView('bugs')}
                                  style={{ background: 'transparent', border: 'none', color: '#2563EB', fontWeight: 700, fontSize: '11px', cursor: 'pointer', padding: 0 }}
                                >
                                  Ver Bugs →
                                </button>
                              </div>
                            </div>

                            {/* KPI 4: Tiempo de Resolución (MTTR) */}
                            <div style={{
                              background: '#FFFFFF',
                              padding: '16px',
                              borderRadius: '12px',
                              border: '1px solid #E2E8F0',
                              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <svg style={{ width: '14px', height: '14px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  RESOLUCIÓN (MTTR)
                                </span>
                                <span style={{ padding: '2px 8px', borderRadius: '9999px', fontSize: '10px', fontWeight: 700, background: '#F1F5F9', color: '#475569' }}>
                                  SLA: 24h
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '4px 0' }}>
                                <span style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>{avgResolutionHours}</span>
                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748B' }}>hrs</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#64748B', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #F1F5F9' }}>
                                <span style={{ color: '#047857', fontWeight: 600 }}>Media en ciclo</span>
                                <span>objetivo &lt; 24h</span>
                              </div>
                            </div>

                            {/* KPI 5: Cobertura Global */}
                            <div style={{
                              background: '#FFFFFF',
                              padding: '16px',
                              borderRadius: '12px',
                              border: '1px solid #E2E8F0',
                              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <svg style={{ width: '14px', height: '14px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                  </svg>
                                  COBERTURA GLOBAL
                                </span>
                                <span style={{ padding: '2px 8px', borderRadius: '9999px', fontSize: '10px', fontWeight: 700, background: '#EFF6FF', color: '#1D4ED8' }}>
                                  {coverageRate}% Ejec.
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '4px 0' }}>
                                <span style={{ fontSize: '28px', fontWeight: 800, color: '#1D4ED8', letterSpacing: '-0.02em' }}>{coverageRate}%</span>
                                <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>{ejecutados} / {allTotal} corridos</span>
                              </div>
                              <div style={{ width: '100%', background: '#F1F5F9', height: '6px', borderRadius: '9999px', overflow: 'hidden', marginTop: '8px' }}>
                                <div style={{ background: '#2563EB', height: '100%', width: `${Math.min(100, Math.max(0, Number(coverageRate)))}%`, borderRadius: '9999px', transition: 'width 0.4s ease' }} />
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '8px', display: 'flex', justifyContent: 'space-between' }}>
                                <span>{notRun} casos pendientes</span>
                                <span style={{ color: '#BE123C', fontWeight: 600 }}>{failed} fallidos a re-testear</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {widget.type === 'tester_stats' && (
                          <div className="dashboard-card" style={{ height: '100%' }}>
                            <div className="dashboard-card-header">
                              <div className="dashboard-card-title">
                                <span>👥</span>
                                <span>Estado por QA Tester</span>
                              </div>
                              <span style={{ fontSize: '11px', background: '#F1F2F4', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                                {Object.keys(testerStats).length} Asignados
                              </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.4rem 0', maxHeight: '240px', overflowY: 'auto' }}>
                              {Object.keys(testerStats).length > 0 ? (
                                Object.entries(testerStats).map(([testerName, stats]) => {
                                  const tPassPct = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
                                  return (
                                    <div key={testerName} className="dashboard-tester-row">
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          <div className="dashboard-avatar-circle">
                                            {getInitials(testerName)}
                                          </div>
                                          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--jira-dark, #172B4D)' }}>{testerName}</span>
                                        </div>
                                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-subtle)' }}>
                                          {stats.passed}/{stats.total} ({tPassPct}%)
                                        </span>
                                      </div>
                                      <div className="dashboard-stacked-bar" style={{ height: '8px', margin: '2px 0' }}>
                                        {stats.passed > 0 && <div style={{ width: `${(stats.passed / stats.total) * 100}%`, backgroundColor: '#36B37E' }} />}
                                        {stats.failed > 0 && <div style={{ width: `${(stats.failed / stats.total) * 100}%`, backgroundColor: '#DE350B' }} />}
                                        {stats.blocked > 0 && <div style={{ width: `${(stats.blocked / stats.total) * 100}%`, backgroundColor: '#FFAB00' }} />}
                                        {stats.notRun > 0 && <div style={{ width: `${(stats.notRun / stats.total) * 100}%`, backgroundColor: '#0C66E4' }} />}
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '1rem', fontSize: '12px' }}>
                                  Sin asignaciones de tester
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {widget.type === 'module_stats' && (
                          <div className="dashboard-card" style={{ height: '100%' }}>
                            <div className="dashboard-card-header">
                              <div className="dashboard-card-title">
                                <span>🧱</span>
                                <span>Estado por Módulo / Funcionalidad</span>
                              </div>
                              <span style={{ fontSize: '11px', background: '#E9F2FF', color: '#0C66E4', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                                Tipo: Funcional
                              </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.4rem 0', maxHeight: '240px', overflowY: 'auto' }}>
                              {Object.keys(moduleStats).length > 0 ? (
                                Object.entries(moduleStats).slice(0, 5).map(([modName, stats]) => {
                                  const mPassPct = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
                                  const riskLevel = stats.failed > 3 ? 'high' : stats.failed > 0 ? 'med' : 'low';
                                  return (
                                    <div key={modName} className="dashboard-module-row">
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <span style={{ fontSize: '12px', fontWeight: 600 }}>{modName}</span>
                                          {riskLevel === 'high' && <span className="ads-lozenge ads-lozenge-danger" style={{ fontSize: '9px' }}>Riesgo Alto</span>}
                                          {riskLevel === 'med' && <span className="ads-lozenge ads-lozenge-warning" style={{ fontSize: '9px' }}>Riesgo Medio</span>}
                                          {riskLevel === 'low' && <span className="ads-lozenge ads-lozenge-success" style={{ fontSize: '9px' }}>Estable</span>}
                                        </div>
                                        <span style={{ fontSize: '11px', color: 'var(--jira-subtle)' }}>{stats.total} casos · {mPassPct}% Pass</span>
                                      </div>
                                      <div className="dashboard-stacked-bar" style={{ height: '8px', margin: '2px 0' }}>
                                        {stats.passed > 0 && <div style={{ width: `${(stats.passed / stats.total) * 100}%`, backgroundColor: '#36B37E' }} />}
                                        {stats.failed > 0 && <div style={{ width: `${(stats.failed / stats.total) * 100}%`, backgroundColor: '#DE350B' }} />}
                                        {stats.blocked > 0 && <div style={{ width: `${(stats.blocked / stats.total) * 100}%`, backgroundColor: '#FFAB00' }} />}
                                        {stats.notRun > 0 && <div style={{ width: `${(stats.notRun / stats.total) * 100}%`, backgroundColor: '#0C66E4' }} />}
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '1rem', fontSize: '12px' }}>
                                  Sin pruebas funcionales registradas
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {widget.type === 'severity_breakdown' && (() => {
                          const sevCounts = { bloqueante: 0, critico: 0, mayor: 0, menor: 0, sinDefinir: 0 };
                          const bugsList = cycleAllBugsList;
                          bugsList.forEach(b => {
                            const s = (b.severity || '').toLowerCase();
                            if (s.includes('bloq')) sevCounts.bloqueante++;
                            else if (s.includes('crit')) sevCounts.critico++;
                            else if (s.includes('may')) sevCounts.mayor++;
                            else if (s.includes('men') || s.includes('baj') || s.includes('triv')) sevCounts.menor++;
                            else sevCounts.sinDefinir++;
                          });
                          const totalSevBugs = bugsList.length;

                          return (
                            <div className="dashboard-card" style={{ height: '100%' }}>
                              <div className="dashboard-card-header">
                                <div className="dashboard-card-title">
                                  <span>🐞</span>
                                  <span>Distribución de Defectos por Severidad</span>
                                </div>
                                <span style={{ fontSize: '11px', background: '#FFEBE6', color: '#DE350B', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                                  {totalSevBugs} Defectos en Ciclo
                                </span>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', padding: '0.4rem 0' }}>
                                <div className="dashboard-stacked-bar" style={{ height: '12px' }}>
                                  {totalSevBugs > 0 ? (
                                    <>
                                      {sevCounts.bloqueante > 0 && <div style={{ width: `${(sevCounts.bloqueante / totalSevBugs) * 100}%`, backgroundColor: '#DE350B' }} title={`Bloqueante: ${sevCounts.bloqueante}`} />}
                                      {sevCounts.critico > 0 && <div style={{ width: `${(sevCounts.critico / totalSevBugs) * 100}%`, backgroundColor: '#FF5630' }} title={`Crítico: ${sevCounts.critico}`} />}
                                      {sevCounts.mayor > 0 && <div style={{ width: `${(sevCounts.mayor / totalSevBugs) * 100}%`, backgroundColor: '#FFAB00' }} title={`Mayor: ${sevCounts.mayor}`} />}
                                      {sevCounts.menor > 0 && <div style={{ width: `${(sevCounts.menor / totalSevBugs) * 100}%`, backgroundColor: '#36B37E' }} title={`Menor: ${sevCounts.menor}`} />}
                                      {sevCounts.sinDefinir > 0 && <div style={{ width: `${(sevCounts.sinDefinir / totalSevBugs) * 100}%`, backgroundColor: '#626F86' }} title={`Sin Definir: ${sevCounts.sinDefinir}`} />}
                                    </>
                                  ) : (
                                    <div style={{ width: '100%', height: '100%', backgroundColor: '#E3FCEF' }} title="Sin defectos" />
                                  )}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '6px' }}>
                                  <div style={{ background: '#FFEBE6', border: '1px solid #FFBDAD', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#DE350B' }}>{sevCounts.bloqueante}</div>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#BF2600', textTransform: 'uppercase' }}>Bloqueante</div>
                                  </div>
                                  <div style={{ background: '#FFF0ED', border: '1px solid #FFC4BA', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#FF5630' }}>{sevCounts.critico}</div>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#DE350B', textTransform: 'uppercase' }}>Crítico</div>
                                  </div>
                                  <div style={{ background: '#FFFAE6', border: '1px solid #FFE380', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#FF8B00' }}>{sevCounts.mayor}</div>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#974F00', textTransform: 'uppercase' }}>Mayor</div>
                                  </div>
                                  <div style={{ background: '#E3FCEF', border: '1px solid #ABF5D1', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#006644' }}>{sevCounts.menor}</div>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#006644', textTransform: 'uppercase' }}>Menor</div>
                                  </div>
                                  <div style={{ background: '#F1F2F4', border: '1px solid #DCDFE4', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#626F86' }}>{sevCounts.sinDefinir}</div>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase' }}>Sin Definir</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {widget.type === 'automation_health' && (() => {
                          const autoCasesCount = execStats.auto.total;
                          const totalEvalCases = allTotal;
                          const autoCoverageRatio = totalEvalCases > 0 ? Math.round((autoCasesCount / totalEvalCases) * 100) : 0;
                          const autoSuccessRate = execStats.auto.total > 0 ? Math.round((execStats.auto.passed / execStats.auto.total) * 100) : 0;
                          const isCiCdReady = autoSuccessRate >= 80 && autoCoverageRatio >= 30;

                          return (
                            <div className="dashboard-card" style={{ height: '100%' }}>
                              <div className="dashboard-card-header">
                                <div className="dashboard-card-title">
                                  <span>🚀</span>
                                  <span>Salud de Automatización &amp; CI/CD</span>
                                </div>
                                <span className={`ads-lozenge ${isCiCdReady ? 'ads-lozenge-success' : 'ads-lozenge-warning'}`} style={{ fontSize: '10px' }}>
                                  {isCiCdReady ? '✅ CI/CD Ready' : '⚠️ En Estabilización'}
                                </span>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', padding: '0.5rem 0' }}>
                                <div style={{ background: '#F8FAFD', border: '1px solid #DCDFE4', borderRadius: '6px', padding: '10px', textAlign: 'center' }}>
                                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#6554C0' }}>{autoCoverageRatio}%</div>
                                  <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', fontWeight: 600 }}>Ratio de Auto</div>
                                  <div style={{ fontSize: '10px', color: 'var(--jira-subtle)', marginTop: '2px' }}>{autoCasesCount} / {totalEvalCases} casos</div>
                                </div>

                                <div style={{ background: '#F8FAFD', border: '1px solid #DCDFE4', borderRadius: '6px', padding: '10px', textAlign: 'center' }}>
                                  <div style={{ fontSize: '18px', fontWeight: 800, color: autoSuccessRate >= 80 ? '#006644' : '#DE350B' }}>{autoSuccessRate}%</div>
                                  <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', fontWeight: 600 }}>Tasa Pass Auto</div>
                                  <div style={{ fontSize: '10px', color: 'var(--jira-subtle)', marginTop: '2px' }}>{execStats.auto.passed} pasados</div>
                                </div>

                                <div style={{ background: '#F8FAFD', border: '1px solid #DCDFE4', borderRadius: '6px', padding: '10px', textAlign: 'center' }}>
                                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#0C66E4' }}>{execStats.auto.notRun}</div>
                                  <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', fontWeight: 600 }}>Pendientes Auto</div>
                                  <div style={{ fontSize: '10px', color: 'var(--jira-subtle)', marginTop: '2px' }}>Para pipeline</div>
                                </div>
                              </div>
                              
                              <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', borderTop: '1px solid #F1F2F4', paddingTop: '6px', marginTop: '4px' }}>
                                💡 <strong>Recomendación:</strong> Mantén la tasa de aprobación superior al 90% para integrar las suites automáticas en el despliegue continuo de CI/CD.
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
              </div>
            </div>
            );
          })()}

          {/* ═══════════════════════════════════════════════════════ */}
          {/* ─── SUBVIEW 2: BUGS ─── */}
          {/* ═══════════════════════════════════════════════════════ */}
          {dashboardSubView === 'bugs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* ─── STITCH 5-COLUMN KPI SCORECARD ─── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
                {/* Card 1: Total Defectos */}
                <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '18px 20px', border: '1px solid #EAEEF4', boxShadow: '0 4px 20px -2px rgba(24, 28, 32, 0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#414754' }}>TOTAL DEFECTOS</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: '#E9F2FF', color: '#0055CC' }}>En el Plan</span>
                    </div>
                    <div style={{ fontSize: '34px', fontWeight: 800, color: '#181C20', lineHeight: 1, marginBottom: '14px', letterSpacing: '-0.02em' }}>
                      {totalAllBugs}
                    </div>
                    <div style={{ width: '100%', height: '6px', background: '#ECEEF3', borderRadius: '999px', overflow: 'hidden', display: 'flex', marginBottom: '12px' }}>
                      <div style={{ width: `${totalAllBugs > 0 ? Math.round((totalClosedBugs / totalAllBugs) * 100) : 0}%`, height: '100%', background: '#006C47', transition: 'width 0.3s ease' }} />
                      <div style={{ width: `${totalAllBugs > 0 ? Math.max(0, 100 - Math.round((totalClosedBugs / totalAllBugs) * 100)) : 0}%`, height: '100%', background: '#CA3521', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600 }}>
                    <span style={{ color: '#006C47', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#006C47', display: 'inline-block' }} />
                      {totalClosedBugs} Cerrados
                    </span>
                    <span style={{ color: totalOpenBugs > 0 ? '#CA3521' : '#727785', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: totalOpenBugs > 0 ? '#CA3521' : '#727785', display: 'inline-block' }} />
                      {totalOpenBugs} Abiertos
                    </span>
                  </div>
                </div>

                {/* Card 2: Defectos de Ciclo (Idéntico al KPI de Defectos en Runs) */}
                <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '18px 20px', border: '1px solid #EAEEF4', boxShadow: '0 4px 20px -2px rgba(24, 28, 32, 0.04)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '3px', background: '#CA3521' }} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#BA1A1A' }}>EN CICLO ACTIVO</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: '#FFDAD6', color: '#93000A', textTransform: 'uppercase' }}>{openCycleBugs} ACTIVOS</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '34px', fontWeight: 800, color: '#BA1A1A', lineHeight: 1, letterSpacing: '-0.02em' }}>
                        {totalCycleBugs}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#626F86' }}>bugs vinculados</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#727785', fontWeight: 500, marginBottom: '12px' }}>
                      {blocked} {blocked === 1 ? 'caso bloqueado en ciclo' : 'casos bloqueados en ciclo'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid #F2F4F8', fontSize: '11px', fontWeight: 700 }}>
                    <span style={{ color: '#006C47' }}>{closedCycleBugs} Cerrados</span>
                    <span style={{ color: openCycleBugs > 0 ? '#BA1A1A' : '#626F86' }}>{openCycleBugs} En Curso</span>
                  </div>
                </div>

                {/* Card 3: Bloqueantes & Críticos (Configurable) */}
                {(conf.showSevBloqueante !== false || conf.showSevCritico !== false) && (() => {
                  const highSevCount = planGeneralBugsList.filter(b => !b.isDone && (
                    (conf.showSevBloqueante !== false && getSevRank(b.severity) === 1) ||
                    (conf.showSevCritico !== false && getSevRank(b.severity) === 2)
                  )).length;
                  return (
                    <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '18px 20px', border: '1px solid #EAEEF4', boxShadow: '0 4px 20px -2px rgba(24, 28, 32, 0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#414754' }}>
                            {conf.showSevBloqueante !== false && conf.showSevCritico !== false
                              ? 'BLOQUEANTES & CRÍTICOS'
                              : conf.showSevBloqueante !== false
                                ? 'BLOQUEANTES'
                                : 'CRÍTICOS'}
                          </span>
                          <span style={{ color: '#BA1A1A', fontSize: '14px', lineHeight: 1 }}>⚠️</span>
                        </div>
                        <div style={{ fontSize: '34px', fontWeight: 800, color: '#181C20', lineHeight: 1, marginBottom: '12px', letterSpacing: '-0.02em' }}>
                          {highSevCount}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: highSevCount > 0 ? 'rgba(255, 218, 214, 0.6)' : '#E3FCEF', color: highSevCount > 0 ? '#BA1A1A' : '#006644' }}>
                          {highSevCount > 0 ? 'Prioridad Máxima' : 'Sin bloqueos críticos'}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Card 4: Mayores, Medios & Menores (Configurable) */}
                {(conf.showSevMayor !== false || conf.showSevMedio !== false || conf.showSevMenor !== false) && (() => {
                  const medLowCount = planGeneralBugsList.filter(b => !b.isDone && (
                    (conf.showSevMayor !== false && getSevRank(b.severity) === 3) ||
                    (conf.showSevMedio !== false && getSevRank(b.severity) === 4) ||
                    (conf.showSevMenor !== false && getSevRank(b.severity) === 5)
                  )).length;
                  const activeLabels = [];
                  if (conf.showSevMayor !== false) activeLabels.push('MAYORES');
                  if (conf.showSevMedio !== false) activeLabels.push('MEDIOS');
                  if (conf.showSevMenor !== false) activeLabels.push('MENORES');
                  const cardTitle = activeLabels.length >= 2
                    ? `${activeLabels[0]} & ${activeLabels[activeLabels.length - 1]}`
                    : (activeLabels[0] || 'MEDIOS & MENORES');
                  return (
                    <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '18px 20px', border: '1px solid #EAEEF4', boxShadow: '0 4px 20px -2px rgba(24, 28, 32, 0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#414754' }}>
                            {cardTitle}
                          </span>
                          <span style={{ color: '#A54800', fontSize: '13px', fontWeight: 800, lineHeight: 1 }}>●</span>
                        </div>
                        <div style={{ fontSize: '34px', fontWeight: 800, color: '#A54800', lineHeight: 1, marginBottom: '12px', letterSpacing: '-0.02em' }}>
                          {medLowCount}
                        </div>
                      </div>
                      <div style={{ fontSize: '11px', color: '#414754', fontWeight: 500 }}>
                        Abiertos no bloqueantes
                      </div>
                    </div>
                  );
                })()}

                {/* Card 5: Resolución (MTTR) */}
                {conf.showBugTimes !== false && (
                  <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '18px 20px', border: '1px solid #EAEEF4', boxShadow: '0 4px 20px -2px rgba(24, 28, 32, 0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#414754' }}>RESOLUCIÓN MTTR</span>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: '#A0F3C1', color: '#005235' }}>SLA 24H</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '12px' }}>
                        <span style={{ fontSize: '34px', fontWeight: 800, color: '#0055CC', lineHeight: 1, letterSpacing: '-0.02em' }}>
                          {avgResolutionHours}
                        </span>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#727785' }}>hrs</span>
                      </div>
                    </div>
                    <div style={{ fontSize: '11px', color: '#006C47', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>✓</span>
                      <span>Tiempo promedio cierre</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ─── SECCIÓN 1: DEFECTOS EN CICLO(S) SELECCIONADOS (REDISEÑO STITCH) ─── */}
              <div style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #EAEEF4', boxShadow: '0 4px 20px -2px rgba(24, 28, 32, 0.04)', overflow: 'hidden' }}>
                {/* Table Header / Action Bar */}
                <div style={{ padding: '18px 24px', borderBottom: '1px solid #EAEEF4', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#FFDAD6', color: '#93000A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                      🐞
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '15px', fontWeight: 800, color: '#181C20', letterSpacing: '-0.01em' }}>
                          Defectos en Ciclo(s) Seleccionados
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', background: '#E9F2FF', color: '#0055CC' }}>
                          {totalCycleBugs} EN CICLO
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', background: '#FFDAD6', color: '#93000A' }}>
                          {openCycleBugs} ACTIVOS
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', background: '#E3FCEF', color: '#006644' }}>
                          {closedCycleBugs} CERRADOS
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#414754', marginTop: '2px' }}>
                        Listado completo de defectos (abiertos y cerrados) vinculados a casos de prueba en los ciclos seleccionados.
                      </div>
                    </div>
                  </div>

                  {/* Filter Pills & Search Input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    {/* Quick Filter Tabs */}
                    <div style={{ display: 'flex', background: '#F2F4F8', padding: '3px', borderRadius: '8px', gap: '2px' }}>
                      {[
                        { id: 'ALL', label: `Todos (${totalCycleBugs})` },
                        { id: 'OPEN', label: `Abiertos (${openCycleBugs})` },
                        { id: 'CLOSED', label: `Cerrados (${closedCycleBugs})` },
                        { id: 'BLOCKER', label: 'Bloqueantes' },
                        { id: 'MEDIUM', label: 'Medios' }
                      ].map(tab => {
                        const isActive = dashboardCycleBugFilter === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setDashboardCycleBugFilter(tab.id)}
                            style={{
                              padding: '5px 10px',
                              fontSize: '11px',
                              fontWeight: isActive ? 700 : 600,
                              background: isActive ? '#FFFFFF' : 'transparent',
                              color: isActive ? '#0055CC' : '#414754',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Search Input */}
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <span style={{ position: 'absolute', left: '10px', fontSize: '12px', color: '#727785', pointerEvents: 'none' }}>🔍</span>
                      <input
                        type="text"
                        placeholder="Buscar por ID, resumen o versión..."
                        value={dashboardBugSearch}
                        onChange={(e) => setDashboardBugSearch(e.target.value)}
                        style={{
                          padding: '6px 12px 6px 30px',
                          fontSize: '12px',
                          background: '#F2F4F8',
                          border: '1px solid transparent',
                          borderRadius: '8px',
                          width: '240px',
                          color: '#181C20',
                          outline: 'none'
                        }}
                      />
                      {dashboardBugSearch && (
                        <button
                          type="button"
                          onClick={() => setDashboardBugSearch('')}
                          style={{ marginLeft: '6px', padding: '4px 8px', fontSize: '11px', background: '#ECEEF3', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#414754', fontWeight: 600 }}
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* High-Density Defect Table */}
                {filteredBugsList.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="dashboard-defects-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#F8F9FE', borderBottom: '1px solid #EAEEF4' }}>
                          <th style={{ padding: '12px 16px', fontSize: '10px', fontWeight: 800, color: '#414754', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>Incidencia / ID</th>
                          <th style={{ padding: '12px 16px', fontSize: '10px', fontWeight: 800, color: '#414754', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>Resumen y Contexto</th>
                          <th style={{ padding: '12px 16px', fontSize: '10px', fontWeight: 800, color: '#414754', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>Versión Afectada</th>
                          <th style={{ padding: '12px 16px', fontSize: '10px', fontWeight: 800, color: '#414754', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>Registro / Tiempo</th>
                          <th style={{ padding: '12px 16px', fontSize: '10px', fontWeight: 800, color: '#414754', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>Fecha Est. Solución</th>
                          <th style={{ padding: '12px 16px', fontSize: '10px', fontWeight: 800, color: '#414754', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>Severidad</th>
                          <th style={{ padding: '12px 16px', fontSize: '10px', fontWeight: 800, color: '#414754', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>Estado</th>
                          <th style={{ padding: '12px 16px', fontSize: '10px', fontWeight: 800, color: '#414754', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>Asignado</th>
                          <th style={{ padding: '12px 16px', fontSize: '10px', fontWeight: 800, color: '#414754', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>Resolución</th>
                          <th style={{ padding: '12px 16px', fontSize: '10px', fontWeight: 800, color: '#414754', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', whiteSpace: 'nowrap' }}>Casos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBugsList.map((bug) => {
                          const { dateStr, timeStr } = formatBugCreatedDate(bug.created);
                          const age = formatBugAge(bug.created, bug.resolutiondate, bug.isDone, bug);
                          const badgeColor = age.tone === 'red' ? '#FFDAD6' : age.tone === 'orange' ? '#FFF0B3' : age.tone === 'green' ? '#E3FCEF' : age.tone === 'onhold' ? '#E9F2FF' : '#ECEEF3';
                          const textColor = age.tone === 'red' ? '#93000A' : age.tone === 'orange' ? '#A54800' : age.tone === 'green' ? '#006644' : age.tone === 'onhold' ? '#0C66E4' : '#414754';
                          const showValidResolution = isBugStatusResolved(bug.status, bug.isDone) && bug.resolution && bug.resolution !== 'Sin resolver' && bug.resolution !== 'Unresolved';

                          return (
                            <tr
                              key={bug.key}
                              onClick={() => setSelectedBug(bug)}
                              style={{
                                cursor: 'pointer',
                                borderBottom: '1px solid #F2F4F8',
                                opacity: bug.isDone ? 0.88 : 1,
                                transition: 'background-color 0.15s ease'
                              }}
                            >
                              {/* 1. Incidencia / ID */}
                              <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span
                                    style={{
                                      width: '20px',
                                      height: '20px',
                                      borderRadius: '4px',
                                      background: bug.isDone ? '#006C47' : '#CA3521',
                                      color: '#FFFFFF',
                                      fontSize: '10px',
                                      fontWeight: 800,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0
                                    }}
                                  >
                                    B
                                  </span>
                                  <span
                                    onClick={(e) => { e.stopPropagation(); setSelectedBug(bug); }}
                                    style={{ color: '#0055CC', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
                                    className="hover:underline"
                                    title="Ver detalle del bug en Test Pulse"
                                  >
                                    {bug.key}
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); router.open('/browse/' + bug.key); }}
                                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: '#727785', display: 'inline-flex', alignItems: 'center' }}
                                    title="Abrir directamente en Jira"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                  </button>
                                </div>
                              </td>

                              {/* 2. Resumen del bug */}
                              <td style={{ padding: '14px 16px', maxWidth: '340px' }}>
                                <div
                                  style={{ fontWeight: 600, color: bug.isDone ? '#626F86' : '#181C20', fontSize: '13px', lineHeight: 1.35 }}
                                  title={bug.summary}
                                >
                                  {bug.summary}
                                </div>
                              </td>

                              {/* 3. Versión Afectada (sin icono de etiqueta) */}
                              <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    padding: '3px 8px',
                                    borderRadius: '4px',
                                    background: '#ECEEF3',
                                    color: '#414754',
                                    maxWidth: '160px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    display: 'inline-block'
                                  }}
                                  title={bug.version || 'Sin versión'}
                                >
                                  {bug.version || 'Sin versión'}
                                </span>
                              </td>

                              {/* 4. Fecha Registro / Tiempo */}
                              <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                  <div style={{ fontSize: '11px', color: '#181C20', fontWeight: 600 }}>
                                    {dateStr} {timeStr && <span style={{ color: '#727785', fontWeight: 400, fontSize: '10px' }}>({timeStr})</span>}
                                  </div>
                                  {bug.created && (
                                    <div
                                      style={{
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        background: badgeColor,
                                        color: textColor,
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        width: 'fit-content'
                                      }}
                                      title={`Jornada laboral México (L-J 7-18h, V 7-13h): ${age.bHoursFormatted} hrs hábiles ${bug.isDone ? 'invertidas hasta resolución' : 'transcurridas'}`}
                                    >
                                      <span>{age.tone === 'onhold' ? '⏸️' : '⏱️'}</span>
                                      <span>{age.label}</span>
                                    </div>
                                  )}
                                </div>
                              </td>

                              {/* 5. Fecha Estimada Solución */}
                              <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                                {renderBugDueDate(bug.estimatedResolutionDate || bug.duedate, bug.isDone)}
                              </td>

                              {/* 6. Severidad */}
                              <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                                <span className={`dashboard-sev-badge ${getSeverityClass(bug.severity)}`}>
                                  {getSeverityLabel(bug.severity)}
                                </span>
                              </td>

                              {/* 7. Estado */}
                              <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                                {renderBugStatusLozenge(bug.status, bug.isDone)}
                              </td>

                              {/* 8. Asignado */}
                              <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <div className="dashboard-avatar-circle" style={{ width: '24px', height: '24px', fontSize: '10px' }}>
                                    {getInitials(bug.assignee)}
                                  </div>
                                  <span style={{ fontSize: '12px', color: '#181C20', fontWeight: 500 }}>
                                    {bug.assignee}
                                  </span>
                                </div>
                              </td>

                              {/* 9. Resolución (estrictamente sin inventar si el estado no es resuelto/cerrado) */}
                              <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                                {!showValidResolution ? (
                                  <span style={{ color: '#727785', fontStyle: 'italic', fontSize: '11px' }}>
                                    Sin resolver
                                  </span>
                                ) : (
                                  <span className="ads-lozenge ads-lozenge-success" style={{ fontSize: '10px', fontWeight: 700 }}>
                                    {bug.resolution}
                                  </span>
                                )}
                              </td>

                              {/* 10. Casos afectados */}
                              <td style={{ padding: '14px 16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '8px',
                                    background: (bug.affectedCount || 0) > 0 ? '#E9F2FF' : '#F2F4F8',
                                    color: (bug.affectedCount || 0) > 0 ? '#0055CC' : '#727785',
                                    fontSize: '12px',
                                    fontWeight: 800
                                  }}
                                  title={`${bug.affectedCount || 0} ${(bug.affectedCount || 0) === 1 ? 'caso afectado' : 'casos afectados'}`}
                                >
                                  {bug.affectedCount || 0}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', color: '#626F86', padding: '3rem', fontSize: '13px' }}>
                    {(dashboardBugSearch || dashboardCycleBugFilter !== 'ALL')
                      ? '🔍 No se encontraron defectos en el ciclo con ese criterio de filtrado.'
                      : '✅ No hay defectos vinculados a los ciclos seleccionados.'}
                  </div>
                )}

                {/* Smart Footer Bar */}
                <div style={{ padding: '12px 24px', background: '#F2F4F8', borderTop: '1px solid #EAEEF4', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#414754', fontWeight: 500 }}>
                    Mostrando <strong style={{ color: '#181C20' }}>{filteredBugsList.length}</strong> de <strong style={{ color: '#181C20' }}>{totalCycleBugs}</strong> defectos en el ciclo actual ({totalAllBugs} en el plan total)
                  </div>
                  {(dashboardBugSearch || dashboardCycleBugFilter !== 'ALL') && (
                    <button
                      type="button"
                      onClick={() => { setDashboardBugSearch(''); setDashboardCycleBugFilter('ALL'); }}
                      style={{ background: 'transparent', border: 'none', color: '#0055CC', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Restablecer filtros de ciclo
                    </button>
                  )}
                </div>
              </div>

              {/* ─── WIDGET DONUT INTERACTIVO DE SEVERIDADES (DEBAJO DE TABLA 1) ─── */}
              <div className="dashboard-card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>🍩</span>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--jira-dark, #172B4D)' }}>
                        Distribución de Defectos Abiertos por Severidad
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--jira-subtle, #626F86)' }}>
                        Haz clic en un segmento del gráfico circular o en una tarjeta para filtrar la relación general de defectos.
                      </div>
                    </div>
                  </div>
                  {selectedDashboardSeverityFilter && (
                    <button
                      onClick={() => setSelectedDashboardSeverityFilter(null)}
                      style={{
                        background: '#FFEBE6',
                        border: '1px solid #FFBDAD',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#DE350B',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>✕</span>
                      <span>Quitar filtro ({selectedDashboardSeverityFilter})</span>
                    </button>
                  )}
                </div>

                {donutSegments.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--jira-subtle, #626F86)', fontSize: '12px' }}>
                    ℹ️ Todas las severidades han sido ocultadas en la configuración del proyecto.
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
                    {/* Donut SVG Responsivo */}
                    <div style={{ position: 'relative', width: '150px', height: '150px', flexShrink: 0, margin: '0 auto' }}>
                      <svg width="150" height="150" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
                        {/* Fondo */}
                        <circle cx="70" cy="70" r="52" fill="transparent" stroke="#F1F2F4" strokeWidth="15" />
                        {/* Segmentos */}
                        {(() => {
                          let accumulatedPct = 0;
                          return donutSegments.map(seg => {
                            if (seg.count === 0 || visibleSevOpenTotal === 0) return null;
                            const pct = seg.count / visibleSevOpenTotal;
                            const strokeDash = `${pct * 326.7256} ${326.7256}`;
                            const strokeOffset = -(accumulatedPct * 326.7256);
                            accumulatedPct += pct;
                            const isSelected = selectedDashboardSeverityFilter === seg.key;
                            return (
                              <circle
                                key={seg.key}
                                cx="70"
                                cy="70"
                                r="52"
                                fill="transparent"
                                stroke={seg.color}
                                strokeWidth={isSelected ? "19" : "15"}
                                strokeDasharray={strokeDash}
                                strokeDashoffset={strokeOffset}
                                style={{
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  opacity: (!selectedDashboardSeverityFilter || isSelected) ? 1 : 0.35,
                                  filter: isSelected ? 'drop-shadow(0 0 4px rgba(0,0,0,0.35))' : 'none'
                                }}
                                onClick={() => setSelectedDashboardSeverityFilter(prev => prev === seg.key ? null : seg.key)}
                              >
                                <title>{`${seg.label}: ${seg.count} (${Math.round(pct * 100)}%)`}</title>
                              </circle>
                            );
                          });
                        })()}
                      </svg>
                      {/* Centro con total / filtro */}
                      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <span style={{ fontSize: '22px', fontWeight: 800, color: '#172B4D', lineHeight: 1 }}>
                          {selectedDashboardSeverityFilter ? (donutSegments.find(s => s.key === selectedDashboardSeverityFilter)?.count ?? visibleSevOpenTotal) : visibleSevOpenTotal}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase', marginTop: '3px' }}>
                          {selectedDashboardSeverityFilter ? selectedDashboardSeverityFilter : 'Abiertos'}
                        </span>
                      </div>
                    </div>

                    {/* Pills / Tarjetas Interactivas de Severidad */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', flex: 1, minWidth: '280px' }}>
                      {donutSegments.map(seg => {
                        const isSelected = selectedDashboardSeverityFilter === seg.key;
                        const pct = visibleSevOpenTotal > 0 ? Math.round((seg.count / visibleSevOpenTotal) * 100) : 0;
                        return (
                          <button
                            key={seg.key}
                            type="button"
                            onClick={() => setSelectedDashboardSeverityFilter(prev => prev === seg.key ? null : seg.key)}
                            style={{
                              background: isSelected ? seg.bg : '#FAFBFC',
                              border: isSelected ? `2px solid ${seg.color}` : `1px solid ${seg.border}`,
                              borderRadius: '8px',
                              padding: '10px 12px',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-start',
                              gap: '4px',
                              transition: 'all 0.15s ease',
                              boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                              textAlign: 'left'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                              <span style={{ fontSize: '11px', fontWeight: 700, color: isSelected ? seg.color : '#44546F', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: seg.color, display: 'inline-block' }} />
                                {seg.label}
                              </span>
                              {isSelected && (
                                <span style={{ fontSize: '10px', fontWeight: 800, color: seg.color }}>✓</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                              <span style={{ fontSize: '18px', fontWeight: 800, color: seg.color }}>{seg.count}</span>
                              <span style={{ fontSize: '11px', color: '#626F86', fontWeight: 600 }}>({pct}%)</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ─── TABLA 2: RELACIÓN GENERAL DE BUGS DEL PLAN DE PRUEBAS ─── */}
              <div className="dashboard-card" style={{ overflowX: 'auto' }}>
                <div className="dashboard-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div className="dashboard-card-title">
                      <span style={{ color: '#0C66E4' }}>📋</span>
                      <span>Relación General de Bugs del Plan de Pruebas</span>
                      <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '11px', fontWeight: 700, marginLeft: '8px' }}>
                        {planGeneralBugsList.length} total
                      </span>
                      {selectedDashboardSeverityFilter && (
                        <span className="ads-lozenge ads-lozenge-warning" style={{ fontSize: '11px', fontWeight: 700, marginLeft: '6px' }}>
                          Filtrado: {selectedDashboardSeverityFilter} ({filteredPlanGeneralBugsList.length})
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', marginTop: '2px' }}>
                      Listado general consolidado de todos los defectos vinculados al Plan (Abiertos, On Hold, En progreso, En análisis y Cerrados).
                    </div>
                  </div>

                  {/* Filter controls: Status Tabs & Search input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    {/* Status filter tabs */}
                    <div style={{ display: 'flex', background: '#F1F2F4', padding: '2px', borderRadius: '6px', gap: '2px' }}>
                      <button
                        type="button"
                        onClick={() => setDashboardGeneralBugStatusTab('ALL')}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: dashboardGeneralBugStatusTab === 'ALL' ? 700 : 500,
                          background: dashboardGeneralBugStatusTab === 'ALL' ? '#FFFFFF' : 'transparent',
                          color: dashboardGeneralBugStatusTab === 'ALL' ? '#0C66E4' : '#44546F',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          boxShadow: dashboardGeneralBugStatusTab === 'ALL' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        Todos ({planGeneralBugsList.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDashboardGeneralBugStatusTab('OPEN')}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: dashboardGeneralBugStatusTab === 'OPEN' ? 700 : 500,
                          background: dashboardGeneralBugStatusTab === 'OPEN' ? '#FFFFFF' : 'transparent',
                          color: dashboardGeneralBugStatusTab === 'OPEN' ? '#DE350B' : '#44546F',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          boxShadow: dashboardGeneralBugStatusTab === 'OPEN' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        Abiertos ({totalOpenPlanBugs})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDashboardGeneralBugStatusTab('CLOSED')}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: dashboardGeneralBugStatusTab === 'CLOSED' ? 700 : 500,
                          background: dashboardGeneralBugStatusTab === 'CLOSED' ? '#FFFFFF' : 'transparent',
                          color: dashboardGeneralBugStatusTab === 'CLOSED' ? '#006644' : '#44546F',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          boxShadow: dashboardGeneralBugStatusTab === 'CLOSED' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        Cerrados ({totalClosedPlanBugs})
                      </button>
                    </div>

                    {/* Search input */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="text"
                        placeholder="Buscar en bugs del plan..."
                        value={dashboardGeneralBugSearch}
                        onChange={(e) => setDashboardGeneralBugSearch(e.target.value)}
                        style={{
                          padding: '6px 12px',
                          fontSize: '12px',
                          border: '1px solid var(--jira-border, #DCDFE4)',
                          borderRadius: '6px',
                          width: '240px'
                        }}
                      />
                      {dashboardGeneralBugSearch && (
                        <button
                          onClick={() => setDashboardGeneralBugSearch('')}
                          style={{ padding: '4px 8px', fontSize: '11px', background: '#F1F2F4', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Banner de filtro por severidad si está activo */}
                {selectedDashboardSeverityFilter && (
                  <div style={{ background: '#E9F2FF', border: '1px solid #B3D4FF', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 1rem 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#0C66E4', fontWeight: 600 }}>
                      <span>🍩</span>
                      <span>Filtrando tabla por severidad: <strong>{selectedDashboardSeverityFilter}</strong> ({filteredPlanGeneralBugsList.length} coincidencias)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDashboardSeverityFilter(null)}
                      style={{ background: '#FFFFFF', border: '1px solid #0C66E4', borderRadius: '4px', color: '#0C66E4', fontWeight: 700, cursor: 'pointer', fontSize: '11px', padding: '3px 8px' }}
                    >
                      ✕ Quitar filtro
                    </button>
                  </div>
                )}

                {filteredPlanGeneralBugsList.length > 0 ? (
                  <table className="dashboard-defects-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Resumen del bug</th>
                        <th>Versión Afectada</th>
                        <th>Fecha Registro / Antigüedad</th>
                        <th>Fecha Estimada Solución</th>
                        <th>Severidad</th>
                        <th>Estado</th>
                        <th>Responsable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPlanGeneralBugsList.map((bug) => {
                        const { dateStr, timeStr } = formatBugCreatedDate(bug.created);
                        // Pass full bug metadata so reopened bugs reset counter ("Re abierto hace...") and ON HOLD bugs pause clock
                        const age = formatBugAge(bug.created, bug.resolutiondate, bug.isDone, bug);
                        const badgeColor = age.tone === 'red' ? '#FFEBE6' : age.tone === 'orange' ? '#FFF0B3' : age.tone === 'green' ? '#E3FCEF' : age.tone === 'onhold' ? '#E9F2FF' : '#F1F2F4';
                        const textColor = age.tone === 'red' ? '#BF2600' : age.tone === 'orange' ? '#172B4D' : age.tone === 'green' ? '#006644' : age.tone === 'onhold' ? '#0C66E4' : '#44546F';

                        return (
                          <tr key={bug.key} onClick={() => setSelectedBug(bug)} style={{ opacity: bug.isDone ? 0.85 : 1, cursor: 'pointer' }}>
                            {/* 1. ID */}
                            <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className={`dashboard-bug-icon ${bug.isDone ? 'done' : ''}`}>B</span>
                                <span
                                  onClick={(e) => { e.stopPropagation(); setSelectedBug(bug); }}
                                  style={{ color: '#0C66E4', fontWeight: 700, cursor: 'pointer' }}
                                  className="hover:underline"
                                  title="Ver detalle del bug en Test Pulse"
                                >
                                  {bug.key}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); router.open('/browse/' + bug.key); }}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: '#626F86', display: 'inline-flex', alignItems: 'center' }}
                                  title="Abrir directamente en Jira"
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                </button>
                              </div>
                            </td>

                            {/* 2. Resumen del bug */}
                            <td style={{ maxWidth: '380px' }}>
                              <div 
                                style={{ fontWeight: 600, color: bug.isDone ? '#626F86' : 'var(--jira-dark, #172B4D)', fontSize: '13px' }} 
                                title={bug.summary}
                              >
                                {bug.summary}
                              </div>
                            </td>

                            {/* 3. Versión */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span
                                className="ads-lozenge ads-lozenge-subtle"
                                style={{ fontSize: '11px', fontWeight: 600, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}
                                title={bug.version || 'Sin versión'}
                              >
                                {bug.version || 'Sin versión'}
                              </span>
                            </td>

                            {/* 4. Fecha Registro / Antigüedad (Aging laboral) */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--jira-dark, #172B4D)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span>📅</span> <span>{dateStr}</span> {timeStr && <span style={{ color: 'var(--jira-subtle, #626F86)', fontWeight: 400, fontSize: '10px' }}>({timeStr})</span>}
                                </div>
                                {bug.created && (
                                  <div
                                    style={{
                                      fontSize: '10px',
                                      fontWeight: 700,
                                      background: badgeColor,
                                      color: textColor,
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      width: 'fit-content'
                                    }}
                                    title={`Jornada laboral México (L-J 7-18h, V 7-13h): ${age.bHoursFormatted} hrs hábiles ${bug.isDone ? 'invertidas hasta resolución' : 'transcurridas'}`}
                                  >
                                    <span>{age.tone === 'onhold' ? '⏸️' : '⏱️'}</span> <span>{age.label}</span>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* 4.1. Fecha Estimada Solución */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {renderBugDueDate(bug.estimatedResolutionDate || bug.duedate, bug.isDone)}
                            </td>

                            {/* 5. Severidad */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span className={`dashboard-sev-badge ${getSeverityClass(bug.severity)}`}>
                                {getSeverityLabel(bug.severity)}
                              </span>
                            </td>

                            {/* 6. Estado */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {renderBugStatusLozenge(bug.status, bug.isDone)}
                            </td>

                            {/* 7. Responsable */}
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div className="dashboard-avatar-circle" style={{ width: '24px', height: '24px', fontSize: '10px' }}>
                                  {getInitials(bug.assignee)}
                                </div>
                                <span style={{ fontSize: '12px', color: 'var(--jira-dark, #172B4D)', fontWeight: 500 }}>
                                  {bug.assignee}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '3rem', fontSize: '13px' }}>
                    {dashboardGeneralBugSearch ? '🔍 No se encontraron bugs en el plan con ese criterio de búsqueda.' : '✅ No hay defectos registrados en este Plan de Pruebas.'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════ */}
          {/* ─── SUBVIEW 3: TRACEABILITY ─── */}
          {/* ═══════════════════════════════════════════════════════ */}
          {dashboardSubView === 'traceability' && (() => {
            const totalEpicsCount = consolidatedEpicsMap.size;
            const totalStoriesCount = consolidatedStoriesMap.size;
            const coveredStoriesCount = Array.from(consolidatedStoriesMap.values()).filter(
              (s) => (s.tcRefSet && s.tcRefSet.size > 0) || traceabilityRows.some((r) => r.requirementKey === s.key && r.cycleId !== null)
            ).length;
            const storiesCoveragePct = totalStoriesCount > 0 ? Math.round((coveredStoriesCount / totalStoriesCount) * 100) : 0;
            const orphanStoriesCount = Array.from(consolidatedStoriesMap.values()).filter((s) => !s.epicKey).length;
            const orphanStoriesPct = totalStoriesCount > 0 ? Math.round((orphanStoriesCount / totalStoriesCount) * 100) : 0;
            const rowsWithIssuesCount = traceabilityRows.filter(
              (r) => r.status === 'FAILED' || r.status === 'BLOCKED' || (r.bugs && r.bugs.length > 0)
            ).length;

            // Group filteredTraceabilityRows hierarchically by Epic
            const epicGroupsMap = new Map();
            filteredTraceabilityRows.forEach((row) => {
              const groupKey = row.epicKey || '__UNLINKED_EPIC__';
              if (!epicGroupsMap.has(groupKey)) {
                epicGroupsMap.set(groupKey, {
                  groupKey,
                  epicKey: row.epicKey || null,
                  epicSummary: row.epicKey
                    ? (row.epicSummary || '')
                    : '⚠️ Incumplimiento de proceso: Historias de usuario sin Épica padre vinculada en Jira',
                  rows: [],
                  storyRows: [],
                  storiesMap: new Map(),
                  plansMap: new Map(),
                  cyclesSet: new Set(),
                  bugsMap: new Map()
                });
              }
              const grp = epicGroupsMap.get(groupKey);
              if (row.epicSummary && (!grp.epicSummary || grp.epicSummary === row.epicKey)) {
                grp.epicSummary = row.epicSummary;
              }
              grp.rows.push(row);

              if (row.requirementKey) {
                grp.storyRows.push(row);
                if (!grp.storiesMap.has(row.requirementKey)) {
                  grp.storiesMap.set(row.requirementKey, {
                    key: row.requirementKey,
                    summary: row.requirementSummary || '',
                    linkedTcCount: row.linkedTcCount || 0,
                    executedTcCount: 0,
                    hasCycle: false,
                    statuses: []
                  });
                }
                const stEntry = grp.storiesMap.get(row.requirementKey);
                if ((row.linkedTcCount || 0) > stEntry.linkedTcCount) {
                  stEntry.linkedTcCount = row.linkedTcCount;
                }
                if (row.cycleId !== null) {
                  stEntry.hasCycle = true;
                  stEntry.executedTcCount += (row.executedTcCount || 0);
                }
                stEntry.statuses.push(String(row.status || 'NOT_RUN').toUpperCase());
              }

              if (row.planKey || (row.planName && row.planName !== 'Sin plan asignado' && row.planName !== 'Sin casos vinculados')) {
                grp.plansMap.set(row.planKey || row.planName, row.planName);
              }
              if (row.cycleId !== null && row.cycleName) {
                grp.cyclesSet.add(row.cycleName);
              }
              if (Array.isArray(row.bugs)) {
                row.bugs.forEach((b) => {
                  if (b && b.key) grp.bugsMap.set(b.key, b);
                });
              }
            });

            const epicGroups = Array.from(epicGroupsMap.values()).map((grp) => {
              const storiesArr = Array.from(grp.storiesMap.values());
              const totalStories = storiesArr.length;
              const coveredStories = storiesArr.filter((s) => s.linkedTcCount > 0 || s.hasCycle).length;
              const executedStories = storiesArr.filter((s) =>
                s.statuses.some((st) => st === 'PASSED' || st === 'FAILED' || st === 'BLOCKED' || st === 'IN_PROGRESS')
              ).length;
              const coveragePct = totalStories > 0 ? Math.round((coveredStories / totalStories) * 100) : 0;

              // Aggregate Epic status across all its story rows
              const allStatuses = grp.storyRows.map((r) => String(r.status || 'NOT_RUN').toUpperCase());
              let epicStatus = 'NOT_RUN';
              if (allStatuses.length > 0) {
                if (allStatuses.includes('FAILED')) epicStatus = 'FAILED';
                else if (allStatuses.includes('BLOCKED')) epicStatus = 'BLOCKED';
                else if (allStatuses.includes('IN_PROGRESS')) epicStatus = 'IN_PROGRESS';
                else if (allStatuses.every((s) => s === 'PASSED')) epicStatus = 'PASSED';
                else if (allStatuses.includes('PASSED')) epicStatus = 'IN_PROGRESS';
              }

              return {
                ...grp,
                totalStories,
                coveredStories,
                executedStories,
                coveragePct,
                epicStatus,
                uniquePlans: Array.from(grp.plansMap.values()),
                uniqueCycles: Array.from(grp.cyclesSet.values()),
                uniqueBugs: Array.from(grp.bugsMap.values())
              };
            });

            const isSearching = Boolean(dashboardTraceabilitySearch && dashboardTraceabilitySearch.trim().length > 0);
            const isGroupExpanded = (groupKey) => {
              if (isSearching) return true;
              if (Object.prototype.hasOwnProperty.call(expandedTraceabilityEpics, groupKey)) {
                return Boolean(expandedTraceabilityEpics[groupKey]);
              }
              // Auto-expand orphan stories group by default so process non-compliance is immediately visible
              return groupKey === '__UNLINKED_EPIC__';
            };
            const toggleEpicExpand = (groupKey) => {
              setExpandedTraceabilityEpics((prev) => ({
                ...prev,
                [groupKey]: !isGroupExpanded(groupKey)
              }));
            };
            const expandAllEpics = () => {
              const next = {};
              epicGroups.forEach((g) => { next[g.groupKey] = true; });
              setExpandedTraceabilityEpics(next);
            };
            const collapseAllEpics = () => {
              const next = {};
              epicGroups.forEach((g) => { next[g.groupKey] = false; });
              setExpandedTraceabilityEpics(next);
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Traceability KPI Scorecard */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
                  <div className="dashboard-kpi-card">
                    <div className="dashboard-kpi-header">
                      <span style={{ color: '#6554C0', fontWeight: 700 }}>⚡ ÉPICAS E HISTORIAS</span>
                      <span className="dashboard-kpi-pill blue">{totalEpicsCount} Épicas</span>
                    </div>
                    <div className="dashboard-kpi-value" style={{ color: '#6554C0' }}>
                      {totalStoriesCount}
                    </div>
                    <div className="dashboard-kpi-footer">
                      <span>{totalEpicsCount} Épicas · {totalStoriesCount} Historias en el proyecto</span>
                    </div>
                  </div>

                  <div className="dashboard-kpi-card">
                    <div className="dashboard-kpi-header">
                      <span style={{ color: '#0C66E4', fontWeight: 700 }}>🎯 COBERTURA DE HISTORIAS</span>
                      <span className="dashboard-kpi-pill green">{storiesCoveragePct}%</span>
                    </div>
                    <div className="dashboard-kpi-value" style={{ color: '#0C66E4' }}>
                      {storiesCoveragePct}%
                    </div>
                    <div className="dashboard-kpi-footer">
                      <span>{coveredStoriesCount} de {totalStoriesCount} historias vinculadas a pruebas</span>
                    </div>
                  </div>

                  <div
                    className="dashboard-kpi-card"
                    style={
                      orphanStoriesCount > 0
                        ? { border: '1px solid #FFD5D2', background: 'linear-gradient(180deg, #FFFDFC 0%, #FFF7F5 100%)' }
                        : undefined
                    }
                  >
                    <div className="dashboard-kpi-header">
                      <span style={{ color: orphanStoriesCount > 0 ? '#DE350B' : '#1F845A', fontWeight: 700 }}>
                        🚨 HISTORIAS HUÉRFANAS
                      </span>
                      <span className={`dashboard-kpi-pill ${orphanStoriesCount > 0 ? 'red' : 'green'}`}>
                        {orphanStoriesCount > 0 ? `⚠️ ${orphanStoriesPct}% Sin Épica` : '✓ Proceso OK'}
                      </span>
                    </div>
                    <div className="dashboard-kpi-value" style={{ color: orphanStoriesCount > 0 ? '#DE350B' : '#1F845A' }}>
                      {orphanStoriesCount}
                    </div>
                    <div className="dashboard-kpi-footer">
                      <span>
                        {orphanStoriesCount > 0
                          ? `${orphanStoriesCount} de ${totalStoriesCount} historias sin Épica padre (incumplimiento)`
                          : 'Todas las historias tienen Épica padre vinculada'}
                      </span>
                    </div>
                  </div>

                  <div className="dashboard-kpi-card">
                    <div className="dashboard-kpi-header">
                      <span style={{ color: '#DE350B', fontWeight: 700 }}>⚠️ HISTORIAS CON INCIDENCIA</span>
                      <span className="dashboard-kpi-pill red">{rowsWithIssuesCount} Registros</span>
                    </div>
                    <div className="dashboard-kpi-value" style={{ color: '#DE350B' }}>
                      {rowsWithIssuesCount}
                    </div>
                    <div className="dashboard-kpi-footer">
                      <span>{failed} Fallados · {blocked} Bloqueados en ciclos</span>
                    </div>
                  </div>
                </div>

                {/* Traceability Matrix Card */}
                <div className="dashboard-card" style={{ overflowX: 'auto' }}>
                  <div className="dashboard-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <div className="dashboard-card-title">
                        <span style={{ color: '#0C66E4' }}>🔗</span>
                        <span>Matriz Jerárquica de Trazabilidad y Cobertura</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', marginTop: '2px' }}>
                        Haz clic en una Épica para desplegar sus Historias de Usuario, porcentaje de cobertura, Plan, Ciclo, Estado y Defectos
                      </div>
                    </div>

                    {/* Controls: Expand/Collapse + Search filter */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={expandAllEpics}
                        style={{
                          padding: '5px 10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#0C66E4',
                          background: '#E9F2FF',
                          border: '1px solid #CCE0FF',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                      >
                        ▼ Expandir Épicas
                      </button>
                      <button
                        type="button"
                        onClick={collapseAllEpics}
                        style={{
                          padding: '5px 10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#44546F',
                          background: '#F1F2F4',
                          border: '1px solid #DCDFE4',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                      >
                        ▶ Colapsar Épicas
                      </button>
                      <input
                        type="text"
                        placeholder="Buscar por épica, historia, plan, ciclo o bug..."
                        value={dashboardTraceabilitySearch}
                        onChange={(e) => setDashboardTraceabilitySearch(e.target.value)}
                        style={{
                          padding: '6px 12px',
                          fontSize: '12px',
                          border: '1px solid var(--jira-border, #DCDFE4)',
                          borderRadius: '6px',
                          width: '260px'
                        }}
                      />
                      {dashboardTraceabilitySearch && (
                        <button
                          onClick={() => setDashboardTraceabilitySearch('')}
                          style={{ padding: '4px 8px', fontSize: '11px', background: '#F1F2F4', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                  </div>

                  {epicGroups.length > 0 ? (
                    <table className="dashboard-defects-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: '300px' }}>Jerarquía (Épica ➔ Historias de Usuario)</th>
                          <th style={{ minWidth: '175px' }}>Cobertura de Pruebas</th>
                          <th>Plan de Pruebas</th>
                          <th>Ciclo de Pruebas</th>
                          <th>Estado Ejecución</th>
                          <th>Defectos Vinculados</th>
                        </tr>
                      </thead>
                      <tbody>
                        {epicGroups.map((grp) => {
                          const isExpanded = isGroupExpanded(grp.groupKey);
                          const isOrphanGroup = !grp.epicKey;
                          const barColor =
                            grp.coveragePct === 100
                              ? '#1F845A'
                              : grp.coveragePct > 0
                                ? '#0C66E4'
                                : '#8590A2';

                          return (
                            <React.Fragment key={grp.groupKey}>
                              {/* ── FILA PADRE: ÉPICA (O GRUPO DE HISTORIAS HUÉRFANAS) ── */}
                              <tr
                                onClick={() => toggleEpicExpand(grp.groupKey)}
                                style={{
                                  background: isOrphanGroup
                                    ? (isExpanded ? '#FFF4E5' : '#FFF8EE')
                                    : (isExpanded ? '#F7F8F9' : '#FFFFFF'),
                                  cursor: 'pointer',
                                  borderTop: isOrphanGroup ? '2px solid #FFAB00' : '2px solid #EAECEF',
                                  borderLeft: isOrphanGroup ? '4px solid #DE350B' : undefined,
                                  transition: 'background 0.15s ease'
                                }}
                              >
                                {/* 1. Épica Header */}
                                <td style={{ maxWidth: '360px', padding: '10px 12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '20px',
                                        height: '20px',
                                        borderRadius: '4px',
                                        background: isOrphanGroup
                                          ? '#FFEBE6'
                                          : (isExpanded ? '#EAE6FF' : '#F1F2F4'),
                                        color: isOrphanGroup
                                          ? '#DE350B'
                                          : (isExpanded ? '#6554C0' : '#44546F'),
                                        fontSize: '10px',
                                        fontWeight: 800,
                                        flexShrink: 0,
                                        marginTop: '1px'
                                      }}
                                    >
                                      {isExpanded ? '▼' : '▶'}
                                    </span>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                        {grp.epicKey ? (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              e.preventDefault();
                                              openTraceabilityItemModal('epic', grp.epicKey, grp.epicSummary);
                                            }}
                                            className="ads-lozenge ads-lozenge-subtle"
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                              fontWeight: 700,
                                              color: '#6554C0',
                                              background: '#EAE6FF',
                                              padding: '2px 8px',
                                              borderRadius: '4px',
                                              border: '1px solid #DFD8FD',
                                              textDecoration: 'none',
                                              cursor: 'pointer',
                                              whiteSpace: 'nowrap',
                                              fontFamily: 'inherit'
                                            }}
                                            title={`Ver detalle de la Épica ${grp.epicKey} en Test Pulse`}
                                          >
                                            ⚡ {grp.epicKey}
                                          </button>
                                        ) : (
                                          <span
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                              fontWeight: 800,
                                              color: '#AE2E24',
                                              background: '#FFEBE6',
                                              border: '1px solid #FFD5D2',
                                              padding: '2px 8px',
                                              borderRadius: '4px',
                                              fontSize: '11px',
                                              whiteSpace: 'nowrap'
                                            }}
                                            title="Incumplimiento de proceso: Estas historias de usuario no están vinculadas a ninguna Épica"
                                          >
                                            ⚠️ SIN ÉPICA · HISTORIAS HUÉRFANAS
                                          </span>
                                        )}

                                        <span
                                          style={{
                                            fontSize: '10px',
                                            fontWeight: 700,
                                            color: isOrphanGroup ? '#AE2E24' : '#0055CC',
                                            background: isOrphanGroup ? '#FFEBE6' : '#E9F2FF',
                                            border: isOrphanGroup ? '1px solid #FFD5D2' : undefined,
                                            padding: '1px 7px',
                                            borderRadius: '10px',
                                            whiteSpace: 'nowrap'
                                          }}
                                        >
                                          {grp.totalStories} {grp.totalStories === 1 ? 'Historia Huérfana' : (isOrphanGroup ? 'Historias Huérfanas' : 'Historias')}
                                        </span>
                                      </div>

                                      {grp.epicSummary && (
                                        <span
                                          onClick={(e) => {
                                            if (grp.epicKey) {
                                              e.stopPropagation();
                                              openTraceabilityItemModal('epic', grp.epicKey, grp.epicSummary);
                                            }
                                          }}
                                          style={{
                                            fontSize: '12px',
                                            color: isOrphanGroup ? '#AE2E24' : 'var(--jira-dark, #172B4D)',
                                            fontWeight: 700,
                                            lineHeight: 1.35,
                                            cursor: grp.epicKey ? 'pointer' : 'inherit'
                                          }}
                                          title={grp.epicKey ? `Clic para ver detalle de ${grp.epicKey}: ${grp.epicSummary}` : grp.epicSummary}
                                        >
                                          {grp.epicSummary}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>

                                {/* 2. Cobertura de la Épica */}
                                <td style={{ minWidth: '175px' }}>
                                  {grp.totalStories > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                                        <span style={{ fontWeight: 700, color: barColor }}>
                                          {grp.coveragePct}% Cobertura
                                        </span>
                                        <span style={{ color: '#626F86', fontSize: '10px' }}>
                                          {grp.coveredStories}/{grp.totalStories} hist.
                                        </span>
                                      </div>
                                      <div
                                        style={{
                                          width: '100%',
                                          height: '6px',
                                          background: '#EAECEF',
                                          borderRadius: '999px',
                                          overflow: 'hidden'
                                        }}
                                      >
                                        <div
                                          style={{
                                            width: `${grp.coveragePct}%`,
                                            height: '100%',
                                            background: barColor,
                                            borderRadius: '999px',
                                            transition: 'width 0.25s ease'
                                          }}
                                        />
                                      </div>
                                      <span style={{ fontSize: '10px', color: '#626F86' }}>
                                        {grp.executedStories} de {grp.totalStories} con ejecución en ciclo
                                      </span>
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: '11px', color: '#626F86', fontStyle: 'italic' }}>
                                      0% · Sin historias ligadas
                                    </span>
                                  )}
                                </td>

                                {/* 3. Planes de la Épica */}
                                <td style={{ whiteSpace: 'nowrap' }}>
                                  {grp.uniquePlans.length > 0 ? (
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                      {grp.uniquePlans.slice(0, 2).map((pName, i) => (
                                        <span
                                          key={i}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            fontWeight: 700,
                                            color: '#1D7F54',
                                            background: '#E3FCEF',
                                            padding: '2px 8px',
                                            borderRadius: '4px',
                                            fontSize: '11px'
                                          }}
                                        >
                                          📋 {pName}
                                        </span>
                                      ))}
                                      {grp.uniquePlans.length > 2 && (
                                        <span style={{ fontSize: '11px', color: '#626F86', fontWeight: 600 }}>
                                          +{grp.uniquePlans.length - 2} más
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: '11px', color: '#626F86' }}>Sin plan asignado</span>
                                  )}
                                </td>

                                {/* 4. Ciclos de la Épica */}
                                <td style={{ whiteSpace: 'nowrap', fontSize: '11px', color: '#44546F', fontWeight: 600 }}>
                                  {grp.uniqueCycles.length > 0
                                    ? `🔄 ${grp.uniqueCycles.join(', ')}`
                                    : 'Sin ciclo asignado'}
                                </td>

                                {/* 5. Estado Consolidado de la Épica */}
                                <td style={{ whiteSpace: 'nowrap' }}>
                                  <AtlaskitStatusLozenge status={grp.epicStatus} />
                                </td>

                                {/* 6. Defectos Consolidados de la Épica */}
                                <td onClick={(e) => e.stopPropagation()}>
                                  {grp.uniqueBugs.length > 0 ? (
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                      {grp.uniqueBugs.map((b, idx) => (
                                        <button
                                          key={idx}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            setSelectedBug(b);
                                          }}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#DE350B',
                                            background: '#FFEBE6',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            border: '1px solid #FFD5D2',
                                            textDecoration: 'none',
                                            cursor: 'pointer',
                                            fontFamily: 'inherit'
                                          }}
                                          title={`Ver detalle del defecto ${b.key} en Test Pulse`}
                                        >
                                          <span style={{ fontSize: '9px' }}>🐞</span> {b.key}
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <span style={{ color: 'var(--jira-subtle)', fontSize: '11px' }}>0 bugs</span>
                                  )}
                                </td>
                              </tr>

                              {/* ── FILAS HIJAS: HISTORIAS DE USUARIO DE ESTA ÉPICA ── */}
                              {isExpanded && (
                                grp.storyRows.length > 0 ? (
                                  grp.storyRows.map((row) => {
                                    const isCovered = (row.linkedTcCount || 0) > 0 || row.cycleId !== null;
                                    const wfStatus = (row.requirementWorkflowStatus || '').trim();
                                    const wfCat = (row.requirementWorkflowStatusCategory || '').toLowerCase().trim();
                                    const wfLower = wfStatus.toLowerCase();

                                    let wfColors = {
                                      color: '#44546F',
                                      bg: '#F1F2F4',
                                      border: '#DCDFE4'
                                    };
                                    if (
                                      wfCat === 'done' ||
                                      wfLower.includes('finaliz') ||
                                      wfLower.includes('cerrad') ||
                                      wfLower.includes('done') ||
                                      wfLower.includes('complet') ||
                                      wfLower.includes('resuelt') ||
                                      wfLower.includes('aprob') ||
                                      wfLower.includes('producc') ||
                                      wfLower.includes('liber')
                                    ) {
                                      wfColors = { color: '#1F845A', bg: '#DCFFF1', border: '#BAF3DB' };
                                    } else if (
                                      wfLower.includes('bloque') ||
                                      wfLower.includes('imped') ||
                                      wfLower.includes('rechaz') ||
                                      wfLower.includes('cancel')
                                    ) {
                                      wfColors = { color: '#AE2E24', bg: '#FFECEB', border: '#FFD5D2' };
                                    } else if (
                                      wfCat === 'indeterminate' ||
                                      wfLower.includes('curso') ||
                                      wfLower.includes('progres') ||
                                      wfLower.includes('prueb') ||
                                      wfLower.includes('qa') ||
                                      wfLower.includes('test') ||
                                      wfLower.includes('revis') ||
                                      wfLower.includes('review') ||
                                      wfLower.includes('desarroll') ||
                                      wfLower.includes('validac') ||
                                      wfLower.includes('uat')
                                    ) {
                                      wfColors = { color: '#0055CC', bg: '#E9F2FF', border: '#CCE0FF' };
                                    }

                                    return (
                                      <tr
                                        key={row.id}
                                        style={{
                                          background: isOrphanGroup ? '#FFFDF9' : '#FAFBFC',
                                          borderLeft: isOrphanGroup ? '3px solid #DE350B' : '3px solid #6554C0'
                                        }}
                                      >
                                        {/* 1. Historia de Usuario indentada + Estado del Flujo Jira al lado del ID */}
                                        <td style={{ maxWidth: '380px', paddingLeft: '36px' }}>
                                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                            <span style={{ color: isOrphanGroup ? '#DE350B' : '#8590A2', fontWeight: 700, fontSize: '12px', marginTop: '1px' }}>
                                              ↳
                                            </span>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    openTraceabilityItemModal('story', row.requirementKey, row.requirementSummary);
                                                  }}
                                                  className="ads-lozenge ads-lozenge-subtle"
                                                  style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    fontWeight: 700,
                                                    color: '#0065FF',
                                                    background: '#DEEBFF',
                                                    padding: '2px 8px',
                                                    borderRadius: '4px',
                                                    border: '1px solid #B3D4FF',
                                                    textDecoration: 'none',
                                                    cursor: 'pointer',
                                                    width: 'fit-content',
                                                    whiteSpace: 'nowrap',
                                                    fontFamily: 'inherit'
                                                  }}
                                                  title={`Ver detalle de la Historia ${row.requirementKey} en Test Pulse`}
                                                >
                                                  📖 {row.requirementKey}
                                                </button>
                                                {wfStatus && (
                                                  <span
                                                    style={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      fontSize: '10px',
                                                      fontWeight: 700,
                                                      textTransform: 'uppercase',
                                                      letterSpacing: '0.02em',
                                                      color: wfColors.color,
                                                      background: wfColors.bg,
                                                      border: `1px solid ${wfColors.border}`,
                                                      padding: '1px 7px',
                                                      borderRadius: '4px',
                                                      whiteSpace: 'nowrap'
                                                    }}
                                                    title={`Estado en flujo de Jira: ${wfStatus}`}
                                                  >
                                                    {wfStatus}
                                                  </span>
                                                )}
                                                {isOrphanGroup && (
                                                  <span
                                                    style={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: '3px',
                                                      fontSize: '10px',
                                                      fontWeight: 700,
                                                      color: '#AE2E24',
                                                      background: '#FFEBE6',
                                                      border: '1px solid #FFD5D2',
                                                      padding: '1px 6px',
                                                      borderRadius: '4px',
                                                      whiteSpace: 'nowrap'
                                                    }}
                                                    title="Incumplimiento de proceso: Esta historia no tiene una Épica padre asignada en Jira"
                                                  >
                                                    ⚠️ Huérfana (Sin Épica)
                                                  </span>
                                                )}
                                              </div>
                                              {row.requirementSummary && (
                                                <span
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    openTraceabilityItemModal('story', row.requirementKey, row.requirementSummary);
                                                  }}
                                                  style={{
                                                    fontSize: '11px',
                                                    color: 'var(--jira-dark, #172B4D)',
                                                    fontWeight: 500,
                                                    lineHeight: 1.3,
                                                    cursor: 'pointer'
                                                  }}
                                                  title={`Clic para ver detalle de ${row.requirementKey}: ${row.requirementSummary}`}
                                                >
                                                  {row.requirementSummary}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </td>

                                        {/* 2. Cobertura individual de la Historia */}
                                        <td style={{ whiteSpace: 'nowrap' }}>
                                          {isCovered ? (
                                            <span
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                fontSize: '11px',
                                                fontWeight: 700,
                                                color: '#1F845A',
                                                background: '#DCFFF1',
                                                padding: '2px 8px',
                                                borderRadius: '999px'
                                              }}
                                              title="Historia cubierta mediante casos de prueba vinculados"
                                            >
                                              ✓ Cubierta ({row.linkedTcCount || row.executedTcCount || 1} {(row.linkedTcCount || row.executedTcCount || 1) === 1 ? 'caso' : 'casos'})
                                            </span>
                                          ) : (
                                            <span
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                color: '#974F0C',
                                                background: '#FFF7D6',
                                                padding: '2px 8px',
                                                borderRadius: '999px'
                                              }}
                                              title="Esta historia aún no tiene casos de prueba vinculados"
                                            >
                                              ⚠️ Sin cobertura (0 casos)
                                            </span>
                                          )}
                                        </td>

                                        {/* 3. Plan de Pruebas */}
                                        <td style={{ whiteSpace: 'nowrap' }}>
                                          <span
                                            className="ads-lozenge ads-lozenge-subtle"
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                              fontWeight: 700,
                                              color: row.planKey ? '#1D7F54' : '#626F86',
                                              background: row.planKey ? '#E3FCEF' : '#F1F2F4',
                                              padding: '2px 8px',
                                              borderRadius: '4px',
                                              fontSize: '11px',
                                              width: 'fit-content'
                                            }}
                                            title={row.planName}
                                          >
                                            📋 {row.planName}
                                          </span>
                                        </td>

                                        {/* 4. Ciclo de Pruebas */}
                                        <td style={{ whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--jira-dark, #172B4D)', fontWeight: 600 }}>
                                          🔄 {row.cycleName}
                                        </td>

                                        {/* 5. Estado Ejecución */}
                                        <td style={{ whiteSpace: 'nowrap' }}>
                                          <AtlaskitStatusLozenge status={row.status} />
                                        </td>

                                        {/* 6. Defectos Vinculados */}
                                        <td>
                                          {row.bugs.length > 0 ? (
                                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                              {row.bugs.map((b, idx) => (
                                                <button
                                                  key={idx}
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    setSelectedBug(b);
                                                  }}
                                                  style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '3px',
                                                    fontSize: '11px',
                                                    fontWeight: 700,
                                                    color: '#DE350B',
                                                    background: '#FFEBE6',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    border: '1px solid #FFD5D2',
                                                    textDecoration: 'none',
                                                    cursor: 'pointer',
                                                    fontFamily: 'inherit'
                                                  }}
                                                  title={`Ver detalle del defecto ${b.key} en Test Pulse`}
                                                >
                                                  <span style={{ fontSize: '9px' }}>🐞</span> {b.key}
                                                </button>
                                              ))}
                                            </div>
                                          ) : (
                                            <span style={{ color: 'var(--jira-subtle)', fontSize: '11px' }}>0 bugs</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })
                                ) : (
                                  <tr style={{ background: '#FAFBFC', borderLeft: '3px solid #6554C0' }}>
                                    <td colSpan={6} style={{ paddingLeft: '38px', fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>
                                      ↳ Esta épica aún no tiene Historias de Usuario vinculadas en Jira.
                                    </td>
                                  </tr>
                                )
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '3rem', fontSize: '13px' }}>
                      {traceabilityHierarchyLoading
                        ? '⏳ Cargando épicas e historias de usuario del proyecto...'
                        : dashboardTraceabilitySearch
                          ? '🔍 No se encontraron registros de trazabilidad con ese criterio de búsqueda.'
                          : 'No se encontraron épicas ni historias de usuario en este proyecto.'}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ─── Add Widget Catalog Modal ─── */}
          {showAddWidgetModal && (
            <div className="ads-modal-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                className="ads-modal-container"
                style={{
                  width: '750px',
                  maxWidth: '92vw',
                  maxHeight: '85vh',
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '10px',
                  boxShadow: '0 12px 32px rgba(9, 30, 66, 0.25)',
                  overflow: 'hidden'
                }}
              >
                {/* Modal Header */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>🧩</span> Catálogo de Widgets del Dashboard
                    </h3>
                    <div style={{ fontSize: '12px', color: 'var(--jira-subtle, #626F86)', marginTop: '2px' }}>
                      Agrega nuevas tarjetas y paneles analíticos a tu tablero en tiempo real.
                    </div>
                  </div>
                  <button
                    onClick={() => setShowAddWidgetModal(false)}
                    style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--jira-subtle, #626F86)', padding: '4px' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Modal Body - Catalog Grid */}
                <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="widget-catalog-grid">
                    {AVAILABLE_WIDGET_CATALOG.map(item => {
                      const isAdded = dashboardWidgets.some(w => w.type === item.type);
                      return (
                        <div
                          key={item.type}
                          style={{
                            border: isAdded ? '1.5px solid #ABF5D1' : '1px solid var(--jira-border, #DCDFE4)',
                            borderRadius: '8px',
                            padding: '1rem',
                            backgroundColor: isAdded ? '#F3FBF7' : '#FFFFFF',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                              <span style={{ fontSize: '20px' }}>{item.icon}</span>
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: isAdded ? '#E3FCEF' : '#F1F2F4',
                                  color: isAdded ? '#006644' : item.categoryColor || '#626F86'
                                }}
                              >
                                {item.category}
                              </span>
                            </div>
                            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--jira-dark, #172B4D)', marginBottom: '4px' }}>
                              {item.title}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--jira-subtle, #626F86)', lineHeight: 1.4 }}>
                              {item.description}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid rgba(9, 30, 66, 0.06)' }}>
                            <span style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)' }}>
                              Tamaño: {item.defaultWidth === 'full' ? '100% (2 col)' : '50% (1 col)'}
                            </span>
                            {isAdded ? (
                              <button
                                onClick={() => handleRemoveWidgetByType(item.type)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 10px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  background: '#FFEBE6',
                                  color: '#DE350B',
                                  border: '1px solid #FFBDAD',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                ✕ Quitar
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAddWidget(item.type)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 12px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  background: '#0C66E4',
                                  color: '#FFFFFF',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                ➕ Agregar
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Modal Footer */}
                <div style={{ padding: '0.85rem 1.5rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#FAFBFC' }}>
                  <span style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)' }}>
                    {dashboardWidgets.length} de {AVAILABLE_WIDGET_CATALOG.length} widgets activos
                  </span>
                  <button
                    className="btn-primary"
                    onClick={() => setShowAddWidgetModal(false)}
                    style={{ padding: '6px 16px', fontSize: '12px' }}
                  >
                    Listo
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Modal 1: Defectos de Jira sin vincular a pruebas ─── */}
          {showUnlinkedBugsModal && (
            <div className="ads-modal-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                className="ads-modal-container"
                style={{
                  width: '960px',
                  maxWidth: '95vw',
                  maxHeight: '85vh',
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '10px',
                  boxShadow: '0 12px 32px rgba(9, 30, 66, 0.25)',
                  overflow: 'hidden'
                }}
              >
                {/* Modal Header */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>⚠️</span> Defectos de Jira sin Vincular a Pruebas ({projectUnlinkedBugs.length})
                    </h3>
                    <div style={{ fontSize: '12px', color: 'var(--jira-subtle, #626F86)', marginTop: '2px' }}>
                      Incidencias de tipo Bug en el proyecto que no están asociadas a ningún Test Run o caso de prueba.
                    </div>
                  </div>
                  <button
                    onClick={() => setShowUnlinkedBugsModal(false)}
                    style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--jira-subtle, #626F86)', padding: '4px' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Modal Content */}
                <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
                  {projectUnlinkedBugs.length > 0 ? (
                    <table className="dashboard-defects-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '10%' }}>Clave</th>
                          <th style={{ width: '25%' }}>Resumen</th>
                          <th style={{ width: '12%' }}>Versión</th>
                          <th style={{ width: '16%' }}>Fecha / Antigüedad</th>
                          <th style={{ width: '13%' }}>Fecha Estimada</th>
                          <th style={{ width: '9%' }}>Severidad</th>
                          <th style={{ width: '8%' }}>Estado</th>
                          <th style={{ width: '7%', textAlign: 'center' }}>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectUnlinkedBugs.map((bug, idx) => {
                          const { dateStr, timeStr } = formatBugCreatedDate(bug.created);
                          // Pass full bug metadata so reopened bugs reset counter ("Re abierto hace...") and ON HOLD bugs pause clock
                          const age = formatBugAge(bug.created, bug.resolutiondate, isBugDone(bug), bug);
                          const badgeColor = age.tone === 'red' ? '#FFEBE6' : age.tone === 'orange' ? '#FFF0B3' : age.tone === 'green' ? '#E3FCEF' : age.tone === 'onhold' ? '#E9F2FF' : '#F1F2F4';
                          const textColor = age.tone === 'red' ? '#BF2600' : age.tone === 'orange' ? '#172B4D' : age.tone === 'green' ? '#006644' : age.tone === 'onhold' ? '#0C66E4' : '#44546F';

                          return (
                            <tr key={bug.key || idx} onClick={() => setSelectedBug(bug)} style={{ cursor: 'pointer' }}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span
                                    onClick={(e) => { e.stopPropagation(); setSelectedBug(bug); }}
                                    style={{ fontWeight: 700, color: '#0C66E4', cursor: 'pointer' }}
                                    className="hover:underline"
                                    title="Ver detalle del bug en Test Pulse"
                                  >
                                    {bug.key}
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); router.open(`/browse/${bug.key}`); }}
                                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: '#626F86', display: 'inline-flex', alignItems: 'center' }}
                                    title="Abrir directamente en Jira"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                  </button>
                                </div>
                              </td>
                              <td style={{ fontSize: '12px', color: '#172B4D' }}>{bug.summary || 'Sin resumen'}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '11px', fontWeight: 600 }}>
                                  🏷️ {bug.version || 'Sin versión'}
                                </span>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <div style={{ fontSize: '11px', color: '#172B4D', fontWeight: 600 }}>
                                    📅 {dateStr} {timeStr && <span style={{ color: '#626F86', fontWeight: 400, fontSize: '10px' }}>({timeStr})</span>}
                                  </div>
                                  {bug.created && (
                                    <div
                                      style={{
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        background: badgeColor,
                                        color: textColor,
                                        padding: '2px 5px',
                                        borderRadius: '4px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        width: 'fit-content'
                                      }}
                                      title={`Jornada laboral México (L-J 7-18h, V 7-13h): ${age.bHoursFormatted} hrs hábiles`}
                                    >
                                      <span>{age.tone === 'onhold' ? '⏸️' : '⏱️'}</span> <span>{age.label}</span>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {renderBugDueDate(bug.duedate, isBugDone(bug))}
                              </td>
                              <td>
                                <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '11px' }}>
                                  {bug.severity || bug.priority || 'Sin definir'}
                                </span>
                              </td>
                              <td>
                                <span className={`ads-lozenge ${isBugDone(bug) ? 'ads-lozenge-success' : 'ads-lozenge-inprogress'}`} style={{ fontSize: '11px' }}>
                                  {bug.status || 'Abierto'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  className="btn-primary"
                                  onClick={() => {
                                    setLinkingUnlinkedBug(bug);
                                    const initialCycleId = filteredCycles[0]?.id || testCycles[0]?.id || '';
                                    setTargetCycleForBug(initialCycleId);
                                    const cycleObj = (reportData?.cycles || []).find(c => String(c.id) === String(initialCycleId));
                                    const firstExec = cycleObj?.execution?.[0]?.id || '';
                                    setTargetTestForBug(firstExec || testCases[0]?.id || '');
                                  }}
                                  style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                                >
                                  <span>🔗</span> Asociar
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#006644', background: '#E3FCEF', borderRadius: '8px' }}>
                      <span style={{ fontSize: '24px' }}>🟢</span>
                      <div style={{ fontWeight: 700, fontSize: '14px', marginTop: '8px' }}>¡Todos los defectos están vinculados a pruebas!</div>
                      <div style={{ fontSize: '12px', color: '#006644', marginTop: '4px' }}>No hay incidencias tipo Bug huérfanas en el proyecto.</div>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', justifyContent: 'flex-end', background: '#FAFBFC' }}>
                  <button className="btn-secondary" onClick={() => setShowUnlinkedBugsModal(false)}>
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Modal 2: Formulario para Vincular Bug a Caso de Prueba ─── */}
          {linkingUnlinkedBug && (
            <div className="ads-modal-overlay" style={{ zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                className="ads-modal-container"
                style={{
                  width: '560px',
                  maxWidth: '92vw',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '10px',
                  boxShadow: '0 16px 40px rgba(9, 30, 66, 0.3)',
                  overflow: 'hidden'
                }}
              >
                {/* Header */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#172B4D', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>🔗</span> Asociar Defecto {linkingUnlinkedBug.key} a Caso de Prueba
                    </h3>
                    <div style={{ fontSize: '12px', color: '#626F86', marginTop: '2px' }}>
                      {linkingUnlinkedBug.summary}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setLinkingUnlinkedBug(null);
                      setTargetCycleForBug('');
                      setTargetTestForBug('');
                    }}
                    style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#626F86', padding: '4px' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Body */}
                <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#172B4D', marginBottom: '6px', display: 'block' }}>
                      1. Selecciona el Ciclo de Prueba:
                    </label>
                    <select
                      className="form-control"
                      value={targetCycleForBug}
                      onChange={(e) => {
                        const newCycleId = e.target.value;
                        setTargetCycleForBug(newCycleId);
                        const cycleObj = (reportData?.cycles || []).find(c => String(c.id) === String(newCycleId));
                        const firstExec = cycleObj?.execution?.[0]?.id || '';
                        setTargetTestForBug(firstExec || (testCases[0]?.id || ''));
                      }}
                      style={{ width: '100%', padding: '6px 10px', fontSize: '13px' }}
                    >
                      <option value="">-- Selecciona un ciclo --</option>
                      {testCycles.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.summary || c.key || `Ciclo ${c.id}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#172B4D', marginBottom: '6px', display: 'block' }}>
                      2. Selecciona el Caso de Prueba / Ejecución:
                    </label>
                    {(() => {
                      const cycleObj = (reportData?.cycles || []).find(c => String(c.id) === String(targetCycleForBug));
                      const availableExec = cycleObj?.execution || [];
                      return (
                        <select
                          className="form-control"
                          value={targetTestForBug}
                          onChange={(e) => setTargetTestForBug(e.target.value)}
                          disabled={!targetCycleForBug}
                          style={{ width: '100%', padding: '6px 10px', fontSize: '13px' }}
                        >
                          <option value="">-- Selecciona un caso de prueba --</option>
                          {availableExec.length > 0 ? (
                            availableExec.map((ex) => {
                              const tc = findTc(ex.id);
                              const tcKey = tc?.key || ex.key || `TC-${ex.id}`;
                              const tcSummary = tc?.summary || ex.summary || 'Caso de prueba';
                              return (
                                <option key={ex.id} value={ex.id}>
                                  {tcKey} - {tcSummary} ({ex.status || 'Not Run'})
                                </option>
                              );
                            })
                          ) : (
                            testCases.map(tc => (
                              <option key={tc.id} value={tc.id}>
                                {tc.key || `TC-${tc.id}`} - {tc.summary}
                              </option>
                            ))
                          )}
                        </select>
                      );
                    })()}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: '#FAFBFC' }}>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setLinkingUnlinkedBug(null);
                      setTargetCycleForBug('');
                      setTargetTestForBug('');
                    }}
                    disabled={isLinkingUnlinkedBugLoading}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn-primary"
                    onClick={handleConfirmLinkUnlinkedBug}
                    disabled={!targetCycleForBug || !targetTestForBug || isLinkingUnlinkedBugLoading}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    {isLinkingUnlinkedBugLoading ? 'Vinculando...' : '🔗 Confirmar Vinculación'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {renderExecutiveReportModal()}
        </main>
      </div>
    );
}

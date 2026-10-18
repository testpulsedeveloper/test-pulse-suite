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
import PanelDockSwitcher, { usePanelDockPosition, getDockOverlayStyle, getDockContainerStyle, DOCK_SPLIT_WIDTH } from '../components/PanelDockSwitcher';

const APP_VERSION = `v${packageJson.version || '4.5.1'}`;

export default function ExecutionView({ ctx }) {
  const [dockPosition, setDockPosition] = usePanelDockPosition();
  const {
    _uid,
    _uname,
    addNotification,
    availableEnvironments,
    calcScheduleDays,
    cycleScheduleForm,
    cycleTests,
    deferredExecutionSearch,
    execFolderFilter,
    execTesterFilter,
    execTesterFilterSource,
    executionChecked,
    executionCurrentPage,
    executionPageSize,
    executionSearchQuery,
    executionSortBy,
    executionStatusFilter,
    executionTestDetails,
    expandedExecutionTest,
    filteredTestCycles,
    findTc,
    folderPaths,
    formatScenarioHtml,
    formatShortDateEs,
    getExecVal,
    getStatusColor,
    getStatusTextColor,
    groupByFolder,
    groupToolBtnStyle,
    handleAddIteration,
    handleCaptureScreen,
    handleCreateIssue,
    handleCycleSelect,
    handleDeleteEvidence,
    handleDeleteIteration,
    handleIterationChange,
    handleOpenQrCapture,
    handlePreviewEvidence,
    handleRenameEvidence,
    handleRunTest,
    handleStopExecution,
    handleToggleExecutionTest,
    handleUpdateTestStatus,
    handleUploadEvidence,
    isAdmin,
    isCycleInPlan,
    isFolderSidebarVisible,
    isLoadingCycleTests,
    isResizing,
    isTestMine,
    isTestUnassigned,
    matchesFolder,
    matchesTester,
    mergeIterationsPreservingLocal,
    myAccountId,
    openAssignModal,
    planCyclesSummary,
    planScheduleForm,
    renderGroupToolbar,
    renderGroupedList,
    runningTests,
    selectedCycle,
    selectedPlanId,
    setActiveTab,
    setExecFolderFilter,
    setExecTesterFilter,
    setExecTesterFilterSource,
    setExecutionChecked,
    setExecutionCurrentPage,
    setExecutionPageSize,
    setExecutionSearchQuery,
    setExecutionSortBy,
    setExecutionStatusFilter,
    setExpandedExecutionTest,
    setIsResizing,
    setRefreshTrigger,
    setSelectedCycle,
    setSelectedPlanId,
    sidebarWidth,
    testCycles,
    testPlans,
    toggleFolderSidebar
  } = ctx;

    const isPassed = s => normalizeUiStatus(s) === 'Passed';
    const isFailed = s => normalizeUiStatus(s) === 'Failed';
    const isBlocked = s => normalizeUiStatus(s) === 'Blocked';
    const isInProgress = s => normalizeUiStatus(s) === 'In Progress';
    const isNotRun = s => normalizeUiStatus(s) === 'Not Run';

    // Deduplicate cycleTests strictly to guarantee zero duplicate artifacts
    const uniqueCycleTestsMap = new Map();
    cycleTests.forEach(test => {
      const matchKey = test.key || test.testCaseKey || (findTc(test.id)?.key) || String(test.id);
      if (!uniqueCycleTestsMap.has(matchKey)) {
        uniqueCycleTestsMap.set(matchKey, test);
      } else {
        const existing = uniqueCycleTestsMap.get(matchKey);
        const mergedIters = mergeIterationsPreservingLocal(existing.iterations, test.iterations);
        const hasExec = test.status && normalizeUiStatus(test.status) !== 'Not Run';
        const existingHasExec = existing.status && normalizeUiStatus(existing.status) !== 'Not Run';
        if (hasExec && !existingHasExec) {
          uniqueCycleTestsMap.set(matchKey, { ...test, iterations: mergedIters });
        } else {
          uniqueCycleTestsMap.set(matchKey, { ...existing, iterations: mergedIters });
        }
      }
    });
    const deduplicatedCycleTests = Array.from(uniqueCycleTestsMap.values());

    const totalInCycle = deduplicatedCycleTests.length;
    const passedCount = deduplicatedCycleTests.filter(t => isPassed(t.status)).length;
    const failedCount = deduplicatedCycleTests.filter(t => isFailed(t.status)).length;
    const blockedCount = deduplicatedCycleTests.filter(t => isBlocked(t.status)).length;
    const inProgressCount = deduplicatedCycleTests.filter(t => isInProgress(t.status)).length;
    const notRunCount = deduplicatedCycleTests.filter(t => isNotRun(t.status)).length;
    const executedCount = passedCount + failedCount + blockedCount + inProgressCount;
    const completionRate = totalInCycle > 0 ? Math.round(((passedCount + failedCount + blockedCount) / totalInCycle) * 100) : 0;

    const passedPct = totalInCycle > 0 ? ((passedCount / totalInCycle) * 100).toFixed(1) : '0';
    const failedPct = totalInCycle > 0 ? ((failedCount / totalInCycle) * 100).toFixed(1) : '0';
    const blockedPct = totalInCycle > 0 ? ((blockedCount / totalInCycle) * 100).toFixed(1) : '0';
    const inProgressPct = totalInCycle > 0 ? ((inProgressCount / totalInCycle) * 100).toFixed(1) : '0';
    const notRunPct = totalInCycle > 0 ? ((notRunCount / totalInCycle) * 100).toFixed(1) : '0';

    // Tester + folder scope (applied before status/search). "Mine" falls back to all when it came from the
    // project default and the user has nothing assigned/executed in this cycle (avoids an empty screen).
    const mineCount = deduplicatedCycleTests.filter(isTestMine).length;
    const unassignedCount = deduplicatedCycleTests.filter(isTestUnassigned).length;
    const testerFallbackActive = execTesterFilter === 'MINE' && execTesterFilterSource === 'default' && mineCount === 0 && totalInCycle > 0;
    const effectiveTesterFilter = testerFallbackActive ? 'ALL' : execTesterFilter;
    const scopedTests = deduplicatedCycleTests.filter(t => matchesTester(t, effectiveTesterFilter) && matchesFolder(t, execFolderFilter));
    const scopeIsFiltered = effectiveTesterFilter !== 'ALL' || !!execFolderFilter;
    const pill = {
      all: scopedTests.length,
      passed: scopedTests.filter(t => isPassed(t.status)).length,
      failed: scopedTests.filter(t => isFailed(t.status)).length,
      blocked: scopedTests.filter(t => isBlocked(t.status)).length,
      inProgress: scopedTests.filter(t => isInProgress(t.status)).length,
      notRun: scopedTests.filter(t => isNotRun(t.status)).length
    };
    const testerOptions = (() => {
      const m = new Map();
      deduplicatedCycleTests.forEach(t => {
        [t.assignee, t.executedBy].forEach(u => {
          const id = _uid(u);
          const name = _uname(u);
          if (id && name && !m.has(id)) m.set(id, name);
        });
      });
      return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    })();

    // Filter tests
    let filteredTests = scopedTests.filter(test => {
      const isCurrentlyRunning = !!runningTests[test.id];
      if (!isCurrentlyRunning) {
        if (executionStatusFilter === 'Passed' && !isPassed(test.status)) return false;
        if (executionStatusFilter === 'Failed' && !isFailed(test.status)) return false;
        if (executionStatusFilter === 'Blocked' && !isBlocked(test.status)) return false;
        if (executionStatusFilter === 'In Progress' && !isInProgress(test.status)) return false;
        if (executionStatusFilter === 'Not Run' && !isNotRun(test.status)) return false;
      }

      if (deferredExecutionSearch) {
        const q = deferredExecutionSearch.toLowerCase();
        const keyMatch = (test.key || test.testCaseKey || '').toLowerCase().includes(q);
        const runKeyMatch = (test.testRunKey || '').toLowerCase().includes(q);
        const summaryMatch = (test.summary || (findTc(test.id)?.summary) || '').toLowerCase().includes(q);
        if (!keyMatch && !runKeyMatch && !summaryMatch) return false;
      }

      return true;
    });

    // Sort tests (only if explicitly requested by user)
    if (executionSortBy && executionSortBy !== 'none') {
      filteredTests = [...filteredTests].sort((a, b) => {
        if (executionSortBy === 'key-asc') {
          const keyA = a.testCaseKey || a.key || '';
          const keyB = b.testCaseKey || b.key || '';
          return keyA.localeCompare(keyB, undefined, { numeric: true });
        }
        if (executionSortBy === 'key-desc') {
          const keyA = a.testCaseKey || a.key || '';
          const keyB = b.testCaseKey || b.key || '';
          return keyB.localeCompare(keyA, undefined, { numeric: true });
        }
        if (executionSortBy === 'status') {
          const getRank = s => isFailed(s) ? 1 : (isBlocked(s) ? 2 : (isInProgress(s) ? 3 : (isNotRun(s) ? 4 : 5)));
          return getRank(a.status) - getRank(b.status);
        }
        if (executionSortBy === 'summary') {
          const sumA = a.summary || (findTc(a.id)?.summary) || '';
          const sumB = b.summary || (findTc(b.id)?.summary) || '';
          return sumA.localeCompare(sumB);
        }
        return 0;
      });
    }

    // Pagination calculations
    const pageSize = executionPageSize === 'ALL' ? filteredTests.length : Number(executionPageSize);
    const totalPages = Math.max(1, Math.ceil(filteredTests.length / (pageSize || 1)));
    const safeCurrentPage = Math.min(Math.max(1, executionCurrentPage), totalPages);
    const paginatedTests = executionPageSize === 'ALL'
      ? filteredTests
      : filteredTests.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize);

    const currentPlan = testPlans.find(p => String(p.id) === String(selectedPlanId));
    const sidebarCycles = selectedPlanId
      ? filteredTestCycles.filter(c => isCycleInPlan(c, selectedPlanId))
      : filteredTestCycles;
    const activeCycleIdx = selectedCycle
      ? sidebarCycles.findIndex(c => String(c.id) === String(selectedCycle.id))
      : -1;

    // Schedule & Pulse calculations for Plan and Active Cycle
    const nowDate = new Date();
    const todayIso = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;

    const planSched = currentPlan?.schedule || planScheduleForm || {};
    const planDaysCalc = calcScheduleDays(
      planSched.startDate,
      planSched.endDate,
      planSched.excludeWeekends !== false,
      planSched.holidays
    );
    const planTotalBizDays = planDaysCalc.businessDays || 0;
    let planElapsedDays = 0;
    if (planSched.startDate && planSched.endDate && planTotalBizDays > 0) {
      if (todayIso <= planSched.startDate) {
        planElapsedDays = todayIso === planSched.startDate ? 1 : 0;
      } else if (todayIso >= planSched.endDate) {
        planElapsedDays = planTotalBizDays;
      } else {
        planElapsedDays = calcScheduleDays(
          planSched.startDate,
          todayIso,
          planSched.excludeWeekends !== false,
          planSched.holidays
        ).businessDays;
      }
    }
    const planElapsedPct = planTotalBizDays > 0
      ? Math.min(100, Number(((planElapsedDays / planTotalBizDays) * 100).toFixed(1)))
      : 0;
    const planRemainingDays = Math.max(0, planTotalBizDays - planElapsedDays);
    const planShortRange = (planSched.startDate && planSched.endDate)
      ? `${formatShortDateEs(planSched.startDate)} – ${formatShortDateEs(planSched.endDate)}`
      : 'Sin fechas definidas';

    const cycleInList = selectedCycle
      ? (testCycles.find(c => String(c.id) === String(selectedCycle.id)) || selectedCycle)
      : null;
    const cycleSched = (cycleInList?.schedule && (cycleInList.schedule.startDate || cycleInList.schedule.endDate))
      ? cycleInList.schedule
      : (cycleScheduleForm || {});
    const cycleDaysCalc = calcScheduleDays(
      cycleSched.startDate,
      cycleSched.endDate,
      cycleSched.excludeWeekends !== false,
      cycleSched.holidays
    );
    const cycleTotalBizDays = cycleDaysCalc.businessDays || 0;
    let cycleElapsedDays = 0;
    if (cycleSched.startDate && cycleSched.endDate && cycleTotalBizDays > 0) {
      if (todayIso <= cycleSched.startDate) {
        cycleElapsedDays = todayIso === cycleSched.startDate ? 1 : 0;
      } else if (todayIso >= cycleSched.endDate) {
        cycleElapsedDays = cycleTotalBizDays;
      } else {
        cycleElapsedDays = calcScheduleDays(
          cycleSched.startDate,
          todayIso,
          cycleSched.excludeWeekends !== false,
          cycleSched.holidays
        ).businessDays;
      }
    }
    const cycleElapsedPct = cycleTotalBizDays > 0
      ? Math.min(100, Number(((cycleElapsedDays / cycleTotalBizDays) * 100).toFixed(1)))
      : 0;
    const cycleExecPct = totalInCycle > 0
      ? Number(((executedCount / totalInCycle) * 100).toFixed(1))
      : 0;
    const cycleShortRange = (cycleSched.startDate && cycleSched.endDate)
      ? `${formatShortDateEs(cycleSched.startDate)} – ${formatShortDateEs(cycleSched.endDate)}`
      : 'Sin fechas';
    const cycleFullRange = (cycleSched.startDate && cycleSched.endDate)
      ? `${formatShortDateEs(cycleSched.startDate)} – ${formatShortDateEs(cycleSched.endDate, true)}`
      : 'Sin ventana programada';

    const targetDailyRate = cycleTotalBizDays > 0
      ? Math.max(1, Math.round(totalInCycle / cycleTotalBizDays))
      : (totalInCycle || 0);
    const actualDailyRate = cycleElapsedDays > 0
      ? Math.round(executedCount / cycleElapsedDays)
      : executedCount;
    const rateDiffPct = targetDailyRate > 0
      ? Math.round(((actualDailyRate - targetDailyRate) / targetDailyRate) * 100)
      : 0;

    const rawSlackDays = cycleTotalBizDays > 0
      ? Number((((cycleExecPct - cycleElapsedPct) / 100) * cycleTotalBizDays).toFixed(1))
      : 0;
    const slackFormatted = `${rawSlackDays >= 0 ? '+' : ''}${rawSlackDays}d`;

    // Global Plan metrics computed strictly across ALL cycles belonging to the Plan (never changes when clicking between individual cycles)
    const planCycles = selectedPlanId
      ? testCycles.filter(c => isCycleInPlan(c, selectedPlanId))
      : testCycles;
    let planTotalCases = 0;
    let planExecutedCases = 0;
    let planFailedCases = 0;
    planCycles.forEach(c => {
      const cTests = planCyclesSummary[String(c.id)] || c.tests || c.execution || [];
      if (cTests.length > 0) {
        planTotalCases += cTests.length;
        cTests.forEach(t => {
          const st = (t.status || 'UNEXECUTED').toUpperCase();
          if (st === 'PASS' || st === 'PASSED' || st === 'FAIL' || st === 'FAILED' || st === 'BLOCKED') planExecutedCases += 1;
          if (st === 'FAIL' || st === 'FAILED') planFailedCases += 1;
        });
      } else if (c.executionMeta && typeof c.executionMeta.total === 'number') {
        planTotalCases += Number(c.executionMeta.total || 0);
        planExecutedCases += Number(c.executionMeta.passed || 0) + Number(c.executionMeta.failed || 0) + Number(c.executionMeta.blocked || 0);
        planFailedCases += Number(c.executionMeta.failed || 0);
      }
    });
    const planExecPct = planTotalCases > 0
      ? Number(((planExecutedCases / planTotalCases) * 100).toFixed(1))
      : planElapsedPct;
    const planRawSlackDays = (planTotalBizDays > 0 && planTotalCases > 0)
      ? Number((((planExecPct - planElapsedPct) / 100) * planTotalBizDays).toFixed(1))
      : 0;
    const planSlackFormatted = `${planRawSlackDays >= 0 ? '+' : ''}${planRawSlackDays}d`;
    const planFailRatio = planTotalCases > 0 ? (planFailedCases / planTotalCases) * 100 : 0;
    const planScheduleLag = planTotalCases > 0 ? Math.max(0, planElapsedPct - planExecPct) : 0;
    const planHealthPct = planTotalCases > 0
      ? Math.min(100, Math.max(0, Math.round(100 - planFailRatio * 0.6 - planScheduleLag * 0.4)))
      : 100;
    const planHealthStatus = planHealthPct >= 80 ? 'Óptimo' : (planHealthPct >= 55 ? 'Atención' : 'En Riesgo');

    const failRatio = totalInCycle > 0 ? (failedCount / totalInCycle) * 100 : 0;
    const scheduleLag = Math.max(0, cycleElapsedPct - cycleExecPct);
    const cycleRiskPct = totalInCycle > 0
      ? Math.min(100, Math.max(0, Math.round(failRatio * 0.7 + scheduleLag * 0.5)))
      : 0;
    const cycleRiskLabel = cycleRiskPct < 15 ? 'Bajo' : (cycleRiskPct < 35 ? 'Medio' : 'Alto');
    const isPulseOptimal = rawSlackDays >= 0 && failRatio < 20;
    const isPulseWarning = !isPulseOptimal && rawSlackDays >= -1.5 && failRatio < 35;
    const pulseBadgeBg = isPulseOptimal ? '#059669' : (isPulseWarning ? '#D97706' : '#DC2626');
    const pulseStateText = isPulseOptimal ? 'Óptimo' : (isPulseWarning ? 'En Riesgo' : 'Atrasado');

    return (
      <div className="tab-layout" style={{ height: '100%', overflow: 'hidden' }}>
        {/* Left Sidebar: Plans & Cycles (Rediseño Estilo Premium Atlassian Cloud) */}
        {isFolderSidebarVisible && (
          <>
            <aside
              className="execution-sidebar"
              style={{
                width: sidebarWidth,
                flexShrink: 0,
                background: '#FFFFFF',
                borderRight: '1px solid var(--jira-border, #DCDFE4)',
                display: 'flex',
                flexDirection: 'column',
                userSelect: 'none'
              }}
            >
              {/* Current Test Plan Selector Card with Health Indicator */}
              <div style={{
                padding: '14px',
                borderBottom: '1px solid var(--jira-border, #DCDFE4)',
                background: 'linear-gradient(to bottom, #FFFFFF, #FAFBFC)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    PLAN DE PRUEBAS ACTIVO
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={handleCreateIssue}
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#0C66E4',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0
                      }}
                    >
                      + Nuevo
                    </button>
                    <button
                      type="button"
                      onClick={toggleFolderSidebar}
                      title="Ocultar panel lateral"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px',
                        borderRadius: '4px',
                        color: '#626F86',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                        <path d="M15 15l-3-3 3-3" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Select Plan Dropdown Trigger */}
                <div
                  style={{
                    position: 'relative',
                    padding: '10px',
                    background: '#FFFFFF',
                    border: '1px solid #DCDFE4',
                    borderRadius: '8px',
                    boxShadow: '0 1px 2px rgba(9, 30, 66, 0.05)',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s ease'
                  }}
                >
                  <select
                    value={selectedPlanId || ''}
                    onChange={e => { setSelectedPlanId(e.target.value); setSelectedCycle(null); setExecutionCurrentPage(1); }}
                    aria-label="Seleccionar Plan de Pruebas Activo"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer',
                      zIndex: 2
                    }}
                  >
                    <option value="">Seleccionar un Plan de Pruebas...</option>
                    {testPlans.map(plan => (
                      <option key={plan.id} value={plan.id}>{plan.summary}</option>
                    ))}
                  </select>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        background: '#FAF5FF',
                        color: '#7E22CE',
                        border: '1px solid #E9D5FF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {currentPlan ? currentPlan.summary : 'Seleccionar un Plan...'}
                        </div>
                        {!currentPlan && (
                          <div style={{ fontSize: '10px', color: '#626F86', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {testPlans.length} planes disponibles
                          </div>
                        )}
                      </div>
                    </div>
                    <svg width="16" height="16" fill="#626F86" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
                      <path fillRule="evenodd" clipRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                    </svg>
                  </div>

                  {/* Health & Short Window inside Plan Card */}
                  <div style={{
                    marginTop: '10px',
                    paddingTop: '8px',
                    borderTop: '1px solid #F3F4F6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: planHealthPct >= 80 ? '#10B981' : (planHealthPct >= 55 ? '#F59E0B' : '#EF4444'),
                        display: 'inline-block'
                      }} />
                      <span style={{ fontWeight: 600, color: planHealthPct >= 80 ? '#065F46' : (planHealthPct >= 55 ? '#92400E' : '#991B1B') }}>
                        Salud General: {planHealthPct}%
                      </span>
                    </div>
                    <span style={{ fontSize: '10px', color: '#626F86', fontWeight: 500 }}>
                      {planSched.startDate && planSched.endDate ? planShortRange : 'Sin fechas'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Plan Calendar Compact Strip */}
              <div style={{
                padding: '10px 14px',
                background: '#F7F8FA',
                borderBottom: '1px solid var(--jira-border, #DCDFE4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px'
              }}>
                <span style={{ color: '#626F86', fontWeight: 500 }}>
                  Día <strong style={{ fontWeight: 700, color: '#172B4D' }}>{planElapsedDays} de {planTotalBizDays}</strong> ({planElapsedPct}%)
                </span>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '10px',
                  fontWeight: 700,
                  color: planRawSlackDays >= 0 ? '#047857' : '#B45309',
                  background: planRawSlackDays >= 0 ? '#ECFDF5' : '#FFFBEB',
                  border: `1px solid ${planRawSlackDays >= 0 ? '#A7F3D0' : '#FDE68A'}`,
                  padding: '2px 8px',
                  borderRadius: '9999px'
                }}>
                  <span>Holgura {planSlackFormatted}</span>
                </span>
              </div>

              {/* Associated Cycles Header */}
              <div style={{ padding: '12px 14px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 style={{ margin: 0, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#626F86' }}>
                    CICLOS ASOCIADOS
                  </h2>
                  <span style={{ fontSize: '10px', background: '#F1F5F9', color: '#626F86', padding: '1px 6px', fontWeight: 600, borderRadius: '9999px' }}>
                    {sidebarCycles.length}
                  </span>
                </div>
              </div>

              {/* Active Cycle Subheader & Single-Selection Note */}
              <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #F3F4F6' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 style={{ margin: 0, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#626F86' }}>
                      CICLO ACTIVO
                    </h2>
                    <span style={{ fontSize: '10px', background: '#DBEAFE', color: '#0C66E4', padding: '1px 6px', fontWeight: 700, borderRadius: '9999px' }}>
                      ÚNICO
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#626F86', fontWeight: 500 }}>
                    {activeCycleIdx >= 0 ? `${activeCycleIdx + 1} de ${sidebarCycles.length}` : `0 de ${sidebarCycles.length}`}
                  </span>
                </div>
                <div style={{
                  marginTop: '6px',
                  fontSize: '10px',
                  color: '#626F86',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '6px',
                  background: '#F9FAFB',
                  padding: '6px',
                  borderRadius: '4px',
                  border: '1px solid #E5E7EB',
                  lineHeight: 1.35
                }}>
                  <svg width="12" height="12" fill="#0C66E4" viewBox="0 0 20 20" style={{ flexShrink: 0, marginTop: '1px' }}>
                    <path fillRule="evenodd" clipRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" />
                  </svg>
                  <span>Selección de ciclo único (para análisis comparativo multi-ciclo consultar Reports)</span>
                </div>
              </div>

              {/* Scrollable Cycles List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {sidebarCycles.map(cycle => {
                  const isSelected = String(selectedCycle?.id) === String(cycle.id);
                  const cSched = cycle.schedule || {};
                  const cRange = (cSched.startDate && cSched.endDate)
                    ? `${formatShortDateEs(cSched.startDate)} – ${formatShortDateEs(cSched.endDate)}`
                    : '';
                  return (
                    <div
                      key={cycle.id}
                      onClick={() => { handleCycleSelect(cycle); setExecutionCurrentPage(1); }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        background: isSelected ? '#E9F2FF' : 'transparent',
                        color: isSelected ? '#0C66E4' : '#172B4D',
                        fontWeight: isSelected ? 700 : 500,
                        border: isSelected ? '1px solid #B2D4FF' : '1px solid transparent',
                        borderLeft: isSelected ? '4px solid #0C66E4' : '4px solid transparent'
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#F4F5F7'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0, overflow: 'hidden' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isSelected ? '#0C66E4' : '#626F86'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cycle.summary}</span>
                        </div>
                        {isSelected && (
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#0C66E4', flexShrink: 0 }} />
                        )}
                      </div>
                      {cRange && (
                        <div style={{ paddingLeft: '21px', fontSize: '10px', color: isSelected ? '#0747A6' : '#626F86', fontWeight: 500 }}>
                          {cRange}
                        </div>
                      )}
                    </div>
                  );
                })}
                {sidebarCycles.length === 0 && (
                  <div style={{ padding: '16px 8px', textAlign: 'center', fontSize: '11px', color: '#626F86' }}>
                    No hay ciclos asociados a este plan.
                  </div>
                )}
              </div>

              {/* Bottom Persistent Action: + Nuevo Ciclo de Ejecución */}
              <div style={{ padding: '12px', borderTop: '1px solid var(--jira-border, #DCDFE4)', background: '#FFFFFF' }}>
                <button
                  type="button"
                  onClick={handleCreateIssue}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: '#0C66E4',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    boxShadow: '0 1px 2px rgba(9, 30, 66, 0.08)',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#0055CC'}
                  onMouseLeave={e => e.currentTarget.style.background = '#0C66E4'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 4v16m8-8H4" />
                  </svg>
                  <span>+ Nuevo Ciclo de Ejecución</span>
                </button>
              </div>
            </aside>

            {/* Resizer Handle */}
            <div
              onMouseDown={() => setIsResizing(true)}
              style={{
                width: '5px',
                cursor: 'col-resize',
                backgroundColor: isResizing ? 'var(--ds-border-focused, #0C66E4)' : 'transparent',
                zIndex: 10,
                borderRight: '1px solid var(--jira-border, #DCDFE4)',
                marginLeft: '-1px'
              }}
            />
          </>
        )}

        {/* Workspace Area */}
        <main className="execution-workspace">
          {selectedCycle ? (
            <>
              {/* Scrollable Container */}
              <div className="execution-scroll-container">
                <div className="execution-canvas">
                  {/* BEGIN: Clean Minimalist Cycle Header (Tablero Operativo & Semáforo de Ritmo) */}
                  <div style={{
                    background: '#FFFFFF',
                    border: '1px solid var(--jira-border, #DCDFE4)',
                    borderRadius: '12px',
                    padding: '20px',
                    boxShadow: '0 1px 3px rgba(9, 30, 66, 0.06), 0 1px 2px rgba(9, 30, 66, 0.04)'
                  }}>
                    {/* Top Row: Title + Window Info + Actions */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '16px',
                      paddingBottom: '16px',
                      borderBottom: '1px solid var(--jira-border, #DCDFE4)'
                    }}>
                      <div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                          {!isFolderSidebarVisible && (
                            <button
                              type="button"
                              onClick={toggleFolderSidebar}
                              className="btn-secondary"
                              title="Mostrar panel de planes y ciclos"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                fontSize: '11px',
                                padding: '4px 8px',
                                borderRadius: '6px'
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                <line x1="9" y1="3" x2="9" y2="21" />
                                <path d="M13 9l3 3-3 3" />
                              </svg>
                              <span>Planes &amp; Ciclos</span>
                            </button>
                          )}
                          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#626F86' }}>
                            TABLERO OPERATIVO
                          </span>
                          <span style={{ color: '#D1D5DB' }}>•</span>
                          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#172B4D', margin: 0, letterSpacing: '-0.015em' }}>
                            {selectedCycle.summary}
                          </h1>
                          <span style={{
                            padding: '2px 10px',
                            borderRadius: '9999px',
                            fontSize: '12px',
                            fontWeight: 600,
                            background: '#F3F4F6',
                            color: '#172B4D',
                            border: '1px solid #E5E7EB',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}>
                            {isLoadingCycleTests ? 'Sincronizando...' : `${totalInCycle} casos totales`}
                          </span>
                          <span style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: isLoadingCycleTests ? '#F1F2F4' : (completionRate === 100 ? '#DCFFF1' : '#EFF6FF'),
                            color: isLoadingCycleTests ? '#626F86' : (completionRate === 100 ? '#216E4E' : '#0C66E4'),
                            border: `1px solid ${isLoadingCycleTests ? '#DCDFE4' : (completionRate === 100 ? '#7EE2B8' : '#BFDBFE')}`
                          }}>
                            {isLoadingCycleTests ? 'SINCRONIZANDO...' : (completionRate === 100 ? 'COMPLETADO' : 'EN CURSO')}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', fontSize: '12px', color: '#626F86' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <svg width="14" height="14" fill="none" stroke="#626F86" strokeWidth="2" viewBox="0 0 24 24">
                              <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span>
                              Ventana: <strong style={{ color: '#172B4D', fontWeight: 600 }}>{cycleFullRange}</strong>
                              {cycleDaysCalc.naturalDays > 0 ? ` (${cycleDaysCalc.businessDays} días hábiles, ${cycleDaysCalc.naturalDays} naturales)` : ''}
                            </span>
                          </span>
                          {cycleSched.sprint && (
                            <>
                              <span>•</span>
                              <span>{cycleSched.sprint}</span>
                            </>
                          )}
                          <span>•</span>
                          <span style={{ color: '#047857', fontWeight: 500 }}>
                            Sincronizado con Jira{currentPlan ? ` · ${currentPlan.summary}` : ''}
                          </span>
                        </div>
                      </div>

                      {/* Header Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => {
                            clearPersistentCache();
                            queryClient.invalidateQueries();
                            handleCycleSelect(selectedCycle);
                            addNotification({
                              type: 'info',
                              title: 'Sincronizando información',
                              description: `Actualizando datos del ciclo ${selectedCycle.summary} desde Jira...`
                            });
                          }}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#172B4D',
                            background: '#FFFFFF',
                            border: '1px solid #DCDFE4',
                            borderRadius: '6px',
                            boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: 'pointer'
                          }}
                        >
                          <svg width="14" height="14" fill="none" stroke="#0C66E4" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span>Sincronizar Info</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            clearPersistentCache();
                            queryClient.invalidateQueries();
                            setRefreshTrigger(prev => prev + 1);
                            handleCycleSelect(selectedCycle);
                            addNotification({
                              type: 'success',
                              title: 'Estatus sincronizado',
                              description: 'Estados de ejecución actualizados con Jira.'
                            });
                          }}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#172B4D',
                            background: '#FFFFFF',
                            border: '1px solid #DCDFE4',
                            borderRadius: '6px',
                            boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: 'pointer'
                          }}
                        >
                          <svg width="14" height="14" fill="none" stroke="#D97706" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span>Sincronizar Estatus</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const firstTarget = (groupByFolder ? filteredTests : paginatedTests)[0];
                            if (firstTarget) {
                              setExpandedExecutionTest(firstTarget.id);
                            }
                          }}
                          style={{
                            padding: '6px 14px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#FFFFFF',
                            background: '#00875A',
                            border: 'none',
                            borderRadius: '6px',
                            boxShadow: '0 1px 2px rgba(9, 30, 66, 0.08)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: 'pointer'
                          }}
                        >
                          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          <span>Ejecutar Todo</span>
                        </button>
                      </div>
                    </div>

                    {/* SEMÁFORO DE RITMO & PULSO VITAL (2-Column Grid) */}
                    <div style={{
                      marginTop: '16px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                      gap: '16px'
                    }}>
                      {/* PANEL 1: SALUD GLOBAL DEL PLAN DE PRUEBAS */}
                      <div style={{
                        background: 'linear-gradient(to bottom, rgba(250, 245, 255, 0.55), #FFFFFF, rgba(249, 250, 251, 0.55))',
                        border: '1px solid rgba(233, 213, 255, 0.85)',
                        borderRadius: '8px',
                        padding: '16px',
                        boxShadow: '0 1px 2px rgba(9, 30, 66, 0.03)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingBottom: '8px',
                          marginBottom: '10px',
                          borderBottom: '1px solid #F3E8FF',
                          gap: '8px'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#7E22CE', display: 'inline-block' }} />
                            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#581C87' }}>
                              SALUD GLOBAL DEL PLAN DE PRUEBAS
                            </span>
                          </div>
                          <span style={{
                            fontSize: '10px',
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            padding: '2px 8px',
                            background: '#FAF5FF',
                            color: '#7E22CE',
                            border: '1px solid #E9D5FF',
                            borderRadius: '4px',
                            maxWidth: '180px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {currentPlan ? currentPlan.summary : 'SIN PLAN ACTIVO'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', fontSize: '12px' }}>
                            <span style={{ color: '#626F86', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                              <svg width="14" height="14" fill="none" stroke="#7E22CE" strokeWidth="2" viewBox="0 0 24 24">
                                <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <span>Ventana total release:</span>
                              <strong style={{ color: '#172B4D', fontWeight: 600 }}>{planShortRange}</strong>
                            </span>
                            <span style={{ color: '#626F86' }}>
                              Días transcurridos: <strong style={{ color: '#172B4D', fontWeight: 700 }}>Día {planElapsedDays} de {planTotalBizDays}</strong> ({planElapsedPct}%)
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  background: planHealthPct >= 80 ? '#10B981' : (planHealthPct >= 55 ? '#F59E0B' : '#EF4444'),
                                  display: 'inline-block'
                                }} />
                                <span style={{ fontWeight: 700, color: planHealthPct >= 80 ? '#065F46' : (planHealthPct >= 55 ? '#92400E' : '#991B1B') }}>
                                  {planHealthPct}% Salud Global ({planHealthStatus})
                                </span>
                              </div>
                              <span style={{
                                fontWeight: 700,
                                color: planRawSlackDays >= 0 ? '#047857' : '#B45309',
                                background: planRawSlackDays >= 0 ? '#ECFDF5' : '#FFFBEB',
                                border: `1px solid ${planRawSlackDays >= 0 ? '#A7F3D0' : '#FDE68A'}`,
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontSize: '10px'
                              }}>
                                Holgura {planSlackFormatted} {planRawSlackDays >= 0 ? 'favorable' : 'atención'}
                              </span>
                            </div>

                            <div style={{ width: '100%', background: 'rgba(243, 232, 255, 0.7)', height: '8px', borderRadius: '9999px', overflow: 'hidden' }}>
                              <div style={{ background: '#7E22CE', height: '100%', borderRadius: '9999px', width: `${planElapsedPct}%`, transition: 'width 0.3s ease' }} />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#626F86', paddingTop: '2px' }}>
                              <span>Avance del plan: {planElapsedPct}% del cronograma</span>
                              <span>{planRemainingDays} días hábiles restantes de release</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* PANEL 2: SALUD Y RITMO DEL CICLO ACTIVO */}
                      <div style={{
                        background: 'linear-gradient(to bottom, rgba(239, 246, 255, 0.55), rgba(240, 253, 250, 0.35), rgba(236, 253, 245, 0.45))',
                        border: '1px solid rgba(12, 102, 228, 0.3)',
                        borderRadius: '8px',
                        padding: '16px',
                        boxShadow: '0 1px 2px rgba(9, 30, 66, 0.03)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingBottom: '8px',
                          marginBottom: '10px',
                          borderBottom: '1px solid #DBEAFE',
                          gap: '8px',
                          flexWrap: 'wrap'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#0C66E4', display: 'inline-block' }} />
                            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#172B4D' }}>
                              SALUD Y RITMO DEL CICLO ACTIVO
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              color: '#0C66E4',
                              background: 'rgba(219, 234, 254, 0.75)',
                              border: '1px solid #BFDBFE',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              maxWidth: '180px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {selectedCycle.summary} ({cycleTotalBizDays || cycleDaysCalc.naturalDays || 0} DÍAS)
                            </span>
                            <span style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              color: '#0F172A',
                              background: '#F1F5F9',
                              border: '1px solid #CBD5E1',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              whiteSpace: 'nowrap'
                            }} title="Ambiente de ejecución configurado para este ciclo">
                              🌐 {selectedCycle.schedule?.environment || selectedCycle.environment || cycleScheduleForm.environment || availableEnvironments[0]?.name || 'QA'}
                            </span>
                            <span style={{ fontSize: '10px', color: '#626F86', fontWeight: 500 }}>
                              {cycleShortRange}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '3px 10px',
                              borderRadius: '9999px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: pulseBadgeBg,
                              color: '#FFFFFF',
                              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)'
                            }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#FFFFFF', display: 'inline-block' }} />
                              <span>{pulseStateText} · {rawSlackDays >= 0 ? `+${rawSlackDays}` : rawSlackDays} días de holgura</span>
                            </span>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: '#626F86', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <svg width="14" height="14" fill="none" stroke="#0C66E4" strokeWidth="2" viewBox="0 0 24 24">
                                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <span>
                                Límite: <strong style={{ color: '#172B4D' }}>{cycleSched.endDate ? `${formatShortDateEs(cycleSched.endDate)}, 18:00 hrs` : 'Sin definir'}</strong>
                              </span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px', fontSize: '11px' }}>
                              <span style={{ color: '#626F86' }}>
                                Ritmo de ejecución: <strong style={{ color: '#172B4D', fontWeight: 700 }}>{actualDailyRate} casos/día</strong> vs meta {targetDailyRate}/d (
                                <span style={{ color: rateDiffPct >= 0 ? '#047857' : '#B45309', fontWeight: 600 }}>
                                  {rateDiffPct >= 0 ? `+${rateDiffPct}%` : `${rateDiffPct}%`} efectividad
                                </span>)
                              </span>
                              <span style={{ color: cycleRiskPct < 15 ? '#047857' : (cycleRiskPct < 35 ? '#B45309' : '#DC2626'), fontWeight: 700, fontSize: '10px' }}>
                                Riesgo: {cycleRiskPct}% ({cycleRiskLabel})
                              </span>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', paddingTop: '2px' }}>
                              <div style={{ background: 'rgba(255, 255, 255, 0.85)', padding: '6px 8px', borderRadius: '6px', border: '1px solid #E5E7EB' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#626F86', marginBottom: '4px' }}>
                                  <span>Tiempo ciclo consumido</span>
                                  <span style={{ fontWeight: 700, color: '#172B4D' }}>
                                    {cycleElapsedPct}% (Día {cycleElapsedDays}/{cycleTotalBizDays})
                                  </span>
                                </div>
                                <div style={{ width: '100%', background: '#E5E7EB', height: '6px', borderRadius: '9999px', overflow: 'hidden' }}>
                                  <div style={{ background: '#94A3B8', height: '100%', width: `${cycleElapsedPct}%`, transition: 'width 0.3s ease' }} />
                                </div>
                              </div>

                              <div style={{ background: 'rgba(255, 255, 255, 0.85)', padding: '6px 8px', borderRadius: '6px', border: '1px solid #A7F3D0' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#626F86', marginBottom: '4px' }}>
                                  <span>Casos ejecutados</span>
                                  <span style={{ fontWeight: 700, color: '#047857' }}>
                                    {cycleExecPct}% ({executedCount} de {totalInCycle})
                                  </span>
                                </div>
                                <div style={{ width: '100%', background: '#E5E7EB', height: '6px', borderRadius: '9999px', overflow: 'hidden' }}>
                                  <div style={{ background: '#10B981', height: '100%', width: `${cycleExecPct}%`, transition: 'width 0.3s ease' }} />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* END: Clean Minimalist Cycle Header */}

                  {/* Filter Toolbar */}
                  <div className="execution-filter-toolbar">
                    {/* Search & Status Pills */}
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                      {/* Search */}
                      <div style={{ position: 'relative' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#626F86" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}>
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input
                          type="text"
                          value={executionSearchQuery}
                          onChange={e => { setExecutionSearchQuery(e.target.value); setExecutionCurrentPage(1); }}
                          placeholder="Filtrar casos en ejecución..."
                          style={{
                            padding: '0.4rem 0.6rem 0.4rem 2rem',
                            fontSize: '12px',
                            border: '1px solid #DCDFE4',
                            borderRadius: '6px',
                            width: '220px',
                            background: '#FAFBFC',
                            outline: 'none',
                            color: '#172B4D'
                          }}
                        />
                      </div>

                      {/* Status Pills */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderLeft: '1px solid #DCDFE4', paddingLeft: '0.75rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => { setExecutionStatusFilter('ALL'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'ALL' ? 'active' : ''}`}
                          style={{
                            background: '#E9F2FF',
                            color: '#0C66E4',
                            border: '1px solid #85B8FF',
                            fontWeight: executionStatusFilter === 'ALL' ? 800 : 700,
                            boxShadow: executionStatusFilter === 'ALL' ? '0 0 0 2px #FFFFFF, 0 0 0 4px #0C66E4' : '0 1px 2px rgba(9, 30, 66, 0.08)',
                            transform: executionStatusFilter === 'ALL' ? 'translateY(-1px)' : 'none'
                          }}
                        >
                          Todos {isLoadingCycleTests ? '(...)' : `(${pill.all})`}
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Passed'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Passed' ? 'active' : ''}`}
                          style={{
                            background: '#DCFFF1',
                            color: '#216E4E',
                            border: '1px solid #7EE2B8',
                            fontWeight: executionStatusFilter === 'Passed' ? 800 : 700,
                            boxShadow: executionStatusFilter === 'Passed' ? '0 0 0 2px #FFFFFF, 0 0 0 4px #216E4E' : '0 1px 2px rgba(9, 30, 66, 0.08)',
                            transform: executionStatusFilter === 'Passed' ? 'translateY(-1px)' : 'none'
                          }}
                        >
                          Passed {isLoadingCycleTests ? '(...)' : `(${pill.passed})`}
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Failed'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Failed' ? 'active' : ''}`}
                          style={{
                            background: '#FFEBE6',
                            color: '#AE2E24',
                            border: '1px solid #FFBDAD',
                            fontWeight: executionStatusFilter === 'Failed' ? 800 : 700,
                            boxShadow: executionStatusFilter === 'Failed' ? '0 0 0 2px #FFFFFF, 0 0 0 4px #AE2E24' : '0 1px 2px rgba(9, 30, 66, 0.08)',
                            transform: executionStatusFilter === 'Failed' ? 'translateY(-1px)' : 'none'
                          }}
                        >
                          Failed {isLoadingCycleTests ? '(...)' : `(${pill.failed})`}
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Blocked'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Blocked' ? 'active' : ''}`}
                          style={{
                            background: '#FFF0B3',
                            color: '#974F0C',
                            border: '1px solid #F5CD47',
                            fontWeight: executionStatusFilter === 'Blocked' ? 800 : 700,
                            boxShadow: executionStatusFilter === 'Blocked' ? '0 0 0 2px #FFFFFF, 0 0 0 4px #D97706' : '0 1px 2px rgba(9, 30, 66, 0.08)',
                            transform: executionStatusFilter === 'Blocked' ? 'translateY(-1px)' : 'none'
                          }}
                        >
                          Blocked {isLoadingCycleTests ? '(...)' : `(${pill.blocked})`}
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('In Progress'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'In Progress' ? 'active' : ''}`}
                          style={{
                            background: '#DEEBFF',
                            color: '#0055CC',
                            border: '1px solid #85B8FF',
                            fontWeight: executionStatusFilter === 'In Progress' ? 800 : 700,
                            boxShadow: executionStatusFilter === 'In Progress' ? '0 0 0 2px #FFFFFF, 0 0 0 4px #0055CC' : '0 1px 2px rgba(9, 30, 66, 0.08)',
                            transform: executionStatusFilter === 'In Progress' ? 'translateY(-1px)' : 'none'
                          }}
                        >
                          In Progress {isLoadingCycleTests ? '(...)' : `(${pill.inProgress})`}
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Not Run'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Not Run' ? 'active' : ''}`}
                          style={{
                            background: '#F1F2F4',
                            color: '#44546F',
                            border: '1px solid #C1C7D0',
                            fontWeight: executionStatusFilter === 'Not Run' ? 800 : 700,
                            boxShadow: executionStatusFilter === 'Not Run' ? '0 0 0 2px #FFFFFF, 0 0 0 4px #44546F' : '0 1px 2px rgba(9, 30, 66, 0.08)',
                            transform: executionStatusFilter === 'Not Run' ? 'translateY(-1px)' : 'none'
                          }}
                        >
                          Not Run {isLoadingCycleTests ? '(...)' : `(${pill.notRun})`}
                        </button>
                      </div>
                    </div>

                    {/* Right: Sort dropdown */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <select
                        value={executionSortBy}
                        onChange={e => setExecutionSortBy(e.target.value)}
                        style={{
                          padding: '0.35rem 0.6rem',
                          fontSize: '12px',
                          border: '1px solid #DCDFE4',
                          borderRadius: '6px',
                          background: '#FFFFFF',
                          color: '#44546F',
                          outline: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="none">Orden: Como se agregaron (Predeterminado)</option>
                        <option value="key-asc">Ordenar por: Identificador (Asc)</option>
                        <option value="key-desc">Ordenar por: Identificador (Desc)</option>
                        <option value="status">Ordenar por: Estatus de Ejecución</option>
                        <option value="summary">Ordenar por: Título</option>
                      </select>
                    </div>
                  </div>

                  {/* Scope Toolbar: Tester / Folder / Grouping / Assign */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', padding: '0.5rem 0.25rem 0.25rem 0.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <select
                        value={execTesterFilter}
                        onChange={e => { setExecTesterFilter(e.target.value); setExecTesterFilterSource('user'); setExecutionCurrentPage(1); }}
                        title="Filtrar por tester (asignado o quien ejecutó)"
                        style={{ padding: '0.35rem 0.6rem', fontSize: '12px', border: `1px solid ${execTesterFilter !== 'ALL' ? '#0C66E4' : '#DCDFE4'}`, borderRadius: '6px', background: execTesterFilter !== 'ALL' ? '#E9F2FF' : '#FFFFFF', color: '#172B4D', outline: 'none', cursor: 'pointer', fontWeight: 600 }}
                      >
                        <option value="ALL">👥 Todos los testers</option>
                        <option value="MINE">👤 Mis ejecuciones ({mineCount})</option>
                        <option value="UNASSIGNED">⚪ Sin asignar ({unassignedCount})</option>
                        {testerOptions.length > 0 && <option disabled>──────────</option>}
                        {testerOptions.map(t => (
                          <option key={t.id} value={t.id}>{t.name}{t.id === myAccountId ? ' (tú)' : ''}</option>
                        ))}
                      </select>
                      <select
                        value={execFolderFilter}
                        onChange={e => { setExecFolderFilter(e.target.value); setExecutionCurrentPage(1); }}
                        title="Filtrar por carpeta del caso de prueba"
                        style={{ padding: '0.35rem 0.6rem', fontSize: '12px', border: `1px solid ${execFolderFilter ? '#0C66E4' : '#DCDFE4'}`, borderRadius: '6px', background: execFolderFilter ? '#E9F2FF' : '#FFFFFF', color: '#172B4D', outline: 'none', cursor: 'pointer', maxWidth: '260px' }}
                      >
                        <option value="">📁 Todas las carpetas</option>
                        <option value="__ROOT__">Sin carpeta</option>
                        {folderPaths.map(f => (
                          <option key={f.id} value={f.id}>{f.path}</option>
                        ))}
                      </select>
                      {scopeIsFiltered && (
                        <button type="button" style={groupToolBtnStyle} onClick={() => { setExecTesterFilter('ALL'); setExecTesterFilterSource('user'); setExecFolderFilter(''); setExecutionCurrentPage(1); }}>
                          ✕ Limpiar filtros
                        </button>
                      )}
                      {renderGroupToolbar(`exec-${selectedCycle?.id || ''}`, filteredTests)}
                    </div>
                    {isAdmin && executionChecked.size > 0 && (
                      <button
                        type="button"
                        onClick={() => openAssignModal(deduplicatedCycleTests.filter(t => executionChecked.has(t.id)))}
                        style={{ padding: '0.35rem 0.8rem', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: 'none', background: '#0C66E4', color: '#FFFFFF', cursor: 'pointer', height: '28px' }}
                      >
                        👤 Asignar tester ({executionChecked.size})
                      </button>
                    )}
                  </div>
                  {testerFallbackActive && (
                    <div style={{ margin: '0 0.25rem 0.5rem 0.25rem', padding: '0.5rem 0.75rem', fontSize: '12px', background: '#FFF7D6', border: '1px solid #F8E6A0', borderRadius: '6px', color: '#7F5F01' }}>
                      No tienes casos asignados ni ejecutados en este ciclo, por eso se muestran todos.
                    </div>
                  )}

                  {/* Test Cases List */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {isLoadingCycleTests ? (
                      <div style={{ textAlign: 'center', padding: '3.5rem 1.5rem', background: '#FFFFFF', border: '1px solid #DCDFE4', borderRadius: '8px', color: '#626F86' }}>
                        <div style={{ display: 'inline-block', width: '32px', height: '32px', borderRadius: '50%', border: '3px solid #0C66E4', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', marginBottom: '1rem' }} />
                        <p style={{ fontWeight: 600, color: '#172B4D', margin: '0 0 0.4rem 0', fontSize: '14px' }}>Sincronizando casos de prueba del ciclo...</p>
                        <p style={{ fontSize: '12px', color: '#626F86', margin: 0 }}>Obteniendo estados de ejecución oficiales desde Jira.</p>
                      </div>
                    ) : (
                      <>
                        {/* Table / List Header */}
                        <div style={{
                          padding: '0.35rem 1rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#626F86',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase'
                        }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <input
                          type="checkbox"
                          checked={(groupByFolder ? filteredTests : paginatedTests).length > 0 && (groupByFolder ? filteredTests : paginatedTests).every(t => executionChecked.has(t.id))}
                          onChange={e => {
                            const targetList = groupByFolder ? filteredTests : paginatedTests;
                            const newSet = new Set(executionChecked);
                            if (e.target.checked) {
                              targetList.forEach(t => newSet.add(t.id));
                            } else {
                              targetList.forEach(t => newSet.delete(t.id));
                            }
                            setExecutionChecked(newSet);
                          }}
                          style={{ cursor: 'pointer', borderRadius: '3px', accentColor: '#0C66E4' }}
                        />
                        <span>Caso de Prueba</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '0.5rem' }}>
                        <span>Ejecutar</span>
                        <span style={{ minWidth: '105px', textAlign: 'center' }}>Estatus Actual</span>
                      </div>
                    </div>

                    {/* Test Cards */}
                    {renderGroupedList(`exec-${selectedCycle?.id || ''}`, groupByFolder ? filteredTests : paginatedTests, test => {
                      const isExpanded = String(expandedExecutionTest) === String(test.id);
                      const isAuto = getExecVal(test).includes('auto');
                      const testSummary = test.summary || (findTc(test.id)?.summary) || "Caso de prueba";
                      const testCaseKey = test.testCaseKey || test.key;

                      let cardStatusClass = '';
                      if (isPassed(test.status)) cardStatusClass = 'is-passed';
                      else if (isFailed(test.status)) cardStatusClass = 'is-failed';
                      else if (isBlocked(test.status)) cardStatusClass = 'is-blocked';
                      else if (isInProgress(test.status)) cardStatusClass = 'is-inprogress';

                      return (
                        <div
                          key={test.id}
                          className={`execution-test-card ${isExpanded ? 'expanded' : ''} ${cardStatusClass}`}
                          style={isExpanded ? { boxShadow: '0 0 0 2px #0C66E4', backgroundColor: '#F4F8FF' } : undefined}
                        >
                          {/* Card Row Header */}
                          <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                            {/* Left: Chevron, Checkbox, Type Badge, Key, Summary, Bugs, Lock */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                              <button
                                onClick={() => handleToggleExecutionTest(test.id, true)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#626F86', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                                title="Ver detalle del caso en ejecución"
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
                                >
                                  <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                              </button>

                              <input
                                type="checkbox"
                                checked={executionChecked.has(test.id)}
                                onChange={e => {
                                  const newSet = new Set(executionChecked);
                                  if (e.target.checked) newSet.add(test.id);
                                  else newSet.delete(test.id);
                                  setExecutionChecked(newSet);
                                }}
                                style={{ cursor: 'pointer', borderRadius: '3px', accentColor: '#0C66E4', flexShrink: 0 }}
                              />

                              {/* Automation Badge */}
                              {isAuto ? (
                                <span className="planning-badge-auto">⚡ AUTO</span>
                              ) : (
                                <span className="planning-badge-manual">MANUAL</span>
                              )}

                              {/* Key with Jira link */}
                              <span
                                onClick={(e) => { e.stopPropagation(); router.open('/browse/' + testCaseKey); }}
                                style={{ fontWeight: 600, color: '#0C66E4', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}
                                title="Abrir Caso de Prueba en Jira"
                                className="hover:underline font-mono"
                              >
                                {testCaseKey}
                              </span>

                              {test.testRunKey && test.testRunKey !== testCaseKey && (
                                <span
                                  onClick={(e) => { e.stopPropagation(); router.open('/browse/' + test.testRunKey); }}
                                  style={{
                                    fontSize: '11px',
                                    background: '#F1F2F4',
                                    color: '#44546F',
                                    padding: '1px 6px',
                                    borderRadius: '3px',
                                    cursor: 'pointer',
                                    fontWeight: 500,
                                    flexShrink: 0
                                  }}
                                  title="Abrir Test Run (Ejecución) en Jira"
                                >
                                  Run: {test.testRunKey}
                                </span>
                              )}

                              {/* Test Summary */}
                              <span
                                onClick={() => handleToggleExecutionTest(test.id, true)}
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  color: '#172B4D',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  cursor: 'pointer'
                                }}
                                title={testSummary}
                              >
                                {testSummary}
                              </span>

                              {/* Assignee chip */}
                              {_uname(test.assignee) && (
                                <span
                                  title={`Asignado a ${_uname(test.assignee)}`}
                                  style={{ fontSize: '11px', padding: '1px 7px', borderRadius: '10px', flexShrink: 0, fontWeight: 600, background: _uid(test.assignee) === myAccountId ? '#E9F2FF' : '#F1F2F4', color: _uid(test.assignee) === myAccountId ? '#0C66E4' : '#44546F', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                >
                                  👤 {_uid(test.assignee) === myAccountId ? 'Tú' : _uname(test.assignee)}
                                </span>
                              )}

                              {/* Defect Badge */}
                              {test.linkedBugs && test.linkedBugs.length > 0 && (
                                <span
                                  onClick={() => handleToggleExecutionTest(test.id, true)}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    background: '#FFEBE6',
                                    border: '1px solid #FFBDAD',
                                    color: '#BF2600',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    flexShrink: 0
                                  }}
                                  title={`${test.linkedBugs.length} Defecto(s) reportado(s)`}
                                >
                                  <span>{test.linkedBugs.length}</span>
                                  <span>🐞</span>
                                </span>
                              )}

                              {/* Protected / Locked Lock */}
                              {test.lockedAt && (
                                <span title={`Ejecución completada y protegida${isAdmin ? ' (Admin puede resetear)' : ''}`} style={{ fontSize: '11px', opacity: 0.7, flexShrink: 0 }}>
                                  🔒
                                </span>
                              )}
                            </div>

                            {/* Right Actions: Play Button & Status Lozenge */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                              {/* Play / Run Action Button */}
                              <button
                                title={runningTests[test.id] ? 'Detener Ejecución' : 'Iniciar Ejecución'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (runningTests[test.id]) {
                                    handleStopExecution(test.id, test);
                                  } else {
                                    handleRunTest(test.id, test.key, test);
                                    handleToggleExecutionTest(test.id, true);
                                  }
                                }}
                                disabled={runningTests[test.id] === 'capturing' || runningTests[test.id] === 'uploading'}
                                style={{
                                  width: '28px',
                                  height: '28px',
                                  borderRadius: '6px',
                                  background: runningTests[test.id] ? '#FF8B00' : '#0C66E4',
                                  color: '#FFFFFF',
                                  border: 'none',
                                  cursor: (runningTests[test.id] === 'capturing' || runningTests[test.id] === 'uploading') ? 'wait' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  boxShadow: '0 1px 2px rgba(9, 30, 66, 0.1)',
                                  transition: 'background 0.15s ease'
                                }}
                              >
                                {runningTests[test.id] === 'capturing' ? '⏹' :
                                 runningTests[test.id] === 'uploading' ? '⏳' :
                                 runningTests[test.id] ? '⏹' : '▶'}
                              </button>

                              {/* Status Lozenge Selector */}
                              <select
                                className="status-badge"
                                value={isPassed(test.status) ? 'Passed' : (isFailed(test.status) ? 'Failed' : (isBlocked(test.status) ? 'Blocked' : (isInProgress(test.status) ? 'In Progress' : 'Not Run')))}
                                onChange={(e) => handleUpdateTestStatus(test.id, e.target.value)}
                                disabled={!runningTests[test.id]}
                                style={{
                                  backgroundColor: getStatusColor(test.status),
                                  color: getStatusTextColor(test.status),
                                  border: `1px solid ${
                                    isPassed(test.status) ? '#A3FAD0' :
                                    isFailed(test.status) ? '#FFBDAD' :
                                    isBlocked(test.status) ? '#FFE380' :
                                    isInProgress(test.status) ? '#B2D4FF' : '#DCDFE4'
                                  }`,
                                  cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                  opacity: !runningTests[test.id] ? 0.75 : 1,
                                  padding: '0.35rem 0.5rem',
                                  width: '110px',
                                  height: '28px',
                                  boxSizing: 'border-box',
                                  textAlign: 'center',
                                  textAlignLast: 'center',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  borderRadius: '4px'
                                }}
                              >
                                <option value="Not Run" style={{ backgroundColor: '#FFFFFF', color: '#172B4D' }}>Not Run</option>
                                <option value="In Progress" style={{ backgroundColor: '#DEEBFF', color: '#0747A6' }}>In Progress</option>
                                <option value="Passed" style={{ backgroundColor: '#DCFFF1', color: '#216E4E' }}>Passed</option>
                                <option value="Failed" style={{ backgroundColor: '#FFEBE6', color: '#BF2600' }}>Failed</option>
                                <option value="Blocked" style={{ backgroundColor: '#FFF0B3', color: '#172B4D' }}>Blocked</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    }, (items) => `${items.filter(t => isPassed(t.status)).length}✓ · ${items.filter(t => isFailed(t.status)).length}✗ · ${items.filter(t => isNotRun(t.status)).length} pendientes`)}

                    {/* Modal / Panel Acoplable de Detalle del Caso en Ejecución */}
                    {expandedExecutionTest && (() => {
                      const modalTest = deduplicatedCycleTests.find(t => String(t.id) === String(expandedExecutionTest)) || cycleTests.find(t => String(t.id) === String(expandedExecutionTest));
                      if (!modalTest) return null;
                      const modalTestCaseKey = modalTest.testCaseKey || modalTest.key;
                      const modalTestSummary = (modalTest.summary || '').replace(/^\[Test Run\]\s*/i, '');
                      const modalIsAuto = modalTest.isAutomated || modalTest.testType === 'Automated';
                      const isTestRunning = !!runningTests[modalTest.id];

                      const modalMatchedTc = (typeof findTc === 'function') ? (findTc(modalTestCaseKey) || findTc(modalTest.id)) : null;
                      const modalScenarioDesc = modalTest.description || modalMatchedTc?.description || (executionTestDetails[modalTest.id]?.type === 'continuous' ? executionTestDetails[modalTest.id]?.content : null);

                      // Lista navegable de casos activos en el ciclo para botones Anterior / Siguiente
                      const navTestsList = (Array.isArray(filteredTests) && filteredTests.length > 0) ? filteredTests : deduplicatedCycleTests;
                      const currentModalTestIdx = navTestsList.findIndex(t => String(t.id) === String(modalTest.id));
                      const prevModalTest = currentModalTestIdx > 0 ? navTestsList[currentModalTestIdx - 1] : null;
                      const nextModalTest = (currentModalTestIdx >= 0 && currentModalTestIdx < navTestsList.length - 1) ? navTestsList[currentModalTestIdx + 1] : null;

                      const iterEvKeys = new Set();
                      (modalTest.iterations || []).forEach(it => {
                        (it.evidences || []).forEach(e => {
                          if (e) {
                            const id = typeof e === 'object' ? (e.id ? String(e.id) : '') : String(e);
                            const name = typeof e === 'object' ? (e.filename ? String(e.filename) : '') : '';
                            const url = typeof e === 'object' ? (e.url ? String(e.url) : '') : '';
                            if (id) iterEvKeys.add(id);
                            if (name) iterEvKeys.add(name);
                            if (url) iterEvKeys.add(url);
                          }
                        });
                      });
                      const rawEvs = (modalTest.evidences || (modalTest.evidence ? [modalTest.evidence] : [])).filter(ev => {
                        if (!ev) return false;
                        const id = typeof ev === 'object' ? (ev.id ? String(ev.id) : '') : String(ev);
                        const name = typeof ev === 'object' ? (ev.filename ? String(ev.filename) : '') : '';
                        const url = typeof ev === 'object' ? (ev.url ? String(ev.url) : '') : '';
                        if (id && iterEvKeys.has(id)) return false;
                        if (name && iterEvKeys.has(name)) return false;
                        if (url && iterEvKeys.has(url)) return false;
                        return true;
                      });

                      return (
                        <div
                          onClick={() => {
                            if (dockPosition === 'center') setExpandedExecutionTest(null);
                          }}
                          onPaste={(e) => {
                            if (!isTestRunning) return;
                            const items = e.clipboardData?.items;
                            if (!items) return;
                            for (let i = 0; i < items.length; i++) {
                              if (items[i].type.indexOf('image') !== -1 || items[i].kind === 'file') {
                                const file = items[i].getAsFile();
                                if (file) {
                                  handleUploadEvidence(modalTest.id, modalTest.key, file);
                                  break;
                                }
                              }
                            }
                          }}
                          style={getDockOverlayStyle(dockPosition, 1200)}
                        >
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={getDockContainerStyle(dockPosition, {
                              centerMaxWidth: '980px',
                              centerWidth: '100%',
                              centerHeight: 'auto',
                              centerMinHeight: '420px',
                              centerMaxHeight: '88vh',
                              drawerWidth: DOCK_SPLIT_WIDTH,
                              drawerMinWidth: '420px',
                              backgroundColor: '#F7F8F9'
                            })}
                          >
                            {/* Top Modal Bar: Case Info + Play + General Status + Nav + Dock + Close */}
                            <div
                              style={{
                                backgroundColor: '#FFFFFF',
                                borderBottom: '1px solid #DCDFE4',
                                padding: '12px 18px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '12px',
                                flexWrap: 'wrap',
                                flexShrink: 0
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                                {modalIsAuto ? (
                                  <span className="planning-badge-auto">⚡ AUTO</span>
                                ) : (
                                  <span className="planning-badge-manual">MANUAL</span>
                                )}

                                <span
                                  onClick={() => router.open('/browse/' + modalTestCaseKey)}
                                  style={{ fontWeight: 700, color: '#0C66E4', cursor: 'pointer', fontSize: '12px', flexShrink: 0, fontFamily: 'monospace' }}
                                  title="Abrir Caso de Prueba en Jira"
                                  className="hover:underline"
                                >
                                  {modalTestCaseKey}
                                </span>

                                {modalTest.testRunKey && modalTest.testRunKey !== modalTestCaseKey && (
                                  <span
                                    onClick={() => router.open('/browse/' + modalTest.testRunKey)}
                                    style={{
                                      fontSize: '11px',
                                      background: '#F1F2F4',
                                      color: '#44546F',
                                      padding: '2px 7px',
                                      borderRadius: '4px',
                                      border: '1px solid #DCDFE4',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                      flexShrink: 0
                                    }}
                                    title="Abrir Test Run (Ejecución) en Jira"
                                  >
                                    Run: {modalTest.testRunKey}
                                  </span>
                                )}

                                <span
                                  style={{
                                    fontSize: '13px',
                                    fontWeight: 700,
                                    color: '#172B4D',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                  title={modalTestSummary}
                                >
                                  {modalTestSummary}
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                                {/* Navegación Rápida: Caso Anterior / Siguiente */}
                                {navTestsList.length > 1 && (
                                  <div
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      backgroundColor: '#F7F8F9',
                                      border: '1px solid #DCDFE4',
                                      borderRadius: '6px',
                                      padding: '2px',
                                      gap: '2px'
                                    }}
                                    title="Navegar entre los casos de prueba del ciclo actual sin cerrar el panel"
                                  >
                                    <button
                                      type="button"
                                      disabled={!prevModalTest}
                                      onClick={() => prevModalTest && handleToggleExecutionTest(prevModalTest.id, true)}
                                      title={prevModalTest ? `Caso anterior: ${prevModalTest.testCaseKey || prevModalTest.key}` : 'Primer caso de la lista'}
                                      style={{
                                        border: 'none',
                                        background: 'transparent',
                                        color: prevModalTest ? '#172B4D' : '#B3BAC5',
                                        cursor: prevModalTest ? 'pointer' : 'not-allowed',
                                        padding: '3px 6px',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        lineHeight: 1
                                      }}
                                    >
                                      ▲ Ant
                                    </button>
                                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#626F86', padding: '0 4px', fontFamily: 'monospace' }}>
                                      {currentModalTestIdx >= 0 ? `${currentModalTestIdx + 1}/${navTestsList.length}` : navTestsList.length}
                                    </span>
                                    <button
                                      type="button"
                                      disabled={!nextModalTest}
                                      onClick={() => nextModalTest && handleToggleExecutionTest(nextModalTest.id, true)}
                                      title={nextModalTest ? `Siguiente caso: ${nextModalTest.testCaseKey || nextModalTest.key}` : 'Último caso de la lista'}
                                      style={{
                                        border: 'none',
                                        background: 'transparent',
                                        color: nextModalTest ? '#172B4D' : '#B3BAC5',
                                        cursor: nextModalTest ? 'pointer' : 'not-allowed',
                                        padding: '3px 6px',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        lineHeight: 1
                                      }}
                                    >
                                      Sig ▼
                                    </button>
                                  </div>
                                )}

                                {/* Play / Stop Button inside Modal */}
                                <button
                                  title={isTestRunning ? 'Detener Ejecución' : 'Iniciar Ejecución'}
                                  onClick={() => {
                                    if (isTestRunning) {
                                      handleStopExecution(modalTest.id, modalTest);
                                    } else {
                                      handleRunTest(modalTest.id, modalTest.key, modalTest);
                                    }
                                  }}
                                  disabled={runningTests[modalTest.id] === 'capturing' || runningTests[modalTest.id] === 'uploading'}
                                  style={{
                                    width: '30px',
                                    height: '30px',
                                    borderRadius: '6px',
                                    background: isTestRunning ? '#FF8B00' : '#0C66E4',
                                    color: '#FFFFFF',
                                    border: 'none',
                                    cursor: (runningTests[modalTest.id] === 'capturing' || runningTests[modalTest.id] === 'uploading') ? 'wait' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 1px 2px rgba(9, 30, 66, 0.12)',
                                    transition: 'background 0.15s ease'
                                  }}
                                >
                                  {runningTests[modalTest.id] === 'capturing' ? '⏹' :
                                   runningTests[modalTest.id] === 'uploading' ? '⏳' :
                                   isTestRunning ? '⏹' : '▶'}
                                </button>

                                {/* General Status Selector */}
                                <select
                                  className="status-badge"
                                  value={isPassed(modalTest.status) ? 'Passed' : (isFailed(modalTest.status) ? 'Failed' : (isBlocked(modalTest.status) ? 'Blocked' : (isInProgress(modalTest.status) ? 'In Progress' : 'Not Run')))}
                                  onChange={(e) => handleUpdateTestStatus(modalTest.id, e.target.value)}
                                  disabled={!isTestRunning}
                                  style={{
                                    backgroundColor: getStatusColor(modalTest.status),
                                    color: getStatusTextColor(modalTest.status),
                                    border: `1px solid ${
                                      isPassed(modalTest.status) ? '#A3FAD0' :
                                      isFailed(modalTest.status) ? '#FFBDAD' :
                                      isBlocked(modalTest.status) ? '#FFE380' :
                                      isInProgress(modalTest.status) ? '#B2D4FF' : '#DCDFE4'
                                    }`,
                                    cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                    opacity: !isTestRunning ? 0.75 : 1,
                                    padding: '0.35rem 0.6rem',
                                    width: '114px',
                                    height: '30px',
                                    boxSizing: 'border-box',
                                    textAlign: 'center',
                                    textAlignLast: 'center',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    borderRadius: '6px'
                                  }}
                                >
                                  <option value="Not Run" style={{ backgroundColor: '#FFFFFF', color: '#172B4D' }}>Not Run</option>
                                  <option value="In Progress" style={{ backgroundColor: '#DEEBFF', color: '#0747A6' }}>In Progress</option>
                                  <option value="Passed" style={{ backgroundColor: '#DCFFF1', color: '#216E4E' }}>Passed</option>
                                  <option value="Failed" style={{ backgroundColor: '#FFEBE6', color: '#BF2600' }}>Failed</option>
                                  <option value="Blocked" style={{ backgroundColor: '#FFF0B3', color: '#172B4D' }}>Blocked</option>
                                </select>

                                {/* Selector de Posición: Izquierda | Centro | Derecha */}
                                <PanelDockSwitcher dockPosition={dockPosition} onChange={setDockPosition} />

                                {/* Close Modal Button */}
                                <button
                                  onClick={() => setExpandedExecutionTest(null)}
                                  title="Cerrar detalle"
                                  style={{
                                    width: '30px',
                                    height: '30px',
                                    borderRadius: '6px',
                                    border: '1px solid #DCDFE4',
                                    background: '#FFFFFF',
                                    color: '#44546F',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '14px',
                                    fontWeight: 700
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>

                            {/* Modal Content Area */}
                            <div style={{ padding: '20px', overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                              {/* 1. DESCRIPCIÓN DEL ESCENARIO (FORMATO HTML CONTINUO) */}
                              <section
                                style={{
                                  backgroundColor: '#FFFFFF',
                                  borderRadius: '8px',
                                  border: '1px solid #DCDFE4',
                                  boxShadow: '0 1px 2px rgba(9, 30, 66, 0.05)',
                                  flexShrink: 0
                                }}
                              >
                                <div
                                  style={{
                                    padding: '12px 16px',
                                    borderBottom: '1px solid #DCDFE4',
                                    backgroundColor: '#F7F8F9',
                                    borderTopLeftRadius: '8px',
                                    borderTopRightRadius: '8px',
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '12px'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div
                                      style={{
                                        width: '24px',
                                        height: '24px',
                                        borderRadius: '4px',
                                        backgroundColor: '#E9F2FF',
                                        color: '#0C66E4',
                                        border: '1px solid #85B8FF',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0
                                      }}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                        <polyline points="14 2 14 8 20 8"></polyline>
                                        <line x1="16" y1="13" x2="8" y2="13"></line>
                                        <line x1="16" y1="17" x2="8" y2="17"></line>
                                        <line x1="10" y1="9" x2="8" y2="9"></line>
                                      </svg>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                      <h2 style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: '#091E42', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Descripción del Escenario (Formato HTML Continuo)
                                      </h2>
                                      <span
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          padding: '2px 8px',
                                          borderRadius: '4px',
                                          fontSize: '10px',
                                          fontWeight: 700,
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.03em',
                                          backgroundColor: '#F1F2F4',
                                          color: '#44546F',
                                          border: '1px solid #DCDFE4'
                                        }}
                                      >
                                        Texto Enriquecido
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div
                                  className="execution-scenario-content"
                                  style={{
                                    padding: '16px 20px',
                                    backgroundColor: '#FFFFFF',
                                    borderBottomLeftRadius: '8px',
                                    borderBottomRightRadius: '8px',
                                    fontSize: '12px',
                                    color: '#172B4D',
                                    lineHeight: 1.65,
                                    overflowX: 'hidden'
                                  }}
                                >
                                  {modalScenarioDesc ? (
                                    <div dangerouslySetInnerHTML={{ __html: formatScenarioHtml(adfToHtml(modalScenarioDesc)) }} />
                                  ) : (
                                    <span style={{ color: '#626F86', fontStyle: 'italic', fontSize: '12px' }}>
                                      Sin descripción registrada para este caso de prueba en Jira.
                                    </span>
                                  )}

                                  {/* Pasos Tradicionales (si existen en el caso) */}
                                  {executionTestDetails[modalTest.id] && executionTestDetails[modalTest.id].type === 'traditional' && executionTestDetails[modalTest.id].content.length > 0 && (
                                    <div style={{ marginTop: modalScenarioDesc ? '14px' : '0' }}>
                                      <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {executionTestDetails[modalTest.id].content.map((step, idx) => (
                                          <li key={idx} style={{ paddingLeft: '4px' }}>
                                            <div dangerouslySetInnerHTML={{ __html: formatScenarioHtml(adfToHtml(step.action)) }} />
                                            {step.expectedResult && (
                                              <div style={{ fontSize: '11px', color: '#44546F', marginTop: '2px' }}>
                                                <strong>Resultado esperado:</strong>{' '}
                                                <span dangerouslySetInnerHTML={{ __html: formatScenarioHtml(adfToHtml(step.expectedResult)) }} />
                                              </div>
                                            )}
                                            {step.data && (
                                              <div style={{ marginTop: '6px', display: 'inline-flex', alignItems: 'center', gap: '8px', backgroundColor: '#F8FAFC', padding: '4px 10px', borderRadius: '4px', border: '1px solid #EBECF0' }}>
                                                <span style={{ fontSize: '11px', color: '#626F86', fontWeight: 500 }}>Datos de prueba:</span>
                                                <span style={{ backgroundColor: '#FFFFFF', color: '#091E42', fontFamily: 'monospace', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', border: '1px solid #DCDFE4', fontSize: '11px' }}>
                                                  {step.data}
                                                </span>
                                              </div>
                                            )}
                                          </li>
                                        ))}
                                      </ol>
                                    </div>
                                  )}

                                  {/* Escenarios BDD (si existen en el caso) */}
                                  {executionTestDetails[modalTest.id] && executionTestDetails[modalTest.id].type === 'bdd' && executionTestDetails[modalTest.id].content.length > 0 && (
                                    <div style={{ marginTop: modalScenarioDesc ? '14px' : '0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                      {executionTestDetails[modalTest.id].content.map((scenario, idx) => (
                                        <div key={idx} style={{ background: '#F8FAFC', padding: '10px 12px', borderRadius: '6px', border: '1px solid #DCDFE4' }}>
                                          <h5 style={{ margin: '0 0 6px 0', fontSize: '12px', fontWeight: 700, color: '#172B4D' }}>{scenario.title}</h5>
                                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '11px', color: '#172B4D' }}>{scenario.gherkin}</pre>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </section>

                              {/* 2. EVIDENCIAS ADJUNTAS */}
                              <section
                                style={{
                                  backgroundColor: '#FFFFFF',
                                  borderRadius: '8px',
                                  border: '1px solid #DCDFE4',
                                  boxShadow: '0 1px 2px rgba(9, 30, 66, 0.05)',
                                  padding: '16px',
                                  flexShrink: 0
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '12px',
                                    paddingBottom: '12px',
                                    borderBottom: '1px solid #EBECF0',
                                    marginBottom: '16px'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 700, color: '#44546F', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                    </svg>
                                    <span>Evidencias Adjuntas</span>
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.03em',
                                        backgroundColor: '#F1F2F4',
                                        color: '#172B4D',
                                        border: '1px solid #DCDFE4'
                                      }}
                                    >
                                      {rawEvs.length} {rawEvs.length === 1 ? 'Archivo' : 'Archivos'}
                                    </span>
                                  </div>

                                  {/* Botones de Acción de Evidencias */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {/* Adjuntar Archivo */}
                                    <label
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        backgroundColor: '#FFFFFF',
                                        color: '#172B4D',
                                        border: '1px solid #DCDFE4',
                                        padding: '6px 12px',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                        boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)',
                                        ...(!isTestRunning ? { opacity: 0.55, pointerEvents: 'none' } : {})
                                      }}
                                      title={isTestRunning ? 'Adjuntar Archivo de Evidencia' : 'Inicia la ejecución (Play) para adjuntar evidencias'}
                                    >
                                      <input
                                        disabled={!isTestRunning}
                                        type="file"
                                        style={{ display: 'none' }}
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files.length > 0) {
                                            handleUploadEvidence(modalTest.id, modalTest.key, e.target.files[0]);
                                          }
                                        }}
                                      />
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                      </svg>
                                      <span>Archivo</span>
                                    </label>

                                    {/* Grabar Pantalla / Video */}
                                    <button
                                      type="button"
                                      disabled={!isTestRunning}
                                      onClick={() => handleCaptureScreen(modalTest.id, modalTest.key)}
                                      title={isTestRunning ? 'Grabar pantalla o capturar pantalla' : 'Inicia la ejecución (Play) para grabar pantalla'}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        backgroundColor: '#FFFFFF',
                                        color: '#172B4D',
                                        border: '1px solid #DCDFE4',
                                        padding: '6px 12px',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                        boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)',
                                        ...(!isTestRunning ? { opacity: 0.55, pointerEvents: 'none' } : {})
                                      }}
                                    >
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="#F43F5E" stroke="#F43F5E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polygon points="23 7 16 12 23 17 23 7"></polygon>
                                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                                      </svg>
                                      <span>Grabar</span>
                                    </button>

                                    {/* Celular (QR) */}
                                    <button
                                      type="button"
                                      disabled={!isTestRunning}
                                      onClick={() => handleOpenQrCapture(modalTest)}
                                      title={isTestRunning ? 'Escanear QR para capturar con cámara del celular' : 'Inicia la ejecución (Play) para capturar con celular'}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        backgroundColor: '#E9F2FF',
                                        color: '#0C66E4',
                                        border: '1px solid #85B8FF',
                                        padding: '6px 12px',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                        boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)',
                                        ...(!isTestRunning ? { opacity: 0.55, pointerEvents: 'none' } : {})
                                      }}
                                    >
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                                        <line x1="12" y1="18" x2="12.01" y2="18"></line>
                                      </svg>
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="7" height="7"></rect>
                                        <rect x="14" y="3" width="7" height="7"></rect>
                                        <rect x="14" y="14" width="7" height="7"></rect>
                                        <rect x="3" y="14" width="7" height="7"></rect>
                                      </svg>
                                      <span>Celular (QR)</span>
                                    </button>
                                  </div>
                                </div>

                                {/* Grid de Evidencias Previsualizadas + Dropzone */}
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                                    gap: '12px'
                                  }}
                                >
                                  {rawEvs.map((ev, idx) => {
                                    const evId = typeof ev === 'string' ? ev : ev.id;
                                    const evName = typeof ev === 'string' ? `evidence_${evId}.jpg` : (ev.filename || `evidence_${evId}.jpg`);
                                    const isVideoOrPdf = /\.(mp4|webm|mov|pdf)$/i.test(evName);
                                    return (
                                      <div
                                        key={idx}
                                        onClick={() => handlePreviewEvidence(ev)}
                                        style={{
                                          border: '1px solid #DCDFE4',
                                          borderRadius: '6px',
                                          padding: '8px 10px',
                                          backgroundColor: '#F1F2F4',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '12px',
                                          cursor: 'pointer',
                                          position: 'relative'
                                        }}
                                        title={ev.note ? `${evName} — Nota: ${ev.note}` : evName}
                                      >
                                        <div
                                          style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '4px',
                                            backgroundColor: '#E2E8F0',
                                            border: '1px solid #DCDFE4',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                            color: '#64748B'
                                          }}
                                        >
                                          {isVideoOrPdf ? (
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                              <polyline points="14 2 14 8 20 8"></polyline>
                                            </svg>
                                          ) : (
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                              <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                              <polyline points="21 15 16 10 5 21"></polyline>
                                            </svg>
                                          )}
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {evName}
                                          </p>
                                          <span style={{ fontSize: '10px', color: '#626F86', fontWeight: 500, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {ev.note ? `💬 ${ev.note}` : 'Evidencia adjunta • Clic para ver'}
                                          </span>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handlePreviewEvidence(ev);
                                            }}
                                            title="Ver evidencia"
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: '4px', display: 'flex', alignItems: 'center' }}
                                          >
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                              <circle cx="12" cy="12" r="3"></circle>
                                            </svg>
                                          </button>
                                          <button
                                            type="button"
                                            disabled={!isTestRunning}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const newName = prompt('Nuevo nombre para la evidencia:', evName);
                                              if (newName && newName !== evName) {
                                                handleRenameEvidence(modalTest.id, idx, newName, undefined);
                                              }
                                            }}
                                            title="Renombrar evidencia"
                                            style={{ background: 'none', border: 'none', cursor: !isTestRunning ? 'not-allowed' : 'pointer', color: '#64748B', padding: '4px', fontSize: '11px', opacity: !isTestRunning ? 0.45 : 1 }}
                                          >
                                            ✏️
                                          </button>
                                          <button
                                            type="button"
                                            disabled={!isTestRunning}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteEvidence(modalTest.id, evId, idx, undefined);
                                            }}
                                            title="Eliminar evidencia"
                                            style={{ background: 'none', border: 'none', cursor: !isTestRunning ? 'not-allowed' : 'pointer', color: '#E2483D', padding: '4px', display: 'flex', alignItems: 'center', opacity: !isTestRunning ? 0.45 : 1 }}
                                          >
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <polyline points="3 6 5 6 21 6"></polyline>
                                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                            </svg>
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}

                                  {/* Dropzone rápido para arrastrar más evidencias */}
                                  <label
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (!isTestRunning) return;
                                      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                                        handleUploadEvidence(modalTest.id, modalTest.key, e.dataTransfer.files[0]);
                                      }
                                    }}
                                    style={{
                                      gridColumn: rawEvs.length === 0 ? '1 / -1' : 'span 2',
                                      border: '2px dashed #DCDFE4',
                                      borderRadius: '6px',
                                      padding: '10px 14px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '8px',
                                      fontSize: '12px',
                                      color: '#626F86',
                                      backgroundColor: '#FFFFFF',
                                      cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                      minHeight: '56px',
                                      transition: 'border-color 0.15s ease, color 0.15s ease',
                                      ...(!isTestRunning ? { opacity: 0.6 } : {})
                                    }}
                                    title={isTestRunning ? 'Haz clic o arrastra un archivo aquí, o presiona Ctrl+V' : 'Inicia la ejecución (Play) para adjuntar evidencias'}
                                  >
                                    <input
                                      disabled={!isTestRunning}
                                      type="file"
                                      style={{ display: 'none' }}
                                      onChange={(e) => {
                                        if (e.target.files && e.target.files.length > 0) {
                                          handleUploadEvidence(modalTest.id, modalTest.key, e.target.files[0]);
                                        }
                                      }}
                                    />
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="16 16 12 12 8 16"></polyline>
                                      <line x1="12" y1="12" x2="12" y2="21"></line>
                                      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path>
                                      <polyline points="16 16 12 12 8 16"></polyline>
                                    </svg>
                                    <span style={{ fontWeight: 500 }}>
                                      Arrastra capturas de pantalla adicionales aquí o presiona Ctrl+V
                                    </span>
                                  </label>
                                </div>
                              </section>

                              {/* Sección 3: ITERACIONES (DATA-DRIVEN) */}
                              {(() => {
                                const iters = Array.isArray(modalTest.iterations) ? modalTest.iterations : [];
                                const iterPassedCount = iters.filter(it => isPassed(it.status)).length;
                                const iterFailedCount = iters.filter(it => isFailed(it.status)).length;
                                const iterBlockedCount = iters.filter(it => isBlocked(it.status)).length;
                                const iterTotal = iters.length;
                                const iterPassPct = iterTotal > 0 ? Math.round((iterPassedCount / iterTotal) * 100) : 0;
                                const iterFailPct = iterTotal > 0 ? Math.round((iterFailedCount / iterTotal) * 100) : 0;
                                const iterBlockPct = iterTotal > 0 ? Math.round((iterBlockedCount / iterTotal) * 100) : 0;

                                return (
                                  <section
                                    style={{
                                      backgroundColor: '#FFFFFF',
                                      borderRadius: '8px',
                                      border: '1px solid #DCDFE4',
                                      padding: '16px 20px',
                                      boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)',
                                      flexShrink: 0
                                    }}
                                  >
                                    {/* Header & Section Controls */}
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        flexWrap: 'wrap',
                                        gap: '12px',
                                        paddingBottom: '12px'
                                      }}
                                    >
                                      {/* Title & Stats Badge */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            fontSize: '12px',
                                            fontFamily: 'monospace',
                                            fontWeight: 700,
                                            color: '#334155',
                                            textTransform: 'uppercase',
                                            letterSpacing: '-0.01em'
                                          }}
                                        >
                                          <span style={{ color: '#8247E5', fontWeight: 900 }}>&gt;_</span>
                                          <span>Iteraciones (Data-Driven)</span>
                                        </div>

                                        {/* Execution summary chip */}
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            backgroundColor: '#F1F5F9',
                                            color: '#334155',
                                            padding: '2px 8px',
                                            borderRadius: '9999px',
                                            fontSize: '11px',
                                            fontWeight: 500,
                                            border: '1px solid #E2E8F0'
                                          }}
                                        >
                                          <span style={{ fontWeight: 600, color: '#1E293B' }}>
                                            {iterTotal} {iterTotal === 1 ? 'iteración' : 'iteraciones'}
                                          </span>
                                          <span style={{ color: '#CBD5E1' }}>|</span>
                                          <span style={{ color: '#047857', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ width: '6px', height: '6px', borderRadius: '9999px', backgroundColor: '#10B981' }} />
                                            {iterPassedCount}
                                          </span>
                                          <span style={{ color: '#BE123C', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ width: '6px', height: '6px', borderRadius: '9999px', backgroundColor: '#F43F5E' }} />
                                            {iterFailedCount}
                                          </span>
                                          {iterBlockedCount > 0 && (
                                            <span style={{ color: '#B45309', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                              <span style={{ width: '6px', height: '6px', borderRadius: '9999px', backgroundColor: '#F59E0B' }} />
                                              {iterBlockedCount}
                                            </span>
                                          )}
                                        </div>

                                        {/* Progress mini-bar */}
                                        <div
                                          style={{
                                            display: 'flex',
                                            width: '64px',
                                            height: '6px',
                                            backgroundColor: '#E2E8F0',
                                            borderRadius: '9999px',
                                            overflow: 'hidden'
                                          }}
                                          title={`${iterPassPct}% Aprobado`}
                                        >
                                          <div style={{ backgroundColor: '#10B981', width: `${iterPassPct}%`, height: '100%' }} />
                                          <div style={{ backgroundColor: '#F43F5E', width: `${iterFailPct}%`, height: '100%' }} />
                                          <div style={{ backgroundColor: '#F59E0B', width: `${iterBlockPct}%`, height: '100%' }} />
                                        </div>
                                      </div>

                                      {/* Actions toolbar (Compacta/Expandida omitted per user request) */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <button
                                          type="button"
                                          disabled={!isTestRunning}
                                          onClick={() => handleAddIteration(modalTest)}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '5px 12px',
                                            fontSize: '12px',
                                            fontWeight: 500,
                                            color: '#FFFFFF',
                                            backgroundColor: '#0C66E4',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                            opacity: !isTestRunning ? 0.55 : 1,
                                            boxShadow: '0 1px 2px rgba(9, 30, 66, 0.08)'
                                          }}
                                          title={!isTestRunning ? 'Inicia la ejecución (Play) para agregar iteraciones' : 'Agregar nueva iteración'}
                                        >
                                          <span style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1 }}>+</span>
                                          <span>Agregar iteración</span>
                                        </button>
                                      </div>
                                    </div>

                                    {/* High-Density Iteration Matrix Table */}
                                    <div
                                      style={{
                                        border: '1px solid #DCDFE4',
                                        borderRadius: '6px',
                                        overflow: 'hidden',
                                        backgroundColor: '#FFFFFF',
                                        boxShadow: '0 1px 2px rgba(9, 30, 66, 0.03)'
                                      }}
                                    >
                                      <div style={{ overflowX: 'auto' }}>
                                        <table
                                          style={{
                                            width: '100%',
                                            textAlign: 'left',
                                            fontSize: '12px',
                                            borderCollapse: 'collapse'
                                          }}
                                        >
                                          <thead>
                                            <tr
                                              style={{
                                                backgroundColor: '#F8FAFC',
                                                color: '#475569',
                                                borderBottom: '1px solid #DCDFE4',
                                                fontSize: '11px',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em',
                                                fontWeight: 600
                                              }}
                                            >
                                              <th style={{ padding: '8px 12px', width: '48px', textAlign: 'center' }} scope="col">#</th>
                                              <th style={{ padding: '8px 12px', width: '132px' }} scope="col">Estado</th>
                                              <th style={{ padding: '8px 12px', width: '190px' }} scope="col">Datos de Entrada (Input)</th>
                                              <th style={{ padding: '8px 12px', minWidth: '240px' }} scope="col">Resultado Actual / Observaciones</th>
                                              <th style={{ padding: '8px 12px', minWidth: '200px' }} scope="col">Evidencias</th>
                                              <th style={{ padding: '8px 12px', width: '116px', textAlign: 'right' }} scope="col">Acciones</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {iters.length === 0 ? (
                                              <tr>
                                                <td
                                                  colSpan={6}
                                                  style={{
                                                    padding: '18px 16px',
                                                    textAlign: 'center',
                                                    color: '#64748B',
                                                    fontSize: '12px',
                                                    borderBottom: '1px solid #F1F5F9'
                                                  }}
                                                >
                                                  No hay iteraciones registradas para este caso. Haz clic en <strong>+ Agregar iteración</strong> o <strong>+ Añadir fila</strong> para evaluar múltiples entradas de datos.
                                                </td>
                                              </tr>
                                            ) : (
                                              iters.map((iter, idx) => {
                                                const iterPass = isPassed(iter.status);
                                                const iterFail = isFailed(iter.status);
                                                const iterBlock = isBlocked(iter.status);
                                                const iterInProg = isInProgress(iter.status);
                                                const selectBorder = iterPass ? '#6EE7B7' : iterFail ? '#FDA4AF' : iterBlock ? '#FCD34D' : iterInProg ? '#85B8FF' : '#CBD5E1';
                                                const selectBg = iterPass ? '#ECFDF5' : iterFail ? '#FFF1F2' : iterBlock ? '#FFFBEB' : iterInProg ? '#DEEBFF' : '#F8FAFC';
                                                const selectColor = iterPass ? '#065F46' : iterFail ? '#9F1239' : iterBlock ? '#92400E' : iterInProg ? '#0747A6' : '#334155';
                                                const chevronColor = iterPass ? '#047857' : iterFail ? '#BE123C' : iterBlock ? '#B45309' : iterInProg ? '#0055CC' : '#64748B';
                                                const iterEvs = Array.isArray(iter.evidences) ? iter.evidences : [];

                                                return (
                                                  <tr
                                                    key={iter.id || idx}
                                                    tabIndex={0}
                                                    onPaste={(e) => {
                                                      if (!isTestRunning) return;
                                                      const items = e.clipboardData?.items;
                                                      if (!items) return;
                                                      for (let i = 0; i < items.length; i++) {
                                                        if (items[i].type.indexOf('image') !== -1) {
                                                          e.preventDefault();
                                                          e.stopPropagation();
                                                          const blob = items[i].getAsFile();
                                                          if (blob) {
                                                            const file = new File(
                                                              [blob],
                                                              `captura_iter${idx + 1}_${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
                                                              { type: blob.type || 'image/png' }
                                                            );
                                                            handleUploadEvidence(modalTest.id, modalTest.key, file, iter.id);
                                                          }
                                                          break;
                                                        }
                                                      }
                                                    }}
                                                    style={{
                                                      borderBottom: idx < iters.length - 1 ? '1px solid #E2E8F0' : 'none',
                                                      transition: 'background-color 0.15s ease',
                                                      outline: 'none'
                                                    }}
                                                  >
                                                    {/* Iteration Index */}
                                                    <td
                                                      style={{
                                                        padding: '8px 12px',
                                                        textAlign: 'center',
                                                        fontWeight: 600,
                                                        color: '#475569',
                                                        fontFamily: 'monospace'
                                                      }}
                                                    >
                                                      #{idx + 1}
                                                    </td>

                                                    {/* Status Selector Dropdown */}
                                                    <td style={{ padding: '8px 12px' }}>
                                                      <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
                                                        <select
                                                          disabled={!isTestRunning}
                                                          value={iter.status || 'Not Run'}
                                                          onChange={(e) => handleIterationChange(modalTest, iter.id, 'status', e.target.value)}
                                                          style={{
                                                            width: '100%',
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            padding: '4px 24px 4px 10px',
                                                            borderRadius: '4px',
                                                            border: `1px solid ${selectBorder}`,
                                                            backgroundColor: selectBg,
                                                            color: selectColor,
                                                            cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                                            appearance: 'none',
                                                            WebkitAppearance: 'none',
                                                            MozAppearance: 'none',
                                                            outline: 'none'
                                                          }}
                                                        >
                                                          <option value="Not Run">Not Run</option>
                                                          <option value="Passed">Passed ✔</option>
                                                          <option value="Failed">Failed ✘</option>
                                                          <option value="Blocked">Blocked ⛔</option>
                                                        </select>
                                                        <span
                                                          style={{
                                                            position: 'absolute',
                                                            top: 0,
                                                            bottom: 0,
                                                            right: '8px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            pointerEvents: 'none',
                                                            color: chevronColor,
                                                            fontSize: '10px'
                                                          }}
                                                        >
                                                          ▼
                                                        </span>
                                                      </div>
                                                    </td>

                                                    {/* Test Parameters Data (Compact code badge with inline edit) */}
                                                    <td style={{ padding: '8px 12px' }}>
                                                      <div
                                                        style={{
                                                          display: 'inline-flex',
                                                          alignItems: 'center',
                                                          gap: '6px',
                                                          padding: '3px 8px',
                                                          borderRadius: '4px',
                                                          backgroundColor: '#F1F5F9',
                                                          border: '1px solid #E2E8F0',
                                                          color: '#1E293B',
                                                          fontFamily: 'monospace',
                                                          fontSize: '11px',
                                                          width: '100%',
                                                          boxSizing: 'border-box'
                                                        }}
                                                      >
                                                        <span style={{ color: '#94A3B8', fontSize: '9px', fontWeight: 700, flexShrink: 0 }}>&gt;_</span>
                                                        <input
                                                          type="text"
                                                          disabled={!isTestRunning}
                                                          placeholder="Parámetros / Input..."
                                                          value={iter.expectedData || ''}
                                                          onChange={(e) => handleIterationChange(modalTest, iter.id, 'expectedData', e.target.value, { debounceMs: 600 })}
                                                          onBlur={(e) => handleIterationChange(modalTest, iter.id, 'expectedData', e.target.value, { flush: true })}
                                                          title={iter.expectedData || 'Datos de entrada (Input)'}
                                                          style={{
                                                            border: 'none',
                                                            background: 'transparent',
                                                            color: '#1E293B',
                                                            fontFamily: 'monospace',
                                                            fontSize: '11px',
                                                            width: '100%',
                                                            outline: 'none',
                                                            padding: 0,
                                                            margin: 0,
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis'
                                                          }}
                                                        />
                                                      </div>
                                                    </td>

                                                    {/* Current Result / Observations (Clean Inline Editable Field) */}
                                                    <td style={{ padding: '8px 12px' }}>
                                                      <input
                                                        type="text"
                                                        disabled={!isTestRunning}
                                                        placeholder="Detalles del resultado en esta iteración..."
                                                        value={iter.actualResult || ''}
                                                        onChange={(e) => handleIterationChange(modalTest, iter.id, 'actualResult', e.target.value, { debounceMs: 600 })}
                                                        onBlur={(e) => handleIterationChange(modalTest, iter.id, 'actualResult', e.target.value, { flush: true })}
                                                        style={{
                                                          width: '100%',
                                                          boxSizing: 'border-box',
                                                          padding: '4px 8px',
                                                          fontSize: '12px',
                                                          color: iterFail ? '#BE123C' : '#334155',
                                                          fontWeight: iterFail ? 500 : 400,
                                                          backgroundColor: 'transparent',
                                                          border: '1px solid transparent',
                                                          borderRadius: '4px',
                                                          outline: 'none',
                                                          transition: 'border-color 0.15s ease, background-color 0.15s ease'
                                                        }}
                                                        onFocus={(e) => {
                                                          e.target.style.borderColor = '#0C66E4';
                                                          e.target.style.backgroundColor = '#FFFFFF';
                                                        }}
                                                        onBlurCapture={(e) => {
                                                          e.target.style.borderColor = 'transparent';
                                                          e.target.style.backgroundColor = 'transparent';
                                                        }}
                                                      />
                                                    </td>

                                                    {/* Attached Evidences (Chips or Dashed Attach Button) */}
                                                    <td style={{ padding: '8px 12px' }}>
                                                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                                        {iterEvs.length > 0 ? (
                                                          iterEvs.map((ev, evIdx) => {
                                                            const evId = typeof ev === 'string' ? ev : ev.id;
                                                            const evName = typeof ev === 'string' ? `evidence_${evId}.jpg` : (ev.filename || `evidence_${evId}.jpg`);
                                                            return (
                                                              <span
                                                                key={evIdx}
                                                                style={{
                                                                  display: 'inline-flex',
                                                                  alignItems: 'center',
                                                                  gap: '4px',
                                                                  backgroundColor: '#F1F5F9',
                                                                  color: '#334155',
                                                                  fontSize: '11px',
                                                                  fontFamily: 'monospace',
                                                                  padding: '2px 8px',
                                                                  borderRadius: '4px',
                                                                  border: '1px solid #CBD5E1'
                                                                }}
                                                              >
                                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                                                </svg>
                                                                <span
                                                                  onClick={() => handlePreviewEvidence(ev)}
                                                                  title={ev.note ? `${evName} — Nota: ${ev.note}` : evName}
                                                                  style={{
                                                                    maxWidth: '110px',
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis',
                                                                    whiteSpace: 'nowrap',
                                                                    cursor: 'pointer'
                                                                  }}
                                                                >
                                                                  {evName}
                                                                </span>
                                                                <button
                                                                  type="button"
                                                                  disabled={!isTestRunning}
                                                                  onClick={() => {
                                                                    const newName = prompt('Nuevo nombre para la evidencia:', evName);
                                                                    if (newName && newName !== evName) {
                                                                      handleRenameEvidence(modalTest.id, evIdx, newName, iter.id);
                                                                    }
                                                                  }}
                                                                  title="Editar nombre"
                                                                  style={{
                                                                    marginLeft: '2px',
                                                                    background: 'none',
                                                                    border: 'none',
                                                                    padding: '0 2px',
                                                                    color: '#94A3B8',
                                                                    cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center'
                                                                  }}
                                                                >
                                                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                                                                  </svg>
                                                                </button>
                                                                <button
                                                                  type="button"
                                                                  disabled={!isTestRunning}
                                                                  onClick={() => handleDeleteEvidence(modalTest.id, evId, evIdx, iter.id)}
                                                                  title="Eliminar adjunto"
                                                                  style={{
                                                                    background: 'none',
                                                                    border: 'none',
                                                                    padding: '0 2px',
                                                                    color: '#94A3B8',
                                                                    cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                                                    fontSize: '10px',
                                                                    lineHeight: 1
                                                                  }}
                                                                >
                                                                  ✕
                                                                </button>
                                                              </span>
                                                            );
                                                          })
                                                        ) : (
                                                          <label
                                                            style={{
                                                              display: 'inline-flex',
                                                              alignItems: 'center',
                                                              gap: '4px',
                                                              fontSize: '11px',
                                                              color: '#94A3B8',
                                                              padding: '2px 8px',
                                                              borderRadius: '4px',
                                                              border: '1px dashed #CBD5E1',
                                                              cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                                              opacity: !isTestRunning ? 0.55 : 1
                                                            }}
                                                            title={!isTestRunning ? 'Inicia la ejecución (Play) para adjuntar evidencia' : 'Adjuntar evidencia a esta iteración'}
                                                          >
                                                            <input
                                                              disabled={!isTestRunning}
                                                              type="file"
                                                              style={{ display: 'none' }}
                                                              onChange={(e) => {
                                                                if (e.target.files && e.target.files.length > 0) {
                                                                  handleUploadEvidence(modalTest.id, modalTest.key, e.target.files[0], iter.id);
                                                                }
                                                              }}
                                                            />
                                                            <span style={{ fontSize: '11px', fontWeight: 700, lineHeight: 1 }}>+</span>
                                                            <span>Adjuntar evidencia</span>
                                                          </label>
                                                        )}
                                                      </div>
                                                    </td>

                                                    {/* Quick Action Buttons */}
                                                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                                        {/* Adjuntar archivo local */}
                                                        <label
                                                          title="Adjuntar archivo local"
                                                          style={{
                                                            padding: '5px',
                                                            color: '#94A3B8',
                                                            borderRadius: '4px',
                                                            cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            opacity: !isTestRunning ? 0.5 : 1
                                                          }}
                                                        >
                                                          <input
                                                            disabled={!isTestRunning}
                                                            type="file"
                                                            style={{ display: 'none' }}
                                                            onChange={(e) => {
                                                              if (e.target.files && e.target.files.length > 0) {
                                                                handleUploadEvidence(modalTest.id, modalTest.key, e.target.files[0], iter.id);
                                                              }
                                                            }}
                                                          />
                                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                                          </svg>
                                                        </label>

                                                        {/* Capturar pantalla */}
                                                        <button
                                                          type="button"
                                                          disabled={!isTestRunning}
                                                          onClick={() => handleCaptureScreen(modalTest.id, modalTest.key, iter.id)}
                                                          title="Capturar pantalla"
                                                          style={{
                                                            padding: '5px',
                                                            color: '#94A3B8',
                                                            background: 'none',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            opacity: !isTestRunning ? 0.5 : 1
                                                          }}
                                                        >
                                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                                            <polyline points="21 15 16 10 5 21"></polyline>
                                                          </svg>
                                                        </button>

                                                        {/* Subir desde celular (QR) */}
                                                        <button
                                                          type="button"
                                                          disabled={!isTestRunning}
                                                          onClick={() => handleOpenQrCapture(modalTest, iter.id, 'Iteración #' + (idx + 1))}
                                                          title="Subir desde celular (QR)"
                                                          style={{
                                                            padding: '5px',
                                                            color: '#0C66E4',
                                                            background: 'none',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            opacity: !isTestRunning ? 0.5 : 1
                                                          }}
                                                        >
                                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                                                            <line x1="12" y1="18" x2="12.01" y2="18"></line>
                                                          </svg>
                                                        </button>

                                                        <span style={{ height: '12px', width: '1px', backgroundColor: '#E2E8F0', margin: '0 2px' }} />

                                                        {/* Eliminar iteración */}
                                                        <button
                                                          type="button"
                                                          disabled={!isTestRunning}
                                                          onClick={() => handleDeleteIteration(modalTest, iter.id)}
                                                          title={`Eliminar iteración #${idx + 1}`}
                                                          style={{
                                                            padding: '5px',
                                                            color: '#94A3B8',
                                                            background: 'none',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            opacity: !isTestRunning ? 0.5 : 1
                                                          }}
                                                        >
                                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="3 6 5 6 21 6"></polyline>
                                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                          </svg>
                                                        </button>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                );
                                              })
                                            )}
                                          </tbody>
                                        </table>
                                      </div>

                                      {/* Quick Inline Add Iteration Row (Footer) */}
                                      <div
                                        style={{
                                          backgroundColor: 'rgba(248, 250, 252, 0.7)',
                                          padding: '8px 16px',
                                          borderTop: '1px solid #DCDFE4',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          flexWrap: 'wrap',
                                          gap: '8px',
                                          fontSize: '12px',
                                          color: '#626F86'
                                        }}
                                      >
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="#8247E5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <line x1="12" y1="16" x2="12" y2="12"></line>
                                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                          </svg>
                                          <span>
                                            Consejo: Puedes pegar directamente una captura con <strong>Ctrl+V</strong> sobre la iteración activa.
                                          </span>
                                        </span>

                                        <button
                                          type="button"
                                          disabled={!isTestRunning}
                                          onClick={() => handleAddIteration(modalTest)}
                                          style={{
                                            color: '#0C66E4',
                                            fontWeight: 500,
                                            fontSize: '12px',
                                            background: 'none',
                                            border: 'none',
                                            padding: 0,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            cursor: !isTestRunning ? 'not-allowed' : 'pointer',
                                            opacity: !isTestRunning ? 0.55 : 1
                                          }}
                                        >
                                          <span style={{ fontSize: '12px', fontWeight: 700, lineHeight: 1 }}>+</span>
                                          <span>Añadir fila</span>
                                        </button>
                                      </div>
                                    </div>
                                  </section>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {paginatedTests.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '3rem 1.5rem', background: '#FFFFFF', border: '1px solid #DCDFE4', borderRadius: '8px', color: '#626F86' }}>
                        {deduplicatedCycleTests.length === 0 ? (
                          <>
                            <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>📭</div>
                            <p style={{ fontWeight: 600, color: '#172B4D', margin: '0 0 0.5rem 0' }}>No hay casos asignados a este ciclo.</p>
                            <p style={{ fontSize: '12px', margin: '0 0 1rem 0' }}>Ve a la pestaña de <strong>Planning</strong> para agregar casos de prueba a este ciclo.</p>
                            <button
                              className="btn-primary"
                              style={{ padding: '0.4rem 1rem', fontSize: '12px', fontWeight: 600 }}
                              onClick={() => setActiveTab('planning')}
                            >
                              📋 Ir a Planning
                            </button>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🔍</div>
                            <p style={{ fontWeight: 600, color: '#172B4D', margin: '0 0 0.5rem 0' }}>No se encontraron casos con los filtros aplicados.</p>
                            <button
                              onClick={() => { setExecutionSearchQuery(''); setExecutionStatusFilter('ALL'); }}
                              style={{ fontSize: '12px', color: '#0C66E4', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                              className="hover:underline"
                            >
                              Limpiar filtros
                            </button>
                          </>
                        )}
                      </div>
                    )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Sticky Footer Bar with Functional Pagination */}
              <footer className="execution-footer-bar">
                {/* Left: Cycle Progress & Plan */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#36B37E', display: 'inline-block' }}></span>
                    <span style={{ fontWeight: 600, color: '#172B4D' }}>Progreso del Ciclo:</span>
                    {isLoadingCycleTests ? (
                      <span style={{ color: '#0C66E4', fontSize: '11px', fontWeight: 600 }}>Sincronizando...</span>
                    ) : (
                      <span><strong>{completionRate}%</strong> completado ({executedCount} de {totalInCycle} casos ejecutados)</span>
                    )}
                  </div>
                  <span style={{ color: '#DCDFE4' }}>|</span>
                  <span>Plan activo: <strong style={{ color: '#172B4D' }}>{currentPlan?.summary || (selectedPlanId ? 'Plan seleccionado' : 'Sin plan asignado')}</strong></span>
                </div>

                {/* Center: Pagination Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>Mostrar:</span>
                    <select
                      value={executionPageSize}
                      onChange={e => {
                        const val = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value);
                        setExecutionPageSize(val);
                        setExecutionCurrentPage(1);
                      }}
                      style={{
                        padding: '2px 6px',
                        fontSize: '11px',
                        border: '1px solid #DCDFE4',
                        borderRadius: '4px',
                        background: '#FFFFFF',
                        color: '#172B4D',
                        fontWeight: 600,
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="20">20 por página</option>
                      <option value="50">50 por página</option>
                      <option value="100">100 por página</option>
                      <option value="ALL">Mostrar todos</option>
                    </select>
                  </div>

                  {executionPageSize !== 'ALL' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>Página <strong>{safeCurrentPage}</strong> de <strong>{totalPages}</strong></span>
                      <div style={{ display: 'inline-flex', borderRadius: '4px', overflow: 'hidden', border: '1px solid #DCDFE4' }}>
                        <button
                          type="button"
                          disabled={safeCurrentPage <= 1}
                          onClick={() => setExecutionCurrentPage(p => Math.max(1, p - 1))}
                          style={{
                            padding: '3px 8px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: safeCurrentPage <= 1 ? '#F1F2F4' : '#FFFFFF',
                            color: safeCurrentPage <= 1 ? '#A5ADBA' : '#172B4D',
                            border: 'none',
                            borderRight: '1px solid #DCDFE4',
                            cursor: safeCurrentPage <= 1 ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          disabled={safeCurrentPage >= totalPages}
                          onClick={() => setExecutionCurrentPage(p => Math.min(totalPages, p + 1))}
                          style={{
                            padding: '3px 8px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: safeCurrentPage >= totalPages ? '#F1F2F4' : '#FFFFFF',
                            color: safeCurrentPage >= totalPages ? '#A5ADBA' : '#172B4D',
                            border: 'none',
                            cursor: safeCurrentPage >= totalPages ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Forge Environment Indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }}></span>
                  <span style={{ fontSize: '11px', color: '#626F86' }}>Atlassian Forge Environment • Synchronized</span>
                </div>
              </footer>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', color: '#626F86', gap: '0.75rem' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#E9F2FF', color: '#0C66E4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
                ▶
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#172B4D', margin: 0 }}>Selecciona un Ciclo de Prueba</h3>
              <p style={{ fontSize: '12px', margin: 0, textAlign: 'center', maxWidth: '360px' }}>
                Elige un ciclo en la barra lateral izquierda para ver las métricas de ejecución, correr pruebas y registrar evidencias.
              </p>
              {!isFolderSidebarVisible && (
                <button
                  onClick={toggleFolderSidebar}
                  className="btn-primary"
                  style={{ marginTop: '0.5rem', fontSize: '12px' }}
                >
                  📂 Ver Planes y Ciclos
                </button>
              )}
            </div>
          )}
        </main>
      </div>
    );
}

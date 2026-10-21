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

export default function PlanningView({ ctx }) {
  const {
    activeCycleIdRef,
    addNotification,
    addingProgress,
    availableEnvironments,
    calcScheduleDays,
    cycleScheduleForm,
    cycleTests,
    deferredSearchQuery,
    deletedIdsRef,
    filteredTestCycles,
    findTc,
    folderPaths,
    formatShortDateEs,
    getExecVal,
    groupByFolder,
    handleAddTestToCycle,
    handleCreateIssue,
    handleCycleSelect,
    handleLinkCycleToPlan,
    handleRemoveManyFromCycle,
    handleRemoveTestFromCycle,
    handleSaveCycleSchedule,
    handleSavePlanSchedule,
    handleUnlinkCycleFromPlan,
    isAddingAll,
    isAdmin,
    isCycleInPlan,
    isCycleScheduleOpen,
    isFolderSidebarVisible,
    isLoadingCycleTests,
    isPlanCalendarOpen,
    isResizing,
    isSavingCycleSchedule,
    isSavingPlanSchedule,
    isSectionCollapsed,
    loading,
    newHolidayDate,
    newHolidayDesc,
    perCycleCacheRef,
    perCycleDeletedRef,
    planScheduleForm,
    planningAvailVisible,
    planningChecked,
    planningCycleSearch,
    planningCycleVisible,
    planningExecutionType,
    planningFolder,
    planningPlanSearch,
    planningPriority,
    planningShowAllCycles,
    projectConfig,
    renderGroupToolbar,
    renderGroupedList,
    renderSectionChevron,
    safeSetCycleTests,
    selectedCycle,
    selectedPlanId,
    selectedProjectId,
    selectedTestsForCycle,
    setActiveTab,
    setAddingProgress,
    setCycleScheduleForm,
    setCycleTests,
    setIsAddingAll,
    setIsCycleScheduleOpen,
    setIsPlanCalendarOpen,
    setIsResizing,
    setNewHolidayDate,
    setNewHolidayDesc,
    setPlanScheduleForm,
    setPlanningAvailVisible,
    setPlanningChecked,
    setPlanningCycleVisible,
    setPlanningExecutionType,
    setPlanningFolder,
    setPlanningPlanSearch,
    setPlanningPriority,
    setPlanningShowAllCycles,
    setSelectedCycle,
    setSelectedPlanId,
    setSelectedTestsForCycle,
    setTestCycles,
    setTestPlans,
    showConfirm,
    sidebarWidth,
    testCases,
    testCycles,
    testPlans,
    toggleFolderSidebar
  } = ctx;

    // Deduplicate cycleTests strictly by test case key and ID
    const uniqueCycleTestsMap = new Map();
    for (const test of cycleTests) {
      const tcKey = test.testCaseKey || test.key;
      const tcId = String(test.testCaseId || test.id);
      const dedupeKey = tcKey ? `key_${tcKey}` : `id_${tcId}`;
      if (!uniqueCycleTestsMap.has(dedupeKey)) {
        uniqueCycleTestsMap.set(dedupeKey, test);
      } else {
        const existing = uniqueCycleTestsMap.get(dedupeKey);
        const hasExec = test.status && normalizeUiStatus(test.status) !== 'Not Run';
        const existingHasExec = existing.status && normalizeUiStatus(existing.status) !== 'Not Run';
        if (hasExec && !existingHasExec) {
          uniqueCycleTestsMap.set(dedupeKey, test);
        }
      }
    }
    const deduplicatedCycleTests = Array.from(uniqueCycleTestsMap.values());

    const inCycleCount = selectedCycle ? deduplicatedCycleTests.length : 0;
    const currentPlan = testPlans.find(p => String(p.id) === String(selectedPlanId));

    // Filter cycle tests by global search or local cycle search
    const effectiveCycleQuery = (planningCycleSearch || deferredSearchQuery || '').trim().toLowerCase();
    const filteredCycleTests = deduplicatedCycleTests.filter(test => {
      const matchesSearch = !effectiveCycleQuery ||
        test.key?.toLowerCase().includes(effectiveCycleQuery) ||
        test.testRunKey?.toLowerCase().includes(effectiveCycleQuery) ||
        test.testCaseKey?.toLowerCase().includes(effectiveCycleQuery) ||
        test.summary?.toLowerCase().includes(effectiveCycleQuery) ||
        (findTc(test.id)?.summary || '').toLowerCase().includes(effectiveCycleQuery);
      return matchesSearch;
    });

    const cycleTestIds = new Set(deduplicatedCycleTests.map(ct => String(ct.id)));
    const cycleTestKeys = new Set(deduplicatedCycleTests.map(ct => ct.testCaseKey || ct.key).filter(Boolean));

    const availableFilteredTestCases = testCases.filter(tc =>
      (planningFolder === '' || tc.folderId === planningFolder) &&
      (planningPriority === '' || tc.rawFields?.priority?.name === planningPriority) &&
      (planningExecutionType === '' || (planningExecutionType.toLowerCase() === 'manual' ? getExecVal(tc).includes('man') : getExecVal(tc).includes('auto'))) &&
      !cycleTestIds.has(String(tc.id)) &&
      (!tc.key || !cycleTestKeys.has(tc.key)) &&
      (!deferredSearchQuery || tc.key?.toLowerCase().includes(deferredSearchQuery.toLowerCase()) || tc.summary?.toLowerCase().includes(deferredSearchQuery.toLowerCase()))
    );

    // Normalized multi-selection of currently available (and filtered) test cases
    const selectedTestsSet = new Set((selectedTestsForCycle || []).map(id => String(id)));
    const validSelectedTests = availableFilteredTestCases.filter(tc => selectedTestsSet.has(String(tc.id)));

    // Filtered plans for Plan Selector dropdown
    const visiblePlans = testPlans.filter(p => {
      if (!planningPlanSearch.trim()) return true;
      const q = planningPlanSearch.trim().toLowerCase();
      return (p.key || '').toLowerCase().includes(q) || (p.summary || '').toLowerCase().includes(q);
    });

    // Live day calculations for active Plan calendar form
    const planDaysCalc = calcScheduleDays(
      planScheduleForm.startDate,
      planScheduleForm.endDate,
      planScheduleForm.excludeWeekends,
      planScheduleForm.holidays
    );

    // Active cycle schedule & live day calculation from cycleScheduleForm
    const activeCycleObj = selectedCycle
      ? (testCycles.find(c => String(c.id) === String(selectedCycle.id)) || selectedCycle)
      : null;
    const cycleDaysCalc = calcScheduleDays(
      cycleScheduleForm.startDate,
      cycleScheduleForm.endDate,
      cycleScheduleForm.excludeWeekends !== false,
      cycleScheduleForm.holidays || planScheduleForm.holidays || []
    );

    const hasCycleDates = Boolean(cycleScheduleForm.startDate && cycleScheduleForm.endDate);

    // Format YYYY-MM-DD as "Miércoles, 14 de Octubre"
    const formatLongDayMonthEs = (dateStr) => {
      if (!dateStr) return 'Sin fecha definida';
      const [y, m, d] = String(dateStr).split('-').map(Number);
      if (!y || !m || !d) return dateStr;
      const dt = new Date(y, m - 1, d);
      if (isNaN(dt.getTime())) return dateStr;
      const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      return `${days[dt.getDay()]}, ${String(d).padStart(2, '0')} de ${months[m - 1] || ''}`;
    };

    // Format YYYY-MM-DD as "14 Octubre 2026"
    const formatFullDateEs = (dateStr) => {
      if (!dateStr) return 'Sin definir';
      const [y, m, d] = String(dateStr).split('-').map(Number);
      if (!y || !m || !d) return dateStr;
      const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      return `${String(d).padStart(2, '0')} ${months[m - 1] || ''} ${y}`;
    };

    // Stitch status pill for sidebar cycles
    const renderStitchCycleBadge = (statusLabel) => {
      const label = (statusLabel || 'EN CURSO').toUpperCase();
      let bg = '#DBEAFE', color = '#1D4ED8';
      if (label === 'PLANIFICADO' || label === 'PLANNED') {
        bg = '#F3E8FF'; color = '#7E22CE';
      } else if (label === 'CERRADO' || label === 'COMPLETADO' || label === 'DONE' || label === 'BORRADOR' || label === 'TO DO') {
        bg = '#F1F5F9'; color = '#475569';
      }
      return (
        <span style={{
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '9px',
          fontWeight: 700,
          backgroundColor: bg,
          color,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          flexShrink: 0
        }}>
          {label}
        </span>
      );
    };

    const cyclesInCurrentPlan = selectedPlanId
      ? filteredTestCycles.filter(c => isCycleInPlan(c, selectedPlanId))
      : filteredTestCycles;
    const availableUnlinkedCycles = selectedPlanId
      ? filteredTestCycles.filter(c => !isCycleInPlan(c, selectedPlanId))
      : [];
    const displayedSidebarCycles = (!selectedPlanId || planningShowAllCycles) ? filteredTestCycles : cyclesInCurrentPlan;

    // Export current cycle plan to CSV
    const handleExportCyclePlanCsv = () => {
      if (!selectedCycle) return;
      const headers = ['Cycle Key', 'Cycle Summary', 'Start Date', 'End Date', 'Business Days', 'Test Key', 'Test Summary', 'Execution Type'];
      const rows = deduplicatedCycleTests.map(t => [
        selectedCycle.key || '',
        `"${(selectedCycle.summary || '').replace(/"/g, '""')}"`,
        cycleScheduleForm.startDate || '',
        cycleScheduleForm.endDate || '',
        cycleDaysCalc.businessDays || 0,
        t.testCaseKey || t.key || '',
        `"${(t.summary || findTc(t.id)?.summary || '').replace(/"/g, '""')}"`,
        getExecVal(t).includes('auto') ? 'AUTOMATIZADO' : 'MANUAL'
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `Plan_${selectedCycle.key || 'Ciclo'}_${cycleScheduleForm.startDate || 'cronograma'}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    return (
      <div className="tab-layout" style={{ height: '100%', overflow: 'hidden', background: '#FBFBFC', display: 'flex' }}>
        {/* Left Sidebar: Plans & Cycles Navigation (Stitch w-72 white sidebar) */}
        {isFolderSidebarVisible && (
          <>
            <aside
              className="planning-sidebar"
              style={{
                width: Math.max(sidebarWidth, 288),
                flexShrink: 0,
                background: '#FFFFFF',
                borderRight: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden',
                userSelect: 'none'
              }}
            >
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {/* BLOCK 1: TEST PLAN ACTIVO (data-purpose="test-plan-selector-block") */}
                <div style={{ padding: '12px', borderBottom: '1px solid #F1F5F9' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' }}>
                      Test Plan Activo
                    </span>
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
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px',
                        padding: 0
                      }}
                    >
                      <span>+ Nuevo</span>
                    </button>
                  </div>

                  {/* Active Plan Card */}
                  <div style={{
                    border: '1px solid #E2E8F0',
                    borderRadius: '6px',
                    padding: '10px',
                    background: '#FFFFFF',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: (planningShowAllCycles || (isPlanCalendarOpen && currentPlan)) ? '8px' : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <div style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '4px',
                          background: '#F3E8FF',
                          color: '#7E22CE',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: 700,
                              color: '#1E293B',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              cursor: currentPlan ? 'pointer' : 'default'
                            }}
                            title={currentPlan ? currentPlan.summary : 'Selecciona un Test Plan'}
                            onClick={() => currentPlan && router.open('/browse/' + currentPlan.key)}
                          >
                            {currentPlan ? currentPlan.summary : 'Sin Test Plan seleccionado'}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                            <span style={{ fontSize: '10px', color: '#64748B', fontFamily: 'monospace' }}>
                              {planScheduleForm.startDate && planScheduleForm.endDate
                                ? `${formatShortDateEs(planScheduleForm.startDate)} - ${formatShortDateEs(planScheduleForm.endDate, true)}`
                                : 'Sin vigencia configurada'}
                            </span>
                            {planScheduleForm.startDate && planScheduleForm.endDate && (
                              <span style={{
                                fontSize: '10px',
                                fontWeight: 600,
                                color: '#1D4ED8',
                                background: '#EFF6FF',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                border: '1px solid #BFDBFE',
                                fontFamily: 'monospace'
                              }}>
                                {planDaysCalc.businessDays} días hábiles
                              </span>
                            )}
                            {currentPlan && (
                              <button
                                type="button"
                                onClick={() => setIsPlanCalendarOpen(prev => !prev)}
                                title={isPlanCalendarOpen ? 'Ocultar calendario del plan' : 'Editar fechas del plan'}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '18px',
                                  height: '18px',
                                  padding: 0,
                                  borderRadius: '4px',
                                  border: isPlanCalendarOpen ? '1px solid #BFDBFE' : '1px solid transparent',
                                  background: isPlanCalendarOpen ? '#EFF6FF' : 'transparent',
                                  color: isPlanCalendarOpen ? '#0C66E4' : '#64748B',
                                  cursor: 'pointer',
                                  flexShrink: 0
                                }}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 20h9" />
                                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Switch Test Plan Dropdown Toggle */}
                      <button
                        type="button"
                        onClick={() => setPlanningShowAllCycles(prev => !prev)}
                        title="Cambiar Test Plan activo"
                        style={{
                          color: '#94A3B8',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '2px',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />
                        </svg>
                      </button>
                    </div>

                    {/* Inline Test Plan Switcher when unfolded */}
                    {planningShowAllCycles && (
                      <div style={{
                        marginBottom: (isPlanCalendarOpen && currentPlan) ? '8px' : 0,
                        padding: '6px',
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        borderRadius: '4px'
                      }}>
                        <input
                          type="text"
                          value={planningPlanSearch}
                          onChange={e => setPlanningPlanSearch(e.target.value)}
                          placeholder="Buscar Test Plan..."
                          style={{
                            width: '100%',
                            fontSize: '11px',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid #CBD5E1',
                            marginBottom: '6px',
                            boxSizing: 'border-box'
                          }}
                        />
                        <div style={{ maxHeight: '130px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {visiblePlans.map(plan => {
                            const isSel = String(plan.id) === String(selectedPlanId);
                            return (
                              <div
                                key={plan.id}
                                onClick={() => {
                                  setSelectedPlanId(plan.id);
                                  setPlanningShowAllCycles(false);
                                  const planCycles = filteredTestCycles.filter(c => isCycleInPlan(c, plan.id));
                                  if (planCycles.length > 0 && (!selectedCycle || !isCycleInPlan(selectedCycle, plan.id))) {
                                    handleCycleSelect(planCycles[0]);
                                  }
                                }}
                                style={{
                                  padding: '5px 8px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: isSel ? 700 : 500,
                                  color: isSel ? '#0C66E4' : '#334155',
                                  background: isSel ? '#EFF6FF' : 'transparent',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: '6px'
                                }}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {plan.summary}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Collapsible Plan Calendar Editor */}
                    {isPlanCalendarOpen && currentPlan && (
                      <div style={{
                        marginTop: '8px',
                        paddingTop: '8px',
                        borderTop: '1px dashed #E2E8F0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: '2px' }}>
                              Inicio Plan
                            </label>
                            <input
                              type="date"
                              value={planScheduleForm.startDate}
                              onChange={e => setPlanScheduleForm(prev => ({ ...prev, startDate: e.target.value }))}
                              style={{ width: '100%', fontSize: '11px', padding: '4px', borderRadius: '4px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: '2px' }}>
                              Fin Plan
                            </label>
                            <input
                              type="date"
                              value={planScheduleForm.endDate}
                              onChange={e => setPlanScheduleForm(prev => ({ ...prev, endDate: e.target.value }))}
                              style={{ width: '100%', fontSize: '11px', padding: '4px', borderRadius: '4px', border: '1px solid #CBD5E1', boxSizing: 'border-box' }}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#475569', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={planScheduleForm.excludeWeekends}
                              onChange={e => setPlanScheduleForm(prev => ({ ...prev, excludeWeekends: e.target.checked }))}
                            />
                            <span>Excluir Sáb/Dom</span>
                          </label>
                          <button
                            type="button"
                            onClick={handleSavePlanSchedule}
                            disabled={isSavingPlanSchedule}
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              background: '#0C66E4',
                              color: '#FFFFFF',
                              border: 'none',
                              padding: '4px 10px',
                              borderRadius: '4px',
                              cursor: isSavingPlanSchedule ? 'wait' : 'pointer'
                            }}
                          >
                            {isSavingPlanSchedule ? 'Guardando...' : 'Guardar Plan'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* BLOCK 2: CICLOS PLANIFICADOS (data-purpose="cycles-in-plan-list") — NO PROGRESS BARS / NO SEMÁFOROS */}
                <div style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' }}>
                        Ciclos Planificados
                      </span>
                      <span style={{
                        background: '#E2E8F0',
                        color: '#334155',
                        padding: '1px 6px',
                        borderRadius: '9999px',
                        fontSize: '10px',
                        fontWeight: 700
                      }}>
                        {displayedSidebarCycles.length}
                      </span>
                    </div>
                    <span style={{ fontSize: '10px', color: '#94A3B8' }}>Fechas / Duración</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {displayedSidebarCycles.map(cycle => {
                      const isActive = selectedCycle?.id === cycle.id;
                      const cSched = (isActive && cycleScheduleForm) ? cycleScheduleForm : (cycle.schedule || {});
                      const cDays = calcScheduleDays(
                        cSched.startDate,
                        cSched.endDate,
                        cSched.excludeWeekends !== false,
                        cSched.holidays || []
                      );
                      const isLinkedToCurrentPlan = selectedPlanId && isCycleInPlan(cycle, selectedPlanId);

                      return (
                        <div
                          key={cycle.id}
                          onClick={() => handleCycleSelect(cycle)}
                          style={{
                            padding: '8px 10px',
                            borderRadius: '6px',
                            background: isActive ? 'rgba(239, 246, 255, 0.8)' : 'transparent',
                            border: isActive ? '1px solid #BFDBFE' : '1px solid transparent',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginBottom: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isActive ? '#0C66E4' : '#94A3B8'} strokeWidth="2" style={{ flexShrink: 0 }}>
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                              </svg>
                              <span
                                style={{
                                  fontSize: '12px',
                                  fontWeight: isActive ? 700 : 500,
                                  color: isActive ? '#0C66E4' : '#334155',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                                title={cycle.summary}
                              >
                                {cycle.summary}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                              {isLinkedToCurrentPlan && (
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); handleUnlinkCycleFromPlan(cycle.id); }}
                                  title="Desvincular ciclo de este plan"
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#94A3B8',
                                    fontSize: '11px',
                                    cursor: 'pointer',
                                    padding: '0 2px',
                                    lineHeight: 1
                                  }}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          </div>

                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingLeft: '19px',
                            fontSize: '10px',
                            color: isActive ? '#475569' : '#64748B'
                          }}>
                            <span style={{ fontFamily: 'monospace' }}>
                              {cSched.startDate && cSched.endDate
                                ? `${formatShortDateEs(cSched.startDate)} - ${formatShortDateEs(cSched.endDate)}`
                                : 'Sin fechas definidas'}
                            </span>
                            <span style={{
                              fontFamily: 'monospace',
                              fontWeight: isActive ? 600 : 400,
                              color: isActive ? '#0C66E4' : '#64748B'
                            }}>
                              {cDays.naturalDays > 0 ? `${cDays.naturalDays} días` : '—'}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {displayedSidebarCycles.length === 0 && (
                      <div style={{ padding: '12px 8px', textAlign: 'center', fontSize: '11px', color: '#94A3B8', fontStyle: 'italic' }}>
                        No hay ciclos planificados en este plan.
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ margin: '4px 12px', borderTop: '1px solid #E2E8F0' }} />

                {/* BLOCK 3: AVAILABLE CYCLES (data-purpose="available-cycles-list") */}
                <div style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' }}>
                      Available Cycles
                    </span>
                    <span style={{ fontSize: '10px', color: '#94A3B8' }}>
                      {availableUnlinkedCycles.length} listos
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {availableUnlinkedCycles.map(cycle => (
                      <div
                        key={cycle.id}
                        onClick={() => handleCycleSelect(cycle)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: '1px solid #E2E8F0',
                          background: '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" style={{ flexShrink: 0 }}>
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          <span style={{
                            fontSize: '12px',
                            color: '#475569',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }} title={cycle.summary}>
                            {cycle.summary}
                          </span>
                        </div>
                        {selectedPlanId && (
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); handleLinkCycleToPlan(cycle.id, selectedPlanId); }}
                            style={{
                              fontSize: '11px',
                              fontWeight: 500,
                              color: '#0C66E4',
                              background: 'transparent',
                              border: '1px solid #BFDBFE',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              flexShrink: 0
                            }}
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    ))}
                    {availableUnlinkedCycles.length === 0 && (
                      <div style={{ fontSize: '11px', color: '#94A3B8', fontStyle: 'italic', padding: '4px 2px' }}>
                        Todos los ciclos están vinculados al plan.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sidebar Footer: + New Cycle/Plan */}
              <div style={{ padding: '12px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                <button
                  type="button"
                  onClick={handleCreateIssue}
                  style={{
                    width: '100%',
                    height: '36px',
                    background: '#0C66E4',
                    color: '#FFFFFF',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
                  }}
                >
                  <span style={{ fontSize: '15px', lineHeight: 1 }}>+</span>
                  <span>New Cycle/Plan</span>
                </button>
              </div>
            </aside>

            {/* Resizer */}
            <div
              onMouseDown={() => setIsResizing(true)}
              style={{
                width: '4px',
                cursor: 'col-resize',
                backgroundColor: isResizing ? '#0C66E4' : 'transparent',
                zIndex: 10
              }}
            />
          </>
        )}

        {/* Right Column: Main Planning Workspace */}
        <main className="planning-workspace" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#FBFBFC' }}>
          <div className="planning-scroll-container" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {selectedCycle ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* WORKSPACE HEADER (Stitch Header without health bars/semáforos) */}
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '16px',
                  paddingBottom: '16px',
                  borderBottom: '1px solid #E2E8F0',
                  flexWrap: 'wrap'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {!isFolderSidebarVisible && (
                        <button
                          type="button"
                          onClick={toggleFolderSidebar}
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid #CBD5E1',
                            background: '#FFFFFF',
                            color: '#334155',
                            cursor: 'pointer'
                          }}
                        >
                          ☰ Planes y Ciclos
                        </button>
                      )}
                      <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>
                        Planeación de Ciclo:{' '}
                        <span
                          onClick={() => router.open('/browse/' + selectedCycle.key)}
                          style={{ color: '#0C66E4', cursor: 'pointer' }}
                          title="Abrir ciclo en Jira"
                        >
                          {selectedCycle.summary}
                        </span>
                      </h1>
                      <span style={{
                        padding: '2px 10px',
                        borderRadius: '9999px',
                        fontSize: '12px',
                        fontWeight: 600,
                        background: '#F1F5F9',
                        color: '#334155',
                        border: '1px solid #E2E8F0'
                      }}>
                        {inCycleCount} casos asignados
                      </span>
                      <span style={{
                        padding: '2px 10px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: '#EFF6FF',
                        color: '#0C66E4',
                        border: '1px solid #BFDBFE',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        <span>
                          Período: {hasCycleDates ? `${formatShortDateEs(cycleScheduleForm.startDate)} - ${formatShortDateEs(cycleScheduleForm.endDate, true)}` : 'Sin definir'}
                        </span>
                      </span>
                    </div>
                    <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#64748B', lineHeight: 1.5 }}>
                      Ventana programada:{' '}
                      <strong style={{ color: '#334155', fontWeight: 500 }}>
                        {hasCycleDates
                          ? `${formatFullDateEs(cycleScheduleForm.startDate)} a ${formatFullDateEs(cycleScheduleForm.endDate)} (${cycleDaysCalc.naturalDays} días naturales, ${cycleDaysCalc.businessDays} días hábiles)`
                          : 'Configura las fechas de inicio y término abajo'}
                      </strong>.
                      <br />
                      Define el cronograma del ciclo y asigna los casos de prueba previstos antes de pasar a la fase de Ejecución.
                    </p>
                  </div>

                  {/* Header Right Action Buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={async () => {
                        if (planScheduleForm.startDate && planScheduleForm.endDate && (!cycleScheduleForm.startDate || !cycleScheduleForm.endDate)) {
                          const syncedStart = cycleScheduleForm.startDate || planScheduleForm.startDate;
                          const syncedEnd = cycleScheduleForm.endDate || planScheduleForm.endDate;
                          setCycleScheduleForm(prev => ({
                            ...prev,
                            startDate: syncedStart,
                            endDate: syncedEnd
                          }));
                          await handleSaveCycleSchedule({ startDate: syncedStart, endDate: syncedEnd });
                        } else {
                          clearPersistentCache();
                          queryClient.invalidateQueries();
                          if (selectedProjectId) {
                            const [freshPlans, freshCycles] = await Promise.all([
                              invoke('getTestPlans', { projectId: selectedProjectId, issueTypeId: projectConfig?.testPlanIssueTypeId }).catch(() => null),
                              invoke('getTestCycles', { projectId: selectedProjectId, issueTypeId: projectConfig?.testCycleIssueTypeId }).catch(() => null)
                            ]);
                            if (Array.isArray(freshPlans)) setTestPlans(freshPlans);
                            if (Array.isArray(freshCycles)) {
                              setTestCycles(freshCycles);
                              if (selectedCycle?.id) {
                                const updated = freshCycles.find(c => String(c.id) === String(selectedCycle.id) || c.key === selectedCycle.key);
                                if (updated) setSelectedCycle(updated);
                              }
                            }
                          }
                          addNotification({
                            type: 'success',
                            title: 'Sincronizado con Release',
                            description: 'Planes y ciclos actualizados con la información más reciente de Jira.'
                          });
                        }
                      }}
                      style={{
                        height: '32px',
                        padding: '0 12px',
                        background: '#FFFFFF',
                        border: '1px solid #CBD5E1',
                        color: '#334155',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)'
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                      </svg>
                      <span>Sincronizar con Release</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportCyclePlanCsv}
                      style={{
                        height: '32px',
                        padding: '0 12px',
                        background: '#FFFFFF',
                        border: '1px solid #CBD5E1',
                        color: '#334155',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)'
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      <span>Exportar Plan</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSaveCycleSchedule()}
                      disabled={isSavingCycleSchedule}
                      style={{
                        height: '32px',
                        padding: '0 14px',
                        background: '#0C66E4',
                        border: 'none',
                        color: '#FFFFFF',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: isSavingCycleSchedule ? 'wait' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)'
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                      </svg>
                      <span>{isSavingCycleSchedule ? 'Guardando...' : 'Guardar Cronograma'}</span>
                    </button>
                  </div>
                </div>

                {/* CARD 1: CONFIGURACIÓN DE CALENDARIO Y FECHAS DEL CICLO (data-purpose="cycle-calendar-config-card") */}
                <div style={{
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  padding: '16px',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: '12px',
                    marginBottom: '16px',
                    borderBottom: '1px solid #F1F5F9',
                    flexWrap: 'wrap',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        background: '#EFF6FF',
                        color: '#0C66E4',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                      </div>
                      <div>
                        <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#1E293B' }}>
                          Configuración de Calendario y Fechas del Ciclo
                        </h2>
                        <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#64748B' }}>
                          Define el intervalo de fechas de prueba, días inhábiles y plazos de asignación
                        </p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <label style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        color: '#475569',
                        cursor: 'pointer',
                        background: '#F8FAFC',
                        padding: '5px 10px',
                        borderRadius: '4px',
                        border: '1px solid #E2E8F0',
                        userSelect: 'none'
                      }}>
                        <input
                          type="checkbox"
                          checked={cycleScheduleForm.excludeWeekends !== false}
                          onChange={e => setCycleScheduleForm(prev => ({ ...prev, excludeWeekends: e.target.checked }))}
                          style={{ borderRadius: '3px', cursor: 'pointer', margin: 0 }}
                        />
                        <span>Excluir fines de semana</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => setIsCycleScheduleOpen(prev => !prev)}
                        style={{
                          fontSize: '11px',
                          fontWeight: 500,
                          color: isCycleScheduleOpen ? '#0C66E4' : '#475569',
                          background: isCycleScheduleOpen ? '#EFF6FF' : '#FFFFFF',
                          border: isCycleScheduleOpen ? '1px solid #BFDBFE' : '1px solid #CBD5E1',
                          padding: '5px 10px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px'
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        <span>
                          Días festivos {(cycleScheduleForm.holidays || []).length > 0 ? `(${(cycleScheduleForm.holidays || []).length})` : ''}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* 3-Column Date & Duration Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px' }}>
                    {/* Column 1: Fecha de Inicio */}
                    <div style={{
                      background: 'rgba(248, 250, 252, 0.7)',
                      border: '1px solid #E2E8F0',
                      borderRadius: '6px',
                      padding: '12px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' }}>
                          Fecha de Inicio
                        </label>
                        <span style={{ fontSize: '10px', color: '#0C66E4', fontWeight: 600 }}>Requerido</span>
                      </div>
                      <input
                        type="date"
                        value={cycleScheduleForm.startDate}
                        onChange={e => setCycleScheduleForm(prev => ({ ...prev, startDate: e.target.value }))}
                        style={{
                          width: '100%',
                          height: '34px',
                          padding: '0 10px',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                          fontWeight: 500,
                          color: '#1E293B',
                          background: '#FFFFFF',
                          border: '1px solid #CBD5E1',
                          borderRadius: '4px',
                          boxSizing: 'border-box',
                          outline: 'none'
                        }}
                      />
                      <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: '#64748B' }}>
                        <span>{formatLongDayMonthEs(cycleScheduleForm.startDate)}</span>
                        <span style={{ fontFamily: 'monospace', color: '#475569' }}>09:00 hrs</span>
                      </div>
                    </div>

                    {/* Column 2: Fecha de Término / Cierre */}
                    <div style={{
                      background: 'rgba(248, 250, 252, 0.7)',
                      border: '1px solid #E2E8F0',
                      borderRadius: '6px',
                      padding: '12px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' }}>
                          Fecha de Término / Cierre
                        </label>
                        <span style={{ fontSize: '10px', color: '#0C66E4', fontWeight: 600 }}>Requerido</span>
                      </div>
                      <input
                        type="date"
                        value={cycleScheduleForm.endDate}
                        onChange={e => setCycleScheduleForm(prev => ({ ...prev, endDate: e.target.value }))}
                        style={{
                          width: '100%',
                          height: '34px',
                          padding: '0 10px',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                          fontWeight: 500,
                          color: '#1E293B',
                          background: '#FFFFFF',
                          border: '1px solid #CBD5E1',
                          borderRadius: '4px',
                          boxSizing: 'border-box',
                          outline: 'none'
                        }}
                      />
                      <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: '#64748B' }}>
                        <span>{formatLongDayMonthEs(cycleScheduleForm.endDate)}</span>
                        <span style={{ fontFamily: 'monospace', color: '#475569' }}>18:00 hrs</span>
                      </div>
                    </div>

                    {/* Column 3: Banner Dividido — Izquierda: Cálculo de Días Hábiles (Automático) | Derecha: Ambiente de Ejecución (Propiedad del Ciclo) */}
                    <div style={{
                      background: 'rgba(248, 250, 252, 0.7)',
                      border: '1px solid #E2E8F0',
                      borderRadius: '6px',
                      padding: '10px 12px',
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '10px',
                      alignItems: 'stretch'
                    }}>
                      {/* Lado Izquierdo: Cálculo de Días Hábiles en Automático */}
                      <div style={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '6px',
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B' }}>
                            Días Hábiles
                          </span>
                          <span style={{
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '9px',
                            fontWeight: 700,
                            background: '#ECFDF5',
                            color: '#047857',
                            border: '1px solid #A7F3D0'
                          }}>
                            Automático
                          </span>
                        </div>
                        <div style={{ marginTop: '6px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '15px', fontWeight: 800, color: '#0C66E4', fontFamily: 'monospace' }}>
                            {cycleDaysCalc.businessDays} hábiles
                          </span>
                          <span style={{ fontSize: '10px', color: '#64748B', fontFamily: 'monospace' }} title="Días naturales totales en el rango">
                            ({cycleDaysCalc.naturalDays}d nat.)
                          </span>
                        </div>
                      </div>

                      {/* Lado Derecho: Configuración de Ambiente de Ejecución del Ciclo */}
                      <div style={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '6px',
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B' }}>
                            Ambiente Ciclo
                          </span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setActiveTab('config')}
                              title="Administrar catálogo de ambientes en Configuración"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                fontSize: '9px',
                                fontWeight: 700,
                                color: '#0C66E4',
                                cursor: 'pointer',
                                textDecoration: 'underline'
                              }}
                            >
                              + Catálogo
                            </button>
                          )}
                        </div>
                        <div style={{ marginTop: '5px' }}>
                          <select
                            value={cycleScheduleForm.environment || availableEnvironments[0]?.name || 'QA'}
                            disabled={isSavingCycleSchedule}
                            onChange={(e) => {
                              const nextEnv = e.target.value;
                              setCycleScheduleForm(prev => ({ ...prev, environment: nextEnv }));
                              handleSaveCycleSchedule({ environment: nextEnv });
                            }}
                            style={{
                              width: '100%',
                              fontSize: '12px',
                              fontWeight: 700,
                              color: '#0F172A',
                              background: '#F8FAFC',
                              border: '1px solid #CBD5E1',
                              borderRadius: '4px',
                              padding: '4px 6px',
                              cursor: isSavingCycleSchedule ? 'wait' : 'pointer',
                              outline: 'none'
                            }}
                          >
                            {availableEnvironments.map(envObj => (
                              <option key={envObj.id || envObj.name} value={envObj.name}>
                                🌐 {envObj.name}
                              </option>
                            ))}
                            {cycleScheduleForm.environment && !availableEnvironments.some(e => e.name === cycleScheduleForm.environment) && (
                              <option value={cycleScheduleForm.environment}>
                                🌐 {cycleScheduleForm.environment}
                              </option>
                            )}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Collapsible Drawer ONLY for Días Festivos (Fecha + Descripción + Tablita) */}
                  {isCycleScheduleOpen && (
                    <div style={{
                      marginTop: '12px',
                      padding: '14px',
                      background: '#F8FAFC',
                      border: '1px solid #CBD5E1',
                      borderRadius: '6px'
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: '10px',
                        flexWrap: 'wrap'
                      }}>
                        <div style={{ width: '170px', flexShrink: 0 }}>
                          <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '4px' }}>
                            Día Festivo
                          </label>
                          <input
                            type="date"
                            value={newHolidayDate}
                            onChange={e => setNewHolidayDate(e.target.value)}
                            style={{
                              width: '100%',
                              height: '32px',
                              padding: '0 8px',
                              fontSize: '12px',
                              fontFamily: 'monospace',
                              borderRadius: '4px',
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>

                        <div style={{ flex: 1, minWidth: '200px' }}>
                          <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '4px' }}>
                            Descripción
                          </label>
                          <input
                            type="text"
                            placeholder="Ej. Día de la Independencia / Mantenimiento programado"
                            value={newHolidayDesc}
                            onChange={e => setNewHolidayDesc(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newHolidayDate) {
                                e.preventDefault();
                                const normalizedList = (cycleScheduleForm.holidays || []).map(item =>
                                  typeof item === 'string' ? { date: item, description: 'Día festivo' } : item
                                );
                                const filtered = normalizedList.filter(item => item.date !== newHolidayDate);
                                const nextHolidays = [
                                  ...filtered,
                                  { date: newHolidayDate, description: (newHolidayDesc || '').trim() || 'Día festivo' }
                                ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
                                setCycleScheduleForm(prev => ({ ...prev, holidays: nextHolidays }));
                                setNewHolidayDate('');
                                setNewHolidayDesc('');
                                handleSaveCycleSchedule({ holidays: nextHolidays });
                              }
                            }}
                            style={{
                              width: '100%',
                              height: '32px',
                              padding: '0 10px',
                              fontSize: '12px',
                              borderRadius: '4px',
                              border: '1px solid #CBD5E1',
                              background: '#FFFFFF',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (!newHolidayDate) return;
                            const normalizedList = (cycleScheduleForm.holidays || []).map(item =>
                              typeof item === 'string' ? { date: item, description: 'Día festivo' } : item
                            );
                            const filtered = normalizedList.filter(item => item.date !== newHolidayDate);
                            const nextHolidays = [
                              ...filtered,
                              { date: newHolidayDate, description: (newHolidayDesc || '').trim() || 'Día festivo' }
                            ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
                            setCycleScheduleForm(prev => ({ ...prev, holidays: nextHolidays }));
                            setNewHolidayDate('');
                            setNewHolidayDesc('');
                            handleSaveCycleSchedule({ holidays: nextHolidays });
                          }}
                          style={{
                            height: '32px',
                            padding: '0 12px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#FFFFFF',
                            background: '#0C66E4',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            flexShrink: 0
                          }}
                        >
                          + Agregar día festivo
                        </button>
                      </div>

                      {/* Tablita de Días Festivos y su Descripción */}
                      <div style={{
                        marginTop: '12px',
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '6px',
                        overflow: 'hidden'
                      }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                          <thead>
                            <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #E2E8F0' }}>
                              <th style={{ textAlign: 'left', padding: '7px 12px', fontSize: '10px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', width: '180px' }}>
                                Día Festivo
                              </th>
                              <th style={{ textAlign: 'left', padding: '7px 12px', fontSize: '10px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                                Descripción
                              </th>
                              <th style={{ textAlign: 'right', padding: '7px 12px', fontSize: '10px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', width: '80px' }}>
                                Acción
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {(cycleScheduleForm.holidays || []).length === 0 ? (
                              <tr>
                                <td colSpan={3} style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: '#94A3B8' }}>
                                  No hay días festivos registrados para este ciclo.
                                </td>
                              </tr>
                            ) : (
                              (cycleScheduleForm.holidays || []).map((h, idx) => {
                                const hDate = typeof h === 'string' ? h : h?.date;
                                const hDesc = typeof h === 'string' ? 'Día festivo' : (h?.description || 'Día festivo');
                                return (
                                  <tr key={hDate || idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600, color: '#1E293B', fontSize: '11px' }}>
                                      {formatShortDateEs(hDate)} <span style={{ color: '#94A3B8', fontWeight: 400 }}>({hDate})</span>
                                    </td>
                                    <td style={{ padding: '8px 12px', color: '#334155', fontSize: '12px' }}>
                                      {hDesc}
                                    </td>
                                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const nextHolidays = (cycleScheduleForm.holidays || []).filter(item => {
                                            const d = typeof item === 'string' ? item : item?.date;
                                            return d !== hDate;
                                          });
                                          setCycleScheduleForm(prev => ({
                                            ...prev,
                                            holidays: nextHolidays
                                          }));
                                          handleSaveCycleSchedule({ holidays: nextHolidays });
                                        }}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          color: '#DC2626',
                                          cursor: 'pointer',
                                          fontSize: '11px',
                                          fontWeight: 600,
                                          padding: '2px 6px',
                                          borderRadius: '4px'
                                        }}
                                      >
                                        Eliminar
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Blue Info Note Banner (Stitch Nota de Planeación) */}
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #F1F5F9' }}>
                    <div style={{
                      background: 'rgba(239, 246, 255, 0.7)',
                      border: '1px solid rgba(191, 219, 254, 0.7)',
                      borderRadius: '6px',
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      flexWrap: 'wrap'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#334155' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" style={{ flexShrink: 0 }}>
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        <span>
                          <strong style={{ fontWeight: 600, color: '#0F172A' }}>Nota de Planeación:</strong> Los semáforos, ritmos de ejecución diaria y métricas de retraso se activarán en el módulo{' '}
                          <span
                            onClick={() => setActiveTab('execution')}
                            style={{ fontWeight: 600, color: '#0C66E4', cursor: 'pointer' }}
                          >
                            Execution
                          </span>{' '}
                          una vez que inicie la ventana del ciclo.
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '11px', color: '#64748B' }}>Fase actual:</span>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 700,
                          background: '#DBEAFE',
                          color: '#1E40AF',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em'
                        }}>
                          Definición de Cronograma
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CARD 2: TESTS IN THIS CYCLE (Keeping Folder Grouping & Expand/Collapse) */}
                <div style={{
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #F1F5F9',
                    background: 'rgba(248, 250, 252, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {renderSectionChevron('planning-cycle')}
                      <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#1E293B' }}>
                        Tests in this Cycle ({inCycleCount})
                      </h2>
                      {!isSectionCollapsed('planning-cycle') && deduplicatedCycleTests.length > 0 && renderGroupToolbar(`plan-cycle-${selectedCycle?.id || ''}`, filteredCycleTests)}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {planningChecked.size > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const selectedIds = [...planningChecked];
                            showConfirm(
                              'Remover casos seleccionados',
                              `¿Eliminar ${selectedIds.length} caso${selectedIds.length !== 1 ? 's' : ''} del ciclo?`,
                              () => handleRemoveManyFromCycle(selectedIds),
                              { danger: true, confirmLabel: 'Remover' }
                            );
                          }}
                          style={{
                            height: '28px',
                            padding: '0 10px',
                            background: '#FFFFFF',
                            border: '1px solid #FECACA',
                            color: '#DC2626',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <span>Eliminar seleccionados ({planningChecked.size})</span>
                        </button>
                      )}

                      {deduplicatedCycleTests.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const allIds = deduplicatedCycleTests.map(t => t.id);
                            showConfirm(
                              'Remover todos los casos',
                              `¿Eliminar TODOS los ${deduplicatedCycleTests.length} casos del ciclo?`,
                              () => handleRemoveManyFromCycle(allIds),
                              { danger: true, confirmLabel: 'Eliminar todos' }
                            );
                          }}
                          style={{
                            height: '28px',
                            padding: '0 10px',
                            background: '#FFFFFF',
                            border: '1px solid #E2E8F0',
                            color: '#DC2626',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)'
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                          <span>Eliminar todos</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {!isSectionCollapsed('planning-cycle') && (
                    <>
                      {/* Sub-header Select All */}
                      {deduplicatedCycleTests.length > 0 && (
                        <div style={{
                          padding: '8px 16px',
                          background: 'rgba(248, 250, 252, 0.3)',
                          borderBottom: '1px solid #F1F5F9',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px'
                        }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: 500, color: '#64748B', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={planningChecked.size > 0 && planningChecked.size === deduplicatedCycleTests.length}
                              ref={el => { if (el) el.indeterminate = planningChecked.size > 0 && planningChecked.size < deduplicatedCycleTests.length; }}
                              onChange={e => {
                                if (e.target.checked) setPlanningChecked(new Set(deduplicatedCycleTests.map(t => String(t.id))));
                                else setPlanningChecked(new Set());
                              }}
                              style={{ borderRadius: '3px', cursor: 'pointer', margin: 0 }}
                            />
                            <span>
                              {planningChecked.size > 0 ? `${planningChecked.size} seleccionado${planningChecked.size !== 1 ? 's' : ''}` : 'Seleccionar todos'}
                            </span>
                          </label>
                        </div>
                      )}

                      {/* Cycle Items List (with Folder Grouping) */}
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {isLoadingCycleTests ? (
                          <div style={{ padding: '32px', textAlign: 'center', color: '#64748B', fontSize: '12px' }}>
                            Sincronizando casos asignados al ciclo...
                          </div>
                        ) : (
                          <>
                            {renderGroupedList(`plan-cycle-${selectedCycle?.id || ''}`, groupByFolder ? filteredCycleTests : filteredCycleTests.slice(0, planningCycleVisible), test => {
                              const isAuto = getExecVal(test).includes('auto');
                              return (
                                <div
                                  key={test.id}
                                  style={{
                                    padding: '10px 16px',
                                    borderBottom: '1px solid #F1F5F9',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '12px'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                                    <input
                                      type="checkbox"
                                      checked={planningChecked.has(String(test.id))}
                                      onChange={e => setPlanningChecked(prev => {
                                        const s = new Set(prev);
                                        if (e.target.checked) s.add(String(test.id)); else s.delete(String(test.id));
                                        return s;
                                      })}
                                      style={{ borderRadius: '3px', cursor: 'pointer', flexShrink: 0, margin: 0 }}
                                    />
                                    <span
                                      onClick={() => router.open('/browse/' + (test.testCaseKey || test.key))}
                                      style={{
                                        fontFamily: 'monospace',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        color: '#0C66E4',
                                        cursor: 'pointer',
                                        flexShrink: 0
                                      }}
                                    >
                                      {test.testCaseKey || test.key}
                                    </span>
                                    {isAuto ? (
                                      <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        background: '#F3E8FF',
                                        color: '#7E22CE',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                        flexShrink: 0
                                      }}>
                                        <span>⚡</span> Automatizado
                                      </span>
                                    ) : (
                                      <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        background: '#F1F5F9',
                                        color: '#475569',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                        flexShrink: 0
                                      }}>
                                        Manual
                                      </span>
                                    )}
                                    <span
                                      style={{
                                        fontSize: '12px',
                                        color: '#334155',
                                        fontWeight: 500,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                      }}
                                      title={test.summary || (findTc(test.id)?.summary) || 'Caso de prueba'}
                                    >
                                      {test.summary || (findTc(test.id)?.summary) || 'Caso de prueba'}
                                    </span>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleRemoveTestFromCycle(test.id)}
                                    title="Remover del ciclo"
                                    style={{
                                      width: '28px',
                                      height: '28px',
                                      borderRadius: '4px',
                                      border: '1px solid #FECACA',
                                      background: '#FEF2F2',
                                      color: '#EF4444',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                      flexShrink: 0
                                    }}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                    </svg>
                                  </button>
                                </div>
                              );
                            }, items => `${items.length} caso${items.length !== 1 ? 's' : ''}`)}
                            {!groupByFolder && filteredCycleTests.length > planningCycleVisible && (
                              <LoadMoreSentinel key={`cyc-${planningCycleVisible}`} remaining={filteredCycleTests.length - planningCycleVisible} onVisible={() => setPlanningCycleVisible(v => v + LIST_BATCH_SIZE)} />
                            )}
                            {deduplicatedCycleTests.length === 0 && (
                              <div style={{ padding: '28px', textAlign: 'center', color: '#64748B', fontSize: '12px' }}>
                                No hay casos asignados a este ciclo todavía. Usa la sección inferior para añadir casos de prueba.
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* CARD 3: AVAILABLE TEST CASES (Keeping Folder Grouping & Expand/Collapse) */}
                <div style={{
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #E2E8F0',
                    background: 'rgba(248, 250, 252, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {renderSectionChevron('planning-available')}
                      <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#1E293B' }}>
                        Available Test Cases
                      </h2>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: '#E2E8F0',
                        color: '#334155'
                      }}>
                        {availableFilteredTestCases.length}
                      </span>
                      {!isSectionCollapsed('planning-available') && availableFilteredTestCases.length > 0 && renderGroupToolbar(`plan-avail-${selectedCycle?.id || ''}`, availableFilteredTestCases)}
                    </div>

                    {/* Filter Controls & + Añadir todos */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <select
                        value={planningFolder}
                        onChange={e => {
                          setPlanningFolder(e.target.value);
                          setSelectedTestsForCycle([]);
                        }}
                        style={{
                          height: '32px',
                          padding: '0 10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#334155',
                          background: '#FFFFFF',
                          border: '1px solid #CBD5E1',
                          borderRadius: '6px',
                          outline: 'none'
                        }}
                      >
                        <option value="">TODAS LAS CARPETAS</option>
                        {folderPaths.map(f => (
                          <option key={f.id} value={f.id}>{f.path}</option>
                        ))}
                      </select>

                      <select
                        value={planningPriority}
                        onChange={e => {
                          setPlanningPriority(e.target.value);
                          setSelectedTestsForCycle([]);
                        }}
                        style={{
                          height: '32px',
                          padding: '0 10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#334155',
                          background: '#FFFFFF',
                          border: '1px solid #CBD5E1',
                          borderRadius: '6px',
                          outline: 'none'
                        }}
                      >
                        <option value="">TODAS LAS PRIORIDADES</option>
                        <option value="Highest">Highest</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                        <option value="Lowest">Lowest</option>
                      </select>

                      <select
                        value={planningExecutionType}
                        onChange={e => {
                          setPlanningExecutionType(e.target.value);
                          setSelectedTestsForCycle([]);
                        }}
                        style={{
                          height: '32px',
                          padding: '0 10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#334155',
                          background: '#FFFFFF',
                          border: '1px solid #CBD5E1',
                          borderRadius: '6px',
                          outline: 'none'
                        }}
                      >
                        <option value="">TODOS LOS TIPOS</option>
                        <option value="Automatizado">AUTOMATIZADO</option>
                        <option value="Manual">MANUAL</option>
                      </select>

                      <button
                        type="button"
                        onClick={async () => {
                          const testsToAdd = validSelectedTests.length > 0
                            ? validSelectedTests
                            : availableFilteredTestCases;
                          if (!selectedCycle || testsToAdd.length === 0) return;

                          setIsAddingAll(true);
                          setAddingProgress({ current: 0, total: testsToAdd.length });
                          try {
                            const cycleId = String(selectedCycle.id);
                            testsToAdd.forEach(tc => {
                              const idStr = String(tc.id);
                              const keyStr = tc.key ? String(tc.key) : '';
                              deletedIdsRef.current.delete(idStr);
                              if (keyStr) deletedIdsRef.current.delete(keyStr);
                              if (perCycleDeletedRef.current[cycleId]) {
                                perCycleDeletedRef.current[cycleId].delete(idStr);
                                if (keyStr) perCycleDeletedRef.current[cycleId].delete(keyStr);
                              }
                            });

                            const CHUNK_SIZE = 25;
                            let allAddedTests = [];
                            for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                              const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                              let retries = 2;
                              let bRes = null;
                              while (retries >= 0) {
                                try {
                                  bRes = await invoke('addBulkTestsToCycle', {
                                    cycleId: selectedCycle.id,
                                    cycleKey: selectedCycle.key || selectedCycle.id,
                                    projectId: selectedProjectId,
                                    config: projectConfig,
                                    testCases: chunk,
                                    skipIndexWrite: true
                                  });
                                  break;
                                } catch (errChunk) {
                                  retries--;
                                  if (retries < 0) {
                                    console.warn('[addBulkTestsToCycle] Chunk error:', errChunk);
                                  } else {
                                    await new Promise(r => setTimeout(r, 600));
                                  }
                                }
                              }
                              if (bRes && bRes.addedTests) {
                                allAddedTests = allAddedTests.concat(bRes.addedTests);
                              }
                              setAddingProgress({ current: Math.min(i + CHUNK_SIZE, testsToAdd.length), total: testsToAdd.length });
                            }

                            if (allAddedTests.length > 0) {
                              try {
                                await invoke('syncCycleIndexWithRuns', {
                                  cycleId: selectedCycle.id,
                                  addedRuns: allAddedTests
                                });
                              } catch (errSync) {
                                console.warn('[syncCycleIndexWithRuns] Index sync warning:', errSync);
                              }
                            }

                            const locallyAdded = testsToAdd.map(tc => ({
                              id: String(tc.id),
                              testCaseId: String(tc.id),
                              key: tc.key,
                              testCaseKey: tc.key,
                              summary: tc.summary,
                              folderId: tc.folderId,
                              executionType: tc.executionType || 'Manual',
                              status: 'Not Run'
                            }));

                            const cycleIdStr = String(cycleId);
                            const existingBase = perCycleCacheRef.current[cycleIdStr] || deduplicatedCycleTests || [];
                            const newArr = [...existingBase];
                            locallyAdded.forEach(lt => {
                              let finalItem = lt;
                              if (allAddedTests && allAddedTests.length > 0) {
                                const matched = allAddedTests.find(t =>
                                  String(t.id) === String(lt.id) ||
                                  (lt.key && (t.key === lt.key || t.testCaseKey === lt.key))
                                );
                                if (matched) {
                                  finalItem = { ...lt, ...matched };
                                }
                              }
                              const alreadyExists = newArr.some(existing =>
                                String(existing.id) === String(lt.id) ||
                                (lt.key && (existing.key === lt.key || existing.testCaseKey === lt.key))
                              );
                              if (!alreadyExists) {
                                newArr.push(finalItem);
                              }
                            });
                            perCycleCacheRef.current[cycleIdStr] = newArr;
                            setTestCycles(cycles => cycles.map(c => String(c.id) === cycleIdStr ? { ...c, testCount: newArr.length } : c));
                            if (activeCycleIdRef.current === cycleIdStr) {
                              setCycleTests(newArr);
                              setSelectedCycle(c => (c && String(c.id) === cycleIdStr ? { ...c, testCount: newArr.length } : c));
                            }

                            setSelectedTestsForCycle([]);
                            addNotification({
                              type: 'success',
                              title: `${testsToAdd.length} caso${testsToAdd.length !== 1 ? 's' : ''} añadido${testsToAdd.length !== 1 ? 's' : ''} al ciclo`,
                              description: `Asignados a "${selectedCycle.name || selectedCycle.summary || selectedCycle.key}".`
                            });

                            setTimeout(async () => {
                              const finalExecution = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
                              if (finalExecution) {
                                safeSetCycleTests(finalExecution, cycleId);
                              }
                            }, 2500);
                          } catch (err) {
                            console.error(err);
                            addNotification({
                              type: 'error',
                              title: 'Error al añadir casos al ciclo',
                              description: err.message || String(err)
                            });
                          }
                          setIsAddingAll(false);
                          setAddingProgress({ current: 0, total: 0 });
                        }}
                        disabled={loading || isAddingAll || availableFilteredTestCases.length === 0}
                        style={{
                          height: '32px',
                          padding: '0 12px',
                          background: '#0C66E4',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: (loading || isAddingAll || availableFilteredTestCases.length === 0) ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
                        }}
                      >
                        <span>+</span>
                        <span>
                          {isAddingAll
                            ? (addingProgress.total > 0 ? `Añadiendo (${addingProgress.current}/${addingProgress.total})...` : 'Añadiendo...')
                            : (validSelectedTests.length > 0
                                ? `Añadir seleccionados (${validSelectedTests.length})`
                                : (availableFilteredTestCases.length > 0 ? `Añadir todos (${availableFilteredTestCases.length})` : 'Añadir todos'))}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Available Test Cases Rows (with Folder Grouping & Multi-Selection Mode) */}
                  {!isSectionCollapsed('planning-available') && (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {/* Sub-header Select All / Active Multi-Select Bar */}
                      {availableFilteredTestCases.length > 0 && (
                        <div style={{
                          padding: '8px 16px',
                          background: validSelectedTests.length > 0 ? '#EFF6FF' : 'rgba(248, 250, 252, 0.3)',
                          borderBottom: validSelectedTests.length > 0 ? '1px solid #BFDBFE' : '1px solid #F1F5F9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          transition: 'all 0.15s ease'
                        }}>
                          <label style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: validSelectedTests.length > 0 ? 600 : 500,
                            color: validSelectedTests.length > 0 ? '#0C66E4' : '#64748B',
                            userSelect: 'none'
                          }}>
                            <input
                              type="checkbox"
                              checked={availableFilteredTestCases.length > 0 && validSelectedTests.length === availableFilteredTestCases.length}
                              ref={el => {
                                if (el) {
                                  el.indeterminate = validSelectedTests.length > 0 && validSelectedTests.length < availableFilteredTestCases.length;
                                }
                              }}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedTestsForCycle(availableFilteredTestCases.map(tc => String(tc.id)));
                                } else {
                                  setSelectedTestsForCycle([]);
                                }
                              }}
                              style={{ borderRadius: '3px', cursor: 'pointer', margin: 0 }}
                            />
                            <span>
                              {validSelectedTests.length > 0
                                ? `${validSelectedTests.length} de ${availableFilteredTestCases.length} caso${availableFilteredTestCases.length !== 1 ? 's' : ''} seleccionado${validSelectedTests.length !== 1 ? 's' : ''}`
                                : `Seleccionar todos (${availableFilteredTestCases.length})`}
                            </span>
                          </label>

                          {validSelectedTests.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {validSelectedTests.length < availableFilteredTestCases.length && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedTestsForCycle(availableFilteredTestCases.map(tc => String(tc.id)))}
                                  style={{
                                    padding: '3px 10px',
                                    borderRadius: '4px',
                                    border: '1px solid #93C5FD',
                                    background: '#FFFFFF',
                                    color: '#0C66E4',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                  }}
                                >
                                  Seleccionar todos ({availableFilteredTestCases.length})
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setSelectedTestsForCycle([])}
                                style={{
                                  padding: '3px 10px',
                                  borderRadius: '4px',
                                  border: '1px solid #CBD5E1',
                                  background: '#FFFFFF',
                                  color: '#475569',
                                  fontSize: '11px',
                                  fontWeight: 500,
                                  cursor: 'pointer'
                                }}
                              >
                                Limpiar selección
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {renderGroupedList(`plan-avail-${selectedCycle?.id || ''}`, groupByFolder ? availableFilteredTestCases : availableFilteredTestCases.slice(0, planningAvailVisible), test => {
                        const testIdStr = String(test.id);
                        const isSelected = selectedTestsSet.has(testIdStr);
                        const isAuto = getExecVal(test).includes('auto');
                        return (
                          <div
                            key={test.id}
                            onClick={() => {
                              setSelectedTestsForCycle(prev => {
                                const prevStrs = (prev || []).map(id => String(id));
                                return prevStrs.includes(testIdStr)
                                  ? prevStrs.filter(id => id !== testIdStr)
                                  : [...prevStrs, testIdStr];
                              });
                            }}
                            style={{
                              padding: '10px 16px',
                              borderBottom: '1px solid #F1F5F9',
                              background: isSelected ? '#EFF6FF' : '#FFFFFF',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                readOnly
                                style={{ borderRadius: '3px', cursor: 'pointer', flexShrink: 0, margin: 0 }}
                              />
                              <span
                                onClick={e => { e.stopPropagation(); router.open('/browse/' + test.key); }}
                                style={{
                                  fontFamily: 'monospace',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  color: '#0C66E4',
                                  width: '64px',
                                  flexShrink: 0,
                                  cursor: 'pointer'
                                }}
                              >
                                {test.key}
                              </span>
                              {isAuto ? (
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  background: '#F3E8FF',
                                  color: '#7E22CE',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                  width: '108px',
                                  justifyContent: 'center',
                                  flexShrink: 0
                                }}>
                                  <span>⚡</span> Automatizado
                                </span>
                              ) : (
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  background: '#F1F5F9',
                                  color: '#475569',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                  width: '108px',
                                  justifyContent: 'center',
                                  flexShrink: 0
                                }}>
                                  Manual
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: '12px',
                                  color: '#334155',
                                  fontWeight: 500,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                                title={test.summary || (findTc(test.id)?.summary) || 'Caso de prueba'}
                              >
                                {test.summary || (findTc(test.id)?.summary) || 'Caso de prueba'}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                handleAddTestToCycle(test);
                              }}
                              style={{
                                height: '28px',
                                padding: '0 10px',
                                borderRadius: '4px',
                                border: '1px solid #E2E8F0',
                                background: '#FFFFFF',
                                color: '#334155',
                                fontSize: '11px',
                                fontWeight: 500,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                flexShrink: 0
                              }}
                            >
                              <span>+</span>
                              <span>Add</span>
                            </button>
                          </div>
                        );
                      })}
                      {!groupByFolder && availableFilteredTestCases.length > planningAvailVisible && (
                        <LoadMoreSentinel key={`avl-${planningAvailVisible}`} remaining={availableFilteredTestCases.length - planningAvailVisible} onVisible={() => setPlanningAvailVisible(v => v + LIST_BATCH_SIZE)} />
                      )}
                      {availableFilteredTestCases.length === 0 && (
                        <div style={{ padding: '28px', textAlign: 'center', color: '#64748B', fontSize: '12px' }}>
                          No hay casos de prueba disponibles con los filtros actuales.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '350px', padding: '3rem', textAlign: 'center', color: '#64748B', margin: 'auto' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#EFF6FF', color: '#0C66E4', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <h3 style={{ margin: '0 0 0.5rem 0', color: '#0F172A', fontSize: '16px', fontWeight: 600 }}>Selecciona un Ciclo de Prueba</h3>
                <p style={{ margin: 0, fontSize: '13px', maxWidth: '400px' }}>
                  Elige un Ciclo Planificado del panel izquierdo para configurar su calendario y asignar casos de prueba.
                </p>
              </div>
            )}
          </div>

          {/* Stitch Bottom Workspace Footer */}
          <footer style={{
            borderTop: '1px solid #E2E8F0',
            background: '#FFFFFF',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#64748B',
            flexShrink: 0,
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '9999px', background: '#0C66E4', display: 'inline-block' }} />
                <strong style={{ color: '#334155' }}>Planeación del Ciclo:</strong>
                <strong style={{ color: '#0F172A' }}>{inCycleCount}</strong> casos asignados para{' '}
                <strong style={{ color: '#0F172A' }}>{cycleDaysCalc.naturalDays} días</strong> programados
              </span>
              <span style={{ color: '#CBD5E1' }}>|</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>Fechas programadas:</span>
                <strong style={{ color: '#334155', fontFamily: 'monospace' }}>
                  {hasCycleDates ? `${formatShortDateEs(cycleScheduleForm.startDate)} - ${formatShortDateEs(cycleScheduleForm.endDate, true)}` : 'Sin definir'}
                </strong>
              </span>
              <span style={{ color: '#CBD5E1' }}>|</span>
              <span>
                Plan activo: <strong style={{ color: '#334155' }}>{currentPlan ? currentPlan.summary : 'Sin plan asignado'}</strong>
                {planDaysCalc.naturalDays > 0 ? ` (Ventana de ${planDaysCalc.naturalDays} días)` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '9999px', background: '#3B82F6', display: 'inline-block' }} />
              <span>Módulo Planning • Definición de Calendario y Asignaciones</span>
            </div>
          </footer>
        </main>
      </div>
    );
}

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
import PanelDockSwitcher, {
  usePanelDockPosition,
  usePanelDockWidth,
  PanelResizeHandle,
  getDockOverlayStyle,
  getDockContainerStyle,
  DOCK_SPLIT_WIDTH
} from './PanelDockSwitcher';

const APP_VERSION = `v${packageJson.version || '4.5.1'}`;

export default function TraceabilitySlidePanel({ ctx }) {
  const [dockPosition, setDockPosition] = usePanelDockPosition();
  const [dockWidth, , isResizingDock] = usePanelDockWidth();
  const {
    formatFileSize,
    handlePreviewEvidence,
    inlineAttachmentUrls,
    openTraceabilityItemModal,
    projectConfig,
    reportData,
    requirementsMap,
    selectedTraceabilityDetails,
    selectedTraceabilityItem,
    selectedTraceabilityLoading,
     loadTestCaseDetails,
    setModalDetailTab,
    setSelectedBug,
    setSelectedTestCase,
    setSelectedTraceabilityItem,
    testCases,
    testCycles,
    testPlans,
    traceabilityHierarchy
  } = ctx;

    if (!selectedTraceabilityItem) return null;

    const item = selectedTraceabilityItem;
    const d = selectedTraceabilityDetails || {};
    const isEpic = item.type === 'epic';
    const itemKey = d.key || item.key || '';
    const itemKeyUpper = String(itemKey).trim().toUpperCase();

    // Lookup fallback metadata from traceabilityHierarchy and requirementsMap
    const hierarchyEpic = (traceabilityHierarchy?.epics || []).find(
      ep => String(ep?.key || '').trim().toUpperCase() === itemKeyUpper
    );
    const hierarchyStory = (traceabilityHierarchy?.stories || []).find(
      st => String(st?.key || '').trim().toUpperCase() === itemKeyUpper
    );
    const reqEntry = requirementsMap?.[itemKey] || requirementsMap?.[itemKeyUpper] || null;

    const summary =
      d.summary ||
      item.summary ||
      hierarchyEpic?.summary ||
      hierarchyStory?.summary ||
      reqEntry?.summary ||
      'Sin título';

    const rawStatus =
      d.status ||
      item.workflowStatus ||
      item.status ||
      hierarchyEpic?.status ||
      hierarchyStory?.status ||
      reqEntry?.status ||
      'Abierto';

    const rawStatusCat = (
      d.statusCategory ||
      item.workflowStatusCategory ||
      item.statusCategory ||
      hierarchyEpic?.statusCategory ||
      hierarchyStory?.statusCategory ||
      reqEntry?.statusCategory ||
      ''
    ).toLowerCase().trim();

    const statusLower = String(rawStatus).toLowerCase().trim();
    let wfColors = { color: '#44546F', bg: '#F1F2F4', border: '#DCDFE4' };
    if (
      rawStatusCat === 'done' ||
      statusLower.includes('finaliz') ||
      statusLower.includes('cerrad') ||
      statusLower.includes('done') ||
      statusLower.includes('complet') ||
      statusLower.includes('resuelt') ||
      statusLower.includes('aprob') ||
      statusLower.includes('producc') ||
      statusLower.includes('liber')
    ) {
      wfColors = { color: '#1F845A', bg: '#DCFFF1', border: '#BAF3DB' };
    } else if (
      statusLower.includes('bloque') ||
      statusLower.includes('imped') ||
      statusLower.includes('rechaz') ||
      statusLower.includes('cancel')
    ) {
      wfColors = { color: '#AE2E24', bg: '#FFECEB', border: '#FFD5D2' };
    } else if (
      rawStatusCat === 'indeterminate' ||
      statusLower.includes('curso') ||
      statusLower.includes('progres') ||
      statusLower.includes('prueb') ||
      statusLower.includes('qa') ||
      statusLower.includes('test') ||
      statusLower.includes('revis') ||
      statusLower.includes('review') ||
      statusLower.includes('desarroll') ||
      statusLower.includes('validac') ||
      statusLower.includes('uat')
    ) {
      wfColors = { color: '#0055CC', bg: '#E9F2FF', border: '#CCE0FF' };
    }

    // Resolve Parent Epic if this is a Story
    const parentEpicKey = !isEpic
      ? (item.epicKey || hierarchyStory?.epicKey || reqEntry?.epicKey || d.parent?.key || null)
      : null;
    const parentEpicKeyUpper = parentEpicKey ? String(parentEpicKey).trim().toUpperCase() : '';
    const parentEpicFromHierarchy = parentEpicKeyUpper
      ? (traceabilityHierarchy?.epics || []).find(ep => String(ep?.key || '').trim().toUpperCase() === parentEpicKeyUpper)
      : null;
    const parentEpicSummary = !isEpic
      ? (item.epicSummary ||
         hierarchyStory?.epicSummary ||
         reqEntry?.epicSummary ||
         parentEpicFromHierarchy?.summary ||
         requirementsMap?.[parentEpicKey]?.summary ||
         d.parent?.summary ||
         '')
      : '';

    // Resolve Linked Test Cases & Execution Context
    const allCyclesForTrace = (reportData?.cycles && reportData.cycles.length > 0)
      ? reportData.cycles
      : (testCycles || []);

    const findTcObj = (ref) => {
      if (!ref) return null;
      const rUp = String(ref).trim().toUpperCase();
      return (testCases || []).find(
        tc => String(tc?.key || '').trim().toUpperCase() === rUp || String(tc?.id || '').trim().toUpperCase() === rUp
      ) || null;
    };

    // Build Story-level Linked Test Cases & Execution Rows
    const storyTcRefs = new Set();
    if (!isEpic) {
      if (Array.isArray(hierarchyStory?.linkedTestCases)) {
        hierarchyStory.linkedTestCases.forEach(tc => {
          if (tc?.key) storyTcRefs.add(String(tc.key).trim().toUpperCase());
          if (tc?.id) storyTcRefs.add(String(tc.id).trim().toUpperCase());
        });
      }
      Object.entries(traceabilityHierarchy?.tcMap || {}).forEach(([tcRef, info]) => {
        if (String(info?.storyKey || '').trim().toUpperCase() === itemKeyUpper) {
          storyTcRefs.add(String(tcRef).trim().toUpperCase());
        }
      });
      (testCases || []).forEach(tc => {
        if (!tc) return;
        const ext = extractEpicAndRequirement(tc, projectConfig, requirementsMap);
        if (String(ext?.reqKey || '').trim().toUpperCase() === itemKeyUpper) {
          if (tc.key) storyTcRefs.add(String(tc.key).trim().toUpperCase());
          if (tc.id) storyTcRefs.add(String(tc.id).trim().toUpperCase());
        }
      });
    }

    const linkedTestCaseObjects = [];
    const seenTcObjKeys = new Set();
    if (!isEpic) {
      storyTcRefs.forEach(ref => {
        const tcObj = findTcObj(ref);
        if (tcObj) {
          const k = tcObj.key || String(tcObj.id);
          if (!seenTcObjKeys.has(k)) {
            seenTcObjKeys.add(k);
            linkedTestCaseObjects.push(tcObj);
          }
        }
      });
      if (Array.isArray(hierarchyStory?.linkedTestCases)) {
        hierarchyStory.linkedTestCases.forEach(tc => {
          const k = tc?.key || String(tc?.id || '');
          if (k && !seenTcObjKeys.has(k)) {
            seenTcObjKeys.add(k);
            linkedTestCaseObjects.push(findTcObj(k) || tc);
          }
        });
      }
    }

    // Execution rows for a Story
    let storyExecutionRows = Array.isArray(item.storyRows) && item.storyRows.length > 0 ? item.storyRows : [];
    if (!isEpic && storyExecutionRows.length === 0 && storyTcRefs.size > 0) {
      const cycleMap = new Map();
      allCyclesForTrace.forEach(cycle => {
        if (!Array.isArray(cycle.execution)) return;
        const cPlanId = cycle.planId || cycle.plan?.id || cycle.plan?.key || (typeof cycle.plan === 'string' ? cycle.plan : null);
        const cyclePlan = (testPlans || []).find(p => String(p.id) === String(cPlanId) || String(p.key) === String(cPlanId));
        const planName = cyclePlan ? (cyclePlan.name || cyclePlan.summary || cyclePlan.key) : 'General (Sin Plan)';
        const planKey = cyclePlan?.key || null;

        cycle.execution.forEach(ex => {
          const tc = findTcObj(ex.testCaseId) || findTcObj(ex.testCaseKey) || findTcObj(ex.id) || (ex.key ? findTcObj(ex.key) : null);
          const tcKeyUp = String(tc?.key || ex.testCaseKey || ex.key || '').trim().toUpperCase();
          const tcIdUp = String(tc?.id || ex.testCaseId || ex.id || '').trim().toUpperCase();
          if ((tcKeyUp && storyTcRefs.has(tcKeyUp)) || (tcIdUp && storyTcRefs.has(tcIdUp))) {
            const cId = String(cycle.id);
            if (!cycleMap.has(cId)) {
              cycleMap.set(cId, {
                id: `${itemKey}_${cId}`,
                cycleId: cycle.id,
                cycleName: cycle.summary || cycle.key || `Ciclo-${cycle.id}`,
                planName,
                planKey,
                statuses: [],
                bugsMap: new Map(),
                executedTcCount: 0
              });
            }
            const bucket = cycleMap.get(cId);
            bucket.statuses.push(ex.status || 'NOT_RUN');
            bucket.executedTcCount += 1;
            if (Array.isArray(ex.linkedBugs)) {
              ex.linkedBugs.forEach(b => {
                if (b && b.key) bucket.bugsMap.set(b.key, b);
              });
            }
          }
        });
      });

      storyExecutionRows = Array.from(cycleMap.values()).map(b => {
        const norms = b.statuses.map(s => normalizeUiStatus(s));
        let aggSt = 'NOT_RUN';
        if (norms.includes('Failed')) aggSt = 'FAILED';
        else if (norms.includes('Blocked')) aggSt = 'BLOCKED';
        else if (norms.length > 0 && norms.every(n => n === 'Passed')) aggSt = 'PASSED';
        else if (norms.some(n => n === 'Passed')) aggSt = 'IN_PROGRESS';
        return {
          id: b.id,
          cycleId: b.cycleId,
          cycleName: b.cycleName,
          planName: b.planName,
          planKey: b.planKey,
          status: aggSt,
          bugs: Array.from(b.bugsMap.values()),
          executedTcCount: b.executedTcCount,
          linkedTcCount: linkedTestCaseObjects.length || storyTcRefs.size
        };
      });
    }

    const storyAllBugsMap = new Map();
    storyExecutionRows.forEach(r => {
      (r.bugs || []).forEach(b => {
        if (b && b.key) storyAllBugsMap.set(b.key, b);
      });
    });
    const storyUniqueBugs = Array.from(storyAllBugsMap.values());
    const storyIsCovered =
      linkedTestCaseObjects.length > 0 ||
      storyTcRefs.size > 0 ||
      (item.rowData?.linkedTcCount || 0) > 0 ||
      storyExecutionRows.some(r => r.cycleId !== null);
    const storyCoveredCasesCount = Math.max(
      linkedTestCaseObjects.length,
      item.rowData?.linkedTcCount || 0,
      item.rowData?.executedTcCount || 0
    );

    // Build Epic-level Stories & Coverage if this is an Epic
    let epicGroupData = item.groupData || null;
    if (isEpic && !epicGroupData) {
      const configuredStoryTypesLower = (projectConfig?.requirementIssueTypes || [])
        .map(t => String(t).toLowerCase().trim())
        .filter(t => t && !['epic', 'épica', 'epica', 'task', 'tarea', 'sub-task', 'subtarea', 'subtask'].some(w => t === w || t.includes(w)));

      const isValidStoryType = (typeStr) => {
        const t = String(typeStr || '').toLowerCase().trim();
        if (!t) return false;
        if (['epic', 'épica', 'epica', 'task', 'tarea', 'sub-task', 'subtarea', 'subtask', 'test', 'caso', 'ciclo', 'plan', 'ejecuc', 'bug', 'defecto', 'error', 'incidencia'].some(w => t === w || t.includes(w))) {
          return false;
        }
        if (configuredStoryTypesLower.length > 0) {
          return configuredStoryTypesLower.some(cfg => t === cfg || t.includes(cfg) || cfg.includes(t));
        }
        return ['story', 'historia', 'historia de usuario', 'user story'].some(w => t === w || t.includes(w));
      };

      const storiesMapForEpic = new Map();
      (traceabilityHierarchy?.stories || []).forEach(st => {
        if (st?.issuetype && !isValidStoryType(st.issuetype)) return;
        if (String(st?.epicKey || '').trim().toUpperCase() === itemKeyUpper && st?.key) {
          storiesMapForEpic.set(st.key.toUpperCase(), {
            key: st.key,
            summary: st.summary || '',
            workflowStatus: st.status || '',
            workflowStatusCategory: st.statusCategory || '',
            linkedTcCount: Array.isArray(st.linkedTestCases) ? st.linkedTestCases.length : 0
          });
        }
      });
      Object.values(requirementsMap || {}).forEach(req => {
        if (!isValidStoryType(req?.issueType)) return;
        if (String(req?.epicKey || '').trim().toUpperCase() === itemKeyUpper && req?.key) {
          const kUp = req.key.toUpperCase();
          if (!storiesMapForEpic.has(kUp)) {
            storiesMapForEpic.set(kUp, {
              key: req.key,
              summary: req.summary || '',
              workflowStatus: req.status || '',
              workflowStatusCategory: req.statusCategory || '',
              linkedTcCount: 0
            });
          }
        }
      });
      (testCases || []).forEach(tc => {
        if (!tc) return;
        const ext = extractEpicAndRequirement(tc, projectConfig, requirementsMap);
        if (String(ext?.epicKey || '').trim().toUpperCase() === itemKeyUpper && ext?.reqKey) {
          const reqFromMap = requirementsMap?.[ext.reqKey];
          if (reqFromMap?.issueType && !isValidStoryType(reqFromMap.issueType)) return;
          const kUp = ext.reqKey.toUpperCase();
          if (!storiesMapForEpic.has(kUp)) {
            storiesMapForEpic.set(kUp, {
              key: ext.reqKey,
              summary: ext.reqSummary || '',
              workflowStatus: reqFromMap?.status || '',
              workflowStatusCategory: reqFromMap?.statusCategory || '',
              linkedTcCount: 1
            });
          } else {
            storiesMapForEpic.get(kUp).linkedTcCount += 1;
          }
        }
      });

      const storyRowsConstructed = Array.from(storiesMapForEpic.values()).map(st => ({
        id: `epic_${itemKey}_${st.key}`,
        epicKey: itemKey,
        epicSummary: summary,
        requirementKey: st.key,
        requirementSummary: st.summary,
        requirementWorkflowStatus: st.workflowStatus,
        requirementWorkflowStatusCategory: st.workflowStatusCategory,
        linkedTcCount: st.linkedTcCount,
        executedTcCount: 0,
        planName: st.linkedTcCount > 0 ? 'Con casos vinculados' : 'Sin casos vinculados',
        planKey: null,
        cycleId: null,
        cycleName: 'Sin ejecución en ciclo',
        status: 'NOT_RUN',
        bugs: []
      }));

      const totalSt = storyRowsConstructed.length;
      const coveredSt = storyRowsConstructed.filter(s => (s.linkedTcCount || 0) > 0).length;
      epicGroupData = {
        epicKey: itemKey,
        epicSummary: summary,
        totalStories: totalSt,
        coveredStories: coveredSt,
        executedStories: 0,
        coveragePct: totalSt > 0 ? Math.round((coveredSt / totalSt) * 100) : 0,
        uniquePlans: [],
        uniqueCycles: [],
        uniqueBugs: [],
        epicStatus: 'NOT_RUN',
        storyRows: storyRowsConstructed
      };
    }

    // Attachments & Comments from Jira issue details
    const attachments = d.attachments || [];
    const imageAttachments = attachments.filter(a => a.isImage);
    const videoAttachments = attachments.filter(a => a.isVideo);
    const otherAttachments = attachments.filter(a => !a.isImage && !a.isVideo);
    const comments = d.comments || [];

    // Description HTML
    let descHtml = '';
    if (d.descriptionRaw) {
      descHtml = sanitizeRenderedHtml(adfToHtml(d.descriptionRaw, attachments, inlineAttachmentUrls), attachments, inlineAttachmentUrls);
    } else if (d.descriptionRendered) {
      descHtml = sanitizeRenderedHtml(d.descriptionRendered, attachments, inlineAttachmentUrls);
    }

    // Dates
    const createdDate = d.created || null;
    const updatedDate = d.updated || null;
    const resDate = d.resolutiondate || null;
    const createdFmt = createdDate ? formatBugCreatedDate(createdDate) : { dateStr: '—', timeStr: '' };
    const updatedFmt = updatedDate ? formatBugCreatedDate(updatedDate) : null;

    // Versions
    let versionsList = [];
    if (Array.isArray(d.fixVersions) && d.fixVersions.length > 0) versionsList = d.fixVersions;
    else if (Array.isArray(d.versions) && d.versions.length > 0) versionsList = d.versions;

    return (
      <div
        className="jira-modal-overlay"
        onClick={() => { if (dockPosition === 'center') setSelectedTraceabilityItem(null); }}
        style={getDockOverlayStyle(dockPosition, 1050)}
      >
        <div
          className="jira-modal-content"
          onClick={(e) => {
            e.stopPropagation();
            const previewEl = e.target.closest && e.target.closest('[data-preview-attachment-id]');
            if (previewEl) {
              e.preventDefault();
              const attId = previewEl.getAttribute('data-preview-attachment-id');
              const attName = previewEl.getAttribute('data-preview-attachment-name') || `evidence_${attId}.png`;
              if (attId) {
                handlePreviewEvidence({ id: attId, filename: attName });
              }
            }
          }}
          style={getDockContainerStyle(dockPosition, {
            centerMaxWidth: '1380px',
            centerWidth: '95%',
            centerHeight: '90vh',
            centerMinHeight: '640px',
            centerMaxHeight: '920px',
            dockWidthPx: dockWidth,
            isResizing: isResizingDock,
            drawerWidth: DOCK_SPLIT_WIDTH,
            drawerMinWidth: '380px'
          })}
        >
          <PanelResizeHandle dockPosition={dockPosition} />
          {/* Header */}
          <div style={{
            padding: '1rem 1.5rem',
            borderBottom: '1px solid #DCDFE4',
            backgroundColor: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            flexWrap: 'wrap',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{
                backgroundColor: isEpic ? '#EAE6FF' : '#DEEBFF',
                color: isEpic ? '#5243AA' : '#0052CC',
                padding: '3px 9px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                border: isEpic ? '1px solid #C0B6F2' : '1px solid #B3D4FF'
              }}>
                {isEpic ? '⚡ ÉPICA' : '📖 HISTORIA DE USUARIO'}
              </span>

              <span style={{ fontSize: '15px', fontWeight: 800, color: isEpic ? '#5243AA' : '#0C66E4' }}>
                {itemKey}
              </span>

              {isEpic && epicGroupData && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: epicGroupData.coveragePct === 100 ? '#1F845A' : epicGroupData.coveragePct > 0 ? '#0C66E4' : '#974F0C',
                    background: epicGroupData.coveragePct === 100 ? '#DCFFF1' : epicGroupData.coveragePct > 0 ? '#E9F2FF' : '#FFF7D6',
                    padding: '2px 9px',
                    borderRadius: '999px'
                  }}
                >
                  {epicGroupData.coveragePct}% Cobertura ({epicGroupData.coveredStories}/{epicGroupData.totalStories} hist.)
                </span>
              )}

              {!isEpic && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: storyIsCovered ? '#1F845A' : '#974F0C',
                    background: storyIsCovered ? '#DCFFF1' : '#FFF7D6',
                    padding: '2px 9px',
                    borderRadius: '999px'
                  }}
                >
                  {storyIsCovered
                    ? `✓ Cubierta (${storyCoveredCasesCount || 1} ${(storyCoveredCasesCount || 1) === 1 ? 'caso' : 'casos'})`
                    : '⚠️ Sin cobertura (0 casos)'}
                </span>
              )}

              {selectedTraceabilityLoading && (
                <span style={{ fontSize: '11px', color: '#626F86', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="spinner-border spinner-border-sm" style={{ width: '12px', height: '12px', border: '2px solid #0C66E4', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                  Cargando detalles...
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PanelDockSwitcher dockPosition={dockPosition} onChange={setDockPosition} />
              <button
                className="btn-icon"
                onClick={() => setSelectedTraceabilityItem(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '4px', color: '#626F86', fontSize: '16px', lineHeight: 1 }}
                title="Cerrar panel"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Modal Main Body (2 Columns) */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Columna Izquierda / Principal (68%) */}
            <div style={{ flex: 1, minWidth: 0, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Título */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                  {isEpic ? 'Resumen de la Épica' : 'Resumen de la Historia de Usuario'}
                </div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', margin: 0, lineHeight: 1.35 }}>
                  {summary}
                </h2>
              </div>

              {/* ── SECCIÓN TRAZABILIDAD EN TEST PULSE ── */}
              {isEpic && epicGroupData ? (
                <div style={{ background: '#F8FAFD', border: '1px solid #DCDFE4', borderRadius: '8px', padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#172B4D', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      🔗 Cobertura y Historias de Usuario Vinculadas ({epicGroupData.totalStories})
                    </span>
                    <AtlaskitStatusLozenge status={epicGroupData.epicStatus || 'NOT_RUN'} />
                  </div>

                  {/* Mini KPIs de la Épica */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginBottom: '12px' }}>
                    <div style={{ background: '#FFFFFF', border: '1px solid #EBECF0', borderRadius: '6px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase' }}>Historias</div>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: '#0055CC' }}>{epicGroupData.totalStories}</div>
                    </div>
                    <div style={{ background: '#FFFFFF', border: '1px solid #EBECF0', borderRadius: '6px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase' }}>Cobertura QA</div>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: epicGroupData.coveragePct === 100 ? '#1F845A' : '#0C66E4' }}>
                        {epicGroupData.coveragePct}% <span style={{ fontSize: '11px', fontWeight: 600, color: '#626F86' }}>({epicGroupData.coveredStories}/{epicGroupData.totalStories})</span>
                      </div>
                    </div>
                    <div style={{ background: '#FFFFFF', border: '1px solid #EBECF0', borderRadius: '6px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase' }}>Planes / Ciclos</div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#1D7F54' }}>
                        {(epicGroupData.uniquePlans || []).length} planes · {(epicGroupData.uniqueCycles || []).length} ciclos
                      </div>
                    </div>
                    <div style={{ background: '#FFFFFF', border: '1px solid #EBECF0', borderRadius: '6px', padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase' }}>Defectos</div>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: (epicGroupData.uniqueBugs || []).length > 0 ? '#DE350B' : '#1F845A' }}>
                        {(epicGroupData.uniqueBugs || []).length} bugs
                      </div>
                    </div>
                  </div>

                  {/* Tabla de Historias Hijas dentro del Modal de la Épica */}
                  {Array.isArray(epicGroupData.storyRows) && epicGroupData.storyRows.length > 0 ? (
                    <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid #DCDFE4', borderRadius: '6px', background: '#FFFFFF' }}>
                      <table className="dashboard-table" style={{ margin: 0, fontSize: '12px' }}>
                        <thead>
                          <tr>
                            <th>Historia de Usuario</th>
                            <th>Cobertura</th>
                            <th>Plan / Ciclo</th>
                            <th>Ejecución</th>
                            <th>Bugs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {epicGroupData.storyRows.map((sRow, idx) => {
                            const sCovered = (sRow.linkedTcCount || 0) > 0 || sRow.cycleId !== null;
                            const sWf = (sRow.requirementWorkflowStatus || '').trim();
                            return (
                              <tr key={sRow.id || idx}>
                                <td>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                      <span
                                        onClick={() => openTraceabilityItemModal('story', sRow.requirementKey, {
                                          summary: sRow.requirementSummary,
                                          workflowStatus: sRow.requirementWorkflowStatus,
                                          workflowStatusCategory: sRow.requirementWorkflowStatusCategory,
                                          epicKey: itemKey,
                                          epicSummary: summary,
                                          rowData: sRow,
                                          storyRows: epicGroupData.storyRows.filter(r => r.requirementKey === sRow.requirementKey)
                                        })}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          fontWeight: 700,
                                          color: '#0065FF',
                                          background: '#DEEBFF',
                                          padding: '1px 7px',
                                          borderRadius: '4px',
                                          fontSize: '11px',
                                          cursor: 'pointer'
                                        }}
                                        title="Ver detalle de esta Historia dentro de Test Pulse"
                                      >
                                        📖 {sRow.requirementKey}
                                      </span>
                                      {sWf && (
                                        <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', padding: '1px 5px', borderRadius: '3px', background: '#EBECF0', color: '#44546F' }}>
                                          {sWf}
                                        </span>
                                      )}
                                    </div>
                                    {sRow.requirementSummary && (
                                      <span
                                        onClick={() => openTraceabilityItemModal('story', sRow.requirementKey, {
                                          summary: sRow.requirementSummary,
                                          workflowStatus: sRow.requirementWorkflowStatus,
                                          workflowStatusCategory: sRow.requirementWorkflowStatusCategory,
                                          epicKey: itemKey,
                                          epicSummary: summary,
                                          rowData: sRow,
                                          storyRows: epicGroupData.storyRows.filter(r => r.requirementKey === sRow.requirementKey)
                                        })}
                                        style={{ fontSize: '11px', color: '#172B4D', cursor: 'pointer', fontWeight: 500 }}
                                      >
                                        {sRow.requirementSummary}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td style={{ whiteSpace: 'nowrap' }}>
                                  <span style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    color: sCovered ? '#1F845A' : '#974F0C',
                                    background: sCovered ? '#DCFFF1' : '#FFF7D6',
                                    padding: '2px 7px',
                                    borderRadius: '999px'
                                  }}>
                                    {sCovered ? `✓ ${sRow.linkedTcCount || sRow.executedTcCount || 1} casos` : '⚠️ 0 casos'}
                                  </span>
                                </td>
                                <td style={{ fontSize: '11px', color: '#44546F' }}>
                                  <div>📋 {sRow.planName}</div>
                                  <div style={{ fontSize: '10px', color: '#626F86' }}>🔄 {sRow.cycleName}</div>
                                </td>
                                <td>
                                  <AtlaskitStatusLozenge status={sRow.status} />
                                </td>
                                <td>
                                  {Array.isArray(sRow.bugs) && sRow.bugs.length > 0 ? (
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                      {sRow.bugs.map((b, bIdx) => (
                                        <span
                                          key={bIdx}
                                          onClick={() => { setSelectedTraceabilityItem(null); setSelectedBug(b); }}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                            fontSize: '10px',
                                            fontWeight: 700,
                                            color: '#DE350B',
                                            background: '#FFEBE6',
                                            padding: '1px 6px',
                                            borderRadius: '4px',
                                            cursor: 'pointer'
                                          }}
                                          title={`Ver defecto ${b.key} en Test Pulse`}
                                        >
                                          🐞 {b.key}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: '11px', color: '#8590A2' }}>0</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>
                      Esta épica aún no tiene Historias de Usuario vinculadas.
                    </div>
                  )}
                </div>
              ) : (
                /* ── TRAZABILIDAD DE LA HISTORIA DE USUARIO ── */
                <div style={{ background: '#F8FAFD', border: '1px solid #DCDFE4', borderRadius: '8px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#172B4D', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      🔗 Trazabilidad QA en Test Pulse
                    </span>
                  </div>

                  {/* Ejecución en Planes y Ciclos */}
                  {storyExecutionRows.length > 0 ? (
                    <div style={{ border: '1px solid #DCDFE4', borderRadius: '6px', background: '#FFFFFF', overflow: 'hidden' }}>
                      <table className="dashboard-table" style={{ margin: 0, fontSize: '12px' }}>
                        <thead>
                          <tr>
                            <th>Plan de Pruebas</th>
                            <th>Ciclo de Pruebas</th>
                            <th>Estado de Ejecución</th>
                            <th>Defectos Vinculados</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storyExecutionRows.map((er, idx) => (
                            <tr key={er.id || idx}>
                              <td style={{ fontWeight: 600, color: '#1D7F54' }}>📋 {er.planName}</td>
                              <td style={{ fontWeight: 600, color: '#172B4D' }}>🔄 {er.cycleName}</td>
                              <td><AtlaskitStatusLozenge status={er.status} /></td>
                              <td>
                                {Array.isArray(er.bugs) && er.bugs.length > 0 ? (
                                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {er.bugs.map((b, bIdx) => (
                                      <span
                                        key={bIdx}
                                        onClick={() => { setSelectedTraceabilityItem(null); setSelectedBug(b); }}
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
                                          cursor: 'pointer'
                                        }}
                                        title={`Ver defecto ${b.key} en Test Pulse`}
                                      >
                                        🐞 {b.key}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span style={{ fontSize: '11px', color: '#8590A2' }}>0 bugs</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>
                      {storyIsCovered
                        ? 'Esta historia cuenta con casos de prueba diseñados, pero aún no han sido ejecutados en ningún ciclo.'
                        : 'Esta historia aún no tiene casos de prueba ni ciclos vinculados.'}
                    </div>
                  )}

                  {/* Casos de Prueba Vinculados a la Historia (Clic para abrir en Test Pulse) */}
                  {linkedTestCaseObjects.length > 0 && (
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#44546F', marginBottom: '6px' }}>
                        🧪 Casos de Prueba Vinculados ({linkedTestCaseObjects.length}):
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {linkedTestCaseObjects.map((tc, idx) => (
                          <span
                            key={tc.id || tc.key || idx}
                            onClick={() => {
                              setSelectedTraceabilityItem(null);
                              setSelectedTestCase(tc);
                              setModalDetailTab('details');
                              loadTestCaseDetails(tc.id);
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '4px 9px',
                              background: '#FFFFFF',
                              border: '1px solid #DCDFE4',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#0C66E4',
                              cursor: 'pointer'
                            }}
                            title="Haz clic para abrir este Caso de Prueba en Test Pulse"
                          >
                            <span style={{ fontWeight: 800 }}>🧪 {tc.key || tc.id}</span>
                            {tc.summary && (
                              <span style={{ color: '#172B4D', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                — {tc.summary}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Descripción / Criterios de Aceptación */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #F1F2F4', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    📝 Descripción &amp; Criterios de Aceptación
                  </span>
                </div>

                {selectedTraceabilityLoading && !descHtml ? (
                  <div style={{ padding: '1.5rem', background: '#F8FAFD', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ height: '14px', width: '85%', background: '#E9F2FF', borderRadius: '4px', animation: 'pulse 1.2s infinite' }} />
                    <div style={{ height: '14px', width: '60%', background: '#E9F2FF', borderRadius: '4px', animation: 'pulse 1.2s infinite' }} />
                    <div style={{ height: '14px', width: '75%', background: '#E9F2FF', borderRadius: '4px', animation: 'pulse 1.2s infinite' }} />
                  </div>
                ) : descHtml ? (
                  <div
                    style={{
                      padding: '1rem',
                      background: '#FAFBFC',
                      border: '1px solid #EBECF0',
                      borderRadius: '6px',
                      fontSize: '13px',
                      lineHeight: '1.6',
                      color: 'var(--jira-dark, #172B4D)',
                      overflowX: 'auto'
                    }}
                    dangerouslySetInnerHTML={{ __html: descHtml }}
                  />
                ) : (
                  <div style={{ padding: '1.25rem', background: '#F8FAFD', border: '1px dashed #DCDFE4', borderRadius: '6px', fontSize: '12px', color: '#626F86', fontStyle: 'italic', textAlign: 'center' }}>
                    {isEpic
                      ? 'Esta épica no cuenta con descripción de texto registrada en Jira.'
                      : 'Esta historia de usuario no cuenta con descripción ni criterios de aceptación registrados en Jira.'}
                  </div>
                )}
              </div>

              {/* Imágenes, Videos & Archivos Adjuntos */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #F1F2F4', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🖼️ Archivos Adjuntos &amp; Anexos ({attachments.length})
                  </span>
                </div>

                {attachments.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {imageAttachments.length > 0 && (
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '6px' }}>
                          Imágenes ({imageAttachments.length}):
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                          {imageAttachments.map(att => (
                            <BugAttachmentImageCard
                              key={att.id}
                              att={att}
                              onPreview={handlePreviewEvidence}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {videoAttachments.length > 0 && (
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '6px' }}>
                          Videos ({videoAttachments.length}):
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
                          {videoAttachments.map(att => (
                            <div
                              key={att.id}
                              onClick={() => handlePreviewEvidence(att)}
                              style={{
                                border: '1px solid #DCDFE4',
                                borderRadius: '6px',
                                overflow: 'hidden',
                                background: '#FFFFFF',
                                padding: '8px',
                                cursor: 'pointer'
                              }}
                            >
                              <div style={{ height: '100px', backgroundColor: '#091E42', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', color: '#FFF' }}>
                                <span>▶ Reproducir Video</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px' }}>
                                <span style={{ fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }} title={att.filename}>
                                  🎥 {att.filename}
                                </span>
                                <span style={{ color: '#626F86', fontSize: '10px' }}>
                                  {formatFileSize(att.size)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {otherAttachments.length > 0 && (
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '6px' }}>
                          Documentos ({otherAttachments.length}):
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {otherAttachments.map(att => (
                            <div
                              key={att.id}
                              onClick={() => handlePreviewEvidence(att)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 10px',
                                background: '#F4F5F7',
                                border: '1px solid #DCDFE4',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                color: '#0C66E4',
                                fontSize: '12px',
                                fontWeight: 600
                              }}
                            >
                              <span>📄</span>
                              <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.filename}</span>
                              <span style={{ color: '#626F86', fontSize: '10px', fontWeight: 400 }}>({formatFileSize(att.size)})</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: '0.85rem 1rem', background: '#F8FAFD', border: '1px dashed #DCDFE4', borderRadius: '6px', fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>
                    Sin archivos adjuntos registrados.
                  </div>
                )}
              </div>

              {/* Historial de Comentarios */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #F1F2F4', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    💬 Historial de Comentarios ({comments.length})
                  </span>
                </div>

                {comments.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {comments.map((comm) => {
                      const commDate = formatBugCreatedDate(comm.created);
                      const commBodyHtml = comm.bodyRaw
                        ? sanitizeRenderedHtml(adfToHtml(comm.bodyRaw, attachments, inlineAttachmentUrls), attachments, inlineAttachmentUrls)
                        : sanitizeRenderedHtml(comm.bodyRendered || '', attachments, inlineAttachmentUrls);
                      return (
                        <div
                          key={comm.id}
                          style={{
                            border: '1px solid #EBECF0',
                            borderRadius: '8px',
                            padding: '10px 14px',
                            backgroundColor: '#FFFFFF',
                            boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {comm.author.avatarUrl ? (
                                <img
                                  src={comm.author.avatarUrl}
                                  alt={comm.author.displayName}
                                  style={{ width: '22px', height: '22px', borderRadius: '50%' }}
                                />
                              ) : (
                                <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#0C66E4', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>
                                  {(comm.author.displayName || 'U').charAt(0).toUpperCase()}
                                </div>
                              )}
                              <span style={{ fontSize: '12px', fontWeight: 700, color: '#172B4D' }}>
                                {comm.author.displayName}
                              </span>
                            </div>
                            <span style={{ fontSize: '11px', color: '#626F86' }}>
                              📅 {commDate.dateStr} {commDate.timeStr && `a las ${commDate.timeStr}`}
                            </span>
                          </div>
                          <div
                            style={{ fontSize: '12.5px', lineHeight: '1.5', color: '#172B4D', paddingLeft: '30px' }}
                            dangerouslySetInnerHTML={{ __html: commBodyHtml }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '1rem', background: '#F8FAFD', border: '1px dashed #DCDFE4', borderRadius: '6px', fontSize: '12px', color: '#626F86', fontStyle: 'italic', textAlign: 'center' }}>
                    No hay comentarios registrados en esta {isEpic ? 'épica' : 'historia de usuario'}.
                  </div>
                )}
              </div>
            </div>

            {/* Columna Derecha / Panel Lateral de Metadatos (320px) */}
            <div style={{ width: dockPosition === 'center' ? '320px' : '235px', flexShrink: 0, borderLeft: '1px solid #DCDFE4', backgroundColor: '#F8FAFD', padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#172B4D', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #DCDFE4', paddingBottom: '6px' }}>
                Detalles &amp; Metadatos
              </div>

              {/* 1. Estado del Flujo en Jira */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  🔄 ESTADO EN FLUJO JIRA
                </div>
                <div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: wfColors.color,
                      background: wfColors.bg,
                      border: `1px solid ${wfColors.border}`,
                      padding: '4px 10px',
                      borderRadius: '4px'
                    }}
                  >
                    {rawStatus}
                  </span>
                </div>
              </div>

              {/* 2. Persona Asignada */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  👤 PERSONA ASIGNADA
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FFFFFF', padding: '6px 10px', borderRadius: '6px', border: '1px solid #EBECF0' }}>
                  {d.assignee?.avatarUrl ? (
                    <img src={d.assignee.avatarUrl} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: d.assignee ? '#0C66E4' : '#626F86', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>
                      {(d.assignee?.displayName || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.assignee?.displayName || 'Sin asignar'}
                    </span>
                    {d.assignee?.email && (
                      <span style={{ fontSize: '10px', color: '#626F86', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.assignee.email}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. Informador (Reporter) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  📣 INFORMADOR / REPORTER
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FFFFFF', padding: '6px 10px', borderRadius: '6px', border: '1px solid #EBECF0' }}>
                  {d.reporter?.avatarUrl ? (
                    <img src={d.reporter.avatarUrl} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#5243AA', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>
                      {(d.reporter?.displayName || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.reporter?.displayName || 'Sin especificar'}
                    </span>
                    {d.reporter?.email && (
                      <span style={{ fontSize: '10px', color: '#626F86', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.reporter.email}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 4. Prioridad */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  ⚡ PRIORIDAD
                </div>
                <div style={{ background: '#FFFFFF', padding: '6px 10px', borderRadius: '6px', border: '1px solid #EBECF0', fontSize: '12px', fontWeight: 700, color: '#172B4D' }}>
                  {d.priority || 'Media'}
                </div>
              </div>

              {/* 5. Épica Padre (si es Historia) */}
              {!isEpic && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                    ⚡ ÉPICA PADRE
                  </div>
                  <div style={{ background: '#FFFFFF', padding: '8px 10px', borderRadius: '6px', border: '1px solid #EBECF0' }}>
                    {parentEpicKey ? (
                      <div
                        onClick={() => openTraceabilityItemModal('epic', parentEpicKey, { summary: parentEpicSummary })}
                        style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '3px' }}
                      >
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#6554C0', background: '#EAE6FF', padding: '2px 7px', borderRadius: '4px', width: 'fit-content' }}>
                          ⚡ {parentEpicKey}
                        </span>
                        {parentEpicSummary && (
                          <span style={{ fontSize: '11.5px', color: '#172B4D', fontWeight: 500 }}>
                            {parentEpicSummary}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>Sin Épica vinculada</span>
                    )}
                  </div>
                </div>
              )}

              {/* 6. Versiones / Releases */}
              {versionsList.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                    🏷️ VERSIÓN / RELEASE
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', background: '#FFFFFF', padding: '8px 10px', borderRadius: '6px', border: '1px solid #EBECF0' }}>
                    {versionsList.map((v, i) => (
                      <span key={i} style={{ backgroundColor: '#E9F2FF', color: '#0C66E4', border: '1px solid #B3D4FF', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 7. Etiquetas (Labels) */}
              {Array.isArray(d.labels) && d.labels.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                    🔖 ETIQUETAS
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', background: '#FFFFFF', padding: '8px 10px', borderRadius: '6px', border: '1px solid #EBECF0' }}>
                    {d.labels.map((lbl, i) => (
                      <span key={i} style={{ backgroundColor: '#F1F2F4', color: '#44546F', padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                        {lbl}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 8. Fechas */}
              <div style={{ borderTop: '1px solid #EBECF0', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#626F86' }}>
                <div><strong>Creado:</strong> {createdFmt.dateStr} {createdFmt.timeStr}</div>
                {updatedFmt && <div><strong>Actualizado:</strong> {updatedFmt.dateStr} {updatedFmt.timeStr}</div>}
                {resDate && <div><strong>Resuelto:</strong> {formatBugCreatedDate(resDate).dateStr}</div>}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid #DCDFE4', backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', color: '#626F86' }}>
              Test Pulse QA Engine • {isEpic ? 'Épica' : 'Historia de Usuario'} {itemKey}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn-secondary"
                onClick={() => setSelectedTraceabilityItem(null)}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.8rem' }}
              >
                Cerrar
              </button>
              <button
                className="btn-primary"
                onClick={() => router.open('/browse/' + itemKey)}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <span>Abrir en Jira</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
}

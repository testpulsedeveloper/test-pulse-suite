import React, { useState, useRef } from 'react';
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
import PanelDockSwitcher, {
  usePanelDockPosition,
  usePanelDockWidth,
  PanelResizeHandle,
  getDockOverlayStyle,
  getDockContainerStyle,
  DOCK_SPLIT_WIDTH
} from './PanelDockSwitcher';

const APP_VERSION = `v${packageJson.version || '4.5.1'}`;
const BUG_META_WIDTH_KEY = 'tp_bug_meta_col_width';

export default function BugSlidePanel({ ctx }) {
  const [dockPosition, setDockPosition] = usePanelDockPosition();
  const [dockWidth, , isResizingDock] = usePanelDockWidth();
  const [metaColWidth, setMetaColWidth] = useState(() => {
    try {
      const saved = parseInt(window.localStorage.getItem(BUG_META_WIDTH_KEY) || '', 10);
      if (Number.isFinite(saved) && saved >= 195 && saved <= 480) return saved;
    } catch (_) {}
    return 275;
  });
  const [isMetaResizing, setIsMetaResizing] = useState(false);
  const [isMetaHover, setIsMetaHover] = useState(false);
  const metaColRef = useRef(null);
  const assigneeSearchSeqRef = useRef(0);
  const {
    addNotification,
    bugAddingVersion,
    bugAssigneeOpen,
    bugAssigneeQuery,
    bugAssigneeResults,
    bugAssigneeSearching,
    bugCommentFiles,
    bugCommentText,
    bugCustomVersionInput,
    bugEditingEnv,
    bugEnvDraft,
    bugSavingField,
    bugSubmittingComment,
    bugUploadingStandalone,
    formatFileSize,
    handlePreviewEvidence,
    inlineAttachmentUrls,
    selectedBug,
    selectedBugDetails,
    selectedBugLoading,
    selectedProjectId,
    setBugAddingVersion,
    setBugAssigneeOpen,
    setBugAssigneeQuery,
    setBugAssigneeResults,
    setBugAssigneeSearching,
    setBugCommentFiles,
    setBugCommentText,
    setBugCustomVersionInput,
    setBugEditingEnv,
    setBugEnvDraft,
    setBugSavingField,
    setBugSubmittingComment,
    setBugUploadingStandalone,
    setReportData,
    setSelectedBug,
    setSelectedBugDetails,
    setUnlinkedBugs
  } = ctx;

    if (!selectedBug) return null;

    const b = selectedBugDetails || selectedBug;
    const bugKey = b.key || selectedBug.key || 'BUG';
    const summary = b.summary || selectedBug.summary || 'Sin título';
    const rawStatus = b.status || selectedBug.status || 'Abierto';
    const isDone = ['closed', 'cerrada', 'cerrado'].includes(String(rawStatus).toLowerCase().trim());
    const statusNormLower = String(rawStatus || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    const isResolvedState =
      isDone ||
      b.statusCategory === 'done' ||
      statusNormLower.includes('resuelta') ||
      statusNormLower.includes('resuelto') ||
      statusNormLower.includes('resolved') ||
      statusNormLower.includes('validaci') ||
      statusNormLower.includes('validation') ||
      statusNormLower.includes('cerrada') ||
      statusNormLower.includes('cerrado') ||
      statusNormLower.includes('closed') ||
      statusNormLower.includes('done') ||
      statusNormLower.includes('listo') ||
      statusNormLower.includes('finalizad') ||
      statusNormLower.includes('completad') ||
      statusNormLower.includes('solucionad');

    // Regla estricta: el selector de Resolución solo se desbloquea cuando el bug está específicamente en estado "Resuelta" / "Resuelto" / "Resolved"
    const isStrictlyResueltaState =
      statusNormLower === 'resuelta' ||
      statusNormLower === 'resuelto' ||
      statusNormLower === 'resolved' ||
      statusNormLower.startsWith('resuelta ') ||
      statusNormLower.startsWith('resuelto ');

    // Helper to keep local state (modal + tables) in sync after any in-app bug edit
    const syncUpdatedBugToState = (fresh) => {
      if (!fresh) return;
      setSelectedBugDetails(fresh);
      const fixVerArr = (Array.isArray(fresh.fixVersions) && fresh.fixVersions.length > 0)
        ? fresh.fixVersions
        : (Array.isArray(fresh.versions) ? fresh.versions : []);
      const versionStr = fixVerArr.length > 0 ? fixVerArr.join(', ') : 'Sin versión';
      const estDateVal = fresh.estimatedResolutionDate || null;
      const assigneeName = fresh.assignee?.displayName || 'Sin asignar';

      setSelectedBug(prev => prev ? {
        ...prev,
        status: fresh.status || prev.status,
        severity: fresh.severity || prev.severity,
        rawSeverity: fresh.rawSeverity || fresh.severity || prev.rawSeverity,
        assignee: assigneeName,
        resolution: fresh.resolution ?? prev.resolution,
        resolutiondate: fresh.resolutiondate ?? prev.resolutiondate,
        fixVersions: fixVerArr,
        versions: fixVerArr,
        version: versionStr,
        estimatedResolutionDate: estDateVal,
        duedate: estDateVal
      } : null);

      if (typeof setReportData === 'function') {
        setReportData(prev => {
          if (!prev || !prev.bugMap || !prev.bugMap[bugKey]) return prev;
          const updatedBugEntry = {
            ...prev.bugMap[bugKey],
            status: fresh.status || prev.bugMap[bugKey].status,
            severity: fresh.severity || prev.bugMap[bugKey].severity,
            assignee: assigneeName,
            resolution: fresh.resolution ?? prev.bugMap[bugKey].resolution,
            resolutiondate: fresh.resolutiondate ?? prev.bugMap[bugKey].resolutiondate,
            fixVersions: fixVerArr,
            version: versionStr,
            estimatedResolutionDate: estDateVal,
            duedate: estDateVal
          };
          return {
            ...prev,
            bugMap: {
              ...prev.bugMap,
              [bugKey]: updatedBugEntry
            }
          };
        });
      }

      if (typeof setUnlinkedBugs === 'function') {
        setUnlinkedBugs(prev => Array.isArray(prev) ? prev.map(item => {
          if (item.key !== bugKey) return item;
          return {
            ...item,
            status: fresh.status || item.status,
            severity: fresh.severity || item.severity,
            assignee: assigneeName,
            resolution: fresh.resolution ?? item.resolution,
            resolutiondate: fresh.resolutiondate ?? item.resolutiondate,
            fixVersions: fixVerArr,
            version: versionStr,
            estimatedResolutionDate: estDateVal,
            duedate: estDateVal
          };
        }) : prev);
      }
    };

    const handleUpdateBugField = async (field, value, extraPayload = {}, label = field) => {
      if (!bugKey) return;
      setBugSavingField(field);
      try {
        const res = await invoke('updateBugIssue', {
          issueIdOrKey: bugKey,
          field,
          value,
          ...extraPayload
        });
        if (res && res.error) {
          addNotification('Error al actualizar bug', `No se pudo actualizar ${label}: ${res.error}`, 'error');
        } else {
          const fresh = await invoke('getBugFullDetails', { issueIdOrKey: bugKey });
          if (fresh && !fresh.error) {
            syncUpdatedBugToState(fresh);
          }
          addNotification('Bug actualizado', `Se actualizó ${label} en ${bugKey}.`, 'success');
        }
      } catch (err) {
        console.error(`Error updating bug field ${field}:`, err);
        addNotification('Error al actualizar bug', err.message || String(err), 'error');
      } finally {
        setBugSavingField(null);
      }
    };

    const handleSearchBugAssignee = async (queryText) => {
      const reqId = ++assigneeSearchSeqRef.current;
      setBugAssigneeQuery(queryText);
      setBugAssigneeSearching(true);
      try {
        const pKey = b.projectKey || (bugKey && bugKey.includes('-') ? bugKey.split('-')[0] : null);
        const users = await invoke('searchAssignableUsers', {
          issueKey: bugKey && bugKey !== 'BUG' ? bugKey : null,
          projectKey: pKey,
          projectId: selectedProjectId,
          query: queryText || ''
        });
        if (reqId === assigneeSearchSeqRef.current) {
          setBugAssigneeResults(Array.isArray(users) ? users : []);
        }
      } catch (err) {
        console.error('Error searching assignable users for bug:', err);
        if (reqId === assigneeSearchSeqRef.current) {
          setBugAssigneeResults([]);
        }
      } finally {
        if (reqId === assigneeSearchSeqRef.current) {
          setBugAssigneeSearching(false);
        }
      }
    };

    const fileToBase64Obj = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const resultStr = String(reader.result || '');
        const commaIdx = resultStr.indexOf(',');
        const base64Data = commaIdx >= 0 ? resultStr.slice(commaIdx + 1) : resultStr;
        resolve({
          filename: file.name || `captura_${Date.now()}.png`,
          mimeType: file.type || 'application/octet-stream',
          size: file.size || 0,
          base64Data,
          previewUrl: (file.type || '').startsWith('image/') ? resultStr : null
        });
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });

    const handleBugCommentFilesSelect = async (fileList) => {
      if (!fileList || fileList.length === 0) return;
      try {
        const converted = await Promise.all(Array.from(fileList).map(f => fileToBase64Obj(f)));
        setBugCommentFiles(prev => [...prev, ...converted]);
      } catch (err) {
        console.error('Error reading selected files:', err);
        addNotification('Error al leer archivo', 'No se pudo procesar el archivo seleccionado.', 'error');
      }
    };

    const handleBugCommentPaste = async (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const imageFiles = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
            const namedFile = new File([blob], `captura_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`, { type: blob.type });
            imageFiles.push(namedFile);
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        await handleBugCommentFilesSelect(imageFiles);
        addNotification('Captura adjuntada', 'La captura del portapapeles se agregó al comentario.', 'info');
      }
    };

    const handleAddBugComment = async () => {
      const hasText = bugCommentText && bugCommentText.trim().length > 0;
      const hasFiles = bugCommentFiles && bugCommentFiles.length > 0;
      if (!hasText && !hasFiles) return;

      setBugSubmittingComment(true);
      try {
        const res = await invoke('addBugComment', {
          issueIdOrKey: bugKey,
          commentText: bugCommentText,
          files: bugCommentFiles.map(f => ({
            filename: f.filename,
            mimeType: f.mimeType,
            base64Data: f.base64Data
          }))
        });
        if (res && res.error) {
          addNotification('Error al publicar comentario', res.error, 'error');
        } else {
          setBugCommentText('');
          setBugCommentFiles([]);
          const fresh = await invoke('getBugFullDetails', { issueIdOrKey: bugKey });
          if (fresh && !fresh.error) {
            syncUpdatedBugToState(fresh);
          }
          addNotification('Comentario publicado', `Se registró el comentario${hasFiles ? ' y la evidencia adjunta' : ''} en ${bugKey}.`, 'success');
        }
      } catch (err) {
        console.error('Error submitting bug comment:', err);
        addNotification('Error al comentar', err.message || String(err), 'error');
      } finally {
        setBugSubmittingComment(false);
      }
    };

    const handleStandaloneBugAttachmentUpload = async (e) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      setBugUploadingStandalone(true);
      try {
        const converted = await Promise.all(Array.from(fileList).map(f => fileToBase64Obj(f)));
        const res = await invoke('addBugComment', {
          issueIdOrKey: bugKey,
          commentText: '',
          files: converted.map(f => ({
            filename: f.filename,
            mimeType: f.mimeType,
            base64Data: f.base64Data
          }))
        });
        if (res && res.error) {
          addNotification('Error al subir archivo', res.error, 'error');
        } else {
          const fresh = await invoke('getBugFullDetails', { issueIdOrKey: bugKey });
          if (fresh && !fresh.error) {
            syncUpdatedBugToState(fresh);
          }
          addNotification('Archivo adjuntado', `Se subió ${converted.length === 1 ? converted[0].filename : `${converted.length} archivos`} a ${bugKey}.`, 'success');
        }
      } catch (err) {
        console.error('Error uploading standalone attachment:', err);
        addNotification('Error al subir archivo', err.message || String(err), 'error');
      } finally {
        setBugUploadingStandalone(false);
        e.target.value = '';
      }
    };

    // Severities (*Severity custom field)
    const rawSev = b.rawSeverity || b.severity || selectedBug.severity || 'Sin definir';
    const sevNormalized = typeof rawSev === 'string' ? rawSev : (rawSev.value || rawSev.name || 'Sin definir');
    const sevLow = sevNormalized.toLowerCase();

    let sevBg = '#F1F2F4';
    let sevColor = '#626F86';
    let sevBorder = '#DCDFE4';

    if (sevLow.includes('bloq') || sevLow.includes('blocker')) {
      sevBg = '#FFEBE6';
      sevColor = '#BF2600';
      sevBorder = '#FF8F73';
    } else if (sevLow.includes('crit') || sevLow.includes('crít')) {
      sevBg = '#FFF0ED';
      sevColor = '#DE350B';
      sevBorder = '#FFBDAD';
    } else if (sevLow.includes('may') || sevLow.includes('major') || sevLow.includes('alta') || sevLow.includes('high')) {
      sevBg = '#FFFAE6';
      sevColor = '#974F00';
      sevBorder = '#FFE380';
    } else if (sevLow.includes('men') || sevLow.includes('minor') || sevLow.includes('baja') || sevLow.includes('low') || sevLow.includes('trivial')) {
      sevBg = '#E3FCEF';
      sevColor = '#006644';
      sevBorder = '#ABF5D1';
    }

    const severityOptionsList = (Array.isArray(b.severityOptions) && b.severityOptions.length > 0)
      ? b.severityOptions
      : ['Bloqueante', 'Crítico', 'Mayor', 'Medio', 'Menor'].map(v => ({ id: v, value: v }));

    // Dates & Aging
    const createdDate = b.created || selectedBug.created;
    const resDate = b.resolutiondate || selectedBug.resolutiondate;
    const { dateStr, timeStr } = formatBugCreatedDate(createdDate);
    const age = formatBugAge(createdDate, resDate, isDone, { ...selectedBug, ...b, status: rawStatus });

    const badgeColor = age.tone === 'red' ? '#FFEBE6' : age.tone === 'orange' ? '#FFF0B3' : age.tone === 'green' ? '#E3FCEF' : age.tone === 'onhold' ? '#E9F2FF' : '#F1F2F4';
    const textColor = age.tone === 'red' ? '#BF2600' : age.tone === 'orange' ? '#172B4D' : age.tone === 'green' ? '#006644' : age.tone === 'onhold' ? '#0C66E4' : '#44546F';

    // Fecha Estimada de Solución (strictly customfield_10763 / estimatedResolutionDate, NOT duedate)
    const estDateRaw = b.estimatedResolutionDate || selectedBug.estimatedResolutionDate || null;
    const estDateInputVal = estDateRaw ? String(estDateRaw).slice(0, 10) : '';
    let formattedEstDate = null;
    let isEstDateFlagged = false;

    if (estDateInputVal) {
      try {
        const d = new Date(`${estDateInputVal}T12:00:00`);
        if (!isNaN(d.getTime())) {
          formattedEstDate = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
          const statusLower = String(rawStatus).toLowerCase();
          const isInProgress = statusLower.includes('curso') || statusLower.includes('progress') || statusLower.includes('progreso') || statusLower.includes('desarrollo') || statusLower.includes('testing') || statusLower.includes('atención');
          const isOverdue = d.getTime() < Date.now() && !isDone;
          if (isInProgress || isOverdue) {
            isEstDateFlagged = true;
          }
        }
      } catch (e) {}
    }

    // Versiones afectadas -> check non-empty fixVersions, versions, and selectedBug.version from table list
    let fixVersionsList = [];
    if (Array.isArray(b.fixVersions) && b.fixVersions.length > 0) {
      fixVersionsList = b.fixVersions;
    } else if (Array.isArray(b.versions) && b.versions.length > 0) {
      fixVersionsList = b.versions;
    } else if (Array.isArray(selectedBug.fixVersions) && selectedBug.fixVersions.length > 0) {
      fixVersionsList = selectedBug.fixVersions;
    } else if (Array.isArray(selectedBug.versions) && selectedBug.versions.length > 0) {
      fixVersionsList = selectedBug.versions;
    } else if (selectedBug.version && selectedBug.version !== 'Sin versión') {
      fixVersionsList = String(selectedBug.version).split(',').map(s => s.trim()).filter(Boolean);
    }

    const availableVersionsList = Array.isArray(b.availableVersions) ? b.availableVersions : [];
    const transitionsList = Array.isArray(b.transitions) ? b.transitions : [];
    const resolutionOptionsList = (Array.isArray(b.resolutionOptions) && b.resolutionOptions.length > 0)
      ? b.resolutionOptions
      : ['Done', 'Fixed', 'Listo', 'Won\'t Fix', 'Duplicate', 'Cannot Reproduce'].map(name => ({ id: name, name }));

    // Attachments
    const attachments = b.attachments || [];
    const imageAttachments = attachments.filter(a => a.isImage);
    const videoAttachments = attachments.filter(a => a.isVideo);
    const otherAttachments = attachments.filter(a => !a.isImage && !a.isVideo);

    // Comments
    const comments = b.comments || [];

    // Description HTML (clean and mapped with attachments + preloaded blob URLs)
    let descHtml = '';
    if (b.descriptionRaw) {
      descHtml = sanitizeRenderedHtml(adfToHtml(b.descriptionRaw, attachments, inlineAttachmentUrls), attachments, inlineAttachmentUrls);
    } else if (b.descriptionRendered) {
      descHtml = sanitizeRenderedHtml(b.descriptionRendered, attachments, inlineAttachmentUrls);
    } else if (selectedBug.description) {
      descHtml = sanitizeRenderedHtml(adfToHtml(selectedBug.description, attachments, inlineAttachmentUrls), attachments, inlineAttachmentUrls);
    }

    return (
      <div 
        className="jira-modal-overlay"
        onClick={() => { if (dockPosition === 'center') setSelectedBug(null); }}
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
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ 
                backgroundColor: '#FFEBE6', 
                color: '#DE350B', 
                padding: '3px 8px', 
                borderRadius: '4px', 
                fontSize: '11px', 
                fontWeight: 700, 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '4px',
                border: '1px solid #FFBDAD'
              }}>
                🐞 DEFECTO / BUG
              </span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#0C66E4' }}>
                {bugKey}
              </span>
              {/* Read-only Status Badge in Header (Status selector lives in the right-hand panel) */}
              <span
                className={`ads-lozenge ${isResolvedState ? 'ads-lozenge-success' : 'ads-lozenge-current'}`}
                style={{ fontSize: '11px', fontWeight: 700 }}
              >
                {rawStatus}
              </span>
              {(selectedBugLoading || bugSavingField) && (
                <span style={{ fontSize: '11px', color: '#0C66E4', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <span className="spinner-border spinner-border-sm" style={{ width: '12px', height: '12px', border: '2px solid #0C66E4', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                  {bugSavingField ? 'Guardando cambios en Jira...' : 'Cargando detalles...'}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PanelDockSwitcher dockPosition={dockPosition} onChange={setDockPosition} />
              <button
                className="btn-icon"
                onClick={() => setSelectedBug(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '4px', color: '#626F86', fontSize: '16px', lineHeight: 1 }}
                title="Cerrar panel"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Modal Main Body (2 Columns) */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Columna Izquierda / Principal (65%) */}
            <div style={{ flex: 1, minWidth: 0, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Resumen / Título */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                  Resumen del Bug
                </div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', margin: 0, lineHeight: 1.35 }}>
                  {summary}
                </h2>
              </div>

              {/* Detalle o Descripción del Bug */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #F1F2F4', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    📝 Descripción &amp; Pasos de Reproducción
                  </span>
                </div>

                {selectedBugLoading && !descHtml ? (
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
                    Este defecto no cuenta con descripción de texto registrada en Jira.
                  </div>
                )}
              </div>

              {/* Imágenes, Videos & Evidencias Adjuntas */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #F1F2F4', paddingBottom: '6px', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🖼️ Evidencias &amp; Archivos Adjuntos ({attachments.length})
                  </span>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: '5px',
                      backgroundColor: '#E9F2FF',
                      color: '#0C66E4',
                      border: '1px solid #85B8FF',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: bugUploadingStandalone ? 'wait' : 'pointer'
                    }}
                    title="Adjuntar archivos o capturas directamente a este bug"
                  >
                    <span>{bugUploadingStandalone ? '⏳ Subiendo...' : '📎 Adjuntar archivo / captura'}</span>
                    <input
                      type="file"
                      multiple
                      disabled={bugUploadingStandalone}
                      onChange={handleStandaloneBugAttachmentUpload}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>

                {attachments.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Galería de Imágenes */}
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

                    {/* Videos Adjuntos */}
                    {videoAttachments.length > 0 && (
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '6px' }}>
                          Videos &amp; Grabaciones ({videoAttachments.length}):
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
                                cursor: 'pointer',
                                transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 8px rgba(9,30,66,0.12)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                              title="Clic para reproducir video en pantalla completa"
                            >
                              <div style={{ height: '110px', backgroundColor: '#091E42', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', color: '#FFF' }}>
                                <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', marginBottom: '4px' }}>
                                  ▶
                                </div>
                                <span style={{ fontSize: '11px', fontWeight: 600 }}>Reproducir Video</span>
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

                    {/* Otros Documentos / Logs */}
                    {otherAttachments.length > 0 && (
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '6px' }}>
                          Otros Archivos &amp; Logs ({otherAttachments.length}):
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
                              title="Clic para previsualizar o descargar"
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
                    Sin evidencias ni archivos adjuntos registrados. Puedes usar el botón "Adjuntar archivo / captura" arriba o pegar imágenes en un comentario.
                  </div>
                )}
              </div>

              {/* Historial de Comentarios + Composer (Último Primero) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #F1F2F4', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    💬 Comentarios &amp; Actividad ({comments.length})
                  </span>
                  <span style={{ fontSize: '11px', color: '#626F86' }}>
                    Ordenado por el más reciente
                  </span>
                </div>

                {/* Nuevo Comentario + Adjuntar Archivos / Pegar Capturas */}
                <div style={{
                  border: '1px solid #DCDFE4',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  backgroundColor: '#FAFBFC',
                  marginBottom: '12px'
                }}>
                  <textarea
                    rows={3}
                    value={bugCommentText}
                    onChange={(e) => setBugCommentText(e.target.value)}
                    onPaste={handleBugCommentPaste}
                    disabled={bugSubmittingComment}
                    placeholder="Escribe un comentario para este bug... (También puedes pegar una captura de pantalla directamente con Ctrl+V / Cmd+V)"
                    style={{
                      width: '100%',
                      border: '1px solid #DCDFE4',
                      borderRadius: '6px',
                      padding: '8px 10px',
                      fontSize: '12.5px',
                      fontFamily: 'inherit',
                      color: '#172B4D',
                      backgroundColor: '#FFFFFF',
                      resize: 'vertical',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />

                  {/* Archivos / Capturas en cola para el comentario */}
                  {bugCommentFiles.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                      {bugCommentFiles.map((fileObj, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            backgroundColor: '#FFFFFF',
                            border: '1px solid #85B8FF',
                            fontSize: '11px',
                            color: '#172B4D'
                          }}
                        >
                          {fileObj.previewUrl ? (
                            <img src={fileObj.previewUrl} alt={fileObj.filename} style={{ width: '28px', height: '28px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #EBECF0' }} />
                          ) : (
                            <span>📎</span>
                          )}
                          <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                            {fileObj.filename}
                          </span>
                          <button
                            type="button"
                            onClick={() => setBugCommentFiles(prev => prev.filter((_, i) => i !== idx))}
                            style={{ border: 'none', background: 'transparent', color: '#DE350B', cursor: 'pointer', fontWeight: 700, padding: '0 2px', fontSize: '12px' }}
                            title="Quitar archivo adjunto"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', gap: '8px', flexWrap: 'wrap' }}>
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '5px 10px',
                        borderRadius: '5px',
                        backgroundColor: '#FFFFFF',
                        color: '#44546F',
                        border: '1px solid #DCDFE4',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: bugSubmittingComment ? 'not-allowed' : 'pointer'
                      }}
                    >
                      <span>📎 Adjuntar archivo / captura</span>
                      <input
                        type="file"
                        multiple
                        disabled={bugSubmittingComment}
                        onChange={(e) => {
                          handleBugCommentFilesSelect(e.target.files);
                          e.target.value = '';
                        }}
                        style={{ display: 'none' }}
                      />
                    </label>

                    <button
                      type="button"
                      disabled={bugSubmittingComment || (!bugCommentText.trim() && bugCommentFiles.length === 0)}
                      onClick={handleAddBugComment}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '5px',
                        border: 'none',
                        backgroundColor: (bugSubmittingComment || (!bugCommentText.trim() && bugCommentFiles.length === 0)) ? '#DCDFE4' : '#0C66E4',
                        color: (bugSubmittingComment || (!bugCommentText.trim() && bugCommentFiles.length === 0)) ? '#626F86' : '#FFFFFF',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: (bugSubmittingComment || (!bugCommentText.trim() && bugCommentFiles.length === 0)) ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {bugSubmittingComment ? '⏳ Publicando...' : '💬 Publicar comentario'}
                    </button>
                  </div>
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
                          {/* Comment Header */}
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

                          {/* Comment Body */}
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
                    No hay comentarios registrados en este defecto.
                  </div>
                )}
              </div>
            </div>

            {/* Línea divisora interna arrastrable entre Descripción/Evidencia y Columna Derecha de Metadatos */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsMetaResizing(true);
                const startX = e.clientX;
                const startW = metaColWidth;
                const prevUserSelect = document.body.style.userSelect;
                const prevCursor = document.body.style.cursor;
                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'col-resize';

                let latestW = startW;
                const onMove = (ev) => {
                  const delta = startX - ev.clientX;
                  latestW = Math.max(195, Math.min(480, Math.round(startW + delta)));
                  setMetaColWidth(latestW);
                };
                const onUp = () => {
                  setIsMetaResizing(false);
                  document.body.style.userSelect = prevUserSelect;
                  document.body.style.cursor = prevCursor;
                  try {
                    window.localStorage.setItem(BUG_META_WIDTH_KEY, String(latestW));
                  } catch (_) {}
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMetaColWidth(275);
                try {
                  window.localStorage.setItem(BUG_META_WIDTH_KEY, '275');
                } catch (_) {}
              }}
              onMouseEnter={() => setIsMetaHover(true)}
              onMouseLeave={() => setIsMetaHover(false)}
              title="Arrastra para ajustar el ancho de la columna de Detalles (doble clic para restaurar)"
              style={{
                width: '8px',
                flexShrink: 0,
                cursor: 'col-resize',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: (isMetaResizing || isMetaHover) ? 'rgba(12, 102, 228, 0.08)' : '#F1F2F4',
                borderLeft: (isMetaResizing || isMetaHover) ? '1px solid #0C66E4' : '1px solid #DCDFE4',
                borderRight: (isMetaResizing || isMetaHover) ? '1px solid #0C66E4' : 'none',
                transition: 'background-color 0.12s ease',
                zIndex: 10
              }}
            >
              <div
                style={{
                  width: '4px',
                  height: '32px',
                  borderRadius: '999px',
                  backgroundColor: (isMetaResizing || isMetaHover) ? '#0C66E4' : '#B3BAC5',
                  transition: 'background-color 0.12s ease'
                }}
              />
            </div>

            {/* Columna Derecha / Panel Lateral de Metadatos Editables */}
            <div ref={metaColRef} style={{ width: `${metaColWidth}px`, flexShrink: 0, backgroundColor: '#F8FAFD', padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#172B4D', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #DCDFE4', paddingBottom: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Detalles &amp; Edición Rápida</span>
                <span style={{ fontSize: '10px', color: '#0C66E4', fontWeight: 700 }}>En vivo</span>
              </div>

              {/* 0. Estado (Status Workflow Transition) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  ESTADO
                </div>
                <select
                  value=""
                  disabled={bugSavingField === 'status' || transitionsList.length === 0}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    if (!nextVal) return;
                    const chosen = transitionsList.find(t => String(t.id) === String(nextVal));
                    handleUpdateBugField(
                      'status',
                      chosen ? chosen.toStatus : nextVal,
                      { transitionId: nextVal },
                      'Estado'
                    );
                  }}
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    borderRadius: '6px',
                    border: '1px solid #DCDFE4',
                    backgroundColor: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#172B4D',
                    cursor: (bugSavingField === 'status' || transitionsList.length === 0) ? 'not-allowed' : 'pointer'
                  }}
                >
                  <option value="">
                    {bugSavingField === 'status' ? `Actualizando (${rawStatus})...` : rawStatus}
                  </option>
                  {transitionsList.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.toStatus || t.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 1. Persona Asignada (Assignee) */}
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#626F86' }}>
                    PERSONA ASIGNADA
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextOpen = !bugAssigneeOpen;
                      setBugAssigneeOpen(nextOpen);
                      if (nextOpen) {
                        handleSearchBugAssignee('');
                      }
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#0C66E4',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    {bugAssigneeOpen ? 'Cerrar' : 'Cambiar'}
                  </button>
                </div>

                {(() => {
                  const assigneeDisplay = (b.assignee && typeof b.assignee === 'object')
                    ? (b.assignee.displayName || 'Sin asignar')
                    : (typeof b.assignee === 'string' && b.assignee.trim() && b.assignee !== 'Sin asignar' ? b.assignee.trim() : 'Sin asignar');
                  const assigneeAvatar = (b.assignee && typeof b.assignee === 'object') ? b.assignee.avatarUrl : null;
                  const assigneeEmail = (b.assignee && typeof b.assignee === 'object') ? b.assignee.email : null;
                  const hasAssignee = assigneeDisplay !== 'Sin asignar';

                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FFFFFF', padding: '6px 10px', borderRadius: '6px', border: '1px solid #EBECF0' }}>
                      {assigneeAvatar ? (
                        <img src={assigneeAvatar} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
                      ) : (
                        <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: hasAssignee ? '#0C66E4' : '#626F86', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>
                          {(hasAssignee ? assigneeDisplay : '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {bugSavingField === 'assignee' ? 'Guardando...' : assigneeDisplay}
                        </span>
                        {assigneeEmail && (
                          <span style={{ fontSize: '10px', color: '#626F86', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {assigneeEmail}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {bugAssigneeOpen && (
                  <div style={{
                    marginTop: '6px',
                    background: '#FFFFFF',
                    border: '1px solid #85B8FF',
                    borderRadius: '6px',
                    padding: '8px',
                    boxShadow: '0 8px 16px rgba(9, 30, 66, 0.15)'
                  }}>
                    <input
                      type="text"
                      value={bugAssigneeQuery}
                      onChange={(e) => handleSearchBugAssignee(e.target.value)}
                      placeholder="Buscar usuario en Jira..."
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        fontSize: '12px',
                        borderRadius: '4px',
                        border: '1px solid #DCDFE4',
                        marginBottom: '6px',
                        boxSizing: 'border-box'
                      }}
                    />
                    <div style={{ maxHeight: '165px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setBugAssigneeOpen(false);
                          handleUpdateBugField('assignee', null, {}, 'Persona asignada');
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '5px 8px',
                          border: 'none',
                          background: '#F4F5F7',
                          borderRadius: '4px',
                          fontSize: '11.5px',
                          color: '#44546F',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        Dejar sin asignar
                      </button>
                      {bugAssigneeSearching ? (
                        <div style={{ fontSize: '11px', color: '#626F86', padding: '6px', textAlign: 'center' }}>
                          Buscando usuarios...
                        </div>
                      ) : bugAssigneeResults.length > 0 ? (
                        bugAssigneeResults.map(u => (
                          <button
                            key={u.accountId}
                            type="button"
                            onClick={() => {
                              setBugAssigneeOpen(false);
                              handleUpdateBugField('assignee', u.accountId, {}, 'Persona asignada');
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '5px 8px',
                              border: 'none',
                              background: 'transparent',
                              borderRadius: '4px',
                              fontSize: '11.5px',
                              color: '#172B4D',
                              cursor: 'pointer',
                              textAlign: 'left'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#E9F2FF'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            {u.avatarUrl ? (
                              <img src={u.avatarUrl} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
                            ) : (
                              <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#0C66E4', color: '#FFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, flexShrink: 0 }}>
                                {(u.displayName || 'U').charAt(0).toUpperCase()}
                              </span>
                            )}
                            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                                {u.displayName}
                              </span>
                              {u.email && (
                                <span style={{ fontSize: '10px', color: '#626F86', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {u.email}
                                </span>
                              )}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div style={{ fontSize: '11px', color: '#626F86', padding: '6px', textAlign: 'center' }}>
                          No se encontraron usuarios.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Informador (Reporter) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  INFORMADOR
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FFFFFF', padding: '6px 10px', borderRadius: '6px', border: '1px solid #EBECF0' }}>
                  {b.reporter?.avatarUrl ? (
                    <img src={b.reporter.avatarUrl} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#6554C0', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>
                      {(b.reporter?.displayName || 'R').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.reporter?.displayName || 'Sin especificar'}
                  </span>
                </div>
              </div>

              {/* 3. Severidad (*Severity custom field, NOT priority) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  SEVERIDAD
                </div>
                <select
                  value={sevNormalized === 'Sin definir' ? '' : sevNormalized}
                  disabled={bugSavingField === 'severity'}
                  onChange={(e) => {
                    const newSev = e.target.value;
                    if (!newSev) return;
                    const optObj = severityOptionsList.find(o => o.value === newSev);
                    handleUpdateBugField(
                      'severity',
                      newSev,
                      {
                        customFieldId: b.severityFieldId || 'customfield_10238',
                        optionId: optObj?.id || null
                      },
                      'Severidad'
                    );
                  }}
                  style={{
                    width: '100%',
                    background: sevBg,
                    color: sevColor,
                    border: `1px solid ${sevBorder}`,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    cursor: bugSavingField === 'severity' ? 'wait' : 'pointer'
                  }}
                >
                  {sevNormalized === 'Sin definir' && (
                    <option value="">-- Sin definir --</option>
                  )}
                  {!severityOptionsList.some(o => o.value === sevNormalized) && sevNormalized !== 'Sin definir' && (
                    <option value={sevNormalized}>{sevNormalized}</option>
                  )}
                  {severityOptionsList.map(opt => (
                    <option key={opt.id || opt.value} value={opt.value}>
                      {opt.value}
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. Versiones Afectadas (fixVersions) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  VERSIONES AFECTADAS
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px' }}>
                  {fixVersionsList.length > 0 ? (
                    fixVersionsList.map((ver, idx) => (
                      <span
                        key={idx}
                        className="ads-lozenge ads-lozenge-subtle"
                        style={{ fontSize: '11px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 7px' }}
                      >
                        <span>{ver}</span>
                        <button
                          type="button"
                          disabled={bugSavingField === 'fixVersions'}
                          onClick={() => {
                            const updated = fixVersionsList.filter(v => v !== ver);
                            handleUpdateBugField('fixVersions', updated, {}, 'Versiones afectadas');
                          }}
                          style={{ border: 'none', background: 'transparent', color: '#DE350B', cursor: 'pointer', fontWeight: 700, padding: 0, fontSize: '11px', lineHeight: 1 }}
                          title={`Quitar versión ${ver}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>
                      Sin versión asignada
                    </span>
                  )}

                  {!bugAddingVersion && (
                    <button
                      type="button"
                      disabled={bugSavingField === 'fixVersions'}
                      onClick={() => setBugAddingVersion(true)}
                      style={{
                        padding: '3px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        borderRadius: '5px',
                        border: '1px solid #0C66E4',
                        backgroundColor: '#E9F2FF',
                        color: '#0C66E4',
                        cursor: bugSavingField === 'fixVersions' ? 'not-allowed' : 'pointer'
                      }}
                    >
                      + Añadir
                    </button>
                  )}
                </div>

                {bugAddingVersion && (
                  <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '5px', background: '#FFFFFF', border: '1px solid #85B8FF', borderRadius: '6px', padding: '7px' }}>
                    {availableVersionsList.length > 0 && (
                      <select
                        value=""
                        disabled={bugSavingField === 'fixVersions'}
                        onChange={(e) => {
                          const chosenVer = e.target.value;
                          if (!chosenVer) return;
                          setBugAddingVersion(false);
                          if (!fixVersionsList.includes(chosenVer)) {
                            handleUpdateBugField('fixVersions', [...fixVersionsList, chosenVer], {}, 'Versiones afectadas');
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '5px 8px',
                          borderRadius: '5px',
                          border: '1px solid #DCDFE4',
                          backgroundColor: '#FFFFFF',
                          fontSize: '11.5px',
                          color: '#172B4D'
                        }}
                      >
                        <option value="">Seleccionar versión del proyecto...</option>
                        {availableVersionsList
                          .filter(v => !fixVersionsList.includes(v.name))
                          .map(v => (
                            <option key={v.id || v.name} value={v.name}>
                              {v.name} {v.released ? '(Liberada)' : ''}
                            </option>
                          ))}
                      </select>
                    )}

                    <div style={{ display: 'flex', gap: '4px' }}>
                      <input
                        type="text"
                        value={bugCustomVersionInput}
                        onChange={(e) => setBugCustomVersionInput(e.target.value)}
                        placeholder="Escribir versión..."
                        style={{
                          flex: 1,
                          padding: '4px 8px',
                          fontSize: '11.5px',
                          borderRadius: '5px',
                          border: '1px solid #DCDFE4',
                          backgroundColor: '#FFFFFF'
                        }}
                      />
                      <button
                        type="button"
                        disabled={bugSavingField === 'fixVersions' || !bugCustomVersionInput.trim()}
                        onClick={() => {
                          const val = bugCustomVersionInput.trim();
                          if (!val) return;
                          setBugCustomVersionInput('');
                          setBugAddingVersion(false);
                          if (!fixVersionsList.includes(val)) {
                            handleUpdateBugField('fixVersions', [...fixVersionsList, val], {}, 'Versiones afectadas');
                          }
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '5px',
                          border: '1px solid #0C66E4',
                          backgroundColor: '#0C66E4',
                          color: '#FFFFFF',
                          cursor: (!bugCustomVersionInput.trim() || bugSavingField === 'fixVersions') ? 'not-allowed' : 'pointer'
                        }}
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBugAddingVersion(false);
                          setBugCustomVersionInput('');
                        }}
                        style={{
                          padding: '4px 7px',
                          fontSize: '11px',
                          borderRadius: '5px',
                          border: '1px solid #DCDFE4',
                          backgroundColor: '#FFFFFF',
                          color: '#44546F',
                          cursor: 'pointer'
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 5. Tiempo Abierto / Transcurrido */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  TIEMPO TRANSCURRIDO
                </div>
                <div
                  style={{
                    background: badgeColor,
                    color: textColor,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    border: `1px solid ${textColor}30`
                  }}
                >
                  <span>{age.label}</span>
                </div>
              </div>

              {/* 6. Fecha Estimada de Solución (Custom Field customfield_10763, NOT duedate) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  FECHA ESTIMADA DE SOLUCIÓN
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: formattedEstDate && isEstDateFlagged ? '6px' : 0 }}>
                  <input
                    type="date"
                    value={estDateInputVal}
                    disabled={bugSavingField === 'estimatedDate'}
                    onChange={(e) => {
                      const nextDate = e.target.value || null;
                      handleUpdateBugField(
                        'estimatedDate',
                        nextDate,
                        {
                          customFieldId: b.estDateFieldId || 'customfield_10763',
                          candidateFieldIds: Array.isArray(b.estDateCandidateIds) ? b.estDateCandidateIds : []
                        },
                        'Fecha Estimada de Solución'
                      );
                    }}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      borderRadius: '6px',
                      border: '1px solid #DCDFE4',
                      backgroundColor: '#FFFFFF',
                      fontSize: '12px',
                      color: '#172B4D',
                      fontWeight: 600
                    }}
                  />
                  {estDateInputVal && (
                    <button
                      type="button"
                      disabled={bugSavingField === 'estimatedDate'}
                      onClick={() => handleUpdateBugField(
                        'estimatedDate',
                        null,
                        {
                          customFieldId: b.estDateFieldId || 'customfield_10763',
                          candidateFieldIds: Array.isArray(b.estDateCandidateIds) ? b.estDateCandidateIds : []
                        },
                        'Fecha Estimada de Solución'
                      )}
                      style={{
                        border: '1px solid #FFBDAD',
                        background: '#FFEBE6',
                        color: '#DE350B',
                        borderRadius: '5px',
                        padding: '5px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                      title="Limpiar Fecha Estimada"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {formattedEstDate && isEstDateFlagged && (
                  <div
                    style={{
                      background: '#FFEBE6',
                      border: '1px solid #FF8F73',
                      color: '#BF2600',
                      padding: '5px 8px',
                      borderRadius: '6px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <div>
                      <div>{formattedEstDate}</div>
                      <div style={{ fontSize: '9px', textTransform: 'uppercase', opacity: 0.9 }}>
                        {rawStatus.toUpperCase()} • EN ATENCIÓN
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 7. Ambiente / Entorno (Environment) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#626F86' }}>
                    AMBIENTE / ENTORNO
                  </span>
                  {!bugEditingEnv && (
                    <button
                      type="button"
                      onClick={() => {
                        const initialEnv = b.environmentPlainText !== undefined
                          ? b.environmentPlainText
                          : (typeof b.environment === 'string' ? b.environment.replace(/<[^>]+>/g, '').trim() : '');
                        setBugEnvDraft(initialEnv);
                        setBugEditingEnv(true);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#0C66E4',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0
                      }}
                    >
                      Editar
                    </button>
                  )}
                </div>

                {bugEditingEnv ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <textarea
                      rows={2}
                      value={bugEnvDraft}
                      onChange={(e) => setBugEnvDraft(e.target.value)}
                      placeholder="Ej. QA / Staging / iOS 17.4 / Chrome 124..."
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        fontSize: '12px',
                        borderRadius: '5px',
                        border: '1px solid #85B8FF',
                        fontFamily: 'inherit',
                        boxSizing: 'border-box'
                      }}
                    />
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => setBugEditingEnv(false)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          border: '1px solid #DCDFE4',
                          background: '#FFFFFF',
                          color: '#44546F',
                          cursor: 'pointer'
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={bugSavingField === 'environment'}
                        onClick={async () => {
                          await handleUpdateBugField('environment', bugEnvDraft, {}, 'Ambiente / Entorno');
                          setBugEditingEnv(false);
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          borderRadius: '4px',
                          border: 'none',
                          background: '#0C66E4',
                          color: '#FFFFFF',
                          cursor: 'pointer'
                        }}
                      >
                        Guardar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {b.environment ? (
                      <span
                        style={{
                          background: '#E9F2FF',
                          color: '#0C66E4',
                          border: '1px solid #85B8FF',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700
                        }}
                        dangerouslySetInnerHTML={{ __html: typeof b.environment === 'string' ? sanitizeHtml(b.environment) : adfToHtml(b.environment) }}
                      />
                    ) : (
                      <span style={{ fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>
                        No especificado
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* 8. Resolución (Resolution) - Bloqueado salvo cuando el estado es estrictamente Resuelta */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', gap: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#626F86' }}>
                    RESOLUCIÓN
                  </span>
                  {isStrictlyResueltaState ? (
                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        color: '#006644',
                        backgroundColor: '#E3FCEF',
                        border: '1px solid #ABF5D1',
                        padding: '1px 6px',
                        borderRadius: '4px'
                      }}
                      title="El bug está en estado Resuelta: puedes seleccionar o cambiar la resolución"
                    >
                      🔓 Activo
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 600,
                        color: '#626F86',
                        backgroundColor: '#EBECF0',
                        padding: '1px 6px',
                        borderRadius: '4px'
                      }}
                      title="Bloqueado: solo se activa cuando el bug se coloca en estado Resuelta"
                    >
                      🔒 Solo en Resuelta
                    </span>
                  )}
                </div>
                <select
                  value={(isResolvedState && b.resolution && b.resolution !== 'Sin resolver' && b.resolution !== 'Unresolved') ? b.resolution : ''}
                  disabled={!isStrictlyResueltaState || bugSavingField === 'resolution'}
                  title={
                    isStrictlyResueltaState
                      ? 'Seleccionar motivo de resolución'
                      : 'Este campo está bloqueado y solo se activa cuando el estado del bug es Resuelta'
                  }
                  onChange={(e) => {
                    if (!isStrictlyResueltaState) return;
                    const nextRes = e.target.value || null;
                    const chosenRes = resolutionOptionsList.find(r => r.name === nextRes);
                    handleUpdateBugField(
                      'resolution',
                      nextRes,
                      {
                        resolutionId: chosenRes?.id || null,
                        currentStatus: rawStatus
                      },
                      'Resolución'
                    );
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: isStrictlyResueltaState ? '1px solid #85B8FF' : '1px solid #DCDFE4',
                    backgroundColor: isStrictlyResueltaState ? '#FFFFFF' : '#F4F5F7',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: isStrictlyResueltaState ? '#172B4D' : '#8993A4',
                    opacity: isStrictlyResueltaState ? 1 : 0.85,
                    cursor: !isStrictlyResueltaState ? 'not-allowed' : (bugSavingField === 'resolution' ? 'wait' : 'pointer')
                  }}
                >
                  <option value="">{isStrictlyResueltaState ? 'Seleccionar resolución...' : 'Sin resolución (bloqueado)'}</option>
                  {isResolvedState && b.resolution && b.resolution !== 'Sin resolver' && b.resolution !== 'Unresolved' && !resolutionOptionsList.some(r => r.name === b.resolution) && (
                    <option value={b.resolution}>{b.resolution}</option>
                  )}
                  {resolutionOptionsList.map(r => (
                    <option key={r.id || r.name} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 9. Fecha de Creación & Resolución */}
              <div style={{ borderTop: '1px solid #EBECF0', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#626F86' }}>
                <div><strong>Registrado:</strong> {dateStr} {timeStr}</div>
                {isResolvedState && resDate && <div><strong>Resuelto:</strong> {formatBugCreatedDate(resDate).dateStr}</div>}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid #DCDFE4', backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', color: '#626F86' }}>
              Test Pulse QA Engine • Incidencia {bugKey}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button 
                className="btn-secondary"
                onClick={() => setSelectedBug(null)}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.8rem' }}
              >
                Cerrar
              </button>
              <button 
                className="btn-primary"
                onClick={() => router.open('/browse/' + bugKey)}
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

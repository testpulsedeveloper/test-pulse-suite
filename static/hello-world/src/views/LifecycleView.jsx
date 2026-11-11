/**
 * @file LifecycleView.jsx
 * @description "Ciclo de vida" tab (v4.17.0). Shows, for each initiative of the project, the five
 * phases of the QA framework and the deliverables produced in each one:
 *
 *   01 Planear   → Plan de QA (link)
 *   02 Diseñar   → Reportes de hallazgos Shift-Left. They are written in Confluence; Test Pulse
 *                  reads the page and shows its totals (findings, open, by impact, maturity).
 *   03 Construir → Stories and test cases of the linked epics (calculated from Jira).
 *   04 Ejecutar  → Executions and bugs of those cases (calculated from Jira).
 *   05 Liberar   → Dictamen Go / No-Go (link)
 *
 * Performance: nothing here runs until the tab is opened. Opening it costs one storage read;
 * Jira is queried only for the initiative that is expanded, and Confluence only when a report is
 * older than 15 minutes or the user presses "Actualizar".
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { router } from '@forge/bridge';
import TestPulseLoader from '../components/TestPulseLoader';
import { invoke } from '../utils/queryClient';

// The five phases, in order. `auto` phases get their figures from Jira.
const PHASES = [
  { id: 'plan', number: '01', title: 'Planear', subtitle: 'Estrategia', deliverable: 'Plan de QA' },
  { id: 'design', number: '02', title: 'Diseñar', subtitle: 'Shift-Left', deliverable: 'Reportes de hallazgos' },
  { id: 'build', number: '03', title: 'Construir', subtitle: 'Preparación', deliverable: 'Casos vinculados a historias', auto: true },
  { id: 'execute', number: '04', title: 'Ejecutar', subtitle: 'Validación', deliverable: 'Avance de ejecución y bugs', auto: true },
  { id: 'release', number: '05', title: 'Liberar', subtitle: 'Certificación', deliverable: 'Dictamen Go / No-Go' }
];

const STATUS_LABELS = { pending: 'Pendiente', in_progress: 'En curso', delivered: 'Entregado' };
const STATUS_CLASS = { pending: 'ads-lozenge-subtle', in_progress: 'ads-lozenge-brand', delivered: 'ads-lozenge-success' };
const DOC_TYPES = ['BRD', 'ERF', 'ERT', 'Functional Spec', 'Historia de Usuario', 'Otro'];
const IMPACT_ORDER = ['Crítico', 'Alto', 'Medio', 'Bajo', 'N/A', 'Sin clasificar'];
const IMPACT_COLOR = { 'Crítico': '#AE2A19', 'Alto': '#C9372C', 'Medio': '#B65C02', 'Bajo': '#216E4E', 'N/A': '#626F86', 'Sin clasificar': '#626F86' };

// A report read from Confluence is considered fresh for 15 minutes.
const REPORT_FRESH_MS = 15 * 60 * 1000;

const emptyPhases = () => Object.fromEntries(PHASES.map(p => [p.id, { deliverables: [] }]));
const deliverablesOf = (initiative, phaseId) => initiative?.phases?.[phaseId]?.deliverables || [];

/** Status of a phase, derived from its deliverables (or from Jira figures for automatic phases). */
const phaseStatus = (initiative, phase, progress) => {
  if (phase.id === 'build') {
    if (!progress || progress.cases === 0) return 'pending';
    return progress.stories > 0 && progress.storiesWithCases >= progress.stories ? 'delivered' : 'in_progress';
  }
  if (phase.id === 'execute') {
    if (!progress || progress.runs.total === 0) return 'pending';
    const executed = progress.runs.passed + progress.runs.failed + progress.runs.blocked;
    if (executed === 0) return 'pending';
    return progress.runs.passed === progress.runs.total ? 'delivered' : 'in_progress';
  }
  const list = deliverablesOf(initiative, phase.id);
  if (list.length === 0) return 'pending';
  if (list.every(d => d.status === 'delivered')) return 'delivered';
  return list.some(d => d.status !== 'pending') ? 'in_progress' : 'pending';
};

const formatDateTime = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

// ── Small presentational pieces ─────────────────────────────────────────────────────────────

const styles = {
  card: { background: 'var(--jira-surface, #FFFFFF)', border: '1px solid var(--jira-border, #DCDFE4)', borderRadius: '10px' },
  label: { fontSize: '0.72rem', fontWeight: 600, color: 'var(--jira-subtle, #626F86)', display: 'block', marginBottom: '4px' },
  input: { width: '100%', height: '32px', padding: '0 8px', border: '1px solid var(--jira-border, #DCDFE4)', borderRadius: '6px', fontSize: '0.85rem', background: 'var(--jira-surface, #FFFFFF)', color: 'var(--jira-text, #172B4D)', boxSizing: 'border-box' },
  muted: { fontSize: '0.78rem', color: 'var(--jira-subtle, #626F86)' },
  linkBtn: { border: 'none', background: 'none', padding: 0, color: 'var(--jira-blue, #0C66E4)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500 }
};

const Lozenge = ({ status }) => (
  <span className={`ads-lozenge ${STATUS_CLASS[status]}`} style={{ fontSize: '10px' }}>{STATUS_LABELS[status]}</span>
);

const Metric = ({ value, label, color }) => (
  <div style={{ minWidth: '84px' }}>
    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: color || 'var(--jira-text, #172B4D)', lineHeight: 1.1 }}>{value}</div>
    <div style={styles.muted}>{label}</div>
  </div>
);

const Bar = ({ value, color = 'var(--jira-blue, #0C66E4)' }) => (
  <div style={{ height: '6px', borderRadius: '3px', background: 'var(--jira-bg-subtle, #F1F2F4)', overflow: 'hidden' }}>
    <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: color }} />
  </div>
);

/** Opens a link in a new browser tab through the Forge bridge (plain <a> cannot leave the iframe). */
const openLink = (url) => { if (url) router.open(url).catch(() => {}); };

// ── Findings report (phase 02) ──────────────────────────────────────────────────────────────

const FindingsSummary = ({ report }) => {
  if (!report) return <div style={styles.muted}>Aún no se ha leído el reporte de Confluence.</div>;
  if (!report.totals) return <div style={{ ...styles.muted, color: '#AE2A19' }}>{report.error}</div>;
  const { totals, general = {} } = report;
  return (
    <div>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Metric value={totals.total} label="Hallazgos" />
        <Metric value={totals.open} label="Abiertos" color={totals.open > 0 ? '#C9372C' : '#216E4E'} />
        <Metric value={totals.closed} label="Cerrados" color="#216E4E" />
        {report.maturityPct !== null && report.maturityPct !== undefined && (
          <div style={{ minWidth: '150px', flex: '0 1 200px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...styles.muted }}>
              <span>Madurez del documento{report.maturitySource === 'calculated' ? ' (calculada)' : ''}</span>
              <strong style={{ color: 'var(--jira-text, #172B4D)' }}>{report.maturityPct}%</strong>
            </div>
            <Bar value={report.maturityPct} color="#1F845A" />
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {IMPACT_ORDER.filter(impact => totals.byImpact?.[impact]).map(impact => (
            <span key={impact} style={{ fontSize: '0.75rem', fontWeight: 600, color: IMPACT_COLOR[impact], border: `1px solid ${IMPACT_COLOR[impact]}`, borderRadius: '10px', padding: '1px 8px' }}>
              {impact}: {totals.byImpact[impact]}{totals.openByImpact?.[impact] ? ` (${totals.openByImpact[impact]} abiertos)` : ''}
            </span>
          ))}
        </div>
      </div>
      <div style={{ ...styles.muted, marginTop: '8px' }}>
        {[general.overallResult && `Resultado: ${general.overallResult}`, general.version && `Versión: ${general.version}`, general.analyst && `Analista: ${general.analyst}`, general.analysisDate && `Análisis: ${general.analysisDate}`].filter(Boolean).join(' · ')}
      </div>
      {/* Status of the findings as written in the report (section 9), one chip per status. */}
      {totals.byStatus && Object.keys(totals.byStatus).length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' }}>
          <span style={styles.muted}>Estado de atención:</span>
          {Object.entries(totals.byStatus).map(([status, amount]) => (
            <span key={status} style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--jira-text, #172B4D)', background: 'var(--jira-bg-subtle, #F1F2F4)', borderRadius: '10px', padding: '1px 8px' }}>
              {status}: {amount}
            </span>
          ))}
        </div>
      )}
      {report.statusSource === 'attention-table' && (
        <div style={{ ...styles.muted, marginTop: '4px' }}>
          Estados tomados de la sección "Estado de atención de hallazgos". Un hallazgo sin estado ahí cuenta como abierto.
        </div>
      )}
      {!report.hasStatusColumn && totals.total > 0 && (
        <div style={{ ...styles.muted, marginTop: '4px' }}>
          El reporte no tiene la tabla "Estado de atención de hallazgos": los cerrados se toman de la columna "Tipo de hallazgo".
        </div>
      )}
      {report.error && <div style={{ ...styles.muted, color: '#AE2A19', marginTop: '4px' }}>{report.error}</div>}
    </div>
  );
};

// ── Test Plan checklist (phase 01, v4.20.0) ─────────────────────────────────────────────────

// How each result of the 17-element check is shown.
const PLAN_STATUS = {
  complete: { label: 'Cumple', color: '#216E4E', background: '#DCFFF1' },
  partial: { label: 'Parcial', color: '#974F0C', background: '#FFF7D6' },
  missing: { label: 'Falta', color: '#AE2A19', background: '#FFECEB' },
  deferred: { label: 'Más adelante', color: '#44546F', background: '#F1F2F4' }
};
const PLAN_PHASE_NAMES = { plan: 'Planear', design: 'Diseñar', build: 'Construir', execute: 'Ejecutar', release: 'Liberar' };
const PLAN_SOURCE_NAMES = { excel: 'Excel', jira: 'Jira', confluence: 'Confluence', testpulse: 'Test Pulse' };

/**
 * Shows the result of checking the Test Plan workbook against the 17 standard elements: the
 * totals, the compliance percentage, and one row per element with why it got its result.
 * An element that is not complete yet but is only due in a later phase is shown as
 * "Más adelante" and is not counted against the plan.
 */
const TestPlanSummary = ({ report }) => {
  if (!report) return <div style={styles.muted}>Aún no se ha leído el Excel del plan de pruebas.</div>;
  if (!report.totals) return <div style={{ ...styles.muted, color: '#AE2A19' }}>{report.error}</div>;
  const { totals, elements = [] } = report;
  return (
    <div>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Metric value={`${totals.complete} / ${totals.total}`} label="Elementos que cumplen" color="#216E4E" />
        <Metric value={totals.partial} label="Parciales" color={totals.partial > 0 ? '#974F0C' : undefined} />
        <Metric value={totals.missing} label="Faltan" color={totals.missing > 0 ? '#C9372C' : undefined} />
        <Metric value={totals.deferred} label="Para fases posteriores" />
        <div style={{ minWidth: '170px', flex: '0 1 220px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...styles.muted }}>
            <span>Cumplimiento a esta fase</span>
            <strong style={{ color: 'var(--jira-text, #172B4D)' }}>{report.compliancePct}%</strong>
          </div>
          <Bar value={report.compliancePct} color="#1F845A" />
        </div>
      </div>
      <div style={{ marginTop: '10px', borderTop: '1px solid var(--jira-border, #DCDFE4)' }}>
        {elements.map(element => {
          const tone = PLAN_STATUS[element.deferred ? 'deferred' : element.status] || PLAN_STATUS.missing;
          return (
            <div key={element.number} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--jira-border, #DCDFE4)', fontSize: '0.82rem' }}>
              <span style={{ flex: '0 0 22px', color: 'var(--jira-subtle, #626F86)', textAlign: 'right' }}>{element.number}</span>
              <span style={{ flex: '0 0 96px' }}>
                <span style={{ display: 'inline-block', fontSize: '0.72rem', fontWeight: 700, color: tone.color, background: tone.background, borderRadius: '3px', padding: '1px 6px' }}>{tone.label}</span>
              </span>
              <span style={{ flex: '1 1 0', minWidth: 0, color: 'var(--jira-text, #172B4D)' }}>
                <strong>{element.name}</strong>
                <span style={styles.muted}>
                  {' — '}{element.detail}
                  {element.deferred ? ` Se cubre en la fase ${PLAN_PHASE_NAMES[element.duePhase] || element.duePhase}.` : ''}
                </span>
              </span>
              <span style={{ flex: '0 0 auto', ...styles.muted }}>{PLAN_SOURCE_NAMES[element.source] || ''}</span>
            </div>
          );
        })}
      </div>
      {report.error && <div style={{ ...styles.muted, color: '#AE2A19', marginTop: '4px' }}>{report.error}</div>}
    </div>
  );
};

// ── Deliverable form ────────────────────────────────────────────────────────────────────────

const DeliverableForm = ({ phase, initial, onCancel, onSave, saving }) => {
  const isFindings = phase.id === 'design';
  // v4.20.0: in phase 01 a deliverable can be THE Test Plan: an Excel attached to a Jira issue
  // that Test Pulse checks against the 17 standard elements.
  const canBeTestPlan = phase.id === 'plan';
  const [form, setForm] = useState(() => ({
    name: '', docType: isFindings ? 'ERF' : '', url: '', owner: '', date: '', status: 'pending', notes: '',
    issueKey: '', defectsUrl: '', planKey: '',
    ...(initial || {})
  }));
  const [isTestPlan, setIsTestPlan] = useState(canBeTestPlan && initial?.kind === 'testplan');
  const set = (field) => (event) => setForm(prev => ({ ...prev, [field]: event.target.value }));
  const looksLikeUrl = (value) => !value || /^https?:\/\/\S+$/i.test(String(value).trim());
  const urlLooksValid = looksLikeUrl(form.url);
  const defectsUrlLooksValid = looksLikeUrl(form.defectsUrl);
  const issueKeyLooksValid = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(String(form.issueKey || '').trim());
  // Optional: Test Plan of Test Pulse whose dates and cycles cover element 14.
  const planKeyLooksValid = !String(form.planKey || '').trim() || /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(String(form.planKey).trim());
  const canSave = form.name.trim() && urlLooksValid && (!isFindings || form.url.trim()) &&
    (!isTestPlan || (issueKeyLooksValid && defectsUrlLooksValid && planKeyLooksValid));

  return (
    <div style={{ ...styles.card, padding: '12px', background: 'var(--jira-bg-app, #F7F8F9)', marginTop: '8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
        <div>
          <label style={styles.label}>{isFindings ? 'Documento revisado *' : 'Entregable *'}</label>
          <input style={styles.input} value={form.name} onChange={set('name')} maxLength={160} placeholder={isFindings ? 'ERF Tarjetas Internas' : phase.deliverable} />
        </div>
        {isFindings && (
          <div>
            <label style={styles.label}>Tipo de documento</label>
            <select style={styles.input} value={form.docType} onChange={set('docType')}>
              {DOC_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
        )}
        <div style={{ gridColumn: 'span 2' }}>
          <label style={styles.label}>{isFindings ? 'Enlace al reporte de hallazgos en Confluence *' : 'Enlace al documento'}</label>
          <input style={styles.input} value={form.url} onChange={set('url')} maxLength={1000} placeholder="https://liverpooldigital.atlassian.net/wiki/spaces/…/pages/…" />
          {!urlLooksValid && <div style={{ ...styles.muted, color: '#AE2A19' }}>El enlace debe empezar con https://</div>}
        </div>
        {canBeTestPlan && (
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ ...styles.label, display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input type="checkbox" checked={isTestPlan} onChange={(event) => setIsTestPlan(event.target.checked)} />
              Es el Plan de pruebas: evaluar el Excel adjunto en Jira contra los 17 elementos estándar
            </label>
          </div>
        )}
        {isTestPlan && (
          <div>
            <label style={styles.label}>Incidencia de Jira con el Excel adjunto *</label>
            <input style={styles.input} value={form.issueKey} onChange={set('issueKey')} maxLength={30} placeholder="CUQ-123" />
            {form.issueKey && !issueKeyLooksValid && <div style={{ ...styles.muted, color: '#AE2A19' }}>Usa la clave de la incidencia, por ejemplo CUQ-123.</div>}
          </div>
        )}
        {isTestPlan && (
          <div>
            <label style={styles.label}>Plan en Test Pulse (elemento 14: periodo y ciclos)</label>
            <input style={styles.input} value={form.planKey} onChange={set('planKey')} maxLength={30} placeholder="Clave del Test Plan, p. ej. CUQ-10" />
            {!planKeyLooksValid && <div style={{ ...styles.muted, color: '#AE2A19' }}>Usa la clave del Test Plan, por ejemplo CUQ-10.</div>}
          </div>
        )}
        {isTestPlan && (
          <div style={{ gridColumn: 'span 2' }}>
            <label style={styles.label}>Enlace a Gestión de defectos en Confluence (elemento 16)</label>
            <input style={styles.input} value={form.defectsUrl} onChange={set('defectsUrl')} maxLength={1000} placeholder="https://liverpooldigital.atlassian.net/wiki/spaces/…/pages/…" />
            {!defectsUrlLooksValid && <div style={{ ...styles.muted, color: '#AE2A19' }}>El enlace debe empezar con https://</div>}
          </div>
        )}
        <div>
          <label style={styles.label}>Responsable</label>
          <input style={styles.input} value={form.owner} onChange={set('owner')} maxLength={120} />
        </div>
        <div>
          <label style={styles.label}>Fecha de entrega</label>
          <input type="date" style={styles.input} value={form.date} onChange={set('date')} />
        </div>
        <div>
          <label style={styles.label}>Estado</label>
          <select style={styles.input} value={form.status} onChange={set('status')}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={!canSave || saving}
          onClick={() => onSave({
            ...form,
            name: form.name.trim(),
            url: form.url.trim(),
            issueKey: isTestPlan ? String(form.issueKey || '').trim().toUpperCase() : '',
            defectsUrl: isTestPlan ? String(form.defectsUrl || '').trim() : '',
            planKey: isTestPlan ? String(form.planKey || '').trim().toUpperCase() : '',
            kind: isFindings ? 'findings' : (isTestPlan ? 'testplan' : 'link')
          })}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
};

// ── Main view ───────────────────────────────────────────────────────────────────────────────

const LifecycleView = ({ ctx }) => {
  const { selectedProjectId, isAdmin, addNotification } = ctx;

  const [initiatives, setInitiatives] = useState([]);
  const [loading, setLoading] = useState(true);
  // v4.19.0: everybody can see Lifecycle, only editors can change it. The backend sends this flag
  // and checks the permission again on every save, so hiding the buttons is only for clarity.
  const [canEdit, setCanEdit] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [progressById, setProgressById] = useState({});     // initiativeId → figures of phases 3-4
  const [busy, setBusy] = useState('');                      // id of what is being saved/refreshed
  const [editing, setEditing] = useState(null);              // { initiativeId, phaseId, deliverable? }
  const [initiativeForm, setInitiativeForm] = useState(null); // { id?, name, description, epicKeys }
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const refreshedRef = useRef(new Set());                    // initiatives auto-refreshed in this visit

  const notifyError = useCallback((title, error) => {
    addNotification({ type: 'error', title, description: error?.message || String(error || '') });
  }, [addNotification]);

  const replaceInitiative = (initiative) =>
    setInitiatives(prev => prev.map(item => (item.id === initiative.id ? initiative : item)));

  // Load the initiatives of the project when the tab opens or the project changes.
  useEffect(() => {
    if (!selectedProjectId) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    refreshedRef.current = new Set();
    invoke('getLifecycle', { projectId: selectedProjectId })
      .then(res => {
        if (cancelled) return;
        const list = res?.initiatives || [];
        setInitiatives(list);
        setCanEdit(Boolean(res?.canEdit));
        setExpandedId(list.length === 1 ? list[0].id : null);
      })
      .catch(error => { if (!cancelled) setLoadError(error?.message || String(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedProjectId]);

  const refreshFindings = useCallback(async (initiative, deliverableId, silent) => {
    setBusy(deliverableId || `refresh_${initiative.id}`);
    try {
      const res = await invoke('refreshLifecycleFindings', { projectId: selectedProjectId, initiativeId: initiative.id, deliverableId });
      if (res?.initiative) replaceInitiative(res.initiative);
    } catch (error) {
      if (!silent) notifyError('No se pudo actualizar el entregable', error);
    } finally {
      setBusy('');
    }
  }, [selectedProjectId, notifyError]);

  // When an initiative is expanded: load its Jira figures and refresh stale Confluence reports.
  useEffect(() => {
    const initiative = initiatives.find(item => item.id === expandedId);
    if (!initiative) return;

    if ((initiative.epicKeys || []).length > 0 && !progressById[initiative.id]) {
      invoke('getLifecycleProgress', { projectId: selectedProjectId, epicKeys: initiative.epicKeys })
        .then(res => setProgressById(prev => ({ ...prev, [initiative.id]: res })))
        .catch(error => setProgressById(prev => ({ ...prev, [initiative.id]: { error: error?.message || String(error) } })));
    }

    if (!refreshedRef.current.has(initiative.id)) {
      refreshedRef.current.add(initiative.id);
      // Findings reports (Confluence) and the Test Plan workbook (Jira attachment) are re-read
      // when what is stored is older than 15 minutes.
      const isStale = (d) => !d.report?.fetchedAt || Date.now() - new Date(d.report.fetchedAt).getTime() > REPORT_FRESH_MS;
      const stale = deliverablesOf(initiative, 'design').some(d => d.kind === 'findings' && d.url && isStale(d)) ||
        deliverablesOf(initiative, 'plan').some(d => d.kind === 'testplan' && d.issueKey && isStale(d));
      if (stale) refreshFindings(initiative, undefined, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, initiatives.length]);

  const saveInitiative = async (initiative, busyKey) => {
    setBusy(busyKey);
    try {
      const res = await invoke('saveLifecycleInitiative', { projectId: selectedProjectId, initiative });
      const saved = res.initiative;
      setInitiatives(prev => (prev.some(item => item.id === saved.id)
        ? prev.map(item => (item.id === saved.id ? saved : item))
        : [saved, ...prev]));
      return saved;
    } catch (error) {
      notifyError('No se pudo guardar', error);
      return null;
    } finally {
      setBusy('');
    }
  };

  const handleSaveInitiativeForm = async () => {
    const form = initiativeForm;
    const epicKeys = String(form.epicKeys || '').split(/[\s,;]+/).map(k => k.trim().toUpperCase()).filter(Boolean);
    const existing = initiatives.find(item => item.id === form.id);
    const saved = await saveInitiative({
      ...(existing || { phases: emptyPhases() }),
      id: form.id,
      name: form.name.trim(),
      description: form.description.trim(),
      epicKeys
    }, 'initiative');
    if (saved) {
      setInitiativeForm(null);
      setExpandedId(saved.id);
      setProgressById(prev => { const next = { ...prev }; delete next[saved.id]; return next; });
    }
  };

  const handleSaveDeliverable = async (initiative, phaseId, deliverable) => {
    const current = deliverablesOf(initiative, phaseId);
    const nextList = deliverable.id
      ? current.map(item => (item.id === deliverable.id ? { ...item, ...deliverable } : item))
      : [...current, deliverable];
    const saved = await saveInitiative({ ...initiative, phases: { ...initiative.phases, [phaseId]: { deliverables: nextList } } }, 'deliverable');
    if (!saved) return;
    setEditing(null);
    // A new or re-linked findings report is read from Confluence right away.
    if (deliverable.kind === 'findings') {
      const target = deliverablesOf(saved, phaseId).find(item => item.url === deliverable.url && !item.report);
      if (target) refreshFindings(saved, target.id, false);
    }
    // The Test Plan is evaluated again after every save: the Jira issue or the defect-management
    // link (element 16) may have changed.
    if (deliverable.kind === 'testplan') {
      const target = deliverablesOf(saved, phaseId).find(item =>
        item.kind === 'testplan' && (deliverable.id ? item.id === deliverable.id : item.issueKey === deliverable.issueKey && !item.report));
      if (target) refreshFindings(saved, target.id, false);
    }
  };

  const handleRemoveDeliverable = (initiative, phaseId, deliverableId) =>
    saveInitiative({
      ...initiative,
      phases: { ...initiative.phases, [phaseId]: { deliverables: deliverablesOf(initiative, phaseId).filter(item => item.id !== deliverableId) } }
    }, deliverableId);

  const handleDeleteInitiative = async (initiativeId) => {
    setBusy(`delete_${initiativeId}`);
    try {
      await invoke('deleteLifecycleInitiative', { projectId: selectedProjectId, initiativeId });
      setInitiatives(prev => prev.filter(item => item.id !== initiativeId));
      setConfirmDeleteId(null);
    } catch (error) {
      notifyError('No se pudo eliminar la iniciativa', error);
    } finally {
      setBusy('');
    }
  };

  // ── Rendering helpers ──────────────────────────────────────────────────────────────────────

  const renderStepper = (initiative, progress) => (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PHASES.length}, minmax(0, 1fr))`, gap: '6px' }}>
      {PHASES.map(phase => {
        const status = phaseStatus(initiative, phase, progress);
        const color = status === 'delivered' ? '#1F845A' : status === 'in_progress' ? 'var(--jira-blue, #0C66E4)' : 'var(--jira-border, #DCDFE4)';
        return (
          <div key={phase.id} style={{ borderTop: `4px solid ${color}`, paddingTop: '6px', minWidth: 0 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--jira-subtle, #626F86)', fontWeight: 600 }}>{phase.number} · {phase.subtitle}</div>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--jira-text, #172B4D)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{phase.title}</div>
            <Lozenge status={status} />
          </div>
        );
      })}
    </div>
  );

  const renderDeliverable = (initiative, phase, deliverable) => {
    const isEditing = editing && editing.initiativeId === initiative.id && editing.deliverable?.id === deliverable.id;
    if (isEditing) {
      return (
        <DeliverableForm key={deliverable.id} phase={phase} initial={deliverable} saving={busy === 'deliverable'}
          onCancel={() => setEditing(null)} onSave={(form) => handleSaveDeliverable(initiative, phase.id, { ...form, id: deliverable.id })} />
      );
    }
    return (
      <div key={deliverable.id} style={{ ...styles.card, padding: '10px 12px', marginTop: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.88rem', color: 'var(--jira-text, #172B4D)' }}>{deliverable.name}</strong>
          {deliverable.docType && <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px' }}>{deliverable.docType}</span>}
          <Lozenge status={deliverable.status} />
          <span style={styles.muted}>
            {[deliverable.owner, deliverable.date].filter(Boolean).join(' · ')}
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '12px' }}>
            {deliverable.url && <button type="button" style={styles.linkBtn} onClick={() => openLink(deliverable.url)}>{deliverable.kind === 'findings' ? 'Abrir en Confluence ↗' : 'Abrir ↗'}</button>}
            {(deliverable.kind === 'findings' || deliverable.kind === 'testplan') && (
              <button type="button" style={styles.linkBtn} disabled={!!busy} onClick={() => refreshFindings(initiative, deliverable.id, false)}>
                {busy === deliverable.id ? 'Leyendo…' : 'Actualizar'}
              </button>
            )}
            {canEdit && <button type="button" style={styles.linkBtn} onClick={() => setEditing({ initiativeId: initiative.id, phaseId: phase.id, deliverable })}>Editar</button>}
            {canEdit && <button type="button" style={{ ...styles.linkBtn, color: '#AE2A19' }} disabled={!!busy} onClick={() => handleRemoveDeliverable(initiative, phase.id, deliverable.id)}>Quitar</button>}
          </span>
        </div>
        {deliverable.kind === 'testplan' && (
          <div style={{ marginTop: '10px' }}>
            <TestPlanSummary report={deliverable.report} />
            {deliverable.report?.fetchedAt && (
              <div style={{ ...styles.muted, marginTop: '4px' }}>
                {deliverable.report.fileName ? `Excel evaluado: ${deliverable.report.fileName} (adjunto en ${deliverable.report.issueKey}` : `Incidencia: ${deliverable.report.issueKey}`}
                {deliverable.report.fileCreated ? `, subido el ${formatDateTime(deliverable.report.fileCreated)}` : ''}
                {deliverable.report.fileName ? ')' : ''}
                {` · Evaluado: ${formatDateTime(deliverable.report.fetchedAt)}`}
              </div>
            )}
          </div>
        )}
        {deliverable.kind === 'findings' && (
          <div style={{ marginTop: '10px' }}>
            <FindingsSummary report={deliverable.report} />
            {deliverable.report?.fetchedAt && (
              <div style={{ ...styles.muted, marginTop: '4px' }}>
                Leído de Confluence: {formatDateTime(deliverable.report.fetchedAt)}
                {deliverable.report.pageUpdatedAt ? ` · Página editada: ${formatDateTime(deliverable.report.pageUpdatedAt)}` : ''}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderAutoPhase = (initiative, phase, progress) => {
    if ((initiative.epicKeys || []).length === 0) {
      return <div style={styles.muted}>Vincula las épicas de la iniciativa (botón "Editar iniciativa") para ver esta fase.</div>;
    }
    if (!progress) return <div style={styles.muted}>Consultando Jira…</div>;
    if (progress.error) return <div style={{ ...styles.muted, color: '#AE2A19' }}>{progress.error}</div>;
    if (phase.id === 'build') {
      const coverage = pct(progress.storiesWithCases, progress.stories);
      return (
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Metric value={progress.stories} label="Historias" />
          <Metric value={progress.storiesWithCases} label="Con casos" />
          <Metric value={progress.cases} label="Casos de prueba" />
          <div style={{ minWidth: '150px', flex: '0 1 220px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...styles.muted }}>
              <span>Historias con casos</span><strong style={{ color: 'var(--jira-text, #172B4D)' }}>{coverage}%</strong>
            </div>
            <Bar value={coverage} />
          </div>
        </div>
      );
    }
    const { runs, bugs } = progress;
    const executed = runs.passed + runs.failed + runs.blocked;
    return (
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Metric value={runs.total} label="Ejecuciones" />
        <Metric value={runs.passed} label="Passed" color="#216E4E" />
        <Metric value={runs.failed} label="Failed" color="#C9372C" />
        <Metric value={runs.blocked} label="Blocked" color="#B65C02" />
        <Metric value={runs.notRun + runs.other} label="Sin ejecutar" />
        <Metric value={`${bugs.open} / ${bugs.total}`} label="Bugs abiertos / total" color={bugs.open > 0 ? '#C9372C' : undefined} />
        <div style={{ minWidth: '150px', flex: '0 1 220px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...styles.muted }}>
            <span>Avance de ejecución</span><strong style={{ color: 'var(--jira-text, #172B4D)' }}>{pct(executed, runs.total)}%</strong>
          </div>
          <Bar value={pct(executed, runs.total)} />
        </div>
      </div>
    );
  };

  const renderPhase = (initiative, phase, progress) => {
    const isAdding = editing && editing.initiativeId === initiative.id && editing.phaseId === phase.id && !editing.deliverable;
    return (
      <div key={phase.id} style={{ padding: '14px 0', borderTop: '1px solid var(--jira-border, #DCDFE4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <strong style={{ fontSize: '0.9rem', color: 'var(--jira-text, #172B4D)' }}>{phase.number} {phase.title}</strong>
          <span style={styles.muted}>Entregable: {phase.deliverable}</span>
          {canEdit && !phase.auto && !isAdding && (
            <button type="button" style={{ ...styles.linkBtn, marginLeft: 'auto' }}
              onClick={() => setEditing({ initiativeId: initiative.id, phaseId: phase.id })}>
              {phase.id === 'design' ? '+ Agregar documento revisado' : '+ Agregar entregable'}
            </button>
          )}
        </div>
        {phase.auto
          ? renderAutoPhase(initiative, phase, progress)
          : (
            <>
              {deliverablesOf(initiative, phase.id).length === 0 && !isAdding && <div style={styles.muted}>Sin entregables registrados.</div>}
              {deliverablesOf(initiative, phase.id).map(deliverable => renderDeliverable(initiative, phase, deliverable))}
              {isAdding && (
                <DeliverableForm phase={phase} saving={busy === 'deliverable'} onCancel={() => setEditing(null)}
                  onSave={(form) => handleSaveDeliverable(initiative, phase.id, form)} />
              )}
            </>
          )}
      </div>
    );
  };

  const renderInitiativeForm = () => (
    <div style={{ ...styles.card, padding: '14px', marginBottom: '14px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
        <div>
          <label style={styles.label}>Nombre de la iniciativa *</label>
          <input style={styles.input} value={initiativeForm.name} maxLength={120} placeholder="Tarjetas Internas"
            onChange={(e) => setInitiativeForm(prev => ({ ...prev, name: e.target.value }))} />
        </div>
        <div>
          <label style={styles.label}>Épicas vinculadas (claves separadas por coma)</label>
          <input style={styles.input} value={initiativeForm.epicKeys} placeholder="CUQ-120, CUQ-121"
            onChange={(e) => setInitiativeForm(prev => ({ ...prev, epicKeys: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={styles.label}>Descripción</label>
          <input style={styles.input} value={initiativeForm.description} maxLength={600}
            onChange={(e) => setInitiativeForm(prev => ({ ...prev, description: e.target.value }))} />
        </div>
      </div>
      <div style={{ ...styles.muted, marginTop: '6px' }}>Las épicas pueden agregarse después: la fase Shift-Left ocurre antes de que existan.</div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' }}>
        <button type="button" className="btn-secondary" onClick={() => setInitiativeForm(null)} disabled={busy === 'initiative'}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={!initiativeForm.name.trim() || busy === 'initiative'} onClick={handleSaveInitiativeForm}>
          {busy === 'initiative' ? 'Guardando…' : 'Guardar iniciativa'}
        </button>
      </div>
    </div>
  );

  const renderInitiative = (initiative) => {
    const expanded = expandedId === initiative.id;
    const progress = progressById[initiative.id];
    return (
      <div key={initiative.id} style={{ ...styles.card, padding: '14px 16px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setExpandedId(expanded ? null : initiative.id)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            aria-expanded={expanded}>
            <span style={{ color: 'var(--jira-subtle, #626F86)' }}>{expanded ? '▾' : '▸'}</span>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--jira-text, #172B4D)' }}>{initiative.name}</span>
          </button>
          {(initiative.epicKeys || []).map(key => <span key={key} className="ads-lozenge ads-lozenge-purple" style={{ fontSize: '10px' }}>{key}</span>)}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '12px' }}>
            {canEdit && (
              <button type="button" style={styles.linkBtn}
                onClick={() => setInitiativeForm({ id: initiative.id, name: initiative.name, description: initiative.description || '', epicKeys: (initiative.epicKeys || []).join(', ') })}>
                Editar iniciativa
              </button>
            )}
            {isAdmin && confirmDeleteId !== initiative.id && (
              <button type="button" style={{ ...styles.linkBtn, color: '#AE2A19' }} onClick={() => setConfirmDeleteId(initiative.id)}>Eliminar</button>
            )}
            {isAdmin && confirmDeleteId === initiative.id && (
              <span style={{ fontSize: '0.8rem', color: '#AE2A19' }}>
                ¿Eliminar la iniciativa y sus entregables registrados?{' '}
                <button type="button" style={{ ...styles.linkBtn, color: '#AE2A19', fontWeight: 700 }} disabled={!!busy} onClick={() => handleDeleteInitiative(initiative.id)}>Sí, eliminar</button>
                {' · '}
                <button type="button" style={styles.linkBtn} onClick={() => setConfirmDeleteId(null)}>No</button>
              </span>
            )}
          </span>
        </div>
        {initiative.description && <div style={{ ...styles.muted, marginBottom: '10px' }}>{initiative.description}</div>}
        {renderStepper(initiative, progress)}
        {expanded && <div style={{ marginTop: '14px' }}>{PHASES.map(phase => renderPhase(initiative, phase, progress))}</div>}
      </div>
    );
  };

  if (loading) return <TestPulseLoader size={110} text="Cargando ciclo de vida..." />;

  return (
    // The app shell hides overflow, so this view scrolls by itself.
    <div style={{ height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
    <div style={{ padding: '16px 20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--jira-text, #172B4D)' }}>Ciclo de vida de QA</h2>
          <div style={styles.muted}>Fases del marco de trabajo y entregables de cada iniciativa.</div>
        </div>
        {!canEdit && !loadError && (
          <span style={{ ...styles.muted, marginLeft: 'auto' }} title="Un administrador del proyecto define quién edita en Configuración → Editores de Lifecycle.">
            Solo lectura
          </span>
        )}
        {canEdit && !initiativeForm && (
          <button type="button" className="btn-primary" style={{ marginLeft: 'auto' }}
            onClick={() => setInitiativeForm({ name: '', description: '', epicKeys: '' })}>
            + Nueva iniciativa
          </button>
        )}
      </div>

      {loadError && <div style={{ ...styles.card, padding: '12px', color: '#AE2A19', marginBottom: '12px' }}>No se pudo cargar el ciclo de vida: {loadError}</div>}
      {initiativeForm && renderInitiativeForm()}

      {!loadError && initiatives.length === 0 && !initiativeForm && (
        <div style={{ ...styles.card, padding: '28px', textAlign: 'center' }}>
          <div style={{ fontWeight: 700, color: 'var(--jira-text, #172B4D)', marginBottom: '4px' }}>Aún no hay iniciativas en este proyecto</div>
          <div style={styles.muted}>Crea una iniciativa para registrar sus entregables desde la fase de planeación y Shift-Left.</div>
        </div>
      )}

      {initiatives.map(renderInitiative)}
    </div>
    </div>
  );
};

export default LifecycleView;

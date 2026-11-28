/**
 * ExecutionView5.jsx — Ejecución in Test Pulse 5.0 (v4.44.0), rebuilt from the approved boards
 * "Ejecución" and "Ejecución – detalle del caso".
 *
 * Layout: plans and cycles on the left (with progress), cycle header with Sincronizar /
 * Ambiente no disponible / Asignar tester / Ejecutar todo, the environment banner, five cards,
 * status pills with counts, tester and folder filters and the cases table. Opening a case shows
 * the run panel (Lateral / Amplio / Flotante) with result, steps (Pass / Fail / Block and the
 * obtained result), evidence, defects, iterations and comment.
 *
 * The tester flow is unchanged: a case changes status ONLY with "Iniciar ejecución" and a
 * result button. Every action calls the same App.js handlers as the classic Ejecución.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { router } from '@forge/bridge';
import { normalizeUiStatus } from '../utils/constants';
import EnvDowntimeBar from '../components/EnvDowntimeBar';
import PanelDockSwitcher, { usePanelDockPosition, usePanelDockWidth, PanelResizeHandle, getDockOverlayStyle, getDockContainerStyle, DOCK_SPLIT_WIDTH } from '../components/PanelDockSwitcher';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const day = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const short = (v) => { const d = day(v); return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : ''; };
const TONE = { Passed: 'success', Failed: 'danger', Blocked: 'warning', 'In Progress': 'info', 'Not Run': 'neutral' };
const LABEL = { Passed: 'PASSED', Failed: 'FAILED', Blocked: 'BLOCKED', 'In Progress': 'EN PROGRESO', 'Not Run': 'SIN EJECUTAR' };
const STEP_LABEL = { Passed: 'Pass', Failed: 'Fail', Blocked: 'Block' };
const nameOf = (u) => (u && typeof u === 'object' ? (u.displayName || '') : '');
const initials = (full) => { const p = String(full || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[1][0]}.` : (p[0] || '—'); };
const evName = (e) => (typeof e === 'object' && e ? (e.filename || e.name || 'archivo') : String(e || 'archivo'));

/** Run panel of one case (Lateral / Amplio / Flotante). */
function ExecCasePanel5({ ctx, test, details, nav, onClose, downtimeForEnv }) {
  const {
    runningTests, handleRunTest, handleStopExecution, handleUpdateTestStatus, handleSaveRunFields, handleUploadEvidence,
    handleCaptureScreen, handleOpenQrCapture, handleCreateBug, doLinkBug, handleAddIteration, handlePreviewEvidence,
    setSelectedBug, findTc
  } = ctx;
  const [dockPosition, setDockPosition] = usePanelDockPosition();
  const [dockWidth, , isResizing] = usePanelDockWidth();
  const [linking, setLinking] = useState(false);
  const [bugKey, setBugKey] = useState('');
  const [comment, setComment] = useState(test.comment || '');
  const [floatPos, setFloatPos] = useState(() => ({ x: Math.max(16, Math.round((window.innerWidth - Math.min(1100, window.innerWidth * 0.94)) / 2)), y: 40 }));
  const fileRef = useRef(null);
  useEffect(() => { setComment(test.comment || ''); }, [test.id, test.comment]);

  const st = normalizeUiStatus(test.status);
  const running = !!runningTests[test.id] || st === 'In Progress';
  const isFloat = dockPosition === 'center';
  const wide = isFloat || dockWidth > 640;
  const key = test.testCaseKey || test.key;
  const tc = findTc(key) || findTc(test.id) || {};
  const summary = (test.summary || tc.summary || '').replace(/^\[Test Run\]\s*/i, '');
  const isAuto = test.isAutomated || test.testType === 'Automated' || String(test.executionType || '').toLowerCase().includes('auto');
  const steps = details?.type === 'traditional' && Array.isArray(details.content) ? details.content : [];
  const results = Array.isArray(test.stepResults) ? test.stepResults : [];
  const resultOf = (i) => results.find(r => r.i === i) || { i, status: '', actual: '' };
  const doneSteps = steps.filter((_, idx) => resultOf(idx + 1).status).length;
  const setStep = (i, patch) => {
    const next = [...results.filter(r => r.i !== i), { ...resultOf(i), ...patch }].sort((a, b) => a.i - b.i);
    handleSaveRunFields(test, { stepResults: next });
  };
  // Suggested result from the steps: any Fail → Failed, any Block → Blocked, all Pass → Passed.
  const stepSt = steps.map((_, idx) => resultOf(idx + 1).status);
  const suggested = stepSt.includes('Failed') ? 'Failed' : stepSt.includes('Blocked') ? 'Blocked' : (steps.length && stepSt.every(s => s === 'Passed') ? 'Passed' : null);
  const evidences = (test.evidences || []).filter(Boolean);
  const bugs = (test.linkedBugs || []).filter(b => b && b.key);
  const iterations = Array.isArray(test.iterations) ? test.iterations : [];
  const tester = nameOf(test.executedBy) || nameOf(test.assignee);
  const startedAt = test.executedAt ? new Date(test.executedAt) : null;

  const setResult = (status) => { handleUpdateTestStatus(test.id, status, comment); };
  const resultButtons = (
    <div className="tp5-resbtns">
      {['Passed', 'Failed', 'Blocked'].map(s => (
        <button key={s} type="button" className={`tp5-resbtn tp5-resbtn--${TONE[s]}${st === s ? ' is-on' : ''}${suggested === s && running ? ' is-suggested' : ''}`}
          disabled={!running} title={running ? (suggested === s ? 'Sugerido por los pasos' : '') : 'Primero presiona «Iniciar ejecución»'} onClick={() => setResult(s)}>{s}</button>
      ))}
    </div>
  );

  const header = (
    <div className={`tp5-casepanel__top${isFloat ? ' is-draggable' : ''}`}
      onPointerDown={isFloat ? (e) => {
        if (e.target.closest('button, a, input, select, textarea')) return;
        const sx = e.clientX - floatPos.x; const sy = e.clientY - floatPos.y;
        const move = (ev) => setFloatPos({ x: Math.max(0, ev.clientX - sx), y: Math.max(0, ev.clientY - sy) });
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      } : undefined}>
      {isFloat && <span className="tp5-grip" aria-hidden="true">⠿</span>}
      <button type="button" className="tp5-iconbtn" aria-label="Caso anterior" disabled={!nav.prev} onClick={nav.goPrev}>‹</button>
      <button type="button" className="tp5-iconbtn" aria-label="Caso siguiente" disabled={!nav.next} onClick={nav.goNext}>›</button>
      <span className="tp5-subtle tp5-small tp5-ellipsis">{wide ? `Caso ${nav.index} de ${nav.total} · ${nav.cycleName}` : `${nav.index} de ${nav.total}`}</span>
      <span className="tp5-casepanel__tools">
        <PanelDockSwitcher dockPosition={dockPosition} onChange={setDockPosition} />
        <button type="button" className="tp5-iconbtn" aria-label="Cerrar" onClick={onClose}>✕</button>
      </span>
    </div>
  );

  const stepsBlock = steps.length === 0 ? (
    details?.type === 'continuous' || test.description ? <span className="tp5-subtle tp5-small">Este caso describe sus pasos como texto; regístralos con el resultado del caso.</span>
      : <span className="tp5-subtle tp5-small">Este caso no tiene pasos registrados.</span>
  ) : wide ? (
    <div className="tp5-card tp5-table-wrap">
      <table className="tp5-table" style={{ minWidth: 0 }}>
        <thead><tr><th>#</th><th>Acción</th><th>Resultado esperado</th><th>Resultado obtenido</th><th>Paso</th></tr></thead>
        <tbody>
          {steps.map((step, idx) => {
            const r = resultOf(idx + 1);
            return (
              <tr key={idx} className={r.status === 'Failed' ? 'is-failrow' : undefined}>
                <td>{idx + 1}</td>
                <td>{step.action}{step.data ? <><br /><span className="tp5-subtle tp5-small">Datos: {step.data}</span></> : null}</td>
                <td>{step.expectedResult}</td>
                <td><textarea className="tp5-textarea" rows={2} defaultValue={r.actual} disabled={!running} aria-label={`Resultado obtenido del paso ${idx + 1}`}
                  onBlur={(e) => { if (e.target.value !== r.actual) setStep(idx + 1, { actual: e.target.value }); }} /></td>
                <td>
                  <span className="tp5-stepseg" role="group" aria-label={`Resultado del paso ${idx + 1}`}>
                    {['Passed', 'Failed', 'Blocked'].map(s => (
                      <button key={s} type="button" disabled={!running} className={`tp5-stepbtn--${TONE[s]}${r.status === s ? ' is-on' : ''}`}
                        onClick={() => setStep(idx + 1, { status: r.status === s ? '' : s })}>{STEP_LABEL[s]}</button>
                    ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <ol className="tp5-steps">
      {steps.map((step, idx) => {
        const r = resultOf(idx + 1);
        return (
          <li key={idx}>
            <span className="tp5-steps__n">{idx + 1}</span>
            <span className="tp5-steps__txt">{step.action}{step.expectedResult ? <span className="tp5-subtle tp5-small"> Esperado: {step.expectedResult}</span> : null}</span>
            {running ? (
              <span className="tp5-stepseg tp5-stepseg--sm">
                {['Passed', 'Failed', 'Blocked'].map(s => (
                  <button key={s} type="button" className={`tp5-stepbtn--${TONE[s]}${r.status === s ? ' is-on' : ''}`} onClick={() => setStep(idx + 1, { status: r.status === s ? '' : s })}>{STEP_LABEL[s]}</button>
                ))}
              </span>
            ) : <span className={`tp5-loz tp5-loz--${TONE[r.status || 'Not Run']}`}>{r.status ? LABEL[r.status] : 'SIN EJECUTAR'}</span>}
          </li>
        );
      })}
    </ol>
  );

  const evidenceBlock = (
    <section className={wide ? 'tp5-card tp5-sidecard' : 'tp5-casepanel__sec'}>
      <h3 className="tp5-sec-title">Evidencias{evidences.length ? ` · ${evidences.length}` : ''}</h3>
      {evidences.length > 0 && (
        <div className="tp5-evgrid">
          {evidences.map((e, i) => (
            <button key={i} type="button" className="tp5-evthumb" onClick={() => handlePreviewEvidence && handlePreviewEvidence(e, test)} title={evName(e)}>
              <span className="tp5-ellipsis">{/\.(mp4|webm|mov)$/i.test(evName(e)) ? '▶ ' : ''}{evName(e)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="tp5-btnrow">
        <input ref={fileRef} type="file" hidden multiple onChange={(e) => { [...(e.target.files || [])].forEach(f => handleUploadEvidence(test.id, key, f)); e.target.value = ''; }} />
        <button type="button" className="tp5-chip" disabled={!running} onClick={() => fileRef.current?.click()}>Subir archivo</button>
        <button type="button" className="tp5-chip" disabled={!running} onClick={() => handleCaptureScreen(test.id, key)}>Grabar pantalla</button>
        <button type="button" className="tp5-chip" disabled={!running} onClick={() => handleOpenQrCapture(test)}>{wide ? 'Celular (QR)' : 'Desde el celular (QR)'}</button>
      </div>
      {evidences.length === 0 && <span className="tp5-subtle tp5-small">Sin evidencias todavía{running ? '' : ' · se agregan durante la ejecución'}</span>}
    </section>
  );

  const bugsBlock = (
    <section className={wide ? 'tp5-card tp5-sidecard' : 'tp5-casepanel__sec'}>
      <h3 className="tp5-sec-title">Defectos{bugs.length ? ` · ${bugs.length}` : ''}</h3>
      {bugs.map(b => (
        <button key={b.key} type="button" className="tp5-bugrow" onClick={() => setSelectedBug && setSelectedBug(b)}>
          <span className="tp5-mono">{b.key}</span><span className="tp5-ellipsis">{b.summary || ''}</span>
          {b.priority && <span className="tp5-loz tp5-loz--danger">{String(b.priority?.name || b.priority).toUpperCase()}</span>}
        </button>
      ))}
      <div className="tp5-btnrow">
        <button type="button" className="tp5-chip tp5-chip--danger" onClick={() => handleCreateBug(test)}>Reportar bug</button>
        {linking ? (
          <span className="tp5-chipadd">
            <input type="text" value={bugKey} autoFocus placeholder="CLAVE-123" aria-label="Clave del bug" onChange={e => setBugKey(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter' && bugKey.trim()) { doLinkBug(test, bugKey.trim()); setBugKey(''); setLinking(false); } }} />
            <button type="button" className="tp5-chip" disabled={!bugKey.trim()} onClick={() => { doLinkBug(test, bugKey.trim()); setBugKey(''); setLinking(false); }}>Vincular</button>
          </span>
        ) : <button type="button" className="tp5-chip" onClick={() => setLinking(true)}>{wide ? 'Vincular por clave' : 'Vincular bug existente'}</button>}
      </div>
    </section>
  );

  const iterationsBlock = (
    <section className="tp5-casepanel__sec">
      <div className="tp5-section__head" style={{ marginBottom: 0 }}>
        <h3 className="tp5-sec-title">Iteraciones (data-driven){iterations.length ? ` · ${iterations.length}` : ''}</h3>
        {wide && <button type="button" className="tp5-chip" style={{ marginLeft: 'auto' }} disabled={!running} onClick={() => handleAddIteration(test)}>+ Agregar iteración</button>}
      </div>
      {iterations.length === 0 ? (
        <span className="tp5-subtle tp5-small">Sin iteraciones{!wide && <> · <button type="button" className="tp5-link" disabled={!running} onClick={() => handleAddIteration(test)}>Agregar iteración</button></>}</span>
      ) : (
        <div className="tp5-card tp5-table-wrap">
          <table className="tp5-table" style={{ minWidth: 0 }}>
            <thead><tr><th>Datos de entrada</th><th>Esperado</th><th>Obtenido</th><th>Estado</th></tr></thead>
            <tbody>
              {iterations.map((it, i) => {
                const s = normalizeUiStatus(it.status);
                return (
                  <tr key={it.id || i}>
                    <td className="tp5-mono">{it.parameters || it.data || it.name || `Iteración ${i + 1}`}</td>
                    <td>{it.expected || it.expectedResult || '—'}</td>
                    <td>{it.actualResult || it.result || it.comment || '—'}</td>
                    <td><span className={`tp5-loz tp5-loz--${TONE[s]}`}>{LABEL[s]}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const commentBlock = (
    <section className={wide ? 'tp5-card tp5-sidecard' : 'tp5-casepanel__sec'}>
      <h3 className="tp5-sec-title">Comentario</h3>
      <textarea className="tp5-textarea" rows={3} value={comment} disabled={!running} onChange={e => setComment(e.target.value)}
        onBlur={() => { if ((comment || '') !== (test.comment || '')) handleSaveRunFields(test, { comment }); }} placeholder="Observaciones de la ejecución" />
    </section>
  );

  const downtimeWarning = downtimeForEnv && (
    <div className="tp5-warnbar" role="status">
      ⚠ {downtimeForEnv.component ? <>Este ciclo usa <strong>{downtimeForEnv.component}</strong>, que está caído</> : <>El ambiente <strong>{downtimeForEnv.envName}</strong> está caído</>} en {downtimeForEnv.envName}{downtimeForEnv.ticket ? ` (${downtimeForEnv.ticket})` : ''}. Si no puedes avanzar, márcalo como <strong>Blocked</strong>.
    </div>
  );

  const body = wide ? (
    <div className="tp5-casepanel__scroll">
      <div className="tp5-exec-head">
        <div>
          <div className="tp5-exec-meta">
            <span className="tp5-mono tp5-key">{key}</span>
            {test.testRunKey && <span className="tp5-mono">Test Run {test.testRunKey}</span>}
            <span className={`tp5-loz ${isAuto ? 'tp5-loz--brand' : 'tp5-loz--neutral'}`}>{isAuto ? 'AUTOMATIZADO' : 'MANUAL'}</span>
            {tc.rawFields?.priority?.name && <span className="tp5-loz tp5-loz--danger">PRIORIDAD {tc.rawFields.priority.name.toUpperCase()}</span>}
          </div>
          <h2 className="tp5-exec-title">{summary}</h2>
          <span className="tp5-subtle tp5-small">{[ctx.selectedCycle?.schedule?.environment && `Ambiente ${ctx.selectedCycle.schedule.environment}`, tester && `Tester ${tester}`, startedAt && running && `Iniciado ${startedAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="tp5-exec-headright">
          <span className={`tp5-loz tp5-loz--${TONE[st]}`}>{LABEL[st]}</span>
          {running ? resultButtons : <button type="button" className="tp5-btn tp5-btn--primary" onClick={() => handleRunTest(test.id, test.key, test)}>Iniciar ejecución</button>}
        </div>
      </div>
      {downtimeWarning}
      <div className="tp5-exec-grid">
        <div className="tp5-exec-main">
          <div className="tp5-section__head" style={{ marginBottom: 0 }}>
            <h3 className="tp5-h2">Pasos{steps.length ? ` · ${doneSteps} de ${steps.length}` : ''}</h3>
            {steps.length > 0 && <span className="tp5-subtle tp5-small">El resultado del caso se sugiere a partir de los pasos; tú lo confirmas.</span>}
          </div>
          {stepsBlock}
          {iterationsBlock}
        </div>
        <div className="tp5-exec-side">{evidenceBlock}{bugsBlock}{commentBlock}</div>
      </div>
    </div>
  ) : (
    <div className="tp5-casepanel__scroll">
      <span className="tp5-mono tp5-key">{key}</span>
      <h2 className="tp5-casepanel__title" style={{ margin: 0 }}>{summary}</h2>
      {downtimeWarning}
      <div className="tp5-section__head" style={{ marginBottom: 0 }}><span className="tp5-eyebrow">Resultado</span><span className={`tp5-loz tp5-loz--${TONE[st]}`} style={{ marginLeft: 'auto' }}>{LABEL[st]}</span></div>
      {!running ? (
        <div className="tp5-infobox">
          <p>Estás viendo el caso. Abrirlo no cambia su estado: cambia solo al presionar <strong>Iniciar ejecución</strong> y elegir un resultado.</p>
          <button type="button" className="tp5-btn tp5-btn--primary tp5-btn--block" onClick={() => handleRunTest(test.id, test.key, test)}>Iniciar ejecución</button>
        </div>
      ) : (
        <div className="tp5-infobox"><p>Ejecución en curso. Marca los pasos y elige el resultado del caso.</p>
          <button type="button" className="tp5-btn tp5-btn--ghost tp5-btn--block" onClick={() => handleStopExecution(test.id, test)}>Detener sin resultado</button></div>
      )}
      {resultButtons}
      <section className="tp5-casepanel__sec"><span className="tp5-eyebrow">Pasos</span>{stepsBlock}</section>
      {evidenceBlock}
      {bugsBlock}
      {iterationsBlock}
      {commentBlock}
    </div>
  );

  const footer = wide && (
    <div className="tp5-casepanel__foot">
      <span className="tp5-subtle tp5-small">Los cambios se guardan solos. El estado del caso solo cambia con los botones de resultado.</span>
      <button type="button" className="tp5-btn tp5-btn--secondary" disabled={!nav.prev} onClick={nav.goPrev}>Anterior</button>
      <button type="button" className="tp5-btn tp5-btn--primary" disabled={!nav.next} onClick={nav.goNext}>Siguiente caso</button>
    </div>
  );

  return (
    <div style={getDockOverlayStyle(dockPosition, 1200)} onClick={() => { if (isFloat) onClose(); }}>
      <div className={`tp5-casepanel${isFloat ? ' is-float' : ''}`}
        style={isFloat
          ? { position: 'fixed', left: floatPos.x, top: floatPos.y, width: 'min(1100px, 94vw)', height: 'min(820px, 90vh)', background: '#FFFFFF', color: '#172B4D' }
          : { ...getDockContainerStyle(dockPosition, { drawerWidth: DOCK_SPLIT_WIDTH, dockWidthPx: dockWidth, isResizing, drawerMinWidth: '380px', backgroundColor: '#FFFFFF' }), color: '#172B4D' }}
        onClick={e => e.stopPropagation()}>
        {!isFloat && <PanelResizeHandle dockPosition={dockPosition} />}
        {header}
        {body}
        {footer}
      </div>
    </div>
  );
}

export default function ExecutionView5({ ctx, d }) {
  const {
    selectedCycle, selectedPlanId, setSelectedPlanId, testPlans, handleCycleSelect, handleCreateIssue, executionStatusFilter,
    setExecutionStatusFilter, execTesterFilter, setExecTesterFilter, setExecTesterFilterSource, execFolderFilter, setExecFolderFilter,
    folderPaths, expandedExecutionTest, setExpandedExecutionTest, handleToggleExecutionTest, openAssignModal, availableEnvironments,
    addNotification, selectedProjectId, clearPersistentCache, queryClient, setRefreshTrigger, runningTests, findTc, setActiveTab,
    executionTestDetails, executionCurrentPage, setExecutionCurrentPage, myAccountId
  } = ctx;
  const { counts, deduplicatedCycleTests, filteredTests, paginatedTests, totalPages, safeCurrentPage, testerOptions, sidebarCycles,
    cycleSched, cycleRemainingDays, manualTotalCount, autoTotalCount, handleReprocessAutomation, reprocessingAutomation } = d;

  const [syncOpen, setSyncOpen] = useState(false);
  const [downtimeFormOpen, setDowntimeFormOpen] = useState(false);
  const [openDowntime, setOpenDowntime] = useState([]); // open events, reported by EnvDowntimeBar

  const envName = cycleSched?.environment || selectedCycle?.environment || '';
  const envDown = openDowntime.filter(e => e.envName === envName);

  const pills = [
    { id: 'ALL', label: 'Todos', n: counts.total },
    { id: 'Passed', label: 'Passed', n: counts.passed },
    { id: 'Failed', label: 'Failed', n: counts.failed },
    { id: 'Blocked', label: 'Blocked', n: counts.blocked },
    { id: 'In Progress', label: 'En progreso', n: counts.inProgress },
    { id: 'Not Run', label: 'Sin ejecutar', n: counts.notRun }
  ];

  const pctOf = (c) => {
    const m = c.executionMeta || {};
    const total = Number(m.total ?? c.testCount ?? 0) || 0;
    const done = (Number(m.passed) || 0) + (Number(m.failed) || 0) + (Number(m.blocked) || 0);
    return total ? Math.round((done / total) * 100) : 0;
  };

  // Panel navigation over the filtered list (same as the classic panel).
  const modalTest = expandedExecutionTest
    ? (deduplicatedCycleTests.find(t => String(t.id) === String(expandedExecutionTest)))
    : null;
  const navList = filteredTests.length ? filteredTests : deduplicatedCycleTests;
  const navIdx = modalTest ? navList.findIndex(t => String(t.id) === String(modalTest.id)) : -1;
  const nav = {
    index: navIdx + 1, total: navList.length, cycleName: selectedCycle?.summary || '',
    prev: navIdx > 0 ? navList[navIdx - 1] : null,
    next: navIdx >= 0 && navIdx < navList.length - 1 ? navList[navIdx + 1] : null
  };
  nav.goPrev = () => nav.prev && handleToggleExecutionTest(nav.prev.id, true);
  nav.goNext = () => nav.next && handleToggleExecutionTest(nav.next.id, true);

  const syncInfo = () => { clearPersistentCache(); queryClient.invalidateQueries(); handleCycleSelect(selectedCycle); addNotification({ type: 'info', title: 'Sincronizando información', description: 'Actualizando el ciclo desde Jira…' }); };
  const syncStatus = () => { clearPersistentCache(); queryClient.invalidateQueries(); setRefreshTrigger(p => p + 1); handleCycleSelect(selectedCycle); addNotification({ type: 'success', title: 'Estatus sincronizado', description: 'Estados de ejecución actualizados con Jira.' }); };

  return (
    <div className="tp5-plan">
      <aside className="tp5-plan__aside" aria-label="Planes y ciclos">
        <div className="tp5-folders__head">
          <span className="tp5-eyebrow">Planes y ciclos</span>
          <button type="button" className="tp5-iconbtn" aria-label="Nuevo ciclo" title="Nuevo ciclo" onClick={() => handleCreateIssue('cycle')}>+</button>
        </div>
        <select className="tp5-select" aria-label="Plan" value={selectedPlanId || ''} onChange={e => setSelectedPlanId(e.target.value)}>
          <option value="">Todos los ciclos</option>
          {testPlans.map(p => <option key={p.id} value={p.id}>{p.summary}</option>)}
        </select>
        <div className="tp5-cyclelist">
          {sidebarCycles.map(c => {
            const on = selectedCycle && String(selectedCycle.id) === String(c.id);
            const p = pctOf(c);
            return (
              <button key={c.id} type="button" className={`tp5-cyclecard${on ? ' is-on' : ''}`} onClick={() => handleCycleSelect(c)}>
                <span className="tp5-strong">{c.summary || c.key}</span>
                <span className="tp5-cyclecard__meta"><span className="tp5-mono">{c.key}</span><span className="tp5-strong" style={{ color: 'var(--tp5-text)' }}>{p}%</span></span>
                <span className="tp5-bar" style={{ height: 5 }}><span style={{ width: `${p}%`, background: 'var(--tp5-success)' }} /></span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="tp5-plan__main" aria-label="Ciclo en ejecución">
        {!selectedCycle ? (
          <div className="tp5-card tp5-empty" style={{ padding: 24 }}><strong>Elige un ciclo</strong><span>Selecciona un ciclo a la izquierda para ejecutar sus casos.</span></div>
        ) : (
          <>
            <header className="tp5-plan__head">
              <div>
                <span className="tp5-eyebrow">Ciclo · <span className="tp5-mono">{selectedCycle.key}</span></span>
                <h1 className="tp5-pagehead__title">{selectedCycle.summary}</h1>
              </div>
              <div className="tp5-pagehead__actions">
                <span className="tp5-menu">
                  <button type="button" className="tp5-btn tp5-btn--secondary" aria-haspopup="menu" aria-expanded={syncOpen} onClick={() => setSyncOpen(o => !o)}>
                    Sincronizar <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
                  </button>
                  {syncOpen && (
                    <div className="tp5-menu__panel" role="menu" onMouseLeave={() => setSyncOpen(false)}>
                      <button type="button" role="menuitem" className="tp5-menu__item" onClick={() => { setSyncOpen(false); syncInfo(); }}>Sincronizar información</button>
                      <button type="button" role="menuitem" className="tp5-menu__item" onClick={() => { setSyncOpen(false); syncStatus(); }}>Sincronizar estatus</button>
                      <button type="button" role="menuitem" className="tp5-menu__item" disabled={reprocessingAutomation} onClick={() => { setSyncOpen(false); handleReprocessAutomation(); }}>{reprocessingAutomation ? 'Reprocesando…' : 'Reprocesar automatización'}</button>
                    </div>
                  )}
                </span>
                <button type="button" className="tp5-btn tp5-btn--warn" onClick={() => setDowntimeFormOpen(true)}>⚠ Ambiente no disponible</button>
                <button type="button" className="tp5-btn tp5-btn--secondary" onClick={() => openAssignModal(filteredTests.map(t => ({ testRunId: t.testRunId || t.testRunKey, id: t.id })))}>Asignar tester</button>
                <button type="button" className="tp5-btn tp5-btn--primary" disabled={!navList.length} onClick={() => navList[0] && handleToggleExecutionTest(navList[0].id, true)}>Ejecutar todo</button>
              </div>
            </header>

            <EnvDowntimeBar
              projectId={selectedProjectId}
              environments={availableEnvironments}
              cycle={{ ...selectedCycle, environment: envName }}
              addNotification={addNotification}
              variant="v5"
              formOpen={downtimeFormOpen}
              onFormOpenChange={setDowntimeFormOpen}
              onOpenEventsChange={setOpenDowntime}
            />

            <div className="tp5-statcards">
              <div className="tp5-card"><span>Ventana</span><strong>{cycleSched?.startDate ? `${short(cycleSched.startDate)} – ${short(cycleSched.endDate)}` : 'Sin fechas'}</strong></div>
              <div className="tp5-card"><span>Ambiente</span><strong>{envName || '—'}{envDown.length ? ` · ${envDown.length} caído` : ''}</strong></div>
              <div className="tp5-card"><span>Días hábiles restantes</span><strong>{cycleRemainingDays}</strong></div>
              <div className="tp5-card"><span>Ejecutados</span><strong>{counts.executed} de {counts.total}</strong></div>
              <div className="tp5-card"><span>Composición</span><strong>{manualTotalCount} man. · {autoTotalCount} auto</strong></div>
            </div>

            <div className="tp5-pills" role="group" aria-label="Filtrar por estado">
              {pills.map(p => (
                <button key={p.id} type="button" className={executionStatusFilter === p.id ? 'is-on' : undefined} aria-pressed={executionStatusFilter === p.id}
                  onClick={() => { setExecutionStatusFilter(p.id); setExecutionCurrentPage(1); }}>{p.label} · {p.n}</button>
              ))}
            </div>
            <div className="tp5-toolbar" style={{ justifyContent: 'flex-end' }}>
              <select className="tp5-select" aria-label="Tester" value={execTesterFilter} onChange={e => { setExecTesterFilter(e.target.value); setExecTesterFilterSource('user'); setExecutionCurrentPage(1); }}>
                <option value="ALL">Todos los testers</option>
                {myAccountId && <option value="MINE">Mis asignaciones</option>}
                <option value="UNASSIGNED">Sin asignar</option>
                {testerOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select className="tp5-select" aria-label="Carpeta" value={execFolderFilter} onChange={e => { setExecFolderFilter(e.target.value); setExecutionCurrentPage(1); }}>
                <option value="">Todas las carpetas</option>
                <option value="__ROOT__">Sin carpeta</option>
                {folderPaths.map(f => <option key={f.id} value={f.id}>{f.path}</option>)}
              </select>
            </div>

            <div className="tp5-card tp5-table-wrap">
              <table className="tp5-table">
                <thead><tr><th>Caso de prueba</th><th>Tester</th><th>Estado</th><th>Bugs</th><th style={{ textAlign: 'right' }}>Acción</th></tr></thead>
                <tbody>
                  {paginatedTests.map(t => {
                    const st = runningTests[t.id] ? 'In Progress' : normalizeUiStatus(t.status);
                    const tc = findTc(t.testCaseKey || t.key) || findTc(t.id) || {};
                    const isOpen = String(expandedExecutionTest) === String(t.id);
                    return (
                      <tr key={t.id} className={isOpen ? 'is-selected' : undefined}>
                        <td><span className="tp5-mono tp5-key">{t.testCaseKey || t.key}</span><br />{(t.summary || tc.summary || '').replace(/^\[Test Run\]\s*/i, '')}</td>
                        <td className="tp5-subtle-2 tp5-nowrap">{initials(nameOf(t.assignee) || nameOf(t.executedBy))}</td>
                        <td><span className={`tp5-loz tp5-loz--${TONE[st]}`}>{LABEL[st]}</span></td>
                        <td>{(t.linkedBugs || []).filter(b => b?.key).map(b => <span key={b.key} className="tp5-mono tp5-bugkey">{b.key}</span>)}</td>
                        <td style={{ textAlign: 'right' }}><button type="button" className="tp5-btn tp5-btn--outline tp5-btn--sm" onClick={() => handleToggleExecutionTest(t.id, true)}>Ejecutar</button></td>
                      </tr>
                    );
                  })}
                  {paginatedTests.length === 0 && (
                    <tr><td colSpan={5} className="tp5-subtle">{counts.total ? 'Ningún caso coincide con los filtros.' : <>Este ciclo no tiene casos. <button type="button" className="tp5-link" onClick={() => setActiveTab('planning')}>Agrégalos en Planeación</button>.</>}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="tp5-pager">
                <span>Página {safeCurrentPage} de {totalPages} · {filteredTests.length} casos</span>
                <span className="tp5-pager__btns">
                  <button type="button" className="tp5-chip" disabled={safeCurrentPage <= 1} onClick={() => setExecutionCurrentPage(safeCurrentPage - 1)}>Anterior</button>
                  <button type="button" className="tp5-chip" disabled={safeCurrentPage >= totalPages} onClick={() => setExecutionCurrentPage(safeCurrentPage + 1)}>Siguiente</button>
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {modalTest && (
        <ExecCasePanel5
          ctx={{ ...ctx, router }}
          test={runningTests[modalTest.id] ? { ...modalTest, status: 'In Progress' } : modalTest}
          details={executionTestDetails[modalTest.id]}
          nav={nav}
          onClose={() => setExpandedExecutionTest(null)}
          downtimeForEnv={envDown[0] || null}
        />
      )}
    </div>
  );
}

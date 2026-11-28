/**
 * PlanningView5.jsx — Planeación in Test Pulse 5.0 (v4.43.0), rebuilt from the approved boards
 * "Planeación" and "Planeación – calendario y metas".
 *
 * Layout:
 *   - left: "PLAN DE PRUEBAS" (rename), active plan, its cycles (key, cases, dates), "Nuevo ciclo",
 *     "Nuevo plan" and "Agregar un ciclo existente al plan";
 *   - main: cycle header (rename, Abrir en Jira, Más acciones, Ir a ejecutar), the schedule strip
 *     with the cycle traffic light, "Salud del ciclo" (8 indicators, Personalizar), "En el ciclo"
 *     table and the "Agregar casos" panel;
 *   - "Calendario y metas": right-hand drawer with tabs 1 · Plan and 2 · Ciclo and a live preview.
 *
 * It only changes the presentation. Every action calls the same handlers and resolvers the
 * classic Planeación uses (passed in `ctx` from App.js and in `d` from PlanningView.jsx).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { router } from '@forge/bridge';
import { invoke } from '../utils/queryClient';
import { normalizeUiStatus } from '../utils/constants';
import { computeCycleHealth, schedulePreview, parseDay, shortDay, DEFAULT_SEMAFORO } from '../utils/cycleHealthIndicators';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const range = (a, b, withYear) => {
  const s = parseDay(a); const e = parseDay(b);
  if (!s || !e) return 'Sin fechas';
  return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]}${withYear ? ` ${e.getFullYear()}` : ''}`;
};
const STATUS_TONE = { Passed: 'success', Failed: 'danger', Blocked: 'warning', 'In Progress': 'info', 'Not Run': 'neutral' };
const STATUS_LABEL = { Passed: 'PASSED', Failed: 'FAILED', Blocked: 'BLOCKED', 'In Progress': 'EN CURSO', 'Not Run': 'SIN EJECUTAR' };
const LIGHT_TONE = { ok: 'success', risk: 'warning', late: 'danger', none: 'neutral' };
const holidayLabel = (h) => {
  const d = parseDay(typeof h === 'string' ? h : h?.date);
  const desc = typeof h === 'object' && h?.description ? ` · ${h.description}` : '';
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}${desc}` : '';
};

/** Chips of holidays with "+ Agregar día" (date + description). */
function HolidayChips({ holidays, onChange, inheritedNote }) {
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState('');
  const [desc, setDesc] = useState('');
  const list = Array.isArray(holidays) ? holidays : [];
  return (
    <div className="tp5-chips">
      {list.map(h => {
        const key = typeof h === 'string' ? h : h?.date;
        return (
          <span key={key} className="tp5-chipitem">
            {holidayLabel(h)}{inheritedNote ? ' (del plan)' : ''}
            {onChange && <button type="button" aria-label={`Quitar ${holidayLabel(h)}`} onClick={() => onChange(list.filter(x => (typeof x === 'string' ? x : x?.date) !== key))}>✕</button>}
          </span>
        );
      })}
      {onChange && (adding ? (
        <span className="tp5-chipadd">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Fecha del día festivo" />
          <input type="text" value={desc} maxLength={60} onChange={e => setDesc(e.target.value)} placeholder="Descripción" aria-label="Descripción del día festivo" />
          <button type="button" className="tp5-chip" disabled={!date} onClick={() => {
            const next = [...list.filter(x => (typeof x === 'string' ? x : x?.date) !== date), { date, description: desc.trim() || 'Día festivo' }]
              .sort((a, b) => String(a.date || a).localeCompare(String(b.date || b)));
            onChange(next); setAdding(false); setDate(''); setDesc('');
          }}>Agregar</button>
          <button type="button" className="tp5-chip tp5-chip--ghost" onClick={() => setAdding(false)}>Cancelar</button>
        </span>
      ) : (
        <button type="button" className="tp5-chipitem tp5-chipitem--add" onClick={() => setAdding(true)}>+ Agregar día</button>
      ))}
    </div>
  );
}

/** Green/amber/red preview box of the calendar drawer. */
function Preview({ pv, scope }) {
  if (!pv) return <div className="tp5-preview tp5-preview--neutral"><span className="tp5-eyebrow">Vista previa del {scope}</span><p>Define las fechas de inicio y fin para ver la vista previa.</p></div>;
  const tone = LIGHT_TONE[pv.light.key];
  return (
    <div className={`tp5-preview tp5-preview--${tone}`}>
      <div className="tp5-preview__head">
        <span className="tp5-eyebrow">Vista previa del {scope} con esta configuración</span>
        <span className={`tp5-loz tp5-loz--${tone}`}>{pv.light.label}</span>
      </div>
      <div className="tp5-preview__items">
        {pv.items.map(i => <div key={i.label}><strong>{i.value}</strong><span>{i.label}</span></div>)}
      </div>
      <div className="tp5-preview__bar" role="img" aria-label={`Hoy deberías llevar ${pv.expectedPct} por ciento, llevas ${pv.donePct} por ciento`}>
        <span style={{ width: `${pv.donePct}%` }} />
        <i style={{ left: `${pv.expectedPct}%` }} />
      </div>
      <p>{pv.text}</p>
    </div>
  );
}

export default function PlanningView5({ ctx, d }) {
  const {
    addNotification, availableEnvironments, calcScheduleDays, cycleScheduleForm, folderPaths, findTc,
    getExecVal, handleCreateIssue, openRenameDialog, handleCycleSelect, handleLinkCycleToPlan, handleUnlinkCycleFromPlan,
    handleDeleteCycle, handleRemoveManyFromCycle, handleRemoveTestFromCycle, handleSaveCycleSchedule, handleSavePlanSchedule,
    isAddingAll, addingProgress, isAdmin, planScheduleForm, planningFolder, planningPriority, planningExecutionType,
    projectConfig, selectedCycle, selectedPlanId, selectedProjectId, selectedTestsForCycle, setActiveTab,
    setCycleScheduleForm, setPlanScheduleForm, setPlanningExecutionType, setPlanningFolder, setPlanningPriority,
    setSelectedPlanId, setSelectedTestsForCycle, setProjectConfig, showConfirm, testCycles, testPlans
  } = ctx;
  const { deduplicatedCycleTests, availableFilteredTestCases, validSelectedTests, addCasesToSelectedCycle, currentPlan,
    cyclesInCurrentPlan, availableUnlinkedCycles, handleExportCyclePlanCsv, syncWithRelease } = d;

  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [cal, setCal] = useState(null); // null | 'plan' | 'cycle'
  const [calSnapshot, setCalSnapshot] = useState(null);
  const [availSearch, setAvailSearch] = useState('');
  const [downtime, setDowntime] = useState([]);
  const [savingPref, setSavingPref] = useState(false);

  // Environment downtime of the project, once per cycle (for the availability indicator).
  useEffect(() => {
    if (!selectedProjectId || !selectedCycle?.id) return undefined;
    let cancelled = false;
    invoke('getEnvDowntime', { projectId: selectedProjectId })
      .then(res => { if (!cancelled) setDowntime(Array.isArray(res?.events) ? res.events : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedProjectId, selectedCycle?.id]);

  const schedule = useMemo(() => ({ ...(selectedCycle?.schedule || {}), ...cycleScheduleForm }), [selectedCycle?.schedule, cycleScheduleForm]);
  const health = useMemo(
    () => computeCycleHealth({ tests: deduplicatedCycleTests, schedule, planSchedule: planScheduleForm, downtime, environments: availableEnvironments }),
    [deduplicatedCycleTests, schedule, planScheduleForm, downtime, availableEnvironments]
  );
  const hidden = projectConfig?.uiPrefs?.planningHealthHidden || [];
  const visibleTiles = health.indicators.filter(i => !hidden.includes(i.id));
  const light = health.figures.semaforo;

  const toggleTile = async (id) => {
    if (!isAdmin) return;
    const next = hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id];
    setSavingPref(true);
    try {
      const res = await invoke('setProjectUiPref', { projectId: selectedProjectId, key: 'planningHealthHidden', value: next });
      setProjectConfig(prev => ({ ...(prev || {}), uiPrefs: res?.uiPrefs || { ...(prev?.uiPrefs || {}), planningHealthHidden: next } }));
    } catch (err) {
      addNotification({ type: 'error', title: 'No se pudo guardar', description: err?.message || 'Intenta de nuevo.' });
    } finally {
      setSavingPref(false);
    }
  };

  const cycleDays = calcScheduleDays(cycleScheduleForm.startDate, cycleScheduleForm.endDate, cycleScheduleForm.excludeWeekends, cycleScheduleForm.holidays);
  const cycleHolidays = Array.isArray(cycleScheduleForm.holidays) ? cycleScheduleForm.holidays : [];

  // Plan totals for the plan preview: cases and results of every cycle in the plan.
  const planTotals = useMemo(() => (cyclesInCurrentPlan || []).reduce((a, c) => {
    const m = c.executionMeta || {};
    a.total += Number(m.total ?? c.testCount ?? 0) || 0;
    a.executed += (Number(m.passed) || 0) + (Number(m.failed) || 0) + (Number(m.blocked) || 0);
    a.failed += Number(m.failed) || 0;
    return a;
  }, { total: 0, executed: 0, failed: 0 }), [cyclesInCurrentPlan]);

  const planPv = schedulePreview({ ...planScheduleForm, ...planTotals, scope: 'plan', freezeDate: planScheduleForm.codeFreezeDate, goLiveDate: planScheduleForm.goLiveDate });
  const cyclePv = schedulePreview({ ...cycleScheduleForm, total: health.figures.total, executed: health.figures.executed, failed: health.figures.failed, semaforo: cycleScheduleForm.semaforo, scope: 'ciclo' });

  const openCal = (tab) => { setCalSnapshot({ plan: planScheduleForm, cycle: cycleScheduleForm }); setCal(tab); };
  const cancelCal = () => {
    if (calSnapshot) { setPlanScheduleForm(calSnapshot.plan); setCycleScheduleForm(calSnapshot.cycle); }
    setCal(null);
  };
  const saveCal = async () => {
    if (cal === 'plan') await handleSavePlanSchedule();
    else await handleSaveCycleSchedule();
    setCal(null);
  };

  const available = useMemo(() => {
    const q = availSearch.trim().toLowerCase();
    return q ? availableFilteredTestCases.filter(tc => (tc.key || '').toLowerCase().includes(q) || (tc.summary || '').toLowerCase().includes(q)) : availableFilteredTestCases;
  }, [availableFilteredTestCases, availSearch]);
  const selSet = new Set((selectedTestsForCycle || []).map(String));
  const folderName = (id) => (folderPaths.find(f => f.id === id)?.name || 'Sin carpeta');
  const priorities = useMemo(() => [...new Set((ctx.testCases || []).map(tc => tc.rawFields?.priority?.name).filter(Boolean))], [ctx.testCases]);

  // ── Left column ──
  const renderAside = () => (
    <aside className="tp5-plan__aside" aria-label="Planes y ciclos">
      <div className="tp5-folders__head">
        <span className="tp5-eyebrow">Plan de pruebas</span>
        <button type="button" className="tp5-iconbtn" aria-label="Renombrar plan" disabled={!currentPlan} onClick={() => openRenameDialog('plan', currentPlan)}>✎</button>
      </div>
      <label className="tp5-field-label">Plan activo
        <select className="tp5-select" value={selectedPlanId || ''} onChange={e => setSelectedPlanId(e.target.value)}>
          <option value="">Todos los ciclos</option>
          {testPlans.map(p => <option key={p.id} value={p.id}>{p.summary} · {p.key}</option>)}
        </select>
      </label>
      <span className="tp5-eyebrow">Ciclos · {cyclesInCurrentPlan.length}</span>
      <div className="tp5-cyclelist">
        {cyclesInCurrentPlan.map(c => {
          const on = selectedCycle && String(selectedCycle.id) === String(c.id);
          return (
            <button key={c.id} type="button" className={`tp5-cyclecard${on ? ' is-on' : ''}`} onClick={() => handleCycleSelect(c)}>
              <span className="tp5-strong">{c.summary || c.key}</span>
              <span className="tp5-cyclecard__meta"><span className="tp5-mono">{c.key}</span><span>{c.testCount || 0} casos</span><span>{range(c.schedule?.startDate, c.schedule?.endDate)}</span></span>
            </button>
          );
        })}
        {cyclesInCurrentPlan.length === 0 && <span className="tp5-subtle tp5-small">Este plan aún no tiene ciclos.</span>}
      </div>
      <button type="button" className="tp5-btn tp5-btn--primary tp5-btn--block" onClick={() => handleCreateIssue('cycle')}>Nuevo ciclo</button>
      <button type="button" className="tp5-btn tp5-btn--secondary tp5-btn--block" onClick={() => handleCreateIssue('plan')}>Nuevo plan</button>
      {selectedPlanId && (linkOpen ? (
        <select className="tp5-select" autoFocus aria-label="Ciclo existente a agregar" value="" onChange={e => { if (e.target.value) { handleLinkCycleToPlan(e.target.value, selectedPlanId); setLinkOpen(false); } }} onBlur={() => setLinkOpen(false)}>
          <option value="">{availableUnlinkedCycles.length ? 'Elige un ciclo sin plan…' : 'No hay ciclos sin plan'}</option>
          {availableUnlinkedCycles.map(c => <option key={c.id} value={c.id}>{c.summary} · {c.key}</option>)}
        </select>
      ) : (
        <button type="button" className="tp5-link tp5-center" onClick={() => setLinkOpen(true)}>Agregar un ciclo existente al plan</button>
      ))}
    </aside>
  );

  if (!selectedCycle) {
    return (
      <div className="tp5-plan">
        {renderAside()}
        <section className="tp5-plan__main">
          <div className="tp5-card tp5-empty" style={{ padding: 24 }}>
            <strong>Elige un ciclo</strong>
            <span>Selecciona un ciclo a la izquierda para ver su calendario, su salud y sus casos, o crea uno nuevo.</span>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="tp5-plan">
      {renderAside()}
      <section className="tp5-plan__main" aria-label="Ciclo">
        <header className="tp5-plan__head">
          <div>
            <span className="tp5-eyebrow">Ciclo · <span className="tp5-mono">{selectedCycle.key}</span></span>
            <h1 className="tp5-pagehead__title">{selectedCycle.summary || selectedCycle.name} <button type="button" className="tp5-inline-edit" aria-label="Renombrar ciclo" onClick={() => openRenameDialog('cycle', selectedCycle)}>✎</button></h1>
          </div>
          <div className="tp5-pagehead__actions">
            <button type="button" className="tp5-btn tp5-btn--secondary" onClick={() => router.open(`/browse/${selectedCycle.key}`).catch(() => {})}>Abrir en Jira</button>
            <span className="tp5-menu">
              <button type="button" className="tp5-btn tp5-btn--secondary" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
                Más acciones <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
              </button>
              {menuOpen && (
                <div className="tp5-menu__panel" role="menu" onMouseLeave={() => setMenuOpen(false)}>
                  <button type="button" role="menuitem" className="tp5-menu__item" onClick={() => { setMenuOpen(false); syncWithRelease(); }}>Sincronizar con release</button>
                  <button type="button" role="menuitem" className="tp5-menu__item" onClick={() => { setMenuOpen(false); handleExportCyclePlanCsv(); }}>Exportar plan</button>
                  {selectedPlanId && <button type="button" role="menuitem" className="tp5-menu__item" onClick={() => { setMenuOpen(false); handleUnlinkCycleFromPlan(selectedCycle.id); }}>Quitar ciclo del plan</button>}
                  <button type="button" role="menuitem" className="tp5-menu__item is-danger" onClick={() => { setMenuOpen(false); handleDeleteCycle(selectedCycle.id); }}>Eliminar ciclo</button>
                </div>
              )}
            </span>
            <button type="button" className="tp5-btn tp5-btn--primary" onClick={() => setActiveTab('execution')}>Ir a ejecutar</button>
          </div>
        </header>

        <section className="tp5-card tp5-strip" aria-label="Calendario y ambiente">
          <div><span>Fechas</span><strong>{range(cycleScheduleForm.startDate, cycleScheduleForm.endDate, true)}</strong></div>
          <div><span>Días hábiles</span><strong>{cycleDays.businessDays} · {cycleScheduleForm.excludeWeekends !== false ? 'sin fines de semana' : 'con fines de semana'}</strong></div>
          <div><span>Ambiente</span><strong>{cycleScheduleForm.environment || '—'}</strong></div>
          <div><span>Días festivos</span><strong>{cycleHolidays.length}{cycleHolidays.length ? ` · ${cycleHolidays.map(h => holidayLabel(h).split(' · ')[0]).join(', ')}` : ''}</strong></div>
          <div><span>Salud del ciclo</span><span className={`tp5-loz tp5-loz--${LIGHT_TONE[light.key]}`}>{light.label}</span></div>
          <button type="button" className="tp5-btn tp5-btn--secondary tp5-strip__btn" onClick={() => openCal('plan')}>Calendario y metas</button>
        </section>

        <section className="tp5-healthsec" aria-label="Salud del ciclo">
          <div className="tp5-section__head">
            <h2 className="tp5-h2">Salud del ciclo</h2>
            <span className="tp5-subtle tp5-small">{visibleTiles.length} de {health.indicators.length} indicadores visibles</span>
            <span className="tp5-menu" style={{ marginLeft: 'auto' }}>
              <button type="button" className="tp5-chip" aria-expanded={cfgOpen} onClick={() => setCfgOpen(o => !o)}>Personalizar</button>
              {cfgOpen && (
                <div className="tp5-menu__panel tp5-cfg" role="group" aria-label="Indicadores visibles" onMouseLeave={() => setCfgOpen(false)}>
                  <span className="tp5-subtle tp5-small">{isAdmin ? 'Se guarda para todo el proyecto (solo administradores)' : 'Solo los administradores del proyecto pueden cambiarlo'}</span>
                  {health.indicators.map(t => (
                    <label key={t.id} className="tp5-radio"><input type="checkbox" checked={!hidden.includes(t.id)} disabled={!isAdmin || savingPref} onChange={() => toggleTile(t.id)} /> {t.label}</label>
                  ))}
                </div>
              )}
            </span>
          </div>
          <div className="tp5-tiles">
            {visibleTiles.map(t => (
              <div key={t.id} className={`tp5-card tp5-tile5 tp5-tile5--${t.tone}`}>
                <span className="tp5-kpi__label">{t.label}</span>
                <span className="tp5-tile5__value">{t.value}</span>
                <span className="tp5-kpi__detail">{t.detail}</span>
              </div>
            ))}
          </div>
        </section>

        <div className={`tp5-plan__cases${addOpen ? ' is-split' : ''}`}>
          <section className="tp5-card tp5-cases" aria-label="Casos en el ciclo">
            <div className="tp5-cases__head">
              <h2 className="tp5-h2">En el ciclo · {deduplicatedCycleTests.length}</h2>
              {deduplicatedCycleTests.length > 0 && (
                <button type="button" className="tp5-chip tp5-chip--danger" onClick={() => {
                  const allIds = deduplicatedCycleTests.map(t => t.id);
                  showConfirm('Quitar todos los casos', `¿Quitar los ${allIds.length} casos del ciclo?`, () => handleRemoveManyFromCycle(allIds), { danger: true, confirmLabel: 'Quitar todos' });
                }}>Quitar todos</button>
              )}
              <button type="button" className="tp5-btn tp5-btn--primary" aria-expanded={addOpen} onClick={() => setAddOpen(o => !o)}>+ Agregar casos</button>
            </div>
            <div className="tp5-table-wrap">
              <table className="tp5-table" style={{ minWidth: 0 }}>
                <thead><tr><th>Caso</th><th>Carpeta</th><th>Estado</th><th><span className="tp5-sr-only">Quitar</span></th></tr></thead>
                <tbody>
                  {deduplicatedCycleTests.map(t => {
                    const tc = findTc(t.testCaseId || t.id) || {};
                    const st = normalizeUiStatus(t.status);
                    return (
                      <tr key={t.id}>
                        <td><span className="tp5-mono tp5-key">{t.testCaseKey || t.key || tc.key}</span><br />{t.summary || tc.summary}</td>
                        <td className="tp5-subtle-2">{folderName(t.folderId ?? tc.folderId)}</td>
                        <td><span className={`tp5-loz tp5-loz--${STATUS_TONE[st]}`}>{STATUS_LABEL[st]}</span></td>
                        <td style={{ textAlign: 'right' }}><button type="button" className="tp5-xbtn" aria-label={`Quitar ${t.testCaseKey || t.key} del ciclo`} onClick={() => handleRemoveTestFromCycle(t.id)}>✕</button></td>
                      </tr>
                    );
                  })}
                  {deduplicatedCycleTests.length === 0 && <tr><td colSpan={4} className="tp5-subtle">El ciclo aún no tiene casos. Usa «Agregar casos».</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {addOpen && (
            <section className="tp5-card tp5-cases" aria-label="Agregar casos">
              <div className="tp5-cases__head">
                <h2 className="tp5-h2">Agregar casos</h2>
                <span className="tp5-subtle tp5-small">Disponibles · {available.length.toLocaleString('es-MX')}</span>
                <button type="button" className="tp5-iconbtn" style={{ marginLeft: 'auto' }} aria-label="Cerrar panel" onClick={() => setAddOpen(false)}>✕</button>
              </div>
              <div className="tp5-toolbar" style={{ padding: '0 16px 12px' }}>
                <select className="tp5-select" aria-label="Carpeta" value={planningFolder} onChange={e => setPlanningFolder(e.target.value)}>
                  <option value="">Todas las carpetas</option>
                  {folderPaths.map(f => <option key={f.id} value={f.id}>{f.path}</option>)}
                </select>
                <select className="tp5-select" aria-label="Prioridad" value={planningPriority} onChange={e => setPlanningPriority(e.target.value)}>
                  <option value="">Todas las prioridades</option>
                  {priorities.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select className="tp5-select" aria-label="Tipo de ejecución" value={planningExecutionType} onChange={e => setPlanningExecutionType(e.target.value)}>
                  <option value="">Manual y automatizado</option>
                  <option value="Manual">Manual</option>
                  <option value="Automatizado">Automatizado</option>
                </select>
                <input type="search" className="tp5-select" aria-label="Buscar casos disponibles" placeholder="Buscar" value={availSearch} onChange={e => setAvailSearch(e.target.value)} />
              </div>
              <div className="tp5-table-wrap tp5-cases__scroll">
                <table className="tp5-table" style={{ minWidth: 0 }}>
                  <thead><tr>
                    <th style={{ width: 36 }}><input type="checkbox" aria-label="Seleccionar todos los disponibles" checked={available.length > 0 && available.every(tc => selSet.has(String(tc.id)))}
                      onChange={e => setSelectedTestsForCycle(e.target.checked ? available.map(tc => tc.id) : [])} /></th>
                    <th>Caso</th><th>Prioridad</th>
                  </tr></thead>
                  <tbody>
                    {available.slice(0, 300).map(tc => (
                      <tr key={tc.id}>
                        <td><input type="checkbox" aria-label={`Seleccionar ${tc.key}`} checked={selSet.has(String(tc.id))}
                          onChange={e => setSelectedTestsForCycle(prev => (e.target.checked ? [...(prev || []), tc.id] : (prev || []).filter(id => String(id) !== String(tc.id))))} /></td>
                        <td><span className="tp5-mono tp5-key">{tc.key}</span> <span className={`tp5-loz ${getExecVal(tc).includes('auto') ? 'tp5-loz--brand' : 'tp5-loz--neutral'}`}>{getExecVal(tc).includes('auto') ? 'AUTO' : 'MANUAL'}</span><br />{tc.summary}</td>
                        <td className="tp5-subtle-2">{tc.rawFields?.priority?.name || '—'}</td>
                      </tr>
                    ))}
                    {available.length > 300 && <tr><td colSpan={3} className="tp5-subtle">Se muestran 300 de {available.length}. Usa los filtros para acotar.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="tp5-cases__foot">
                <span className="tp5-small">{isAddingAll ? `Agregando ${addingProgress.current} de ${addingProgress.total}…` : `${validSelectedTests.length} seleccionado${validSelectedTests.length === 1 ? '' : 's'}`}</span>
                <button type="button" className="tp5-chip" disabled={isAddingAll || available.length === 0} onClick={() => addCasesToSelectedCycle(available)}>Añadir todos los filtrados</button>
                <button type="button" className="tp5-btn tp5-btn--primary" disabled={isAddingAll || validSelectedTests.length === 0} onClick={() => addCasesToSelectedCycle(validSelectedTests)}>Añadir seleccionados</button>
              </div>
            </section>
          )}
        </div>
      </section>

      {cal && (
        <div className="tp5-drawer-backdrop" onClick={cancelCal}>
          <aside className="tp5-drawer" role="dialog" aria-modal="true" aria-label="Calendario y metas" onClick={e => e.stopPropagation()}>
            <div className="tp5-drawer__head">
              <div>
                <span className="tp5-eyebrow">Calendario y metas</span>
                <h2 className="tp5-drawer__title">{cal === 'plan' ? (currentPlan?.summary || 'Sin plan') : (selectedCycle.summary)} <span className="tp5-mono tp5-subtle">{cal === 'plan' ? currentPlan?.key : selectedCycle.key}</span></h2>
              </div>
              <button type="button" className="tp5-iconbtn" aria-label="Cerrar" onClick={cancelCal}>✕</button>
            </div>
            <div className="tp5-drawer__tabs">
              <div role="tablist" className="tp5-tabs" style={{ borderBottom: 0 }}>
                <button type="button" role="tab" aria-selected={cal === 'plan'} className={cal === 'plan' ? 'is-on' : undefined} onClick={() => setCal('plan')} disabled={!currentPlan}>1 · Plan</button>
                <button type="button" role="tab" aria-selected={cal === 'cycle'} className={cal === 'cycle' ? 'is-on' : undefined} onClick={() => setCal('cycle')}>2 · Ciclo</button>
              </div>
              <span className="tp5-subtle tp5-small">El ciclo hereda fechas y festivos del plan</span>
            </div>
            <div className="tp5-drawer__body">
              {cal === 'plan' ? (
                <>
                  <div className="tp5-grid2">
                    <label className="tp5-field"><span>Inicio de pruebas</span><input type="date" value={planScheduleForm.startDate || ''} onChange={e => setPlanScheduleForm(p => ({ ...p, startDate: e.target.value }))} /></label>
                    <label className="tp5-field"><span>Fin de pruebas</span><input type="date" value={planScheduleForm.endDate || ''} onChange={e => setPlanScheduleForm(p => ({ ...p, endDate: e.target.value }))} /></label>
                    <label className="tp5-field"><span>Fecha de liberación (go-live)</span><input type="date" value={planScheduleForm.goLiveDate || ''} onChange={e => setPlanScheduleForm(p => ({ ...p, goLiveDate: e.target.value }))} /><small>Se usa en Inicio y en el criterio de salida.</small></label>
                    <label className="tp5-field"><span>Congelamiento de código</span><input type="date" value={planScheduleForm.codeFreezeDate || ''} onChange={e => setPlanScheduleForm(p => ({ ...p, codeFreezeDate: e.target.value }))} /><small>Después de esta fecha, un bug nuevo pone el plan en riesgo.</small></label>
                  </div>
                  <div className="tp5-field"><span className="tp5-h3">Días festivos del plan</span>
                    <HolidayChips holidays={planScheduleForm.holidays} onChange={(next) => setPlanScheduleForm(p => ({ ...p, holidays: next }))} />
                    <small>Todos los ciclos del plan los heredan, salvo que el ciclo diga lo contrario.</small>
                  </div>
                  <Preview pv={planPv} scope="plan" />
                </>
              ) : (
                <>
                  <div className="tp5-field"><span className="tp5-h3">Fechas del ciclo</span>
                    <div className="tp5-grid2">
                      <label className="tp5-field"><span>Inicio</span><input type="date" value={cycleScheduleForm.startDate || ''} onChange={e => setCycleScheduleForm(p => ({ ...p, startDate: e.target.value }))} /></label>
                      <label className="tp5-field"><span>Fin</span><input type="date" value={cycleScheduleForm.endDate || ''} onChange={e => setCycleScheduleForm(p => ({ ...p, endDate: e.target.value }))} /></label>
                    </div>
                    <label className="tp5-radio"><input type="checkbox" checked={cycleScheduleForm.excludeWeekends !== false} onChange={e => setCycleScheduleForm(p => ({ ...p, excludeWeekends: e.target.checked }))} /> Excluir fines de semana</label>
                    {planScheduleForm.startDate && planScheduleForm.endDate && (
                      <small>Dentro de las fechas del plan ({range(planScheduleForm.startDate, planScheduleForm.endDate)}).{(cycleScheduleForm.startDate && cycleScheduleForm.startDate < planScheduleForm.startDate) || (cycleScheduleForm.endDate && cycleScheduleForm.endDate > planScheduleForm.endDate) ? ' ⚠ El ciclo se sale de las fechas del plan.' : ''}</small>
                    )}
                  </div>
                  <div className="tp5-field"><span className="tp5-h3">Días festivos e inhábiles</span>
                    <label className="tp5-radio"><input type="checkbox" checked={cycleScheduleForm.usePlanHolidays !== false}
                      onChange={e => setCycleScheduleForm(p => ({ ...p, usePlanHolidays: e.target.checked, holidays: e.target.checked ? (planScheduleForm.holidays || []) : p.holidays }))} /> Usar los del plan</label>
                    <HolidayChips holidays={cycleScheduleForm.holidays} inheritedNote={cycleScheduleForm.usePlanHolidays !== false}
                      onChange={cycleScheduleForm.usePlanHolidays !== false ? null : (next) => setCycleScheduleForm(p => ({ ...p, holidays: next }))} />
                    <small>Cuentan como días sin ejecución: no restan holgura.</small>
                  </div>
                  <div className="tp5-grid2">
                    <label className="tp5-field"><span>Ambiente</span>
                      <select value={cycleScheduleForm.environment || ''} onChange={e => setCycleScheduleForm(p => ({ ...p, environment: e.target.value }))}>
                        {availableEnvironments.map(env => <option key={env.id} value={env.name}>{env.name}</option>)}
                      </select>
                      {isAdmin && <button type="button" className="tp5-link" style={{ alignSelf: 'flex-start' }} onClick={() => { cancelCal(); setActiveTab('config'); }}>Editar catálogo de ambientes</button>}
                    </label>
                    <div className="tp5-field"><span>Testers asignados</span>
                      <span className="tp5-subtle-2">{[...new Set(deduplicatedCycleTests.map(t => t.assignee?.displayName).filter(Boolean))].join(', ') || 'Sin asignar'}</span>
                      <small>Se toma de «Asignar tester»; sirve para la meta por persona.</small>
                    </div>
                  </div>
                  <div className="tp5-field"><span className="tp5-h3">Semáforo del ciclo</span>
                    {(() => {
                      const s = { ...DEFAULT_SEMAFORO, ...(cycleScheduleForm.semaforo || {}) };
                      const set = (k, v) => setCycleScheduleForm(p => ({ ...p, semaforo: { ...DEFAULT_SEMAFORO, ...(p.semaforo || {}), [k]: Math.max(0, Number(v) || 0) } }));
                      return (
                        <table className="tp5-table tp5-semtable" style={{ minWidth: 0 }}>
                          <thead><tr><th /><th>Holgura (días hábiles)</th><th>Casos fallidos</th></tr></thead>
                          <tbody>
                            <tr><td><span className="tp5-loz tp5-loz--success">A TIEMPO</span></td><td>0 o más</td><td>menos de <input type="number" min="0" max="100" value={s.onTimeFailPct} onChange={e => set('onTimeFailPct', e.target.value)} aria-label="Fallidos máximos a tiempo" /> %</td></tr>
                            <tr><td><span className="tp5-loz tp5-loz--warning">EN RIESGO</span></td><td>hasta <input type="number" min="0" max="30" value={s.riskDays} onChange={e => set('riskDays', e.target.value)} aria-label="Días de atraso en riesgo" /> días de atraso</td><td>menos de <input type="number" min="0" max="100" value={s.riskFailPct} onChange={e => set('riskFailPct', e.target.value)} aria-label="Fallidos máximos en riesgo" /> %</td></tr>
                            <tr><td><span className="tp5-loz tp5-loz--danger">ATRASADO</span></td><td>más atraso</td><td>o más fallidos</td></tr>
                          </tbody>
                        </table>
                      );
                    })()}
                    <small>Holgura = (% ejecutado − % del tiempo transcurrido) × días hábiles del ciclo. Es la misma regla de siempre; aquí solo se vuelve configurable.</small>
                  </div>
                  <Preview pv={cyclePv} scope="ciclo" />
                </>
              )}
            </div>
            <div className="tp5-drawer__foot">
              <span className="tp5-subtle tp5-small">Los cambios recalculan el semáforo en Inicio, Planeación y Ejecución.</span>
              <button type="button" className="tp5-btn tp5-btn--ghost" onClick={cancelCal}>Cancelar</button>
              <button type="button" className="tp5-btn tp5-btn--primary" onClick={saveCal}>Guardar</button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

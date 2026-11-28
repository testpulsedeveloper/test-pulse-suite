/**
 * QualityView5.jsx — Calidad in Test Pulse 5.0 (v4.45.0), rebuilt from the approved boards
 * "Calidad · Ejecuciones", "Calidad · Defectos" and "Calidad · KPIs".
 *
 * One page header ("CALIDAD · <plan>", "Tablero de calidad", Personalizar · N de M and the
 * actions of each tab), tabs Ejecuciones / Defectos / KPIs with their filters, and the widgets
 * of the design. Each person chooses which widgets (and KPIs) they see; admins can also save
 * that choice as the project default. Figures come from utils/qualityData.js, computed over the
 * data Calidad already loads (see ReportsView.jsx), so this view adds only one small read (the
 * environment downtime reports).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '../utils/queryClient';
import { MTTR_GROUPS, mttrBySeverity, slaCompliance, firstPassYield, severityGroup, formatBusinessDuration } from '../utils/qaKpis';
import { flattenExecutions, progressSeries, riskCoverage, impediments, automation, perCycle, defectMetrics, KPI_CATALOG, KPI_DEFAULTS, kpiValues, planGoNoGo } from '../utils/qualityData';

// ── Widget catalogues per tab (id, name, description, on by default) ──
const WIDGETS = {
  runs: [
    { id: 'kpis', name: 'Indicadores clave', desc: 'Avance, bugs bloqueantes, tasa de éxito y efectividad a la primera.', on: true },
    { id: 'progress', name: 'Avance real vs. línea ideal', desc: 'Curva de avance contra la línea ideal y la proyección.', on: true },
    { id: 'rhythm', name: 'Ritmo y proyección', desc: 'Meta de ritmo, ritmo real, días restantes y término proyectado.', on: true },
    { id: 'risk', name: 'Cobertura por riesgo', desc: 'Casos ejecutados por prioridad: primero lo crítico.', on: true },
    { id: 'impediments', name: 'Impedimentos y retrabajo', desc: 'Bloqueados, horas perdidas por ambiente, retests y re-ejecución.', on: true },
    { id: 'automation', name: 'Automatización', desc: 'Cobertura, éxito de la última corrida y pruebas inestables.', on: true },
    { id: 'cycles', name: 'Avance por ciclo', desc: 'Barras apiladas de cada ciclo del plan.', on: true },
    { id: 'testers', name: 'Avance por tester', desc: 'Casos ejecutados y pendientes por persona.', on: false }
  ],
  bugs: [
    { id: 'cards', name: 'Resumen de defectos', desc: 'Abiertos, SLA, reapertura, rechazados, densidad y retests.', on: true },
    { id: 'arrival', name: 'Llegada vs. cierre', desc: 'Defectos abiertos y cerrados acumulados en el tiempo.', on: true },
    { id: 'mttr', name: 'MTTR por severidad vs SLA', desc: 'Tiempo de corrección por severidad contra el SLA.', on: true },
    { id: 'list', name: 'Defectos abiertos', desc: 'Lista ordenada por severidad y antigüedad.', on: true },
    { id: 'aging', name: 'Antigüedad de abiertos', desc: 'Cuántos defectos llevan abiertos cada rango de días.', on: false },
    { id: 'module', name: 'Densidad por módulo', desc: 'Defectos por carpeta de los casos afectados.', on: false },
    { id: 'origin', name: 'Fase de origen', desc: 'En qué fase se originó cada defecto (requiere un campo de Jira).', on: false },
    { id: 'ddp', name: 'Defectos escapados (DDP)', desc: 'Defectos encontrados después de liberar (requiere un campo de Jira).', on: false }
  ],
  kpis: [
    { id: 'resumen', name: 'Estado de los KPIs', desc: 'Cuántos KPIs visibles están en meta, bajo meta o fuera.', on: true },
    { id: 'gonogo', name: 'Preparación Go / No-Go', desc: 'Criterios de salida del plan y si hoy se puede liberar.', on: true },
    { id: 'matriz', name: 'Matriz de KPIs', desc: 'Meta, valor actual, estado y responsable de cada KPI.', on: true },
    { id: 'comparativo', name: 'Comparativo entre liberaciones', desc: 'Indicadores clave de las últimas liberaciones.', on: false }
  ]
};
const PREF_KEYS = { runs: 'qualityRunsHidden', bugs: 'qualityBugsHidden', kpis: 'qualityKpiWidgetsHidden' };
const LS = (k) => `tp_quality_${k}_v5`;
const readLS = (k) => { try { const v = JSON.parse(window.localStorage.getItem(LS(k)) || 'null'); return Array.isArray(v) ? v : null; } catch (_) { return null; } };
const writeLS = (k, v) => { try { if (v === null) window.localStorage.removeItem(LS(k)); else window.localStorage.setItem(LS(k), JSON.stringify(v)); } catch (_) { /* storage blocked */ } };
const STATE = { ok: ['EN META', 'success'], warn: ['BAJO META', 'warning'], bad: ['FUERA DE META', 'danger'], none: ['SIN DATOS', 'neutral'] };
const TONE_TOP = { success: 'success', warning: 'warning', danger: 'danger', neutral: 'neutral-strong' };

/** Small SVG line chart used by "Avance real vs. línea ideal" and "Llegada vs. cierre". */
function LineChart({ height = 260, lines, xLabels, yTicks, todayX, endLabels, area }) {
  const W = 1000; const H = height; const L = 30; const R = 70; const T = 14; const B = 34;
  const x = (v) => L + v * (W - L - R);
  const y = (v) => T + (1 - v) * (H - T - B);
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tp5-chart" role="img" aria-label={lines.map(l => l.aria).join('. ')}>
      {yTicks.map(t => (
        <g key={t.v}><line x1={L} x2={W - R} y1={y(t.v)} y2={y(t.v)} stroke="#EBECF0" /><text x={W - R + 8} y={y(t.v) + 4} className="tp5-chart__tick">{t.label}</text></g>
      ))}
      {area && <path d={`${path(area.top)} ${area.bottom.slice().reverse().map(p => `L${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')} Z`} fill={area.fill} />}
      {todayX != null && <line x1={x(todayX)} x2={x(todayX)} y1={T} y2={H - B} stroke="#172B4D" strokeWidth="1.5" />}
      {lines.map(l => l.pts.length > 0 && (
        <g key={l.id}>
          <path d={path(l.pts)} fill="none" stroke={l.color} strokeWidth={l.width || 3} strokeDasharray={l.dash || undefined} strokeLinecap="round" />
          {l.dot && <circle cx={x(l.pts[l.pts.length - 1].x)} cy={y(l.pts[l.pts.length - 1].y)} r="6" fill={l.hollow ? '#FFFFFF' : l.color} stroke={l.color} strokeWidth="2.5" />}
        </g>
      ))}
      {(endLabels || []).map(e => <text key={e.text} x={x(e.x) + 12} y={y(e.y) + 6} className="tp5-chart__end" fill={e.color}>{e.text}</text>)}
      {xLabels.map(t => <text key={t.label} x={x(t.x)} y={H - 8} textAnchor={t.anchor || 'middle'} className="tp5-chart__tick">{t.label}</text>)}
    </svg>
  );
}

export default function QualityView5({ ctx, d }) {
  const { testPlans, reportSelectedPlans, setReportSelectedPlans, reportSelectedCycles, setReportSelectedCycles, reportSelectedVersions,
    setReportSelectedVersions, dashboardSubView, setDashboardSubView, selectedProjectId, projectConfig, setProjectConfig, isAdmin,
    findTc, folderPaths, setSelectedBug, addNotification, testCycles } = ctx;
  const { scopeCycles, allPlanCycles, cycleBugs, planBugs, firstPassRuns, availableVersions, cachedBugBusinessHours,
    handleOpenExecutiveReportModal, handleSaveSnapshot, handlePrintPdf, modals } = d;

  const tab = dashboardSubView === 'bugs' ? 'bugs' : (dashboardSubView === 'kpis' ? 'kpis' : 'runs');
  const [customOpen, setCustomOpen] = useState(false);
  const [customTab, setCustomTab] = useState('widgets');
  const [scopeAll, setScopeAll] = useState(false); // "Todo el proyecto" (admins)
  const [cyclesOpen, setCyclesOpen] = useState(false);
  const [sevFilter, setSevFilter] = useState('ALL');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const [downtime, setDowntime] = useState([]);
  const [prefTick, setPrefTick] = useState(0); // re-read localStorage after a change

  useEffect(() => {
    if (!selectedProjectId) return undefined;
    let cancelled = false;
    invoke('getEnvDowntime', { projectId: selectedProjectId }).then(r => { if (!cancelled) setDowntime(Array.isArray(r?.events) ? r.events : []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedProjectId]);

  // ── Visible widgets: personal choice > project default > catalogue default ──
  const hiddenFor = (t) => {
    void prefTick;
    const personal = readLS(PREF_KEYS[t]);
    if (personal) return personal;
    const project = projectConfig?.uiPrefs?.[PREF_KEYS[t]];
    if (Array.isArray(project)) return project;
    return WIDGETS[t].filter(w => !w.on).map(w => w.id);
  };
  const hidden = hiddenFor(tab);
  const show = (id) => !hidden.includes(id);
  const visibleKpis = (() => {
    void prefTick;
    return readLS('qualityKpis') || projectConfig?.uiPrefs?.qualityKpis || KPI_DEFAULTS;
  })();
  const savePref = async (key, list) => {
    if (scopeAll && isAdmin) {
      try {
        const res = await invoke('setProjectUiPref', { projectId: selectedProjectId, key, value: list });
        setProjectConfig(prev => ({ ...(prev || {}), uiPrefs: res?.uiPrefs || prev?.uiPrefs }));
        writeLS(key, null);
      } catch (err) { addNotification({ type: 'error', title: 'No se pudo guardar', description: err?.message || 'Intenta de nuevo.' }); }
    } else writeLS(key, list);
    setPrefTick(n => n + 1);
  };
  const toggleWidget = (id) => savePref(PREF_KEYS[tab], hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id]);
  const toggleKpi = (id) => savePref('qualityKpis', visibleKpis.includes(id) ? visibleKpis.filter(x => x !== id) : [...visibleKpis, id]);

  // ── Shared figures ──
  const plan = testPlans.find(p => String(p.id) === String(reportSelectedPlans?.[0])) || null;
  // Without a plan (or plan dates), the window spans the selected cycles' own dates.
  const planSchedule = useMemo(() => {
    if (plan?.schedule?.startDate && plan?.schedule?.endDate) return plan.schedule;
    const sch = (scopeCycles || []).map(c => c.schedule || {}).filter(x => x.startDate && x.endDate);
    if (!sch.length) return plan?.schedule || {};
    return { startDate: sch.map(x => x.startDate).sort()[0], endDate: sch.map(x => x.endDate).sort().slice(-1)[0], holidays: sch.flatMap(x => x.holidays || []), excludeWeekends: sch.every(x => x.excludeWeekends !== false) };
  }, [plan, scopeCycles]);
  const execs = useMemo(() => flattenExecutions(scopeCycles), [scopeCycles]);
  const tcOf = (e) => findTc(e.testCaseKey || e.key) || findTc(e.testCaseId || e.id) || {};
  const priorityOf = (e) => tcOf(e).rawFields?.priority?.name || e.priority?.name || e.priority;
  // Same rule as the rest of the app (labels, execution type field…), via getExecVal.
  const isAuto = (e) => e.isAutomated === true || String(ctx.getExecVal ? ctx.getExecVal({ ...tcOf(e), ...e, id: e.id }) : '').includes('auto');
  const progress = useMemo(() => progressSeries(execs, planSchedule), [execs, planSchedule]);
  const mttr = useMemo(() => mttrBySeverity((cycleBugs || []).map(b => ({ severity: b.severity, isDone: Boolean(b.isDone), hours: cachedBugBusinessHours(b) }))), [cycleBugs, cachedBugBusinessHours]);
  const sla = slaCompliance(mttr);
  const slaPct = sla && sla.closed ? Math.round(sla.pct) : null;
  const fpy = firstPassYield(firstPassRuns || []);
  const fpyPct = fpy && fpy.pct != null ? Math.round(fpy.pct) : null;
  const counts = execs.reduce((a, e) => { a[e.st] = (a[e.st] || 0) + 1; return a; }, {});
  const passed = counts.Passed || 0; const executedN = passed + (counts.Failed || 0) + (counts.Blocked || 0);
  const passRate = executedN ? Math.round((passed / executedN) * 100) : null;
  const openBlockers = (cycleBugs || []).filter(b => !b.isDone && severityGroup(b.severity) === 'critical');
  const blockerCases = openBlockers.reduce((n, b) => n + (b.affectedCount || (b.affectedCases ? b.affectedCases.size : 0)), 0);
  const blockerCycles = new Set(openBlockers.flatMap(b => (b.cycleList || '').split(', ').filter(Boolean))).size;
  const imp = impediments(execs);
  const auto = automation(execs, isAuto);
  const cyclesBars = perCycle(scopeCycles);
  const envHours = useMemo(() => {
    const start = planSchedule.startDate ? new Date(planSchedule.startDate).getTime() : 0;
    let ms = 0; let top = null;
    downtime.forEach(ev => {
      const s = Math.max(new Date(ev.startedAt).getTime(), start);
      const f = ev.endedAt ? new Date(ev.endedAt).getTime() : Date.now();
      if (f > s) { ms += f - s; top = top || ev; }
    });
    const mins = Math.round(ms / 60000);
    return { label: mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}`, mins, top };
  }, [downtime, planSchedule.startDate]);

  // Defects (plan-wide on the Defectos tab, as in the design).
  const slaHoursOf = (b) => MTTR_GROUPS.find(g => g.key === severityGroup(b.severity))?.targetHours ?? null;
  const bugsForTab = (planBugs || []).filter(b => sevFilter === 'ALL' || severityGroup(b.severity) === sevFilter);
  const defects = useMemo(() => defectMetrics({ bugs: bugsForTab, totalCases: execs.length, slaHoursOf, hoursOf: cachedBugBusinessHours }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bugsForTab, execs.length]);
  const gng = planGoNoGo({ execs, bugs: cycleBugs || [], priorityOf });
  const kv = kpiValues({ fpy: fpyPct, slaPct, blockedPct: imp.blockedPct, progress, defects, autoPct: auto.coveragePct, goNoGo: gng, reqCoveragePct: null });

  // ── Header actions per tab ──
  const exportBugsCsv = () => {
    const rows = [['Clave', 'Resumen', 'Severidad', 'Estado', 'Antigüedad (días)', 'SLA', 'Casos afectados', 'Asignado']]
      .concat(defects.openRows.map(b => [b.key, b.summary, b.severity, b.status, b.ageDays ?? '', b.slaState === 'late' ? 'Vencido' : (b.slaState === 'ok' ? 'En SLA' : ''), b.affected, b.assignee]));
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `defectos-abiertos-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const kpiRows = KPI_CATALOG.filter(k => visibleKpis.includes(k.id));
  const exportKpisCsv = () => {
    const rows = [['KPI', 'Nombre', 'Meta', 'Actual', 'Estado', 'Responsable', 'Frecuencia']].concat(kpiRows.map(k => [k.id, k.name, k.goal, kv[k.id].value, STATE[kv[k.id].s][0], k.owner, k.freq]));
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `kpis-calidad-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const exportKpisPdf = () => {
    const esc = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const html = `<h1>KPIs de calidad · ${esc(plan?.summary || 'Todos los planes')}</h1><table border="1" cellpadding="6" cellspacing="0"><tr><th>KPI</th><th>Meta</th><th>Actual</th><th>Estado</th><th>Responsable</th><th>Frecuencia</th></tr>${kpiRows.map(k => `<tr><td>${esc(k.id)} ${esc(k.name)}</td><td>${esc(k.goal)}</td><td>${esc(kv[k.id].value)}</td><td>${esc(STATE[kv[k.id].s][0])}</td><td>${esc(k.owner)}</td><td>${esc(k.freq)}</td></tr>`).join('')}</table>`;
    handlePrintPdf(html, 'KPIs de calidad');
  };

  const catalog = WIDGETS[tab];
  const visibleCount = catalog.filter(w => show(w.id)).length;

  // ── Header ──
  const header = (
    <header className="tp5-qhead">
      <div className="tp5-qhead__row">
        <div>
          <span className="tp5-eyebrow">Calidad · {plan ? plan.summary : 'Todos los planes'}</span>
          <h1 className="tp5-pagehead__title">Tablero de calidad</h1>
        </div>
        <div className="tp5-pagehead__actions">
          <button type="button" className="tp5-btn tp5-btn--secondary" onClick={() => { setCustomTab('widgets'); setCustomOpen(true); }}>Personalizar · {visibleCount} de {catalog.length}</button>
          {tab === 'runs' && <button type="button" className="tp5-btn tp5-btn--secondary" onClick={handleSaveSnapshot}>Guardar snapshot</button>}
          {tab === 'bugs' && <button type="button" className="tp5-btn tp5-btn--secondary" onClick={exportBugsCsv}>Exportar lista de bugs</button>}
          {tab === 'kpis' && <><button type="button" className="tp5-btn tp5-btn--secondary" onClick={exportKpisPdf}>Exportar PDF</button><button type="button" className="tp5-btn tp5-btn--secondary" onClick={exportKpisCsv}>Exportar Excel</button></>}
          <button type="button" className="tp5-btn tp5-btn--primary" onClick={handleOpenExecutiveReportModal}>Enviar reporte ejecutivo</button>
        </div>
      </div>
      <div className="tp5-qhead__row tp5-qhead__row--tabs">
        <div role="tablist" className="tp5-tabs" style={{ borderBottom: 0 }}>
          {[['runs', 'Ejecuciones'], ['bugs', 'Defectos'], ['kpis', 'KPIs']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : undefined} onClick={() => setDashboardSubView(id)}>{label}</button>
          ))}
        </div>
        <div className="tp5-toolbar" style={{ marginLeft: 'auto' }}>
          <select className="tp5-select" aria-label="Plan" value={reportSelectedPlans?.[0] || ''} onChange={e => { setReportSelectedPlans(e.target.value ? [e.target.value] : []); setReportSelectedCycles([]); }}>
            <option value="">Todos los planes</option>
            {testPlans.map(p => <option key={p.id} value={p.id}>{p.summary}</option>)}
          </select>
          {tab === 'runs' && (
            <span className="tp5-menu">
              <button type="button" className="tp5-select tp5-select--btn" aria-expanded={cyclesOpen} onClick={() => setCyclesOpen(o => !o)}>
                {reportSelectedCycles.length ? `${reportSelectedCycles.length} ciclo${reportSelectedCycles.length === 1 ? '' : 's'}` : `${allPlanCycles.length} ciclos`} ▾
              </button>
              {cyclesOpen && (
                <div className="tp5-menu__panel tp5-cfg" onMouseLeave={() => setCyclesOpen(false)}>
                  <button type="button" className="tp5-link" style={{ alignSelf: 'flex-start' }} onClick={() => setReportSelectedCycles([])}>Todos los ciclos del plan</button>
                  {allPlanCycles.map(c => (
                    <label key={c.id} className="tp5-radio"><input type="checkbox" checked={reportSelectedCycles.map(String).includes(String(c.id))}
                      onChange={e => setReportSelectedCycles(prev => (e.target.checked ? [...prev, c.id] : prev.filter(x => String(x) !== String(c.id))))} /> {c.summary}</label>
                  ))}
                </div>
              )}
            </span>
          )}
          {tab === 'runs' && (
            <select className="tp5-select" aria-label="Versión" value={reportSelectedVersions?.[0] || ''} onChange={e => setReportSelectedVersions(e.target.value ? [e.target.value] : [])}>
              <option value="">Todas las versiones</option>
              {(availableVersions || []).map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {tab === 'bugs' && (
            <select className="tp5-select" aria-label="Severidad" value={sevFilter} onChange={e => setSevFilter(e.target.value)}>
              <option value="ALL">Todas las severidades</option>
              {MTTR_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          )}
          {tab === 'kpis' && (
            <select className="tp5-select" aria-label="Clasificación" value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
              <option value="ALL">Todas las clasificaciones</option>
              {[...new Set(KPI_CATALOG.map(k => k.group))].map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
        </div>
      </div>
    </header>
  );

  // ── Ejecuciones ──
  const runsTab = (
    <>
      {show('kpis') && (
        <section className="tp5-kpi-grid">
          {[
            { label: 'Avance de ejecución', value: `${progress.donePct}%`, detail: `${executedN} de ${execs.length} casos${progress.hasDates ? ` · ideal hoy ${progress.idealPct} %` : ''}`, state: !progress.hasDates ? ['SIN FECHAS', 'neutral'] : (progress.slackDays >= 0 ? ['A TIEMPO', 'success'] : (progress.slackDays >= -2 ? ['EN RIESGO', 'warning'] : ['ATRASADO', 'danger'])) },
            { label: 'Bugs bloqueantes', value: String(openBlockers.length), detail: openBlockers.length ? `Abiertos · detienen ${blockerCases} casos en ${blockerCycles || 1} ciclo${blockerCycles === 1 ? '' : 's'}` : 'Ninguno abierto', state: openBlockers.length ? ['ATENCIÓN', 'danger'] : ['SIN BLOQUEOS', 'success'] },
            { label: 'Tasa de éxito', value: passRate == null ? '—' : `${passRate}%`, detail: `${passed} Passed de ${executedN} ejecutados`, state: passRate == null ? ['SIN DATOS', 'neutral'] : (passRate >= 85 ? ['EN META', 'success'] : ['BAJO META', 'warning']) },
            { label: 'Efectividad a la primera', value: fpyPct == null ? '—' : `${fpyPct}%`, detail: fpyPct == null ? 'Sin casos ejecutados' : `Meta ≥ 85 % · ${fpy.estimated} estimados`, state: fpyPct == null ? ['SIN DATOS', 'neutral'] : (fpyPct >= 85 ? ['EN META', 'success'] : ['BAJO META', 'warning']) }
          ].map(k => (
            <div key={k.label} className="tp5-card tp5-kpi">
              <div className="tp5-kpi__head"><span className="tp5-kpi__label">{k.label}</span><span className={`tp5-loz tp5-loz--${k.state[1]}`}>{k.state[0]}</span></div>
              <span className="tp5-kpi__value">{k.value}</span><span className="tp5-kpi__detail">{k.detail}</span>
            </div>
          ))}
        </section>
      )}
      {(show('progress') || show('rhythm')) && (
        <div className="tp5-qrow">
          {show('progress') && (
            <section className="tp5-card tp5-qcard tp5-qrow__wide">
              <div className="tp5-section__head"><h2 className="tp5-h2">Avance real vs. línea ideal</h2>
                {progress.hasDates && <span className={`tp5-loz tp5-loz--${progress.slackDays >= 0 ? 'success' : 'danger'}`}>{progress.slackDays >= 0 ? `+${progress.slackDays} DÍAS ADELANTE` : `${progress.slackDays} DÍAS ATRÁS`}</span>}</div>
              {!progress.hasDates ? <p className="tp5-subtle tp5-small">El plan no tiene fechas. Defínelas en Planeación › Calendario y metas para ver la curva.</p> : (
                <>
                  <LineChart
                    lines={[
                      { id: 'ideal', pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#8590A2', dash: '10 8', width: 2.5, aria: `Ideal hoy ${progress.idealPct} %` },
                      { id: 'real', pts: progress.points, color: '#0C66E4', dot: true, aria: `Real ${progress.donePct} %` },
                      ...(progress.finishX != null && progress.points.length ? [{ id: 'proj', pts: [progress.points[progress.points.length - 1], { x: Math.min(1.1, progress.finishX), y: 1 }], color: '#0C66E4', dash: '3 7', width: 2.5, dot: true, hollow: true, aria: `Proyección 100 % el ${progress.finish}` }] : [])
                    ]}
                    yTicks={[{ v: 0, label: '0%' }, { v: 0.5, label: '50%' }, { v: 1, label: '100' }]}
                    todayX={progress.todayX}
                    xLabels={[{ x: 0, label: progress.startLabel, anchor: 'start' }, { x: progress.todayX, label: `hoy · ${progress.todayLabel}` }, { x: 1, label: progress.endLabel, anchor: 'end' }]}
                  />
                  <div className="tp5-legend"><span><i className="tp5-legend__line" /> Real · {progress.donePct} %</span><span><i className="tp5-legend__line tp5-legend__line--dash" /> Ideal · {progress.idealPct} %</span>{progress.finish && <span><i className="tp5-legend__line tp5-legend__line--dot" /> Proyección · 100 % el {progress.finish}</span>}{!progress.datedDaily && <span className="tp5-subtle">Sin fechas por ejecución: la curva une el inicio con hoy.</span>}</div>
                </>
              )}
            </section>
          )}
          {show('rhythm') && (
            <section className="tp5-card tp5-qcard tp5-qrow__side">
              <h2 className="tp5-h2">Ritmo y proyección</h2>
              <dl className="tp5-kv">
                <dt>Meta de ritmo</dt><dd>{progress.hasDates ? `${progress.goal} casos/día` : '—'}</dd>
                <dt>Ritmo real{progress.elapsed ? ` (${progress.elapsed} días)` : ''}</dt><dd>{progress.hasDates && progress.elapsed ? `${progress.real} casos/día` : '—'}</dd>
                <dt>Días hábiles restantes</dt><dd>{progress.hasDates ? `${progress.remaining} de ${progress.days}` : '—'}</dd>
                <dt>Término proyectado</dt><dd className={progress.finishLate ? 'tp5-tone-danger' : undefined}>{progress.finish || '—'}</dd>
              </dl>
              <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Días hábiles, sin fines de semana ni festivos del plan.</p>
            </section>
          )}
        </div>
      )}
      {(show('risk') || show('impediments') || show('automation')) && (
        <div className="tp5-qgrid3">
          {show('risk') && (
            <section className="tp5-card tp5-qcard">
              <h2 className="tp5-h2">Cobertura por riesgo</h2>
              <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Casos ejecutados por prioridad: primero lo crítico.</p>
              {riskCoverage(execs, priorityOf).map(r => (
                <div key={r.label} className="tp5-riskrow">
                  <strong>{r.label}</strong>
                  <span className="tp5-bar"><span style={{ width: `${r.pct}%`, background: r.label === 'Crítica' ? 'var(--tp5-success)' : (r.label === 'Baja' ? '#8590A2' : 'var(--tp5-primary)') }} /></span>
                  <span className="tp5-small">{r.pct}% · {r.done}/{r.total}</span>
                </div>
              ))}
            </section>
          )}
          {show('impediments') && (
            <section className="tp5-card tp5-qcard">
              <h2 className="tp5-h2">Impedimentos y retrabajo</h2>
              <div className="tp5-implist">
                <div><span>Casos bloqueados<small>{imp.blockedPct} % del alcance · límite 10 %</small></span><strong className={imp.blockedPct >= 10 ? 'tp5-tone-danger' : undefined}>{imp.blocked}</strong></div>
                <div><span>Horas perdidas por ambiente<small>{envHours.top ? `${envHours.top.component || envHours.top.envName} en ${envHours.top.envName}${envHours.top.ticket ? ` · ${envHours.top.ticket}` : ''}` : 'Sin caídas reportadas'}</small></span><strong className={envHours.mins ? 'tp5-tone-warning' : undefined}>{envHours.mins ? envHours.label : '0'}</strong></div>
                <div><span>Retests pendientes<small>Bugs corregidos que esperan nueva prueba</small></span><strong className="tp5-tone-warning">{defectMetrics({ bugs: cycleBugs || [] }).retests}</strong></div>
                <div><span>Tasa de re-ejecución<small>Casos ejecutados más de una vez</small></span><strong>{imp.rerunPct == null ? '—' : `${imp.rerunPct}%`}</strong></div>
              </div>
            </section>
          )}
          {show('automation') && (
            <section className="tp5-card tp5-qcard">
              <h2 className="tp5-h2">Automatización</h2>
              <div className="tp5-autostats">
                <div><strong>{auto.coveragePct ?? 0}%</strong><span>cobertura · {auto.total} de {execs.length}</span></div>
                <div><strong>{auto.passPct == null ? '—' : `${auto.passPct}%`}</strong><span>éxito en la última corrida</span></div>
                <div><strong className={auto.flakyCount ? 'tp5-tone-danger' : undefined}>{auto.flakyCount}</strong><span>inestables (flaky)</span></div>
              </div>
              {auto.flaky.length > 0 && (
                <>
                  <span className="tp5-eyebrow">Pruebas inestables</span>
                  {auto.flaky.map(f => (
                    <div key={f.key} className="tp5-flaky"><span className="tp5-mono tp5-key">{f.key}</span><span className="tp5-ellipsis">{f.summary}</span>
                      <span className="tp5-hist__trend">{f.seq.map((s, i) => <span key={i} style={{ background: s === 'Passed' ? '#1F845A' : '#C9372C', width: 8, height: 16 }} />)}</span></div>
                  ))}
                </>
              )}
              <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Inestable: alterna Passed y Failed en las últimas corridas sin cambios en el caso.</p>
            </section>
          )}
        </div>
      )}
      {show('cycles') && (
        <section className="tp5-card tp5-qcard">
          <h2 className="tp5-h2">Avance por ciclo</h2>
          {cyclesBars.map(c => (
            <div key={c.id} className="tp5-cyclebar">
              <strong className="tp5-ellipsis">{c.name}</strong>
              <span className="tp5-bar" style={{ height: 14 }}>
                <span style={{ width: `${c.passed}%`, background: 'var(--tp5-success)' }} /><span style={{ width: `${c.failed}%`, background: 'var(--tp5-danger)' }} /><span style={{ width: `${c.blocked}%`, background: 'var(--tp5-warning)' }} />
              </span>
              <strong>{c.pct}%</strong>
            </div>
          ))}
          {cyclesBars.length === 0 && <span className="tp5-subtle tp5-small">Sin ciclos en la selección.</span>}
        </section>
      )}
      {show('testers') && (() => {
        const by = new Map();
        execs.forEach(e => { const n = e.executedBy?.displayName || e.assignee?.displayName || 'Sin asignar'; const r = by.get(n) || { n, done: 0, total: 0 }; r.total++; if (e.st !== 'Not Run') r.done++; by.set(n, r); });
        return (
          <section className="tp5-card tp5-qcard">
            <h2 className="tp5-h2">Avance por tester</h2>
            {[...by.values()].sort((a, b) => b.total - a.total).map(r => (
              <div key={r.n} className="tp5-cyclebar"><strong className="tp5-ellipsis">{r.n}</strong><span className="tp5-bar" style={{ height: 10 }}><span style={{ width: `${(r.done / r.total) * 100}%`, background: 'var(--tp5-primary)' }} /></span><span className="tp5-small">{r.done} de {r.total}</span></div>
            ))}
          </section>
        );
      })()}
    </>
  );

  // ── Defectos ──
  const mttrPlan = useMemo(() => mttrBySeverity(bugsForTab.map(b => ({ severity: b.severity, isDone: Boolean(b.isDone), hours: cachedBugBusinessHours(b) }))), [bugsForTab, cachedBugBusinessHours]);
  const slaPlan = slaCompliance(mttrPlan);
  const sevTone = (s) => { const g = severityGroup(s); return g === 'critical' ? 'danger' : g === 'high' ? 'orange' : g === 'medium' ? 'warning' : 'neutral'; };
  const sevLabel = (s) => { const g = severityGroup(s); return g === 'critical' ? 'CRÍTICO' : g === 'high' ? 'ALTO' : g === 'medium' ? 'MEDIO' : String(s || 'SIN SEVERIDAD').toUpperCase(); };
  const bugsTab = (
    <>
      {show('cards') && (
        <section className="tp5-tiles tp5-tiles--6">
          {[
            { label: 'Abiertos', value: defects.open, detail: `${defects.critOpen} bloqueantes/críticos · ${defects.highOpen} altos`, tone: defects.critOpen ? 'danger' : (defects.open ? 'warning' : 'success') },
            { label: 'Cumplimiento de SLA', value: slaPlan && slaPlan.closed ? `${Math.round(slaPlan.pct)}%` : '—', detail: slaPlan && slaPlan.closed ? `${slaPlan.withinSla} de ${slaPlan.closed} cerrados · meta ≥ 90 %` : 'Sin defectos cerrados', tone: !slaPlan?.closed ? 'neutral' : (slaPlan.pct >= 90 ? 'success' : 'warning') },
            { label: 'Reapertura', value: defects.reopenPct == null ? '—' : `${defects.reopenPct}%`, detail: defects.reopenPct == null ? 'Sin defectos cerrados' : `${defects.reopened} de ${defects.closed} cerrados · meta ≤ 5 %`, tone: defects.reopenPct == null ? 'neutral' : (defects.reopenPct <= 5 ? 'success' : 'warning') },
            { label: 'Rechazados', value: defects.rejectedPct == null ? '—' : `${defects.rejectedPct}%`, detail: `${defects.rejected} de ${defects.total} reportes (duplicados o no es bug)`, tone: defects.rejectedPct == null ? 'neutral' : (defects.rejectedPct <= 10 ? 'success' : 'warning') },
            { label: 'Densidad', value: defects.density == null ? '—' : defects.density, detail: 'bugs por 100 casos del plan', tone: 'neutral' },
            { label: 'Retests pendientes', value: defects.retests, detail: 'corregidos que esperan prueba', tone: defects.retests ? 'warning' : 'success' }
          ].map(c => (
            <div key={c.label} className={`tp5-card tp5-tile5 tp5-tile5--${TONE_TOP[c.tone] || c.tone}`}>
              <span className="tp5-kpi__label">{c.label}</span><span className="tp5-tile5__value">{c.value}</span><span className="tp5-kpi__detail">{c.detail}</span>
            </div>
          ))}
        </section>
      )}
      {show('arrival') && (
        <section className="tp5-card tp5-qcard">
          <div className="tp5-section__head"><h2 className="tp5-h2">Llegada vs. cierre de defectos</h2>
            {defects.series && <span className={`tp5-loz tp5-loz--${defects.series.stabilizing ? 'success' : 'warning'}`}>{defects.series.stabilizing ? 'SE ESTABILIZA' : 'AÚN NO SE ESTABILIZA'}</span>}</div>
          {!defects.series ? <p className="tp5-subtle tp5-small">Sin defectos con fecha en el plan.</p> : (() => {
            const m = defects.series.max; const last = defects.series.pts[defects.series.pts.length - 1];
            const top = defects.series.pts.map(p => ({ x: p.x, y: p.opened / m })); const bot = defects.series.pts.map(p => ({ x: p.x, y: p.closed / m }));
            return (
              <>
                <LineChart height={300}
                  area={{ top, bottom: bot, fill: 'rgba(201, 55, 44, 0.08)' }}
                  lines={[{ id: 'o', pts: top, color: '#C9372C', aria: `${last.opened} abiertos` }, { id: 'c', pts: bot, color: '#1F845A', aria: `${last.closed} cerrados` }]}
                  yTicks={[0, 0.33, 0.66, 1].map(v => ({ v, label: String(Math.round(v * m)) }))}
                  xLabels={[{ x: 0, label: defects.series.startLabel, anchor: 'start' }, { x: 1, label: defects.series.endLabel, anchor: 'end' }]}
                  endLabels={[{ x: 1, y: last.opened / m, text: `${last.opened} abiertos`, color: '#AE2E24' }, { x: 1, y: last.closed / m, text: `${last.closed} cerrados`, color: '#216E4E' }]}
                />
                <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Cuando la curva de abiertos se aplana y la de cerrados la alcanza, el producto se está estabilizando. Hoy la brecha es de {last.opened - last.closed} abiertos.</p>
              </>
            );
          })()}
        </section>
      )}
      {show('mttr') && (
        <section className="tp5-card tp5-qcard">
          <div className="tp5-section__head"><h2 className="tp5-h2">MTTR por severidad vs SLA</h2><span className="tp5-subtle tp5-small" style={{ marginLeft: 'auto' }}>horas hábiles · 1 día = 10 h</span></div>
          <table className="tp5-table" style={{ minWidth: 0 }}>
            <thead><tr><th>Severidad</th><th>MTTR</th><th>SLA</th><th>En SLA</th><th>Vencidos</th></tr></thead>
            <tbody>
              {mttrPlan.filter(g => g.targetHours !== null).map(g => (
                <tr key={g.key}><td className="tp5-strong">{g.label}</td><td>{g.avgHours == null ? '—' : formatBusinessDuration(g.avgHours)}</td><td>{g.targetLabel}</td>
                  <td>{g.compliancePct == null ? '—' : `${Math.round(g.compliancePct)} % (${g.withinSla}/${g.closed})`}</td>
                  <td className={g.openOverdue ? 'tp5-tone-danger tp5-strong' : 'tp5-strong'}>{g.openOverdue} de {g.open}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>{slaPlan?.closed ? `Cumplimiento total: ${slaPlan.withinSla} de ${slaPlan.closed} cerrados dentro de SLA (${Math.round(slaPlan.pct)} %) · meta ≥ 90 %.` : 'Aún no hay defectos cerrados para medir el SLA.'}</p>
        </section>
      )}
      {show('aging') && (() => {
        const buckets = [['0–2 días', 0, 2], ['3–5 días', 3, 5], ['6–10 días', 6, 10], ['Más de 10', 11, 1e9]].map(([l, a, b]) => ({ l, n: defects.openRows.filter(r => r.ageDays != null && r.ageDays >= a && r.ageDays <= b).length }));
        const max = Math.max(1, ...buckets.map(b => b.n));
        return (<section className="tp5-card tp5-qcard"><h2 className="tp5-h2">Antigüedad de abiertos</h2>{buckets.map(b => <div key={b.l} className="tp5-cyclebar"><strong>{b.l}</strong><span className="tp5-bar" style={{ height: 12 }}><span style={{ width: `${(b.n / max) * 100}%`, background: 'var(--tp5-danger)' }} /></span><strong>{b.n}</strong></div>)}</section>);
      })()}
      {show('module') && (() => {
        const by = new Map();
        bugsForTab.forEach(b => (b.affectedCasesList || []).forEach(c => { const f = folderPaths.find(x => x.id === (findTc(c.key || c.id)?.folderId))?.name || 'Sin carpeta'; by.set(f, (by.get(f) || 0) + 1); }));
        const rows = [...by.entries()].sort((a, b) => b[1] - a[1]); const max = Math.max(1, ...rows.map(r => r[1]));
        return (<section className="tp5-card tp5-qcard"><h2 className="tp5-h2">Densidad por módulo</h2>{rows.length ? rows.map(([f, n]) => <div key={f} className="tp5-cyclebar"><strong className="tp5-ellipsis">{f}</strong><span className="tp5-bar" style={{ height: 12 }}><span style={{ width: `${(n / max) * 100}%`, background: 'var(--tp5-primary)' }} /></span><strong>{n}</strong></div>) : <span className="tp5-subtle tp5-small">Sin defectos ligados a casos.</span>}</section>);
      })()}
      {show('origin') && <section className="tp5-card tp5-qcard"><h2 className="tp5-h2">Fase de origen</h2><p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Requiere configuración: un administrador debe elegir el campo de Jira «Fase de origen» en Configuración › Defectos y SLA.</p></section>}
      {show('ddp') && <section className="tp5-card tp5-qcard"><h2 className="tp5-h2">Defectos escapados (DDP)</h2><p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Requiere configuración: un administrador debe elegir el campo «Ambiente donde se detectó» en Configuración › Defectos y SLA.</p></section>}
      {show('list') && (
        <section className="tp5-card tp5-qcard">
          <div className="tp5-section__head"><h2 className="tp5-h2">Defectos abiertos · {defects.open}</h2><span className="tp5-subtle tp5-small" style={{ marginLeft: 'auto' }}>Ordenados por severidad y antigüedad · clic para ver el detalle</span></div>
          <div className="tp5-table-wrap">
            <table className="tp5-table">
              <thead><tr><th>Clave</th><th>Resumen</th><th>Severidad</th><th>Estado</th><th>Antigüedad</th><th>SLA</th><th>Casos afectados</th><th>Asignado</th></tr></thead>
              <tbody>
                {defects.openRows.map(b => (
                  <tr key={b.key} className="tp5-row" onClick={() => setSelectedBug && setSelectedBug(b)} style={{ cursor: 'pointer' }}>
                    <td className="tp5-mono tp5-key">{b.key}</td><td>{b.summary}</td>
                    <td><span className={`tp5-loz tp5-loz--${sevTone(b.severity)}`}>{sevLabel(b.severity)}</span></td>
                    <td className="tp5-subtle-2">{b.status}</td><td className="tp5-nowrap">{b.ageDays == null ? '—' : `${b.ageDays} día${b.ageDays === 1 ? '' : 's'}`}</td>
                    <td>{b.slaState === 'none' ? '—' : <span className={`tp5-loz tp5-loz--${b.slaState === 'late' ? 'danger' : 'success'}`}>{b.slaState === 'late' ? 'VENCIDO' : 'EN SLA'}</span>}</td>
                    <td>{b.affected}</td><td className="tp5-subtle-2">{b.assignee}</td>
                  </tr>
                ))}
                {defects.openRows.length === 0 && <tr><td colSpan={8} className="tp5-subtle">No hay defectos abiertos en la selección.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );

  // ── KPIs ──
  const shownKpis = KPI_CATALOG.filter(k => visibleKpis.includes(k.id) && (groupFilter === 'ALL' || k.group === groupFilter));
  const stateCounts = shownKpis.reduce((a, k) => { a[kv[k.id].s] = (a[kv[k.id].s] || 0) + 1; return a; }, {});
  const kpisTab = (
    <>
      {(show('resumen') || show('gonogo')) && (
        <div className="tp5-qrow">
          {show('resumen') && (
            <section className="tp5-card tp5-qcard tp5-qrow__side" style={{ flexBasis: 420 }}>
              <h2 className="tp5-h2">{shownKpis.length} KPIs visibles · estado</h2>
              <span className="tp5-bar" style={{ height: 12 }} role="img" aria-label={Object.entries(stateCounts).map(([s, n]) => `${n} ${STATE[s][0].toLowerCase()}`).join(', ')}>
                {['ok', 'warn', 'bad', 'none'].map(s => stateCounts[s] ? <span key={s} style={{ width: `${(stateCounts[s] / shownKpis.length) * 100}%`, background: s === 'ok' ? 'var(--tp5-success)' : s === 'warn' ? 'var(--tp5-warning)' : s === 'bad' ? 'var(--tp5-danger)' : '#DCDFE4' }} /> : null)}
              </span>
              <div className="tp5-statelegend">{['ok', 'warn', 'bad', 'none'].filter(s => stateCounts[s]).map(s => <span key={s}><i className={`tp5-sq tp5-sq--${STATE[s][1]}`} /> {stateCounts[s]} {STATE[s][0].toLowerCase()}</span>)}</div>
              <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Cuenta solo los KPIs que este tablero muestra.</p>
            </section>
          )}
          {show('gonogo') && (
            <section className="tp5-card tp5-qcard tp5-qrow__wide">
              <div className="tp5-section__head"><h2 className="tp5-h2">Preparación Go / No-Go del plan</h2>
                {gng.verdict !== 'empty' && <span className={`tp5-loz tp5-loz--${gng.verdict === 'go' ? 'success' : gng.verdict === 'go-exception' ? 'warning' : 'danger'}`}>{gng.verdict === 'go' ? 'GO' : gng.verdict === 'go-exception' ? 'GO CON EXCEPCIÓN' : 'NO-GO HOY'} · {gng.met} DE {gng.total}</span>}
                {(planSchedule.codeFreezeDate || planSchedule.goLiveDate) && <span className="tp5-subtle tp5-small" style={{ marginLeft: 'auto' }}>{[planSchedule.codeFreezeDate && `Congelamiento ${planSchedule.codeFreezeDate.slice(8, 10)}/${planSchedule.codeFreezeDate.slice(5, 7)}`, planSchedule.goLiveDate && `liberación ${planSchedule.goLiveDate.slice(8, 10)}/${planSchedule.goLiveDate.slice(5, 7)}`].filter(Boolean).join(' · ')}</span>}</div>
              <ul className="tp5-gonogo__list">
                {gng.criteria.map(c => (
                  <li key={c.id} className={`tp5-gonogo__item ${c.ok ? 'is-ok' : 'is-bad'}`}><span className="tp5-gonogo__icon" aria-hidden="true">{c.ok ? '✓' : '✕'}</span><span className="tp5-gonogo__text"><span className="tp5-strong">{c.label}</span><span className="tp5-subtle tp5-small">{c.detail}</span></span></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {show('matriz') && (
        <section className="tp5-card tp5-qcard">
          <div className="tp5-section__head">
            <h2 className="tp5-h2">Matriz de KPIs de calidad</h2>
            <span className="tp5-loz tp5-loz--info">MOSTRANDO {shownKpis.length} DE {KPI_CATALOG.length}</span>
            <button type="button" className="tp5-btn tp5-btn--outline tp5-btn--sm" style={{ marginLeft: 'auto' }} onClick={() => { setCustomTab('kpis'); setCustomOpen(true); }}>+ Agregar o quitar KPIs</button>
          </div>
          <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Valores calculados con los datos de Test Pulse; los KPIs que se miden fuera (encuestas, incidentes, Ciclo de vida) lo indican. Usa la ✕ de cada fila para quitarlo del tablero.</p>
          {shownKpis.length === 0 ? <div className="tp5-empty"><strong>No hay KPIs visibles</strong><button type="button" className="tp5-btn tp5-btn--primary" onClick={() => { setCustomTab('kpis'); setCustomOpen(true); }}>Agregar KPIs</button></div> : (
            <table className="tp5-table" style={{ minWidth: 0 }}>
              <thead><tr><th>KPI</th><th>Meta</th><th>Actual</th><th>Estado</th><th>Responsable</th><th>Frecuencia</th><th><span className="tp5-sr-only">Quitar</span></th></tr></thead>
              <tbody>
                {[...new Set(shownKpis.map(k => k.group))].map(g => (
                  <React.Fragment key={g}>
                    <tr className="tp5-grouprow"><td colSpan={7}>{g.toUpperCase()}</td></tr>
                    {shownKpis.filter(k => k.group === g).map(k => (
                      <tr key={k.id}>
                        <td><span className="tp5-mono tp5-subtle">{k.id}</span> <span className="tp5-strong">{k.name}</span></td>
                        <td>{k.goal}</td><td className="tp5-strong">{kv[k.id].value}</td>
                        <td><span className={`tp5-loz tp5-loz--${STATE[kv[k.id].s][1]}`}>{STATE[kv[k.id].s][0]}</span></td>
                        <td className="tp5-subtle-2">{k.owner}</td><td className="tp5-subtle-2">{k.freq}</td>
                        <td style={{ textAlign: 'right' }}><button type="button" className="tp5-xbtn" aria-label={`Quitar ${k.id}`} onClick={() => toggleKpi(k.id)}>✕</button></td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {show('comparativo') && (() => {
        const snaps = (testCycles || []).length;
        return <section className="tp5-card tp5-qcard"><h2 className="tp5-h2">Comparativo entre liberaciones</h2><p className="tp5-subtle tp5-small" style={{ margin: 0 }}>{snaps ? 'Selecciona otro plan arriba para comparar sus indicadores; el comparativo histórico se llena con los snapshots guardados de cada liberación.' : 'Sin liberaciones anteriores.'}</p></section>;
      })()}
    </>
  );

  // ── Personalizar drawer ──
  const drawer = customOpen && (
    <div className="tp5-drawer-backdrop" onClick={() => setCustomOpen(false)}>
      <aside className="tp5-drawer" style={{ width: 'min(460px, 100%)' }} role="dialog" aria-modal="true" aria-label="Personalizar tablero" onClick={e => e.stopPropagation()}>
        <div className="tp5-drawer__head"><div><span className="tp5-eyebrow">Personalizar</span><h2 className="tp5-drawer__title">Tablero de {tab === 'runs' ? 'ejecuciones' : tab === 'bugs' ? 'defectos' : 'KPIs'}</h2></div><button type="button" className="tp5-iconbtn" aria-label="Cerrar" onClick={() => setCustomOpen(false)}>✕</button></div>
        {tab === 'kpis' && (
          <div className="tp5-drawer__tabs"><div role="tablist" className="tp5-tabs" style={{ borderBottom: 0 }}>
            <button type="button" className={customTab === 'widgets' ? 'is-on' : undefined} onClick={() => setCustomTab('widgets')}>Widgets · {visibleCount} de {catalog.length}</button>
            <button type="button" className={customTab === 'kpis' ? 'is-on' : undefined} onClick={() => setCustomTab('kpis')}>KPIs · {visibleKpis.length} de {KPI_CATALOG.length}</button>
          </div></div>
        )}
        <div className="tp5-drawer__body">
          <div className="tp5-field"><span>Guardar para</span>
            <label className="tp5-radio"><input type="radio" name="tp5-scope" checked={!scopeAll} onChange={() => setScopeAll(false)} /> Solo para mí</label>
            <label className="tp5-radio"><input type="radio" name="tp5-scope" checked={scopeAll} disabled={!isAdmin} onChange={() => setScopeAll(true)} /> Todo el proyecto <span className="tp5-subtle">(administradores)</span></label>
          </div>
          {(tab !== 'kpis' || customTab === 'widgets') ? catalog.map(w => (
            <label key={w.id} className={`tp5-optcard${show(w.id) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={show(w.id)} onChange={() => toggleWidget(w.id)} />
              <span><strong>{w.name}</strong>{w.on && <span className="tp5-loz tp5-loz--info" style={{ marginLeft: 8 }}>PREDETERMINADO</span>}<small>{w.desc}</small></span>
            </label>
          )) : (
            <>
              <div className="tp5-btnrow"><button type="button" className="tp5-chip" onClick={() => savePref('qualityKpis', KPI_CATALOG.map(k => k.id))}>Mostrar los {KPI_CATALOG.length}</button><button type="button" className="tp5-chip" onClick={() => savePref('qualityKpis', [])}>Quitar todos</button></div>
              {[...new Set(KPI_CATALOG.map(k => k.group))].map(g => (
                <div key={g} className="tp5-field"><span className="tp5-eyebrow">{g} · {KPI_CATALOG.filter(k => k.group === g && visibleKpis.includes(k.id)).length} de {KPI_CATALOG.filter(k => k.group === g).length}</span>
                  {KPI_CATALOG.filter(k => k.group === g).map(k => (
                    <label key={k.id} className={`tp5-optcard tp5-optcard--row${visibleKpis.includes(k.id) ? ' is-on' : ''}`}>
                      <input type="checkbox" checked={visibleKpis.includes(k.id)} onChange={() => toggleKpi(k.id)} /><span className="tp5-mono tp5-subtle">{k.id}</span><strong>{k.name}</strong>{KPI_DEFAULTS.includes(k.id) && <span className="tp5-loz tp5-loz--info">PREDET.</span>}
                    </label>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
        <div className="tp5-drawer__foot">
          <button type="button" className="tp5-btn tp5-btn--ghost" onClick={() => { writeLS(PREF_KEYS[tab], null); if (tab === 'kpis') writeLS('qualityKpis', null); setPrefTick(n => n + 1); }}>Restablecer predeterminados</button>
          <button type="button" className="tp5-btn tp5-btn--primary" style={{ marginLeft: 'auto' }} onClick={() => setCustomOpen(false)}>Listo</button>
        </div>
      </aside>
    </div>
  );

  return (
    <div className="tp5-quality">
      {header}
      <main className="tp5-page tp5-qpage">
        {tab === 'runs' && runsTab}
        {tab === 'bugs' && bugsTab}
        {tab === 'kpis' && kpisTab}
        {visibleCount === 0 && <div className="tp5-card tp5-empty" style={{ padding: 24 }}><strong>No hay widgets visibles</strong><button type="button" className="tp5-btn tp5-btn--primary" onClick={() => setCustomOpen(true)}>Personalizar</button></div>}
      </main>
      {drawer}
      {modals}
    </div>
  );
}

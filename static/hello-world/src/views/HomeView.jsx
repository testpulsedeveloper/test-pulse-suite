/**
 * HomeView.jsx — "Inicio", the landing screen of Test Pulse 5.0 (new in v4.41.0).
 *
 * Shows, at a glance:
 *   - a branded header with a greeting and the two most common actions;
 *   - four indicators over the ACTIVE cycles (progress, pass rate, failed, blocked);
 *   - the active cycles, most urgent first, with a stacked progress bar;
 *   - "Mis pendientes": counts of the current user's open work, read from Jira.
 *
 * Performance notes:
 *   - Indicators and the cycle list are computed from `cycles`, which App.js already loaded
 *     for Planeación/Ejecución. No extra resolver calls.
 *   - "Mis pendientes" uses Jira's approximate-count endpoint (a count, not the issues) with
 *     three small JQL queries fired in parallel, once per project/cycle-list change.
 *   - The user's first name comes from one /myself call. It is only shown on screen and is
 *     never logged.
 *
 * Only rendered when the 5.0 design is active for this user (see utils/designFlag.js).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { requestJira } from '@forge/bridge';
import { buildHomeSummary, greetingFor } from '../utils/homeSummary';
import { LIVERPOOL_LOGO_WHITE_B64 } from '../assets/liverpool-logo-b64';
import { invoke } from '../utils/queryClient';
import { summarizeInitiative, PHASE_IDS, PHASE_NAMES } from '../utils/initiativeSummary';

// Lozenge colours per cycle health, same palette as the rest of 5.0.
const HEALTH_TONE = {
  late: 'tp5-loz--danger',
  risk: 'tp5-loz--warning',
  ok: 'tp5-loz--success',
  nodates: 'tp5-loz--neutral',
  done: 'tp5-loz--info'
};

// Formats 'YYYY-MM-DD' as "17 nov" without time zone surprises.
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const shortDate = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
};

// JQL values must be quoted; escape any quote/backslash inside the value.
const q = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// Results that mean a run is finished. Stored in different casings across versions.
const FINAL_RUN_STATUSES = ['Passed', 'PASSED', 'Failed', 'FAILED', 'Blocked', 'BLOCKED'];

/** Asks Jira for an approximate count of issues matching `jql`. Returns null on any error. */
const countIssues = async (jql) => {
  try {
    const res = await requestJira('/rest/api/3/search/approximate-count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jql })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.count === 'number' ? data.count : null;
  } catch (_) {
    return null;
  }
};

export default function HomeView({ ctx }) {
  const {
    testCycles, testPlans, projects, selectedProjectId, projectConfig,
    onNavigate, onOpenCycle, isActive
  } = ctx;

  // Recomputed only when the cycle list changes (not on every App re-render).
  const summary = useMemo(() => buildHomeSummary(testCycles), [testCycles]);
  const project = useMemo(() => (projects || []).find(p => String(p.id) === String(selectedProjectId)) || null, [projects, selectedProjectId]);

  // ── Current user's first name (one call, only while Inicio is open) ──
  const [firstName, setFirstName] = useState('');
  useEffect(() => {
    if (!isActive || firstName) return undefined;
    let cancelled = false;
    requestJira('/rest/api/3/myself')
      .then(r => (r.ok ? r.json() : null))
      .then(me => {
        if (!cancelled && me?.displayName) setFirstName(String(me.displayName).trim().split(/\s+/)[0]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isActive, firstName]);

  // ── Mis pendientes (approximate counts from Jira) ──
  const activeCycleIds = useMemo(() => summary.rows.map(r => r.id).slice(0, 50), [summary]);
  const activeIdsKey = activeCycleIds.join(',');
  const [todos, setTodos] = useState({ loading: true, runs: null, bugsAssigned: null, bugsReported: null });
  useEffect(() => {
    if (!isActive || !project?.key) return undefined;
    let cancelled = false;
    const runType = projectConfig?.testRunType || 'Test Run';
    const defectType = projectConfig?.defectType || 'Bug';
    const pkey = q(project.key);
    // Runs of ACTIVE cycles assigned to me that have no final result yet.
    const runsJql = activeCycleIds.length > 0
      ? `project = ${pkey} AND issuetype = ${q(runType)} AND assignee = currentUser() AND tpCycleId in (${activeCycleIds.map(q).join(',')}) AND (tpStatus is EMPTY OR tpStatus not in (${FINAL_RUN_STATUSES.map(q).join(',')}))`
      : null;
    const bugsAssignedJql = `project = ${pkey} AND issuetype = ${q(defectType)} AND assignee = currentUser() AND statusCategory != Done`;
    const bugsReportedJql = `project = ${pkey} AND issuetype = ${q(defectType)} AND reporter = currentUser() AND statusCategory != Done`;
    setTodos(t => ({ ...t, loading: true }));
    Promise.all([
      runsJql ? countIssues(runsJql) : Promise.resolve(0),
      countIssues(bugsAssignedJql),
      countIssues(bugsReportedJql)
    ]).then(([runs, bugsAssigned, bugsReported]) => {
      if (!cancelled) setTodos({ loading: false, runs, bugsAssigned, bugsReported });
    });
    return () => { cancelled = true; };
    // activeIdsKey stands for activeCycleIds (stable string instead of a new array each time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, project?.key, projectConfig?.testRunType, projectConfig?.defectType, activeIdsKey]);

  // ── Iniciativas en curso (v4.46.0): up to 4 initiatives with their phase status ──
  // One read of the initiatives plus one progress read per initiative (the server keeps both
  // for 60 s), only while Inicio is open.
  const [inits, setInits] = useState({ loading: true, rows: [] });
  useEffect(() => {
    if (!isActive || !selectedProjectId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await invoke('getLifecycle', { projectId: selectedProjectId });
        const list = (res?.initiatives || []).slice(0, 4);
        const rows = await Promise.all(list.map(async (i) => {
          const hasKeys = (i.epicKeys || []).length || (i.storyKeys || []).length || (i.planKeys || []).length;
          const progress = hasKeys
            ? await invoke('getLifecycleProgress', { projectId: selectedProjectId, epicKeys: i.epicKeys || [], storyKeys: i.storyKeys || [], planKeys: i.planKeys || [] }).catch(() => ({}))
            : {};
          return { id: i.id, name: i.name, phases: summarizeInitiative(i, progress || {}) };
        }));
        if (!cancelled) setInits({ loading: false, rows });
      } catch (_) {
        if (!cancelled) setInits({ loading: false, rows: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [isActive, selectedProjectId]);

  // Plan names, to show which release each cycle belongs to.
  const planById = useMemo(() => {
    const m = {};
    (testPlans || []).forEach(p => { m[String(p.id)] = p.summary || p.key; });
    return m;
  }, [testPlans]);
  const cycleById = useMemo(() => {
    const m = {};
    (testCycles || []).forEach(c => { m[String(c.id)] = c; });
    return m;
  }, [testCycles]);

  const now = new Date();
  const greeting = `${greetingFor(now)}${firstName ? `, ${firstName}` : ''}`;
  const t = summary.totals;
  const subtitle = summary.activeCount === 0
    ? 'No hay ciclos activos en este proyecto'
    : `${summary.activeCount} ${summary.activeCount === 1 ? 'ciclo activo' : 'ciclos activos'}`
      + (summary.lateCount > 0 ? ` · ${summary.lateCount} vencido${summary.lateCount === 1 ? '' : 's'}` : '')
      + (summary.riskCount > 0 ? ` · ${summary.riskCount} en riesgo` : '');

  const kpis = [
    {
      label: 'Avance de ejecución', value: `${summary.progressPct}%`,
      detail: `${t.executed.toLocaleString('es-MX')} de ${t.total.toLocaleString('es-MX')} casos con resultado`,
      tone: 'tp5-loz--info', state: summary.activeCount ? 'EN CURSO' : 'SIN CICLOS'
    },
    {
      label: 'Tasa de éxito', value: summary.passRatePct === null ? '—' : `${summary.passRatePct}%`,
      detail: summary.passRatePct === null ? 'Aún no hay casos ejecutados' : `${t.passed.toLocaleString('es-MX')} passed de ${t.executed.toLocaleString('es-MX')} ejecutados`,
      tone: summary.passRatePct === null ? 'tp5-loz--neutral' : (summary.passRatePct >= 95 ? 'tp5-loz--success' : 'tp5-loz--warning'),
      state: summary.passRatePct === null ? 'SIN DATOS' : (summary.passRatePct >= 95 ? 'EN META' : 'BAJO META')
    },
    {
      label: 'Casos fallidos', value: t.failed.toLocaleString('es-MX'),
      detail: 'En ciclos activos', tone: t.failed > 0 ? 'tp5-loz--danger' : 'tp5-loz--success', state: t.failed > 0 ? 'ATENCIÓN' : 'SIN FALLOS'
    },
    {
      label: 'Casos bloqueados', value: t.blocked.toLocaleString('es-MX'),
      detail: 'En ciclos activos', tone: t.blocked > 0 ? 'tp5-loz--warning' : 'tp5-loz--success', state: t.blocked > 0 ? 'REVISAR' : 'SIN BLOQUEOS'
    }
  ];

  const fmt = (n) => (todos.loading ? '…' : (n === null ? '—' : String(n)));
  const todoItems = [
    { count: fmt(todos.runs), title: 'Ejecuciones asignadas sin resultado', detail: 'En ciclos activos', tone: 'tp5-tile--info', go: () => onNavigate('execution') },
    { count: fmt(todos.bugsAssigned), title: 'Defectos asignados a mí', detail: 'Abiertos', tone: 'tp5-tile--danger', go: () => onNavigate('reports') },
    { count: fmt(todos.bugsReported), title: 'Defectos que reporté', detail: 'Abiertos · pendientes de corregir o verificar', tone: 'tp5-tile--warning', go: () => onNavigate('reports') }
  ];

  return (
    <div className="tp5-home">
      {/* ── Header with Liverpool brand gradient ── */}
      <section className="tp5-hero" aria-label="Encabezado de Inicio">
        <div className="tp5-hero__inner">
          <div className="tp5-hero__text">
            <img className="tp5-hero__logo" src={LIVERPOOL_LOGO_WHITE_B64} alt="El Puerto de Liverpool" />
            {project && <span className="tp5-hero__eyebrow">{project.name} · {project.key}</span>}
            <h1 className="tp5-hero__title">{greeting}</h1>
            <p className="tp5-hero__subtitle">{subtitle}</p>
          </div>
          <div className="tp5-hero__actions">
            <button type="button" className="tp5-btn tp5-btn--ghost-light" onClick={() => onNavigate('design')}>Ir al repositorio</button>
            <button type="button" className="tp5-btn tp5-btn--light" onClick={() => onNavigate('execution')}>Continuar ejecución</button>
          </div>
        </div>
      </section>

      <main className="tp5-page">
        {/* ── Indicators ── */}
        <section className="tp5-kpi-grid" aria-label="Indicadores de los ciclos activos">
          {kpis.map(k => (
            <div key={k.label} className="tp5-card tp5-kpi">
              <div className="tp5-kpi__head">
                <span className="tp5-kpi__label">{k.label}</span>
                <span className={`tp5-loz ${k.tone}`}>{k.state}</span>
              </div>
              <span className="tp5-kpi__value">{k.value}</span>
              <span className="tp5-kpi__detail">{k.detail}</span>
            </div>
          ))}
        </section>

        <div className="tp5-row">
          {/* ── Active cycles ── */}
          <section className="tp5-card tp5-section tp5-row__main" aria-label="Ciclos activos">
            <div className="tp5-section__head">
              <h2 className="tp5-h2">Ciclos activos</h2>
              <button type="button" className="tp5-link" onClick={() => onNavigate('planning')}>Ver planeación</button>
            </div>
            {summary.rows.length === 0 ? (
              <div className="tp5-empty">
                <strong>No hay ciclos activos</strong>
                <span>Crea un ciclo en Planeación y agrégale casos para verlo aquí.</span>
                <button type="button" className="tp5-btn tp5-btn--primary" onClick={() => onNavigate('planning')}>Ir a Planeación</button>
              </div>
            ) : summary.rows.slice(0, 8).map(r => {
              const c = cycleById[r.id];
              const planName = c?.planId ? planById[String(c.planId)] : null;
              const dates = r.startDate && r.endDate ? `${shortDate(r.startDate)} – ${shortDate(r.endDate)}` : 'Sin fechas';
              const aria = `${r.counts.passed} passed, ${r.counts.failed} failed, ${r.counts.blocked} blocked de ${r.counts.total}`;
              return (
                <button type="button" key={r.id} className="tp5-cycle-row" onClick={() => c && onOpenCycle(c)} title="Abrir en Ejecución">
                  <span className="tp5-cycle-row__name">
                    <span className="tp5-ellipsis tp5-strong">{r.name}</span>
                    <span className="tp5-mono tp5-subtle tp5-ellipsis">{r.key} · {dates}{planName ? ` · ${planName}` : ''}</span>
                  </span>
                  <span className="tp5-bar" role="img" aria-label={aria}>
                    <span style={{ width: `${r.bar.passed}%`, background: 'var(--tp5-success)' }} />
                    <span style={{ width: `${r.bar.failed}%`, background: 'var(--tp5-danger)' }} />
                    <span style={{ width: `${r.bar.blocked}%`, background: 'var(--tp5-warning)' }} />
                  </span>
                  <span className="tp5-cycle-row__pct">{r.health.pct}%</span>
                  <span className={`tp5-loz ${HEALTH_TONE[r.health.key]}`}>{r.health.label}</span>
                </button>
              );
            })}
            {summary.rows.length > 8 && (
              <span className="tp5-subtle tp5-small">y {summary.rows.length - 8} ciclos activos más en Planeación</span>
            )}
          </section>

          {/* ── My pending work ── */}
          <section className="tp5-card tp5-section tp5-row__side" aria-label="Mis pendientes">
            <div className="tp5-section__head"><h2 className="tp5-h2">Mis pendientes</h2></div>
            {todoItems.map(item => (
              <button type="button" key={item.title} className="tp5-todo" onClick={item.go}>
                <span className={`tp5-tile ${item.tone}`}>{item.count}</span>
                <span className="tp5-todo__text">
                  <span className="tp5-strong">{item.title}</span>
                  <span className="tp5-subtle tp5-small">{item.detail}</span>
                </span>
              </button>
            ))}
          </section>
        </div>

        {/* ── Iniciativas en curso ── */}
        <section className="tp5-card tp5-section" aria-label="Iniciativas">
          <div className="tp5-section__head">
            <h2 className="tp5-h2">Iniciativas en curso</h2>
            <button type="button" className="tp5-link" onClick={() => onNavigate('lifecycle')}>Ver ciclo de vida</button>
          </div>
          {inits.loading ? <span className="tp5-subtle tp5-small">Cargando iniciativas…</span> : inits.rows.length === 0 ? (
            <div className="tp5-empty"><strong>Aún no hay iniciativas</strong><span>Registra una en Ciclo de vida para seguir sus fases aquí.</span></div>
          ) : (
            <div className="tp5-inits">
              <div className="tp5-inits__row tp5-eyebrow"><span>Iniciativa</span>{PHASE_IDS.map(id => <span key={id}>{PHASE_NAMES[id]}</span>)}</div>
              {inits.rows.map(r => (
                <div key={r.id} className="tp5-inits__row">
                  <span className="tp5-strong tp5-ellipsis">{r.name}</span>
                  {r.phases.map(p => <span key={p.id} className={`tp5-initcell tp5-loz--${p.tone}`}>{p.label}</span>)}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

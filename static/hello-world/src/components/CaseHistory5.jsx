/**
 * CaseHistory5.jsx — "Historial de ejecuciones" tab of a test case (Test Pulse 5.0, v4.43.0).
 *
 * As in the approved board: four summary cards (executions, pass rate, last execution, linked
 * bugs), the result trend from oldest to newest, filters by plan and result, and a table with
 * date, cycle, plan, environment, tester, result, bugs, evidence and "Ver ejecución".
 *
 * Data: the history returned by `getTestCaseHistory` (already loaded by the panel). Plan and
 * environment come from the cycles/plans the app holds in memory, so nothing extra is fetched.
 */
import React, { useMemo, useState } from 'react';
import { normalizeUiStatus } from '../utils/constants';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
};
const TONE = { Passed: 'success', Failed: 'danger', Blocked: 'warning', 'In Progress': 'info', 'Not Run': 'neutral' };
const LABEL = { Passed: 'PASSED', Failed: 'FAILED', Blocked: 'BLOCKED', 'In Progress': 'EN CURSO', 'Not Run': 'SIN EJECUTAR' };
const TREND_COLOR = { Passed: '#1F845A', Failed: '#C9372C', Blocked: '#E2B203', 'In Progress': '#0C66E4', 'Not Run': '#DCDFE4' };
const nameOf = (u) => (u && typeof u === 'object' ? (u.displayName || '') : (u ? String(u) : ''));

export default function CaseHistory5({ history, cycles, plans, onOpenRun, onOpenBug }) {
  const [planFilter, setPlanFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState('ALL');

  // Enrich each execution with its plan and environment from the cycles in memory.
  const rows = useMemo(() => {
    const cycleById = new Map((cycles || []).map(c => [String(c.id), c]));
    const planById = new Map((plans || []).map(p => [String(p.id), p]));
    return (history || []).map(h => {
      const cycle = cycleById.get(String(h.cycleId));
      const plan = cycle?.planId ? planById.get(String(cycle.planId)) : null;
      return {
        ...h,
        st: normalizeUiStatus(h.status),
        planId: plan ? String(plan.id) : '',
        planName: plan ? (plan.summary || plan.key) : '—',
        env: cycle?.schedule?.environment || cycle?.environment || '—',
        tester: nameOf(h.executedBy) || '—',
        bugs: Array.isArray(h.bugs) ? h.bugs : []
      };
    });
  }, [history, cycles, plans]);

  const planOptions = useMemo(() => {
    const m = new Map();
    rows.forEach(r => { if (r.planId) m.set(r.planId, r.planName); });
    return [...m.entries()];
  }, [rows]);

  if (rows.length === 0) {
    return <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>Este caso aún no se ha ejecutado en ningún ciclo.</p>;
  }

  // Summary over every execution (filters only affect the table).
  const executed = rows.filter(r => r.st !== 'Not Run');
  const passed = executed.filter(r => r.st === 'Passed').length;
  const last = rows[0]; // the resolver returns newest first
  const allBugs = new Map();
  rows.forEach(r => r.bugs.forEach(b => allBugs.set(b.key, b)));
  const openBugs = [...allBugs.values()].filter(b => !b.done);
  const plansCount = new Set(rows.map(r => r.planId).filter(Boolean)).size;
  const trend = [...rows].reverse(); // oldest → newest

  const visible = rows.filter(r => (planFilter === 'ALL' || r.planId === planFilter) && (resultFilter === 'ALL' || r.st === resultFilter));

  return (
    <div className="tp5-hist">
      <div className="tp5-hist__cards">
        <div className="tp5-hist__card">
          <span className="tp5-kpi__label">Ejecuciones</span>
          <span className="tp5-hist__value">{rows.length}</span>
          <span className="tp5-kpi__detail">{plansCount ? `En ${plansCount} plan${plansCount === 1 ? '' : 'es'}` : 'Sin plan asociado'}</span>
        </div>
        <div className="tp5-hist__card">
          <span className="tp5-kpi__label">Tasa de éxito</span>
          <span className="tp5-hist__value">{executed.length ? `${Math.round((passed / executed.length) * 100)}%` : '—'}</span>
          <span className="tp5-kpi__detail">{passed} Passed de {executed.length}</span>
        </div>
        <div className="tp5-hist__card">
          <span className="tp5-kpi__label">Última ejecución</span>
          <span className={`tp5-hist__value tp5-tone-${TONE[last.st]}`}>{last.st === 'Not Run' ? 'Sin ejecutar' : last.st}</span>
          <span className="tp5-kpi__detail">{fmtDate(last.executedAt)}{last.tester !== '—' ? ` · ${last.tester}` : ''}</span>
        </div>
        <div className="tp5-hist__card">
          <span className="tp5-kpi__label">Bugs ligados</span>
          <span className={`tp5-hist__value${allBugs.size ? ' tp5-tone-danger' : ''}`}>{allBugs.size}</span>
          <span className="tp5-kpi__detail">{openBugs.length ? `${openBugs.length} abierto${openBugs.length === 1 ? '' : 's'} · ${openBugs.map(b => b.key).slice(0, 2).join(', ')}` : 'Ninguno abierto'}</span>
        </div>
      </div>

      <div className="tp5-hist__bar">
        <span className="tp5-eyebrow">Tendencia</span>
        <span className="tp5-hist__trend" role="img" aria-label={`Resultados del más antiguo al más reciente: ${trend.map(r => LABEL[r.st]).join(', ')}`}>
          {trend.map((r, i) => <span key={i} style={{ background: TREND_COLOR[r.st] }} title={`${fmtDate(r.executedAt)} · ${LABEL[r.st]}`} />)}
        </span>
        <span className="tp5-subtle tp5-small">del más antiguo al más reciente</span>
        <span className="tp5-hist__filters">
          <select className="tp5-select" aria-label="Filtrar por plan" value={planFilter} onChange={e => setPlanFilter(e.target.value)}>
            <option value="ALL">Todos los planes</option>
            {planOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className="tp5-select" aria-label="Filtrar por resultado" value={resultFilter} onChange={e => setResultFilter(e.target.value)}>
            <option value="ALL">Todos los resultados</option>
            {['Passed', 'Failed', 'Blocked', 'In Progress', 'Not Run'].map(s => <option key={s} value={s}>{s === 'Not Run' ? 'Sin ejecutar' : s === 'In Progress' ? 'En curso' : s}</option>)}
          </select>
        </span>
      </div>

      <div className="tp5-card tp5-table-wrap">
        <table className="tp5-table">
          <thead>
            <tr><th>Fecha</th><th>Ciclo</th><th>Plan</th><th>Ambiente</th><th>Tester</th><th>Resultado</th><th>Bugs</th><th>Evidencias</th><th><span className="tp5-sr-only">Acción</span></th></tr>
          </thead>
          <tbody>
            {visible.map((r, idx) => (
              <tr key={`${r.cycleId || idx}-${r.testRunKey || idx}`}>
                <td className="tp5-nowrap">{fmtDate(r.executedAt)}</td>
                <td><span className="tp5-strong">{r.cycleSummary || r.cycleKey}</span><br /><span className="tp5-mono tp5-subtle">{r.cycleKey}</span></td>
                <td className="tp5-subtle-2">{r.planName}</td>
                <td className="tp5-subtle-2">{r.env}</td>
                <td className="tp5-subtle-2 tp5-nowrap">{r.tester}</td>
                <td><span className={`tp5-loz tp5-loz--${TONE[r.st]}`}>{LABEL[r.st]}</span></td>
                <td>
                  {r.bugs.length === 0
                    ? <span className="tp5-subtle">—</span>
                    : r.bugs.map(b => <button key={b.key} type="button" className="tp5-link tp5-mono tp5-bugkey" onClick={() => onOpenBug(b.key)}>{b.key}</button>)}
                </td>
                <td className="tp5-subtle-2 tp5-nowrap">{r.evidenceCount ? `${r.evidenceCount} archivo${r.evidenceCount === 1 ? '' : 's'}` : '—'}</td>
                <td className="tp5-nowrap"><button type="button" className="tp5-link" onClick={() => onOpenRun(r)}>Ver ejecución</button></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={9} className="tp5-subtle">Ninguna ejecución coincide con los filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

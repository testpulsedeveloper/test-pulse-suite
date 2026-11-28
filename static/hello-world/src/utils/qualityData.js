/**
 * qualityData.js — figures of Calidad in Test Pulse 5.0 (v4.45.0): tabs Ejecuciones, Defectos
 * and KPIs, as in the approved boards.
 *
 * Inputs are what Calidad already loads (the selected cycles with their executions, the bugs of
 * those cycles, the plan schedule and the environment downtime), so nothing here calls Jira.
 * When a figure can't be derived from that data the result says so (null / 'Sin datos')
 * instead of inventing a number. Kept free of React for `node --test`.
 */
import { normalizeUiStatus } from './constants.js';
import { parseDay, workingDaysBetween, addWorkingDays, shortDay } from './cycleHealthIndicators.js';
import { evaluateGoNoGo, isCriticalOrHigh } from './goNoGo.js';

const DAY = 86400000;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const FINAL = new Set(['Passed', 'Failed', 'Blocked']);

/** Flattens the executions of the selected cycles: one entry per case and cycle. */
export const flattenExecutions = (cycles) => {
  const out = [];
  (Array.isArray(cycles) ? cycles : []).forEach(c => (Array.isArray(c?.execution) ? c.execution : []).forEach(ex => {
    out.push({ ...ex, cycleId: c.id, cycleName: c.summary || c.key, st: normalizeUiStatus(ex?.status) });
  }));
  return out;
};

const holidaySet = (h) => new Set((Array.isArray(h) ? h : []).map(x => (typeof x === 'string' ? x : x?.date)).filter(Boolean));

/**
 * "Avance real vs. línea ideal" and "Ritmo y proyección".
 * @param {Array} execs from flattenExecutions
 * @param {object} schedule { startDate, endDate, holidays, excludeWeekends }
 */
export const progressSeries = (execs, schedule, now = new Date()) => {
  const total = execs.length;
  const executed = execs.filter(e => FINAL.has(e.st)).length;
  const start = parseDay(schedule?.startDate); const end = parseDay(schedule?.endDate);
  const out = { total, executed, donePct: pct(executed, total) ?? 0, hasDates: Boolean(start && end && end >= start) };
  if (!out.hasDates) return out;
  const hol = holidaySet(schedule?.holidays); const exW = schedule?.excludeWeekends !== false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = workingDaysBetween(start, end, hol, exW);
  const elapsed = today < start ? 0 : workingDaysBetween(start, today < end ? today : end, hol, exW);
  out.days = days; out.elapsed = elapsed; out.remaining = Math.max(0, days - elapsed);
  out.idealPct = days ? Math.round((elapsed / days) * 100) : 0;
  out.goal = days ? Math.ceil(total / days) : 0;
  out.real = elapsed ? Math.round(executed / elapsed) : 0;
  out.slackDays = days ? Math.round(((executed / Math.max(1, total)) - (elapsed / days)) * days * 10) / 10 : 0;
  const finish = total && executed >= total ? today : (out.real > 0 ? addWorkingDays(today, (total - executed) / (executed / elapsed), hol, exW) : null);
  out.finish = finish ? shortDay(finish) : null;
  out.finishLate = Boolean(finish && finish > end);
  out.startLabel = shortDay(start); out.endLabel = shortDay(end); out.todayLabel = shortDay(today);
  // Real line: cumulative % per day from the executions' dates (when they carry one).
  const dated = execs.filter(e => FINAL.has(e.st) && e.executedAt).map(e => new Date(e.executedAt)).filter(d => !Number.isNaN(d.getTime()));
  const span = Math.max(1, Math.round((end - start) / DAY));
  const points = [];
  if (dated.length) {
    const byDay = new Map();
    dated.forEach(d => { const k = iso(d); byDay.set(k, (byDay.get(k) || 0) + 1); });
    let acc = executed - dated.length; // executions without a date count from the start
    for (let d = new Date(start); d <= (today < end ? today : end); d = new Date(d.getTime() + DAY)) {
      acc += byDay.get(iso(d)) || 0;
      points.push({ x: Math.round((d - start) / DAY) / span, y: total ? acc / total : 0 });
    }
  } else if (elapsed) {
    points.push({ x: 0, y: 0 }, { x: Math.min(1, (today - start) / DAY / span), y: total ? executed / total : 0 });
  }
  out.points = points;
  out.todayX = Math.min(1, Math.max(0, (today - start) / DAY / span));
  out.finishX = finish ? Math.min(1.15, (finish - start) / DAY / span) : null;
  out.datedDaily = dated.length > 0;
  return out;
};

/** "Cobertura por riesgo": executed share per priority, critical first. */
export const riskCoverage = (execs, priorityOf) => {
  const order = [['Crítica', /(crít|critic|highest|bloq|blocker|urgent)/i], ['Alta', /(alt|high)/i], ['Media', /(med|medium)/i], ['Baja', /(baj|low|lowest)/i]];
  const rows = order.map(([label]) => ({ label, total: 0, done: 0 }));
  execs.forEach(e => {
    const p = String(priorityOf(e) || '');
    const idx = order.findIndex(([, rx]) => rx.test(p));
    const row = rows[idx >= 0 ? idx : 2];
    row.total++; if (FINAL.has(e.st)) row.done++;
  });
  return rows.filter(r => r.total > 0).map(r => ({ ...r, pct: pct(r.done, r.total) }));
};

/** "Impedimentos y retrabajo". */
export const impediments = (execs) => {
  const blocked = execs.filter(e => e.st === 'Blocked').length;
  const executed = execs.filter(e => FINAL.has(e.st));
  const reruns = executed.filter(e => (Array.isArray(e.iterations) ? e.iterations.length : 0) > 1).length;
  return { blocked, blockedPct: execs.length ? Math.round((blocked / execs.length) * 1000) / 10 : 0, rerunPct: pct(reruns, executed.length) };
};

/** "Automatización": coverage, pass rate of the last run, unstable (flaky) cases. */
export const automation = (execs, isAuto) => {
  const auto = execs.filter(isAuto);
  const ran = auto.filter(e => FINAL.has(e.st));
  const flaky = auto.map(e => {
    const seq = (Array.isArray(e.iterations) ? e.iterations : []).map(i => normalizeUiStatus(i?.status)).filter(s => s === 'Passed' || s === 'Failed').slice(-6);
    const flips = seq.slice(1).filter((s, i) => s !== seq[i]).length;
    return { e, seq, flips };
  }).filter(x => x.flips >= 2).sort((a, b) => b.flips - a.flips);
  return {
    total: auto.length, coveragePct: pct(auto.length, execs.length), passPct: pct(ran.filter(e => e.st === 'Passed').length, ran.length),
    flaky: flaky.slice(0, 5).map(x => ({ key: x.e.key || x.e.testCaseKey, summary: x.e.summary, seq: x.seq })), flakyCount: flaky.length
  };
};

/** Stacked bars of "Avance por ciclo". */
export const perCycle = (cycles) => (Array.isArray(cycles) ? cycles : []).map(c => {
  const ex = (Array.isArray(c?.execution) ? c.execution : []).map(e => normalizeUiStatus(e?.status));
  const t = ex.length || 1;
  const n = (s) => ex.filter(x => x === s).length;
  return { id: c.id, name: c.summary || c.key, passed: (n('Passed') / t) * 100, failed: (n('Failed') / t) * 100, blocked: (n('Blocked') / t) * 100, pct: ex.length ? Math.round(((n('Passed') + n('Failed') + n('Blocked')) / ex.length) * 100) : 0 };
});

// ── Defects ─────────────────────────────────────────────────────────────────────────────
const REJECTED_RX = /(duplica|no es (un )?bug|not a bug|won'?t|no se har|rechaz|invalid|cannot reproduce|no reproducible)/i;
const FIXED_RX = /(ready for qa|listo para (qa|probar|pruebas)|retest|corregid|fixed|resuelt|resolved|en verificaci)/i;

/** Cards, arrivals vs. closures and the open-defects table. */
export const defectMetrics = ({ bugs, totalCases, slaHoursOf, hoursOf, now = new Date() }) => {
  const list = Array.isArray(bugs) ? bugs : [];
  const open = list.filter(b => !b.isDone);
  const closed = list.filter(b => b.isDone);
  const critOpen = open.filter(b => /(crít|critic|blocker|bloque|highest)/i.test(String(b.severity))).length;
  const highOpen = open.filter(b => isCriticalOrHigh(b)).length - critOpen;
  const rejected = list.filter(b => REJECTED_RX.test(String(b.resolution || '')));
  const reopened = closed.filter(b => b.isReopened || (b.reopenCount || 0) > 0).length;
  const retests = open.filter(b => FIXED_RX.test(String(b.status || ''))).length;
  // Arrivals vs closures: cumulative created and resolved per day.
  const dates = list.map(b => b.created).filter(Boolean).map(d => new Date(d)).filter(d => !Number.isNaN(d.getTime())).sort((a, b) => a - b);
  let series = null;
  if (dates.length) {
    const first = new Date(dates[0].getFullYear(), dates[0].getMonth(), dates[0].getDate());
    const last = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const span = Math.max(1, Math.round((last - first) / DAY));
    const step = Math.max(1, Math.ceil(span / 40));
    const pts = [];
    for (let t = first.getTime(); t <= last.getTime() + 1; t += step * DAY) {
      const lim = t + DAY;
      pts.push({ x: (t - first.getTime()) / DAY / span, opened: list.filter(b => b.created && new Date(b.created).getTime() < lim).length, closed: list.filter(b => b.resolutiondate && new Date(b.resolutiondate).getTime() < lim).length });
    }
    const recent = pts.slice(-5);
    const gapGrowing = recent.length > 1 && (recent[recent.length - 1].opened - recent[recent.length - 1].closed) > (recent[0].opened - recent[0].closed);
    series = { pts, max: Math.max(1, list.length), startLabel: shortDay(first), endLabel: shortDay(last), stabilizing: !gapGrowing };
  }
  const openRows = open.map(b => {
    const ageDays = b.created ? Math.max(0, Math.floor((now - new Date(b.created)) / DAY)) : null;
    const sla = slaHoursOf ? slaHoursOf(b) : null;
    const h = hoursOf ? hoursOf(b) : null;
    return { ...b, ageDays, slaState: sla == null || h == null ? 'none' : (h > sla ? 'late' : 'ok'), affected: b.affectedCount ?? (b.affectedCases ? b.affectedCases.size : 0) };
  }).sort((a, b) => (Number(isCriticalOrHigh(b)) - Number(isCriticalOrHigh(a))) || ((b.ageDays || 0) - (a.ageDays || 0)));
  return {
    open: open.length, critOpen, highOpen: Math.max(0, highOpen), total: list.length, closed: closed.length,
    reopenPct: pct(reopened, closed.length), reopened,
    rejectedPct: pct(rejected.length, list.length), rejected: rejected.length,
    density: totalCases ? Math.round((list.length / totalCases) * 1000) / 10 : null,
    retests, series, openRows
  };
};

// ── KPI catalogue (same ids as the KPI document) ───────────────────────────────────────
export const KPI_CATALOG = [
  { group: 'Calidad y Eficiencia', id: 'CE-1', name: 'Efectividad Shift-Left', goal: '≥ 30 %', owner: 'Líder de QA', freq: 'Por iniciativa' },
  { group: 'Calidad y Eficiencia', id: 'CE-2', name: 'Madurez de documentos', goal: '≥ 80 %', owner: 'Product Owner', freq: 'Por iniciativa' },
  { group: 'Calidad y Eficiencia', id: 'CE-3', name: 'Cobertura de requerimientos', goal: '100 %', owner: 'Líder de QA', freq: 'Semanal' },
  { group: 'Calidad y Eficiencia', id: 'CE-4', name: 'Efectividad a la primera', goal: '≥ 85 %', owner: 'Líder de Desarrollo', freq: 'Semanal' },
  { group: 'Calidad y Eficiencia', id: 'CE-5', name: 'Densidad de defectos', goal: 'A la baja', owner: 'Líder de Desarrollo', freq: 'Por liberación' },
  { group: 'Calidad y Eficiencia', id: 'CE-6', name: 'Índice de automatización', goal: '+10 pp / trim.', owner: 'Líder de QA', freq: 'Trimestral' },
  { group: 'Cumplimiento', id: 'CU-1', name: 'Avance de ejecución vs plan', goal: '≥ 90 % sin retraso', owner: 'Líder de QA', freq: 'Semanal' },
  { group: 'Cumplimiento', id: 'CU-2', name: 'Tasa de casos bloqueados', goal: '< 10 %', owner: 'Líder de QA', freq: 'Diaria' },
  { group: 'Cumplimiento', id: 'CU-3', name: 'Cumplimiento de SLA de corrección', goal: '≥ 90 %', owner: 'Líder de Desarrollo', freq: 'Semanal' },
  { group: 'Cumplimiento', id: 'CU-4', name: 'Cumplimiento del Test Plan', goal: '100 %', owner: 'Líder de QA', freq: 'Por iniciativa' },
  { group: 'Cumplimiento', id: 'CU-5', name: 'Hallazgos Shift-Left atendidos', goal: '100 % Crít./Alto', owner: 'Product Owner', freq: 'Semanal' },
  { group: 'Cumplimiento', id: 'CU-6', name: 'Criterio de salida (Go/No-Go)', goal: '100 % liberaciones', owner: 'Release Manager', freq: 'Por liberación' },
  { group: 'Satisfacción al cliente', id: 'SC-1', name: 'Efectividad de detección (DDP)', goal: '≥ 95 %', owner: 'Líder de QA', freq: 'Por liberación' },
  { group: 'Satisfacción al cliente', id: 'SC-2', name: 'Incidentes post-liberación', goal: '0 críticos', owner: 'Líder de Operación', freq: '30 días' },
  { group: 'Satisfacción al cliente', id: 'SC-3', name: 'Tasa de reapertura de bugs', goal: '≤ 5 %', owner: 'Líder de Desarrollo', freq: 'Semanal' },
  { group: 'Satisfacción al cliente', id: 'SC-4', name: 'Aceptación de UAT a la primera', goal: '≥ 90 %', owner: 'Product Owner', freq: 'Al cerrar UAT' },
  { group: 'Satisfacción al cliente', id: 'SC-5', name: 'Satisfacción de stakeholders', goal: '≥ 4 de 5', owner: 'Gerente de Proyecto', freq: 'Por liberación' }
];
export const KPI_DEFAULTS = ['CE-1', 'CE-4', 'CE-6', 'CU-1', 'CU-3', 'CU-6', 'SC-2', 'SC-3'];

/**
 * Current value and state of each KPI from the figures Calidad has. KPIs that need data Test
 * Pulse doesn't hold (stakeholder survey, post-release incidents…) are 'none' with a reason.
 * @returns {Object<string, { value: string, s: 'ok'|'warn'|'bad'|'none' }>}
 */
export const kpiValues = ({ fpy, slaPct, blockedPct, progress, defects, autoPct, goNoGo, reqCoveragePct }) => {
  const st = (ok, warn) => (ok ? 'ok' : (warn ? 'warn' : 'bad'));
  const none = (value) => ({ value, s: 'none' });
  return {
    'CE-1': none('Se mide en Ciclo de vida'),
    'CE-2': none('Se mide en Ciclo de vida'),
    'CE-3': reqCoveragePct == null ? none('Sin requerimientos') : { value: `${reqCoveragePct} %`, s: st(reqCoveragePct >= 100, reqCoveragePct >= 90) },
    'CE-4': fpy == null ? none('Sin casos ejecutados') : { value: `${fpy} %`, s: st(fpy >= 85, fpy >= 70) },
    'CE-5': defects?.density == null ? none('Sin casos') : { value: `${defects.density} / 100 casos`, s: 'warn' },
    'CE-6': autoPct == null ? none('Sin casos') : { value: `${autoPct} %`, s: st(autoPct >= 40, autoPct >= 20) },
    'CU-1': !progress?.hasDates ? none('El plan no tiene fechas') : { value: `${progress.donePct} % (ideal ${progress.idealPct} %)`, s: st(progress.slackDays >= 0, progress.slackDays >= -2) },
    'CU-2': { value: `${blockedPct} %`, s: st(blockedPct < 5, blockedPct < 10) },
    'CU-3': slaPct == null ? none('Sin defectos cerrados') : { value: `${slaPct} %`, s: st(slaPct >= 90, slaPct >= 80) },
    'CU-4': none('Se mide en Ciclo de vida'),
    'CU-5': none('Se mide en Ciclo de vida'),
    'CU-6': goNoGo.verdict === 'empty' ? none('Sin casos') : { value: `${goNoGo.met} de ${goNoGo.total} criterios`, s: goNoGo.verdict === 'go' ? 'ok' : (goNoGo.verdict === 'go-exception' ? 'warn' : 'bad') },
    'SC-1': none('Requiere configuración'),
    'SC-2': none('Se registra al liberar'),
    'SC-3': defects?.reopenPct == null ? none('Sin defectos cerrados') : { value: `${defects.reopenPct} %`, s: st(defects.reopenPct <= 5, defects.reopenPct <= 10) },
    'SC-4': none('Se registra al cerrar UAT'),
    'SC-5': none('Encuesta por liberación')
  };
};

/** Go / No-Go of the plan with the "critical cases executed" criterion of the KPI board. */
export const planGoNoGo = ({ execs, bugs, priorityOf }) => {
  const crit = execs.filter(e => /(crít|critic|highest|blocker|bloq)/i.test(String(priorityOf(e) || '')));
  const critDone = crit.filter(e => FINAL.has(e.st)).length;
  const c = { passed: 0, failed: 0, blocked: 0, notRun: 0 };
  execs.forEach(e => { if (e.st === 'Passed') c.passed++; else if (e.st === 'Failed') c.failed++; else if (e.st === 'Blocked') c.blocked++; else c.notRun++; });
  const base = evaluateGoNoGo({ ...c, bugs });
  const critCriterion = { id: 'critical', label: 'Casos críticos ejecutados al 100 %', detail: crit.length ? `${critDone} de ${crit.length}` : 'Sin casos de prioridad crítica', ok: crit.length === 0 || critDone === crit.length };
  const criteria = [critCriterion, ...base.criteria.filter(x => x.id !== 'executed' && x.id !== 'blocked')];
  const met = criteria.filter(x => x.ok).length;
  return { ...base, criteria, met, total: criteria.length, verdict: execs.length === 0 ? 'empty' : (met === criteria.length ? 'go' : (criteria.find(x => x.id === 'bugs')?.ok && critCriterion.ok ? 'go-exception' : 'no-go')) };
};

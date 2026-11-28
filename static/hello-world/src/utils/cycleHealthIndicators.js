/**
 * cycleHealthIndicators.js — "Salud del ciclo" in Planeación (Test Pulse 5.0, v4.42.0).
 *
 * Eight indicators that say whether a cycle will finish on time. Everything is computed from
 * data the app already holds for the selected cycle (its cases with their status and linked
 * bugs, and the cycle's schedule) plus the environment downtime reports, so the card adds no
 * Jira calls. Kept free of React so it can be unit tested with `node --test`.
 *
 * Working days exclude Saturdays, Sundays and the cycle's holidays (schedule.holidays, as
 * 'YYYY-MM-DD' strings or { date }), matching how Planeación counts "días hábiles".
 */
import { normalizeUiStatus } from './constants.js';

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** Set of holiday dates ('YYYY-MM-DD') from the schedule, whatever shape they were saved in. */
const holidaySet = (schedule) => new Set((Array.isArray(schedule?.holidays) ? schedule.holidays : [])
  .map(h => (typeof h === 'string' ? h : h?.date)).filter(Boolean).map(h => String(h).slice(0, 10)));

/** Working days in [from, to], both inclusive. */
export const workingDaysBetween = (from, to, holidays = new Set()) => {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + DAY)) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(iso(d))) n++;
  }
  return n;
};

/** Adds `n` working days after `from` and returns that date. */
export const addWorkingDays = (from, n, holidays = new Set()) => {
  let d = new Date(from); let left = Math.max(0, Math.ceil(n));
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(iso(d))) left--;
  }
  return d;
};

// Bug helpers. Linked bugs carry Jira fields in slightly different shapes across versions.
const bugStatus = (b) => String(b?.status?.name || b?.status || b?.fields?.status?.name || '').toLowerCase();
const bugPriority = (b) => String(b?.priority?.name || b?.priority || b?.severity || b?.fields?.priority?.name || '').toLowerCase();
const DONE_RX = /(done|closed|cerrad|finaliz|resuelt|resolved|listo|hecho|termin)/;
const FIXED_RX = /(ready for qa|listo para (qa|pruebas)|para retest|retest|corregid|fixed|resuelt|resolved|en verificaci)/;
const BLOCKER_RX = /(blocker|bloqueante|highest|crític|critic|urgent|muy alta)/;

/**
 * Computes the eight indicators.
 * @param {object} p
 * @param {Array}  p.tests     cases of the cycle (status, linkedBugs)
 * @param {object} p.schedule  { startDate, endDate, holidays, environment }
 * @param {Array}  [p.downtime] environment downtime events of the project
 * @param {Array}  [p.environments] catalog, to match the cycle's environment name to its id
 * @param {Date}   [p.now]
 */
export const computeCycleHealth = ({ tests, schedule, downtime = [], environments = [], now = new Date() }) => {
  const list = Array.isArray(tests) ? tests : [];
  const total = list.length;
  const st = list.map(t => normalizeUiStatus(t?.status));
  const passed = st.filter(s => s === 'Passed').length;
  const failed = st.filter(s => s === 'Failed').length;
  const blocked = st.filter(s => s === 'Blocked').length;
  const executed = passed + failed + blocked;
  const pct = total ? Math.round((executed / total) * 100) : 0;

  const start = parse(schedule?.startDate);
  const end = parse(schedule?.endDate);
  const hol = holidaySet(schedule);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hasDates = Boolean(start && end && end >= start);
  const totalDays = hasDates ? workingDaysBetween(start, end, hol) : 0;
  const elapsedDays = hasDates ? (today < start ? 0 : workingDaysBetween(start, today < end ? today : end, hol)) : 0;
  const remainingDays = hasDates ? Math.max(0, totalDays - elapsedDays) : 0;

  // 1. Progress vs the ideal straight line.
  const idealPct = hasDates && totalDays > 0 ? Math.round((elapsedDays / totalDays) * 100) : null;
  const gap = idealPct === null ? null : pct - idealPct;
  // 2-3. Pace and projection.
  const pace = elapsedDays > 0 ? executed / elapsedDays : null;
  const neededPace = remainingDays > 0 ? (total - executed) / remainingDays : null;
  let projection = null;
  if (total > 0 && executed >= total) projection = { done: true };
  else if (pace && pace > 0) {
    const finish = addWorkingDays(today, (total - executed) / pace, hol);
    projection = { date: iso(finish), late: hasDates ? finish > end : false };
  }
  // 6-7. Bugs.
  const bugs = new Map();
  list.forEach(t => (Array.isArray(t?.linkedBugs) ? t.linkedBugs : []).forEach(b => { if (b?.key) bugs.set(b.key, b); }));
  const bugList = [...bugs.values()];
  const bugsHaveStatus = bugList.some(b => bugStatus(b));
  const blockerBugs = bugList.filter(b => !DONE_RX.test(bugStatus(b)) && BLOCKER_RX.test(bugPriority(b))).length;
  // A retest is pending when a failed case has a bug development already fixed.
  const retests = list.filter((t, i) => st[i] === 'Failed'
    && (Array.isArray(t?.linkedBugs) ? t.linkedBugs : []).some(b => FIXED_RX.test(bugStatus(b)))).length;
  // 8. Environment downtime inside the cycle window.
  const envName = schedule?.environment || '';
  const env = (environments || []).find(e => e?.name === envName);
  let downHours = null;
  if (hasDates && env) {
    const from = start.getTime(); const to = Math.min(new Date(end.getTime() + DAY).getTime(), now.getTime());
    let ms = 0;
    (downtime || []).filter(e => e?.envId === env.id).forEach(e => {
      const s = Math.max(new Date(e.startedAt).getTime(), from);
      const f = Math.min(e.endedAt ? new Date(e.endedAt).getTime() : now.getTime(), to);
      if (f > s) ms += f - s;
    });
    downHours = Math.round((ms / 3600000) * 10) / 10;
  }

  const tone = (good, warn) => (good ? 'success' : (warn ? 'warning' : 'danger'));
  return [
    {
      id: 'ideal', label: 'Avance vs. línea ideal',
      value: idealPct === null ? '—' : `${pct}% / ${idealPct}%`,
      detail: total === 0 ? 'El ciclo aún no tiene casos' : idealPct === null ? 'Define las fechas del ciclo' : (gap >= 0 ? `Adelantado ${gap} pts` : `Atrasado ${-gap} pts`),
      tone: idealPct === null || total === 0 ? 'neutral' : tone(gap >= -5, gap >= -15)
    },
    {
      id: 'projection', label: 'Proyección de término',
      value: projection?.done ? 'Completo' : (projection?.date ? projection.date.split('-').reverse().slice(0, 2).join('/') : '—'),
      detail: projection?.done ? 'Todos los casos tienen resultado' : (projection?.date ? (projection.late ? 'Después de la fecha de cierre' : 'Dentro de la fecha de cierre') : 'Aún no hay ritmo para proyectar'),
      tone: projection?.done ? 'success' : (projection?.date ? (projection.late ? 'danger' : 'success') : 'neutral')
    },
    {
      id: 'pace', label: 'Ritmo diario',
      value: pace === null ? '—' : `${Math.round(pace * 10) / 10}/día`,
      detail: neededPace === null ? 'Sin días hábiles restantes' : `Se necesitan ${Math.ceil(neededPace)}/día`,
      tone: total === 0 || pace === null || neededPace === null ? 'neutral' : tone(pace >= neededPace, pace >= neededPace * 0.8)
    },
    {
      id: 'passrate', label: 'Tasa de éxito',
      value: executed ? `${Math.round((passed / executed) * 100)}%` : '—',
      detail: executed ? `${passed} passed de ${executed} ejecutados` : 'Sin ejecuciones aún',
      tone: executed ? tone(passed / executed >= 0.95, passed / executed >= 0.85) : 'neutral'
    },
    {
      id: 'blocked', label: 'Bloqueados', value: String(blocked),
      detail: total ? `${Math.round((blocked / total) * 100)}% de los casos` : 'Sin casos',
      tone: total ? tone(blocked / total < 0.05, blocked / total < 0.1) : 'neutral'
    },
    {
      id: 'blockers', label: 'Bugs bloqueantes', value: bugsHaveStatus ? String(blockerBugs) : '—',
      detail: bugsHaveStatus ? 'Abiertos, prioridad bloqueante o crítica' : 'Sin defectos vinculados',
      tone: bugsHaveStatus ? (blockerBugs ? 'danger' : 'success') : 'neutral'
    },
    {
      id: 'retests', label: 'Retests pendientes', value: bugsHaveStatus ? String(retests) : '—',
      detail: 'Casos fallidos con su bug ya corregido',
      tone: bugsHaveStatus ? (retests ? 'warning' : 'success') : 'neutral'
    },
    {
      id: 'downtime', label: 'Disponibilidad del ambiente',
      value: downHours === null ? '—' : (downHours === 0 ? 'Sin caídas' : `${downHours} h caído`),
      detail: downHours === null ? (envName ? 'Ambiente fuera del catálogo' : 'El ciclo no tiene ambiente') : `${envName} durante el ciclo`,
      tone: downHours === null ? 'neutral' : (downHours === 0 ? 'success' : (downHours < 8 ? 'warning' : 'danger'))
    }
  ];
};

/**
 * cycleHealthIndicators.js — "Salud del ciclo" in Planeación (Test Pulse 5.0, v4.43.0).
 *
 * The eight indicators of the approved design, plus the cycle traffic light ("holgura"):
 *   Término proyectado · Días perdidos por bloqueos · Disponibilidad del ambiente ·
 *   Retests pendientes · Cambios de alcance · Preparación Go / No-Go · Carga por tester ·
 *   Tendencia de defectos.
 *
 * Everything is computed from data the app already holds for the selected cycle (its cases
 * with status, tester and linked bugs, the cycle and plan schedules) plus the environment
 * downtime reports, so the card adds no Jira calls. When a figure can't be known from that
 * data the indicator says so ("Sin datos") instead of inventing a number.
 *
 * Working days exclude weekends (when the schedule says so) and holidays ({ date } or
 * 'YYYY-MM-DD'), exactly like Planeación's "días hábiles". Kept free of React for `node --test`.
 */
import { normalizeUiStatus } from './constants.js';
import { evaluateGoNoGo } from './goNoGo.js';

const DAY = 86400000;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
/** "3 dic" */
export const shortDay = (d) => (d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : '—');

export const DEFAULT_SEMAFORO = { riskDays: 2, onTimeFailPct: 10, riskFailPct: 20 };

const holidaySet = (holidays) => new Set((Array.isArray(holidays) ? holidays : [])
  .map(h => (typeof h === 'string' ? h : h?.date)).filter(Boolean).map(h => String(h).slice(0, 10)));

const isWorkingDay = (d, hol, excludeWeekends) => {
  const wd = d.getDay();
  return !(excludeWeekends && (wd === 0 || wd === 6)) && !hol.has(iso(d));
};

/** Working days in [from, to], both inclusive. */
export const workingDaysBetween = (from, to, holidays = new Set(), excludeWeekends = true) => {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + DAY)) if (isWorkingDay(d, holidays, excludeWeekends)) n++;
  return n;
};

/** The date `n` working days after `from`. */
export const addWorkingDays = (from, n, holidays = new Set(), excludeWeekends = true) => {
  let d = new Date(from); let left = Math.max(0, Math.ceil(n));
  while (left > 0) { d = new Date(d.getTime() + DAY); if (isWorkingDay(d, holidays, excludeWeekends)) left--; }
  return d;
};

// Bug helpers. Linked bugs carry Jira fields in slightly different shapes across versions.
const bugStatus = (b) => String(b?.status?.name || b?.status || b?.fields?.status?.name || '').toLowerCase();
const bugPriority = (b) => String(b?.priority?.name || b?.priority || b?.severity || b?.fields?.priority?.name || '').toLowerCase();
const DONE_RX = /(done|closed|cerrad|finaliz|resuelt|resolved|listo|hecho|termin)/;
const FIXED_RX = /(ready for qa|listo para (qa|pruebas)|para retest|retest|corregid|fixed|resuelt|resolved|en verificaci)/;
const BLOCKER_RX = /(blocker|bloqueante|highest|crític|critic|urgent|muy alta)/;
const nameOf = (u) => (u && typeof u === 'object' ? (u.displayName || u.name || '') : (u ? String(u) : ''));
const firstNameInitial = (full) => {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : (parts[0] || '');
};

/**
 * Cycle traffic light: holgura = (% executed − % of working time elapsed) × working days.
 * @returns {{ key: 'ok'|'risk'|'late'|'none', label: string, slack: number|null }}
 */
export const cycleSemaforo = ({ total, executed, failed, totalDays, elapsedDays, semaforo = DEFAULT_SEMAFORO }) => {
  if (!total || !totalDays) return { key: 'none', label: 'SIN DATOS', slack: null };
  const slack = Math.round(((executed / total) - (elapsedDays / totalDays)) * totalDays * 10) / 10;
  const failPct = executed ? (failed / executed) * 100 : 0;
  const s = { ...DEFAULT_SEMAFORO, ...(semaforo || {}) };
  const sign = slack >= 0 ? '+' : '−';
  const txt = `${sign}${Math.abs(slack)} d`;
  if (slack >= 0 && failPct < s.onTimeFailPct) return { key: 'ok', label: `A TIEMPO · ${txt}`, slack };
  if (slack >= -s.riskDays && failPct < s.riskFailPct) return { key: 'risk', label: `EN RIESGO · ${txt}`, slack };
  return { key: 'late', label: `ATRASADO · ${txt}`, slack };
};

/**
 * Computes the schedule figures and the eight indicators.
 * @param {object} p
 * @param {Array}  p.tests      cases of the cycle (status, assignee/executedBy, linkedBugs)
 * @param {object} p.schedule   cycle schedule { startDate, endDate, holidays, excludeWeekends, environment, semaforo }
 * @param {object} [p.planSchedule] plan schedule { codeFreezeDate, goLiveDate }
 * @param {Array}  [p.downtime] environment downtime events of the project
 * @param {Array}  [p.environments] catalog, to match the cycle's environment name to its id
 * @param {Date}   [p.now]
 */
export const computeCycleHealth = ({ tests, schedule, planSchedule = {}, downtime = [], environments = [], now = new Date() }) => {
  const list = Array.isArray(tests) ? tests : [];
  const total = list.length;
  const st = list.map(t => normalizeUiStatus(t?.status));
  const passed = st.filter(s => s === 'Passed').length;
  const failed = st.filter(s => s === 'Failed').length;
  const blocked = st.filter(s => s === 'Blocked').length;
  const executed = passed + failed + blocked;

  const start = parseDay(schedule?.startDate);
  const end = parseDay(schedule?.endDate);
  const excludeWeekends = schedule?.excludeWeekends !== false;
  const hol = holidaySet(schedule?.holidays);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hasDates = Boolean(start && end && end >= start);
  const totalDays = hasDates ? workingDaysBetween(start, end, hol, excludeWeekends) : 0;
  const elapsedDays = hasDates ? (today < start ? 0 : workingDaysBetween(start, today < end ? today : end, hol, excludeWeekends)) : 0;
  const pace = elapsedDays > 0 ? executed / elapsedDays : null;
  const plannedPace = totalDays > 0 ? total / totalDays : null;
  const semaforo = cycleSemaforo({ total, executed, failed, totalDays, elapsedDays, semaforo: schedule?.semaforo });

  // 1. Término proyectado.
  let term;
  if (total > 0 && executed >= total) term = { value: 'Completo', detail: 'Todos los casos tienen resultado', tone: 'success' };
  else if (pace && pace > 0) {
    const finish = addWorkingDays(today, (total - executed) / pace, hol, excludeWeekends);
    const late = hasDates && finish > end;
    term = { value: shortDay(finish), detail: `Planeado ${hasDates ? shortDay(end) : 'sin fecha'} · al ritmo actual de ${Math.round(pace * 10) / 10} casos/día`, tone: late ? 'warning' : 'success' };
    if (late && end && (finish - end) / DAY > 3) term.tone = 'danger';
  } else term = { value: '—', detail: total ? 'Aún no hay ritmo para proyectar' : 'El ciclo aún no tiene casos', tone: 'neutral' };

  // Bugs linked to the cycle's cases, without repeats.
  const bugs = new Map();
  list.forEach(t => (Array.isArray(t?.linkedBugs) ? t.linkedBugs : []).forEach(b => { if (b?.key) bugs.set(b.key, b); }));
  const bugList = [...bugs.values()];
  const bugsHaveStatus = bugList.some(b => bugStatus(b));
  const openBlockers = bugList.filter(b => !DONE_RX.test(bugStatus(b)) && BLOCKER_RX.test(bugPriority(b)));

  // 2. Días perdidos por bloqueos: blocked cases expressed in days of the planned pace.
  const blockedDays = blocked && plannedPace ? Math.round((blocked / plannedPace) * 10) / 10 : 0;
  const blockedInd = blocked
    ? { value: `${blockedDays} día${blockedDays === 1 ? '' : 's'}`, detail: `${blocked} caso${blocked === 1 ? '' : 's'} bloqueado${blocked === 1 ? '' : 's'}${openBlockers[0] ? ` · bug bloqueante ${openBlockers[0].key}` : ''}`, tone: blockedDays >= 1 ? 'danger' : 'warning' }
    : { value: '0 días', detail: 'Ningún caso bloqueado', tone: total ? 'success' : 'neutral' };

  // 3. Disponibilidad del ambiente during the cycle window.
  const envName = schedule?.environment || '';
  const env = (environments || []).find(e => e?.name === envName);
  let downInd = { value: '—', detail: envName ? 'Ambiente fuera del catálogo' : 'El ciclo no tiene ambiente', tone: 'neutral' };
  if (hasDates && env) {
    const from = start.getTime(); const to = Math.min(end.getTime() + DAY, now.getTime());
    let ms = 0; let count = 0; const comps = new Map();
    (downtime || []).filter(e => e?.envId === env.id).forEach(e => {
      const s0 = Math.max(new Date(e.startedAt).getTime(), from);
      const f0 = Math.min(e.endedAt ? new Date(e.endedAt).getTime() : now.getTime(), to);
      if (f0 > s0) { ms += f0 - s0; count++; const c = e.component || 'todo el ambiente'; comps.set(c, (comps.get(c) || 0) + 1); }
    });
    const windowMs = Math.max(1, to - from);
    const availPct = Math.max(0, Math.round((1 - ms / windowMs) * 100));
    const mins = Math.round(ms / 60000);
    const human = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
    const top = [...comps.entries()].sort((a, b) => b[1] - a[1])[0];
    downInd = count === 0
      ? { value: 'Sin caídas', detail: `${envName} · 100 % disponible en el ciclo`, tone: 'success' }
      : { value: `${human} caído`, detail: `${envName} · ${top[0]} (${top[1]} ${top[1] === 1 ? 'vez' : 'veces'}) · ${availPct} % disponible en el ciclo`, tone: availPct >= 95 ? 'warning' : 'danger' };
  }

  // 4. Retests pendientes: failed cases whose bug development already fixed.
  const retestBugs = new Set();
  list.forEach((t, i) => {
    if (st[i] !== 'Failed') return;
    (Array.isArray(t?.linkedBugs) ? t.linkedBugs : []).forEach(b => { if (FIXED_RX.test(bugStatus(b))) retestBugs.add(b.key); });
  });
  const retestInd = bugsHaveStatus
    ? { value: `${retestBugs.size} bug${retestBugs.size === 1 ? '' : 's'}`, detail: 'Corregidos por desarrollo, esperan nueva prueba', tone: retestBugs.size ? 'warning' : 'success' }
    : { value: '—', detail: 'Sin defectos vinculados', tone: 'neutral' };

  // 5. Cambios de alcance: cases added/removed after the cycle started (when recorded).
  const added = list.filter(t => t?.addedAt && start && new Date(t.addedAt) > start).length;
  const removed = Array.isArray(schedule?.removedAfterStart) ? schedule.removedAfterStart.length : 0;
  const tracked = list.some(t => t?.addedAt);
  const scopeInd = tracked
    ? { value: `+${added} / −${removed}`, detail: `Casos agregados y quitados desde el ${shortDay(start)}`, tone: added + removed > 0 ? 'neutral-strong' : 'success' }
    : { value: '—', detail: 'Este ciclo no registra cuándo se agregaron sus casos', tone: 'neutral' };

  // 6. Preparación Go / No-Go.
  const gng = evaluateGoNoGo({ passed, failed, blocked, notRun: total - executed, bugs: bugList.map(b => ({ isDone: DONE_RX.test(bugStatus(b)), severity: bugPriority(b) })), includeBugs: bugsHaveStatus });
  const missing = gng.criteria.filter(c => !c.ok).map(c => c.label.toLowerCase());
  const freeze = parseDay(planSchedule?.codeFreezeDate);
  const gngInd = gng.verdict === 'empty'
    ? { value: '—', detail: 'Sin casos en el ciclo', tone: 'neutral' }
    : { value: `${gng.met} de ${gng.total}`, detail: `${missing.length ? `Falta: ${missing[0]}` : 'Todos los criterios cumplidos'}${freeze ? ` · congelamiento ${shortDay(freeze)}` : ''}`, tone: gng.verdict === 'go' ? 'success' : (gng.verdict === 'go-exception' ? 'warning' : 'danger') };

  // 7. Carga por tester: pending cases per person.
  const pendingBy = new Map();
  list.forEach((t, i) => {
    if (st[i] === 'Passed' || st[i] === 'Failed' || st[i] === 'Blocked') return;
    const who = firstNameInitial(nameOf(t?.assignee) || nameOf(t?.executedBy)) || 'Sin asignar';
    pendingBy.set(who, (pendingBy.get(who) || 0) + 1);
  });
  const loads = [...pendingBy.entries()].sort((a, b) => b[1] - a[1]);
  const loadInd = loads.length
    ? { value: `${loads[0][0]} ${loads[0][1]}`, detail: `Pendientes: ${loads.slice(0, 3).map(([n, c]) => `${n} ${c}`).join(' · ')}`, tone: loads.length > 1 && loads[0][1] > 2 * loads[loads.length - 1][1] ? 'warning' : 'success' }
    : { value: '—', detail: total ? 'Sin casos pendientes' : 'El ciclo aún no tiene casos', tone: total ? 'success' : 'neutral' };

  // 8. Tendencia de defectos: opened vs closed in the last 5 days (when bugs carry dates).
  const since = now.getTime() - 5 * DAY;
  const dated = bugList.filter(b => b?.created || b?.fields?.created);
  const opened = dated.filter(b => new Date(b.created || b.fields.created).getTime() >= since).length;
  const closed = bugList.filter(b => { const r = b?.resolutiondate || b?.fields?.resolutiondate; return r && new Date(r).getTime() >= since; }).length;
  const trendInd = dated.length
    ? { value: `+${opened} / −${closed}`, detail: `Abiertos vs cerrados en 5 días: ${opened > closed ? 'empeora' : opened < closed ? 'mejora' : 'estable'}`, tone: opened > closed ? 'danger' : (opened < closed ? 'success' : 'neutral-strong') }
    : { value: '—', detail: bugList.length ? 'Los defectos no traen fecha de alta' : 'Sin defectos vinculados', tone: 'neutral' };

  return {
    figures: { total, executed, passed, failed, blocked, totalDays, elapsedDays, pace, plannedPace, hasDates, semaforo },
    indicators: [
      { id: 'term', label: 'Término proyectado', ...term },
      { id: 'blocked', label: 'Días perdidos por bloqueos', ...blockedInd },
      { id: 'downtime', label: 'Disponibilidad del ambiente', ...downInd },
      { id: 'retests', label: 'Retests pendientes', ...retestInd },
      { id: 'scope', label: 'Cambios de alcance', ...scopeInd },
      { id: 'gonogo', label: 'Preparación Go / No-Go', ...gngInd },
      { id: 'load', label: 'Carga por tester', ...loadInd },
      { id: 'defects', label: 'Tendencia de defectos', ...trendInd }
    ]
  };
};

/**
 * "Vista previa" of the Calendario y metas drawer (plan or cycle): working days, pace goal,
 * real pace, projected end, expected vs done % and the traffic light, plus a one-line summary.
 * @param {object} p { startDate, endDate, excludeWeekends, holidays, total, executed, failed, semaforo, scope: 'plan'|'ciclo', freezeDate, goLiveDate, now }
 */
export const schedulePreview = ({ startDate, endDate, excludeWeekends = true, holidays = [], total = 0, executed = 0, failed = 0, semaforo, scope = 'plan', freezeDate, goLiveDate, now = new Date() }) => {
  const start = parseDay(startDate); const end = parseDay(endDate);
  if (!start || !end || end < start) return null;
  const hol = holidaySet(holidays);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = workingDaysBetween(start, end, hol, excludeWeekends);
  const elapsed = today < start ? 0 : workingDaysBetween(start, today < end ? today : end, hol, excludeWeekends);
  const goal = days ? Math.ceil(total / days) : 0;
  const real = elapsed ? Math.round(executed / elapsed) : 0;
  const finish = total && executed >= total ? today : (real > 0 ? addWorkingDays(today, (total - executed) / (executed / elapsed), hol, excludeWeekends) : null);
  const expectedPct = days ? Math.round((elapsed / days) * 100) : 0;
  const donePct = total ? Math.round((executed / total) * 100) : 0;
  const light = cycleSemaforo({ total, executed, failed, totalDays: days, elapsedDays: elapsed, semaforo });
  const holList = [...hol].sort().map(d => parseDay(d)).filter(d => d >= start && d <= end);
  const holTxt = holList.length ? `, ${holList.map(d => d.getDate()).join(' y ')} ${MONTHS[holList[holList.length - 1].getMonth()]}` : '';
  const freeze = parseDay(freezeDate); const goLive = parseDay(goLiveDate);
  let text = elapsed === 0
    ? `El ${scope} empieza el ${shortDay(start)}: ${days} días hábiles para ${total} casos.`
    : `Hoy, día ${elapsed} de ${days}, el ${scope} debería llevar ${expectedPct} % y lleva ${donePct} %.`;
  if (finish && elapsed > 0) {
    text += ` Al ritmo actual (${real} casos por día contra una meta de ${goal}) terminaría el ${shortDay(finish)}`;
    const refs = [];
    if (freeze) refs.push(`${finish <= freeze ? 'antes' : 'después'} del congelamiento de código (${shortDay(freeze)})`);
    if (goLive) refs.push(`${finish <= goLive ? 'antes' : 'después'} de la liberación (${shortDay(goLive)})`);
    if (!refs.length) refs.push(finish <= end ? `dentro de lo planeado (${shortDay(end)})` : `después de lo planeado (${shortDay(end)})`);
    text += `, ${refs.join(' y ')}.`;
  }
  return {
    light, expectedPct, donePct,
    items: [
      { value: String(days), label: `días hábiles (${excludeWeekends ? 'sin fines de semana' : 'con fines de semana'}${holTxt})` },
      { value: `${goal} / día`, label: `meta de ritmo · ${total} casos ÷ ${days} días` },
      { value: elapsed ? `${real} / día` : '—', label: elapsed ? `ritmo real en los ${elapsed} días transcurridos` : 'aún no empieza' },
      { value: finish ? shortDay(finish) : '—', label: `término proyectado (${scope === 'plan' ? 'fin de pruebas' : 'planeado'}: ${shortDay(end)})` }
    ],
    text
  };
};

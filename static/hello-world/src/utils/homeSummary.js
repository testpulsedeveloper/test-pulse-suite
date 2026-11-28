/**
 * homeSummary.js — pure helpers behind the "Inicio" screen of Test Pulse 5.0.
 *
 * Everything here works on data the app ALREADY has in memory (the cycle list returned by
 * the `getTestCycles` resolver, which includes each cycle's `executionMeta` counters and
 * `schedule` dates). Inicio therefore adds no extra Jira calls to compute its numbers,
 * which keeps the first screen fast. Kept free of React so it can be unit tested with
 * `node --test`.
 */

// Jira status names that mean "this cycle is finished". Compared in lower case.
const DONE_STATUSES = ['done', 'closed', 'cerrado', 'cerrada', 'finalizado', 'finalizada', 'terminado', 'terminada', 'resuelto', 'resuelta', 'listo', 'hecho', 'completado', 'completada'];

/** Parses 'YYYY-MM-DD' (or an ISO string) as a LOCAL date at midnight; null when invalid. */
export const parseLocalDate = (value) => {
  if (!value || typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Returns today's date at local midnight (so comparisons ignore the time of day). */
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Normalizes a cycle's counters. `executionMeta` can be missing for cycles that were never
 * opened since the counters were introduced; in that case only the test count is known.
 */
export const cycleCounts = (cycle) => {
  const m = cycle?.executionMeta || {};
  const total = Number(m.total ?? cycle?.testCount ?? 0) || 0;
  const passed = Number(m.passed) || 0;
  const failed = Number(m.failed) || 0;
  const blocked = Number(m.blocked) || 0;
  // A case counts as executed once it has a final result (passed, failed or blocked).
  const executed = Math.min(total, passed + failed + blocked);
  return { total, passed, failed, blocked, executed };
};

/** True when the cycle's Jira status says it is finished. */
export const isCycleDone = (cycle) => DONE_STATUSES.includes(String(cycle?.status || '').trim().toLowerCase());

/**
 * Classifies a cycle for the "Ciclos activos" list.
 * - COMPLETO  : every case has a final result
 * - VENCIDO   : the end date passed and cases are still missing
 * - EN RIESGO : progress is more than 15 points behind the share of the period that elapsed
 * - A TIEMPO  : otherwise
 * - SIN FECHAS: the cycle has no start/end date, so time can't be judged
 * @returns {{ key: string, label: string, pct: number, expectedPct: number|null }}
 */
export const cycleHealth = (cycle, now = new Date()) => {
  const { total, executed } = cycleCounts(cycle);
  const pct = total > 0 ? Math.round((executed / total) * 100) : 0;
  if (total > 0 && executed >= total) return { key: 'done', label: 'COMPLETO', pct: 100, expectedPct: null };

  const start = parseLocalDate(cycle?.schedule?.startDate);
  const end = parseLocalDate(cycle?.schedule?.endDate);
  if (!start || !end || end < start) return { key: 'nodates', label: 'SIN FECHAS', pct, expectedPct: null };

  const today = startOfDay(now);
  if (today > end) return { key: 'late', label: 'VENCIDO', pct, expectedPct: 100 };

  // Share of the cycle's calendar days already elapsed (both ends inclusive).
  const dayMs = 86400000;
  const span = Math.round((end - start) / dayMs) + 1;
  const elapsed = today < start ? 0 : Math.round((today - start) / dayMs) + 1;
  const expectedPct = Math.round((elapsed / span) * 100);
  if (expectedPct - pct > 15) return { key: 'risk', label: 'EN RIESGO', pct, expectedPct };
  return { key: 'ok', label: 'A TIEMPO', pct, expectedPct };
};

/**
 * Builds everything Inicio shows from the cycle list.
 * @param {Array} cycles the project's cycles (from getTestCycles)
 * @param {Date} [now]
 */
export const buildHomeSummary = (cycles, now = new Date()) => {
  const list = Array.isArray(cycles) ? cycles : [];
  // Active = not finished in Jira and with at least one case to run.
  const active = list.filter(c => !isCycleDone(c) && cycleCounts(c).total > 0);

  const totals = active.reduce((acc, c) => {
    const k = cycleCounts(c);
    acc.total += k.total; acc.executed += k.executed; acc.passed += k.passed;
    acc.failed += k.failed; acc.blocked += k.blocked;
    return acc;
  }, { total: 0, executed: 0, passed: 0, failed: 0, blocked: 0 });

  const rows = active.map(c => {
    const k = cycleCounts(c);
    const h = cycleHealth(c, now);
    const share = (n) => (k.total > 0 ? (n / k.total) * 100 : 0);
    return {
      id: String(c.id),
      key: c.key,
      name: c.summary || c.key,
      startDate: c.schedule?.startDate || null,
      endDate: c.schedule?.endDate || null,
      counts: k,
      health: h,
      // Widths for the stacked progress bar, in percent of the cycle's cases.
      bar: { passed: share(k.passed), failed: share(k.failed), blocked: share(k.blocked) }
    };
  });

  // Most urgent first: late, at risk, on time, no dates, complete; then by end date.
  const order = { late: 0, risk: 1, ok: 2, nodates: 3, done: 4 };
  rows.sort((a, b) => (order[a.health.key] - order[b.health.key])
    || String(a.endDate || '9999').localeCompare(String(b.endDate || '9999')));

  return {
    activeCount: active.length,
    totals,
    progressPct: totals.total > 0 ? Math.round((totals.executed / totals.total) * 100) : 0,
    // Pass rate over cases that already have a result (not over the whole plan).
    passRatePct: totals.executed > 0 ? Math.round((totals.passed / totals.executed) * 100) : null,
    lateCount: rows.filter(r => r.health.key === 'late').length,
    riskCount: rows.filter(r => r.health.key === 'risk').length,
    rows
  };
};

/** Greeting by local hour, as shown in the Inicio header. */
export const greetingFor = (now = new Date()) => {
  const h = now.getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
};

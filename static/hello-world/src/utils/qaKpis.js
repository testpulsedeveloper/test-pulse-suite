/**
 * @file qaKpis.js
 * @description Pure calculations for the QA KPIs shown in Reports (v4.17.0):
 *
 *   1. Tasa de Casos Bloqueados  = Blocked cases / total cases in scope x 100
 *        - Operating limit:  below 10 %  → healthy
 *        - Between 10 % and 30 %        → warning
 *        - 30 % or more                 → "fuse": the QA cycle should be formally suspended
 *
 *   2. MTTR (Mean Time To Repair) per severity, compared with the agreed SLA:
 *        - Bloqueante / Crítico → 24 business hours
 *        - Alto / Mayor         → 48 business hours
 *        - Medio / Menor        → 5 business days
 *
 * The targets come from the document "Propuesta de KPIs QA POS Enactor 2026".
 *
 * IMPORTANT: Test Pulse measures bug time in BUSINESS hours (see formatBugAge in constants.js,
 * where one business day is 10 hours). The targets below use the same unit so the numbers shown
 * here agree with the bug ages shown everywhere else in the app.
 *
 * This file has no imports so it can be unit-tested with plain Node (tests/qaKpis.test.js) and it
 * never calls Jira: it only works on data the Reports view has already loaded, so it adds no
 * network requests.
 */

// Thresholds of the blocked-cases KPI, in percent.
export const BLOCKED_LIMIT_PCT = 10;
export const BLOCKED_FUSE_PCT = 30;

// Business hours in one business day, same value formatBugAge uses.
export const BUSINESS_HOURS_PER_DAY = 10;

// Severity groups, in the order they are displayed. `targetHours` is the SLA in business hours;
// null means "no SLA agreed" (bugs without severity are counted but not judged).
export const MTTR_GROUPS = [
  { key: 'critical', label: 'Bloqueante / Crítico', targetHours: 24, targetLabel: '≤ 24 h' },
  { key: 'high', label: 'Alto / Mayor', targetHours: 48, targetLabel: '≤ 48 h' },
  { key: 'medium', label: 'Medio / Menor', targetHours: 5 * BUSINESS_HOURS_PER_DAY, targetLabel: '≤ 5 días háb.' },
  { key: 'none', label: 'Sin severidad', targetHours: null, targetLabel: 'Sin SLA' }
];

/**
 * Blocked-cases rate and its traffic-light level.
 *
 * @param {number} blocked - Cases currently in status Blocked.
 * @param {number} total   - All cases in the selected scope (any status).
 * @returns {{pct: number, level: 'empty'|'ok'|'warning'|'fuse', blocked: number, total: number}}
 */
export function blockedRate(blocked, total) {
  const b = Math.max(0, Number(blocked) || 0);
  const t = Math.max(0, Number(total) || 0);
  if (t === 0) return { pct: 0, level: 'empty', blocked: b, total: t };
  const pct = (b / t) * 100;
  let level = 'ok';
  if (pct >= BLOCKED_FUSE_PCT) level = 'fuse';
  else if (pct >= BLOCKED_LIMIT_PCT) level = 'warning';
  return { pct, level, blocked: b, total: t };
}

/**
 * Maps the free-text severity of a bug to one of the SLA groups. It accepts Spanish and English
 * names and the Jira priority names (Highest/High/Medium/Low) because projects are not uniform.
 *
 * @param {string} severity
 * @returns {'critical'|'high'|'medium'|'none'}
 */
export function severityGroup(severity) {
  const s = String(severity || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove accents: "crítico" → "critico"
    .trim();
  if (!s) return 'none';
  if (s.includes('bloq') || s.includes('block') || s.includes('crit') || s === 'highest') return 'critical';
  if (s.includes('may') || s.includes('major') || s.includes('alt') || s.includes('high')) return 'high';
  if (
    s.includes('med') || s.includes('men') || s.includes('minor') ||
    s.includes('baj') || s.includes('low') || s.includes('triv')
  ) return 'medium';
  return 'none';
}

/**
 * MTTR and SLA compliance per severity group.
 *
 * @param {Array<{severity?: string, isDone?: boolean, hours?: number}>} bugs
 *        `hours` is the business time of the bug: time to resolve it when isDone is true, or
 *        the time it has been open so far when it is not. The caller computes it with
 *        formatBugAge so pauses (On Hold) and reopenings are already discounted.
 * @returns {Array<Object>} One entry per group of MTTR_GROUPS, in the same order:
 *        closed        - closed bugs with a measured time
 *        avgHours      - mean hours to repair (null when there are no closed bugs)
 *        withinSla     - closed bugs repaired within the target
 *        compliancePct - withinSla / closed x 100 (null without target or closed bugs)
 *        open          - bugs still open
 *        openOverdue   - open bugs that have already exceeded the target
 *        level         - 'empty' | 'ok' | 'breach' | 'neutral' (neutral = group without SLA)
 */
export function mttrBySeverity(bugs) {
  const acc = {};
  MTTR_GROUPS.forEach(g => {
    acc[g.key] = { closed: 0, sumHours: 0, withinSla: 0, open: 0, openOverdue: 0 };
  });

  (Array.isArray(bugs) ? bugs : []).forEach(bug => {
    if (!bug) return;
    const group = MTTR_GROUPS.find(g => g.key === severityGroup(bug.severity));
    const bucket = acc[group.key];
    const hours = Number(bug.hours);
    const hasHours = Number.isFinite(hours) && hours > 0;

    if (bug.isDone) {
      // A closed bug without a measurable time (missing dates) cannot be averaged.
      if (!hasHours) return;
      bucket.closed++;
      bucket.sumHours += hours;
      if (group.targetHours !== null && hours <= group.targetHours) bucket.withinSla++;
    } else {
      bucket.open++;
      if (group.targetHours !== null && hasHours && hours > group.targetHours) bucket.openOverdue++;
    }
  });

  return MTTR_GROUPS.map(group => {
    const b = acc[group.key];
    const avgHours = b.closed > 0 ? b.sumHours / b.closed : null;
    const compliancePct = group.targetHours !== null && b.closed > 0 ? (b.withinSla / b.closed) * 100 : null;
    let level = 'empty';
    if (group.targetHours === null) level = 'neutral';
    else if (avgHours !== null) level = avgHours <= group.targetHours ? 'ok' : 'breach';
    // Open bugs past their SLA are a breach even when the closed ones look healthy.
    if (group.targetHours !== null && b.openOverdue > 0) level = 'breach';
    return {
      ...group,
      closed: b.closed,
      avgHours,
      withinSla: b.withinSla,
      compliancePct,
      open: b.open,
      openOverdue: b.openOverdue,
      level
    };
  });
}

/**
 * Formats business hours for display: "18.5 h" below one business day, "2.3 días háb." above.
 *
 * @param {number|null} hours
 * @returns {string}
 */
export function formatBusinessDuration(hours) {
  if (hours === null || hours === undefined || !Number.isFinite(Number(hours))) return '—';
  const h = Number(hours);
  if (h < BUSINESS_HOURS_PER_DAY) return `${h.toFixed(1)} h`;
  return `${(h / BUSINESS_HOURS_PER_DAY).toFixed(1)} días háb.`;
}

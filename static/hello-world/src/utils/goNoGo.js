/**
 * goNoGo.js — exit criteria for a release, "Preparación Go / No-Go" (Test Pulse 5.0, v4.43.0).
 *
 * Evaluates the criteria QA uses to recommend a release, from numbers Calidad already has
 * for the selected cycles (execution counters and their bugs). The result is a QA
 * RECOMMENDATION, never an approval: the decision belongs to the release owners.
 *
 * Kept free of React so it can be unit tested with `node --test`.
 */

// Default thresholds (same targets as the KPI catalogue: CE/CU/SC goals).
export const GO_NO_GO_DEFAULTS = { minPassRate: 95, maxBlockedRate: 10 };

// Severity names that count as Critical or High, in the languages/variants Jira sites use.
const CRIT_HIGH_RX = /(crít|critic|blocker|bloqueante|highest|alt[oa]|high|mayor|major|urgent)/i;

/** True when the bug's severity/priority is Critical or High. */
export const isCriticalOrHigh = (bug) => CRIT_HIGH_RX.test(String(bug?.severity || bug?.priority?.name || bug?.priority || ''));

/**
 * @param {object} p
 * @param {number} p.passed
 * @param {number} p.failed
 * @param {number} p.blocked
 * @param {number} p.notRun
 * @param {Array}  p.bugs   bugs of the selected cycles: { isDone, severity }
 * @param {object} [p.thresholds]
 * @param {boolean} [p.includeBugs=true] false when the caller has no bug data (Ciclo de vida):
 *        the bug criterion is left out instead of showing a misleading "0 open".
 * @returns {{ criteria: Array, met: number, total: number, verdict: 'go'|'go-exception'|'no-go'|'empty', verdictLabel: string }}
 */
export const evaluateGoNoGo = ({ passed = 0, failed = 0, blocked = 0, notRun = 0, bugs = [], thresholds = {}, includeBugs = true }) => {
  const t = { ...GO_NO_GO_DEFAULTS, ...thresholds };
  const total = passed + failed + blocked + notRun;
  const executed = passed + failed + blocked;
  if (total === 0) {
    return { criteria: [], met: 0, total: 0, verdict: 'empty', verdictLabel: 'Sin casos en la selección' };
  }
  const passRate = executed ? (passed / executed) * 100 : 0;
  const blockedRate = (blocked / total) * 100;
  const openCritHigh = (Array.isArray(bugs) ? bugs : []).filter(b => !b?.isDone && isCriticalOrHigh(b)).length;

  const criteria = [
    {
      id: 'executed', label: 'Todos los casos ejecutados',
      detail: `${executed.toLocaleString('es-MX')} de ${total.toLocaleString('es-MX')} con resultado`,
      ok: notRun === 0
    },
    {
      id: 'passrate', label: `Tasa de éxito ≥ ${t.minPassRate} %`,
      detail: executed ? `Hoy ${Math.round(passRate)} % · ${passed} de ${executed}` : 'Sin ejecuciones',
      ok: executed > 0 && passRate >= t.minPassRate
    },
    {
      id: 'bugs', label: '0 bugs Crítico / Alto abiertos',
      detail: openCritHigh ? `Hoy ${openCritHigh} abierto${openCritHigh === 1 ? '' : 's'}` : 'Ninguno abierto',
      ok: openCritHigh === 0
    },
    {
      id: 'blocked', label: `Casos bloqueados < ${t.maxBlockedRate} %`,
      detail: `Hoy ${Math.round(blockedRate * 10) / 10} % · ${blocked} caso${blocked === 1 ? '' : 's'}`,
      ok: blockedRate < t.maxBlockedRate
    }
  ].filter(c => includeBugs || c.id !== 'bugs');
  const met = criteria.filter(c => c.ok).length;
  // All met → Go. Only the pass rate or the blocked rate missed (no open Critical/High bug and
  // everything executed) → Go con excepción. Anything else → No-Go.
  let verdict = 'no-go';
  if (met === criteria.length) verdict = 'go';
  else if (criteria.find(c => c.id === 'executed').ok && (criteria.find(c => c.id === 'bugs')?.ok ?? true)) verdict = 'go-exception';
  const verdictLabel = { go: 'Go', 'go-exception': 'Go con excepción', 'no-go': 'No-Go' }[verdict];
  return { criteria, met, total: criteria.length, verdict, verdictLabel };
};

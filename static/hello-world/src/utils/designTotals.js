/**
 * @file designTotals.js
 * @description Counters at the top of phase 02 "Diseñar" in Lifecycle (v4.32.0).
 *
 * Phase 04 "Ejecutar" opens with a row of figures (plans, overall state, executions, passed…).
 * Phase 02 now gets the same kind of row, built from the findings reports of Confluence that
 * each reviewed document already carries (`deliverable.report.totals`). Nothing new is read
 * from Confluence or Jira: the figures are added up in the browser from what is loaded.
 *
 * Plain data in, plain data out, so it is unit-tested in tests/designTotals.test.js.
 */

// The impacts considered "serious": their open findings get their own counter.
const SERIOUS_IMPACTS = ['Crítico', 'Alto'];

/**
 * Adds up the findings reports of the documents of phase 02.
 *
 * @param {Array<Object>} deliverables - Deliverables of phase 02 of one initiative.
 * @returns {{
 *   documents: number,     // documents registered in the phase
 *   read: number,          // documents whose report was read from Confluence and recognized
 *   unread: number,        // documents not read yet, or whose page could not be read/recognized
 *   delivered: number,     // documents marked "Entregado"
 *   total: number,         // findings in all the read reports
 *   open: number,          // findings still open
 *   closed: number,        // findings closed
 *   seriousOpen: number,   // open findings whose impact is Crítico or Alto
 *   maturityAvg: (number|null), // average "madurez del documento" of the reports that have one
 *   closedPct: number      // closed / total, 0–100 (0 when there are no findings)
 * }}
 */
export function designTotals(deliverables) {
  const list = Array.isArray(deliverables) ? deliverables.filter(Boolean) : [];
  const result = { documents: list.length, read: 0, unread: 0, delivered: 0, total: 0, open: 0, closed: 0, seriousOpen: 0, maturityAvg: null, closedPct: 0 };
  const maturities = [];
  // Non-negative whole number, whatever the stored value is (old reports may lack a field).
  const count = (value) => Math.max(0, Number(value) || 0);

  for (const deliverable of list) {
    if (deliverable.status === 'delivered') result.delivered++;
    const totals = deliverable.report?.totals;
    if (!totals) {
      // No report yet, or Confluence answered with an error: it is shown as "sin leer".
      result.unread++;
      continue;
    }
    result.read++;
    result.total += count(totals.total);
    result.open += count(totals.open);
    result.closed += count(totals.closed);
    for (const impact of SERIOUS_IMPACTS) result.seriousOpen += count(totals.openByImpact?.[impact]);
    const maturity = deliverable.report.maturityPct;
    if (maturity !== null && maturity !== undefined && Number.isFinite(Number(maturity))) maturities.push(Number(maturity));
  }

  if (maturities.length > 0) result.maturityAvg = Math.round(maturities.reduce((a, b) => a + b, 0) / maturities.length);
  result.closedPct = result.total > 0 ? Math.round((result.closed / result.total) * 100) : 0;
  return result;
}

/**
 * Overall state of phase 02, shown like the "Estado general" tag of phase 04.
 *
 * @param {ReturnType<typeof designTotals>} totals
 * @returns {{label: string, color: string, background: string}}
 */
export function designState(totals) {
  if (!totals || totals.documents === 0) return { label: 'Sin documentos', color: '#44546F', background: '#F1F2F4' };
  if (totals.read === 0) return { label: 'Sin leer', color: '#44546F', background: '#F1F2F4' };
  if (totals.open > 0) return { label: 'Con hallazgos abiertos', color: '#AE2A19', background: '#FFECEB' };
  if (totals.unread > 0) return { label: 'Documentos sin leer', color: '#974F0C', background: '#FFF7D6' };
  return { label: 'Hallazgos atendidos', color: '#216E4E', background: '#DCFFF1' };
}

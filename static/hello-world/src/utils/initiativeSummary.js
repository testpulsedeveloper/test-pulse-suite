/**
 * initiativeSummary.js — "Iniciativas en curso" on Inicio (Test Pulse 5.0, v4.43.0).
 *
 * Turns a Ciclo de vida initiative (and, when loaded, its Jira progress) into five short
 * labels, one per QA phase, with a tone: Planear, Diseñar, Construir, Ejecutar, Liberar.
 * Same rules Ciclo de vida uses; kept free of React for `node --test`.
 */

export const PHASE_IDS = ['plan', 'design', 'build', 'execute', 'release'];
export const PHASE_NAMES = { plan: 'Planear', design: 'Diseñar', build: 'Construir', execute: 'Ejecutar', release: 'Liberar' };

const deliverables = (initiative, id) => initiative?.phases?.[id]?.deliverables || [];
const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** Status label for a phase made of manual deliverables (plan, release). */
const manualPhase = (list) => {
  if (list.length === 0) return { label: 'Pendiente', tone: 'neutral' };
  if (list.every(d => d.status === 'delivered')) return { label: 'Completo', tone: 'success' };
  if (list.some(d => d.status !== 'pending')) return { label: 'En curso', tone: 'info' };
  return { label: 'Pendiente', tone: 'neutral' };
};

/** Phase 02: reviewed documents and their open findings (critical ones turn it red). */
const designPhase = (list) => {
  if (list.length === 0) return { label: 'Pendiente', tone: 'neutral' };
  let open = 0; let critical = 0;
  list.forEach(d => {
    const totals = d?.report?.totals || {};
    open += Number(totals.open) || 0;
    critical += Number(totals.openByImpact?.['Crítico'] || totals.openByImpact?.Critico || 0);
  });
  if (critical > 0) return { label: `${critical} crítico${critical === 1 ? '' : 's'} abierto${critical === 1 ? '' : 's'}`, tone: 'danger' };
  if (open > 0) return { label: `${list.length} docs · ${open} abiertos`, tone: 'warning' };
  return list.every(d => d.status === 'delivered')
    ? { label: 'Completo', tone: 'success' }
    : { label: `${list.length} docs · sin abiertos`, tone: 'info' };
};

/**
 * @param {object} initiative from getLifecycle
 * @param {object|null} progress { stories, storiesWithCases, runs, plans } or null when not loaded
 * @returns {Array<{ id, name, label, tone }>}
 */
export const summarizeInitiative = (initiative, progress) => {
  const hasBuild = (initiative?.epicKeys || []).length > 0 || (initiative?.storyKeys || []).length > 0;
  const hasPlans = (initiative?.planKeys || []).length > 0;

  let build = { label: 'Sin épicas', tone: 'neutral' };
  if (hasBuild) {
    if (!progress) build = { label: 'Cargando…', tone: 'neutral' };
    else if (!progress.stories) build = { label: 'Sin historias', tone: 'neutral' };
    else {
      const c = pct(progress.storiesWithCases, progress.stories);
      build = { label: `${c}% cobertura`, tone: c >= 100 ? 'success' : (c >= 80 ? 'warning' : 'danger') };
    }
  }

  let execute = { label: 'Sin iniciar', tone: 'neutral' };
  if (hasPlans || hasBuild) {
    // Test Plans of phase 04 win over the executions found through the epics, as in Ciclo de vida.
    const plans = (progress?.plans || []).filter(p => p && !p.error && p.totals);
    const runs = plans.length
      ? plans.reduce((a, p) => ({ total: a.total + (p.totals.total || 0), done: a.done + (p.totals.passed || 0) + (p.totals.failed || 0) + (p.totals.blocked || 0) }), { total: 0, done: 0 })
      : (progress?.runs ? { total: progress.runs.total || 0, done: (progress.runs.passed || 0) + (progress.runs.failed || 0) + (progress.runs.blocked || 0) } : null);
    if (!progress) execute = { label: 'Cargando…', tone: 'neutral' };
    else if (runs && runs.total > 0 && runs.done > 0) {
      const e = pct(runs.done, runs.total);
      execute = { label: `${e}% ejecutado`, tone: e >= 100 ? 'success' : 'info' };
    }
  }

  const byId = {
    plan: manualPhase(deliverables(initiative, 'plan')),
    design: designPhase(deliverables(initiative, 'design')),
    build,
    execute,
    release: manualPhase(deliverables(initiative, 'release'))
  };
  return PHASE_IDS.map(id => ({ id, name: PHASE_NAMES[id], ...byId[id] }));
};

/**
 * @file planCycleRules.js
 * @description Rule (v4.16.3): a Test Cycle belongs to AT MOST ONE Test Plan.
 *
 * Before this rule, pressing "+ Add" on a cycle that already belonged to another plan silently
 * moved it to the new plan. The first plan lost the cycle and its executions, which breaks
 * traceability (reports of the first plan changed without anyone deciding it).
 *
 * Now a cycle can only be added to a plan when it has no plan. To move a cycle, it must first be
 * removed from its current plan on purpose.
 *
 * Where a cycle's plan is stored (in order of precedence, same as `getTestCycles`):
 *   1. issue property `testops-plan-link` → `{ planId }`
 *   2. issue property `testpulse-v2`      → `{ planId }`
 *   3. the cycle's parent issue, when that parent is a plan / test set
 */

/**
 * Returns the plan reference (issue ID or key) a cycle is currently linked to, or null.
 *
 * @param {Object} cycleIssue - Cycle issue with `properties` and `fields.parent`.
 * @returns {string|null}
 */
export function currentPlanRefOfCycle(cycleIssue) {
  const props = cycleIssue?.properties || {};
  const planLink = props['testops-plan-link'];
  const v2 = props['testpulse-v2']?.value || props['testpulse-v2'];

  let planRef = null;
  if (planLink && typeof planLink === 'object') {
    planRef = planLink.planId || planLink.value?.planId || null;
  } else if (typeof planLink === 'string') {
    planRef = planLink;
  }
  if (!planRef) planRef = v2?.planId || null;

  if (!planRef) {
    const parent = cycleIssue?.fields?.parent;
    const parentType = String(parent?.fields?.issuetype?.name || '').toLowerCase();
    if (parent && (parentType.includes('plan') || parentType.includes('set'))) {
      planRef = parent.id || parent.key || null;
    }
  }
  return planRef ? String(planRef) : null;
}

/**
 * True when `planRef` (an ID or a key) points to the given plan.
 *
 * @param {string|null} planRef
 * @param {{id?: string, key?: string}} plan
 * @returns {boolean}
 */
export function isSamePlan(planRef, plan) {
  if (!planRef || !plan) return false;
  const ref = String(planRef).toUpperCase();
  return ref === String(plan.id || '').toUpperCase() || ref === String(plan.key || '').toUpperCase();
}

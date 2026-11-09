/**
 * @file executionStatus.js
 * @description Decides the overall status of a Test Run when its iterations change.
 *
 * Background (bug fixed in v4.16.2): a tester can choose the overall result of a Test Run
 * directly (Passed / Failed / Blocked) without marking each iteration. The iterations then stay
 * "Not Run". Before this fix, any later iteration change (typing the actual result, adding an
 * iteration) or pressing Stop recalculated the overall status ONLY from the iterations, so the
 * tester's choice was silently replaced by "In Progress" and then "Not Run" — in Test Pulse and
 * in Jira. Seen in production on CUQ-2762, CEL-14524 and CEL-14525 (2026-11-09).
 *
 * The rule now is:
 *   1. If the iterations themselves give a final result (Passed / Failed / Blocked), that wins:
 *      the tester decided it step by step.
 *   2. Otherwise, if the current status is a final result the tester chose by hand (it does not
 *      come from the iterations), keep it.
 *   3. Otherwise behave as before: "In Progress" while the execution is running, and the value
 *      calculated from the iterations when it is not.
 *
 * This file has no imports so it can be unit-tested with plain Node (tests/executionStatus.test.js).
 */

// Final results a tester can choose for a Test Run.
const FINAL_STATUSES = ['Passed', 'Failed', 'Blocked'];

// Iteration values that mean "not executed yet".
const NOT_RUN_VALUES = ['Not Run', 'UNEXECUTED', 'Not_Run', 'TODO'];

/**
 * Normalizes the handful of spellings used for a final result ("Pass", "Fail", "Block", any
 * casing) to the canonical UI names. Anything else is returned unchanged.
 *
 * @param {string} status
 * @returns {string}
 */
const canonical = (status) => {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'pass' || s === 'passed') return 'Passed';
  if (s === 'fail' || s === 'failed') return 'Failed';
  if (s === 'block' || s === 'blocked') return 'Blocked';
  if (s === 'in progress') return 'In Progress';
  if (!s || NOT_RUN_VALUES.map(v => v.toLowerCase()).includes(s)) return 'Not Run';
  return status;
};

/**
 * Overall status derived ONLY from the iterations (same rules Test Pulse has always used):
 * any Failed → Failed, else any Blocked → Blocked, all Passed → Passed, none executed → Not Run,
 * otherwise In Progress.
 *
 * @param {Array<{status?: string}>} iterations
 * @param {string} [fallbackStatus='Not Run'] - Returned when there are no iterations.
 * @returns {string}
 */
export function calculateOverallStatus(iterations, fallbackStatus = 'Not Run') {
  if (!Array.isArray(iterations) || iterations.length === 0) return fallbackStatus;
  const statuses = iterations.map(it => canonical(it?.status));
  if (statuses.includes('Failed')) return 'Failed';
  if (statuses.includes('Blocked')) return 'Blocked';
  if (statuses.every(s => s === 'Passed')) return 'Passed';
  if (statuses.every(s => s === 'Not Run')) return 'Not Run';
  return 'In Progress';
}

/**
 * Returns the overall status to show and save after the iterations of a Test Run change.
 *
 * @param {Object} params
 * @param {Array}   params.previousIterations - Iterations BEFORE the change (used to tell whether
 *                                              the current status was chosen by hand).
 * @param {Array}   params.nextIterations     - Iterations AFTER the change.
 * @param {string}  params.currentStatus      - Overall status before the change.
 * @param {boolean} params.isRunning          - True while the execution timer (Play) is active.
 * @param {boolean} [params.isStopping=false] - True when the tester presses Stop: an execution
 *                                              left "In Progress" with nothing executed goes back
 *                                              to the value calculated from the iterations.
 * @returns {string}
 */
export function resolveStatusAfterIterationChange({
  previousIterations,
  nextIterations,
  currentStatus,
  isRunning,
  isStopping = false
}) {
  const calculated = calculateOverallStatus(nextIterations);

  // 1. The iterations decided a final result.
  if (FINAL_STATUSES.includes(calculated)) return calculated;

  // 2. Keep a final result the tester chose by hand. It is "by hand" when the previous iterations
  //    would not have produced it (e.g. Passed chosen while the only iteration is still Not Run).
  const current = canonical(currentStatus);
  const chosenByHand =
    FINAL_STATUSES.includes(current) &&
    calculateOverallStatus(previousIterations) !== current;
  if (chosenByHand) return currentStatus;

  // 3. Previous behaviour.
  if (isStopping) return calculated;
  if (isRunning) return 'In Progress';
  // Editing a field of a not-yet-executed iteration must not wipe an existing status.
  return calculated === 'Not Run' && current !== 'Not Run' ? currentStatus : calculated;
}

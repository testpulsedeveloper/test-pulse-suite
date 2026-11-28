/**
 * designFlag.js — decides whether a user sees the Test Pulse 5.0 design ("nuevo diseño")
 * or the classic 4.x interface.
 *
 * Two switches feed the decision:
 *
 * 1. The PROJECT switch (`projectConfig.newDesignEnabled`), stored in the project's
 *    `testops-config` property. Only project admins can change it (from Configuración ›
 *    Acceso y estado). It is the "interruptor general": turning it off sends everybody
 *    back to the classic view immediately, without redeploying the app.
 *
 * 2. The PERSONAL preference, kept in the browser's localStorage:
 *      - 'new'  → "Probar nuevo diseño" (lets someone try 5.0 before it is on for everyone)
 *      - 'old'  → "Volver a la vista anterior" (lets someone go back while it is on)
 *      - absent → follow the project switch
 *    It is per browser on purpose: it is a convenience, not data. If storage is blocked
 *    (private window, cleared site data) the user simply follows the project switch.
 *
 * After ROLLBACK_UNTIL the personal "old" preference is ignored, so the classic view
 * can be retired two weeks after the switch-on, as agreed for the 5.0 rollout.
 */

// Storage key for the personal preference. Prefixed like the other Test Pulse keys.
const PREF_KEY = 'tp_design_pref_v5';

// Last day (inclusive, local time) on which a user can still go back to the classic view.
export const ROLLBACK_UNTIL = '2026-12-14';

/**
 * Reads the personal preference. Never throws: storage can be unavailable in some browsers.
 * @returns {'new'|'old'|null}
 */
export const readDesignPref = () => {
  try {
    const v = window.localStorage.getItem(PREF_KEY);
    return v === 'new' || v === 'old' ? v : null;
  } catch (_) {
    return null;
  }
};

/**
 * Saves (or clears, with null) the personal preference. Never throws.
 * @param {'new'|'old'|null} value
 */
export const writeDesignPref = (value) => {
  try {
    if (value === 'new' || value === 'old') window.localStorage.setItem(PREF_KEY, value);
    else window.localStorage.removeItem(PREF_KEY);
  } catch (_) {
    // Storage blocked: the preference just won't survive a reload.
  }
};

/**
 * True while the "Volver a la vista anterior" option is still offered.
 * @param {Date} [now]
 */
export const isRollbackWindowOpen = (now = new Date()) => {
  // Compare as YYYY-MM-DD strings in local time so the cut-off is the end of that day.
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return today <= ROLLBACK_UNTIL;
};

/**
 * Final decision: should this user see the 5.0 design?
 * @param {object|null} projectConfig the loaded project configuration
 * @param {'new'|'old'|null} pref the personal preference
 * @param {Date} [now]
 * @returns {boolean}
 */
export const resolveNewDesign = (projectConfig, pref, now = new Date()) => {
  const projectOn = projectConfig?.newDesignEnabled === true;
  if (projectOn) {
    // Project switch on: everyone gets 5.0 unless they asked to go back and the
    // two-week window is still open.
    return !(pref === 'old' && isRollbackWindowOpen(now));
  }
  // Project switch off: only people who chose "Probar nuevo diseño" see 5.0.
  return pref === 'new';
};

/**
 * Tab ids are kept exactly as in 4.x (design, planning, execution, reports, lifecycle,
 * config) so nothing else in the app changes. Only the visible labels differ.
 */
export const TAB_LABELS = {
  classic: {
    design: 'Design',
    planning: 'Planning',
    execution: 'Execution',
    reports: 'Reports',
    lifecycle: 'Lifecycle',
    config: 'Configuración'
  },
  v5: {
    home: 'Inicio',
    design: 'Repositorio',
    planning: 'Planeación',
    execution: 'Ejecución',
    reports: 'Calidad',
    lifecycle: 'Ciclo de vida',
    config: 'Configuración'
  }
};

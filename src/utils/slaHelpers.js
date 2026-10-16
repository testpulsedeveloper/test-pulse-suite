// === SLA & Business Hours Helpers (Mexico City / Liverpool Calendar) ===
export function getEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

export function getNthDayOfMonth(year, month, dayOfWeek, n) {
  let d = new Date(year, month, 1);
  let count = 0;
  while (d.getMonth() === month) {
    if (d.getDay() === dayOfWeek) {
      count++;
      if (count === n) return d.getDate();
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

export function isHoliday(date) {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-11
  const day = date.getDate();

  // Fijos Oficiales + Navidad/Fin de año
  if (month === 0 && day === 1) return true; // 1 Ene
  if (month === 4 && day === 1) return true; // 1 May
  if (month === 8 && day === 16) return true; // 16 Sep
  if (month === 11 && day === 24) return true; // 24 Dic
  if (month === 11 && day === 25) return true; // 25 Dic
  if (month === 11 && day === 31) return true; // 31 Dic

  // Móviles
  if (month === 1 && day === getNthDayOfMonth(year, 1, 1, 1)) return true; // 1er Lunes Feb (5 Feb)
  if (month === 2 && day === getNthDayOfMonth(year, 2, 1, 3)) return true; // 3er Lunes Mar (21 Mar)
  if (month === 10 && day === getNthDayOfMonth(year, 10, 1, 3)) return true; // 3er Lunes Nov (20 Nov)

  // Jueves y Viernes Santo (Liverpool)
  const easter = getEaster(year);
  const juevesSanto = new Date(easter); juevesSanto.setDate(juevesSanto.getDate() - 3);
  const viernesSanto = new Date(easter); viernesSanto.setDate(viernesSanto.getDate() - 2);

  if (month === juevesSanto.getMonth() && day === juevesSanto.getDate()) return true;
  if (month === viernesSanto.getMonth() && day === viernesSanto.getDate()) return true;

  return false;
}

export function getBusinessMilliseconds(startMs, endMs) {
  if (!startMs || !endMs || startMs >= endMs) return 0;

  // Assume server time / issue time is mostly UTC or close to it,
  // we adjust by treating the epoch as Mexico City time (UTC-6)
  const tzOffsetMs = 6 * 60 * 60 * 1000;

  const start = new Date(startMs - tzOffsetMs);
  const end = new Date(endMs - tzOffsetMs);

  let current = new Date(start.getTime());
  let totalMs = 0;

  while (current < end) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();
    const date = current.getUTCDate();
    const dayOfWeek = current.getUTCDay(); // 0=Sun, 1=Mon...

    let nextDay = new Date(Date.UTC(year, month, date + 1, 0, 0, 0));
    let stepEnd = end < nextDay ? end : nextDay;

    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not weekend
      const localSimDate = new Date(year, month, date);
      if (!isHoliday(localSimDate)) {
        const startHour = 7;
        const endHour = dayOfWeek === 5 ? 13 : 18; // Vie = 13:00, L-J = 18:00

        const workStart = new Date(Date.UTC(year, month, date, startHour, 0, 0));
        const workEnd = new Date(Date.UTC(year, month, date, endHour, 0, 0));

        const overlapStart = current > workStart ? current : workStart;
        const overlapEnd = stepEnd < workEnd ? stepEnd : workEnd;

        if (overlapStart < overlapEnd) {
          totalMs += (overlapEnd - overlapStart);
        }
      }
    }
    current = nextDay;
  }

  return totalMs;
}

/**
 * Determines whether a Jira status name represents a terminal (Resolved / Closed / Done) state.
 * Supports Spanish and English workflow naming conventions used across QA projects.
 *
 * @param {string} statusStr - Raw Jira status name
 * @returns {boolean} True if the status is terminal
 */
export function isTerminalStatus(statusStr) {
  if (!statusStr) return false;
  const s = String(statusStr).toLowerCase().trim();
  return (
    s === 'closed' ||
    s === 'cerrado' ||
    s === 'cerrada' ||
    s.includes('cerrad') ||
    s.includes('closed')
  );
}

/**
 * Determines whether a Jira status name represents a paused / On Hold state
 * where the SLA & resolution clock must stop ticking.
 *
 * @param {string} statusStr - Raw Jira status name
 * @returns {boolean} True if the status is On Hold / paused
 */
export function isOnHoldStatus(statusStr) {
  if (!statusStr) return false;
  const s = String(statusStr).toLowerCase().trim();
  return (
    s.includes('on hold') ||
    s.includes('on-hold') ||
    s.includes('onhold') ||
    s.includes('en espera') ||
    s.includes('pausad') ||
    s.includes('standby') ||
    s.includes('stand by') ||
    s === 'hold' ||
    s.includes('pendiente cliente') ||
    s.includes('pendiente de cliente')
  );
}

/**
 * Inspects a Jira issue's changelog to compute accurate lifecycle metrics:
 * 1. Detects whether a bug was previously closed and later reopened (`isReopened`, `reopenedAt`, `reopenCount`).
 * 2. Detects whether the bug is currently in an ON HOLD status (`isOnHold`, `onHoldSince`) and pauses its clock.
 * 3. Calculates net active business hours (`activeBusinessHours` / `resolutionBusinessHours`) starting from the
 *    latest reopen date (if reopened) or creation date, excluding any time spent in ON HOLD or prior closed states.
 *    NOTE: Strictly only 'Cerrado', 'Cerrada', and 'Closed' are terminal. States like 'Resuelta' remain open/active.
 *
 * @param {Object} issue - Raw Jira issue payload (with optional `changelog.histories` and `fields`)
 * @returns {Object} Lifecycle metadata to merge into the normalized bug object
 */
export function analyzeBugChangelog(issue) {
  const fields = issue?.fields || {};
  const createdStr = fields.created || null;
  const resolutionDateStr = fields.resolutiondate || null;
  const currentStatus = fields.status?.name || 'To Do';
  // Strict business rule: ONLY 'closed', 'cerrado', 'cerrada' are considered closed.
  // Do NOT use statusCategory === 'done' because Jira maps 'Resuelta' to 'done' even though QA has not closed it yet.
  const isCurrentlyDone = isTerminalStatus(currentStatus);
  const isOnHold = !isCurrentlyDone && isOnHoldStatus(currentStatus);

  const createdMs = createdStr ? new Date(createdStr).getTime() : NaN;
  const nowMs = Date.now();

  if (isNaN(createdMs)) {
    return {
      isReopened: false,
      reopenedAt: null,
      reopenCount: 0,
      isOnHold,
      onHoldSince: null,
      onHoldBusinessHours: 0,
      activeBusinessHours: 0,
      resolutionBusinessHours: null,
      lastTerminalAt: resolutionDateStr || null
    };
  }

  // Extract and chronologically sort all status transitions from the issue changelog
  const histories = Array.isArray(issue?.changelog?.histories) ? issue.changelog.histories : [];
  const statusChanges = [];

  for (const h of histories) {
    const changeMs = h?.created ? new Date(h.created).getTime() : NaN;
    if (isNaN(changeMs)) continue;
    const items = Array.isArray(h?.items) ? h.items : [];
    for (const item of items) {
      if (item.field === 'status' || String(item.field || '').toLowerCase() === 'status') {
        statusChanges.push({
          atMs: changeMs,
          atIso: h.created,
          from: item.fromString || '',
          to: item.toString || ''
        });
      }
    }
  }

  statusChanges.sort((a, b) => a.atMs - b.atMs);

  let isReopened = false;
  let reopenedAt = null;
  let reopenCount = 0;
  let lastTerminalAt = null;
  let onHoldSince = null;

  for (const ch of statusChanges) {
    const fromTerm = isTerminalStatus(ch.from);
    const toTerm = isTerminalStatus(ch.to);
    const toLower = String(ch.to || '').toLowerCase();

    // A reopen occurs when transitioning out of a terminal status into a non-terminal status,
    // or when transitioning explicitly into a "Reopened / Reabierto" status.
    if ((fromTerm && !toTerm) || (!toTerm && (toLower.includes('reabiert') || toLower.includes('reopen')))) {
      isReopened = true;
      reopenedAt = ch.atIso;
      reopenCount++;
    }

    // Track the most recent transition into a terminal status (fallback when resolutiondate is null)
    if (!fromTerm && toTerm) {
      lastTerminalAt = ch.atIso;
    }

    // Track when the bug entered an On Hold status
    if (isOnHoldStatus(ch.to) && !isOnHoldStatus(ch.from)) {
      onHoldSince = ch.atIso;
    } else if (!isOnHoldStatus(ch.to)) {
      onHoldSince = null;
    }
  }

  // Fallback if the current status name itself explicitly indicates reopened
  const currentLower = String(currentStatus).toLowerCase();
  if (!isReopened && (currentLower.includes('reabiert') || currentLower.includes('reopen'))) {
    isReopened = true;
  }

  if (isOnHold && !onHoldSince) {
    onHoldSince = createdStr;
  }

  // If the bug was reopened, the active timer resets at the most recent reopen timestamp
  const reopenMs = isReopened && reopenedAt ? new Date(reopenedAt).getTime() : NaN;
  const cycleStartMs = !isNaN(reopenMs) && reopenMs >= createdMs ? reopenMs : createdMs;

  let activeMs = 0;
  let onHoldMs = 0;
  let resolutionMs = null;

  if (statusChanges.length === 0) {
    // No changelog history available: calculate directly from cycleStartMs
    if (isCurrentlyDone) {
      const resMs = resolutionDateStr ? new Date(resolutionDateStr).getTime() : NaN;
      const effectiveEndMs = !isNaN(resMs) && resMs >= cycleStartMs ? resMs : cycleStartMs;
      resolutionMs = getBusinessMilliseconds(cycleStartMs, effectiveEndMs);
      activeMs = resolutionMs;
    } else if (isOnHold) {
      activeMs = 0;
    } else {
      activeMs = getBusinessMilliseconds(cycleStartMs, nowMs);
    }
  } else {
    // Build contiguous status segments from creation to now
    const segments = [];
    let cursorMs = createdMs;
    let cursorStatus = statusChanges[0].from || currentStatus;

    for (const ch of statusChanges) {
      const segEnd = Math.max(cursorMs, ch.atMs);
      segments.push({
        status: cursorStatus,
        startMs: cursorMs,
        endMs: segEnd
      });
      cursorMs = segEnd;
      cursorStatus = ch.to;
    }
    segments.push({
      status: cursorStatus,
      startMs: cursorMs,
      endMs: Math.max(cursorMs, nowMs)
    });

    // Determine effective end timestamp for closed bugs (prefer actual transition to Cerrada/Closed over Resuelta resolutiondate)
    let resolvedEndMs = nowMs;
    if (isCurrentlyDone) {
      const resFieldMs = resolutionDateStr ? new Date(resolutionDateStr).getTime() : NaN;
      const lastTermMs = lastTerminalAt ? new Date(lastTerminalAt).getTime() : NaN;
      if (!isNaN(lastTermMs) && lastTermMs >= cycleStartMs) {
        resolvedEndMs = lastTermMs;
      } else if (!isNaN(resFieldMs) && resFieldMs >= cycleStartMs) {
        resolvedEndMs = resFieldMs;
      } else {
        resolvedEndMs = cycleStartMs;
      }
    }

    const targetEndMs = isCurrentlyDone ? resolvedEndMs : nowMs;

    for (const seg of segments) {
      const sStart = Math.max(seg.startMs, cycleStartMs);
      const sEnd = Math.min(seg.endMs, targetEndMs);
      if (sEnd <= sStart) continue;

      if (isOnHoldStatus(seg.status)) {
        onHoldMs += getBusinessMilliseconds(sStart, sEnd);
      } else if (!isTerminalStatus(seg.status)) {
        activeMs += getBusinessMilliseconds(sStart, sEnd);
      }
    }

    if (isCurrentlyDone) {
      resolutionMs = activeMs;
    }
  }

  const activeBusinessHours = Number((activeMs / (1000 * 60 * 60)).toFixed(2));
  const onHoldBusinessHours = Number((onHoldMs / (1000 * 60 * 60)).toFixed(2));
  const resolutionBusinessHours = resolutionMs !== null ? Number((resolutionMs / (1000 * 60 * 60)).toFixed(2)) : null;

  return {
    isReopened,
    reopenedAt,
    reopenCount,
    isOnHold,
    onHoldSince,
    onHoldBusinessHours,
    activeBusinessHours,
    resolutionBusinessHours,
    lastTerminalAt: resolutionDateStr || lastTerminalAt || null
  };
}


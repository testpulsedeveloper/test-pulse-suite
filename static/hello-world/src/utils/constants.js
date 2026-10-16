export const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'iter_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
};

export const normalizeUiStatus = (status) => {
  if (!status) return 'Not Run';
  const s = String(status).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if ([
    'passed', 'pass', 'listo', 'done', 'aprobado', 'aprobada', 'exito', 'exitoso', 'exitosa',
    'finalizado', 'finalizada', 'completado', 'completada', 'terminado', 'terminada',
    'resuelto', 'resuelta', 'resolved', 'closed', 'cerrado', 'cerrada', 'ok',
    'satisfactorio', 'satisfactoria', 'superado', 'superada', 'conforme', 'validated',
    'validado', 'validada', 'accepted', 'aceptado', 'aceptada', 'success', 'successful'
  ].includes(s)) return 'Passed';
  if ([
    'failed', 'fail', 'fallido', 'fallida', 'fallo', 'rechazado', 'rechazada',
    'error', 'defectuoso', 'defectuosa', 'no superado', 'no superada', 'no conforme',
    'no paso', 'rejected', 'failing', 'bug', 'descartado', 'descartada'
  ].includes(s)) return 'Failed';
  if ([
    'blocked', 'block', 'bloqueado', 'bloqueada', 'bloqueo', 'impedido', 'impedida',
    'detenido', 'detenida', 'pausado', 'pausada', 'on hold', 'hold', 'detener', 'bloq'
  ].includes(s)) return 'Blocked';
  if ([
    'in progress', 'en curso', 'en progreso', 'running', 'en desarrollo', 'en pruebas',
    'en ejecucion', 'en revision', 'testing', 'qa', 'in review', 'ejecutando',
    'en proceso', 'work in progress', 'wip'
  ].includes(s)) return 'In Progress';
  return 'Not Run';
};

export const DEFAULT_DASHBOARD_WIDGETS = [
  { id: 'w_kpi_scorecard', type: 'kpi_scorecard', title: 'Métricas Clave (Bento Grid)', width: 'full', visible: true },
  { id: 'w_general_status', type: 'general_status', title: 'Estado General de Pruebas', width: 'half', visible: true },
  { id: 'w_manual_vs_auto', type: 'manual_vs_auto', title: 'Ejecución: Manual vs Auto', width: 'half', visible: true },
  { id: 'w_tester_stats', type: 'tester_stats', title: 'Estado por QA Tester', width: 'half', visible: true },
  { id: 'w_module_stats', type: 'module_stats', title: 'Estado por Módulo / Funcionalidad', width: 'half', visible: true },
  { id: 'w_cycles_progress', type: 'cycles_progress', title: 'Progreso por Ciclo de Pruebas', width: 'full', visible: true },
];

export const AVAILABLE_WIDGET_CATALOG = [
  {
    type: 'kpi_scorecard',
    title: 'Métricas Clave (Bento Grid)',
    category: 'Métricas',
    categoryColor: '#0C66E4',
    icon: '📊',
    defaultWidth: 'full',
    description: 'Scorecard con 5 tarjetas ejecutivas: Total de Casos, Tasa de Éxito, Defectos Abiertos, MTTR y Cobertura.'
  },
  {
    type: 'general_status',
    title: 'Estado General de Pruebas',
    category: 'Calidad',
    categoryColor: '#36B37E',
    icon: '🍩',
    defaultWidth: 'half',
    description: 'Gráfico Donut interactivo con desglose de casos Pasados, Fallados, Bloqueados y Sin Ejecutar.'
  },
  {
    type: 'manual_vs_auto',
    title: 'Ejecución: Manual vs Auto',
    category: 'Automatización',
    categoryColor: '#6554C0',
    icon: '⚡',
    defaultWidth: 'half',
    description: 'Comparativa de volumen, tasas de aprobación y velocidad entre pruebas automatizadas y manuales.'
  },
  {
    type: 'tester_stats',
    title: 'Estado por QA Tester',
    category: 'Equipo',
    categoryColor: '#FFAB00',
    icon: '👥',
    defaultWidth: 'half',
    description: 'Productividad, balance de carga y desglose de avance por cada tester asignado con avatares.'
  },
  {
    type: 'module_stats',
    title: 'Estado por Módulo / Funcionalidad',
    category: 'Calidad',
    categoryColor: '#36B37E',
    icon: '🧱',
    defaultWidth: 'half',
    description: 'Cobertura funcional agrupada por carpetas/módulos con semáforo de nivel de riesgo (Alto, Medio, Estable).'
  },
  {
    type: 'cycles_progress',
    title: 'Progreso por Ciclo de Pruebas',
    category: 'Métricas',
    categoryColor: '#0C66E4',
    icon: '🔄',
    defaultWidth: 'full',
    description: 'Barras apiladas de avance individual para cada Ciclo de Pruebas activo en el proyecto.'
  },
  {
    type: 'severity_breakdown',
    title: 'Distribución de Defectos por Severidad',
    category: 'Defectos',
    categoryColor: '#DE350B',
    icon: '🐞',
    defaultWidth: 'half',
    description: 'Conteo y proporciones de bugs clasificados en Bloqueante, Crítico, Mayor, Menor y Sin Definir.'
  },
  {
    type: 'automation_health',
    title: 'Salud de Automatización & CI/CD',
    category: 'Automatización',
    categoryColor: '#6554C0',
    icon: '🚀',
    defaultWidth: 'half',
    description: 'Métricas de madurez de automatización, ratio de automatización y preparación de la suite para CI/CD.'
  }
];

export function formatAttachmentSize(bytes) {
  if (!bytes || isNaN(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export const MX_HOLIDAYS_SET = new Set([
  '2024-01-01', '2024-02-05', '2024-03-18', '2024-05-01', '2024-09-16', '2024-10-01', '2024-11-18', '2024-12-25',
  '2025-01-01', '2025-02-03', '2025-03-17', '2025-05-01', '2025-09-16', '2025-11-17', '2025-12-25',
  '2026-01-01', '2026-02-02', '2026-03-16', '2026-05-01', '2026-09-16', '2026-11-16', '2026-12-25',
  '2027-01-01', '2027-02-01', '2027-03-15', '2027-05-01', '2027-09-16', '2027-11-15', '2027-12-25'
]);

export function getBusinessHoursBetween(startMs, endMs) {
  if (!startMs || !endMs || startMs >= endMs) return 0;
  let current = new Date(startMs);
  const end = new Date(endMs);
  let businessMinutes = 0;
  const mxOffset = -6 * 60 * 60 * 1000;

  while (current < end) {
    const mxTime = new Date(current.getTime() + mxOffset);
    const day = mxTime.getUTCDay();
    const hour = mxTime.getUTCHours();
    const dateString = mxTime.toISOString().split('T')[0];

    let isBusiness = false;
    if (!MX_HOLIDAYS_SET.has(dateString)) {
      if (day >= 1 && day <= 4) {
        if (hour >= 7 && hour < 18) isBusiness = true;
      } else if (day === 5) {
        if (hour >= 7 && hour < 13) isBusiness = true;
      }
    }
    if (isBusiness) businessMinutes++;
    current.setTime(current.getTime() + 60000);
  }
  return businessMinutes / 60;
}

export function formatBugCreatedDate(createdStr) {
  if (!createdStr) return { dateStr: 'Sin fecha', timeStr: '' };
  try {
    const d = new Date(createdStr);
    if (isNaN(d.getTime())) return { dateStr: 'Sin fecha', timeStr: '' };
    const dateStr = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return { dateStr, timeStr };
  } catch (e) {
    return { dateStr: 'Sin fecha', timeStr: '' };
  }
}

/**
 * Formats the business-time age or resolution time of a bug using the Mexico City / Liverpool business calendar.
 *
 * Key business rules:
 * 1. Reopened bugs (`bugMeta.isReopened`):
 *    - Counter resets from `bugMeta.reopenedAt` (or uses precomputed `bugMeta.activeBusinessHours`).
 *    - Label uses `"Re abierto hace ..."` instead of `"Abierto hace ..."`.
 * 2. On Hold bugs (`bugMeta.isOnHold` or status matching `ON HOLD` / `En espera` / `Pausado`):
 *    - Clock is paused while in On Hold (`activeBusinessHours` excludes On Hold intervals, or stops at `onHoldSince`).
 *    - Never marked in red (`tone = 'onhold'`).
 * 3. Resolved / Closed bugs (`isDone`):
 *    - Uses net active business hours (`bugMeta.resolutionBusinessHours`) or calculates from `reopenedAt || created`
 *      to `resolutionDateStr || bugMeta.lastTerminalAt` without falling back to `Date.now()` when resolutionDate is missing.
 *
 * @param {string} createdStr - ISO creation date string
 * @param {string|null} resolutionDateStr - ISO resolution date string (if resolved)
 * @param {boolean} isDone - Whether the bug is in a terminal/resolved status
 * @param {Object} [bugMeta={}] - Optional bug metadata (isReopened, reopenedAt, isOnHold, onHoldSince, activeBusinessHours, resolutionBusinessHours, status)
 * @returns {{ label: string, tone: string, hours: number, days: number, bHoursFormatted: string, isReopened: boolean, isOnHold: boolean }}
 */
export function formatBugAge(createdStr, resolutionDateStr, isDone, bugMeta = {}) {
  if (!createdStr) return { label: 'Sin registro', tone: 'neutral', hours: 0, days: 0, bHoursFormatted: '0', isReopened: false, isOnHold: false };
  try {
    const created = new Date(createdStr).getTime();
    if (isNaN(created)) return { label: 'Sin registro', tone: 'neutral', hours: 0, days: 0, bHoursFormatted: '0', isReopened: false, isOnHold: false };

    const statusLower = String(bugMeta?.status || '').toLowerCase().trim();
    const isOnHold = !isDone && (
      Boolean(bugMeta?.isOnHold) ||
      statusLower.includes('on hold') ||
      statusLower.includes('on-hold') ||
      statusLower.includes('onhold') ||
      statusLower.includes('en espera') ||
      statusLower.includes('pausad') ||
      statusLower === 'hold'
    );
    const isReopened = Boolean(bugMeta?.isReopened) || statusLower.includes('reabiert') || statusLower.includes('reopen');

    // Determine effective start timestamp (reopenedAt resets the clock when present)
    const reopenedMs = isReopened && bugMeta?.reopenedAt ? new Date(bugMeta.reopenedAt).getTime() : NaN;
    const effectiveStart = !isNaN(reopenedMs) && reopenedMs >= created ? reopenedMs : created;

    let businessHours = 0;

    if (isDone) {
      if (typeof bugMeta?.resolutionBusinessHours === 'number' && !isNaN(bugMeta.resolutionBusinessHours)) {
        businessHours = Math.max(0, bugMeta.resolutionBusinessHours);
      } else {
        const effectiveResStr = resolutionDateStr || bugMeta?.lastTerminalAt || null;
        if (effectiveResStr) {
          const resTime = new Date(effectiveResStr).getTime();
          if (!isNaN(resTime) && resTime >= effectiveStart) {
            businessHours = getBusinessHoursBetween(effectiveStart, resTime);
          }
        }
      }
    } else if (typeof bugMeta?.activeBusinessHours === 'number' && !isNaN(bugMeta.activeBusinessHours)) {
      // Backend pre-calculated net active business hours (already excludes ON HOLD & pre-reopen closed intervals)
      businessHours = Math.max(0, bugMeta.activeBusinessHours);
    } else {
      // Frontend fallback calculation
      let end = Date.now();
      if (isOnHold && bugMeta?.onHoldSince) {
        const holdMs = new Date(bugMeta.onHoldSince).getTime();
        if (!isNaN(holdMs) && holdMs >= effectiveStart) {
          end = holdMs;
        }
      }
      businessHours = getBusinessHoursBetween(effectiveStart, end);
    }

    const bHoursFormatted = businessHours.toFixed(1);
    const bDays = Math.floor(businessHours / 10);

    let label = '';
    let tone = 'neutral';
    const openPrefix = isReopened ? 'Re abierto hace' : 'Abierto hace';

    if (isDone) {
      if (businessHours < 1) {
        const mins = Math.max(1, Math.round(businessHours * 60));
        label = `Resuelto en ${mins}m hábiles`;
      } else if (businessHours < 10) {
        label = `Resuelto en ${bHoursFormatted}h hábiles`;
      } else {
        const days = Math.round(businessHours / 10);
        label = `Resuelto en ${days}d hábiles (${bHoursFormatted}h)`;
      }
      tone = 'done';
    } else if (isOnHold) {
      // On Hold bugs freeze their clock and NEVER turn red
      if (businessHours < 1) {
        const mins = Math.max(0, Math.round(businessHours * 60));
        label = `${openPrefix} ${mins}m hábiles · En pausa`;
      } else if (businessHours < 10) {
        label = `${openPrefix} ${bHoursFormatted}h hábiles · En pausa`;
      } else {
        const days = Math.floor(businessHours / 10);
        const dayWord = days === 1 ? 'hábil' : 'hábiles';
        label = `${openPrefix} ${days}d ${dayWord} (${bHoursFormatted}h) · En pausa`;
      }
      tone = 'onhold';
    } else {
      if (businessHours < 1) {
        const mins = Math.max(1, Math.round(businessHours * 60));
        label = `${openPrefix} ${mins}m hábiles`;
        tone = 'green';
      } else if (businessHours <= 20) {
        const days = Math.floor(businessHours / 10);
        const dayWord = days === 1 ? 'hábil' : 'hábiles';
        label = days > 0 ? `${openPrefix} ${days}d ${dayWord} (${bHoursFormatted}h)` : `${openPrefix} ${bHoursFormatted}h hábiles`;
        tone = 'green';
      } else if (businessHours <= 50) {
        const days = Math.floor(businessHours / 10);
        label = `${openPrefix} ${days}d hábiles (${bHoursFormatted}h)`;
        tone = 'orange';
      } else {
        const days = Math.floor(businessHours / 10);
        label = `${openPrefix} ${days}d hábiles (${bHoursFormatted}h)`;
        tone = 'red';
      }
    }

    return { label, tone, hours: businessHours, days: bDays, bHoursFormatted, isReopened, isOnHold };
  } catch (e) {
    return { label: 'Sin registro', tone: 'neutral', hours: 0, days: 0, bHoursFormatted: '0', isReopened: false, isOnHold: false };
  }
}


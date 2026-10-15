// === Evidences Deduplication, ADF Validation & Jira Status Normalization Helpers ===

export const getIterationEvidenceKeys = (iterations) => {
  const keys = new Set();
  if (Array.isArray(iterations)) {
    for (const iter of iterations) {
      if (Array.isArray(iter?.evidences)) {
        for (const ev of iter.evidences) {
          if (!ev) continue;
          if (typeof ev === 'object') {
            if (ev.id) keys.add(String(ev.id));
            if (ev.filename) keys.add(String(ev.filename));
            if (ev.url) keys.add(String(ev.url));
          } else {
            keys.add(String(ev));
          }
        }
      }
    }
  }
  return keys;
};

export const dedupeEvidences = (list) => {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const ev of list) {
    if (!ev) continue;
    const evId = typeof ev === 'string' ? ev : (ev.id ? String(ev.id) : null);
    const evUrl = typeof ev === 'object' && ev.url ? String(ev.url) : null;
    const evName = typeof ev === 'object' && ev.filename ? String(ev.filename) : (typeof ev === 'string' ? ev : null);

    const key = evId ? `id:${evId}` : (evUrl ? `url:${evUrl}` : (evName ? `name:${evName}` : JSON.stringify(ev)));
    if (!seen.has(key)) {
      seen.add(key);
      result.push(typeof ev === 'string' ? { id: ev, filename: `evidence_${ev}.jpg` } : ev);
    }
  }
  return result;
};

export const filterNonIterationEvidences = (evidencesList, iterationKeys) => {
  if (!Array.isArray(evidencesList)) return [];
  const deduped = dedupeEvidences(evidencesList);
  if (!iterationKeys || iterationKeys.size === 0) return deduped;
  return deduped.filter(ev => {
    if (!ev) return false;
    const evId = typeof ev === 'object' ? (ev.id ? String(ev.id) : null) : String(ev);
    const evUrl = typeof ev === 'object' && ev.url ? String(ev.url) : null;
    const evName = typeof ev === 'object' && ev.filename ? String(ev.filename) : (typeof ev === 'string' ? ev : null);
    if (evId && iterationKeys.has(evId)) return false;
    if (evUrl && iterationKeys.has(evUrl)) return false;
    if (evName && iterationKeys.has(evName)) return false;
    return true;
  });
};

export const ensureValidAdf = (desc, fallbackText = '') => {
  if (desc && typeof desc === 'object' && desc.type === 'doc' && Array.isArray(desc.content)) {
    return desc;
  }
  let text = fallbackText;
  if (typeof desc === 'string' && desc.trim()) {
    text = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: text || 'Snapshot del caso de prueba'
          }
        ]
      }
    ]
  };
};

export function normalizeJiraStatus(status) {
  if (!status) return 'Not Run';
  const s = String(status).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // removes accents: éxito -> exito, ejecución -> ejecucion

  // 1. PASSED / LISTO / ÉXITO / APROBADO / RESUELTO / FINALIZADO
  if ([
    'passed', 'pass', 'listo', 'done', 'aprobado', 'aprobada', 'exito', 'exitoso', 'exitosa',
    'finalizado', 'finalizada', 'completado', 'completada', 'terminado', 'terminada',
    'resuelto', 'resuelta', 'resolved', 'closed', 'cerrado', 'cerrada', 'ok',
    'satisfactorio', 'satisfactoria', 'superado', 'superada', 'conforme', 'validated',
    'validado', 'validada', 'accepted', 'aceptado', 'aceptada', 'success', 'successful'
  ].includes(s)) return 'Passed';

  // 2. FAILED / FALLIDO / RECHAZADO / ERROR
  if ([
    'failed', 'fail', 'fallido', 'fallida', 'fallo', 'rechazado', 'rechazada',
    'error', 'defectuoso', 'defectuosa', 'no superado', 'no superada', 'no conforme',
    'no paso', 'rejected', 'failing', 'bug', 'descartado', 'descartada'
  ].includes(s)) return 'Failed';

  // 3. BLOCKED / BLOQUEADO / IMPEDIDO
  if ([
    'blocked', 'block', 'bloqueado', 'bloqueada', 'bloqueo', 'impedido', 'impedida',
    'detenido', 'detenida', 'pausado', 'pausada', 'on hold', 'hold', 'detener', 'bloq'
  ].includes(s)) return 'Blocked';

  // 4. IN PROGRESS / EN CURSO / EN PROGRESO / TESTING
  if ([
    'in progress', 'en curso', 'en progreso', 'running', 'en desarrollo', 'en pruebas',
    'en ejecucion', 'en revision', 'testing', 'qa', 'in review', 'ejecutando',
    'en proceso', 'work in progress', 'wip'
  ].includes(s)) return 'In Progress';

  // 5. NOT RUN / TO DO / POR HACER / PENDIENTE / ABIERTO
  if ([
    'not run', 'to do', 'por hacer', 'pendiente', 'abierto', 'open', 'backlog',
    'nuevo', 'new', 'sin ejecutar', 'none', 'unexecuted', 'draft', 'borrador',
    'por probar', 'to test', 'untested'
  ].includes(s)) return 'Not Run';

  return status;
}

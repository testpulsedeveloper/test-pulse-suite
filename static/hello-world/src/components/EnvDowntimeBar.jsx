/**
 * EnvDowntimeBar.jsx — "Ambiente no disponible" in Ejecución (Test Pulse 5.0, v4.42.0).
 *
 * A slim bar under the cycle header that:
 *   - shows every OPEN downtime report of the project (environment, component, ticket and
 *     how long it has been down) with a "Marcar como restablecido" button;
 *   - has the "Ambiente no disponible" button, which opens a small form to report one.
 *
 * Reporting never changes any test case: it only records the lost time so it can be shown
 * in Planeación/Calidad and doesn't count against the testers' progress.
 *
 * Data: resolvers getEnvDowntime / reportEnvDowntime / resolveEnvDowntime (KVS, per project).
 * It is read when the bar mounts, when the window regains focus (someone may have reported
 * from another computer) and after each action. No polling while the tab is in the background.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from '@forge/bridge';
import { invoke } from '../utils/queryClient';

// "hace 2 h 15 min" style durations, in Spanish.
const since = (iso, now = Date.now()) => {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60); const m = mins % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24); const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
};

// Opens the ticket in a new tab. A Jira key goes to this site's issue page (router.open resolves
// relative paths against the Jira site, not the app's iframe); a URL is opened as is.
const openTicket = (ticket) => {
  const target = /^https:\/\//i.test(ticket) ? ticket : `/browse/${encodeURIComponent(ticket)}`;
  router.open(target).catch(() => {});
};

export default function EnvDowntimeBar({ projectId, environments, cycle, addNotification }) {
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ envId: '', scope: 'all', component: '', ticket: '', note: '' });

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await invoke('getEnvDowntime', { projectId });
      setEvents(Array.isArray(res?.events) ? res.events : []);
    } catch (_) {
      // A failed read just leaves the bar without reports; reporting still works.
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const open = useMemo(() => events.filter(e => !e.endedAt), [events]);
  const envList = Array.isArray(environments) ? environments : [];
  // Default the form to the cycle's environment when it is in the catalog.
  const defaultEnvId = useMemo(() => {
    const byName = envList.find(e => e.name && cycle?.environment && e.name === cycle.environment);
    return (byName || envList[0] || {}).id || '';
  }, [envList, cycle?.environment]);
  const selectedEnv = envList.find(e => e.id === (form.envId || defaultEnvId)) || null;
  const components = selectedEnv?.components || [];

  const openForm = () => {
    setForm({ envId: defaultEnvId, scope: 'all', component: '', ticket: '', note: '' });
    setFormOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!selectedEnv) return;
    if (form.scope === 'component' && !form.component.trim()) {
      addNotification({ type: 'warning', title: 'Falta el componente', description: 'Elige o escribe el componente que falla.' });
      return;
    }
    setSaving(true);
    try {
      const res = await invoke('reportEnvDowntime', {
        projectId,
        envId: selectedEnv.id,
        envName: selectedEnv.name,
        component: form.scope === 'component' ? form.component.trim() : '',
        ticket: form.ticket.trim(),
        note: form.note.trim(),
        cycleId: cycle?.id ? String(cycle.id) : ''
      });
      setEvents(Array.isArray(res?.events) ? res.events : []);
      setFormOpen(false);
      addNotification({ type: 'warning', title: 'Ambiente reportado como no disponible', description: 'El equipo verá el aviso en Ejecución. Ningún caso cambió de estado.' });
    } catch (err) {
      addNotification({ type: 'error', title: 'No se pudo reportar', description: err?.message || 'Intenta de nuevo.' });
    } finally {
      setSaving(false);
    }
  };

  const restore = async (id) => {
    setBusyId(id);
    try {
      const res = await invoke('resolveEnvDowntime', { projectId, id });
      setEvents(Array.isArray(res?.events) ? res.events : []);
      addNotification({ type: 'success', title: 'Ambiente restablecido', description: 'El tiempo sin servicio quedó registrado.' });
    } catch (err) {
      addNotification({ type: 'error', title: 'No se pudo marcar como restablecido', description: err?.message || 'Intenta de nuevo.' });
      load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="tp5-downtime">
      <div className="tp5-downtime__row">
        {open.length === 0 ? (
          <span className="tp5-downtime__ok">
            <span className="tp5-dot tp5-dot--ok" aria-hidden="true" />
            {loaded ? 'Sin reportes de ambiente no disponible' : 'Consultando ambientes…'}
          </span>
        ) : (
          <span className="tp5-downtime__title">
            <span className="tp5-dot tp5-dot--bad" aria-hidden="true" />
            {open.length === 1 ? '1 ambiente no disponible' : `${open.length} reportes de ambiente no disponible`}
          </span>
        )}
        <button type="button" className="tp5-btn tp5-btn--danger-subtle" onClick={openForm} disabled={envList.length === 0}>
          Ambiente no disponible
        </button>
      </div>

      {open.map(ev => (
        <div key={ev.id} className="tp5-downtime__event" role="status">
          <span className="tp5-downtime__what">
            <strong>{ev.envName}{ev.component ? ` · ${ev.component}` : ' · todo el ambiente'}</strong>
            <span className="tp5-subtle tp5-small">Sin servicio desde hace {since(ev.startedAt)}{ev.note ? ` · ${ev.note}` : ''}</span>
          </span>
          {ev.ticket
            ? <button type="button" className="tp5-link" onClick={() => openTicket(ev.ticket)}>Ticket {/^https:/i.test(ev.ticket) ? 'del incidente' : ev.ticket}</button>
            : <span className="tp5-subtle tp5-small">Sin ticket</span>}
          <button type="button" className="tp5-btn tp5-btn--secondary tp5-btn--sm" onClick={() => restore(ev.id)} disabled={busyId === ev.id}>
            {busyId === ev.id ? 'Guardando…' : 'Marcar como restablecido'}
          </button>
        </div>
      ))}

      {formOpen && (
        <div className="tp5-modal-backdrop" role="presentation" onClick={() => !saving && setFormOpen(false)}>
          <form className="tp5-modal" role="dialog" aria-modal="true" aria-label="Reportar ambiente no disponible" onClick={e => e.stopPropagation()} onSubmit={submit}>
            <h2 className="tp5-h2">Ambiente no disponible</h2>
            <p className="tp5-subtle tp5-small" style={{ margin: 0 }}>
              El equipo verá el aviso con el ticket. Reportarlo no cambia el estado de ningún caso.
            </p>

            <label className="tp5-field">
              <span>Ambiente</span>
              <select value={form.envId || defaultEnvId} onChange={e => setForm(f => ({ ...f, envId: e.target.value, component: '' }))}>
                {envList.map(env => <option key={env.id} value={env.id}>{env.name}</option>)}
              </select>
            </label>

            <fieldset className="tp5-field">
              <legend>¿Qué falla?</legend>
              <label className="tp5-radio"><input type="radio" name="tp5-scope" checked={form.scope === 'all'} onChange={() => setForm(f => ({ ...f, scope: 'all' }))} /> Todo el ambiente</label>
              <label className="tp5-radio"><input type="radio" name="tp5-scope" checked={form.scope === 'component'} onChange={() => setForm(f => ({ ...f, scope: 'component' }))} /> Un componente</label>
              {form.scope === 'component' && (components.length > 0 ? (
                <select value={form.component} onChange={e => setForm(f => ({ ...f, component: e.target.value }))} aria-label="Componente">
                  <option value="">Elige el componente…</option>
                  {components.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input type="text" maxLength={80} value={form.component} onChange={e => setForm(f => ({ ...f, component: e.target.value }))} placeholder="Nombre del componente" aria-label="Componente" />
              ))}
            </fieldset>

            <label className="tp5-field">
              <span>Ticket del incidente <em className="tp5-subtle">(recomendado)</em></span>
              <input type="text" maxLength={300} value={form.ticket} onChange={e => setForm(f => ({ ...f, ticket: e.target.value }))} placeholder="INC-1234 o enlace https" />
            </label>

            <label className="tp5-field">
              <span>Nota <em className="tp5-subtle">(opcional)</em></span>
              <input type="text" maxLength={500} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Qué se observa" />
            </label>

            <div className="tp5-modal__actions">
              <button type="button" className="tp5-btn tp5-btn--secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</button>
              <button type="submit" className="tp5-btn tp5-btn--primary" disabled={saving || !selectedEnv}>{saving ? 'Reportando…' : 'Reportar'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

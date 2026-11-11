/**
 * @file LifecycleEditorsCard.jsx
 * @description Settings card "Editores de Lifecycle" (v4.19.0).
 *
 * Everybody in the project can SEE the Lifecycle tab. This card is where a project administrator
 * picks the people who can also CHANGE it (create initiatives, add or edit deliverables). The
 * list is stored by the backend per project, so no Jira group is needed.
 *
 * How it works:
 *   - On mount it loads the current list with the `getLifecycleEditors` resolver.
 *   - Typing in the search box looks people up with the existing `searchAssignableUsers`
 *     resolver (the same one used to assign testers), 300 ms after the last keystroke.
 *   - Adding or removing a person saves the whole list at once with `saveLifecycleEditors`.
 *     The backend checks again that the caller administers the project.
 */

import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '../utils/queryClient';

// Same look as the other Settings cards (they share these CSS variables).
const cardStyle = {
  background: 'var(--bg-surface, #161b22)',
  border: '1px solid var(--ds-border, #30363d)',
  borderRadius: '10px',
  padding: '1.5rem 1.75rem',
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
};
const mutedStyle = { color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' };

/** Small round avatar; falls back to the first letter of the name when there is no picture. */
const Avatar = ({ user }) => (user.avatarUrl
  ? <img src={user.avatarUrl} alt="" style={{ width: '22px', height: '22px', borderRadius: '50%' }} />
  : (
    <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#0C66E4', color: '#FFFFFF', fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {String(user.displayName || '?').charAt(0).toUpperCase()}
    </span>
  ));

export default function LifecycleEditorsCard({ projectId, addNotification }) {
  const [editors, setEditors] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  // Sequence number of the latest search, so a slow old answer never replaces a newer one.
  const searchSeqRef = useRef(0);

  // Load the current editors when the card opens or the project changes.
  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    setLoading(true);
    invoke('getLifecycleEditors', { projectId })
      .then(res => {
        if (cancelled) return;
        setEditors(res?.editors || []);
        setCanManage(Boolean(res?.canManage));
      })
      .catch(() => { if (!cancelled) setEditors([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Search people while typing (debounced). Fewer than 2 characters clears the results.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2 || !projectId) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    const timer = setTimeout(() => {
      invoke('searchAssignableUsers', { projectId, query: text })
        .then(users => { if (seq === searchSeqRef.current) setResults(Array.isArray(users) ? users : []); })
        .catch(() => { if (seq === searchSeqRef.current) setResults([]); })
        .finally(() => { if (seq === searchSeqRef.current) setSearching(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, projectId]);

  /** Saves the new list; on error the previous list is shown again. */
  const saveEditors = async (nextEditors, successTitle) => {
    const previous = editors;
    setEditors(nextEditors);
    setSaving(true);
    try {
      const res = await invoke('saveLifecycleEditors', { projectId, editors: nextEditors });
      setEditors(res?.editors || nextEditors);
      addNotification({ type: 'success', title: successTitle });
    } catch (error) {
      setEditors(previous);
      addNotification({ type: 'error', title: 'No se pudo guardar la lista de editores', description: error?.message || String(error || '') });
    } finally {
      setSaving(false);
    }
  };

  const addEditor = (user) => {
    if (editors.some(editor => editor.accountId === user.accountId)) return;
    setQuery('');
    setResults([]);
    saveEditors(
      [...editors, { accountId: user.accountId, displayName: user.displayName, avatarUrl: user.avatarUrl || '' }],
      `${user.displayName} ahora puede editar Lifecycle`
    );
  };

  const removeEditor = (user) => saveEditors(
    editors.filter(editor => editor.accountId !== user.accountId),
    `${user.displayName} ya no puede editar Lifecycle`
  );

  // People found that are not editors yet.
  const candidates = results.filter(user => !editors.some(editor => editor.accountId === user.accountId));

  return (
    <div className="glass" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '1.3rem' }}>🧭</span>
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
          Editores de Lifecycle
        </h2>
      </div>
      <p style={{ margin: '0 0 1rem 0', ...mutedStyle }}>
        Todos los usuarios del proyecto pueden ver la pestaña Lifecycle. Solo las personas de esta lista,
        los administradores del proyecto y los superusuarios de Test Pulse pueden crear iniciativas y
        agregar o editar entregables.
      </p>

      {loading ? (
        <div style={mutedStyle}>Cargando editores…</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '1rem' }}>
            {editors.length === 0 && (
              <span style={mutedStyle}>Aún no hay editores: por ahora solo los administradores pueden hacer cambios.</span>
            )}
            {editors.map(editor => (
              <span key={editor.accountId} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 8px 4px 4px', borderRadius: '16px', border: '1px solid var(--ds-border, #30363d)', color: 'var(--text-primary, #e6edf3)', fontSize: '0.85rem' }}>
                <Avatar user={editor} />
                {editor.displayName}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => removeEditor(editor)}
                    disabled={saving}
                    title={`Quitar a ${editor.displayName}`}
                    aria-label={`Quitar a ${editor.displayName}`}
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-secondary, #8b949e)', cursor: saving ? 'default' : 'pointer', fontSize: '0.9rem', padding: '0 2px' }}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>

          {canManage ? (
            <div style={{ maxWidth: '420px' }}>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Busca a una persona por nombre para agregarla"
                disabled={saving}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--ds-border, #30363d)', background: 'var(--bg-default, transparent)', color: 'var(--text-primary, #e6edf3)', fontSize: '0.9rem' }}
              />
              {query.trim().length >= 2 && (
                <div style={{ marginTop: '6px', border: '1px solid var(--ds-border, #30363d)', borderRadius: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                  {searching && <div style={{ padding: '8px 10px', ...mutedStyle }}>Buscando…</div>}
                  {!searching && candidates.length === 0 && <div style={{ padding: '8px 10px', ...mutedStyle }}>Sin resultados.</div>}
                  {!searching && candidates.map(user => (
                    <button
                      key={user.accountId}
                      type="button"
                      onClick={() => addEditor(user)}
                      disabled={saving}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '7px 10px', border: 'none', borderBottom: '1px solid var(--ds-border, #30363d)', background: 'transparent', color: 'var(--text-primary, #e6edf3)', fontSize: '0.88rem', textAlign: 'left', cursor: 'pointer' }}
                    >
                      <Avatar user={user} />
                      {user.displayName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={mutedStyle}>Solo un administrador del proyecto puede cambiar esta lista.</div>
          )}
        </>
      )}
    </div>
  );
}

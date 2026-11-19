/**
 * @file FolderHistoryCard.jsx
 * @description Settings card "Historial de carpetas" (v4.36.0).
 *
 * Before every change to the folder tree of the repository, the server saves the version being
 * replaced (the newest 30 per project; see src/utils/folderHistory.js). This card lists those
 * versions and lets a project administrator bring one back:
 *   - "Recuperar faltantes": adds the folders of that version that are missing now. Nothing that
 *     exists now is changed or removed. This is the safe choice.
 *   - "Volver a esta versión": the tree becomes exactly that version (undoes later renames and
 *     moves, and removes folders created after it). Asks for confirmation.
 * Either way the current tree is saved to the history first, so a restore can be undone.
 * Test cases are never touched: they keep pointing at their folder id.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '../utils/queryClient';

// Same look as the other Settings cards.
const cardStyle = {
  background: 'var(--bg-surface, #161b22)',
  border: '1px solid var(--ds-border, #30363d)',
  borderRadius: '10px',
  padding: '1.5rem 1.75rem',
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
};
const mutedStyle = { color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' };
const linkBtn = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--jira-blue, #0C66E4)', fontSize: '0.82rem', fontWeight: 600 };

// What each operation in the history means, in the user's words.
const OP_LABELS = {
  create: 'Antes de crear una carpeta',
  rename: 'Antes de renombrar',
  move: 'Antes de mover',
  delete: 'Antes de eliminar',
  restore: 'Antes de restaurar desde el navegador',
  restoreVersion: 'Antes de restaurar una versión'
};

/**
 * @param {Object} props
 * @param {string} props.projectId - Project whose folders are shown.
 * @param {Function} props.addNotification - Toast helper of the app.
 * @param {Function} [props.onFoldersChanged] - Receives the new tree after a restore.
 */
export default function FolderHistoryCard({ projectId, addNotification, onFoldersChanged }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  // Id of the version whose "Volver a esta versión" is waiting for the inline confirmation.
  // (window.confirm may be blocked inside the Forge iframe, so the card asks by itself.)
  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const res = await invoke('getFolderHistory', { projectId });
      setVersions(Array.isArray(res?.versions) ? res.versions : []);
    } catch (e) {
      setError(e?.message || 'No se pudo leer el historial.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const restore = async (version, mode) => {
    setBusyId(version.id);
    try {
      const res = await invoke('restoreFolderVersion', { projectId, snapshotId: version.id, mode });
      if (Array.isArray(res?.folders) && onFoldersChanged) onFoldersChanged(res.folders);
      const parts = [`${res?.added || 0} carpetas recuperadas`];
      if (mode === 'replace') parts.push(`${res?.removed || 0} quitadas`);
      addNotification({ type: 'success', title: 'Carpetas restauradas', description: `${parts.join(', ')}. La versión anterior quedó en el historial.` });
      await load();
    } catch (e) {
      addNotification({ type: 'error', title: 'No se pudo restaurar', description: e?.message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="glass" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '1.3rem' }}>🗂️</span>
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>Historial de carpetas</h2>
        <button type="button" style={{ ...linkBtn, marginLeft: 'auto' }} onClick={load} disabled={loading}>{loading ? 'Cargando…' : 'Actualizar'}</button>
      </div>
      <p style={{ ...mutedStyle, marginTop: 0 }}>
        Antes de cada cambio en las carpetas del repositorio se guarda la versión anterior (las últimas 30).
        "Recuperar faltantes" solo agrega las carpetas que ya no están; "Volver a esta versión" deja el árbol exactamente como estaba.
        Los casos de prueba no se modifican.
      </p>
      {error && <div style={{ ...mutedStyle, color: '#F87168' }}>{error}</div>}
      {!error && !loading && versions.length === 0 && (
        <div style={mutedStyle}>Aún no hay versiones guardadas. Se guardará una en el próximo cambio de carpetas.</div>
      )}
      {versions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {versions.map(version => (
            <div key={version.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--ds-border, #30363d)' }}>
              <strong style={{ fontSize: '0.86rem', color: 'var(--text-primary, #e6edf3)' }}>{new Date(version.savedAt).toLocaleString('es-MX')}</strong>
              <span style={mutedStyle}>{version.count} {version.count === 1 ? 'carpeta' : 'carpetas'}</span>
              <span style={mutedStyle}>{OP_LABELS[version.op] || version.op}{version.byName ? ` · ${version.byName}` : ''}</span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '14px' }}>
                <button type="button" style={linkBtn} disabled={!!busyId} onClick={() => restore(version, 'merge')}>
                  {busyId === version.id ? 'Restaurando…' : 'Recuperar faltantes'}
                </button>
                <button type="button" style={{ ...linkBtn, color: '#F87168' }} disabled={!!busyId} onClick={() => setConfirmId(version.id)}>
                  Volver a esta versión
                </button>
              </span>
              {confirmId === version.id && (
                <div style={{ flexBasis: '100%', ...mutedStyle, display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span>
                    El árbol quedará exactamente como estaba en esta versión ({version.count} carpetas): se deshacen los cambios
                    posteriores y se quitan las carpetas creadas después. Los casos no se modifican y el árbol actual queda en el historial.
                  </span>
                  <button type="button" className="btn-primary" style={{ fontSize: '0.8rem', padding: '0.25rem 0.7rem' }} disabled={!!busyId}
                    onClick={() => { setConfirmId(null); restore(version, 'replace'); }}>Confirmar</button>
                  <button type="button" className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.25rem 0.7rem' }} onClick={() => setConfirmId(null)}>Cancelar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @file LifecycleTeamsCard.jsx
 * @description Settings card "Equipos de Lifecycle" (v4.25.0).
 *
 * A project administrator lists who belongs to each team: Dev, QA and UAT. Lifecycle uses it to
 * group its content by team:
 *   - phase 02 "Diseñar": each findings report is grouped by the team chosen when it was added
 *     (pre-filled with the team of the person who adds it);
 *   - phase 03 "Construir": each epic and each story without epic is grouped by the team of its
 *     Jira REPORTER ("Informador").
 *
 * Being in a team does NOT allow editing Lifecycle; that is the "Editores de Lifecycle" card.
 * A person belongs to one team at most: adding them to another team moves them.
 *
 * How it works:
 *   - On mount it loads the list with the `getLifecycleTeams` resolver.
 *   - Each team has a search box that looks people up with the existing `searchAssignableUsers`
 *     resolver, 300 ms after the last keystroke.
 *   - Every change saves the whole list with `saveLifecycleTeams`; the backend checks again that
 *     the caller administers the project.
 */

import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '../utils/queryClient';

// The ids are stored; the labels are only for display. Same ids as src/utils/lifecycleEditors.js.
export const LIFECYCLE_TEAM_OPTIONS = [
  { id: 'dev', label: 'Dev' },
  { id: 'qa', label: 'QA' },
  { id: 'uat', label: 'UAT' }
];

// Same look as the other Settings cards (they share these CSS variables).
const cardStyle = {
  background: 'var(--bg-surface, #161b22)',
  border: '1px solid var(--ds-border, #30363d)',
  borderRadius: '10px',
  padding: '1.5rem 1.75rem',
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
};
const mutedStyle = { color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--ds-border, #30363d)', background: 'var(--bg-default, transparent)', color: 'var(--text-primary, #e6edf3)', fontSize: '0.86rem' };

/** Small round avatar; falls back to the first letter of the name when there is no picture. */
const Avatar = ({ user }) => (user.avatarUrl
  ? <img src={user.avatarUrl} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
  : (
    <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#0C66E4', color: '#FFFFFF', fontSize: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {String(user.displayName || '?').charAt(0).toUpperCase()}
    </span>
  ));

/**
 * Search box of one team: looks people up while typing and calls `onPick` with the chosen one.
 * Each team has its own box so the results always belong to the team being filled.
 */
function MemberSearch({ projectId, disabled, onPick, excludeIds }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  // Sequence number of the latest search, so a slow old answer never replaces a newer one.
  const seqRef = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2 || !projectId) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    const seq = ++seqRef.current;
    setSearching(true);
    const timer = setTimeout(() => {
      invoke('searchAssignableUsers', { projectId, query: text })
        .then(users => { if (seq === seqRef.current) setResults(Array.isArray(users) ? users : []); })
        .catch(() => { if (seq === seqRef.current) setResults([]); })
        .finally(() => { if (seq === seqRef.current) setSearching(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, projectId]);

  const candidates = results.filter(user => !excludeIds.has(user.accountId));
  return (
    <div>
      <input type="text" value={query} disabled={disabled} style={inputStyle}
        placeholder="Agregar persona…" onChange={(event) => setQuery(event.target.value)} />
      {query.trim().length >= 2 && (
        <div style={{ marginTop: '4px', border: '1px solid var(--ds-border, #30363d)', borderRadius: '6px', maxHeight: '200px', overflowY: 'auto' }}>
          {searching && <div style={{ padding: '6px 9px', ...mutedStyle }}>Buscando…</div>}
          {!searching && candidates.length === 0 && <div style={{ padding: '6px 9px', ...mutedStyle }}>Sin resultados.</div>}
          {!searching && candidates.map(user => (
            <button key={user.accountId} type="button" disabled={disabled}
              onClick={() => { setQuery(''); setResults([]); onPick(user); }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 9px', border: 'none', borderBottom: '1px solid var(--ds-border, #30363d)', background: 'transparent', color: 'var(--text-primary, #e6edf3)', fontSize: '0.85rem', textAlign: 'left', cursor: 'pointer' }}>
              <Avatar user={user} />
              {user.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LifecycleTeamsCard({ projectId, addNotification }) {
  const [members, setMembers] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load the members when the card opens or the project changes.
  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    setLoading(true);
    invoke('getLifecycleTeams', { projectId })
      .then(res => {
        if (cancelled) return;
        setMembers(res?.members || []);
        setCanManage(Boolean(res?.canManage));
      })
      .catch(() => { if (!cancelled) setMembers([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  /** Saves the new list; on error the previous list is shown again. */
  const saveMembers = async (next, successTitle) => {
    const previous = members;
    setMembers(next);
    setSaving(true);
    try {
      const res = await invoke('saveLifecycleTeams', { projectId, members: next });
      setMembers(res?.members || next);
      addNotification({ type: 'success', title: successTitle });
    } catch (error) {
      setMembers(previous);
      addNotification({ type: 'error', title: 'No se pudieron guardar los equipos', description: error?.message || String(error || '') });
    } finally {
      setSaving(false);
    }
  };

  // A person is in one team at most: adding them to a team takes them out of any other.
  const addMember = (team, user) => saveMembers(
    [...members.filter(member => member.accountId !== user.accountId),
      { accountId: user.accountId, displayName: user.displayName, avatarUrl: user.avatarUrl || '', team: team.id }],
    `${user.displayName} ahora está en ${team.label}`
  );

  const removeMember = (member) => saveMembers(
    members.filter(item => item.accountId !== member.accountId),
    `${member.displayName} ya no está en un equipo`
  );

  const inTeam = new Set(members.map(member => member.accountId));

  return (
    <div className="glass" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '1.3rem' }}>👥</span>
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
          Equipos de Lifecycle
        </h2>
      </div>
      <p style={{ margin: '0 0 1rem 0', ...mutedStyle }}>
        Lifecycle agrupa por equipo los reportes de hallazgos (Diseñar) y las épicas e historias
        (Construir). En Construir el equipo se toma del <strong>informador</strong> de la épica o de la
        historia en Jira. Estar en un equipo no da permiso de editar Lifecycle.
      </p>

      {loading ? (
        <div style={mutedStyle}>Cargando equipos…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          {LIFECYCLE_TEAM_OPTIONS.map(team => {
            const teamMembers = members.filter(member => member.team === team.id)
              .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
            return (
              <div key={team.id} style={{ border: '1px solid var(--ds-border, #30363d)', borderRadius: '8px', padding: '10px 12px' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary, #e6edf3)', marginBottom: '8px' }}>
                  {team.label} <span style={mutedStyle}>({teamMembers.length})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: canManage ? '8px' : 0 }}>
                  {teamMembers.length === 0 && <span style={mutedStyle}>Sin personas.</span>}
                  {teamMembers.map(member => (
                    <span key={member.accountId} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary, #e6edf3)', fontSize: '0.85rem' }}>
                      <Avatar user={member} />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.displayName}</span>
                      {canManage && (
                        <button type="button" onClick={() => removeMember(member)} disabled={saving}
                          title={`Quitar a ${member.displayName}`} aria-label={`Quitar a ${member.displayName} de ${team.label}`}
                          style={{ border: 'none', background: 'transparent', color: 'var(--text-secondary, #8b949e)', cursor: saving ? 'default' : 'pointer', fontSize: '0.85rem' }}>
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {canManage && (
                  <MemberSearch projectId={projectId} disabled={saving} onPick={(user) => addMember(team, user)}
                    excludeIds={new Set(teamMembers.map(member => member.accountId))} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {!loading && !canManage && <div style={{ ...mutedStyle, marginTop: '10px' }}>Solo un administrador del proyecto puede cambiar los equipos.</div>}
      {!loading && canManage && inTeam.size > 0 && (
        <div style={{ ...mutedStyle, marginTop: '10px' }}>Si agregas a una persona que ya está en otro equipo, se cambia de equipo.</div>
      )}
    </div>
  );
}

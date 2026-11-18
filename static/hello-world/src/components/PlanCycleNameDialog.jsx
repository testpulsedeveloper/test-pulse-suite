/**
 * @file PlanCycleNameDialog.jsx
 * @description Test Pulse's own form to CREATE or RENAME a Test Plan / Test Cycle (v4.30.0).
 *
 * Why: until v4.29.0 the "+ Nuevo" buttons opened Jira's generic "Create issue" form, where the
 * person had to pick the issue type and fill the summary AND the description that the project
 * requires. Here only a NAME is typed; the backend uses it for both fields.
 *
 * Modes:
 *   - create: choose Plan or Ciclo (when the caller allows both), type the name. For a cycle,
 *     it can be added right away to the active Test Plan.
 *   - rename: shows the current name; the backend updates the summary (and the description when
 *     it was still the automatic copy of the old name).
 *
 * Projects that require MORE fields than name and description cannot be created from here: the
 * error says so and the "Usar el formulario de Jira" link opens Jira's form as before.
 *
 * Props:
 *   dialog: { mode: 'create'|'rename', kind: 'plan'|'cycle'|'choose', issue?, activePlan? }
 *   onClose(): closes the form.
 *   onSubmit({ kind, name, linkToPlan }): does the work; returns a Promise (rejects → message shown).
 *   onUseJiraForm(): opens Jira's own create form (create mode only).
 */

import React, { useEffect, useRef, useState } from 'react';

const NOUN = { plan: 'Test Plan', cycle: 'ciclo' };

export default function PlanCycleNameDialog({ dialog, onClose, onSubmit, onUseJiraForm }) {
  const isRename = dialog.mode === 'rename';
  const [kind, setKind] = useState(dialog.kind === 'choose' ? 'cycle' : dialog.kind);
  const [name, setName] = useState(isRename ? (dialog.issue?.summary || '') : '');
  // A new cycle goes into the active plan by default, when there is one.
  const [linkToPlan, setLinkToPlan] = useState(Boolean(dialog.activePlan));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const trimmed = name.replace(/\s+/g, ' ').trim();
  const unchanged = isRename && trimmed === String(dialog.issue?.summary || '').trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 255 && !unchanged && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit({ kind, name: trimmed, linkToPlan: kind === 'cycle' && linkToPlan && !isRename });
      onClose();
    } catch (e) {
      setError(e?.message || String(e));
      setSaving(false);
    }
  };

  const title = isRename
    ? `Renombrar ${NOUN[dialog.kind] || ''}`.trim()
    : (dialog.kind === 'choose' ? 'Nuevo plan o ciclo' : `Nuevo ${NOUN[kind]}`);

  return (
    <div className="modal-overlay" style={{ zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(9, 30, 66, 0.54)' }}
      onClick={() => !saving && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        style={{ width: '440px', maxWidth: '92vw', background: '#FFFFFF', borderRadius: '8px', padding: '20px', boxShadow: '0 8px 24px rgba(9, 30, 66, 0.25)' }}>
        <h2 style={{ margin: '0 0 14px', fontSize: '16px', fontWeight: 700, color: '#172B4D' }}>{title}</h2>

        {dialog.kind === 'choose' && !isRename && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '13px' }}>
            {['plan', 'cycle'].map(option => (
              <label key={option} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input type="radio" name="tp-kind" checked={kind === option} onChange={() => setKind(option)} />
                {option === 'plan' ? 'Test Plan' : 'Ciclo de prueba'}
              </label>
            ))}
          </div>
        )}

        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546F', marginBottom: '4px' }}>Nombre *</label>
        <input ref={inputRef} type="text" value={name} maxLength={255}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape' && !saving) onClose(); }}
          placeholder={kind === 'plan' ? 'Ej. Release 2 - Facturación' : 'Ej. Regresión Sprint 14'}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '2px solid #DCDFE4', borderRadius: '4px', fontSize: '14px' }} />
        <div style={{ fontSize: '11px', color: '#626F86', marginTop: '4px' }}>
          {isRename
            ? 'Cambia el resumen en Jira. La descripción también se actualiza si seguía siendo el nombre anterior.'
            : 'Se usa como resumen y como descripción en Jira.'}
        </div>

        {!isRename && kind === 'cycle' && dialog.activePlan && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '13px', cursor: 'pointer' }}>
            <input type="checkbox" checked={linkToPlan} onChange={(e) => setLinkToPlan(e.target.checked)} />
            Agregarlo al plan activo: <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dialog.activePlan.summary}</strong>
          </label>
        )}

        {error && <div role="alert" style={{ marginTop: '12px', padding: '8px 10px', background: '#FFECEB', color: '#AE2A19', borderRadius: '4px', fontSize: '12px' }}>{error}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '18px' }}>
          {!isRename && onUseJiraForm && (
            <button type="button" onClick={() => { onClose(); onUseJiraForm(); }} disabled={saving}
              style={{ border: 'none', background: 'none', color: '#0C66E4', cursor: 'pointer', fontSize: '12px', padding: 0 }}>
              Usar el formulario de Jira
            </button>
          )}
          <span style={{ marginLeft: 'auto' }} />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={!canSave}>
            {saving ? 'Guardando…' : (isRename ? 'Guardar' : 'Crear')}
          </button>
        </div>
      </div>
    </div>
  );
}

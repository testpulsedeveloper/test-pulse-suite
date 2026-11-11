/**
 * @file TestCaseInlineEdit.jsx
 * @description Editing a Test Case directly in the side panel of Design: the title, the
 * description and the "Propiedades del caso" (Estado, Prioridad, Nivel de Prueba, Tipo de
 * Prueba, Tipo de Ejecución, Historia y Épica).
 *
 * v4.23.2 — NOTHING is editable until the tester asks for it:
 *   - the panel opens read-only, exactly as before, and makes no request to prepare editing;
 *   - each part has its own "Editar" (the pencil of the title, "Editar" of the description and
 *     "Editar" of the properties);
 *   - while editing, changes are only a draft on screen. Jira is written only when "Guardar" is
 *     pressed, and only the fields whose value actually changed are sent. "Cancelar" discards
 *     the draft without touching anything.
 *   (v4.23.1 saved every list the moment its value changed, so browsing a list rewrote the case.)
 *
 * Pieces:
 *   - useTestCaseInlineEdit   → the logic: loads what is needed to edit (on demand), keeps the
 *                               drafts, saves, and tells Design what to refresh on screen.
 *   - EditableCaseTitle       → the title, with a pencil to edit it.
 *   - EditableCaseDescription → the text box of the description (Pre-conditions / Test Script).
 *   - EditableCaseProperties  → the lists of the properties column, with Guardar / Cancelar.
 *
 * Performance:
 *   - Opening a case costs nothing extra. The data needed to edit (current values, list options,
 *     allowed statuses) is ONE request, made when "Editar" is pressed.
 *   - "Guardar" of the properties sends every changed property in ONE request (2-3 when the
 *     story changes, because the old link is removed and the new one created).
 *   - After saving, Design patches what is on screen instead of reloading every Test Case.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '../utils/queryClient';
import { SearchableSelect } from './CommonComponents';

const isEpicType = (typeName) => {
  const name = String(typeName || '').toLowerCase();
  return name.includes('epic') || name.includes('épica') || name.includes('epica');
};

// Properties edited together with "Editar" → "Guardar".
const LIST_FIELDS = [
  { name: 'testLevel', label: 'Nivel de Prueba', configKey: 'testLevelFieldId', defaultId: 'customfield_10530' },
  { name: 'testType', label: 'Tipo de Prueba', configKey: 'testTypeFieldId', defaultId: 'customfield_10535' },
  { name: 'executionType', label: 'Tipo de Ejecución', configKey: 'executionTypeFieldId', defaultId: 'customfield_10534' }
];

/**
 * @param {Object} params
 * @param {Object|null} params.testCase    - Case open in the panel (id, key, summary).
 * @param {string} params.projectId
 * @param {Object} params.projectConfig    - Test Pulse configuration of the project.
 * @param {Object} params.requirementsMap  - key → { key, summary, issueType, epicKey, epicSummary }.
 * @param {string} params.currentStoryKey  - Story the case is linked to today ('' = none).
 * @param {Function} params.addNotification
 * @param {Function} params.onPatched      - Receives what changed, to refresh the screen.
 * @returns {Object} State and actions used by the components below.
 */
export function useTestCaseInlineEdit({ testCase, projectId, projectConfig, requirementsMap, currentStoryKey, addNotification, onPatched }) {
  const caseId = testCase ? String(testCase.id) : '';
  const [data, setData] = useState(null);             // answer of getTestCaseForEdit for `caseId`
  const [opening, setOpening] = useState('');         // part whose edit data is loading
  const [savingPart, setSavingPart] = useState('');   // 'title' | 'description' | 'properties'
  const [titleDraft, setTitleDraft] = useState(null); // null = not editing
  const [descDraft, setDescDraft] = useState(null);   // null = not editing
  const [propsDraft, setPropsDraft] = useState(null); // null = not editing
  const [replaceRich, setReplaceRich] = useState(false);
  // Identifies the case open in the panel, so a slow answer for a previous case is ignored.
  const wantedRef = useRef('');

  // A different case in the panel: close every editor and forget the previous edit data.
  useEffect(() => {
    wantedRef.current = caseId;
    setData(null);
    setOpening('');
    setTitleDraft(null);
    setDescDraft(null);
    setPropsDraft(null);
    setReplaceRich(false);
  }, [caseId]);

  /** The edit data of the open case: from memory, or one request to Jira. Null on failure. */
  const ensureLoaded = async (part) => {
    if (data && data.id === caseId) return data;
    const id = caseId;
    setOpening(part);
    try {
      const res = await invoke('getTestCaseForEdit', { projectId, caseId: id, config: projectConfig });
      if (wantedRef.current !== id) return null;
      if (!res || res.error) {
        addNotification({ type: 'error', title: 'No se pudo abrir la edición', description: res?.error || '' });
        return null;
      }
      setData(res);
      return res;
    } catch (error) {
      if (wantedRef.current === id) addNotification({ type: 'error', title: 'No se pudo abrir la edición', description: error?.message || String(error) });
      return null;
    } finally {
      if (wantedRef.current === id) setOpening('');
    }
  };

  /**
   * Sends one save to Jira. `request` is the extra part of the saveTestCase payload.
   * `screenPatch` is what Design must refresh. Returns true when Jira accepted it.
   */
  const save = async (part, request, screenPatch, successTitle) => {
    const id = caseId;
    setSavingPart(part);
    try {
      const res = await invoke('saveTestCase', { projectId, caseId: id, config: projectConfig, ...request });
      if (!res || res.error) {
        addNotification({ type: 'error', title: 'No se pudo guardar', description: res?.error || '' });
        return false;
      }
      // What was loaded no longer matches Jira (status, links…): the next "Editar" reads it again.
      if (wantedRef.current === id) setData(null);
      onPatched({ id, ...screenPatch });
      if (res.warning) addNotification({ type: 'warning', title: 'Guardado con una advertencia', description: res.warning });
      else addNotification({ type: 'success', title: successTitle });
      return true;
    } catch (error) {
      addNotification({ type: 'error', title: 'No se pudo guardar', description: error?.message || String(error) });
      return false;
    } finally {
      setSavingPart('');
    }
  };

  // ── Title (needs nothing from Jira: the panel already has it) ────────────────────────────

  const startTitleEdit = () => setTitleDraft(String(testCase?.summary || ''));
  const cancelTitleEdit = () => setTitleDraft(null);
  const saveTitle = async () => {
    const summary = String(titleDraft ?? '').replace(/\s+/g, ' ').trim();
    if (!summary || summary === String(testCase?.summary || '').trim()) { setTitleDraft(null); return; }
    if (await save('title', { changes: { summary } }, { summary }, 'Título actualizado')) setTitleDraft(null);
  };

  // ── Description ──────────────────────────────────────────────────────────────────────────

  const startDescriptionEdit = async () => {
    const loaded = await ensureLoaded('description');
    if (loaded) { setReplaceRich(false); setDescDraft(loaded.descriptionText || ''); }
  };
  const cancelDescriptionEdit = () => { setDescDraft(null); setReplaceRich(false); };
  const saveDescription = async () => {
    if (!data || descDraft === data.descriptionText) { cancelDescriptionEdit(); return; }
    const ok = await save('description', { changes: { descriptionText: descDraft } }, { descriptionChanged: true }, 'Descripción actualizada');
    if (ok) cancelDescriptionEdit();
  };

  // ── Properties ───────────────────────────────────────────────────────────────────────────

  /** The values the case has now, in the shape of the draft. */
  const originalProps = (loaded) => ({
    transitionId: '', // '' = keep the current status
    priorityId: loaded.priorityId || '',
    testLevel: loaded.testLevel?.optionId || '',
    testType: loaded.testType?.optionId || '',
    executionType: loaded.executionType?.optionId || '',
    storyKey: currentStoryKey || '',
    epicKey: loaded.epic?.key || ''
  });

  const startPropertiesEdit = async () => {
    const loaded = await ensureLoaded('properties');
    if (loaded) setPropsDraft(originalProps(loaded));
  };
  const cancelPropertiesEdit = () => setPropsDraft(null);
  const setProp = (name, value) => setPropsDraft(prev => (prev ? { ...prev, [name]: value || '' } : prev));

  const labelOf = (options, id) => (options || []).find(option => option.id === id)?.label || '';

  /** Names of the properties whose draft value differs from what the case has now. */
  const changedProps = () => {
    if (!data || !propsDraft) return [];
    const original = originalProps(data);
    return Object.keys(propsDraft).filter(name => propsDraft[name] !== original[name]);
  };

  /** Sends every changed property in one request. Untouched properties are never sent. */
  const savePropertiesEdit = async () => {
    const changed = changedProps();
    if (changed.length === 0) { setPropsDraft(null); return; }
    const draft = propsDraft;
    const request = { changes: {} };
    const screenPatch = { customFields: {} };
    const done = [];

    if (changed.includes('transitionId')) {
      const transition = (data.transitions || []).find(item => item.id === draft.transitionId);
      request.transitionId = draft.transitionId;
      screenPatch.status = transition?.toName || '';
      done.push('Estado');
    }
    if (changed.includes('priorityId') && draft.priorityId) {
      request.changes.priorityId = draft.priorityId;
      screenPatch.priority = { id: draft.priorityId, name: labelOf(data.options.priority.options, draft.priorityId) };
      done.push('Prioridad');
    }
    for (const field of LIST_FIELDS) {
      if (!changed.includes(field.name)) continue;
      const optionId = draft[field.name];
      const multiple = Boolean(data.options[field.name]?.multiple || data[field.name]?.multiple);
      request.changes[field.name] = { optionId, multiple };
      const fieldId = projectConfig?.[field.configKey] || field.defaultId;
      screenPatch.customFields[fieldId] = optionId ? { id: optionId, value: labelOf(data.options[field.name].options, optionId) } : null;
      done.push(field.label);
    }
    if (changed.includes('epicKey')) {
      request.changes.epicKey = draft.epicKey;
      const summary = epicOptions.find(option => option.value === draft.epicKey)?.summary || '';
      screenPatch.epic = draft.epicKey ? { key: draft.epicKey, summary } : null;
      done.push('Épica');
    }
    if (changed.includes('storyKey')) {
      const previousKey = currentStoryKey || '';
      const previousLink = (data.links || []).find(link => link.key === previousKey);
      request.requirement = { key: draft.storyKey, removeLinkId: previousLink?.linkId || '', linkType: projectConfig?.requirementLinkType || 'ANY' };
      screenPatch.story = { key: draft.storyKey, summary: requirementsMap?.[draft.storyKey]?.summary || '', previousKey };
      done.push('Historia');
    }

    if (await save('properties', request, screenPatch, `Actualizado: ${done.join(', ')}`)) setPropsDraft(null);
  };

  // ── Lists of stories and epics of the project (already loaded by Design) ─────────────────

  const storyOptions = useMemo(() => [
    { value: '', label: 'Sin historia' },
    ...Object.values(requirementsMap || {})
      .filter(req => !isEpicType(req.issueType))
      .sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }))
      .map(req => ({ value: req.key, label: `${req.key} — ${req.summary || ''}` }))
  ], [requirementsMap]);

  const epicOptions = useMemo(() => {
    const epics = new Map();
    for (const req of Object.values(requirementsMap || {})) {
      if (isEpicType(req.issueType)) epics.set(req.key, req.summary || '');
      if (req.epicKey && !epics.has(req.epicKey)) epics.set(req.epicKey, req.epicSummary || '');
    }
    return [...epics.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([key, summary]) => ({ value: key, summary, label: `${key} — ${summary}` }));
  }, [requirementsMap]);

  return {
    data, opening, savingPart, storyOptions, epicOptions,
    // title
    titleDraft, setTitleDraft, titleEditing: titleDraft !== null, startTitleEdit, cancelTitleEdit, saveTitle,
    // description
    descDraft, setDescDraft, replaceRich, setReplaceRich,
    descEditing: descDraft !== null && Boolean(data), startDescriptionEdit, cancelDescriptionEdit, saveDescription,
    // properties
    propsDraft, propsEditing: propsDraft !== null && Boolean(data), setProp,
    startPropertiesEdit, cancelPropertiesEdit, savePropertiesEdit, changedProps
  };
}

// ── Shared styles ───────────────────────────────────────────────────────────────────────────

const labelStyle = { display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '4px' };
const selectStyle = { width: '100%', boxSizing: 'border-box', height: '30px', padding: '0 6px', border: '1px solid #8590A2', borderRadius: '4px', fontSize: '0.82rem', color: '#172B4D', background: '#FFFFFF' };
const mutedStyle = { fontSize: '11px', color: '#626F86' };
const smallBtn = { fontSize: '0.78rem', padding: '0.3rem 0.7rem' };
const linkBtn = { border: 'none', background: 'none', color: '#0C66E4', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: 0 };

/** "✎ Editar" link used by the description and the properties. */
export const EditLink = ({ onClick, loading, disabled, title }) => (
  <button type="button" onClick={onClick} disabled={disabled || loading} title={title} style={{ ...linkBtn, opacity: disabled ? 0.5 : 1 }}>
    {loading ? 'Abriendo…' : '✎ Editar'}
  </button>
);

// ── Title ───────────────────────────────────────────────────────────────────────────────────

/** The title of the case. The pencil turns it into a text box; nothing changes until "Guardar". */
export const EditableCaseTitle = ({ edit, summary }) => {
  const titleStyle = { fontSize: '1.05rem', fontWeight: 700, color: '#172B4D', margin: 0, lineHeight: 1.35 };
  if (!edit.titleEditing) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <h2 style={titleStyle}>{summary}</h2>
        <button type="button" onClick={edit.startTitleEdit} title="Editar el título" aria-label="Editar el título"
          style={{ border: 'none', background: 'none', color: '#0C66E4', cursor: 'pointer', fontSize: '0.9rem', padding: '2px' }}>✎</button>
      </div>
    );
  }
  const saving = edit.savingPart === 'title';
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
      <input autoFocus value={edit.titleDraft} maxLength={255} disabled={saving}
        onChange={(event) => edit.setTitleDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') edit.saveTitle(); if (event.key === 'Escape') edit.cancelTitleEdit(); }}
        style={{ ...selectStyle, flex: '1 1 320px', height: '34px', fontSize: '0.95rem', fontWeight: 600 }} />
      <button type="button" className="btn-primary" style={smallBtn} disabled={saving || !edit.titleDraft.trim()} onClick={edit.saveTitle}>{saving ? 'Guardando…' : 'Guardar'}</button>
      <button type="button" className="btn-secondary" style={smallBtn} disabled={saving} onClick={edit.cancelTitleEdit}>Cancelar</button>
    </div>
  );
};

// ── Description ─────────────────────────────────────────────────────────────────────────────

/** Text box of the description, shown in place of the rendered description while editing. */
export const EditableCaseDescription = ({ edit }) => {
  const saving = edit.savingPart === 'description';
  const changed = edit.descDraft !== edit.data.descriptionText;
  // A description with tables, images or links would be flattened to plain text.
  const blocked = edit.data.hasRichDescription && changed && !edit.replaceRich;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '1rem' }}>
      <textarea autoFocus value={edit.descDraft} disabled={saving} onChange={(event) => edit.setDescDraft(event.target.value)}
        placeholder={'Pre-conditions:\n…\n\nTest Script:\nGiven …\nWhen …\nThen …'}
        style={{ width: '100%', boxSizing: 'border-box', minHeight: '300px', padding: '8px', border: '1px solid #8590A2', borderRadius: '4px', fontSize: '0.84rem', lineHeight: 1.5, color: '#172B4D', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }} />
      <span style={mutedStyle}>Texto simple. Las etiquetas al inicio de una línea, como "Pre-conditions:" o "Test Script:", se guardan en negritas.</span>
      {edit.data.hasRichDescription && (
        <div style={{ fontSize: '0.8rem', color: '#7F5F01', background: '#FFF7D6', border: '1px solid #F8E6A0', borderRadius: '4px', padding: '8px 10px' }}>
          Esta descripción tiene formato que aquí no se puede conservar (tablas, imágenes, enlaces o código). Si la guardas, quedará como texto simple.
          {changed && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', cursor: 'pointer' }}>
              <input type="checkbox" checked={edit.replaceRich} onChange={(event) => edit.setReplaceRich(event.target.checked)} />
              Entiendo y quiero reemplazar el formato
            </label>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button type="button" className="btn-secondary" style={smallBtn} disabled={saving} onClick={edit.cancelDescriptionEdit}>Cancelar</button>
        <button type="button" className="btn-primary" style={smallBtn} disabled={saving || blocked || !changed} onClick={edit.saveDescription}>{saving ? 'Guardando…' : 'Guardar descripción'}</button>
      </div>
    </div>
  );
};

// ── Properties ──────────────────────────────────────────────────────────────────────────────

/**
 * One list of the properties. Its value is the draft; it starts as the value the case has now.
 * The current value is always listed, even when Jira does not offer it among the options, so
 * opening the editor never shows (or saves) a value the case does not have.
 */
const PropertyList = ({ label, field, value, current, disabled, onChange, allowEmpty = true }) => {
  const options = field?.options || [];
  const currentMissing = current?.id && !options.some(option => option.id === current.id);
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <select style={selectStyle} value={value || ''} disabled={disabled || !field?.available}
        title={!field?.available ? 'Jira no permite editar este campo en este caso' : undefined}
        onChange={(event) => onChange(event.target.value)}>
        {(allowEmpty || !value) && <option value="">Sin especificar</option>}
        {currentMissing && <option value={current.id}>{current.label || current.id}</option>}
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </div>
  );
};

/**
 * The properties while "Editar" is active: Estado, Prioridad, Nivel de Prueba, Tipo de Prueba,
 * Tipo de Ejecución, Historia y Épica. Changes are a draft until "Guardar".
 */
export const EditableCaseProperties = ({ edit, derivedEpicKey }) => {
  const { data, propsDraft: draft } = edit;
  const saving = edit.savingPart === 'properties';
  const changedCount = edit.changedProps().length;
  return (
    <>
      {/* Estado: keep the current one, or move to a status the workflow allows. */}
      <div>
        <label style={labelStyle}>Estado</label>
        <select style={selectStyle} value={draft.transitionId} disabled={saving || (data.transitions || []).length === 0}
          onChange={(event) => edit.setProp('transitionId', event.target.value)}>
          <option value="">{data.statusName || 'Sin estado'} (actual)</option>
          {(data.transitions || []).map(transition => <option key={transition.id} value={transition.id}>→ {transition.toName}</option>)}
        </select>
      </div>

      <PropertyList label="Prioridad" field={data.options.priority} value={draft.priorityId} allowEmpty={false}
        current={{ id: data.priorityId, label: data.priorityName }} disabled={saving} onChange={(id) => edit.setProp('priorityId', id)} />
      {LIST_FIELDS.map(field => (
        <PropertyList key={field.name} label={field.label} field={data.options[field.name]} value={draft[field.name]}
          current={{ id: data[field.name]?.optionId, label: data[field.name]?.label }} disabled={saving}
          onChange={(id) => edit.setProp(field.name, id)} />
      ))}

      {/* Historia: the requirement this case tests ("is tested by"). */}
      <div style={{ pointerEvents: saving ? 'none' : 'auto', opacity: saving ? 0.6 : 1 }}>
        <label style={labelStyle}>Historia que prueba</label>
        <SearchableSelect value={draft.storyKey} options={edit.storyOptions} placeholder="Sin historia" onChange={(value) => edit.setProp('storyKey', value)} />
      </div>

      {/* Épica: the case's own epic. Without one, the epic of its story applies. */}
      <div>
        <label style={labelStyle}>Épica</label>
        <select style={selectStyle} value={draft.epicKey} disabled={saving || !data.options.epic.available}
          title={!data.options.epic.available ? 'Jira no permite asignar una épica a este caso' : undefined}
          onChange={(event) => edit.setProp('epicKey', event.target.value)}>
          <option value="">{derivedEpicKey && !data.epic ? `La de su historia (${derivedEpicKey})` : 'Sin épica'}</option>
          {data.epic && !edit.epicOptions.some(option => option.value === data.epic.key) && (
            <option value={data.epic.key}>{data.epic.key} — {data.epic.summary}</option>
          )}
          {edit.epicOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...mutedStyle, marginRight: 'auto' }}>{changedCount === 0 ? 'Sin cambios' : `${changedCount} ${changedCount === 1 ? 'cambio' : 'cambios'} sin guardar`}</span>
        <button type="button" className="btn-secondary" style={smallBtn} disabled={saving} onClick={edit.cancelPropertiesEdit}>Cancelar</button>
        <button type="button" className="btn-primary" style={smallBtn} disabled={saving || changedCount === 0} onClick={edit.savePropertiesEdit}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </>
  );
};

/**
 * @file TestCaseInlineEdit.jsx
 * @description Editing a Test Case directly in the side panel of Design (v4.23.1): the title,
 * the description and the "Propiedades del caso" (Estado, Prioridad, Nivel de Prueba, Tipo de
 * Prueba, Tipo de Ejecución, Historia y Épica). Each change is saved at once; there is no
 * separate window and no trip to Jira.
 *
 * Pieces:
 *   - useTestCaseInlineEdit  → the logic: loads what is needed to edit, saves one field at a
 *                              time, and tells Design what to refresh on screen.
 *   - EditableCaseTitle      → the title, with a pencil to edit it.
 *   - EditableCaseDescription→ the text box of the description (Pre-conditions / Test Script).
 *   - EditableCaseProperties → the lists of the properties column.
 *
 * Performance:
 *   - What is needed to edit (current values, list options, allowed statuses) is ONE request,
 *     made 400 ms after the panel opens. Somebody who is only browsing cases quickly does not
 *     trigger it; until it arrives the panel shows the values read-only, exactly as before.
 *   - Saving sends only the field that changed (1 request; 2-3 when the story changes).
 *   - After saving, Design patches what is on screen instead of reloading every Test Case.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '../utils/queryClient';
import { SearchableSelect } from './CommonComponents';

// Wait before loading the edit data, so quick browsing between cases costs nothing.
const LOAD_DELAY_MS = 400;

const isEpicType = (typeName) => {
  const name = String(typeName || '').toLowerCase();
  return name.includes('epic') || name.includes('épica') || name.includes('epica');
};

/**
 * @param {Object} params
 * @param {Object|null} params.testCase            - Case open in the panel (id, key, summary).
 * @param {string} params.projectId
 * @param {Object} params.projectConfig            - Test Pulse configuration of the project.
 * @param {Object} params.requirementsMap          - key → { key, summary, issueType, epicKey, epicSummary }.
 * @param {string} params.currentStoryKey          - Story the case is linked to today ('' = none).
 * @param {Function} params.addNotification
 * @param {Function} params.onPatched              - Receives what changed, to refresh the screen.
 * @returns {Object} State and actions used by the components below.
 */
export function useTestCaseInlineEdit({ testCase, projectId, projectConfig, requirementsMap, currentStoryKey, addNotification, onPatched }) {
  const caseId = testCase ? String(testCase.id) : '';
  const [data, setData] = useState(null);            // answer of getTestCaseForEdit for `caseId`
  const [savingField, setSavingField] = useState(''); // name of the field being saved
  const [titleDraft, setTitleDraft] = useState(null); // null = not editing the title
  const [descDraft, setDescDraft] = useState(null);   // null = not editing the description
  const [replaceRich, setReplaceRich] = useState(false);
  // Identifies the latest case asked for, so a slow answer for a previous case is ignored.
  const wantedRef = useRef('');

  const load = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await invoke('getTestCaseForEdit', { projectId, caseId: id, config: projectConfig });
      if (wantedRef.current === id && res && !res.error) setData(res);
    } catch (_) {
      // Editing simply stays unavailable; the panel keeps showing the values read-only.
    }
  }, [projectId, projectConfig]);

  // A different case in the panel: forget the previous one and load this one after a short wait.
  useEffect(() => {
    wantedRef.current = caseId;
    setData(null);
    setTitleDraft(null);
    setDescDraft(null);
    setReplaceRich(false);
    if (!caseId) return undefined;
    const timer = setTimeout(() => load(caseId), LOAD_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const ready = Boolean(data && data.id === caseId);

  /**
   * Sends one change to Jira. `request` is the extra part of the saveTestCase payload
   * (`changes`, `transitionId` or `requirement`); `screenPatch` is what Design must refresh.
   * Returns true when Jira accepted it.
   */
  const save = async (fieldName, request, localPatch, screenPatch, successTitle) => {
    setSavingField(fieldName);
    try {
      const res = await invoke('saveTestCase', { projectId, caseId, config: projectConfig, ...request });
      if (!res || res.error) {
        addNotification({ type: 'error', title: 'No se pudo guardar el cambio', description: res?.error || '' });
        return false;
      }
      if (wantedRef.current === caseId) setData(prev => (prev ? { ...prev, ...localPatch } : prev));
      onPatched({ id: caseId, ...screenPatch });
      if (res.warning) addNotification({ type: 'warning', title: 'Guardado con una advertencia', description: res.warning });
      else addNotification({ type: 'success', title: successTitle });
      return true;
    } catch (error) {
      addNotification({ type: 'error', title: 'No se pudo guardar el cambio', description: error?.message || String(error) });
      return false;
    } finally {
      setSavingField('');
    }
  };

  const labelOf = (options, id) => (options || []).find(option => option.id === id)?.label || '';

  // ── Actions ──────────────────────────────────────────────────────────────────────────────

  const saveTitle = async () => {
    const summary = String(titleDraft ?? '').replace(/\s+/g, ' ').trim();
    if (!summary || summary === data.summary) { setTitleDraft(null); return; }
    if (await save('summary', { changes: { summary } }, { summary }, { summary }, 'Título actualizado')) setTitleDraft(null);
  };

  const saveDescription = async () => {
    if (descDraft === data.descriptionText) { setDescDraft(null); return; }
    const ok = await save('descriptionText', { changes: { descriptionText: descDraft } },
      { descriptionText: descDraft, hasRichDescription: false }, { descriptionChanged: true }, 'Descripción actualizada');
    if (ok) { setDescDraft(null); setReplaceRich(false); }
  };

  const savePriority = (priorityId) => {
    if (!priorityId || priorityId === data.priorityId) return;
    const name = labelOf(data.options.priority.options, priorityId);
    save('priorityId', { changes: { priorityId } }, { priorityId }, { priority: { id: priorityId, name } }, `Prioridad: ${name}`);
  };

  /** `name` is 'testLevel', 'testType' or 'executionType'; `label` is how the field is called. */
  const saveList = (name, label, optionId) => {
    if (optionId === data[name]?.optionId) return;
    const field = data.options[name];
    const fieldId = {
      testLevel: projectConfig?.testLevelFieldId || 'customfield_10530',
      testType: projectConfig?.testTypeFieldId || 'customfield_10535',
      executionType: projectConfig?.executionTypeFieldId || 'customfield_10534'
    }[name];
    const optionLabel = labelOf(field.options, optionId);
    save(name, { changes: { [name]: { optionId, multiple: field.multiple } } },
      { [name]: { optionId, multiple: field.multiple } },
      { customFields: { [fieldId]: optionId ? { id: optionId, value: optionLabel } : null } },
      `${label}: ${optionLabel || 'sin especificar'}`);
  };

  const saveStatus = async (transitionId) => {
    const transition = (data.transitions || []).find(item => item.id === transitionId);
    if (!transition) return;
    const ok = await save('status', { transitionId }, { statusName: transition.toName }, { status: transition.toName }, `Estado: ${transition.toName}`);
    // The statuses reachable from the new one are different: read them again.
    if (ok) load(caseId);
  };

  const saveStory = (storyKey) => {
    const previousKey = currentStoryKey || '';
    if ((storyKey || '') === previousKey) return;
    const previousLink = (data.links || []).find(link => link.key === previousKey);
    const story = requirementsMap?.[storyKey];
    save('story',
      { requirement: { key: storyKey || '', removeLinkId: previousLink?.linkId || '', linkType: projectConfig?.requirementLinkType || 'ANY' } },
      { links: (data.links || []).filter(link => link.key !== previousKey) },
      { story: { key: storyKey || '', summary: story?.summary || '', previousKey } },
      storyKey ? `Historia: ${storyKey}` : 'Historia desvinculada'
    ).then(ok => { if (ok) load(caseId); }); // the new link gets its id from Jira
  };

  const saveEpic = (epicKey) => {
    if ((epicKey || '') === (data.epic?.key || '')) return;
    const summary = epicOptions.find(option => option.value === epicKey)?.summary || '';
    save('epic', { changes: { epicKey: epicKey || '' } },
      { epic: epicKey ? { key: epicKey, summary } : null },
      { epic: epicKey ? { key: epicKey, summary } : null },
      epicKey ? `Épica: ${epicKey}` : 'Épica propia quitada');
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
    ready, data, savingField, currentStoryKey: currentStoryKey || '',
    storyOptions, epicOptions,
    // title
    titleDraft, setTitleDraft, saveTitle,
    // description
    descDraft, setDescDraft, replaceRich, setReplaceRich, saveDescription,
    descEditing: descDraft !== null,
    startDescriptionEdit: () => { if (data) setDescDraft(data.descriptionText || ''); },
    // properties
    savePriority, saveList, saveStatus, saveStory, saveEpic
  };
}

// ── Shared styles ───────────────────────────────────────────────────────────────────────────

const labelStyle = { display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '4px' };
const selectStyle = { width: '100%', boxSizing: 'border-box', height: '30px', padding: '0 6px', border: '1px solid #8590A2', borderRadius: '4px', fontSize: '0.82rem', color: '#172B4D', background: '#FFFFFF' };
const mutedStyle = { fontSize: '11px', color: '#626F86' };
const smallBtn = { fontSize: '0.78rem', padding: '0.3rem 0.7rem' };

// ── Title ───────────────────────────────────────────────────────────────────────────────────

/** The title of the case. With the edit data loaded, a pencil turns it into a text box. */
export const EditableCaseTitle = ({ edit, summary }) => {
  const titleStyle = { fontSize: '1.05rem', fontWeight: 700, color: '#172B4D', margin: 0, lineHeight: 1.35 };
  if (edit.titleDraft === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <h2 style={titleStyle}>{summary}</h2>
        {edit.ready && (
          <button type="button" onClick={() => edit.setTitleDraft(edit.data.summary || summary || '')} title="Editar el título" aria-label="Editar el título"
            style={{ border: 'none', background: 'none', color: '#0C66E4', cursor: 'pointer', fontSize: '0.9rem', padding: '2px' }}>✎</button>
        )}
      </div>
    );
  }
  const saving = edit.savingField === 'summary';
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
      <input autoFocus value={edit.titleDraft} maxLength={255} disabled={saving}
        onChange={(event) => edit.setTitleDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') edit.saveTitle(); if (event.key === 'Escape') edit.setTitleDraft(null); }}
        style={{ ...selectStyle, flex: '1 1 320px', height: '34px', fontSize: '0.95rem', fontWeight: 600 }} />
      <button type="button" className="btn-primary" style={smallBtn} disabled={saving || !edit.titleDraft.trim()} onClick={edit.saveTitle}>{saving ? 'Guardando…' : 'Guardar'}</button>
      <button type="button" className="btn-secondary" style={smallBtn} disabled={saving} onClick={() => edit.setTitleDraft(null)}>Cancelar</button>
    </div>
  );
};

// ── Description ─────────────────────────────────────────────────────────────────────────────

/** Text box of the description, shown in place of the rendered description while editing. */
export const EditableCaseDescription = ({ edit }) => {
  const saving = edit.savingField === 'descriptionText';
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
        <button type="button" className="btn-secondary" style={smallBtn} disabled={saving} onClick={() => { edit.setDescDraft(null); edit.setReplaceRich(false); }}>Cancelar</button>
        <button type="button" className="btn-primary" style={smallBtn} disabled={saving || blocked || !changed} onClick={edit.saveDescription}>{saving ? 'Guardando…' : 'Guardar descripción'}</button>
      </div>
    </div>
  );
};

// ── Properties ──────────────────────────────────────────────────────────────────────────────

/** One list of the properties column. A field Jira does not let the user edit is shown locked. */
const PropertyList = ({ label, field, value, saving, onChange, emptyLabel = 'Sin especificar' }) => (
  <div>
    <label style={labelStyle}>{label}</label>
    <select style={{ ...selectStyle, opacity: saving ? 0.6 : 1 }} value={value || ''} disabled={saving || !field?.available || field.options.length === 0}
      title={!field?.available ? 'Jira no permite editar este campo en este caso' : undefined}
      onChange={(event) => onChange(event.target.value)}>
      {(!field?.required || !value) && <option value="">{emptyLabel}</option>}
      {(field?.options || []).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </div>
);

/**
 * The editable "Propiedades del caso": Estado, Prioridad, Nivel de Prueba, Tipo de Prueba,
 * Tipo de Ejecución, Historia y Épica. Choosing a value saves it immediately.
 */
export const EditableCaseProperties = ({ edit, derivedEpicKey }) => {
  const { data, savingField } = edit;
  const busy = Boolean(savingField);
  return (
    <>
      {/* Estado: the current one plus the statuses the workflow allows from it. */}
      <div>
        <label style={labelStyle}>Estado</label>
        <select style={{ ...selectStyle, opacity: savingField === 'status' ? 0.6 : 1 }} value="" disabled={busy || (data.transitions || []).length === 0}
          onChange={(event) => edit.saveStatus(event.target.value)}>
          <option value="">{data.statusName || 'Sin estado'}</option>
          {(data.transitions || []).map(transition => <option key={transition.id} value={transition.id}>→ {transition.toName}</option>)}
        </select>
      </div>

      <PropertyList label="Prioridad" field={{ ...data.options.priority, required: true }} value={data.priorityId} saving={busy} onChange={edit.savePriority} />
      <PropertyList label="Nivel de Prueba" field={data.options.testLevel} value={data.testLevel?.optionId} saving={busy} onChange={(id) => edit.saveList('testLevel', 'Nivel de Prueba', id)} />
      <PropertyList label="Tipo de Prueba" field={data.options.testType} value={data.testType?.optionId} saving={busy} onChange={(id) => edit.saveList('testType', 'Tipo de Prueba', id)} />
      <PropertyList label="Tipo de Ejecución" field={data.options.executionType} value={data.executionType?.optionId} saving={busy} onChange={(id) => edit.saveList('executionType', 'Tipo de Ejecución', id)} />

      {/* Historia: the requirement this case tests ("is tested by"). */}
      <div style={{ opacity: savingField === 'story' ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
        <label style={labelStyle}>Historia que prueba</label>
        <SearchableSelect value={edit.currentStoryKey} options={edit.storyOptions} placeholder="Sin historia" onChange={(value) => edit.saveStory(value || '')} />
      </div>

      {/* Épica: the case's own epic. Without one, the epic of its story is the one shown. */}
      <div>
        <label style={labelStyle}>Épica</label>
        <select style={{ ...selectStyle, opacity: savingField === 'epic' ? 0.6 : 1 }} value={data.epic?.key || ''} disabled={busy || !data.options.epic.available}
          title={!data.options.epic.available ? 'Jira no permite asignar una épica a este caso' : undefined}
          onChange={(event) => edit.saveEpic(event.target.value)}>
          <option value="">{derivedEpicKey && !data.epic ? `La de su historia (${derivedEpicKey})` : 'Sin épica'}</option>
          {/* The current epic is listed even when it is not among the project's known epics. */}
          {data.epic && !edit.epicOptions.some(option => option.value === data.epic.key) && (
            <option value={data.epic.key}>{data.epic.key} — {data.epic.summary}</option>
          )}
          {edit.epicOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    </>
  );
};

/**
 * @file TestCaseEditor.jsx
 * @description Form to CREATE a Test Case inside Test Pulse → Design, instead of Jira's own
 * "create issue" window (v4.23.0; create-only since v4.23.1 — an existing case is edited
 * directly in its side panel, see TestCaseInlineEdit.jsx).
 *
 * Fields (the ones of the CSV template "Plantilla_Test_Cases.csv"):
 *   Resumen · Description (Pre-conditions + Test Script) · Historia (is tested by) · Épica ·
 *   Nivel de Prueba · Tipo de Prueba · Tipo de Ejecución · Prioridad · Carpeta
 *
 * How it works:
 *   1. On open it asks the backend for the options of the lists (`getTestCaseCreateMeta`). The
 *      browser keeps that answer for 10 minutes, so opening the form again costs nothing.
 *   2. "Crear" sends the values to `saveTestCase`; then the case is placed in its folder.
 *
 * It is loaded lazily (React.lazy in App.js): its code is downloaded the first time somebody
 * opens the form, not when Test Pulse starts.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '../utils/queryClient';
import { SearchableSelect } from './CommonComponents';

// What the description box suggests when it is empty: the layout of the CSV template.
const DESCRIPTION_PLACEHOLDER = [
  'Pre-conditions:',
  'Usuario activo en base de datos.',
  '',
  'Test Script:',
  'Given que el POS muestra la pantalla de ingreso.',
  'When el usuario ingresa un Usuario y Password correctos.',
  'Then el sistema valida la identidad.'
].join('\n');

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(9, 30, 66, 0.54)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' },
  dialog: { width: '100%', maxWidth: '860px', background: '#FFFFFF', borderRadius: '8px', boxShadow: '0 8px 32px rgba(9, 30, 66, 0.25)', display: 'flex', flexDirection: 'column' },
  header: { padding: '16px 20px', borderBottom: '1px solid #DCDFE4', display: 'flex', alignItems: 'center', gap: '10px' },
  body: { padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '14px 16px' },
  footer: { padding: '12px 20px', borderTop: '1px solid #DCDFE4', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' },
  label: { display: 'block', fontSize: '11px', fontWeight: 700, color: '#44546F', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.03em' },
  input: { width: '100%', boxSizing: 'border-box', height: '34px', padding: '0 8px', border: '1px solid #8590A2', borderRadius: '4px', fontSize: '0.88rem', color: '#172B4D', background: '#FFFFFF' },
  textarea: { width: '100%', boxSizing: 'border-box', minHeight: '220px', padding: '8px', border: '1px solid #8590A2', borderRadius: '4px', fontSize: '0.85rem', lineHeight: 1.5, color: '#172B4D', background: '#FFFFFF', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' },
  muted: { fontSize: '11px', color: '#626F86', marginTop: '4px' },
  error: { fontSize: '0.82rem', color: '#AE2A19', background: '#FFECEB', border: '1px solid #FD9891', borderRadius: '4px', padding: '8px 10px' },
  warning: { fontSize: '0.82rem', color: '#7F5F01', background: '#FFF7D6', border: '1px solid #F8E6A0', borderRadius: '4px', padding: '8px 10px' }
};

const isEpicType = (typeName) => {
  const name = String(typeName || '').toLowerCase();
  return name.includes('epic') || name.includes('épica') || name.includes('epica');
};

// A list with no options yet (before the metadata arrives, or when the project lacks the field).
const NO_FIELD = { available: false, required: false, multiple: false, options: [] };

/**
 * @param {Object} props
 * @param {string} props.projectId
 * @param {Object} props.projectConfig     - Test Pulse configuration of the project.
 * @param {Object} props.requirementsMap   - key → { key, summary, issueType, epicKey, epicSummary }.
 * @param {Array}  props.folderPaths       - [{ id, path }] folders of Design.
 * @param {string} [props.defaultFolderId] - Folder selected in Design.
 * @param {Function} props.addNotification
 * @param {Function} props.onClose
 * @param {Function} props.onSaved         - Called with { id, key } of the new case.
 */
export default function TestCaseEditor({ projectId, projectConfig, requirementsMap, folderPaths, defaultFolderId, addNotification, onClose, onSaved }) {
  const issueTypeName = projectConfig?.testCaseType || 'Test Case';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ options: {}, otherRequired: [] });
  const [form, setForm] = useState({
    summary: '', descriptionText: '', storyKey: '', epicKey: '', priorityId: '',
    testLevel: '', testType: '', executionType: '', folderId: defaultFolderId || ''
  });

  // Options of the lists (cached by the browser for 10 minutes).
  useEffect(() => {
    let cancelled = false;
    invoke('getTestCaseCreateMeta', { projectId, issueTypeName, config: projectConfig })
      .then(res => {
        if (cancelled) return;
        if (!res || res.error) setError(res?.error || 'No se pudieron leer las listas del proyecto.');
        else setMeta({ options: res.options || {}, otherRequired: res.otherRequired || [] });
      })
      .catch(loadError => { if (!cancelled) setError(loadError?.message || String(loadError)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // The form is opened once and closed; it does not need to react to later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (field) => (event) => setForm(prev => ({ ...prev, [field]: event.target.value }));

  const priority = meta.options.priority || NO_FIELD;
  const epicField = meta.options.epic || NO_FIELD;
  const listFields = [
    { name: 'testLevel', label: 'Nivel de Prueba' },
    { name: 'testType', label: 'Tipo de Prueba' },
    { name: 'executionType', label: 'Tipo de Ejecución' }
  ].map(field => ({ ...field, ...(meta.options[field.name] || NO_FIELD) }));

  // Stories and epics of the project (Design already has them loaded).
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
    return [...epics.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [requirementsMap]);
  // Epic the chosen story already belongs to: the case inherits it unless another is chosen.
  const storyEpicKey = requirementsMap?.[form.storyKey]?.epicKey || '';

  const missingRequired = listFields.some(field => field.required && field.options.length > 0 && !form[field.name]);
  const canSave = !loading && !saving && form.summary.trim() && !missingRequired;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Only the fields that have a value are sent.
      const changes = { summary: form.summary };
      if (form.descriptionText.trim()) changes.descriptionText = form.descriptionText;
      if (form.priorityId) changes.priorityId = form.priorityId;
      if (form.epicKey) changes.epicKey = form.epicKey;
      listFields.forEach(field => {
        if (form[field.name]) changes[field.name] = { optionId: form[field.name], multiple: field.multiple };
      });

      const result = await invoke('saveTestCase', {
        projectId,
        caseId: null,
        issueTypeName,
        config: projectConfig,
        changes,
        requirement: form.storyKey ? { key: form.storyKey, linkType: projectConfig?.requirementLinkType || 'ANY' } : undefined
      });
      if (!result || result.error) {
        setError(result?.error || 'No se pudo crear el caso de prueba.');
        return;
      }

      // The new case goes to the chosen folder (same resolver Design uses to move cases).
      if (form.folderId) {
        await invoke('linkCaseToFolder', { caseId: result.id, folderId: form.folderId }).catch(() => {
          addNotification({ type: 'warning', title: 'El caso se creó, pero no se pudo colocar en la carpeta' });
        });
      }
      if (result.warning) addNotification({ type: 'warning', title: `Caso ${result.key} creado con una advertencia`, description: result.warning });
      else addNotification({ type: 'success', title: `Caso ${result.key} creado` });
      onSaved({ id: result.id, key: result.key });
    } catch (saveError) {
      setError(saveError?.message || String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Nuevo caso de prueba">
      <div style={styles.dialog}>
        <div style={styles.header}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#172B4D' }}>Nuevo caso de prueba</h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar" title="Cerrar"
            style={{ marginLeft: 'auto', border: 'none', background: 'none', fontSize: '1.1rem', color: '#626F86', cursor: 'pointer' }}>✕</button>
        </div>

        {loading ? (
          <div style={{ padding: '32px 20px', color: '#626F86', fontSize: '0.88rem' }}>Cargando…</div>
        ) : (
          <div style={styles.body}>
            {meta.otherRequired.length > 0 && (
              <div style={{ ...styles.warning, gridColumn: '1 / -1' }}>
                Este proyecto exige campos que este formulario no tiene: {meta.otherRequired.join(', ')}. Es posible que no se pueda crear el caso hasta agregarlos.
              </div>
            )}

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.label}>Resumen *</label>
              <input style={styles.input} value={form.summary} onChange={set('summary')} maxLength={255} autoFocus placeholder="Título del caso de prueba" />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.label}>Descripción (Pre-conditions y Test Script)</label>
              <textarea style={styles.textarea} value={form.descriptionText} onChange={set('descriptionText')} placeholder={DESCRIPTION_PLACEHOLDER} />
              <div style={styles.muted}>Texto simple. Las etiquetas al inicio de una línea, como "Pre-conditions:" o "Test Script:", se guardan en negritas.</div>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.label}>Historia que prueba (is tested by)</label>
              <SearchableSelect value={form.storyKey} options={storyOptions} placeholder="Sin historia"
                onChange={(value) => setForm(prev => ({ ...prev, storyKey: value || '' }))} />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.label}>Épica</label>
              <select style={styles.input} value={form.epicKey} onChange={set('epicKey')} disabled={!epicField.available}>
                <option value="">{!epicField.available ? 'No disponible en este proyecto' : (storyEpicKey ? `La de su historia (${storyEpicKey})` : 'Sin épica')}</option>
                {epicOptions.map(([key, summary]) => <option key={key} value={key}>{key} — {summary}</option>)}
              </select>
            </div>

            {listFields.map(field => (
              <div key={field.name}>
                <label style={styles.label}>{field.label}{field.required ? ' *' : ''}</label>
                <select style={styles.input} value={form[field.name]} onChange={set(field.name)} disabled={field.options.length === 0}>
                  <option value="">{field.options.length === 0 ? 'No disponible en este proyecto' : 'Sin especificar'}</option>
                  {field.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </div>
            ))}

            <div>
              <label style={styles.label}>Prioridad</label>
              <select style={styles.input} value={form.priorityId} onChange={set('priorityId')} disabled={priority.options.length === 0}>
                <option value="">{priority.options.length === 0 ? 'No disponible en este proyecto' : 'La predeterminada del proyecto'}</option>
                {priority.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </div>

            <div>
              <label style={styles.label}>Carpeta</label>
              <select style={styles.input} value={form.folderId} onChange={set('folderId')}>
                <option value="">Raíz (sin carpeta)</option>
                {(folderPaths || []).map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
              </select>
            </div>

            {error && <div style={{ ...styles.error, gridColumn: '1 / -1' }}>{error}</div>}
          </div>
        )}

        <div style={styles.footer}>
          {!loading && error && !meta.options.priority && <span style={{ ...styles.muted, marginTop: 0, marginRight: 'auto' }}>Las listas no se pudieron cargar.</span>}
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Creando…' : 'Crear caso de prueba'}
          </button>
        </div>
      </div>
    </div>
  );
}

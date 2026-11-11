/**
 * @file TestCaseEditor.jsx
 * @description Form to create or edit a Test Case inside Test Pulse → Design (v4.23.0), so the
 * team no longer needs Jira's own screens for it.
 *
 * Fields (the ones of the CSV template "Plantilla_Test_Cases.csv"):
 *   Resumen · Description (Pre-conditions + Test Script) · Link (is tested by) ·
 *   Nivel de Prueba · Tipo de Prueba · Tipo de Ejecución · Prioridad
 *   (+ Carpeta when creating; an existing case changes folder from its side panel)
 *
 * How it works:
 *   1. On open it loads, at the same time, the options of the lists (priority, level, type,
 *      execution type) and — when editing — the current values of the case. The options come
 *      from the `getProjectIssueTypeFields` resolver, which the app caches for 10 minutes, so
 *      opening the form a second time costs a single request.
 *   2. On save it sends ONLY the fields that changed. A field the tester did not touch is never
 *      rewritten in Jira.
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

/** Options of a Jira field for a <select>: `{ id, label }`. */
const optionsOf = (fieldSchema) => (Array.isArray(fieldSchema?.allowedValues) ? fieldSchema.allowedValues : [])
  .filter(option => option && option.id !== undefined)
  .map(option => ({ id: String(option.id), label: String(option.value || option.name || option.id) }));

/**
 * @param {Object} props
 * @param {'create'|'edit'} props.mode
 * @param {string} props.projectId
 * @param {Object} props.projectConfig          - Test Pulse configuration of the project.
 * @param {Object} [props.testCase]             - Case being edited (id, key).
 * @param {string} [props.currentRequirementKey] - Requirement the case is linked to today.
 * @param {Object} props.requirementsMap        - key → { key, summary, issueType } of the project.
 * @param {Array}  props.folderPaths            - [{ id, path }] folders of Design.
 * @param {string} [props.defaultFolderId]      - Folder selected in Design when creating.
 * @param {Function} props.addNotification
 * @param {Function} props.onClose
 * @param {Function} props.onSaved              - Called with what was saved (see handleSave).
 */
export default function TestCaseEditor({
  mode, projectId, projectConfig, testCase, currentRequirementKey, requirementsMap,
  folderPaths, defaultFolderId, addNotification, onClose, onSaved
}) {
  const isEdit = mode === 'edit';
  const issueTypeName = projectConfig?.testCaseType || 'Test Case';
  // Custom field ids of the project; the same defaults the backend uses (customFieldConfig.js).
  const fieldIds = useMemo(() => ({
    testLevel: projectConfig?.testLevelFieldId || 'customfield_10530',
    testType: projectConfig?.testTypeFieldId || 'customfield_10535',
    executionType: projectConfig?.executionTypeFieldId || 'customfield_10534'
  }), [projectConfig]);

  const emptyForm = {
    summary: '', descriptionText: '', requirementKey: '', priorityId: '',
    testLevel: '', testType: '', executionType: '', folderId: defaultFolderId || ''
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [schema, setSchema] = useState({});
  const [original, setOriginal] = useState(emptyForm);   // values when the form opened
  const [form, setForm] = useState(emptyForm);
  const [loaded, setLoaded] = useState(null);            // answer of getTestCaseForEdit
  const [replaceRich, setReplaceRich] = useState(false); // tester accepted losing rich format

  // Load the list options and, when editing, the current values. Both at the same time.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      invoke('getProjectIssueTypeFields', { projectId, issueTypeName }).catch(() => ({})),
      isEdit ? invoke('getTestCaseForEdit', { projectId, caseId: testCase.id, config: projectConfig }) : Promise.resolve(null)
    ]).then(([fieldSchema, current]) => {
      if (cancelled) return;
      setSchema(fieldSchema && !fieldSchema._isError ? fieldSchema : {});
      if (isEdit) {
        if (!current || current.error) {
          setError(current?.error || 'No se pudo leer el caso de prueba.');
        } else {
          const values = {
            summary: current.summary,
            descriptionText: current.descriptionText,
            requirementKey: currentRequirementKey || '',
            priorityId: current.priorityId,
            testLevel: current.testLevel?.optionId || '',
            testType: current.testType?.optionId || '',
            executionType: current.executionType?.optionId || '',
            folderId: ''
          };
          setLoaded(current);
          setOriginal(values);
          setForm(values);
        }
      }
    }).catch(loadError => {
      if (!cancelled) setError(loadError?.message || String(loadError));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
    // The form is opened for one case and closed; it does not need to react to later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (field) => (event) => setForm(prev => ({ ...prev, [field]: event.target.value }));

  // Options of the lists.
  const priorityOptions = optionsOf(schema.priority);
  const listFields = [
    { name: 'testLevel', label: 'Nivel de Prueba' },
    { name: 'testType', label: 'Tipo de Prueba' },
    { name: 'executionType', label: 'Tipo de Ejecución' }
  ].map(field => ({
    ...field,
    options: optionsOf(schema[fieldIds[field.name]]),
    // A multi-select list in Jira needs its value sent as a list.
    multiple: schema[fieldIds[field.name]]?.schema?.type === 'array' || Boolean(loaded?.[field.name]?.multiple),
    required: Boolean(schema[fieldIds[field.name]]?.required)
  }));

  // Requirements of the project for the "is tested by" link, as "KEY — title".
  const requirementOptions = useMemo(() => [
    { value: '', label: 'Sin requisito' },
    ...Object.values(requirementsMap || {})
      .sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }))
      .map(req => ({ value: req.key, label: `${req.key} — ${req.summary || ''}` }))
  ], [requirementsMap]);

  const descriptionChanged = form.descriptionText !== original.descriptionText;
  // Editing a description that has tables, images or links would flatten it to plain text.
  const richBlocked = isEdit && Boolean(loaded?.hasRichDescription) && descriptionChanged && !replaceRich;
  const missingRequired = listFields.some(field => field.required && field.options.length > 0 && !form[field.name]);
  const hasChanges = isEdit
    ? Object.keys(form).some(field => field !== 'folderId' && form[field] !== original[field])
    : true;
  const canSave = !loading && !saving && form.summary.trim() && !richBlocked && !missingRequired && hasChanges;

  /** Sends the changed fields, then tells Design what to refresh. */
  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Only what changed (everything that has a value, when creating).
      const changed = (field) => (isEdit ? form[field] !== original[field] : form[field] !== '');
      const changes = {};
      if (changed('summary')) changes.summary = form.summary;
      if (changed('descriptionText')) changes.descriptionText = form.descriptionText;
      if (changed('priorityId')) changes.priorityId = form.priorityId;
      listFields.forEach(field => {
        if (changed(field.name)) changes[field.name] = { optionId: form[field.name], multiple: field.multiple };
      });

      let requirement;
      if (changed('requirementKey')) {
        const previousLink = (loaded?.links || []).find(link => link.key === original.requirementKey);
        requirement = {
          key: form.requirementKey,
          removeLinkId: previousLink?.linkId || '',
          linkType: projectConfig?.requirementLinkType || 'ANY'
        };
      }

      const result = await invoke('saveTestCase', {
        projectId,
        caseId: isEdit ? testCase.id : null,
        issueTypeName,
        config: projectConfig,
        changes,
        requirement
      });
      if (!result || result.error) {
        setError(result?.error || 'No se pudo guardar el caso de prueba.');
        return;
      }

      // A new case goes to the chosen folder (same resolver Design uses to move cases).
      if (!isEdit && form.folderId) {
        await invoke('linkCaseToFolder', { caseId: result.id, folderId: form.folderId }).catch(() => {
          addNotification({ type: 'warning', title: 'El caso se creó, pero no se pudo colocar en la carpeta' });
        });
      }
      if (result.warning) addNotification({ type: 'warning', title: 'Guardado con una advertencia', description: result.warning });
      else addNotification({ type: 'success', title: isEdit ? `Caso ${testCase.key} actualizado` : `Caso ${result.key} creado` });

      // What Design needs to refresh its list and side panel without asking Jira for everything.
      const labelOf = (options, id) => options.find(option => option.id === id)?.label || '';
      onSaved({
        created: !isEdit,
        id: result.id,
        key: result.key || testCase?.key,
        summary: form.summary.trim(),
        priority: changed('priorityId') ? { id: form.priorityId, name: labelOf(priorityOptions, form.priorityId) } : undefined,
        customFields: Object.fromEntries(listFields
          .filter(field => changed(field.name))
          .map(field => [fieldIds[field.name], form[field.name] ? { id: form[field.name], value: labelOf(field.options, form[field.name]) } : null])),
        requirementChanged: changed('requirementKey'),
        descriptionChanged: changed('descriptionText')
      });
    } catch (saveError) {
      setError(saveError?.message || String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label={isEdit ? 'Editar caso de prueba' : 'Nuevo caso de prueba'}>
      <div style={styles.dialog}>
        <div style={styles.header}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#172B4D' }}>
            {isEdit ? `Editar caso de prueba ${testCase.key}` : 'Nuevo caso de prueba'}
          </h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar" title="Cerrar"
            style={{ marginLeft: 'auto', border: 'none', background: 'none', fontSize: '1.1rem', color: '#626F86', cursor: 'pointer' }}>✕</button>
        </div>

        {loading ? (
          <div style={{ padding: '32px 20px', color: '#626F86', fontSize: '0.88rem' }}>Cargando…</div>
        ) : (
          <div style={styles.body}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.label}>Resumen *</label>
              <input style={styles.input} value={form.summary} onChange={set('summary')} maxLength={255} autoFocus placeholder="Título del caso de prueba" />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.label}>Descripción (Pre-conditions y Test Script)</label>
              <textarea style={styles.textarea} value={form.descriptionText} onChange={set('descriptionText')} placeholder={DESCRIPTION_PLACEHOLDER} />
              <div style={styles.muted}>Texto simple. Las etiquetas al inicio de una línea, como "Pre-conditions:" o "Test Script:", se guardan en negritas.</div>
              {isEdit && loaded?.hasRichDescription && (
                <div style={{ ...styles.warning, marginTop: '8px' }}>
                  Esta descripción tiene formato que aquí no se puede conservar (tablas, imágenes, enlaces o código). Si la editas, se guardará como texto simple.
                  {descriptionChanged && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={replaceRich} onChange={(event) => setReplaceRich(event.target.checked)} />
                      Entiendo y quiero reemplazar el formato
                    </label>
                  )}
                </div>
              )}
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={styles.label}>Requisito que prueba (is tested by)</label>
              <SearchableSelect value={form.requirementKey} options={requirementOptions} placeholder="Sin requisito"
                onChange={(value) => setForm(prev => ({ ...prev, requirementKey: value || '' }))} />
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
              <select style={styles.input} value={form.priorityId} onChange={set('priorityId')} disabled={priorityOptions.length === 0}>
                <option value="">{priorityOptions.length === 0 ? 'No disponible en este proyecto' : (isEdit ? 'Sin cambio' : 'La predeterminada del proyecto')}</option>
                {priorityOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </div>

            {!isEdit && (
              <div>
                <label style={styles.label}>Carpeta</label>
                <select style={styles.input} value={form.folderId} onChange={set('folderId')}>
                  <option value="">Raíz (sin carpeta)</option>
                  {(folderPaths || []).map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
                </select>
              </div>
            )}

            {error && <div style={{ ...styles.error, gridColumn: '1 / -1' }}>{error}</div>}
          </div>
        )}

        <div style={styles.footer}>
          {isEdit && !loading && !hasChanges && <span style={{ ...styles.muted, marginTop: 0, marginRight: 'auto' }}>Sin cambios por guardar.</span>}
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Guardando…' : (isEdit ? 'Guardar cambios' : 'Crear caso de prueba')}
          </button>
        </div>
      </div>
    </div>
  );
}

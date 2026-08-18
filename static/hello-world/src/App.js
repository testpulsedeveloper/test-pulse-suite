import React, { useEffect, useState, useRef, useMemo } from 'react';
import { invoke as forgeInvoke, view, router, requestJira } from '@forge/bridge';
import { CreateIssueModal } from '@forge/jira-bridge';
import './index.css';

const RichTextEditor = ({ value, onChange, disabled }) => {
  const editorRef = React.useRef(null);

  React.useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const execCmd = (cmd) => {
    document.execCommand(cmd, false, null);
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  return (
    <div style={{ border: '1px solid var(--ds-border)', borderRadius: '4px', overflow: 'hidden', background: 'var(--bg-main)' }}>
      <div style={{ display: 'flex', gap: '0.2rem', padding: '0.3rem', background: 'var(--bg-surface)', borderBottom: '1px solid var(--ds-border)' }}>
        <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newName = prompt("Nuevo nombre para la evidencia:", evName);
                                      if (newName && newName !== evName) {
                                        handleRenameEvidence(test.id, idx, newName, undefined);
                                      }
                                    }}
                                    title="Renombrar evidencia"
                                    style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0 4px', lineHeight: 1}}
                                  >✏️</button>
                                  <button disabled={disabled} onClick={(e) => { e.preventDefault(); execCmd('bold'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem 0.5rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>B</button>
        <button disabled={disabled} onClick={(e) => { e.preventDefault(); execCmd('italic'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem 0.5rem', fontStyle: 'italic', color: 'var(--text-primary)' }}>I</button>
        <button disabled={disabled} onClick={(e) => { e.preventDefault(); execCmd('underline'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem 0.5rem', textDecoration: 'underline', color: 'var(--text-primary)' }}>U</button>
        <div style={{ width: '1px', background: 'var(--ds-border)', margin: '0 0.2rem' }}></div>
        <button disabled={disabled} onClick={(e) => { e.preventDefault(); execCmd('insertUnorderedList'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem 0.5rem', color: 'var(--text-primary)' }}>• Lista</button>
        <button disabled={disabled} onClick={(e) => { e.preventDefault(); execCmd('insertOrderedList'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem 0.5rem', color: 'var(--text-primary)' }}>1. Lista</button>
      </div>
      <div 
        ref={editorRef}
        contentEditable={!disabled}
        onBlur={() => onChange(editorRef.current.innerHTML)}
        style={{ minHeight: '150px', padding: '0.5rem', color: 'var(--text-primary)', outline: 'none' }}
      />
    </div>
  );
};

// Safe invoke that doesn't crash when running locally outside of Jira
const invoke = async (...args) => {
  try {
    return await forgeInvoke(...args);
  } catch (e) {
    console.warn("Forge invoke failed:", e);
    // Forge sometimes rejects with undefined or an object that isn't an Error.
    if (!e) {
      throw new Error("NEEDS_AUTHENTICATION_ERR");
    }
    throw e;
  }
};


// --- Custom Searchable Select Component ---
const SearchableSelect = ({ value, onChange, options, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  
  const filtered = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));
  const selectedOption = options.find(o => o.value === value);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ border: '1px solid var(--ds-border)', padding: '6px 8px', borderRadius: '3px', cursor: 'pointer', background: 'var(--bg-surface)', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </div>
      {isOpen && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--bg-surface)', border: '1px solid var(--ds-border)', borderRadius: '3px', marginTop: '2px', maxHeight: '250px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 8px rgba(0,0,0,0.1)' }}>
          <input 
            type="text" 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Buscar campo..."
            style={{ padding: '8px', borderBottom: '1px solid var(--ds-border)', border: 'none', borderTopLeftRadius: '3px', borderTopRightRadius: '3px', outline: 'none', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
            onClick={e => e.stopPropagation()}
            autoFocus
          />
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length > 0 ? filtered.map(o => (
              <div 
                key={o.value} 
                onClick={() => { onChange(o.value); setIsOpen(false); setSearch(''); }}
                style={{ padding: '6px 8px', cursor: 'pointer', background: value === o.value ? 'var(--ds-background-selected, rgba(0,82,204,0.1))' : 'transparent', fontSize: '0.85rem' }}
                onMouseEnter={e => e.target.style.background = 'var(--ds-background-hover, rgba(9, 30, 66, 0.04))'}
                onMouseLeave={e => e.target.style.background = value === o.value ? 'var(--ds-background-selected, rgba(0,82,204,0.1))' : 'transparent'}
              >
                {o.label}
              </div>
            )) : (
              <div style={{ padding: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>No hay coincidencias</div>
            )}
          </div>
        </div>
      )}
      {isOpen && (
        <div 
          onClick={() => setIsOpen(false)} 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} 
        />
      )}
    </div>
  );
};
// ------------------------------------------

function App() {
  const [activeTab, setActiveTab] = useState('design'); // design, planning, execution, config
  
  // Design Tab State
  const [folders, setFolders] = useState([]);
  const [testCases, setTestCases] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [isAllTestsExpanded, setIsAllTestsExpanded] = useState(true);
  
  // Planning Tab State
  const [testPlans, setTestPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [testCycles, setTestCycles] = useState([]);
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [cycleTests, setCycleTests] = useState([]);
  const [planningFolder, setPlanningFolder] = useState(''); // execution data for selected cycle
  const [expandedExecutionTest, setExpandedExecutionTest] = useState(null);
  const [executionTestDetails, setExecutionTestDetails] = useState({});
  const [runningTests, setRunningTests] = useState({});
  const [previewImages, setPreviewImages] = useState({});
  const [previewModalData, setPreviewModalData] = useState(null);
  const [linkingBugTestId, setLinkingBugTestId] = useState(null); // id of test for which we show the bug-link input
  const [bugKeyInput, setBugKeyInput] = useState('');
  
  // Reports State
  const [reportData, setReportData] = useState({ cycles: [] });
  const [reportSelectedPlan, setReportSelectedPlan] = useState('');
  const [bugResolutionTime, setBugResolutionTime] = useState(null);
  const [reportSelectedCycle, setReportSelectedCycle] = useState('');
  const [executionTypeFieldId, setExecutionTypeFieldId] = useState(null);
  const [resolutionStage, setResolutionStage] = useState('Nuevo a Abierto');
  
  // Modal State
  const [context, setContext] = useState(null);
  const [selectedTestCase, setSelectedTestCase] = useState(null);
  const [testCaseDetails, setTestCaseDetails] = useState({ type: 'traditional', content: [] });
  const [testCaseDetailsLoading, setTestCaseDetailsLoading] = useState(false);
  
  // Search & Refresh State
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Project Context & Config State
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [isGlobal, setIsGlobal] = useState(false);
  const [projectConfig, setProjectConfig] = useState({ testCaseType: '', testCycleType: '', planIssueType: '', requirementIssueTypes: [], requirementLinkType: 'ANY' });
  const [projectIssueTypes, setProjectIssueTypes] = useState([]);
  const [linkTypes, setLinkTypes] = useState([]);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Bulk Upload State
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkHeaders, setBulkHeaders] = useState([]);
  const [bulkStatus, setBulkStatus] = useState('idle'); // idle | parsing | uploading | done | error
  const [bulkProgress, setBulkProgress] = useState({ total: 0, done: 0, errors: 0 });
  const [bulkErrors, setBulkErrors] = useState([]);
  const [bulkPreview, setBulkPreview] = useState([]);
  const [bulkFieldMapping, setBulkFieldMapping] = useState({});  // { csvHeader: jiraFieldId }
  const [bulkFieldSchema, setBulkFieldSchema] = useState({});    // { fieldId: { ...schema } }
  const [bulkTargetFolder, setBulkTargetFolder] = useState('');  // '' = All Tests
  const [jiraFields, setJiraFields] = useState([]);              // campos Jira escribibles
  const [bulkMappingLoaded, setBulkMappingLoaded] = useState(false);
  // Allowlist
  const [allowedProjects, setAllowedProjects] = useState(null);  // null = todos permitidos
  const [isProjectAllowed, setIsProjectAllowed] = useState(true);
  const bulkFileRef = useRef(null);

  const folderPaths = useMemo(() => {
    const getPath = (f) => {
      const parent = folders.find(p => p.id === f.parentId);
      if (parent) {
        return getPath(parent) + ' > ' + f.name;
      }
      return f.name;
    };
    return folders.map(f => ({ id: f.id, name: f.name, path: getPath(f) })).sort((a,b) => a.path.localeCompare(b.path));
  }, [folders]);

  const loadData = async (currentProjectId = selectedProjectId) => {
    setLoading(true);
    try {
      const ctx = await view.getContext();
      setContext(ctx);
      
      const isContextGlobal = !ctx?.extension?.project?.id;
      setIsGlobal(isContextGlobal);
      
      let targetProjectId = currentProjectId || ctx?.extension?.project?.id;
      
      if (isContextGlobal && !currentProjectId) {
        const fetchedProjects = await invoke('getProjects');
        if (fetchedProjects && fetchedProjects.error) {
          console.error("getProjects backend error:", fetchedProjects.error);
          setProjects([{ id: 'error', name: `Error: ${fetchedProjects.error}`, key: 'ERR' }]);
        } else if (!fetchedProjects || fetchedProjects.length === 0) {
          setProjects([{ id: 'none', name: 'Jira returned 0 projects', key: 'N/A' }]);
        } else {
          setProjects(fetchedProjects);
          targetProjectId = fetchedProjects[0].id;
          setSelectedProjectId(targetProjectId);
        }
      } else if (!currentProjectId) {
        setSelectedProjectId(targetProjectId);
      }
      
      if (targetProjectId) {
        const checkError = (res, name) => {
          if (res && res._isError) {
            throw new Error(`API ${name} failed: ${res.status ? res.status + ' ' : ''}${res.message}`);
          }
          return res;
        };
        // Check if project is allowed
        const allowedStatus = await invoke('isProjectAllowed', { projectId: targetProjectId });
        setIsProjectAllowed(allowedStatus.allowed);

        const adminStatus = await invoke('checkAdminPermission', { projectId: targetProjectId });
        setIsAdmin(adminStatus);
        
        if (adminStatus) {
          const allowed = await invoke('getAllowedProjects');
          setAllowedProjects(allowed);
        }

        const fetchedConfig = await invoke('getConfig', { projectId: targetProjectId });
        const config = fetchedConfig || { testCaseType: 'Test Case', testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
        setProjectConfig(config);
        
        const fetchedIssueTypes = await invoke('getProjectIssueTypes', { projectId: targetProjectId });
        setProjectIssueTypes(fetchedIssueTypes || []);
        
        const fetchedFolders = await invoke('getFolders', { projectId: targetProjectId });
        setFolders(fetchedFolders || []);
        
        const fetchedTests = checkError(await invoke('getTestCases', { folderId: null, projectId: targetProjectId, config }), 'getTestCases');
        setTestCases(fetchedTests || []);
        
        const fetchedPlans = checkError(await invoke('getTestPlans', { projectId: targetProjectId, config }), 'getTestPlans');
        setTestPlans(fetchedPlans || []);
        if (fetchedPlans && fetchedPlans.length > 0) {
          setSelectedPlanId(fetchedPlans[0].id);
        }

        const fetchedCycles = checkError(await invoke('getTestCycles', { projectId: targetProjectId, config }), 'getTestCycles');
        setTestCycles(fetchedCycles || []);
        
        const fields = checkError(await invoke('getFields'), 'getFields');
        if (fields && Array.isArray(fields)) {
          if (fields.length === 0) {
            setJiraFields([{ id: 'debug-empty', name: 'Error: API devolvió 0 campos' }]);
          } else {
            const excluded = ['id', 'key', 'project', 'issuetype', 'summary', 'description', 'status', 'resolution', 'created', 'updated'];
            const filtered = fields.filter(f => !excluded.includes(f.id));
            if (filtered.length === 0) {
              setJiraFields([{ id: 'debug-filtered', name: `Error: Todos los ${fields.length} campos fueron filtrados` }]);
            } else {
              setJiraFields(filtered);
            }
          }
          const typeField = (fields.length ? fields : []).find(f => f.name === 'Tipo de ejecución');
          if (typeField) setExecutionTypeFieldId(typeField.id);
        } else {
          setJiraFields([{ id: 'debug-error', name: `Error: ${JSON.stringify(fields)}` }]);
        }
        setBulkMappingLoaded(true);
      }
    } catch (err) {
      console.error("loadData exception:", err);
      const safeMessage = err ? err.message || String(err) : "Unknown error";
      setLoadError(safeMessage);
      setProjects([{ id: 'error', name: `Invoke Error: ${safeMessage}`, key: 'ERR' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenBulkPanel = async () => {
    setShowBulkUpload(true);
    if (!bulkMappingLoaded) {
      const projectId = selectedProjectId || context?.extension?.project?.id;
      if (projectId) {
        // Primero intentamos recuperar del LocalStorage por si Jira falla
        try {
          const localStr = localStorage.getItem(`bulkMapping_${projectId}`);
          if (localStr) {
            const localConf = JSON.parse(localStr);
            if (localConf.mapping) setBulkFieldMapping(localConf.mapping);
            if (localConf.folderId) setBulkTargetFolder(localConf.folderId);
          }
        } catch (e) { console.warn("localStorage error", e); }
        
        const config = await invoke('getBulkMapping', { projectId });
        if (config && Object.keys(config.mapping || {}).length > 0) {
          if (config.mapping) setBulkFieldMapping(config.mapping);
          if (config.folderId) setBulkTargetFolder(config.folderId);
        }
        
        // Fetch project-specific field schema for validation
        const testCaseType = projectConfig?.testCaseType || 'Test Case';
        const schemaFields = await invoke('getProjectIssueTypeFields', { projectId, issueTypeName: testCaseType });
        if (schemaFields && !schemaFields._isError && Object.keys(schemaFields).length > 0) {
          setBulkFieldSchema(schemaFields);
          
          // Usar los campos específicos del proyecto en lugar de los globales
          const excluded = ['project', 'issuetype', 'summary', 'description', 'status', 'resolution', 'created', 'updated', 'attachment', 'issuelinks', 'subtasks'];
          const fieldsArray = Object.keys(schemaFields)
            .filter(key => !excluded.includes(key))
            .map(key => ({ id: key, name: schemaFields[key].name }));
            
          setJiraFields(fieldsArray);
        } else {
          // Fallback if createmeta fails
          const fields = await invoke('getFields');
          if (fields && Array.isArray(fields)) {
            if (fields.length === 0) {
              setJiraFields([{ id: 'debug-empty', name: 'Error: API devolvió 0 campos' }]);
            } else {
              const excluded = ['id', 'key', 'project', 'issuetype', 'summary', 'description', 'status', 'resolution', 'created', 'updated'];
              const filtered = fields.filter(f => !excluded.includes(f.id));
              if (filtered.length === 0) {
                setJiraFields([{ id: 'debug-filtered', name: `Error: Todos los ${fields.length} campos fueron filtrados` }]);
              } else {
                setJiraFields(filtered);
              }
            }
          } else {
            console.warn("getFields no devolvió un array válido. Error:", fields);
            setJiraFields([{ id: 'debug-error', name: `Error: ${JSON.stringify(fields)}` }]);
          }
        }
      } // <- this closes if (projectId)
      setBulkMappingLoaded(true);
    }
  };

  const handleSaveBulkConfig = async () => {
    const projectId = selectedProjectId || context?.extension?.project?.id;
    if (!projectId) return;
    
    // Guardar siempre en LocalStorage (rápido y no requiere permisos de Jira)
    try {
      localStorage.setItem(`bulkMapping_${projectId}`, JSON.stringify({ mapping: bulkFieldMapping, folderId: bulkTargetFolder }));
    } catch (e) {
      console.warn("localStorage save error:", e);
    }

    // Intentar guardar en Jira User Properties (puede fallar si el admin no ha concedido permisos)
    await invoke('saveBulkMapping', { projectId, mapping: bulkFieldMapping, folderId: bulkTargetFolder });
    alert("¡Configuración de mapeo guardada por defecto (en tu sesión)!");
  };

  const handleExportMapping = () => {
    const config = { mapping: bulkFieldMapping, folderId: bulkTargetFolder };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `testpulse_mapping_${selectedProjectId || 'default'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportMapping = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const config = JSON.parse(event.target.result);
        if (config.mapping) setBulkFieldMapping(config.mapping);
        if (config.folderId) setBulkTargetFolder(config.folderId);
        alert("¡Mapeo importado correctamente!");
      } catch (err) {
        alert("Error al leer el archivo de mapeo. Asegúrate de que sea un archivo JSON o de texto válido generado por la App.");
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (view && view.theme && view.theme.enable) {
      view.theme.enable().catch(console.warn);
    }
    loadData();
  }, []);
  
  // Filtered Data
  const filteredTestCases = testCases.filter(tc => {
    const matchesSearch = tc.key.toLowerCase().includes(searchQuery.toLowerCase()) || tc.summary.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFolder = activeFolder === null || tc.folderId === activeFolder;
    return matchesSearch && matchesFolder;
  });
  
  const filteredTestCycles = testCycles.filter(c => 
    c.key?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.summary?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateIssue = () => {
    const projectId = selectedProjectId || context?.extension?.project?.id;
    
    const createIssueModal = new CreateIssueModal({
      context: {
        pid: projectId
      },
      onClose: async (payload) => {
        console.log('Create issue modal closed', payload);
        const fetchedPlans = await invoke('getTestPlans', { projectId, config: projectConfig });
        setTestPlans(fetchedPlans || []);
        const fetchedCycles = await invoke('getTestCycles', { projectId, config: projectConfig });
        setTestCycles(fetchedCycles || []);
        const fetchedTests = await invoke('getTestCases', { folderId: null, projectId, config: projectConfig });
        setTestCases(fetchedTests || []);
      }
    });

    createIssueModal.open();
  };

  // ---------- Bulk Upload Handlers ----------

  /**
   * parseCSVRaw: tokeniza el CSV carácter por carácter.
   * Soporta: campos multilinea entre comillas, comillas escapadas (""),
   *          BOM UTF-8, separador coma, finales de línea \r\n o \n.
   * Devuelve: array de filas, cada fila es un array de strings.
   */
  const parseCSVRaw = (text) => {
    // Quitar BOM y normalizar saltos de línea a \n
    const src = (text.startsWith('\uFEFF') ? text.slice(1) : text)
      .replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < src.length; i++) {
      const c = src[i];

      if (inQuotes) {
        if (c === '"') {
          // Comilla doble escapada ("")
          if (src[i + 1] === '"') { cell += '"'; i++; }
          else { inQuotes = false; }   // cierra el campo
        } else {
          cell += c;   // incluye \n dentro del campo
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ',') {
          row.push(cell);
          cell = '';
        } else if (c === '\n') {
          row.push(cell);
          cell = '';
          // Solo agregar si la fila tiene algún dato
          if (row.some(v => v.trim() !== '')) rows.push(row);
          row = [];
        } else {
          cell += c;
        }
      }
    }
    // Última celda / fila (sin \n al final del archivo)
    row.push(cell);
    if (row.some(v => v.trim() !== '')) rows.push(row);

    return rows;
  };

  const parseCSV = (text) => {
    const raw = parseCSVRaw(text);
    if (raw.length < 2) return { headers: [], rows: [] };

    // Primera fila siempre es encabezado
    const headers = raw[0].map(h => h.trim());

    // Detectar columna summary y descripción por nombre (sin acentos, sin mayúsculas)
    const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const findCol = (...names) => {
      for (const name of names) {
        const idx = headers.findIndex(h => norm(h) === norm(name));
        if (idx !== -1) return idx;
      }
      return -1;
    };
    const summaryIdx = findCol('summary', 'titulo', 'title', 'nombre', 'name', 'tipo de incidencia');
    const descIdx    = findCol('description', 'descripcion', 'descripción', 'desc', 'detalle', 'nombre de caso de prueba');
    const effectiveSummaryIdx = summaryIdx !== -1 ? summaryIdx : 0;

    const rows = raw.slice(1).map((cols, i) => {
      const all = {};
      headers.forEach((h, idx) => { all[h] = (cols[idx] || '').trim(); });
      return {
        row: i + 2,
        summary: (cols[effectiveSummaryIdx] || '').trim(),
        description: descIdx !== -1 ? (cols[descIdx] || '').trim() : '',
        all,
      };
    }).filter(r => r.summary !== '');

    return { headers, rows };
  };

  const handleBulkFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFile(file);
    setBulkStatus('parsing');
    setBulkErrors([]);
    setBulkProgress({ total: 0, done: 0, errors: 0 });
    setBulkPreview([]);
    setBulkHeaders([]);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const { headers, rows } = parseCSV(ev.target.result);
      setBulkHeaders(headers);
      setBulkPreview(rows);
      setBulkStatus(rows.length === 0 ? 'error' : 'idle');
    };
    reader.onerror = () => setBulkStatus('error');
    reader.readAsText(file, 'UTF-8');  // explicit UTF-8
  };

  const handleBulkUpload = async () => {
    if (!bulkPreview.length) return;
    const projectId = selectedProjectId || context?.extension?.project?.id;
    if (!projectId) { alert('Selecciona un proyecto primero.'); return; }

    const testCaseType = projectConfig.testCaseType || 'Test Case';
    setBulkErrors([]);

    // -- Validation Phase --
    const validationErrors = [];
    Object.entries(bulkFieldMapping).forEach(([header, fieldId]) => {
      if (fieldId === 'IGNORE' || fieldId === 'summary' || fieldId === 'description') return;
      const schema = bulkFieldSchema[fieldId];
      if (schema && schema.allowedValues && Array.isArray(schema.allowedValues)) {
        // Build a lowercase map of valid options for case-insensitive comparison
        const allowed = schema.allowedValues.map(v => (v.value || '').toLowerCase());
        bulkPreview.forEach((row) => {
          const val = row.all[header];
          if (val && val.trim() !== '') {
            if (!allowed.includes(val.trim().toLowerCase())) {
              validationErrors.push({
                message: `Fila ${row.row}: El valor "${val}" no es válido para el campo "${schema.name || fieldId}". Valores permitidos: ${schema.allowedValues.map(v => v.value).join(', ')}`
              });
            }
          }
        });
      }
    });

    if (validationErrors.length > 0) {
      setBulkErrors(validationErrors);
      setBulkStatus('error');
      return;
    }
    // -- End Validation Phase --

    setBulkStatus('uploading');

    const CHUNK = 50; // enviamos de 50 en 50 para no saturar la API
    let done = 0;
    let errorCount = 0;
    const allErrors = [];
    const createdIssueIds = [];

    // Reverse map: find which CSV column is mapped to 'summary', 'description', etc.
    const findMappedHeader = (jiraFieldId) => {
      return Object.keys(bulkFieldMapping).find(header => bulkFieldMapping[header] === jiraFieldId);
    };
    
    // We expect 'summary' to be mapped. Fallback to the auto-detected summary column if not.
    const summaryCol = findMappedHeader('summary');
    const descCol = findMappedHeader('description');

    for (let i = 0; i < bulkPreview.length; i += CHUNK) {
      const slice = bulkPreview.slice(i, i + CHUNK);
      const issues = slice.map(r => {
        // Construct fields dynamically based on mapping
        const fields = {
          project: { id: projectId },
          issuetype: { name: testCaseType },
        };
        
        // Add mapped summary (or fallback)
        const summaryText = summaryCol ? r.all[summaryCol] : r.summary;
        if (summaryText) fields.summary = summaryText;

        // Add mapped description (or fallback)
        const descText = descCol ? r.all[descCol] : r.description;
        if (descText) {
          fields.description = {
            type: 'doc', version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: descText }] }]
          };
        }

        // Add other mapped fields, considering their schema types (e.g. options need {value: "x"})
        Object.entries(bulkFieldMapping).forEach(([header, fieldId]) => {
          if (fieldId !== 'summary' && fieldId !== 'description' && fieldId !== 'IGNORE' && r.all[header] && r.all[header].trim() !== '') {
            const schema = bulkFieldSchema[fieldId];
            const val = r.all[header].trim();
            if (schema && schema.allowedValues && Array.isArray(schema.allowedValues)) {
              // Find the exact original value by matching lowercase (since validation passed)
              const matchedOption = schema.allowedValues.find(v => (v.value || '').toLowerCase() === val.toLowerCase());
              fields[fieldId] = matchedOption ? { value: matchedOption.value } : { value: val };
            } else {
              fields[fieldId] = val;
            }
          }
        });

        return { fields };
      });

      try {
        const result = await invoke('bulkCreateTestCases', { issues });
        const created = result?.results?.filter(r => r.success) || [];
        const errs = result?.results?.filter(r => !r.success) || [];
        
        createdIssueIds.push(...created.map(c => c.id));
        done += created.length;
        errorCount += errs.length;
        errs.forEach(e => {
          let rowStr = typeof e.failedElementNumber === 'number' ? `Fila ${e.failedElementNumber + 1}: ` : '';
          if (e.elementErrors && e.elementErrors.errors && Object.keys(e.elementErrors.errors).length > 0) {
            const specificErrs = Object.entries(e.elementErrors.errors).map(([key, msg]) => {
              const fieldName = bulkFieldSchema[key] ? bulkFieldSchema[key].name : key;
              return `${fieldName} (${msg})`;
            });
            allErrors.push({ message: `${rowStr}${specificErrs.join(" | ")}` });
          } else if (e.elementErrors && e.elementErrors.errorMessages && e.elementErrors.errorMessages.length > 0) {
            allErrors.push({ message: `${rowStr}${e.elementErrors.errorMessages.join(", ")}` });
          } else {
            allErrors.push({ message: e.message || JSON.stringify(e) });
          }
        });
        setBulkProgress({ total: bulkPreview.length, done, errors: errorCount });
      } catch (e) {
        console.error("invoke bulkCreateTestCases failed:", e);
        errorCount += issues.length;
        allErrors.push({ message: `Error del servidor: ${e.message || String(e)}` });
        break; // stop loop
      }
    }

    // Link to folder if selected
    if (bulkTargetFolder && createdIssueIds.length > 0) {
      await invoke('bulkLinkToFolder', { issueIds: createdIssueIds, folderId: bulkTargetFolder });
    }

    setBulkErrors(allErrors);
    setBulkStatus(errorCount === 0 ? 'done' : 'error');
    
    // Refresh the test case list
    const fetchedTests = await invoke('getTestCases', {
      folderId: activeFolder,
      projectId,
      config: projectConfig
    });
    setTestCases(fetchedTests || []);
  };

  const resetBulkUpload = () => {
    setBulkFile(null);
    setBulkPreview([]);
    setBulkHeaders([]);
    setBulkStatus('idle');
    setBulkProgress({ total: 0, done: 0, errors: 0 });
    setBulkErrors([]);
    if (bulkFileRef.current) bulkFileRef.current.value = '';
  };

  const renderTopNav = () => (
    <nav className="top-nav glass">
      <div className="nav-brand" style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#78256F'}}>
          <img
            src="./testpulse-icon.png"
            alt="Test Pulse"
            style={{ width: '48px', height: '48px', borderRadius: '12px', objectFit: 'cover' }}
          />
          <span style={{fontWeight: 'bold', fontSize: '1.6rem', whiteSpace: 'nowrap'}}>Test Pulse</span>
        </div>
        {isGlobal && (
          <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
            <span style={{color: 'var(--text-secondary)', fontSize: '1.2rem'}}>/</span>
            <select 
            value={selectedProjectId || ''} 
            onChange={(e) => {
              setSelectedProjectId(e.target.value);
              loadData(e.target.value);
            }}
            style={{
              padding: '0.2rem 0.5rem', 
              borderRadius: '4px', 
              border: 'none', 
              backgroundColor: 'transparent', 
              color: 'var(--text-primary)',
              fontWeight: '600',
              fontSize: '1rem',
              cursor: 'pointer',
              outline: 'none',
              maxWidth: '300px'
            }}
          >
            <option value="" disabled hidden>Select a Project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.key})</option>
            ))}
          </select>
          </div>
        )}
      </div>
      {(isProjectAllowed || isAdmin) && (
        <>
          <div className="nav-tabs" style={{marginLeft: '1rem', flex: 1, overflowX: 'auto', whiteSpace: 'nowrap'}}>
        <button className={`nav-tab ${activeTab === 'design' ? 'active' : ''}`} onClick={() => setActiveTab('design')}>
          Design
        </button>
        <button className={`nav-tab ${activeTab === 'planning' ? 'active' : ''}`} onClick={() => setActiveTab('planning')}>
          Planning
        </button>
        <button className={`nav-tab ${activeTab === 'execution' ? 'active' : ''}`} onClick={() => setActiveTab('execution')}>
          Execution
        </button>
        <button className={`nav-tab ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>
          Reports
        </button>
        {isAdmin && (
          <button 
            className={`nav-tab ${activeTab === 'config' ? 'active' : ''}`} 
            onClick={() => setActiveTab('config')}
            title="Configurations"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 0.5rem' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9C27B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        )}
      </div>
      <div className="nav-actions" style={{display: 'flex', gap: '0.75rem', marginLeft: 'auto', alignItems: 'center', flexShrink: 0}}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }} className="search-container">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2196F3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '8px', pointerEvents: 'none', zIndex: 1 }}><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input 
            type="text" 
            placeholder=""
            title="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ 
              padding: '0.4rem 0.4rem 0.4rem 28px', 
              borderRadius: '4px', 
              border: '1px solid transparent', 
              background: 'transparent',
              width: '32px',
              transition: 'all 0.3s ease',
              cursor: 'pointer'
            }}
            onFocus={(e) => {
              e.target.style.width = '150px';
              e.target.style.background = 'var(--bg-surface)';
              e.target.style.border = '1px solid var(--ds-border)';
              e.target.placeholder = "Search...";
              e.target.style.cursor = 'text';
            }}
            onBlur={(e) => {
              if (!e.target.value) {
                e.target.style.width = '32px';
                e.target.style.background = 'transparent';
                e.target.style.border = '1px solid transparent';
                e.target.placeholder = "";
                e.target.style.cursor = 'pointer';
              }
            }}
          />
        </div>
        <button 
          className="btn-secondary" 
          onClick={() => loadData(selectedProjectId)} 
          disabled={loading} 
          title="Refresh Data"
          style={{ padding: '0.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', background: 'transparent' }}
        >
          {loading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00C853" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{animation: 'spin 1s linear infinite'}}><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00C853" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          )}
        </button>
      </div>
        </>
      )}
    </nav>
  );

  const renderDesignTab = () => (
    <div className="tab-layout">
      {/* Sidebar Navigation (Folders) */}
      <aside className="sidebar glass">
        <h2>Folders</h2>
        <ul className="folder-list">
          <li className={`folder-item ${activeFolder === null ? 'active' : ''}`} onClick={() => setActiveFolder(null)} style={{display: 'flex', alignItems: 'center', gap: '0.25rem', paddingLeft: '0.5rem'}}>
            <div style={{width: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer'}} onClick={(e) => { e.stopPropagation(); setIsAllTestsExpanded(prev => !prev); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--text-secondary)'}}>
                {isAllTestsExpanded ? <line x1="5" y1="12" x2="19" y2="12"></line> : <><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></>}
              </svg>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--warning-color, #FFAB00)" stroke="none" style={{flexShrink: 0}}>
              <path d="M2.5 5A2.5 2.5 0 015 2.5h5.5l1.65 2.5H20a2.5 2.5 0 012.5 2.5v12A2.5 2.5 0 0120 22H5a2.5 2.5 0 01-2.5-2.5V5z" />
            </svg>
            All Tests
          </li>
          {isAllTestsExpanded && (() => {
            const renderTree = (parentId = null, depth = 0) => {
              return folders.filter(f => (f.parentId || null) === parentId).map(folder => {
                const hasChildren = folders.some(f => f.parentId === folder.id);
                const isExpanded = expandedFolders[folder.id] !== false;
                
                return (
                  <React.Fragment key={folder.id}>
                    <li className={`folder-item ${activeFolder === folder.id ? 'active' : ''}`} onClick={() => setActiveFolder(folder.id)} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: `${0.5 + depth * 1.5}rem`}}>
                      <div style={{display: 'flex', alignItems: 'center', gap: '0.25rem', flex: 1, minWidth: 0}}>
                        <div style={{width: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer'}} onClick={(e) => { e.stopPropagation(); setExpandedFolders(prev => ({...prev, [folder.id]: !isExpanded})); }}>
                          {hasChildren ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--text-secondary)'}}>
                              {isExpanded ? <line x1="5" y1="12" x2="19" y2="12"></line> : <><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></>}
                            </svg>
                          ) : null}
                        </div>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--warning-color, #FFAB00)" stroke="none" style={{minWidth: '20px', flexShrink: 0}}>
                          <path d="M2.5 5A2.5 2.5 0 015 2.5h5.5l1.65 2.5H20a2.5 2.5 0 012.5 2.5v12A2.5 2.5 0 0120 22H5a2.5 2.5 0 01-2.5-2.5V5z" />
                        </svg>
                        <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={folder.name}>{folder.name}</span>
                      </div>
                      <div className="folder-actions" style={{display: 'flex', gap: '0.25rem', flexShrink: 0}}>
                        <button onClick={(e) => { e.stopPropagation(); handleCreateFolder(folder.id); setExpandedFolders(prev => ({...prev, [folder.id]: true})); }} title="Nueva Subcarpeta" style={{background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)'}}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleUpdateFolder(folder.id, folder.name); }} title="Editar" style={{background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)'}}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        {isAdmin && (
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id, folder.name); }} title="Eliminar" style={{background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--danger-color)'}}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                          </button>
                        )}
                      </div>
                    </li>
                    {isExpanded && renderTree(folder.id, depth + 1)}
                  </React.Fragment>
                );
              });
            };
            return renderTree(null, 0);
          })()}
        </ul>
        <button className="btn-primary" style={{marginTop: 'auto', width: '100%'}} onClick={handleCreateFolder}>+ New Folder</button>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <div className="header">
          <h1>Design: Folders &amp; Test Cases</h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="btn-primary" onClick={handleCreateIssue}>+ Create Test Case</button>
            <button
              className="btn-secondary"
              onClick={() => { setShowBulkUpload(v => !v); resetBulkUpload(); }}
              title="Opción deshabilitada temporalmente"
              disabled={true}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: 0.5, cursor: 'not-allowed' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 16 12 12 8 16"></polyline>
                <line x1="12" y1="12" x2="12" y2="21"></line>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path>
              </svg>
              Carga Masiva CSV
            </button>
          </div>
        </div>

        {/* ===== PANEL DE CARGA MASIVA ===== */}
        {showBulkUpload && (
          <div className="glass" style={{
            margin: '0 0 1.25rem 0',
            padding: '1.25rem 1.5rem',
            borderRadius: '10px',
            border: '1px solid var(--accent-color)',
            background: 'var(--bg-surface)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                Carga Masiva de Casos de Prueba vía API
              </h3>
              <button
                onClick={() => { setShowBulkUpload(false); resetBulkUpload(); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '1.2rem', lineHeight: 1 }}
                title="Cerrar"
              >✕</button>
            </div>

            {/* Instrucciones */}
            <div style={{
              background: 'rgba(var(--accent-rgb, 99,102,241), 0.08)',
              borderRadius: '6px',
              padding: '0.6rem 0.9rem',
              marginBottom: '1rem',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.5
            }}>
              <strong>Formato del archivo CSV:</strong> Una fila por caso de prueba.<br/>
              <code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: '3px' }}>summary,descripción</code>
              &nbsp;— La primera fila puede ser encabezado o datos directamente.<br/>
              <strong>Sin límite de filas</strong> — Los casos se crean en lotes de 50, superando el límite de 249 de la importación nativa de Jira.
            </div>

            {/* Selector de archivo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <label
                htmlFor="bulk-csv-input"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.45rem 1rem', borderRadius: '6px', cursor: 'pointer',
                  border: '1px dashed var(--accent-color)',
                  color: 'var(--accent-color)', fontSize: '0.9rem',
                  background: 'transparent', transition: 'background 0.2s'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                {bulkFile ? bulkFile.name : 'Seleccionar archivo CSV'}
              </label>
              <input
                id="bulk-csv-input"
                type="file"
                accept=".csv,text/csv"
                ref={bulkFileRef}
                onChange={handleBulkFileChange}
                style={{ display: 'none' }}
              />
              {bulkFile && bulkStatus !== 'uploading' && (
                <button
                  onClick={resetBulkUpload}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.85rem' }}
                >Limpiar</button>
              )}
            </div>

            {/* Preview de filas detectadas */}
            {bulkPreview.length > 0 && bulkStatus !== 'uploading' && (
              <div style={{ marginBottom: '0.75rem' }}>
                <p style={{ margin: '0 0 0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <strong>{bulkPreview.length}</strong> caso(s) detectado(s) — {bulkHeaders.length} columna(s) en el archivo:
                </p>
                <div style={{
                  maxHeight: '200px', overflowY: 'auto', overflowX: 'auto',
                  border: '1px solid var(--ds-border)',
                  borderRadius: '6px', fontSize: '0.8rem'
                }}>
                  <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-base)', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--ds-border)', width: '36px' }}>#</th>
                        {bulkHeaders.map((h, i) => (
                          <th key={i} style={{
                            padding: '4px 8px', textAlign: 'left',
                            borderBottom: '1px solid var(--ds-border)',
                            whiteSpace: 'nowrap', minWidth: '120px',
                            color: h === bulkPreview[0] ? 'inherit' : 'inherit'
                          }}>
                            {h}
                            {/* Indica cuál columna se usará como summary */}
                            {bulkPreview[0]?.summary === bulkPreview[0]?.all?.[h] && (
                              <span style={{ marginLeft: '4px', fontSize: '0.7rem', color: 'var(--accent-color)', fontWeight: 'normal' }}>← summary</span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bulkPreview.slice(0, 10).map((r, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                          <td style={{ padding: '3px 8px', color: 'var(--text-secondary)' }}>{r.row}</td>
                          {bulkHeaders.map((h, j) => (
                            <td key={j} style={{
                              padding: '3px 8px',
                              maxWidth: '220px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: r.all?.[h] ? 'inherit' : 'var(--text-secondary)'
                            }}>
                              {r.all?.[h] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {bulkPreview.length > 10 && (
                    <p style={{ margin: 0, padding: '4px 8px', fontSize: '0.78rem', color: 'var(--text-secondary)', background: 'var(--bg-base)' }}>
                      … y {bulkPreview.length - 10} fila(s) más
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Mapeo de campos y selector de carpeta */}
            {bulkPreview.length > 0 && bulkStatus !== 'uploading' && (
              <div style={{ marginBottom: '1.5rem', background: 'var(--bg-surface)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--ds-border)' }}>
                <h4 style={{ margin: '0 0 0.8rem 0', fontSize: '0.95rem' }}>Configuración de Importación</h4>
                
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-secondary)' }}>
                    Carpeta destino:
                  </label>
                  <select 
                    className="select-input" 
                    value={bulkTargetFolder} 
                    onChange={e => setBulkTargetFolder(e.target.value)}
                    style={{ width: '100%', maxWidth: '300px' }}
                  >
                    <option value="">All Tests (Sin carpeta)</option>
                    {folderPaths.map(f => (
                  <option key={f.id} value={f.id}>{f.path}</option>
                ))}
                  </select>
                </div>

                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                  Mapeo de Campos (CSV → Jira):
                </label>
                <div style={{ border: '1px solid var(--ds-border)', borderRadius: '4px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-base)' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--ds-border)' }}>Columna CSV</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--ds-border)' }}>Campo Jira</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkHeaders.map(header => {
                        const isSummary = bulkPreview[0]?.summary === bulkPreview[0]?.all?.[header];
                        return (
                          <tr key={header} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                            <td style={{ padding: '6px 8px' }}>
                              {header} {isSummary && <span style={{ color: 'var(--accent-color)', fontSize: '0.75rem' }}>(detectado como resumen)</span>}
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <SearchableSelect
                                value={bulkFieldMapping[header] || (isSummary ? 'summary' : 'IGNORE')}
                                onChange={val => setBulkFieldMapping({...bulkFieldMapping, [header]: val})}
                                placeholder="Seleccionar campo..."
                                options={[
                                  { value: 'IGNORE', label: '-- Ignorar (No importar) --' },
                                  { value: 'summary', label: 'Summary (Resumen) *Obligatorio*' },
                                  { value: 'description', label: 'Description (Descripción)' },
                                  ...jiraFields.slice().sort((a,b) => a.name.localeCompare(b.name)).map(f => ({ value: f.id, label: f.name }))
                                ]}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button onClick={handleSaveBulkConfig} className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                    Guardar Configuración por Defecto
                  </button>
                  <button onClick={handleExportMapping} className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                    Exportar Mapeo
                  </button>
                  <label className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer', margin: 0, display: 'inline-flex', alignItems: 'center' }}>
                    Importar Mapeo
                    <input type="file" accept=".json,.txt" onChange={handleImportMapping} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>
            )}

            {/* Barra de progreso mientras sube */}
            {bulkStatus === 'uploading' && (
              <div style={{ marginBottom: '0.75rem' }}>
                <p style={{ margin: '0 0 0.3rem', fontSize: '0.85rem' }}>
                  Creando casos… <strong>{bulkProgress.done}</strong> / {bulkProgress.total}
                  {bulkProgress.errors > 0 && <span style={{ color: 'var(--danger-color)' }}> ({bulkProgress.errors} errores)</span>}
                </p>
                <div style={{ background: 'var(--ds-border)', borderRadius: '20px', height: '8px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    borderRadius: '20px',
                    background: 'var(--accent-color)',
                    width: bulkProgress.total > 0 ? `${Math.round((bulkProgress.done / bulkProgress.total) * 100)}%` : '0%',
                    transition: 'width 0.4s ease'
                  }} />
                </div>
              </div>
            )}

            {/* Mensaje de éxito */}
            {bulkStatus === 'done' && (
              <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.9rem', borderRadius: '6px', background: 'rgba(34,197,94,0.12)', color: '#16a34a', fontSize: '0.85rem' }}>
                ✅ Se crearon <strong>{bulkProgress.done}</strong> caso(s) de prueba correctamente. La lista se ha actualizado.
              </div>
            )}

            {/* Errores */}
            {bulkErrors.length > 0 && (
              <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.9rem', borderRadius: '6px', background: 'rgba(239,68,68,0.1)', color: 'var(--danger-color)', fontSize: '0.82rem' }}>
                <p style={{ margin: '0 0 0.4rem 0', fontWeight: 'bold' }}>⚠️ Se encontraron {bulkErrors.length} error(es):</p>
                <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                    {bulkErrors.map((err, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>{err.message || JSON.stringify(err)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Botones de acción */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn-primary"
                onClick={handleBulkUpload}
                disabled={bulkPreview.length === 0 || bulkStatus === 'uploading' || bulkStatus === 'parsing'}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                {bulkStatus === 'uploading' ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                      <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                      <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
                    </svg>
                    Subiendo…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 16 12 12 8 16"></polyline>
                      <line x1="12" y1="12" x2="12" y2="21"></line>
                      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path>
                    </svg>
                    Subir {bulkPreview.length > 0 ? `${bulkPreview.length} casos` : ''}
                  </>
                )}
              </button>
              {(bulkStatus === 'done' || bulkStatus === 'error') && (
                <button className="btn-secondary" onClick={resetBulkUpload}>Nueva carga</button>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <p>Loading...</p>
        ) : (
          <div className="test-list">
            {filteredTestCases.map(test => (
              <div 
                key={test.id} 
                className="test-card glass"
                onClick={() => { setSelectedTestCase(test); loadTestCaseDetails(test.id); }}
                style={{ cursor: 'pointer' }}
              >
                <div className="test-card-content">
                  <span className="test-id">{test.key}</span>
                  <span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>
                </div>
                <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
                  <span className="status-badge">{test.status}</span>
                  <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}} onClick={e => e.stopPropagation()}>
                    <select 
                       value={test.folderId || ''} 
                       onChange={(e) => handleLinkTestToFolder(test.id, e.target.value)}
                       className="status-badge"
                       style={{padding: '0.2rem', background: 'var(--bg-surface)'}}
                       title="Assign to folder"
                    >
                       <option value="">No Folder (Root)</option>
                       {folderPaths.map(f => <option key={f.id} value={f.id}>{f.path}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}
            {filteredTestCases.length === 0 && (
              <div className="empty-state">
                <p>No Test Cases found in this project.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );

  const loadTestCaseDetails = async (caseId) => {
    setTestCaseDetailsLoading(true);
    const details = await invoke('getTestCaseDetails', { caseId });
    setTestCaseDetails(details || { type: 'traditional', content: [] });
    setTestCaseDetailsLoading(false);
  };

  const handleSaveTestCaseDetails = async () => {
    if (!selectedTestCase) return;
    setTestCaseDetailsLoading(true);
    await invoke('saveTestCaseDetails', { caseId: selectedTestCase.id, details: testCaseDetails });
    setTestCaseDetailsLoading(false);
    // Refresh case list to show any potential updates (though this is mainly props)
  };

  const renderSlidePanel = () => {
    if (!selectedTestCase) return null;

    return (
      <div className="slide-panel-overlay" onClick={() => { setSelectedTestCase(null); setTestCaseDetails({ type: 'traditional', content: [] }); }}>
        <div className="slide-panel" onClick={e => e.stopPropagation()}>
          <div className="slide-panel-header">
            <div>
              <span className="test-id" style={{display: 'block', marginBottom: '0.25rem'}}>{selectedTestCase.key}</span>
              <h2>{selectedTestCase.summary}</h2>
              <span className="status-badge">{selectedTestCase.status}</span>
            </div>
            <button className="close-btn" onClick={() => { setSelectedTestCase(null); setTestCaseDetails({ type: 'traditional', content: [] }); }}>&times;</button>
          </div>
          <div className="slide-panel-body">
            <div style={{marginBottom: '1rem'}}>
              <label style={{display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px'}}>Folder</label>
              <select 
                className="status-badge" 
                style={{width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)'}}
                value={selectedTestCase.folderId || ''}
                onChange={async (e) => {
                  const newFolderId = e.target.value || null;
                  setSelectedTestCase({...selectedTestCase, folderId: newFolderId});
                  await invoke('linkCaseToFolder', { caseId: selectedTestCase.id, folderId: newFolderId });
                  const fetchedTests = await invoke('getTestCases', { folderId: null, projectId: selectedProjectId, config: projectConfig });
                  setTestCases(fetchedTests || []);
                }}
              >
                <option value="">No Folder (Main)</option>
                {folderPaths.map(f => (
                  <option key={f.id} value={f.id}>{f.path}</option>
                ))}
              </select>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', marginBottom: '1rem' }}>
              <h3>Description (Issue)</h3>
            </div>
            {selectedTestCase.description ? (
              <div 
                className="description-content"
                dangerouslySetInnerHTML={{ __html: selectedTestCase.description }} 
              />
            ) : (
              <div className="empty-state" style={{padding: '2rem'}}>
                <p>No issue description available.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const handleCycleSelect = async (cycle) => {
    setSelectedCycle(cycle);
    const execution = await invoke('getCycleExecution', { cycleId: cycle.id });
    setCycleTests(execution || []);
  };

  const handleCreateFolder = async (parentId = null) => {
    const name = prompt("Enter new folder name:");
    if (!name || !selectedProjectId) return;
    setLoading(true);
    const updatedFolders = await invoke('createFolder', { projectId: selectedProjectId, name, parentId: typeof parentId === 'string' ? parentId : null });
    setFolders(updatedFolders || []);
    setLoading(false);
  };

  const handleUpdateFolder = async (folderId, oldName) => {
    const newName = prompt("Enter new folder name:", oldName);
    if (!newName || newName === oldName || !selectedProjectId) return;
    setLoading(true);
    const updatedFolders = await invoke('updateFolder', { projectId: selectedProjectId, folderId, newName });
    setFolders(updatedFolders || []);
    setLoading(false);
  };

  const handleDeleteFolder = async (folderId, name) => {
    if (!window.confirm(`Are you sure you want to delete the folder "${name}"?`)) return;
    if (!selectedProjectId) return;
    setLoading(true);
    const updatedFolders = await invoke('deleteFolder', { projectId: selectedProjectId, folderId });
    setFolders(updatedFolders || []);
    if (activeFolder === folderId) setActiveFolder(null);
    setLoading(false);
  };

  const handleAddTestToCycle = async (testCase) => {
    if (!selectedCycle) return;
    const execution = await invoke('addTestToCycle', { cycleId: selectedCycle.id, testCase });
    setCycleTests(execution || []);
  };

  const handleRemoveTestFromCycle = async (testId) => {
    if (!selectedCycle) return;
    // Optimistic UI update could go here, but let's just wait for invoke
    const execution = await invoke('removeTestFromCycle', { cycleId: selectedCycle.id, testId });
    setCycleTests(execution || []);
  };

  const handleLinkTestToFolder = async (testId, folderId) => {
    if (!selectedProjectId) return;
    setLoading(true);
    await invoke('linkTestToFolder', { testId, folderId: folderId === '' ? null : folderId });
    const config = await invoke('getConfig', { projectId: selectedProjectId });
    const fetchedTests = await invoke('getTestCases', { projectId: selectedProjectId, config });
    setTestCases(fetchedTests || []);
    setLoading(false);
  };

  const handleUpdateTestStatus = async (testId, status) => {
    if (!selectedCycle) return;
    const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, status });
    setCycleTests(execution || []);
  };

  const calculateIterationStatus = (iterations) => {
    if (!iterations || iterations.length === 0) return null;
    const hasFailed = iterations.some(it => it.status === 'Failed');
    const hasBlocked = iterations.some(it => it.status === 'Blocked');
    const allPassed = iterations.every(it => it.status === 'Passed');
    if (hasFailed) return 'Failed';
    if (hasBlocked) return 'Blocked';
    if (allPassed) return 'Passed';
    return 'In Progress';
  };

  const handleAddIteration = async (test) => {
    try {
      const newIter = { id: Date.now().toString(), expectedData: '', actualResult: '', status: 'Not Run' };
      const newIterations = test.iterations ? [...test.iterations, newIter] : [newIter];
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      if (updated) setCycleTests(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const handleIterationChange = async (test, iterId, field, value) => {
    try {
      const newIterations = test.iterations.map(it => it.id === iterId ? { ...it, [field]: value } : it);
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      if (updated) setCycleTests(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const handleTakeover = async (test) => {
    try {
      const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, takeover: true });
      if (updated) setCycleTests(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUploadEvidence = async (testId, testKey, file, iterId) => {
    if (!selectedCycle || !file) return;
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);

      const response = await requestJira(`/rest/api/3/issue/${testKey}/attachments`, {
          method: 'POST',
          body: formData,
          headers: {
              'Accept': 'application/json',
              'X-Atlassian-Token': 'no-check'
          }
      });
      
      const attachments = await response.json();
      if (attachments && attachments.length > 0) {
         const newEvidence = {
           id: attachments[0].id,
           filename: attachments[0].filename,
           url: attachments[0].content
         };
         
         const currentTest = cycleTests.find(t => t.id === testId);
         const currentEvidences = currentTest?.evidences ? [...currentTest.evidences] : [];
         if (currentTest?.evidence && currentEvidences.length === 0) {
             currentEvidences.push(currentTest.evidence);
         }
         currentEvidences.push(newEvidence);
         
         if (iterId) {
            const iters = [...(currentTest.iterations || [])];
            const iterIdx = iters.findIndex(i => i.id === iterId);
            if (iterIdx > -1) {
               iters[iterIdx] = { ...iters[iterIdx], evidences: iters[iterIdx].evidences ? [...iters[iterIdx].evidences, newEvidence] : [newEvidence] };
               const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
               setCycleTests(execution || []);
            }
         } else {
            const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
            setCycleTests(execution || []);
         }
      }
    } catch (err) {
      console.error("Failed to upload evidence", err);
      alert("Error subiendo evidencia");
    }
  };

  const handleDeleteEvidence = async (testId, attachmentId, index, iterId) => {
    const currentTest = cycleTests.find(t => t.id === testId);
    if (!currentTest) return;
    
    if (iterId) {
       const iters = [...(currentTest.iterations || [])];
       const iterIdx = iters.findIndex(i => i.id === iterId);
       if (iterIdx > -1) {
          const evs = iters[iterIdx].evidences ? [...iters[iterIdx].evidences] : [];
          evs.splice(index, 1);
          iters[iterIdx] = { ...iters[iterIdx], evidences: evs };
          setCycleTests(cycleTests.map(t => t.id === testId ? { ...t, iterations: iters } : t));
          await invoke('deleteAttachment', { attachmentId });
          await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
       }
       return;
    }

    let currentEvidences = currentTest.evidences ? [...currentTest.evidences] : [];
    if (currentTest.evidence && currentEvidences.length === 0) {
      currentEvidences.push(currentTest.evidence);
    }
    
    currentEvidences.splice(index, 1);
    setCycleTests(cycleTests.map(t => t.id === testId ? { ...t, evidences: currentEvidences, evidence: null } : t));

    await invoke('deleteAttachment', { attachmentId });
    await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
  };

  
  const handleRenameEvidence = async (testId, index, newName, iterId) => {
    const currentTest = cycleTests.find(t => t.id === testId);
    if (!currentTest) return;
    
    if (iterId) {
       const iters = [...(currentTest.iterations || [])];
       const iterIdx = iters.findIndex(i => i.id === iterId);
       if (iterIdx > -1) {
          const evs = iters[iterIdx].evidences ? [...iters[iterIdx].evidences] : [];
          if (typeof evs[index] === 'object') {
             evs[index] = { ...evs[index], filename: newName };
          }
          iters[iterIdx] = { ...iters[iterIdx], evidences: evs };
          setCycleTests(cycleTests.map(t => t.id === testId ? { ...t, iterations: iters } : t));
          await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
       }
       return;
    }

    let currentEvidences = currentTest.evidences ? [...currentTest.evidences] : [];
    if (currentTest.evidence && currentEvidences.length === 0) {
      currentEvidences.push(currentTest.evidence);
    }
    
    if (typeof currentEvidences[index] === 'object') {
      currentEvidences[index] = { ...currentEvidences[index], filename: newName };
    }
    
    setCycleTests(cycleTests.map(t => t.id === testId ? { ...t, evidences: currentEvidences, evidence: null } : t));
    await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
  };

  const handleCaptureScreen = async (testId, testKey, iterId) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert("Tu navegador no soporta captura de pantalla nativa.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      document.body.appendChild(video);
      video.srcObject = stream;
      
      video.onloadedmetadata = () => {
        setTimeout(async () => {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          stream.getTracks().forEach(track => track.stop());
          document.body.removeChild(video);
          
          canvas.toBlob(async (blob) => {
            if (blob) {
              const file = new File([blob], `screenshot_${Date.now()}.jpg`, { type: 'image/jpeg' });
              await handleUploadEvidence(testId, testKey, file, iterId);
            }
          }, 'image/jpeg', 0.9);
        }, 500);
      };
    } catch(err) {
      console.error("Captura cancelada", err);
    }
  };

  const handleRunTest = async (testId, testKey, test) => {
    try {
      if (test) await handleTakeover(test);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert("Tu navegador o entorno no soporta captura de pantalla nativa. Sube la evidencia manualmente.");
        setRunningTests(prev => ({ ...prev, [testId]: 'active' }));
        return;
      }
      
      setRunningTests(prev => ({ ...prev, [testId]: 'capturing' }));
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      video.style.left = '-9999px';
      document.body.appendChild(video);
      
      video.srcObject = stream;
      
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.play().then(resolve).catch(reject);
        };
        video.onerror = reject;
        setTimeout(() => reject(new Error("Video play timeout")), 8000); // 8 seconds timeout
      });
      
      // Delay to ensure user's shared window is fully painted
      await new Promise(r => setTimeout(r, 800));
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const track = stream.getVideoTracks()[0];
      if (track) track.stop();
      
      document.body.removeChild(video);
      
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `evidence_${testKey}_${Date.now()}.png`, { type: 'image/png' });
        setRunningTests(prev => ({ ...prev, [testId]: 'uploading' }));
        await handleUploadEvidence(testId, testKey, file);
        setRunningTests(prev => ({ ...prev, [testId]: 'active' }));
      }, 'image/png');

    } catch (err) {
      console.error("Captura cancelada o fallida", err);
      // Even if failed/cancelled, unlock the status if they want to fail it or manually upload
      setRunningTests(prev => ({ ...prev, [testId]: 'active' }));
    }
  };

  const handlePreviewEvidence = async (ev) => {
    const id = typeof ev === 'string' ? ev : ev.id;
    const filename = typeof ev === 'string' ? `evidence_${id}.jpg` : (ev.filename || `evidence_${id}.jpg`);

    if (filename.match(/\.(png|jpg|jpeg|gif|pdf|mp4|mov|webm)$/i)) {
      setPreviewModalData({ id, filename, loading: true });
      const data = await invoke('getAttachmentContent', { attachmentId: id });
      if (data && !data.error) {
        setPreviewModalData({ id, filename, loading: false, base64: data.base64, mimeType: data.mimeType || 'image/png' });
      } else {
        setPreviewModalData(null);
        router.open(`/secure/attachment/${id}/${encodeURIComponent(filename)}`);
      }
    } else {
      router.open(`/secure/attachment/${id}/${encodeURIComponent(filename)}`);
    }
  };

  const handleLinkCycleToPlan = async (cycleId, planId) => {
    setLoading(true);
    try {
      await invoke('linkCycleToPlan', { cycleId, planId });
      // Optimistic update to avoid Jira eventual consistency (stale search results)
      setTestCycles(prev => prev.map(c => 
        c.id === cycleId ? { ...c, planId, properties: { ...c.properties, 'testops-plan-link': { planId } } } : c
      ));
    } catch (e) {
      console.error('Failed to link cycle:', e);
      alert('Error linking cycle to plan: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlinkCycleFromPlan = async (cycleId) => {
    setLoading(true);
    try {
      await invoke('unlinkCycleFromPlan', { cycleId });
      const cycles = await invoke('getTestCycles', { projectId: selectedProjectId, config: projectConfig });
      setTestCycles(cycles || []);
      if (selectedCycle && selectedCycle.id === cycleId) {
        setSelectedCycle(null);
      }
    } catch (e) {
      console.error('Failed to unlink cycle:', e);
      alert('Error unlinking cycle from plan: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectData = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    
    // Check permissions
    const admin = await invoke('checkAdminPermission', { projectId: selectedProjectId });
    setIsAdmin(admin);

    // Get config first
    const config = await invoke('getConfig', { projectId: selectedProjectId });
    setProjectConfig(config);

    if (config) {
      // Load tabs data in parallel
      const [fetchedPlans, fetchedCycles, fetchedCases, fetchedFolders] = await Promise.all([
        invoke('getTestPlans', { projectId: selectedProjectId, config }),
        invoke('getTestCycles', { projectId: selectedProjectId, config }),
        invoke('getTestCases', { projectId: selectedProjectId, config }),
        invoke('getFolders', { projectId: selectedProjectId })
      ]);
      setTestPlans(fetchedPlans || []);
      setTestCycles(fetchedCycles || []);
      setTestCases(fetchedCases || []);
      setFolders(fetchedFolders || []);
    }
    setLoading(false);
  };

  const loadReportData = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    const data = await invoke('getExecutionReport', { projectId: selectedProjectId, config: projectConfig });
    setReportData(data || { cycles: [] });
    setLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'execution' && selectedCycle) {
      setLoading(true);
      invoke('getCycleExecution', { cycleId: selectedCycle.id })
        .then(async (execution) => {
          if (!execution || execution.length === 0) {
            setCycleTests([]);
            setLoading(false);
            return;
          }

          // Backfill: if any test in the cycle is missing its description snapshot,
          // fetch it now from Jira and save it so the snapshot is created.
          const needsBackfill = execution.filter(t => !t.description);
          if (needsBackfill.length > 0) {
            const updated = await invoke('backfillDescriptions', {
              cycleId: selectedCycle.id,
              testIds: needsBackfill.map(t => t.id)
            });
            setCycleTests(updated || execution);
          } else {
            setCycleTests(execution);
          }
          setLoading(false);
        });
    } else if (activeTab === 'reports') {
      loadReportData();
    }
  }, [activeTab, selectedCycle]);


  const handleCreateBug = (test) => {
    const projectId = selectedProjectId || context?.extension?.project?.id;
    // Open the native Jira create-issue modal
    const createBugModal = new CreateIssueModal({ context: { pid: projectId } });
    createBugModal.open();
    // Show the inline input so the user can paste the key after creating the bug
    setLinkingBugTestId(test.id);
    setBugKeyInput('');
  };

  const doLinkBug = async (test, bugKey) => {
    // 1. Create Jira Issue Link via backend (uses key directly)
    invoke('linkBugToTest', { testCaseId: test.id, bugKey });

    // 2. Save bug key in execution data so we display the badge
    const currentBugs = test.linkedBugs || [];
    // Avoid duplicates
    if (currentBugs.some(b => b.key === bugKey)) return;
    const updatedBugs = [...currentBugs, { key: bugKey }];
    const updated = await invoke('updateTestStatus', {
      cycleId: selectedCycle.id,
      testId: test.id,
      linkedBugs: updatedBugs
    });
    if (updated) setCycleTests(updated);
  };


  const getStatusColor = (status) => {
    const s = status === 'To Do' ? 'Not Run' : status;
    switch(s) {
      case 'Passed': return 'var(--success-bg)';
      case 'Failed': return 'var(--danger-bg)';
      case 'Blocked': return '#fff0b3';
      case 'Not Run':
      default: return '#deebff';
    }
  };

  const getStatusTextColor = (status) => {
    const s = status === 'To Do' ? 'Not Run' : status;
    switch(s) {
      case 'Passed': return 'var(--success-color)';
      case 'Failed': return 'var(--danger-color)';
      case 'Blocked': return '#ff8b00'; 
      case 'Not Run':
      default: return '#0052cc'; 
    }
  };

  const renderPlanningTab = () => (
    <div className="tab-layout">
      {/* Cycles Sidebar */}
      <aside className="sidebar glass">
        <h2>Test Plans</h2>
        <select 
          value={selectedPlanId} 
          onChange={e => { setSelectedPlanId(e.target.value); setSelectedCycle(null); }}
          className="status-badge"
          style={{width: '100%', marginBottom: '1rem', padding: '0.5rem'}}
        >
          <option value="">Select a Test Plan...</option>
          {testPlans.map(plan => (
            <option key={plan.id} value={plan.id}>{plan.summary}</option>
          ))}
        </select>
        
        {selectedPlanId && (
          <>
            <h3>Cycles in this Plan</h3>
            <ul className="folder-list" style={{marginBottom: '1rem'}}>
              {filteredTestCycles.filter(c => c.planId === selectedPlanId).map(cycle => (
                <li key={cycle.id} className={`folder-item ${selectedCycle?.id === cycle.id ? 'active' : ''}`} onClick={() => handleCycleSelect(cycle)} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden'}}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF9800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0}}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
                    <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{cycle.summary}</span>
                  </div>
                  <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); handleUnlinkCycleFromPlan(cycle.id); }} style={{color: 'var(--danger-color)', padding: '0.2rem 0.5rem', fontSize: '0.7rem', flexShrink: 0}} title="Remove from Plan">- Remove</button>
                </li>
              ))}
            </ul>
            
            <h3>Available Cycles</h3>
            <ul className="folder-list">
              {filteredTestCycles.filter(c => c.planId !== selectedPlanId).map(cycle => (
                <li key={cycle.id} className="folder-item" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden'}}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF9800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0}}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
                    <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{cycle.summary}</span>
                  </div>
                  <button className="btn-secondary" onClick={() => handleLinkCycleToPlan(cycle.id, selectedPlanId)} style={{padding: '0.2rem 0.5rem', fontSize: '0.7rem', flexShrink: 0}}>+ Add</button>
                </li>
              ))}
            </ul>
          </>
        )}
        <button className="btn-primary" style={{marginTop: 'auto', width: '100%'}} onClick={handleCreateIssue}>+ New Cycle/Plan</button>
      </aside>

      <main className="main-content">
        {selectedCycle ? (
          <div>
            <div className="header">
              <h1>Planning: {selectedCycle.summary}</h1>
            </div>
            <h3>Tests in this Cycle</h3>
            <div className="test-list" style={{marginBottom: '2rem'}}>
              {cycleTests.map(test => (
                <div key={test.id} className="test-card glass" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <div className="test-card-content">
                    <span className="test-id">{test.key}</span>
                    <span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>
                  </div>
                  <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
                    <span className="status-badge" style={{
                      backgroundColor: getStatusColor(test.status),
                      color: getStatusTextColor(test.status)
                    }}>{test.status}</span>
                    <button className="btn-secondary" 
                      style={{color: 'var(--danger-color)', borderColor: 'var(--border-color)', padding: '0.2rem 0.5rem', fontSize: '0.8rem'}} 
                      onClick={() => handleRemoveTestFromCycle(test.id)}
                      title="Remove from cycle">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                  </div>
                </div>
              ))}
              {cycleTests.length === 0 && <p className="empty-state">No tests added yet.</p>}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Available Test Cases</h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select 
                  value={planningFolder} 
                  onChange={e => setPlanningFolder(e.target.value)}
                  className="status-badge"
                  style={{ padding: '0.4rem', background: 'var(--bg-surface)' }}
                >
                  <option value="">Todas las Carpetas</option>
                  {folderPaths.map(f => (
                    <option key={f.id} value={f.id}>{f.path}</option>
                  ))}
                </select>
                <button 
                  className="btn-primary" 
                  onClick={async () => {
                    const testsToAdd = testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && !cycleTests.some(ct => ct.id === tc.id));
                    if (testsToAdd.length === 0) return;
                    setLoading(true);
                    for (const test of testsToAdd) {
                      await handleAddTestToCycle(test);
                    }
                    setLoading(false);
                  }}
                  disabled={loading}
                >
                  + Añadir todos
                </button>
              </div>
            </div>
            <div className="test-list">
              {testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && !cycleTests.some(ct => ct.id === tc.id)).map(test => (
                <div key={test.id} className="test-card glass" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <div className="test-card-content">
                    <span className="test-id">{test.key}</span>
                    <span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>
                  </div>
                  <button className="btn-secondary" onClick={() => handleAddTestToCycle(test)}>+ Add to Cycle</button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <p>Select a Test Cycle from the sidebar to plan its tests.</p>
          </div>
        )}
      </main>
    </div>
  );

  const handleToggleExecutionTest = async (testId) => {
    if (expandedExecutionTest === testId) {
      setExpandedExecutionTest(null);
    } else {
      setExpandedExecutionTest(testId);
      if (!executionTestDetails[testId]) {
        const details = await invoke('getTestCaseDetails', { caseId: testId });
        setExecutionTestDetails(prev => ({ ...prev, [testId]: details || { type: 'traditional', content: [] } }));
      }
    }
  };

  const renderExecutionTab = () => (
    <div className="tab-layout">
      {/* Cycles Sidebar */}
      <aside className="sidebar glass">
        <h2>Test Plans</h2>
        <select 
          value={selectedPlanId} 
          onChange={e => { setSelectedPlanId(e.target.value); setSelectedCycle(null); }}
          className="status-badge"
          style={{width: '100%', marginBottom: '1rem', padding: '0.5rem'}}
        >
          <option value="">Select a Test Plan...</option>
          {testPlans.map(plan => (
            <option key={plan.id} value={plan.id}>{plan.summary}</option>
          ))}
        </select>
        
        {selectedPlanId && (
          <>
            <h3>Active Cycles</h3>
            <ul className="folder-list">
              {filteredTestCycles.filter(c => c.planId === selectedPlanId).map(cycle => (
                <li key={cycle.id} className={`folder-item ${selectedCycle?.id === cycle.id ? 'active' : ''}`} onClick={() => handleCycleSelect(cycle)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF9800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
                  {cycle.summary}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <main className="main-content">
        {selectedCycle ? (
          <div>
            <div className="header">
              <h1>Execution: {selectedCycle.summary}</h1>
            </div>
            
            <div className="test-list">
              {cycleTests.map(test => (
                <div key={test.id} className="test-card glass" style={{display: 'flex', flexDirection: 'column'}}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 100px 1fr auto', gap: '1rem', alignItems: 'center', width: '100%' }}>
                    <div onClick={() => handleToggleExecutionTest(test.id)} style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transform: expandedExecutionTest === test.id ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s'}}><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </div>
                    <div onClick={() => handleToggleExecutionTest(test.id)} style={{cursor: 'pointer'}}>
                      <span className="test-id">{test.key}</span>
                    </div>
                    <div onClick={() => handleToggleExecutionTest(test.id)} style={{cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                      <span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>
                      {(test.linkedBugs && test.linkedBugs.length > 0) && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '3px',
                          padding: '0.1rem 0.4rem', borderRadius: '4px', marginLeft: '0.5rem',
                          background: 'var(--danger-bg)', color: 'var(--danger-color)',
                          border: '1px solid var(--danger-color)', fontSize: '0.75rem', fontWeight: '600'
                        }} title="Defectos asociados">
                          🐞 {test.linkedBugs.length}
                        </span>
                      )}
                    </div>
                    <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0}}>
                      <button 
                        title={runningTests[test.id] ? 'Detener Ejecución' : 'Iniciar Ejecución'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (runningTests[test.id]) {
                            setRunningTests(prev => ({ ...prev, [test.id]: null }));
                          } else {
                            handleRunTest(test.id, test.key, test); 
                          }
                        }}
                        disabled={runningTests[test.id] === 'capturing' || runningTests[test.id] === 'uploading'}
                        style={{
                          padding: '0.4rem', background: runningTests[test.id] ? '#ff991f' : 'var(--accent-color, #0C66E4)',
                          color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '32px', height: '32px', boxSizing: 'border-box', marginTop: 0, padding: 0,
                          opacity: (runningTests[test.id] === 'capturing' || runningTests[test.id] === 'uploading') ? 0.7 : 1
                        }}
                      >
                        {runningTests[test.id] === 'capturing' ? '⏹' : 
                         runningTests[test.id] === 'uploading' ? '⏳' : 
                         runningTests[test.id] ? '⏹' : '▶'}
                      </button>
                      <select 
                        className="status-badge" 
                        value={test.status === 'To Do' ? 'Not Run' : test.status} 
                        onChange={(e) => handleUpdateTestStatus(test.id, e.target.value)}
                        disabled={!runningTests[test.id]}
                        style={{
                          backgroundColor: getStatusColor(test.status),
                          color: getStatusTextColor(test.status),
                          border: 'none',
                          cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                          opacity: !runningTests[test.id] ? 0.6 : 1,
                          padding: '0.4rem 0.5rem',
                          width: '100px',
                          height: '32px',
                          boxSizing: 'border-box',
                          textAlign: 'center',
                          textAlignLast: 'center'
                        }}
                      >
                        <option value="Not Run" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Not Run</option>
                        <option value="Passed" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Passed</option>
                        <option value="Failed" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Failed</option>
                        <option value="Blocked" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Blocked</option>
                      </select>
                      
                    </div>
                  </div>
                  
                  {expandedExecutionTest === test.id && (
                    <div style={{marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--ds-border)', display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%'}}>
                      {test.executedBy && (
                        <div style={{fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                           👤 Ejecutado por: <strong>{test.executedBy.displayName}</strong>
                        </div>
                      )}

                      {/* Bug actions section - only for Failed or Blocked */}
                      {true && (
                        <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem'}}>
                          {test.status === 'Failed' && (
                            <button className="btn-secondary" style={{borderColor: 'var(--ds-icon-danger)', color: 'var(--ds-icon-danger)', fontSize: '0.85rem'}} onClick={() => handleCreateBug(test)}>
                              🐞 Reportar Bug
                            </button>
                          )}
                          <button
                            className="btn-secondary"
                            onClick={() => { setLinkingBugTestId(linkingBugTestId === test.id ? null : test.id); setBugKeyInput(''); }}
                            style={{fontSize: '0.85rem'}}
                          >
                            🔗 Vincular Bug existente
                          </button>
                          {/* Inline input */}
                          {linkingBugTestId === test.id && (
                            <div style={{display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                              <input
                                autoFocus
                                type="text"
                                value={bugKeyInput}
                                onChange={e => setBugKeyInput(e.target.value.toUpperCase())}
                                onKeyDown={async e => {
                                  if (e.key === 'Enter' && bugKeyInput.trim()) {
                                    await doLinkBug(test, bugKeyInput.trim());
                                    setLinkingBugTestId(null); setBugKeyInput('');
                                  } else if (e.key === 'Escape') { setLinkingBugTestId(null); }
                                }}
                                placeholder="Key del bug (ej: CU-10)"
                                style={{
                                  padding: '0.3rem 0.5rem', fontSize: '0.85rem', width: '150px',
                                  border: '1px solid var(--danger-color)', borderRadius: '4px',
                                  background: 'var(--bg-surface)', color: 'var(--text-primary)'
                                }}
                              />
                              <button onClick={async () => { if (bugKeyInput.trim()) { await doLinkBug(test, bugKeyInput.trim()); setLinkingBugTestId(null); setBugKeyInput(''); } }}
                                style={{padding: '0.3rem 0.6rem', fontSize: '0.8rem', cursor: 'pointer', background: 'var(--danger-color)', color: '#fff', border: 'none', borderRadius: '4px'}}
                              >Vincular</button>
                              <button onClick={() => { setLinkingBugTestId(null); setBugKeyInput(''); }}
                                style={{padding: '0.3rem 0.5rem', fontSize: '0.8rem', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)'}}
                              >✕</button>
                            </div>
                          )}
                          {/* Bug badges with unlink button */}
                          {(test.linkedBugs && test.linkedBugs.length > 0) && test.linkedBugs.map((bug, idx) => (
                            <span key={idx} style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              padding: '0.2rem 0.4rem 0.2rem 0.6rem', borderRadius: '4px',
                              background: 'var(--danger-bg)', color: 'var(--danger-color)',
                              border: '1px solid var(--danger-color)', fontSize: '0.8rem', fontWeight: '600'
                            }}>
                              <span onClick={() => router.open(`/browse/${bug.key}`)} style={{cursor: 'pointer'}}>🐞 {bug.key}</span>
                              <button
                                onClick={async () => {
                                  const updatedBugs = test.linkedBugs.filter((_, i) => i !== idx);
                                  const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, linkedBugs: updatedBugs });
                                  if (updated) setCycleTests(updated);
                                }}
                                title="Quitar vínculo"
                                style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                              >✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                      
                      {/* --- DETALLES GENERALES DEL CASO --- */}
                      <div style={{display: 'flex', alignItems: 'flex-start', gap: '1rem'}}>
                        <div style={{flex: 1}}>
                          {test.description && (
                            <div 
                              style={{
                                marginBottom: '1rem', 
                                padding: '1rem', 
                                backgroundColor: 'var(--bg-surface)', 
                                border: '1px solid var(--ds-border)', 
                                borderRadius: '4px',
                                fontSize: '0.9rem'
                              }}
                              dangerouslySetInnerHTML={{ __html: test.description }}
                            />
                          )}
                          
                          {((test.evidences && test.evidences.length > 0) || test.evidence) && (
                            <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem'}}>
                              {(test.evidences || (test.evidence ? [test.evidence] : [])).map((ev, idx) => {
                                const evId = typeof ev === 'string' ? ev : ev.id;
                                const evName = typeof ev === 'string' ? `evidence_${evId}.jpg` : (ev.filename || `evidence_${evId}.jpg`);
                                return (
                                <div 
                                  key={idx}
                                  onClick={() => handlePreviewEvidence(ev)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '0.25rem', 
                                    padding: '0.25rem 0.5rem', background: 'var(--ds-background-neutral)', 
                                    borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem',
                                    border: '1px solid var(--ds-border)', color: 'var(--text-secondary)'
                                  }}
                                  title={evName}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                  <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {evName}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newName = prompt("Nuevo nombre para la evidencia:", evName);
                                      if (newName && newName !== evName) {
                                        handleRenameEvidence(test.id, idx, newName, undefined);
                                      }
                                    }}
                                    title="Renombrar evidencia"
                                    style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0 4px', lineHeight: 1}}
                                  >✏️</button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteEvidence(test.id, evId, idx, undefined);
                                    }}
                                    title="Quitar evidencia"
                                    style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                  >✕</button>
                                </div>
                              )})}
                            </div>
                          )}
                        </div>
                        
                        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem'}}>
                          <label className="btn-secondary" style={{padding: '0.4rem', border: '1px solid var(--ds-border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', borderRadius: '4px'}} title="Adjuntar Evidencia">
                            <input 
                              type="file" 
                              style={{display: 'none'}} 
                              onChange={(e) => {
                                if (e.target.files && e.target.files.length > 0) {
                                  handleUploadEvidence(test.id, test.key, e.target.files[0]);
                                }
                              }}
                            />
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                          </label>
                          <button 
                            className="btn-secondary" 
                            style={{padding: '0.4rem', border: '1px solid var(--ds-border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', borderRadius: '4px'}} 
                            title="Grabar pantalla"
                            onClick={() => handleCaptureScreen(test.id, test.key)}
                          >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                          </button>
                        </div>
                      </div>

                      {/* --- ITERACIONES --- */}
                      <div style={{display: 'flex', flexDirection: 'column', gap: '0.8rem'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                          <h4 style={{margin: 0}}>Iteraciones (Data-Driven)</h4>
                          <button onClick={() => handleAddIteration(test)} className="btn-secondary" style={{fontSize: '0.8rem', padding: '0.3rem 0.6rem'}}>+ Agregar iteración</button>
                        </div>
                        
                        {(!test.iterations || test.iterations.length === 0) ? (
                          <div style={{color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic'}}>No hay iteraciones. Haz clic en "+ Agregar iteración" para comenzar.</div>
                        ) : (
                          test.iterations.map((iter, idx) => (
                            <div key={iter.id} style={{display: 'flex', gap: '0.5rem', alignItems: 'flex-start', background: 'var(--bg-surface)', padding: '0.8rem', borderRadius: '6px', border: '1px solid var(--ds-border)'}}>
                              <div style={{fontWeight: 'bold', width: '24px', color: 'var(--text-secondary)'}}>#{idx + 1}</div>
                              <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                                <input 
                                  type="text" 
                                  placeholder="Datos de prueba (Ej: Usuario=admin, Pass=123)" 
                                  defaultValue={iter.expectedData || ''}
                                  onBlur={e => { if (e.target.value !== iter.expectedData) handleIterationChange(test, iter.id, 'expectedData', e.target.value); }}
                                  style={{width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--ds-border)', background: 'var(--bg-main)', color: 'var(--text-primary)'}}
                                />
                                <textarea 
                                  placeholder="Resultado actual..." 
                                  defaultValue={iter.actualResult || ''}
                                  onBlur={e => { if (e.target.value !== iter.actualResult) handleIterationChange(test, iter.id, 'actualResult', e.target.value); }}
                                  style={{width: '100%', minHeight: '50px', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--ds-border)', background: 'var(--bg-main)', color: 'var(--text-primary)', resize: 'vertical'}}
                                />
                              </div>
                              <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '120px'}}>
                                <select 
                                  value={iter.status || 'Not Run'}
                                  onChange={e => handleIterationChange(test, iter.id, 'status', e.target.value)}
                                  className="status-badge"
                                  style={{width: '100%', padding: '0.4rem', border: 'none', cursor: 'pointer', background: getStatusColor(iter.status || 'Not Run'), color: getStatusTextColor(iter.status || 'Not Run')}}
                                >
                                  <option value="Not Run" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Sin Ejecutar</option>
                                  <option value="Passed" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Exitoso</option>
                                  <option value="Failed" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Fallido</option>
                                  <option value="Blocked" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Bloqueado</option>
                                </select>
                                <div style={{display: 'flex', gap: '0.3rem', justifyContent: 'center'}}>
                                  {(iter.evidences && iter.evidences.length > 0) && (
                                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginTop: '0.5rem', width: '100%'}}>
                                      {iter.evidences.map((ev, idx) => {
                                        const evId = typeof ev === 'string' ? ev : ev.id;
                                        const evName = typeof ev === 'string' ? `evidence_${evId}.jpg` : (ev.filename || `evidence_${evId}.jpg`);
                                        return (
                                          <div 
                                            key={idx}
                                            onClick={() => handlePreviewEvidence(ev)}
                                            style={{
                                              display: 'flex', alignItems: 'center', gap: '0.25rem', 
                                              padding: '0.25rem 0.5rem', background: 'var(--ds-background-neutral)', 
                                              borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem',
                                              border: '1px solid var(--ds-border)', color: 'var(--text-secondary)'
                                            }}
                                            title={evName}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                            <span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {evName}
                                            </span>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const newName = prompt("Nuevo nombre para la evidencia:", evName);
                                                if (newName && newName !== evName) {
                                                  handleRenameEvidence(test.id, idx, newName, iter.id);
                                                }
                                              }}
                                              title="Renombrar evidencia"
                                              style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                            >✏️</button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteEvidence(test.id, evId, idx, iter.id);
                                              }}
                                              title="Quitar evidencia"
                                              style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                            >✕</button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <label className="btn-secondary" style={{padding: '0.3rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: '1px solid var(--ds-border)'}} title="Adjuntar evidencia">
                                    <input 
                                      type="file" 
                                      style={{display: 'none'}} 
                                      onChange={(e) => {
                                        if (e.target.files && e.target.files.length > 0) {
                                          handleUploadEvidence(test.id, test.key, e.target.files[0], iter.id);
                                        }
                                      }}
                                    />
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                  </label>
                                  <button title="Grabar pantalla" className="btn-secondary" style={{padding: '0.3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: '1px solid var(--ds-border)'}} onClick={() => handleCaptureScreen(test.id, test.key, iter.id)}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {cycleTests.length === 0 && <p className="empty-state">No tests to execute in this cycle.</p>}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <p>Select a Test Cycle to start execution.</p>
          </div>
        )}
      </main>
    </div>
  );

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setIsSavingConfig(true);
    try {
      await invoke('setConfig', { projectId: selectedProjectId, config: projectConfig });
      await loadData(selectedProjectId);
    } catch (err) {
      console.error("Error saving config:", err);
      alert("Error saving configuration.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const renderReportsTab = () => {
    let filteredCycles = reportData.cycles || [];
    if (reportSelectedPlan) {
      filteredCycles = filteredCycles.filter(c => c.planId === reportSelectedPlan);
    }
    if (reportSelectedCycle) {
      filteredCycles = filteredCycles.filter(c => c.id === reportSelectedCycle);
    }

    let totalCases = 0;
    let passed = 0;
    let failed = 0;
    let blocked = 0;
    let notRun = 0;
    let totalBugs = 0;
    let closedBugs = 0;
    let totalResolutionHours = 0;
    let resolvedCount = 0;
    let resolutionTimeByStage = {
      'Nuevo a Abierto': 0,
      'Abierto a En Curso': 0,
      'En Curso a Resuelto': 0,
      'Resuelto a Validación': 0,
      'Validación a Cerrada': 0
    };
    let stageCount = {
      'Nuevo a Abierto': 0,
      'Abierto a En Curso': 0,
      'En Curso a Resuelto': 0,
      'Resuelto a Validación': 0,
      'Validación a Cerrada': 0
    };

    filteredCycles.forEach(cycle => {
      if(cycle.execution) {
        cycle.execution.forEach(ex => {
          totalCases++;
          if (ex.status === 'Passed') passed++;
          else if (ex.status === 'Failed') failed++;
          else if (ex.status === 'Blocked') blocked++;
          else notRun++;
          if (ex.linkedBugs && ex.linkedBugs.length > 0) {
            totalBugs += ex.linkedBugs.length;
            ex.linkedBugs.forEach(bug => {
              const s = (bug.status || '').toLowerCase(); if (['done', 'closed', 'resolved', 'cerrada', 'cerrado', 'resuelta', 'resuelto', 'terminado'].includes(s)) closedBugs++;
              if (bug.resolutionTimeHours) {
                const total = bug.resolutionTimeHours;
                resolutionTimeByStage['Nuevo a Abierto'] += total * 0.1; stageCount['Nuevo a Abierto']++;
                resolutionTimeByStage['Abierto a En Curso'] += total * 0.2; stageCount['Abierto a En Curso']++;
                resolutionTimeByStage['En Curso a Resuelto'] += total * 0.5; stageCount['En Curso a Resuelto']++;
                resolutionTimeByStage['Resuelto a Validación'] += total * 0.1; stageCount['Resuelto a Validación']++;
                resolutionTimeByStage['Validación a Cerrada'] += total * 0.1; stageCount['Validación a Cerrada']++;
                totalResolutionHours += bug.resolutionTimeHours;
                resolvedCount++;
              }
            });
          }
        });
      }
    });

    // Nuevos calculos
    const ejecutados = passed + failed;

  const handleCopyReportToClipboard = async () => {
    const context = await view.getContext();
    const baseUrl = context.siteUrl;
    let tableRows = '';
    
    // Generar las filas de la tabla de defectos
    filteredCycles.forEach(cycle => {
      if (cycle.execution) {
        cycle.execution.forEach(ex => {
          if (ex.linkedBugs && ex.linkedBugs.length > 0) {
            ex.linkedBugs.forEach(bug => {
              tableRows += `
                <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;"><a href="${baseUrl}/browse/${bug.key}">${bug.key}</a></td>
                  <td style="border: 1px solid #ddd; padding: 8px;">${bug.summary || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">${bug.severity || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">${bug.status || 'Desconocido'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">${bug.assignee || 'Sin asignar'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">${bug.resolution || 'Unresolved'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;"><a href="${baseUrl}/browse/${ex.key}">${ex.key}</a></td>
                </tr>
              `;
            });
          }
        });
      }
    });

    const htmlTemplate = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Resumen de Pruebas: ${reportSelectedCycle ? filteredCycles[0]?.summary : 'Todos los ciclos'}</h2>
        <p>A continuación se presenta el resumen ejecutivo de la ejecución de pruebas.</p>
        
        <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
          <tr style="background-color: #f4f5f7;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Total Casos</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left; color: #22A06B;">Pasados</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left; color: #E34935;">Fallados</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Defectos</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Cobertura</th>
          </tr>
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${allTotal}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${passed}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${failed}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${totalBugs} (Cerrados: ${closedBugs})</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${coverageRate}%</td>
          </tr>
        </table>
        
        <h3>Detalle de Defectos Reportados</h3>
        ${totalBugs > 0 ? `
        <table style="border-collapse: collapse; width: 100%;">
          <tr style="background-color: #f4f5f7;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Id del bug</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Descripción</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Severidad</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Estado</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Responsable</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Resolución</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Link al caso</th>
          </tr>
          ${tableRows}
        </table>
        ` : '<p>No se encontraron defectos en este ciclo.</p>'}
      </div>
    `;

    try {
      const el = document.createElement('div');
      el.innerHTML = htmlTemplate;
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      
      document.execCommand('copy');
      
      selection.removeAllRanges();
      document.body.removeChild(el);

      const subject = encodeURIComponent(`Resumen de Pruebas: ${reportSelectedCycle ? filteredCycles[0]?.summary : 'Todos los ciclos'}`);
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      alert(`Plantilla copiada al portapapeles. Usa ${isMac ? 'Cmd + V' : 'Ctrl + V'} en el correo para pegar la tabla. Abriendo Gmail...`);
      router.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}`);
    } catch(err) {
      console.error('Error al copiar:', err);
      alert("Hubo un error al copiar la plantilla.");
    }
  };
    const successRate = ejecutados > 0 ? ((passed / ejecutados) * 100).toFixed(1) : 0;
    const allTotal = passed + failed + blocked + notRun;
    const coverageRate = allTotal > 0 ? (((passed + failed + blocked) / allTotal) * 100).toFixed(1) : 0;

    // Calc angles for donut
    const pPct = allTotal > 0 ? (passed / allTotal) * 100 : 0;
    const fPct = allTotal > 0 ? (failed / allTotal) * 100 : 0;
    const bPct = allTotal > 0 ? (blocked / allTotal) * 100 : 0;
    const nPct = allTotal > 0 ? (notRun / allTotal) * 100 : (allTotal === 0 ? 100 : 0);
    
    const execStats = {
      manual: { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 },
      auto: { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 }
    };

    filteredCycles.forEach(cycle => {
      if (cycle.execution) {
        cycle.execution.forEach(ex => {
           let isAuto = false;
           const tc = testCases.find(t => t.id === ex.id);
           if (tc && executionTypeFieldId && tc.rawFields && tc.rawFields[executionTypeFieldId]) {
              const val = tc.rawFields[executionTypeFieldId];
              const strVal = typeof val === 'object' ? (val.value || val.name || '') : String(val);
              if (strVal.toLowerCase().includes('auto')) isAuto = true;
           }
           
           const stats = isAuto ? execStats.auto : execStats.manual;
           stats.total++;
           if (ex.status === 'Passed') stats.passed++;
           else if (ex.status === 'Failed') stats.failed++;
           else if (ex.status === 'Blocked') stats.blocked++;
           else stats.notRun++;
        });
      }
    });

    return (
      <div className="tab-layout full-width" style={{padding: '2rem'}}>
        <div className="header" style={{marginBottom: '0'}}>
          <h1>Dashboard: Métricas de Calidad</h1>
          <button 
            className="btn-primary" 
            onClick={handleCopyReportToClipboard}
            style={{padding: '0.4rem 0.8rem', marginLeft: 'auto', marginRight: '1rem'}}
          >
            📋 Enviar reporte de Estatus
          </button>
          <div style={{display: 'flex', gap: '1rem'}}>
            <select 
              value={reportSelectedPlan} 
              onChange={e => { setReportSelectedPlan(e.target.value); setReportSelectedCycle(''); }}
              style={{padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)'}}
            >
              <option value="">1. PROYECTO (Todos los Planes)</option>
              {testPlans.map(p => <option key={p.id} value={p.id}>{p.summary}</option>)}
            </select>
            <select 
              value={reportSelectedCycle} 
              onChange={e => setReportSelectedCycle(e.target.value)}
              style={{padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)'}}
            >
              <option value="">2. VERSIÓN (Todos los Ciclos)</option>
              {(reportSelectedPlan ? (reportData.cycles || []).filter(c => c.planId === reportSelectedPlan) : (reportData.cycles || [])).map(c => 
                <option key={c.id} value={c.id}>{c.summary}</option>
              )}
            </select>
          </div>
        </div>

        <div className="dashboard-grid">
          
          <div className="kpi-row" style={{ gridColumn: '1 / -1', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <div className="kpi-card">
              <div className="kpi-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#E3F2FD" stroke="#1565C0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                TOTAL CASOS
              </div>
              <div className="kpi-value">{allTotal}</div>
            </div>
            
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--success-color, #22A06B)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#E8F5E9" stroke="#2E7D32" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                PASADOS
              </div>
              <div className="kpi-value" style={{ color: 'var(--success-color, #22A06B)' }}>{passed}</div>
            </div>
            
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--danger-color, #E34935)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFEBEE" stroke="#C62828" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                FALLADOS
              </div>
              <div className="kpi-value" style={{ color: 'var(--danger-color, #E34935)' }}>{failed}</div>
            </div>
            
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: totalBugs > 0 ? 'var(--danger-color, #E34935)' : 'var(--text-secondary)' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E34935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-3.9"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17.1c2.1.1 3.8 1.9 3.8 4"/></svg>
                DEFECTOS
              </div>
              <div className="kpi-value" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ lineHeight: '1' }}>{totalBugs}</span>
                {totalBugs > 0 && <span style={{fontSize: '0.9rem', display: 'block', color: 'var(--success-color)', marginTop: '0.5rem', lineHeight: '1'}}>Cerrados = {closedBugs}</span>}
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--brand-color, #0C66E4)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#E3F2FD" stroke="#1565C0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                RESOLUCIÓN
              </div>
              <div className="kpi-value" style={{ fontSize: '1.5rem' }}>
                {resolvedCount > 0 ? `${(totalResolutionHours / resolvedCount).toFixed(1)} hrs` : 'N/A'}
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-title" style={{ color: coverageRate > 50 ? 'var(--success-color, #22A06B)' : 'var(--warning-color, #F6C000)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFFDE7" stroke="#FBC02D" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                COBERTURA
              </div>
              <div className="kpi-value" style={{ color: coverageRate > 50 ? 'var(--success-color, #22A06B)' : 'var(--warning-color, #F6C000)' }}>{coverageRate}%</div>
            </div>

          </div>

          <div className="chart-card">
            <h3>Estado de pruebas</h3>
            <div className="donut-chart-container">
              <div className="donut-chart" style={{ background: `conic-gradient(
                var(--success-color, #22A06B) 0% ${pPct}%,
                var(--danger-color, #E34935) ${pPct}% ${pPct + fPct}%,
                var(--warning-color, #F6C000) ${pPct + fPct}% ${pPct + fPct + bPct}%,
                var(--brand-color, #0C66E4) ${pPct + fPct + bPct}% 100%
              )`}}>
                <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{successRate}%</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Éxito</div>
                </div>
              </div>
              
              <div className="legend">
                <div className="legend-item">
                  <div className="legend-color" style={{ background: 'var(--success-color, #22A06B)' }}></div>
                  <span>Passed ({pPct.toFixed(1)}%)</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{ background: 'var(--danger-color, #E34935)' }}></div>
                  <span>Failed ({fPct.toFixed(1)}%)</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{ background: 'var(--warning-color, #F6C000)' }}></div>
                  <span>Blocked ({bPct.toFixed(1)}%)</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{ background: 'var(--brand-color, #0C66E4)' }}></div>
                  <span>Not Run ({nPct.toFixed(1)}%)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="chart-card">
            <h3>Tipos de Ejecución (Manual vs Auto)</h3>
            <div className="bar-chart-container" style={{ marginTop: '1rem' }}>
              {['manual', 'auto'].map(type => {
                const stats = execStats[type];
                const label = type === 'auto' ? 'Automatizada' : 'Manual';
                return (
                  <div className="bar-row" key={type}>
                    <div className="bar-label">
                      <span>{label}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{stats.total} casos</span>
                    </div>
                    <div className="bar-track">
                      {stats.total > 0 ? (
                        <>
                          {stats.passed > 0 && <div className="bar-segment" style={{ width: `${(stats.passed/stats.total)*100}%`, background: 'var(--success-color, #22A06B)' }} title={`Passed: ${stats.passed}`}>{stats.passed > (stats.total*0.1) ? stats.passed : ''}</div>}
                          {stats.failed > 0 && <div className="bar-segment" style={{ width: `${(stats.failed/stats.total)*100}%`, background: 'var(--danger-color, #E34935)' }} title={`Failed: ${stats.failed}`}>{stats.failed > (stats.total*0.1) ? stats.failed : ''}</div>}
                          {stats.blocked > 0 && <div className="bar-segment" style={{ width: `${(stats.blocked/stats.total)*100}%`, background: 'var(--warning-color, #F6C000)' }} title={`Blocked: ${stats.blocked}`}>{stats.blocked > (stats.total*0.1) ? stats.blocked : ''}</div>}
                          {stats.notRun > 0 && <div className="bar-segment" style={{ width: `${(stats.notRun/stats.total)*100}%`, background: 'var(--brand-color, #0C66E4)' }} title={`Not Run: ${stats.notRun}`}>{stats.notRun > (stats.total*0.1) ? stats.notRun : ''}</div>}
                        </>
                      ) : (
                         <div style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Sin casos</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--success-color, #22A06B)'}}></div> Passed</div>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--danger-color, #E34935)'}}></div> Failed</div>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--warning-color, #F6C000)'}}></div> Blocked</div>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--brand-color, #0C66E4)'}}></div> Not Run</div>
            </div>
          </div>

          
          <div className="chart-card" style={{ gridColumn: '1 / -1' }}>
             <h3>Progreso por Ciclo de Pruebas</h3>
             <div className="bar-chart-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem', marginTop: '1rem' }}>
               {filteredCycles.length === 0 ? (
                 <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>No hay ciclos para mostrar.</div>
               ) : (
                 filteredCycles.map(cycle => {
                   let cPassed = 0, cFailed = 0, cBlocked = 0, cNotRun = 0;
                   if (cycle.execution) {
                     cycle.execution.forEach(ex => {
                       if (ex.status === 'Passed') cPassed++;
                       else if (ex.status === 'Failed') cFailed++;
                       else if (ex.status === 'Blocked') cBlocked++;
                       else cNotRun++;
                     });
                   }
                   const cTotal = cPassed + cFailed + cBlocked + cNotRun;
                   
                   return (
                     <div className="bar-row" key={cycle.id}>
                       <div className="bar-label" title={cycle.summary}>
                         <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{cycle.summary}</span>
                         <span style={{ color: 'var(--text-secondary)' }}>{cTotal} casos</span>
                       </div>
                       <div className="bar-track">
                         {cTotal > 0 ? (
                           <>
                             {cPassed > 0 && <div className="bar-segment" style={{ width: `${(cPassed/cTotal)*100}%`, background: 'var(--success-color, #22A06B)' }} title={`Passed: ${cPassed}`}></div>}
                             {cFailed > 0 && <div className="bar-segment" style={{ width: `${(cFailed/cTotal)*100}%`, background: 'var(--danger-color, #E34935)' }} title={`Failed: ${cFailed}`}></div>}
                             {cBlocked > 0 && <div className="bar-segment" style={{ width: `${(cBlocked/cTotal)*100}%`, background: 'var(--warning-color, #F6C000)' }} title={`Blocked: ${cBlocked}`}></div>}
                             {cNotRun > 0 && <div className="bar-segment" style={{ width: `${(cNotRun/cTotal)*100}%`, background: 'var(--brand-color, #0C66E4)' }} title={`Not Run: ${cNotRun}`}></div>}
                           </>
                         ) : (
                           <div style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Sin casos</div>
                         )}
                       </div>
                     </div>
                   );
                 })
               )}
             </div>
          </div>
          
          {filteredCycles.some(c => c.execution && c.execution.some(ex => ex.linkedBugs && ex.linkedBugs.length > 0)) ? (
            <div className="chart-card" style={{ gridColumn: '1 / -1', marginTop: '1rem', overflowX: 'auto', marginBottom: '1rem' }}>
              <h3>Detalle de Defectos Reportados</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--ds-background-neutral)', borderBottom: '2px solid var(--ds-border)' }}>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Id del bug</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descripción</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Severidad</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Responsable</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Resolución</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Link al caso</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCycles.flatMap(cycle => 
                    (cycle.execution || []).flatMap(ex => 
                      (ex.linkedBugs || []).map((bug, i) => (
                        <tr key={bug.key + '-' + i} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                          <td style={{ padding: '0.5rem' }}>
                             <a href="#" onClick={(e) => { e.preventDefault(); router.open(`/browse/${bug.key}`); }}>{bug.key}</a>
                          </td>
                          <td style={{ padding: '0.5rem' }}>{bug.summary || 'N/A'}</td>
                          <td style={{ padding: '0.5rem' }}>{bug.severity || 'N/A'}</td>
                          <td style={{ padding: '0.5rem' }}>
                            <span className="status-badge" style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem', backgroundColor: (bug.resolution && bug.resolution !== 'Unresolved') ? 'var(--success-bg)' : 'var(--danger-bg)', color: (bug.resolution && bug.resolution !== 'Unresolved') ? 'var(--success-color)' : 'var(--danger-color)' }}>
                              {bug.status || 'Desconocido'}
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem' }}>{bug.assignee || 'Sin asignar'}</td>
                          <td style={{ padding: '0.5rem' }}>{bug.resolution || 'Unresolved'}</td>
                          <td style={{ padding: '0.5rem' }}>
                             <a href="#" onClick={(e) => { e.preventDefault(); router.open(`/browse/${ex.key}`); }}>{ex.key}</a>
                          </td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderConfigTab = () => (
    <div className="tab-layout">
      <main className="main-content" style={{ maxWidth: '800px', margin: '0 auto' }}>
        <div className="header">
          <h1>Project Configurations</h1>
        </div>
        
        {!selectedProjectId ? (
          <div className="empty-state">
            <p>Please select a project from the top navigation to configure issue types.</p>
          </div>
        ) : (
          <div className="glass" style={{ padding: '2rem', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '1rem' }}>Map Issue Types</h2>
            <p style={{ marginBottom: '2rem', color: 'var(--ds-text-subtlest)' }}>
              Select the custom Jira issue types used in this project to represent Test Cases, Test Cycles, and Test Sets.
            </p>
            
            <form onSubmit={handleSaveConfig}>
              <div className="form-group">
                <label>Test Case Issue Type</label>
                <select 
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)' }}
                  value={projectConfig.testCaseType}
                  onChange={(e) => setProjectConfig({...projectConfig, testCaseType: e.target.value})}
                  required
                >
                  <option value="">Select an issue type...</option>
                  {projectIssueTypes.map(it => (
                    <option key={it.id} value={it.name}>{it.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label>Test Cycle Issue Type</label>
                <select 
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)' }}
                  value={projectConfig.testCycleType}
                  onChange={(e) => setProjectConfig({...projectConfig, testCycleType: e.target.value})}
                  required
                >
                  <option value="">Select an issue type...</option>
                  {projectIssueTypes.map(it => (
                    <option key={it.id} value={it.name}>{it.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label>Test Plan Issue Type (Test Set)</label>
                <select 
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)' }}
                  value={projectConfig.planIssueType || ''}
                  onChange={(e) => setProjectConfig({...projectConfig, planIssueType: e.target.value})}
                  required
                >
                  <option value="">Select an issue type...</option>
                  {projectIssueTypes.map(it => (
                    <option key={it.id} value={it.name}>{it.name}</option>
                  ))}
                </select>
              </div>

              <hr style={{ margin: '2rem 0', borderColor: 'var(--ds-border)' }} />
              <h3 style={{ marginBottom: '1rem' }}>Requirements Traceability</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Select the issue types that represent requirements (e.g., Story, Epic) and the link type used to connect Test Cases to those requirements.
              </p>

              <div className="form-group">
                <label>Requirement Issue Types</label>
                <select 
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)', height: '100px' }}
                  multiple
                  value={projectConfig.requirementIssueTypes || []}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
                    setProjectConfig({...projectConfig, requirementIssueTypes: selected});
                  }}
                >
                  {projectIssueTypes.map(it => (
                    <option key={it.id} value={it.name}>{it.name}</option>
                  ))}
                </select>
                <small style={{ color: 'var(--text-secondary)' }}>Hold Ctrl/Cmd to select multiple.</small>
              </div>

              <div className="form-group">
                <label>Test-to-Requirement Link Type</label>
                <select 
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)' }}
                  value={projectConfig.requirementLinkType || 'ANY'}
                  onChange={(e) => setProjectConfig({...projectConfig, requirementLinkType: e.target.value})}
                >
                  <option value="ANY">Any Link Type</option>
                  {linkTypes.map(lt => (
                    <option key={lt.id} value={lt.name}>{lt.name} ({lt.outward} / {lt.inward})</option>
                  ))}
                </select>
              </div>
              
              <div style={{ marginTop: '2rem' }}>
                <button type="submit" className="btn-primary" disabled={isSavingConfig}>
                  {isSavingConfig ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Allowlist Section (Admin only) */}
        {selectedProjectId && isAdmin && (
          <div className="glass" style={{ padding: '2rem', borderRadius: '8px', marginTop: '2rem' }}>
            <h2 style={{ marginBottom: '1rem', color: 'var(--danger-color)' }}>Restricción por Proyecto</h2>
            <p style={{ marginBottom: '1rem', color: 'var(--ds-text-subtlest)' }}>
              Puedes habilitar o deshabilitar Test Pulse específicamente para este proyecto.
              Si lo deshabilitas, los usuarios regulares no podrán ver ni usar la app aquí.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginBottom: '1.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 'bold' }}>
                <input 
                  type="checkbox" 
                  checked={isProjectAllowed}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    setIsProjectAllowed(enabled);
                    await invoke('setAllowedProjects', { projectId: selectedProjectId, enabled });
                    alert(`Test Pulse ha sido ${enabled ? 'habilitado' : 'deshabilitado'} para este proyecto.`);
                  }}
                />
                Habilitar Test Pulse en este proyecto
              </label>
            </div>
          </div>
        )}

      </main>
    </div>
  );

  const renderModal = () => null;

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--bg-main)' }}>
        <img 
          src="./testpulse-icon.png" 
          alt="Test Pulse Logo" 
          style={{ width: '160px', height: '160px', borderRadius: '32px', objectFit: 'cover', marginBottom: '2rem', animation: 'pulse 1.5s infinite ease-in-out' }} 
        />
        <h2 style={{ color: '#78256F', margin: 0, fontSize: '2.4rem', fontWeight: 'bold' }}>Test Pulse</h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.8rem', fontSize: '1.2rem' }}>Cargando entorno...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="error-container" style={{ padding: '2rem', textAlign: 'center', color: '#DE350B', backgroundColor: 'var(--bg-main)', height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>❌ Error de Conexión (Forge)</h2>
        <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}><strong>Detalles:</strong> {loadError}</p>
        <div style={{ maxWidth: '600px', textAlign: 'left', backgroundColor: 'var(--bg-surface)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--ds-border)', marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>¿Qué significa esto?</h3>
          <p>Tu navegador puede estar bloqueando las Cookies de Terceros, o Jira requiere que le des permiso explícito a la aplicación.</p>
          <h4>Paso 1: Si no has dado permisos a Jira</h4>
          <p>Haz clic en el botón de abajo para forzar la autorización de Jira. Esto debería abrir una ventana (o mostrar una pantalla) pidiendo tu permiso para acceder a los datos.</p>
          
          <div style={{ textAlign: 'center', margin: '20px 0' }}>
            <button 
              className="primary-button" 
              style={{ fontSize: '1.2rem', padding: '12px 24px', cursor: 'pointer' }}
              onClick={async () => {
                try {
                  // Make dummy requests to trigger the consent flow for multiple scopes
                  const projectId = context?.extension?.project?.id;
                  if (projectId) await requestJira(`/rest/api/3/project/${projectId}`);
                  await requestJira('/rest/api/3/search/jql', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jql: 'assignee = currentUser()' })
                  });
                  alert('¡Autorización exitosa! Recargando...');
                  window.location.reload();
                } catch (e) {
                  alert('Error al autorizar: ' + (e.message || String(e)));
                }
              }}
            >
              Autorizar Test Pulse
            </button>
          </div>

          <h4>Paso 2: Si el botón de arriba falla (Cookies Bloqueadas)</h4>
          <ol>
            <li>En la barra de direcciones de Chrome, haz clic en el ícono del "Ojo con una raya" (Terceros bloqueados).</li>
            <li>Selecciona "Sitio que no funciona" y luego "Permitir cookies".</li>
            <li>Recarga la página.</li>
          </ol>
        </div>
      </div>
    );
  }

  if (!isProjectAllowed && !isAdmin) {
    return (
      <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--bg-main)' }}>
        {renderTopNav()}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--ds-border)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '1rem'}}>
              <img src="./testpulse-icon.png" alt="Test Pulse" style={{ width: '48px', height: '48px', borderRadius: '12px', objectFit: 'cover' }} />
              <h1 style={{ margin: 0, fontSize: '2rem', color: '#78256F', fontWeight: 'bold' }}>Test Pulse</h1>
            </div>
            <h2 style={{ margin: '0 0 1rem 0', color: 'var(--danger-color)' }}>Acceso Restringido</h2>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto' }}>
              Test Pulse no está habilitado para este proyecto. Contacta a un Administrador de Jira si necesitas acceso.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {renderTopNav()}
      
      {!isProjectAllowed && isAdmin && (
        <div style={{ background: 'var(--warning-color)', color: '#fff', padding: '0.5rem 1rem', textAlign: 'center', fontSize: '0.9rem', fontWeight: 'bold' }}>
          ⚠️ Este proyecto no está en el Allowlist. Lo puedes ver porque eres Administrador.
        </div>
      )}

      {isGlobal && !selectedProjectId ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flex: 1, backgroundColor: 'var(--bg-main)' }}>
          <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="var(--ds-background-neutral, #DFE1E6)" stroke="none" style={{ marginBottom: '1rem' }}>
              <path d="M2.5 5A2.5 2.5 0 015 2.5h5.5l1.65 2.5H20a2.5 2.5 0 012.5 2.5v12A2.5 2.5 0 0120 22H5a2.5 2.5 0 01-2.5-2.5V5z" />
            </svg>
            <h2 style={{ color: 'var(--text-primary)', marginTop: 0 }}>Select a Project</h2>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto' }}>Please select a Jira project from the dropdown in the top navigation bar to view and manage its tests.</p>
          </div>
        </div>
      ) : (
        <>
          {activeTab === 'design' && renderDesignTab()}
          {activeTab === 'planning' && renderPlanningTab()}
          {activeTab === 'execution' && renderExecutionTab()}
          {activeTab === 'reports' && renderReportsTab()}
          {activeTab === 'config' && isAdmin && renderConfigTab()}
        </>
      )}
      {renderModal()}
      {renderSlidePanel()}
      {previewModalData && (
        <div className="modal-overlay" style={{zIndex: 9999}}>
          <div className="modal-content glass" style={{width: '90%', height: '90%', maxWidth: '1200px', display: 'flex', flexDirection: 'column'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
              <h2 style={{margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)'}}>{previewModalData.filename}</h2>
              <button className="btn-secondary" onClick={() => setPreviewModalData(null)}>✕ Cerrar</button>
            </div>
            <div style={{flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'auto', background: 'var(--bg-main)', borderRadius: '4px'}}>
              {previewModalData.loading ? (
                <p>Cargando vista previa...</p>
              ) : previewModalData.filename.toLowerCase().endsWith('.pdf') ? (
                <object data={`data:application/pdf;base64,${previewModalData.base64}`} type="application/pdf" width="100%" height="100%">
                  <p>Tu navegador no soporta PDFs incrustados. <a href={`/secure/attachment/${previewModalData.id}/${encodeURIComponent(previewModalData.filename)}`} target="_blank" rel="noreferrer">Descargar PDF</a>.</p>
                </object>
              ) : previewModalData.filename.match(/\.(mp4|mov|webm)$/i) ? (
                <video controls style={{maxWidth: '100%', maxHeight: '100%', objectFit: 'contain'}} src={`data:${previewModalData.mimeType || 'video/mp4'};base64,${previewModalData.base64}`} />
              ) : (
                <img src={`data:${previewModalData.mimeType};base64,${previewModalData.base64}`} alt="Evidence preview" style={{maxWidth: '100%', maxHeight: '100%', objectFit: 'contain'}} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error("React Crash:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: 'var(--danger-color)', backgroundColor: 'var(--danger-bg)' }}>
          <h2>Algo salió mal (React Crash)</h2>
          <details style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>
            <summary>Ver detalles del error</summary>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

function WrappedApp() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default WrappedApp;

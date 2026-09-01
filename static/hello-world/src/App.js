import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { invoke as forgeInvoke, view, router, requestJira } from '@forge/bridge';
import { CreateIssueModal } from '@forge/jira-bridge';
import './index.css';



function textToAdf(text) {
  if (!text) return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] };
  const lines = text.split('\n');
  const content = [];
  
  let currentTable = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (currentTable) { content.push(currentTable); currentTable = null; }
      continue;
    }

    if (line.startsWith('||') && line.endsWith('||')) {
      if (!currentTable) {
        currentTable = { type: 'table', attrs: { isNumberColumnEnabled: false, layout: "default" }, content: [] };
      }
      const cells = line.split('||').filter(Boolean).map(cell => ({
        type: 'tableHeader',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: cell.trim() }] }]
      }));
      currentTable.content.push({ type: 'tableRow', content: cells });
    } else if (line.startsWith('|') && line.endsWith('|')) {
      if (!currentTable) {
        currentTable = { type: 'table', attrs: { isNumberColumnEnabled: false, layout: "default" }, content: [] };
      }
      const cells = line.split('|').filter(Boolean).map(cell => ({
        type: 'tableCell',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: cell.trim() }] }]
      }));
      currentTable.content.push({ type: 'tableRow', content: cells });
    } else {
      if (currentTable) { content.push(currentTable); currentTable = null; }
      
      const match = line.match(/^([^:]+):(.*)$/);
      if (match) {
        const strongText = match[1] + ':';
        const restText = match[2];
        const paraContent = [
          { type: 'text', text: strongText, marks: [{ type: 'strong' }] }
        ];
        if (restText) {
          paraContent.push({ type: 'text', text: restText });
        }
        content.push({ type: 'paragraph', content: paraContent });
      } else {
        content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: line }]
        });
      }
    }
  }
  if (currentTable) content.push(currentTable);

  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: ' ' }] });
  }

  return { type: 'doc', version: 1, content };
}

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
                                    disabled={!runningTests[test.id]}
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


// ══════════════════════════════════════════════════════════════
// Notification System (replaces alert / confirm / prompt)
// ══════════════════════════════════════════════════════════════
const NotificationContext = React.createContext(null);

const NotificationStack = ({ notifications, onDismiss }) => (
  <div style={{
    position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999,
    display: 'flex', flexDirection: 'column', gap: '0.5rem',
    maxWidth: '360px', pointerEvents: 'none'
  }}>
    {notifications.map(n => {
      const colorMap = {
        success: { bg: '#e3fcef', border: '#00875a', icon: '✅' },
        error:   { bg: '#ffebe6', border: '#de350b', icon: '❌' },
        warning: { bg: '#fff7e6', border: '#ff991f', icon: '⚠️' },
        info:    { bg: '#e6f0ff', border: '#0052cc', icon: 'ℹ️' },
      };
      const c = colorMap[n.type] || colorMap.info;
      return (
        <div key={n.id} onClick={() => onDismiss(n.id)} style={{
          background: c.bg, border: `1px solid ${c.border}`, borderRadius: '6px',
          padding: '0.75rem 1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          pointerEvents: 'all', cursor: 'pointer',
          display: 'flex', gap: '0.6rem', alignItems: 'flex-start'
        }}>
          <span style={{ flexShrink: 0 }}>{c.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {n.title && <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: n.description ? '0.2rem' : 0 }}>{n.title}</div>}
            {n.description && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{n.description}</div>}
          </div>
        </div>
      );
    })}
  </div>
);

function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const addNotification = useCallback(({ type = 'info', title, description, duration = 4500 }) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev.slice(-4), { id, type, title, description }]);
    if (duration > 0) setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), duration);
  }, []);
  return (
    <NotificationContext.Provider value={{ addNotification }}>
      {children}
      <NotificationStack notifications={notifications} onDismiss={id => setNotifications(prev => prev.filter(n => n.id !== id))} />
    </NotificationContext.Provider>
  );
}

const useNotification = () => {
  const ctx = React.useContext(NotificationContext);
  if (!ctx) return { addNotification: ({ title, description }) => console.warn('Notification:', title, description) };
  return ctx;
};

function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmLabel = 'Confirmar', danger = false }) {
  if (!isOpen) return null;
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface)', borderRadius: '8px', padding: '1.5rem', maxWidth: '400px', width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>{title}</h3>
        <p style={{ margin: '0 0 1.25rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{message}</p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onCancel} style={{ padding: '0.4rem 1rem' }}>Cancelar</button>
          <button onClick={onConfirm} style={{ padding: '0.4rem 1rem', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, background: danger ? '#de350b' : 'var(--accent-color)', color: 'white' }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function TextInputModal({ isOpen, title, label, defaultValue = '', placeholder = '', onConfirm, onCancel }) {
  const [value, setValue] = useState(defaultValue);
  React.useEffect(() => { if (isOpen) setValue(defaultValue); }, [isOpen, defaultValue]);
  if (!isOpen) return null;
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface)', borderRadius: '8px', padding: '1.5rem', maxWidth: '380px', width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>{title}</h3>
        {label && <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>{label}</label>}
        <input autoFocus type="text" value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onConfirm(value.trim()); if (e.key === 'Escape') onCancel(); }}
          placeholder={placeholder}
          style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.75rem', border: '1px solid var(--ds-border)', borderRadius: '4px', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '0.9rem', marginBottom: '1rem', outline: 'none' }} />
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onCancel} style={{ padding: '0.4rem 1rem' }}>Cancelar</button>
          <button onClick={() => { if (value.trim()) onConfirm(value.trim()); }} style={{ padding: '0.4rem 1rem', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, background: 'var(--accent-color)', color: 'white' }}>Aceptar</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('design'); // design, planning, execution, config
  
  // Design Tab State
  const [folders, setFolders] = useState([]);
  const [testCases, setTestCases] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [isAllTestsExpanded, setIsAllTestsExpanded] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e) => {
      let newWidth = e.clientX;
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 800) newWidth = 800;
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);
  
  // Planning Tab State
  const [testPlans, setTestPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [testCycles, setTestCycles] = useState([]);
  const [selectedCycle, setSelectedCycle] = useState(null);
  
  const [cycleTests, setCycleTests] = useState([]);
  const deletedIdsRef = useRef(new Set()); // in-session deletions (current cycle)
  const perCycleDeletedRef = useRef({});   // { [cycleId]: Set<testId> } — persists across cycle switches

  const safeSetCycleTests = useCallback((newExecutionData) => {
      setCycleTests(prev => {
          if (!newExecutionData || !Array.isArray(newExecutionData)) { console.error('safeSetCycleTests got non-array:', newExecutionData); return prev; }
          
          const backendMap = {};
          newExecutionData.forEach(item => backendMap[item.id] = item);
          
          // 1. Keep items we have locally (avoids them disappearing due to backend read-replica delay)
          //    BUT exclude any IDs that were explicitly deleted
          const newArray = prev
            .filter(pItem => !deletedIdsRef.current.has(String(pItem.id)))
            .map(pItem => {
                if (backendMap[pItem.id]) {
                    return { ...pItem, ...backendMap[pItem.id], description: pItem.description || backendMap[pItem.id].description };
                }
                return pItem;
            });
          
          // 2. Add any items from backend that we DON'T have locally, UNLESS we just deleted them
          newExecutionData.forEach(item => {
              if (!prev.some(pItem => pItem.id === item.id) && !deletedIdsRef.current.has(String(item.id))) {
                  newArray.push(item);
              }
          });
          
          return newArray;
      });
  }, []);

  const [planningFolder, setPlanningFolder] = useState('');
  const [planningPriority, setPlanningPriority] = useState('');
  const [planningExecutionType, setPlanningExecutionType] = useState('');
  const [planningChecked, setPlanningChecked] = useState(new Set()); // multi-select for bulk delete
  const [selectedTestsForCycle, setSelectedTestsForCycle] = useState([]); // execution data for selected cycle
  const [expandedExecutionTest, setExpandedExecutionTest] = useState(null);
  const [executionTestDetails, setExecutionTestDetails] = useState({});
  const [runningTests, setRunningTests] = useState({});
  const [unlinkedBugs, setUnlinkedBugs] = useState([]);
  const [syncProgress, setSyncProgress] = useState(null); // null | { done, total }
  const [isAddingAll, setIsAddingAll] = useState(false);
  const [previewImages, setPreviewImages] = useState({});
  const [previewModalData, setPreviewModalData] = useState(null);
  const [linkingBugTestId, setLinkingBugTestId] = useState(null); // id of test for which we show the bug-link input
  const [bugKeyInput, setBugKeyInput] = useState('');
  
  // Reports State
  const [reportData, setReportData] = useState({ cycles: [] });
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSelectedPlans, setReportSelectedPlans] = useState([]);
  const [bugResolutionTime, setBugResolutionTime] = useState(null);
  const [reportSelectedCycles, setReportSelectedCycles] = useState([]);
  const [executionTypeFieldId, setExecutionTypeFieldId] = useState(null);
  const [resolutionStage, setResolutionStage] = useState('Nuevo a Abierto');
  
  // Modal State
  const [context, setContext] = useState(null);
  const [selectedTestCase, setSelectedTestCase] = useState(null);
  const [selectedTestCaseDescription, setSelectedTestCaseDescription] = useState(null);
  const [loadingDescription, setLoadingDescription] = useState(false);

  useEffect(() => {
    if (selectedTestCase) {
      if (selectedTestCase.description) {
         setSelectedTestCaseDescription(selectedTestCase.description);
      } else {
         setLoadingDescription(true);
         setSelectedTestCaseDescription(null);
         invoke('getIssueDescription', { issueId: selectedTestCase.id }).then(desc => {
            setSelectedTestCaseDescription(desc);
            setLoadingDescription(false);
         }).catch(() => {
            setLoadingDescription(false);
         });
      }
    } else {
      setSelectedTestCaseDescription(null);
    }
  }, [selectedTestCase]);

  const [testCaseDetails, setTestCaseDetails] = useState({ type: 'traditional', content: [] });
  const [testCaseDetailsLoading, setTestCaseDetailsLoading] = useState(false);
  const [testCaseHistory, setTestCaseHistory] = useState([]);
  
  // Search & Refresh State
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [loading, setLoading] = useState(true);
  const [localLoading, setLocalLoading] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState(null); // {processed, total, migrated, modern, skipped, errors}

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

  // Notifications
  const { addNotification } = useNotification();

  // Modal state (replaces alert/confirm/prompt)
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null, danger: false, confirmLabel: 'Confirmar' });
  const [textInputModal, setTextInputModal] = useState({ isOpen: false, title: '', label: '', defaultValue: '', placeholder: '', onConfirm: null });

  const showConfirm = useCallback((title, message, onConfirm, { danger = false, confirmLabel = 'Confirmar' } = {}) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, danger, confirmLabel });
  }, []);

  const showTextInput = useCallback((title, onConfirm, { label = '', defaultValue = '', placeholder = '' } = {}) => {
    setTextInputModal({ isOpen: true, title, label, defaultValue, placeholder, onConfirm });
  }, []);

  // Circuit breaker — pauses background refreshes after 429 for 3 min
  const circuitBreakerUntilRef = useRef(null);
  const [circuitBreakerActive, setCircuitBreakerActive] = useState(false);

  const tripCircuitBreaker = useCallback(() => {
    circuitBreakerUntilRef.current = Date.now() + 180_000;
    setCircuitBreakerActive(true);
    addNotification({ type: 'warning', title: '⏸ Rate limit detectado', description: 'Auto-refresh pausado 3 min.', duration: 10000 });
    setTimeout(() => { circuitBreakerUntilRef.current = null; setCircuitBreakerActive(false); }, 180_000);
  }, [addNotification]);

  const isCircuitBroken = useCallback(() =>
    !!(circuitBreakerUntilRef.current && Date.now() < circuitBreakerUntilRef.current)
  , []);

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


  const fetchAllTestCases = async (args) => {
      let allIssues = [];
      let token = null;
      let isLast = false;
      let pagesFetched = 0;
      const MAX_PAGES = 35;
      
      while (!isLast && pagesFetched < MAX_PAGES) {
          const res = await invoke('getTestCases', { ...args, nextPageToken: token });
          if (Array.isArray(res)) {
             if (res.length > 0 && res[0].id === '999999') {
                 checkError(res, 'getTestCases');
             } else {
                 allIssues = allIssues.concat(res);
             }
             break;
          }
          if (res && res.issues) {
              allIssues = allIssues.concat(res.issues);
              token = res.nextPageToken;
              isLast = res.isLast;
              if (!token) break;
          } else {
              break;
          }
          pagesFetched++;
      }
      return allIssues;
  };
  const loadData = async (currentProjectId = selectedProjectId) => {
    setLoading(true);
    setLoadError(null);

    // 25s safety: if Forge hangs, show error instead of infinite spinner
    const loadTimer = setTimeout(() => {
      setLoading(false);
      setLoadError('La carga tardó demasiado (>25s). Revisa tu conexión y presiona Reintentar.');
    }, 25_000);

    const processFields = (fields) => {
      if (!fields || !Array.isArray(fields) || fields.length === 0) return;
      const excluded = ['id', 'key', 'project', 'issuetype', 'summary', 'description', 'status', 'resolution', 'created', 'updated'];
      const filtered = fields.filter(f => !excluded.includes(f.id));
      if (filtered.length > 0) {
        setJiraFields(filtered);
        const sd = {}; filtered.forEach(f => { sd[f.id] = f; }); setBulkFieldSchema(sd);
        const tf = fields.find(f => {
          const nl = f.name?.toLowerCase() || '';
          if (nl.includes('tipo de ejecuci') || nl.includes('execution type')) return true;
          if (f.allowedValues?.length > 0) {
            const opts = f.allowedValues.map(v => v.value?.toLowerCase() || '').join(' ');
            if (opts.includes('manual') && opts.includes('auto')) return true;
          }
          return false;
        });
        if (tf) setExecutionTypeFieldId(tf.id);
      }
    };

    try {
      // Phase 0: context (determines projectId — must be sequential)
      const ctx = await view.getContext();
      setContext(ctx);
      const isContextGlobal = !ctx?.extension?.project?.id;
      setIsGlobal(isContextGlobal);
      let targetProjectId = currentProjectId || ctx?.extension?.project?.id;

      if (isContextGlobal && !currentProjectId) {
        const fp = await invoke('getProjects');
        if (fp && fp.error) {
          setProjects([{ id: 'error', name: `Error: ${fp.error}`, key: 'ERR' }]);
        } else if (!fp || fp.length === 0) {
          setProjects([{ id: 'none', name: 'Jira returned 0 projects', key: 'N/A' }]);
        } else {
          setProjects(fp);
          targetProjectId = fp[0].id;
          setSelectedProjectId(targetProjectId);
        }
      } else if (!currentProjectId) {
        setSelectedProjectId(targetProjectId);
      }

      if (!targetProjectId) { clearTimeout(loadTimer); setLoading(false); return; }

      // Phase 1: fast parallel (~2s total) — after this loading=false
      const [allowedRes, adminRes, configRes, issueTypesRes] = await Promise.allSettled([
        invoke('isProjectAllowed', { projectId: targetProjectId }),
        invoke('checkAdminPermission', { projectId: targetProjectId }),
        invoke('getConfig', { projectId: targetProjectId }),
        invoke('getProjectIssueTypes', { projectId: targetProjectId }),
      ]);

      setIsProjectAllowed(allowedRes.status === 'fulfilled' ? (allowedRes.value?.allowed ?? true) : true);
      const adminVal = adminRes.status === 'fulfilled' ? adminRes.value : false;
      const config = (configRes.status === 'fulfilled' && configRes.value)
        ? configRes.value
        : { testCaseType: 'Test Case', testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
      setIsAdmin(adminVal);
      setProjectConfig(config);
      setProjectIssueTypes(issueTypesRes.status === 'fulfilled' ? (issueTypesRes.value || []) : []);

      // ← App shell ready. Stop "Cargando entorno".
      clearTimeout(loadTimer);
      setLoading(false);

      // Phase 2: parallel medium (~1.5s each)
      const [foldersRes, plansRes, cyclesRes] = await Promise.allSettled([
        invoke('getFolders', { projectId: targetProjectId }),
        invoke('getTestPlans', { projectId: targetProjectId, config }),
        invoke('getTestCycles', { projectId: targetProjectId, config }),
      ]);
      if (foldersRes.status === 'fulfilled') setFolders(foldersRes.value || []);
      if (plansRes.status === 'fulfilled') {
        const plans = plansRes.value || [];
        setTestPlans(plans);
        if (plans.length > 0) setSelectedPlanId(plans[0].id);
      }
      if (cyclesRes.status === 'fulfilled') setTestCycles(cyclesRes.value || []);
      setRefreshTrigger(prev => prev + 1);

      // Phase 3: background (no spinner shown)
      // 3a. sessionStorage cache for testCases (instant on second open)
      const cacheKey = `tp_${targetProjectId}_tc`;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const { ts, data } = JSON.parse(raw);
          if (Date.now() - ts < 300_000) setTestCases(data);
        }
      } catch (e) {}

      fetchAllTestCases({ folderId: null, projectId: targetProjectId, config })
        .then(tests => {
          setTestCases(tests || []);
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: tests || [] })); } catch (e) {}
        }).catch(console.warn);

      // 3b. Fields (bulk upload + execution type)
      invoke('getFields').then(processFields).catch(console.warn);

      // 3c. Admin-only: allowed project list
      if (adminVal) invoke('getAllowedProjects').then(a => setAllowedProjects(a)).catch(console.warn);

    } catch (err) {
      clearTimeout(loadTimer);
      console.error("loadData exception:", err);
      const safeMessage = err ? err.message || String(err) : "Unknown error";
      setLoadError(safeMessage);
      setProjects([{ id: 'error', name: `Invoke Error: ${safeMessage}`, key: 'ERR' }]);
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
                // BUILD bulkFieldSchema from getFields!
                const schemaDict = {};
                filtered.forEach(f => { schemaDict[f.id] = f; });
                setBulkFieldSchema(schemaDict);
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
    addNotification({ type: 'success', title: 'Configuración de mapeo guardada' });
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
        addNotification({ type: 'success', title: 'Mapeo importado correctamente' });
      } catch (err) {
        addNotification({ type: 'error', title: 'Error al leer el archivo', description: 'Asegúrate de que sea un JSON válido generado por Test Pulse.' });
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

  // Auto-refresh: execution summary every 60s — 1 req, safe with many testers
  useEffect(() => {
    if (activeTab !== 'execution' || !selectedCycle) return;
    const tick = async () => {
      if (document.hidden) return; // Page Visibility — skip if browser tab not visible
      if (isCircuitBroken()) return;
      try {
        const summary = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
        if (summary && Array.isArray(summary) && summary.length > 0) {
          const enriched = summary.map(ex => {
            if (ex.key && ex.summary) return ex;
            const tc = testCases.find(t => String(t.id) === String(ex.id));
            return tc ? { ...ex, key: tc.key, summary: tc.summary } : ex;
          });
          safeSetCycleTests(enriched);
        }
      } catch(err) {
        if (err?.message?.includes('429') || err?.status === 429) tripCircuitBreaker();
      }
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [activeTab, selectedCycle?.id]);

  // Reports: auto-refresh when entering tab if data is older than 5 min
  useEffect(() => {
    if (activeTab !== 'reports') return;
    const age = reportData._loadedAt ? Date.now() - reportData._loadedAt : Infinity;
    if (reportData.cycles.length === 0 || age > 300_000) loadReportData();
  }, [activeTab]);

  // Filtered Data
  const filteredTestCasesAll = testCases.filter(tc => {
    const matchesSearch = tc.key.toLowerCase().includes(searchQuery.toLowerCase()) || tc.summary.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFolder = activeFolder === null || tc.folderId === activeFolder;
    return matchesSearch && matchesFolder;
  });
  
  const totalPages = Math.ceil(filteredTestCasesAll.length / itemsPerPage);
  const filteredTestCases = filteredTestCasesAll.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  const filteredTestCycles = testCycles;

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
        const fetchedTests = await fetchAllTestCases({ folderId: null, projectId, config: projectConfig });
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

    const handleDownloadTemplate = () => {
    const csvContent = "\uFEFF" + `Resumen,Description,Link (is tested by),Nivel de Prueba,Tipo de Prueba,Tipo de Ejecución,Prioridad
LOGINING | Acceso exitoso al sistema con credenciales válidas.,"Pre-conditions:
Usuario activo en base de datos.

Test Script:
Given que el POS muestra la pantalla de ingreso.
When el usuario ingresa un Usuario y Password correctos.
Then el sistema valida la identidad.
",,Integración SIT,Funcional,Manual,Alta`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Plantilla_Test_Cases.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
      
      // Auto-mapeo inteligente por nombre exacto
      const autoMap = {};
      headers.forEach(h => {
          const lower = h.toLowerCase().trim();
          if (lower.includes('resumen') || lower === 'summary') autoMap[h] = 'summary';
          else if (lower.includes('descripci') || lower === 'description') autoMap[h] = 'description';
          else if (lower.includes('prioridad') || lower === 'priority') autoMap[h] = 'priority';
          else {
              // Buscar en jiraFields por nombre exacto (ignorando mayusculas)
              const match = jiraFields.find(jf => jf.name.trim().toLowerCase() === lower);
              if (match) {
                 autoMap[h] = match.id;
              }
          }
      });
      // Mezclar autoMap con el estado actual (priorizando lo que ya existía, pero llenando los vacíos)
      setBulkFieldMapping(prev => ({ ...autoMap, ...prev }));
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
        const allowed = schema.allowedValues.map(v => (v.value || v.name || '').toLowerCase());
        bulkPreview.forEach((row) => {
          const val = row.all[header];
          if (val && val.trim() !== '') {
            if (!allowed.includes(val.trim().toLowerCase())) {
              validationErrors.push({
                message: `Fila ${row.row}: El valor "${val}" no es válido para el campo "${schema.name || fieldId}". Valores permitidos: ${schema.allowedValues.map(v => v.value || v.name).join(', ')}`
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

    const CHUNK = 20; // enviamos de 50 en 50 para no saturar la API
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
        // Si el campo esta vacio pero Jira lo exige, mandamos un espacio en blanco para que no falle.
        fields.description = textToAdf(descText || " ");

        // Add other mapped fields, considering their schema types (e.g. options need {value: "x"})
        Object.entries(bulkFieldMapping).forEach(([header, fieldId]) => {
          if (fieldId !== 'summary' && fieldId !== 'description' && fieldId !== 'IGNORE' && r.all[header] && r.all[header].trim() !== '') {
            const schema = bulkFieldSchema[fieldId];
            const val = r.all[header].trim();
            if (schema) {
              const isArray = schema.schema ? schema.schema.type === 'array' : false;
              
              let valuesToProcess = isArray ? val.split(',').map(s => s.trim()).filter(Boolean) : [val];
              let fieldObjects = [];

              valuesToProcess.forEach(singleVal => {
                let optObj = {};
                if (schema.allowedValues && Array.isArray(schema.allowedValues)) {
                  const matchedOption = schema.allowedValues.find(v => (v.value || v.name || '').toLowerCase() === singleVal.toLowerCase());
                  if (matchedOption) {
                    if (matchedOption.id !== undefined) optObj.id = String(matchedOption.id);
                    if (matchedOption.name !== undefined) optObj.name = String(matchedOption.name);
                    if (matchedOption.value !== undefined) optObj.value = String(matchedOption.value);
                  }
                }
                
                                if (Object.keys(optObj).length === 0) {
                  // Fallback: Si el campo es custom y no tiene metadata, asumimos que es un select.
                  if (schema.schema && (schema.schema.type === 'version' || schema.schema.type === 'component' || schema.schema.items === 'version' || schema.schema.items === 'component' || schema.schema.type === 'priority')) {
                    optObj = { name: singleVal };
                  } else if (schema.schema && (schema.schema.type === 'string' || schema.schema.type === 'number' || schema.schema.type === 'datetime' || schema.schema.type === 'date')) {
                    optObj = schema.schema.type === 'number' ? Number(singleVal) : singleVal;
                  } else if (fieldId.startsWith('customfield_')) {
                    // It's a custom field, but not a basic string/number. It's likely a radio button, select list, or Xray type.
                    optObj = { value: singleVal };
                  } else if (fieldId === 'priority') {
                    optObj = { name: singleVal };
                  } else {
                    optObj = singleVal; // If all else fails, use the raw string
                  }
                }
                fieldObjects.push(optObj);
              });

              if (isArray) {
                fields[fieldId] = fieldObjects;
              } else {
                fields[fieldId] = fieldObjects[0] || val;
              }
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
      
            if (allErrors.length > 0 && issues && issues.length > 0) {
        const debugInfo = {
          payload: issues[0].fields,
          schemaKeysLen: Object.keys(bulkFieldSchema).length,
          schema10534: bulkFieldSchema['customfield_10534'] ? "EXISTS" : "MISSING",
          raw_schema: bulkFieldSchema['customfield_10534']
        };
        allErrors.push({ message: "DEBUG (Envia foto de esto a Gustavo): " + JSON.stringify(debugInfo) });
      }
    }

    // Link to folder if selected
    if (bulkTargetFolder && createdIssueIds.length > 0) {
      await invoke('bulkLinkToFolder', { issueIds: createdIssueIds, folderId: bulkTargetFolder });
    }

    setBulkErrors(allErrors);
    setBulkStatus(errorCount === 0 ? 'done' : 'error');
    
    // Refresh the test case list
    const fetchedTests = await fetchAllTestCases({ folderId: activeFolder, projectId, config: projectConfig });
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
          onClick={async () => {
            if (selectedCycle && (activeTab === 'execution' || activeTab === 'planning')) {
              // Lightweight: just reload the current cycle's tests
              setLocalLoading(true);
              try {
                const rawExecution = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
                safeSetCycleTests(rawExecution || []);
              } catch(e) {
                console.error('Refresh cycle error:', e);
              } finally {
                setLocalLoading(false);
              }
            } else {
              // Lightweight: reload cycles and plans list only (no view.getContext() call)
              setLocalLoading(true);
              try {
                const config = projectConfig || { testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
                const [fetchedCycles, fetchedPlans] = await Promise.all([
                  invoke('getTestCycles', { projectId: selectedProjectId, config }),
                  invoke('getTestPlans', { projectId: selectedProjectId, config })
                ]);
                if (fetchedCycles && !fetchedCycles._isError) setTestCycles(fetchedCycles);
                if (fetchedPlans && !fetchedPlans._isError) setTestPlans(fetchedPlans);
              } catch(e) {
                console.error('Refresh lists error:', e);
              } finally {
                setLocalLoading(false);
              }
            }
          }} 
          disabled={loading || localLoading} 
          title="Refrescar ciclo actual"
          style={{ padding: '0.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', background: 'transparent' }}
        >
          {(loading || localLoading) ? (
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
      <aside className="sidebar glass" style={{ width: sidebarWidth, flexShrink: 0 }}>
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
            All Tests <span style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '0.25rem'}}>({testCases.length})</span>
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
                        <span style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>({testCases.filter(t => t.folderId === folder.id).length})</span>
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
      <div 
        onMouseDown={() => setIsResizing(true)}
        style={{
          width: '5px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? 'var(--ds-border-focused)' : 'transparent',
          zIndex: 10,
          borderRight: '1px solid var(--border-color)',
          marginLeft: '-1px'
        }}
      />
      <main className="main-content">
        <div className="header">
          <h1>Design: Folders &amp; Test Cases <span style={{fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal'}}>({testCases.length} casos)</span></h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="btn-primary" onClick={handleCreateIssue}>+ Create Test Case</button>
            <button
              className="btn-secondary"
              onClick={() => { setShowBulkUpload(v => !v); resetBulkUpload(); }}
              title="Importar desde archivo CSV"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
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
              <button
                className="btn-secondary"
                onClick={handleDownloadTemplate}
                title="Descargar Plantilla CSV con las columnas oficiales"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.45rem 1rem', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                CSV
              </button>
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
                  <button onClick={() => setBulkFieldMapping({})} className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', color: 'var(--danger-color)' }}>
                    Limpiar Mapeo
                  </button>
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
          <div className="test-list-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="test-list" style={{ flex: 1, overflowY: 'auto' }}>
            {filteredTestCases.map(test => (
              <div 
                key={test.id} 
                className="test-card glass"
                onClick={() => { setSelectedTestCase(test); loadTestCaseDetails(test.id); }}
                style={{ cursor: 'pointer' }}
              >
                <div className="test-card-content">
                  <span className="test-id">{test.key} <i style={{color:'var(--ds-text-subtle)', fontSize:'0.85em'}}>({getExecVal(test) ? getExecVal(test).charAt(0).toUpperCase() + getExecVal(test).slice(1) : 'Vacío'})</i></span>
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
          {totalPages > 1 && (
            <div className="pagination-controls" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', padding: '15px 0', borderTop: '1px solid var(--border-color)', marginTop: 'auto' }}>
              <button 
                 className="btn-secondary" 
                 disabled={currentPage === 1} 
                 onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                Page {currentPage} of {totalPages} ({filteredTestCasesAll.length} items)
              </span>
              <button 
                 className="btn-secondary" 
                 disabled={currentPage === totalPages} 
                 onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              >
                Next
              </button>
            </div>
          )}
          </div>
        )}
      </main>
    </div>
  );

    const loadTestCaseDetails = async (caseId) => {
    setTestCaseDetailsLoading(true);
    setTestCaseHistory([]);
    let details = { type: 'traditional', content: [] };
    let history = [];
    try {
      details = await invoke('getTestCaseDetails', { caseId });
    } catch(e) {
      console.error('Error loading details:', e);
    }
    
    try {
      history = await invoke('getTestCaseHistory', { testId: caseId, projectId: selectedProjectId, config: projectConfig });
    } catch(e) {
      console.error('Error loading history:', e);
    }
    
    setTestCaseDetails(details || { type: 'traditional', content: [] });
    setTestCaseHistory(history || []);
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
      <div className="slide-panel-overlay" onClick={() => { setSelectedTestCase(null); setTestCaseDetails({ type: 'traditional', content: [] }); setTestCaseHistory([]); }}>
        <div className="slide-panel" onClick={e => e.stopPropagation()}>
          <div className="slide-panel-header">
            <div>
              <span className="test-id" style={{display: 'block', marginBottom: '0.25rem'}}>{selectedTestCase.key}</span>
              <h2>{selectedTestCase.summary}</h2>
              <div style={{display: 'flex', gap: '0.5rem', marginTop: '0.5rem'}}>
                <span className="status-badge">{selectedTestCase.status}</span>
                {selectedTestCase.rawFields?.priority && (
                  <span className="status-badge" style={{ background: 'var(--bg-surface)', border: '1px solid var(--ds-border)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    {selectedTestCase.rawFields.priority.iconUrl && <img src={selectedTestCase.rawFields.priority.iconUrl} alt="" width="16" height="16" />}
                    {selectedTestCase.rawFields.priority.name}
                  </span>
                )}
              </div>
            </div>
            <button className="close-btn" onClick={() => { setSelectedTestCase(null); setTestCaseDetails({ type: 'traditional', content: [] }); setTestCaseHistory([]); }}>&times;</button>
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
                  const fetchedTests = await fetchAllTestCases({ folderId: null, projectId: selectedProjectId, config: projectConfig });
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
            {loadingDescription ? (
              <div style={{padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)'}}>
                 <div className="spinner" style={{margin: '0 auto 1rem auto', width: '24px', height: '24px', border: '3px solid var(--ds-border)', borderTop: '3px solid var(--brand-color)', borderRadius: '50%', animation: 'spin 1s linear infinite'}}></div>
                 <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                 Cargando descripción...
              </div>
            ) : selectedTestCaseDescription ? (
              <div 
                className="description-content"
                dangerouslySetInnerHTML={{ __html: selectedTestCaseDescription }} 
              />
            ) : (
              <div className="empty-state" style={{padding: '2rem'}}>
                <p>No issue description available.</p>
              </div>
            )}
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', marginBottom: '1rem' }}>
              <h3>Execution History</h3>
            </div>
            {testCaseDetailsLoading ? (
              <div className="empty-state" style={{padding: '1rem'}}>
                <p>Loading history...</p>
              </div>
            ) : testCaseHistory.length > 0 ? (
              <div className="table-container" style={{marginBottom: '2rem'}}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Cycle</th>
                      <th>Status</th>
                      <th>Executed By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testCaseHistory.map(h => (
                      <tr key={h.cycleId}>
                        <td>
                          <strong>{h.cycleKey}</strong>
                          <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>{h.cycleSummary}</div>
                        </td>
                        <td>
                          <span className={`status-badge status-${h.status.replace(/\s+/g, '-').toLowerCase()}`}>
                            {h.status}
                          </span>
                        </td>
                        <td>
                          {h.executedBy ? (
                            <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                              <div style={{width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--accent-color)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold'}}>
                                {h.executedBy.displayName.charAt(0)}
                              </div>
                              <span style={{fontSize: '0.85rem'}}>{h.executedBy.displayName}</span>
                            </div>
                          ) : (
                            <span style={{color: 'var(--text-secondary)', fontSize: '0.85rem'}}>Unassigned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state" style={{padding: '1rem'}}>
                <p>This test case has not been executed in any cycle yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const handleCycleSelect = async (cycle) => {
    setCycleTests([]); // clear old tests immediately
    // Restore per-cycle deleted tracking into deletedIdsRef so safeSetCycleTests keeps filtering correctly
    deletedIdsRef.current = new Set(perCycleDeletedRef.current[cycle.id] || []);
    setPlanningChecked(new Set()); // clear multi-select
    setSelectedCycle(cycle);
    try {
      const executionSummary = await invoke('getCycleExecutionSummary', { cycleId: cycle.id });
      // Filter out any tests deleted this session (Jira eventual consistency may return stale data)
      const deletedForCycle = perCycleDeletedRef.current[cycle.id] || new Set();
      const filtered = (executionSummary || []).filter(t => !deletedForCycle.has(String(t.id)));
      setCycleTests(filtered);
    } catch (err) {
      addNotification({ type: 'error', title: 'Error cargando casos', description: err.message });
    }
  };

  const handleCreateFolder = async (parentId = null) => {
    if (!selectedProjectId) return;
    showTextInput('Nueva carpeta', async (name) => {
      const tempId = 'temp_' + Date.now();
      setFolders(prev => [...prev, { id: tempId, name, parentId: typeof parentId === 'string' ? parentId : null }]);
      try {
        const updated = await invoke('createFolder', { projectId: selectedProjectId, name, parentId: typeof parentId === 'string' ? parentId : null });
        setFolders(updated || []);
        addNotification({ type: 'success', title: 'Carpeta creada', description: name });
      } catch (e) {
        setFolders(prev => prev.filter(f => f.id !== tempId));
        addNotification({ type: 'error', title: 'Error al crear carpeta', description: e.message });
      }
    }, { label: 'Nombre', placeholder: 'Ej: Regresión' });
  };

  const handleUpdateFolder = async (folderId, oldName) => {
    if (!selectedProjectId) return;
    showTextInput('Renombrar carpeta', async (newName) => {
      if (newName === oldName) return;
      setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: newName } : f));
      try {
        const updated = await invoke('updateFolder', { projectId: selectedProjectId, folderId, newName });
        setFolders(updated || []);
        addNotification({ type: 'success', title: 'Carpeta renombrada' });
      } catch (e) {
        setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: oldName } : f));
        addNotification({ type: 'error', title: 'Error al renombrar', description: e.message });
      }
    }, { label: 'Nuevo nombre', defaultValue: oldName });
  };

  const handleDeleteFolder = async (folderId, name) => {
    if (!selectedProjectId) return;
    showConfirm(
      'Eliminar carpeta',
      `¿Eliminar "${name}"? Esta acción no se puede deshacer.`,
      async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        const prev = folders;
        setFolders(f => f.filter(x => x.id !== folderId));
        if (activeFolder === folderId) setActiveFolder(null);
        try {
          const updated = await invoke('deleteFolder', { projectId: selectedProjectId, folderId });
          setFolders(updated || []);
          addNotification({ type: 'success', title: 'Carpeta eliminada' });
        } catch (e) {
          setFolders(prev);
          addNotification({ type: 'error', title: 'Error al eliminar carpeta', description: e.message });
        }
      },
      { danger: true, confirmLabel: 'Eliminar' }
    );
  };

  const handleAddTestToCycle = async (testCase) => {
    if (!selectedCycle) return;
    
    // Optimistic UI
    const locallyAdded = {
        id: testCase.id,
        key: testCase.key,
        summary: testCase.summary,
        status: 'Not Run'
    };
    setCycleTests(prev => {
        if (!prev.some(existing => existing.id === locallyAdded.id)) {
            return [...prev, locallyAdded];
        }
        return prev;
    });
    
    try {
        const addRes = await invoke('addTestToCycle', { cycleId: selectedCycle.id, testCase });
        if (addRes && addRes.addedTest && addRes.addedTest._historicalData) {
            setCycleTests(prev => prev.map(t => t.id === testCase.id ? { ...t, ...addRes.addedTest._historicalData } : t));
        }
        setTimeout(async () => {
            const execution = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
            if (execution) {
                safeSetCycleTests(execution);
            }
        }, 3000);
    } catch(err) {
        console.error(err);
        addNotification({ type: 'error', title: 'Error al añadir caso', description: err.message });
        // revert optimistic on error by reloading
        const execution = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
        safeSetCycleTests(execution || []);
    }
  };

  const handleRemoveTestFromCycle = async (testId) => {
    if (!selectedCycle) return;
    const id = String(testId);
    // Optimistic: remove from UI immediately, track to prevent ghost reappear
    const cycleId = selectedCycle.id;
    deletedIdsRef.current.add(id);
    if (!perCycleDeletedRef.current[cycleId]) perCycleDeletedRef.current[cycleId] = new Set();
    perCycleDeletedRef.current[cycleId].add(id);
    setPlanningChecked(prev => { const s = new Set(prev); s.delete(id); return s; });
    setCycleTests(prev => prev.filter(t => String(t.id) !== id));
    try {
      await invoke('removeTestFromCycle', { cycleId, testId: id });
    } catch (err) {
      // Rollback on error
      deletedIdsRef.current.delete(id);
      perCycleDeletedRef.current[cycleId]?.delete(id);
      addNotification({ type: 'error', title: 'Error al eliminar caso', description: err.message });
      const execution = await invoke('getCycleExecutionSummary', { cycleId }).catch(() => null);
      if (execution) setCycleTests(execution);
    }
  };

  const handleRemoveManyFromCycle = async (testIds) => {
    if (!selectedCycle || !testIds || testIds.length === 0) return;
    const ids = testIds.map(String);
    const cycleId = selectedCycle.id;
    // Optimistic: remove all from UI and clear selection
    if (!perCycleDeletedRef.current[cycleId]) perCycleDeletedRef.current[cycleId] = new Set();
    ids.forEach(id => { deletedIdsRef.current.add(id); perCycleDeletedRef.current[cycleId].add(id); });
    setPlanningChecked(new Set());
    setCycleTests(prev => prev.filter(t => !ids.includes(String(t.id))));
    try {
      await invoke('removeManyTestsFromCycle', { cycleId, testIds: ids });
      addNotification({ type: 'success', title: `${ids.length} caso${ids.length !== 1 ? 's' : ''} eliminado${ids.length !== 1 ? 's' : ''} del ciclo` });
    } catch (err) {
      // Rollback on error
      ids.forEach(id => { deletedIdsRef.current.delete(id); perCycleDeletedRef.current[cycleId]?.delete(id); });
      addNotification({ type: 'error', title: 'Error al eliminar casos', description: err.message });
      const execution = await invoke('getCycleExecutionSummary', { cycleId }).catch(() => null);
      if (execution) setCycleTests(execution);
    }
  };

  const handleLinkTestToFolder = async (testId, folderId) => {
    if (!selectedProjectId) return;
    // Update local state instantly (Optimistic UI) to avoid logo flashing
    setTestCases(prev => prev.map(t => t.id === testId ? { ...t, folderId: folderId === '' ? null : folderId } : t));
    
    await invoke('linkTestToFolder', { testId, folderId: folderId === '' ? null : folderId });
  };

  const handleUpdateTestStatus = async (testId, status, comment) => {
    if (!selectedCycle) return;
    const test = cycleTests.find(t => String(t.id) === String(testId));

    // Guard: if trying to reset a locked execution to "Not Run", show confirm first
    if (status === 'Not Run' && test?.lockedAt) {
      showConfirm(
        'Resetear ejecución completada',
        `Este caso ya fue ejecutado y marcado como "${test.status}". ¿Deseas resetear su estatus a "Not Run"? Solo los administradores pueden hacerlo en producción.`,
        async () => {
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          try {
            await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, status: 'Not Run', comment });
            setCycleTests(prev => prev.map(t => String(t.id) === String(testId)
              ? { ...t, status: 'Not Run', lockedAt: null } : t));
          } catch (e) {
            const msg = e.message || String(e);
            if (msg.includes('LOCKED')) {
              addNotification({ type: 'error', title: '🔒 Sin permiso', description: 'Solo un administrador puede resetear esta ejecución.' });
            } else {
              addNotification({ type: 'error', title: 'Error al resetear', description: msg });
            }
          }
        },
        { danger: true, confirmLabel: 'Resetear' }
      );
      return;
    }

    try {
      const res = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, status, comment });
      const TERMINAL = ['Pass', 'Passed', 'Fail', 'Failed', 'Blocked'];
      setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? {
        ...t,
        status: status !== undefined ? status : t.status,
        comment: comment !== undefined ? comment : t.comment,
        lockedAt: (res?.lockedAt || (TERMINAL.includes(status) ? (t.lockedAt || Date.now()) : t.lockedAt))
      } : t));
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes('LOCKED')) {
        addNotification({ type: 'error', title: '🔒 Ejecución protegida', description: 'Solo un administrador puede modificar esta ejecución.' });
      } else {
        addNotification({ type: 'error', title: 'Error actualizando prueba', description: msg });
      }
    }
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
      await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus } : t));
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteIteration = async (test, iterId) => {
    if (!window.confirm("¿Estás seguro de eliminar esta iteración?")) return;
    try {
      const newIterations = (test.iterations || []).filter(it => it.id !== iterId);
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus } : t));
    } catch (e) {
      console.error(e);
      addNotification({ type: 'error', title: 'Error eliminando iteración', description: e.message || String(e) });
    }
  };

  const handleIterationChange = async (test, iterId, field, value) => {
    try {
      const newIterations = test.iterations.map(it => it.id === iterId ? { ...it, [field]: value } : it);
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus } : t));
      await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
    } catch (e) {
      console.error(e);
      addNotification({ type: 'error', title: 'Error guardando cambios', description: e.message || String(e) });
    }
  };

  const handleTakeover = async (test) => {
    try {
      const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, takeover: true });
      if (updated) safeSetCycleTests(updated);
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
      if (!response.ok) {
          console.error("Jira upload error:", attachments);
          alert("Jira rechazó el archivo: " + (attachments.errorMessages ? attachments.errorMessages.join(", ") : "Error desconocido"));
          return;
      }
      if (attachments && attachments.length > 0) {
         const newEvidence = {
           id: attachments[0].id,
           filename: attachments[0].filename,
           url: attachments[0].content
         };
         
         let currentTest = await invoke('getTestExecution', { cycleId: selectedCycle.id, testId });
         if (!currentTest) {
             currentTest = cycleTests.find(t => t.id === testId);
         }
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
               await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
               setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: iters } : t));
            }
         } else {
            await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
            setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences } : t));
         }
      }
    } catch (err) {
      console.error("Failed to upload evidence", err);
      addNotification({ type: 'error', title: 'Error subiendo evidencia' });
    }
  };

  const handleDeleteEvidence = async (testId, attachmentId, index, iterId) => {
    await invoke('deleteAttachment', { attachmentId });
    
    let currentTest = await invoke('getTestExecution', { cycleId: selectedCycle.id, testId });
    if (!currentTest) {
        currentTest = cycleTests.find(t => t.id === testId);
    }
    if (!currentTest) return;
    
    if (iterId) {
       const iters = [...(currentTest.iterations || [])];
       const iterIdx = iters.findIndex(i => i.id === iterId);
       if (iterIdx > -1) {
          const evs = (iters[iterIdx].evidences || []).filter(e => e.id !== attachmentId && e !== attachmentId);
          iters[iterIdx] = { ...iters[iterIdx], evidences: evs };
          await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
          setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: iters } : t));
       }
       return;
    }

    let currentEvidences = currentTest.evidences ? [...currentTest.evidences] : [];
    if (currentTest.evidence && currentEvidences.length === 0) {
      currentEvidences.push(currentTest.evidence);
    }
    currentEvidences = currentEvidences.filter(e => e.id !== attachmentId && e !== attachmentId);
    await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
    setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences } : t));
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
          setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: iters } : t));
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
    
    setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences, evidence: null } : t));
    await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
  };

  const handleCaptureScreen = async (testId, testKey, iterId) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert("Tu dispositivo móvil no soporta grabar pantalla. Usa el botón 'Archivo' para subir o tomar una foto de la evidencia.");
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
        video.play().then(() => {}).catch(e => console.error(e));
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
        }, 1500);
      };
    } catch(err) {
      console.error("Captura cancelada", err);
    }
  };

  const handleSyncCycleIndex = async () => {
    if (!selectedCycle?.id) return;
    setLocalLoading(true);
    setSyncProgress({ done: 0, total: '...' });
    try {
      // Forge Storage has no 32KB limit — rebuild is now a single call (no pagination)
      const result = await invoke('rebuildCycleIndex', { cycleId: selectedCycle.id });
      setSyncProgress({ done: result.total, total: result.total });
      const summary = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
      if (summary) setCycleTests(summary);
      addNotification({ type: 'success', title: '✅ Índice sincronizado', description: `${result.total} casos actualizados.` });
    } catch (err) {
      addNotification({ type: 'error', title: 'Error al sincronizar', description: err.message });
    } finally {
      setLocalLoading(false);
      setSyncProgress(null);
    }
  };

  const handleRunTest = async (testId, testKey, test) => {
    try {
      if (test) await handleTakeover(test);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        // En móviles, simplemente habilitamos la prueba sin intentar grabar pantalla ni lanzar alertas molestas
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
    let filename = typeof ev === 'string' ? `evidence_${id}.jpg` : (ev.filename || `evidence_${id}.jpg`);
    
    // Si no tiene extensión (ej. porque el usuario lo renombró "Evidencia 1"), asumimos que es imagen/video
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(filename);
    const isMedia = filename.match(/\.(png|jpg|jpeg|gif|pdf|mp4|mov|webm)$/i);

    if (isMedia || !hasExtension) {
      if (!hasExtension) filename += '.png'; // Para que el modal sepa renderizarlo
      
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
    setLocalLoading(true);
    try {
      await invoke('linkCycleToPlan', { cycleId, planId });
      setTestCycles(prev => prev.map(c =>
        c.id === cycleId ? { ...c, planId, properties: { ...c.properties, 'testops-plan-link': { planId } } } : c
      ));
    } catch (e) {
      console.error('Failed to link cycle:', e);
      addNotification({ type: 'error', title: 'Error al vincular ciclo', description: e.message });
    } finally {
      setLocalLoading(false);
    }
  };

  const handleUnlinkCycleFromPlan = async (cycleId) => {
    setLocalLoading(true);
    setTestCycles(prev => prev.map(c => c.id === cycleId ? { ...c, planId: null } : c));
    try {
      await invoke('unlinkCycleFromPlan', { cycleId });
      if (selectedCycle && selectedCycle.id === cycleId) setSelectedCycle(null);
      addNotification({ type: 'success', title: 'Ciclo desvinculado del plan' });
    } catch (e) {
      console.error('Failed to unlink cycle:', e);
      addNotification({ type: 'error', title: 'Error al desvincular', description: e.message });
      invoke('getTestCycles', { projectId: selectedProjectId, config: projectConfig })
        .then(c => setTestCycles(c || [])).catch(console.warn);
    } finally {
      setLocalLoading(false);
    }
  };

  const loadProjectData = async () => {
    if (!selectedProjectId) return;
    if (!testCases.length) setLoading(true);
    
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
        fetchAllTestCases({ projectId: selectedProjectId, config }),
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
    if (isMigrating) return;
    if (isCircuitBroken()) {
      addNotification({ type: 'warning', title: 'Rate limit activo', description: 'Espera unos minutos antes de recargar el reporte.' });
      return;
    }
    setReportLoading(true);
    try {
      const data = await invoke('getExecutionReport', { projectId: selectedProjectId, config: projectConfig });
      setReportData({ ...(data || { cycles: [] }), _loadedAt: Date.now() });

      // Collect all bug keys already linked through Test Pulse
      const linkedBugKeys = [];
      (data?.cycles || []).forEach(cycle => {
        (cycle.execution || []).forEach(ex => {
          (ex.linkedBugs || []).forEach(bug => { if (bug.key) linkedBugKeys.push(bug.key); });
        });
      });
      // Fetch bugs from ALL accessible projects (not just the selected one)
      // allProjectKeys: all projects the user has access to
      // bugIssueTypes: configured bug type names (empty = use broad default list)
      const allProjectKeys = projects.filter(p => p.key && p.key !== 'ERR' && p.key !== 'N/A').map(p => p.key);
      invoke('getProjectUnlinkedBugs', {
        projectId: selectedProjectId,
        linkedBugKeys,
        allProjectKeys,
        bugIssueTypes: projectConfig?.bugIssueTypes || [],
      })
        .then(bugs => setUnlinkedBugs(bugs || []))
        .catch(console.warn);
    } catch(err) {
      console.error("loadReportData error:", err);
      if (err?.message?.includes('429') || err?.status === 429) tripCircuitBreaker();
      setReportData(prev => ({ ...prev, _loadError: true }));
    } finally {
      setReportLoading(false);
    }
  };

  const prevCycleIdRef = useRef(null);
  const prevRefreshRef = useRef(null);

  useEffect(() => {
    if ((activeTab === 'execution' || activeTab === 'planning') && selectedCycle) {
      // Avoid double fetching if handleCycleSelect just loaded this cycle
      // Only fetch if refreshTrigger changed or tab changed without data
      if (
        prevCycleIdRef.current === selectedCycle.id &&
        prevRefreshRef.current === refreshTrigger &&
        cycleTests.length > 0
      ) {
        return;
      }
      
      prevCycleIdRef.current = selectedCycle.id;
      prevRefreshRef.current = refreshTrigger;

      // Use getCycleExecutionSummary instead of full getCycleExecution
      invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id })
        .then(async (executionSummary) => {
          if (!executionSummary || executionSummary.length === 0) {
            setCycleTests([]); // direct set
            return;
          }

          // Enrich lightweight index with key+summary from the already-loaded testCases array.
          // The lightweight index only has {id, status, linkedBugs} — new cycle tests would
          // show blank key/summary without this join.
          const enriched = executionSummary.map(ex => {
            if (ex.key && ex.summary) return ex; // already enriched (old cycle)
            const tc = testCases.find(t => String(t.id) === String(ex.id));
            return tc ? { ...ex, key: tc.key, summary: tc.summary } : ex;
          });
          // Filter out any tests deleted this session (avoids stale-read ghosts from Jira eventual consistency)
          const deletedForCycle = perCycleDeletedRef.current[selectedCycle.id] || new Set();
          const filteredEnriched = enriched.filter(t => !deletedForCycle.has(String(t.id)));
          setCycleTests(filteredEnriched);
        });
    } else if (activeTab === 'reports') {
      // Only reload reports if we don't have data yet, or refreshTrigger changed
      if (reportData.cycles.length === 0 || prevRefreshRef.current !== refreshTrigger) {
        loadReportData();
      }
    }
  }, [activeTab, selectedCycle, refreshTrigger]);


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
    // 1. Create Jira Issue Link via backend (fire and forget)
    invoke('linkBugToTest', { testCaseId: test.id, bugKey });

    // 2. Avoid duplicates
    const currentBugs = test.linkedBugs || [];
    if (currentBugs.some(b => b.key === bugKey)) return;
    const updatedBugs = [...currentBugs, { key: bugKey }];

    // 3. Optimistic UI: show badge immediately
    setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, linkedBugs: updatedBugs } : t));

    // 4. Save in background
    invoke('updateTestStatus', {
      cycleId: selectedCycle.id,
      testId: test.id,
      linkedBugs: updatedBugs
    }).catch(err => {
      console.error('Error linking bug:', err);
      // Rollback on error
      setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, linkedBugs: currentBugs } : t));
      alert('Error al vincular el bug: ' + (err.message || err));
    });
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

  const getExecVal = (t) => {
  if (t && !t.rawFields) {
     const tc = testCases.find(x => String(x.id) === String(t.id));
     if (tc) t = tc;
  }
  if (t && t.rawFields && t.rawFields['customfield_10534']) {
     const v = t.rawFields['customfield_10534'];
     let str = '';
     if (Array.isArray(v) && v.length > 0) str = v[0].value || v[0].name || String(v[0]);
     else if (typeof v === 'object' && v !== null) str = v.value || v.name || '';
     else str = String(v);
     if (str) return str.toString().replace(/['"]/g, '').trim().toLowerCase();
  } 
  let str = '';
  if (executionTypeFieldId && t.rawFields && t.rawFields[executionTypeFieldId]) { 
     const v = t.rawFields[executionTypeFieldId]; 
     if (Array.isArray(v) && v.length > 0) str = v[0].value || v[0].name || String(v[0]);
     else if (typeof v === 'object' && v !== null) str = v.value || v.name || '';
     else str = String(v);
  }
  
  if (!str && t.rawFields) {
     for (const [k, v] of Object.entries(t.rawFields)) {
        if (k.startsWith('customfield_') && v !== null) {
           let testStr = '';
           if (Array.isArray(v) && v.length > 0) testStr = v[0].value || v[0].name || String(v[0]);
           else if (typeof v === 'object') testStr = v.value || v.name || '';
           else testStr = String(v);
           
           if (testStr) {
              const testLower = testStr.toString().replace(/["']/g, '').trim().toLowerCase();
              if (testLower === 'manual' || testLower.includes('automatizado') || testLower.includes('automático') || testLower === 'auto') {
                  str = testStr;
                  break;
              }
           }
        }
     }
  }
  const finalStr = (str || '').toString().replace(/["']/g, '').trim().toLowerCase(); return finalStr === '' ? 'manual' : finalStr;
};

const renderPlanningTab = () => (
    <div className="tab-layout">
      {/* Cycles Sidebar */}
      <aside className="sidebar glass" style={{ width: sidebarWidth, flexShrink: 0 }}>
        <h2>Test Plans</h2>
        <select 
          value={selectedPlanId} 
          onChange={e => { setSelectedPlanId(e.target.value); setSelectedCycle(null); setSelectedTestsForCycle([]); }}
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
      <div 
        onMouseDown={() => setIsResizing(true)}
        style={{
          width: '5px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? 'var(--ds-border-focused)' : 'transparent',
          zIndex: 10,
          borderRight: '1px solid var(--border-color)',
          marginLeft: '-1px'
        }}
      />
      <main className="main-content">
        {selectedCycle ? (
          <div>
            <div className="header">
              <h1>Planning: {selectedCycle.summary} <span style={{fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal'}}>({cycleTests.length} casos en ciclo)</span></h1>
            </div>
            <h3>Tests in this Cycle ({cycleTests.length})</h3>

            {/* ── Bulk-action toolbar ── */}
            {cycleTests.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', padding: '0.4rem 0.6rem', background: 'var(--ds-background-neutral)', borderRadius: '6px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={planningChecked.size > 0 && planningChecked.size === cycleTests.length}
                    ref={el => { if (el) el.indeterminate = planningChecked.size > 0 && planningChecked.size < cycleTests.length; }}
                    onChange={e => {
                      if (e.target.checked) setPlanningChecked(new Set(cycleTests.map(t => String(t.id))));
                      else setPlanningChecked(new Set());
                    }}
                  />
                  {planningChecked.size > 0 ? `${planningChecked.size} seleccionado${planningChecked.size !== 1 ? 's' : ''}` : 'Seleccionar todos'}
                </label>
                {planningChecked.size > 0 && (
                  <button className="btn-secondary" style={{ color: 'var(--danger-color)', padding: '0.2rem 0.7rem', fontSize: '0.8rem' }}
                    onClick={() => showConfirm(
                      'Eliminar casos seleccionados',
                      `¿Eliminar ${planningChecked.size} caso${planningChecked.size !== 1 ? 's' : ''} del ciclo? Esta acción no se puede deshacer.`,
                      () => handleRemoveManyFromCycle([...planningChecked]),
                      { danger: true, confirmLabel: 'Eliminar' }
                    )}>
                    🗑 Eliminar seleccionados ({planningChecked.size})
                  </button>
                )}
                <button className="btn-secondary" style={{ color: 'var(--danger-color)', padding: '0.2rem 0.7rem', fontSize: '0.8rem', marginLeft: 'auto' }}
                  onClick={() => showConfirm(
                    'Eliminar todos los casos',
                    `¿Eliminar TODOS los ${cycleTests.length} casos del ciclo? Esta acción no se puede deshacer.`,
                    () => handleRemoveManyFromCycle(cycleTests.map(t => t.id)),
                    { danger: true, confirmLabel: 'Eliminar todos' }
                  )}>
                  🗑 Eliminar todos
                </button>
              </div>
            )}

            <div className="test-list" style={{marginBottom: '2rem'}}>
              {cycleTests.filter(test => !searchQuery || test.key?.toLowerCase().includes(searchQuery.toLowerCase()) || test.summary?.toLowerCase().includes(searchQuery.toLowerCase()) || (testCases.find(t => t.id === test.id)?.summary || '').toLowerCase().includes(searchQuery.toLowerCase())).map(test => (
                <div key={test.id} className="test-card glass" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  {/* Checkbox */}
                  <input type="checkbox"
                    checked={planningChecked.has(String(test.id))}
                    onChange={e => setPlanningChecked(prev => {
                      const s = new Set(prev);
                      if (e.target.checked) s.add(String(test.id)); else s.delete(String(test.id));
                      return s;
                    })}
                    style={{ marginRight: '0.5rem', flexShrink: 0, cursor: 'pointer' }}
                  />
                  <div className="test-card-content" style={{ flex: 1 }}>
                    <span className="test-id">{test.key} <i style={{color:'var(--ds-text-subtle)', fontSize:'0.85em'}}>({getExecVal(test) ? getExecVal(test).charAt(0).toUpperCase() + getExecVal(test).slice(1) : 'Vacío'})</i></span>
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
                      title="Eliminar del ciclo">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                  </div>
                </div>
              ))}
              {cycleTests.length === 0 && <p className="empty-state">No tests added yet.</p>}
            </div>

            {/* ── Missing tests banner ── */}
            {(() => {
              const totalInProject = testCases.length;
              const inCycle = cycleTests.length;
              const notInCycle = testCases.filter(tc => !cycleTests.some(ct => String(ct.id) === String(tc.id))).length;
              if (totalInProject === 0 || notInCycle === 0) return null;

              // Visible warning only when cycle has SOME tests but a big gap exists
              const missingPct = Math.round((notInCycle / totalInProject) * 100);
              const isAlert = notInCycle > 0;

              return (
                <div style={{
                  background: inCycle === 0 ? 'rgba(239,68,68,0.08)' : 'rgba(255,152,0,0.08)',
                  border: `1px solid ${inCycle === 0 ? 'rgba(239,68,68,0.35)' : 'rgba(255,152,0,0.35)'}`,
                  borderRadius: '8px',
                  padding: '0.85rem 1.1rem',
                  marginBottom: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap'
                }}>
                  <div>
                    <div style={{ fontWeight: 600, color: inCycle === 0 ? '#ef4444' : '#FF9800', marginBottom: '0.2rem' }}>
                      {inCycle === 0 ? '🔴' : '⚠️'} {inCycle} de {totalInProject} casos del proyecto están en este ciclo
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      Faltan <strong>{notInCycle}</strong> caso{notInCycle !== 1 ? 's' : ''} ({missingPct}% del proyecto).
                      Usa los filtros de abajo para encontrarlos y el botón <em>"Agregar seleccionados"</em> para añadirlos.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
                    <button
                      className="btn-secondary"
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem' }}
                      title="Pre-selecciona todos los casos disponibles con los filtros actuales"
                      onClick={() => {
                        const available = testCases.filter(tc =>
                          (planningFolder === '' || tc.folderId === planningFolder) &&
                          (planningPriority === '' || tc.rawFields?.priority?.name === planningPriority) &&
                          (planningExecutionType === '' || (planningExecutionType.toLowerCase() === 'manual'
                            ? getExecVal(tc).includes('man')
                            : getExecVal(tc).includes('auto'))) &&
                          !cycleTests.some(ct => String(ct.id) === String(tc.id))
                        );
                        setSelectedTestsForCycle(available.map(tc => tc.id));
                      }}
                    >
                      ☑️ Seleccionar disponibles ({
                        testCases.filter(tc =>
                          (planningFolder === '' || tc.folderId === planningFolder) &&
                          (planningPriority === '' || tc.rawFields?.priority?.name === planningPriority) &&
                          (planningExecutionType === '' || (planningExecutionType.toLowerCase() === 'manual'
                            ? getExecVal(tc).includes('man')
                            : getExecVal(tc).includes('auto'))) &&
                          !cycleTests.some(ct => String(ct.id) === String(tc.id))
                        ).length
                      })
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}
                      onClick={() => setSelectedTestsForCycle([])}
                      title="Limpiar selección"
                    >
                      ✕ Limpiar
                    </button>
                  </div>
                </div>
              );
            })()}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Available Test Cases</h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select 
                  value={planningFolder} 
                  onChange={e => {
                      setPlanningFolder(e.target.value);
                      setSelectedTestsForCycle([]); // reset selection on folder change
                  }}
                  className="status-badge"
                  style={{ padding: '0.4rem', background: 'var(--bg-surface)' }}
                >
                  <option value="">Todas las Carpetas</option>
                  {folderPaths.map(f => (
                    <option key={f.id} value={f.id}>{f.path}</option>
                  ))}
                </select>
                <select value={planningPriority} onChange={e => { setPlanningPriority(e.target.value); setSelectedTestsForCycle([]); }} className="status-badge" style={{ padding: '0.4rem', border: '1px solid var(--ds-border)', borderRadius: '4px', background: 'var(--bg-surface)' }}>
                  <option value="">Todas las prioridades</option>
                  <option value="Highest">Highest</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                  <option value="Lowest">Lowest</option>
                </select>
                <select value={planningExecutionType} onChange={e => { setPlanningExecutionType(e.target.value); setSelectedTestsForCycle([]); }} className="status-badge" style={{ padding: '0.4rem', border: '1px solid var(--ds-border)', borderRadius: '4px', background: 'var(--bg-surface)' }}>
                  <option value="">Todos los tipos</option>
                  <option value="Manual">Manual</option>
                  <option value="Automatizado">Automatizado</option>
                </select>
                <button 
                  className="btn-primary" 
                  onClick={async () => {
                    const allAvailable = testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && (planningPriority === '' || tc.rawFields?.priority?.name === planningPriority) && (planningExecutionType === '' || (planningExecutionType.toLowerCase() === 'manual' ? getExecVal(tc).includes('man') : getExecVal(tc).includes('auto'))) && !cycleTests.some(ct => ct.id === tc.id));
                    // Si hay tests seleccionados manualmente, usar esos. Si no, añadir todos los disponibles
                    const testsToAdd = selectedTestsForCycle.length > 0 
                      ? testCases.filter(tc => selectedTestsForCycle.includes(tc.id))
                      : allAvailable;
                      
                    if (testsToAdd.length === 0) return;
                    setIsAddingAll(true);
                    try {
                      const CHUNK_SIZE = 20;
                      let lastExecutionData = null;
                      
                      // Enviar en bloques de 20 para evitar el timeout de 25 segundos de Forge
                      let allAddedTests = [];
                      for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                          const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                          const bRes = await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: chunk });
                          if (bRes && bRes.addedTests) {
                              allAddedTests = allAddedTests.concat(bRes.addedTests);
                          }
                      }
                      
                      // Optimistic UI update
                      const locallyAdded = testsToAdd.map(tc => ({
                         id: tc.id,
                         key: tc.key,
                         summary: tc.summary,
                         status: 'Not Run'
                      }));
                      
                      setCycleTests(prev => {
                         const newArr = [...prev];
                         locallyAdded.forEach(lt => {
                             let finalItem = lt;
                             // Use historical data if backend returned it!
                             if (allAddedTests && allAddedTests.length > 0) {
                                 const matched = allAddedTests.find(t => t.id === lt.id);
                                 if (matched && matched._historicalData) {
                                     finalItem = { ...lt, ...matched._historicalData };
                                 }
                             }
                             
                             if (!newArr.some(existing => existing.id === lt.id)) {
                                 newArr.push(finalItem);
                             }
                         });
                         return newArr;
                      });
                      
                      setSelectedTestsForCycle([]); // clear selection after adding
                      
                      // Fetch background after a delay to ensure replication
                      setTimeout(async () => {
                          const finalExecution = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
                          if (finalExecution) {
                              safeSetCycleTests(finalExecution);
                          }
                      }, 3000);
                      
                    } catch(err) {
                      console.error(err);
                      alert("Error al añadir casos: " + err.message);
                    }
                    setIsAddingAll(false);
                  }}
                  disabled={loading || isAddingAll}
                >
                  {isAddingAll ? 'Añadiendo casos...' : (selectedTestsForCycle.length > 0 ? `+ Añadir (${selectedTestsForCycle.length})` : '+ Añadir todos')}
                </button>
              </div>
            </div>
            <div className="test-list">
              {testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && (planningPriority === '' || tc.rawFields?.priority?.name === planningPriority) && (planningExecutionType === '' || (planningExecutionType.toLowerCase() === 'manual' ? getExecVal(tc).includes('man') : getExecVal(tc).includes('auto'))) && !cycleTests.some(ct => ct.id === tc.id)).map(test => (
                <div 
                   key={test.id} 
                   className="test-card glass" 
                   style={{
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      cursor: 'pointer',
                      border: selectedTestsForCycle.includes(test.id) ? '1px solid var(--accent-color)' : ''
                   }}
                   onClick={() => {
                      setSelectedTestsForCycle(prev => 
                         prev.includes(test.id) ? prev.filter(id => id !== test.id) : [...prev, test.id]
                      );
                   }}
                >
                  <div className="test-card-content" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input 
                      type="checkbox" 
                      checked={selectedTestsForCycle.includes(test.id)} 
                      readOnly
                      style={{ transform: 'scale(1.2)' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                       <span className="test-id">{test.key} <i style={{color:'var(--ds-text-subtle)', fontSize:'0.85em'}}>({getExecVal(test) ? getExecVal(test).charAt(0).toUpperCase() + getExecVal(test).slice(1) : 'Vacío'})</i></span>
                       <span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>

                    </div>
                  </div>
                  <button 
                     className="btn-secondary" 
                     onClick={(e) => {
                        e.stopPropagation();
                        handleAddTestToCycle(test);
                     }}
                  >
                     + Add
                  </button>
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

      // 1. Load BDD/Traditional steps (from test case issue — always available)
      if (!executionTestDetails[testId]) {
        const details = await invoke('getTestCaseDetails', { caseId: testId });
        setExecutionTestDetails(prev => ({ ...prev, [testId]: details || { type: 'traditional', content: [] } }));
      }

      // 2. Load full execution details (iterations, comment, evidences, description)
      const test = cycleTests.find(t => String(t.id) === String(testId));
      if (test && !test._detailLoaded) {
        const fullExec = await invoke('getTestExecution', { cycleId: selectedCycle.id, testId });

        const applyFullExec = (fe) => {
          // If the status in the lightweight index differs from exec_ — heal in background
          if (fe && fe.status && fe.status !== test.status) {
            invoke('updateTestStatus', {
              cycleId: selectedCycle.id,
              testId,
              status: fe.status,
              linkedBugs: fe.linkedBugs || test.linkedBugs || []
            }).catch(console.warn);
          }
        };

        if (fullExec && fullExec.description) {
          // exec_ has description — use directly
          applyFullExec(fullExec);
          setCycleTests(prev => prev.map(t => String(t.id) === String(testId)
            ? { ...t, ...fullExec, _detailLoaded: true } : t));
        } else if (fullExec) {
          // exec_ exists but no description — load description from the test case Jira issue
          applyFullExec(fullExec);
          const desc = await invoke('getIssueDescription', { issueId: testId }).catch(() => null);
          setCycleTests(prev => prev.map(t => String(t.id) === String(testId)
            ? { ...t, ...fullExec, description: desc || null, _detailLoaded: true } : t));
        } else {
          // exec_ property doesn't exist — try backfill (copies description from test issue to exec_)
          const updated = await invoke('backfillDescriptions', {
            cycleId: selectedCycle.id,
            testIds: [testId]
          });
          if (updated) {
            const backfilled = updated.find(t => String(t.id) === String(testId));
            if (backfilled) {
              setCycleTests(prev => prev.map(t => String(t.id) === String(testId)
                ? { ...t, ...backfilled, _detailLoaded: true } : t));
            }
          }
        }
      }
    }
  };

  const renderExecutionTab = () => (
    <div className="tab-layout">
      {/* Cycles Sidebar */}
      <aside className="sidebar glass" style={{ width: sidebarWidth, flexShrink: 0 }}>
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
      <div 
        onMouseDown={() => setIsResizing(true)}
        style={{
          width: '5px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? 'var(--ds-border-focused)' : 'transparent',
          zIndex: 10,
          borderRight: '1px solid var(--border-color)',
          marginLeft: '-1px'
        }}
      />
      <main className="main-content">
        {selectedCycle ? (
          <div>
            <div className="header">
              <div style={{display: 'flex', alignItems: 'center'}}>
  <h1>Execution: {selectedCycle.summary} <span style={{fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal'}}>({cycleTests.length} casos)</span></h1>
  {selectedCycle && (
    <button
      className="btn-secondary"
      onClick={async () => {
        setLocalLoading(true);
        try {
            // Only backfill tests that don't have exec_ data yet (avoid full-cycle timeout)
            const needsBackfill = cycleTests.filter(t => !t._detailLoaded && !t.lockedAt).map(t => t.id);
            if (needsBackfill.length === 0) {
              addNotification({ type: 'success', title: 'Todo al día', description: 'Todos los casos ya tienen información cargada.' });
              return;
            }
            // Process in chunks of 30 to stay under 25s timeout
            const CHUNK = 30;
            for (let i = 0; i < needsBackfill.length; i += CHUNK) {
              const chunk = needsBackfill.slice(i, i + CHUNK);
              const updated = await invoke('backfillDescriptions', {
                cycleId: selectedCycle.id,
                testIds: chunk
              });
              if (updated) safeSetCycleTests(updated);
              if (i + CHUNK < needsBackfill.length) await new Promise(r => setTimeout(r, 300));
            }
            addNotification({ type: 'success', title: 'Información sincronizada', description: `${needsBackfill.length} casos actualizados.` });
        } catch (err) {
            console.error("Refresh Info error:", err);
            addNotification({ type: 'error', title: 'Error al sincronizar info', description: err.message });
        } finally {
            setLocalLoading(false);
        }
      }}
      disabled={localLoading}
      style={{marginLeft: '1rem', fontSize: '0.8rem', padding: '0.3rem 0.6rem'}}
      title="Carga información de descripción de los casos que aún no la tienen"
    >
      🔄 Sincronizar Info
    </button>
  )}
  {selectedCycle && (
    <button
      className="btn-secondary"
      onClick={handleSyncCycleIndex}
      disabled={localLoading}
      title="Reconstruye el índice de estatus del ciclo desde los datos reales guardados. Úsalo si los estatus muestran 'Not Run' cuando ya fueron ejecutados."
      style={{marginLeft: '0.5rem', fontSize: '0.8rem', padding: '0.3rem 0.6rem', fontWeight: 600}}
    >
      {syncProgress ? `⏳ ${syncProgress.done}/${syncProgress.total}` : '🛠 Sincronizar Estatus'}
    </button>
  )}
</div>
            </div>
            
            <div className="test-list">
              {cycleTests.filter(test => !searchQuery || test.key?.toLowerCase().includes(searchQuery.toLowerCase()) || test.summary?.toLowerCase().includes(searchQuery.toLowerCase()) || (testCases.find(t => t.id === test.id)?.summary || '').toLowerCase().includes(searchQuery.toLowerCase())).map(test => (
                <div key={test.id} className="test-card glass" style={{display: 'flex', flexDirection: 'column'}}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 100px 1fr auto', gap: '1rem', alignItems: 'center', width: '100%' }}>
                    <div onClick={() => handleToggleExecutionTest(test.id)} style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transform: expandedExecutionTest === test.id ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s'}}><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </div>
                    <div onClick={() => handleToggleExecutionTest(test.id)} style={{cursor: 'pointer'}}>
                      <span className="test-id">{test.key} <i style={{color:'var(--ds-text-subtle)', fontSize:'0.85em'}}>({getExecVal(test) ? getExecVal(test).charAt(0).toUpperCase() + getExecVal(test).slice(1) : 'Vacío'})</i></span>
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
                      {test.lockedAt && (
                        <span title={`Ejecución completada y protegida${isAdmin ? ' (Admin puede resetear)' : ''}`}
                          style={{ marginLeft: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>🔒</span>
                      )}
                    </div>
                    <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0}}>
                      <button 
                        title={test.lockedAt && !isAdmin ? 'Ejecución protegida. Contacta al administrador.' : (runningTests[test.id] ? 'Detener Ejecución' : 'Iniciar Ejecución')}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (test.lockedAt && !isAdmin && !runningTests[test.id]) {
                            addNotification({ type: 'warning', title: '🔒 Ejecución protegida', description: 'Esta prueba fue completada. Solo un administrador puede re-ejecutarla.' });
                            return;
                          }
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
                                  // Optimistic UI: update immediately without waiting for backend
                                  setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, linkedBugs: updatedBugs } : t));
                                  // Fire save in background
                                  invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, linkedBugs: updatedBugs }).catch(err => {
                                    console.error('Error unlinking bug:', err);
                                    // Rollback on error
                                    setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, linkedBugs: test.linkedBugs } : t));
                                    alert('Error al desvincular el bug: ' + (err.message || err));
                                  });
                                }}
                                title="Quitar vínculo"
                                style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                              >✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                      
                      {/* --- DETALLES GENERALES DEL CASO --- */}
                      <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--ds-border)', marginBottom: '1rem'}}>
                        <div style={{width: '100%'}}>
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
                                    padding: '0.25rem 0.5rem', background: 'var(--bg-surface-hover)', 
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
                                    disabled={!runningTests[test.id]}
                                    style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                  >✕</button>
                                </div>
                              )})}
                            </div>
                          )}
                        </div>
                        <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.8rem', marginTop: '0.5rem'}}>
                          <span style={{fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)'}}>Evidencias Generales:</span>
                          <label className="btn-secondary" style={{padding: '0.4rem 0.8rem', border: '1px solid var(--ds-border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '4px', fontSize: '0.85rem'}} title="Adjuntar Evidencia (Archivo)" style={!runningTests[test.id] ? {opacity: 0.5, pointerEvents: 'none'} : {}}>
                            <input disabled={!runningTests[test.id]} 
                              type="file" 
                              style={{display: 'none'}} 
                              onChange={(e) => {
                                if (e.target.files && e.target.files.length > 0) {
                                  handleUploadEvidence(test.id, test.key, e.target.files[0]);
                                }
                              }}
                            />
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg> Archivo
                          </label>
                          <button 
                            className="btn-secondary" 
                            style={{padding: '0.4rem 0.8rem', border: '1px solid var(--ds-border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '4px', fontSize: '0.85rem'}} 
                            title="Grabar pantalla"
                            onClick={() => handleCaptureScreen(test.id, test.key)}
                            disabled={!runningTests[test.id]}
                            style={!runningTests[test.id] ? {opacity: 0.5, pointerEvents: 'none'} : {}}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> Grabar
                          </button>
                        </div>
                      </div>

                      
                      {/* --- TEST STEPS --- */}
                      {executionTestDetails[test.id] && executionTestDetails[test.id].type === 'traditional' && executionTestDetails[test.id].content.length > 0 && (
                        <div style={{display: 'flex', flexDirection: 'column', gap: '0.8rem', paddingBottom: '1rem', borderBottom: '1px solid var(--ds-border)', marginBottom: '1rem'}}>
                          <h4 style={{margin: 0}}>Pasos del Caso de Prueba</h4>
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th style={{width: '50px'}}>Paso</th>
                                <th>Acción</th>
                                <th>Resultado Esperado</th>
                                <th>Datos</th>
                              </tr>
                            </thead>
                            <tbody>
                              {executionTestDetails[test.id].content.map((step, idx) => (
                                <tr key={idx}>
                                  <td style={{textAlign: 'center'}}>{idx + 1}</td>
                                  <td dangerouslySetInnerHTML={{ __html: step.action }} />
                                  <td dangerouslySetInnerHTML={{ __html: step.expectedResult }} />
                                  <td>{step.data || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {/* --- BDD SCENARIOS --- */}
                      {executionTestDetails[test.id] && executionTestDetails[test.id].type === 'bdd' && executionTestDetails[test.id].content.length > 0 && (
                        <div style={{display: 'flex', flexDirection: 'column', gap: '0.8rem', paddingBottom: '1rem', borderBottom: '1px solid var(--ds-border)', marginBottom: '1rem'}}>
                          <h4 style={{margin: 0}}>Escenarios BDD</h4>
                          {executionTestDetails[test.id].content.map((scenario, idx) => (
                            <div key={idx} style={{background: 'var(--bg-surface)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--ds-border)'}}>
                              <h5 style={{margin: '0 0 0.5rem 0'}}>{scenario.title}</h5>
                              <div style={{whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem'}}>{scenario.gherkin}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* --- ITERACIONES --- */}
                      <div style={{display: 'flex', flexDirection: 'column', gap: '0.8rem'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                          <h4 style={{margin: 0}}>Iteraciones (Data-Driven)</h4>
                          <button onClick={() => handleAddIteration(test)} disabled={!runningTests[test.id]} className="btn-secondary" style={{fontSize: '0.8rem', padding: '0.3rem 0.6rem', opacity: !runningTests[test.id] ? 0.5 : 1}}>+ Agregar iteración</button>
                        </div>
                        
                        {(!test.iterations || test.iterations.length === 0) ? (
                          <div style={{color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic'}}>No hay iteraciones. Haz clic en "+ Agregar iteración" para comenzar.</div>
                        ) : (
                          test.iterations.map((iter, idx) => (
                            <div key={iter.id} style={{display: 'flex', gap: '0.5rem', alignItems: 'flex-start', background: 'var(--bg-surface-hover)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--ds-border)'}}>
                              <div style={{fontWeight: 'bold', width: '24px', color: 'var(--text-secondary)'}}>#{idx + 1}</div>
                              <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                                <input 
                                  type="text" 
                                  placeholder="Datos de prueba (Ej: Usuario=admin, Pass=123)" 
                                  defaultValue={iter.expectedData || ''}
                                  disabled={!runningTests[test.id]}
                                  onBlur={e => { if (e.target.value !== iter.expectedData) handleIterationChange(test, iter.id, 'expectedData', e.target.value); }}
                                  style={{width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--ds-border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontFamily: 'inherit'}}
                                />
                                <textarea 
                                  placeholder="Resultado actual..." 
                                  defaultValue={iter.actualResult || ''}
                                  disabled={!runningTests[test.id]}
                                  onBlur={e => { if (e.target.value !== iter.actualResult) handleIterationChange(test, iter.id, 'actualResult', e.target.value); }}
                                  style={{width: '100%', minHeight: '50px', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--ds-border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'vertical'}}
                                />
                                  {(iter.evidences && iter.evidences.length > 0) && (
                                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem', width: '100%'}}>
                                      {iter.evidences.map((ev, idx) => {
                                        const evId = typeof ev === 'string' ? ev : ev.id;
                                        const evName = typeof ev === 'string' ? `evidence_${evId}.jpg` : (ev.filename || `evidence_${evId}.jpg`);
                                        return (
                                          <div 
                                            key={idx}
                                            onClick={() => handlePreviewEvidence(ev)}
                                            style={{
                                              display: 'flex', alignItems: 'center', gap: '0.25rem', 
                                              padding: '0.25rem 0.5rem', background: 'var(--bg-surface-hover)', 
                                              borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem',
                                              border: '1px solid var(--ds-border)', color: 'var(--text-secondary)'
                                            }}
                                            title={evName}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                            <span style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                                              disabled={!runningTests[test.id]}
                                              style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                            >✏️</button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteEvidence(test.id, evId, idx, iter.id);
                                              }}
                                              title="Quitar evidencia"
                                              disabled={!runningTests[test.id]}
                                              style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                            >✕</button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                              </div>
                              <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '160px', alignItems: 'flex-end'}}>
                                {isAdmin && (
                                  <button
                                    onClick={() => handleDeleteIteration(test, iter.id)}
                                    title="Eliminar Iteración"
                                    disabled={!runningTests[test.id]}
                                    style={{
                                      background: 'none', border: 'none', cursor: 'pointer', 
                                      color: 'var(--danger-color)', fontSize: '0.9rem', 
                                      alignSelf: 'flex-end', padding: 0,
                                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                  >
                                    ✕
                                  </button>
                                )}
                                <select 
                                  value={iter.status || 'Not Run'}
                                  onChange={e => handleIterationChange(test, iter.id, 'status', e.target.value)}
                                  className="status-badge"
                                  disabled={!runningTests[test.id]}
                                  style={{width: '100%', padding: '0.4rem', border: 'none', cursor: 'pointer', background: getStatusColor(iter.status || 'Not Run'), color: getStatusTextColor(iter.status || 'Not Run')}}
                                >
                                  <option value="Not Run" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Not Run</option>
                                  <option value="Passed" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Passed</option>
                                  <option value="Failed" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Failed</option>
                                  <option value="Blocked" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Blocked</option>
                                </select>
                                <div style={{display: 'flex', gap: '0.3rem', justifyContent: 'center'}}>
                                  <label className="btn-secondary" style={{padding: '0.3rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: '1px solid var(--ds-border)'}} title="Adjuntar evidencia" style={!runningTests[test.id] ? {opacity: 0.5, pointerEvents: 'none'} : {}}>
                                    <input 
                                      disabled={!runningTests[test.id]}
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
                                  <button title="Grabar pantalla" className="btn-secondary" style={{padding: '0.3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: '1px solid var(--ds-border)'}} onClick={() => handleCaptureScreen(test.id, test.key, iter.id)} disabled={!runningTests[test.id]} style={!runningTests[test.id] ? {opacity: 0.5, pointerEvents: 'none'} : {}}>
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
              {cycleTests.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                  <p style={{ marginBottom: '1rem' }}>No hay casos en este ciclo.</p>
                  <p style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                    ¿El ciclo debería tener casos? Puede ser que el índice esté desincronizado.<br/>
                    Usa el botón para reconstruirlo desde los datos guardados en Jira (sin perder estatus).
                  </p>
                  <button
                    className="btn-secondary"
                    style={{ padding: '0.5rem 1.2rem' }}
                    disabled={localLoading}
                    onClick={handleSyncCycleIndex}
                  >
                    {syncProgress ? `⏳ Sincronizando ${syncProgress.done}/${syncProgress.total}...` : (localLoading ? '⏳ Reconstruyendo...' : '🔧 Reconstruir índice del ciclo')}
                  </button>
                </div>

              )}

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
    // Show spinner while loading — no ghost data visible
    if (reportLoading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1rem', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '2rem' }}>⏳</div>
          <div style={{ fontWeight: 500 }}>Cargando reporte...</div>
          <div style={{ fontSize: '0.85rem' }}>Esto puede tomar unos segundos la primera vez</div>
        </div>
      );
    }

    if (reportData._loadError && (!reportData.cycles || reportData.cycles.length === 0)) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1rem', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '2rem' }}>⚠️</div>
          <div style={{ fontWeight: 500 }}>El reporte tardó demasiado en cargar</div>
          <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Intenta de nuevo con el botón de abajo</div>
          <button className="btn-primary" onClick={loadReportData} style={{ padding: '0.5rem 1.2rem' }}>
            🔄 Reintentar
          </button>
        </div>
      );
    }

    let filteredCycles = reportData.cycles || [];
    if (reportSelectedPlans && reportSelectedPlans.length > 0) {
      filteredCycles = filteredCycles.filter(c => reportSelectedPlans.includes(c.planId));
    }
    if (reportSelectedCycles && reportSelectedCycles.length > 0) {
      filteredCycles = filteredCycles.filter(c => reportSelectedCycles.includes(c.id));
    }


    let totalCases = 0;
    let passed = 0;
    let failed = 0;
    let blocked = 0;
    let notRun = 0;
    let totalBugs = 0;
    let uniqueBugs = new Set();
    let closedBugs = 0;
    let totalResolutionHours = 0;
    let resolvedCount = 0;
    
    // Config
    const conf = projectConfig || {};
    const showProgreso = conf.showProgreso !== false;
    const showTesterStats = conf.showTesterStats !== false;
    const showExecTypeStats = conf.showExecTypeStats !== false;
    const showBugTimes = conf.showBugTimes !== false;
    const showFeatureStats = conf.showFeatureStats !== false;

    // Custom metrics
    const testerStats = {};
    const featureStats = {};
    const bugTimes = {};
    const execStats = {
      manual: { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 },
      auto: { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 }
    };

    filteredCycles.forEach(cycle => {
      if(cycle.execution && Array.isArray(cycle.execution)) {
        cycle.execution.forEach(ex => {
          totalCases++;
          if (ex.status === 'Passed') passed++;
          else if (ex.status === 'Failed') failed++;
          else if (ex.status === 'Blocked') blocked++;
          else notRun++;
          
          // Exec Type
          let isAuto = false;
          if (getExecVal && typeof getExecVal === 'function' && getExecVal({ rawFields: ex.rawFields }).includes('auto')) {
             isAuto = true;
          }
          const tc = testCases.find(t => t.id === ex.id);
          if (tc && getExecVal(tc).includes('auto')) {
             isAuto = true;
          }
          const stats = isAuto ? execStats.auto : execStats.manual;
          stats.total++;
          if (ex.status === 'Passed') stats.passed++;
          else if (ex.status === 'Failed') stats.failed++;
          else if (ex.status === 'Blocked') stats.blocked++;
          else stats.notRun++;

          // Tester
          const tester = (ex.executedBy && typeof ex.executedBy === 'object') ? (ex.executedBy.displayName || ex.executedBy.name || 'Sin asignar') : (ex.executedBy || 'Sin asignar');
          if (!testerStats[tester]) testerStats[tester] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
          testerStats[tester].total++;
          if (ex.status === 'Passed') testerStats[tester].passed++;
          else if (ex.status === 'Failed') testerStats[tester].failed++;
          else if (ex.status === 'Blocked') testerStats[tester].blocked++;
          else testerStats[tester].notRun++;

          // Feature
          const tcFeature = testCases.find(t => t.id === ex.id);
          if (tcFeature && tcFeature.folderId) {
            const fObj = folderPaths.find(f => f.id === tcFeature.folderId);
            if (fObj) {
              const folderPath = fObj.path;
              if (!featureStats[folderPath]) featureStats[folderPath] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
              featureStats[folderPath].total++;
              if (ex.status === 'Passed') featureStats[folderPath].passed++;
              else if (ex.status === 'Failed') featureStats[folderPath].failed++;
              else if (ex.status === 'Blocked') featureStats[folderPath].blocked++;
              else featureStats[folderPath].notRun++;
            }
          }

          if (ex.linkedBugs && ex.linkedBugs.length > 0) {
            ex.linkedBugs.forEach(bug => {
              if (!uniqueBugs.has(bug.key)) {
                uniqueBugs.add(bug.key);
                totalBugs++;
                
                const s = (bug.status || '').toLowerCase(); 
                if (['done', 'closed', 'resolved', 'cerrada', 'cerrado', 'resuelta', 'resuelto', 'terminado'].includes(s)) closedBugs++;
                
                if (bug.timesSpent && Object.keys(bug.timesSpent).length > 0) {
                    for (const [state, hours] of Object.entries(bug.timesSpent)) {
                        if (!bugTimes[state]) bugTimes[state] = { totalHours: 0, count: 0 };
                        bugTimes[state].totalHours += hours;
                        bugTimes[state].count++;
                        
                        const stateLow = state.toLowerCase();
                        if (stateLow === 'in progress' || stateLow === 'en curso') {
                            totalResolutionHours += hours;
                        }
                    }
                    resolvedCount++;
                }
              }
            });
          }
        });
      }
    });

    const ejecutados = passed + failed;
    const successRate = ejecutados > 0 ? ((passed / ejecutados) * 100).toFixed(1) : 0;
    const allTotal = passed + failed + blocked + notRun;
    const coverageRate = allTotal > 0 ? (((passed + failed + blocked) / allTotal) * 100).toFixed(1) : 0;

    // Calc angles for donut
    const pPct = allTotal > 0 ? (passed / allTotal) * 100 : 0;
    const fPct = allTotal > 0 ? (failed / allTotal) * 100 : 0;
    const bPct = allTotal > 0 ? (blocked / allTotal) * 100 : 0;
    const nPct = allTotal > 0 ? (notRun / allTotal) * 100 : (allTotal === 0 ? 100 : 0);

  const handleCopyReportToClipboard = () => {
    try {
      const baseUrl = context?.siteUrl || '';
      let tableRows = '';
    
    const bugGroups = {};
    filteredCycles.forEach(cycle => {
      if (cycle.execution && Array.isArray(cycle.execution)) {
        cycle.execution.forEach(ex => {
          if (ex.linkedBugs && ex.linkedBugs.length > 0) {
            ex.linkedBugs.forEach(bug => {
              if (!bugGroups[bug.key]) {
                bugGroups[bug.key] = { ...bug, linkedCases: [] };
              }
              if (!bugGroups[bug.key].linkedCases.includes(ex.id)) {
                bugGroups[bug.key].linkedCases.push(ex.id);
              }
            });
          }
        });
      }
    });

    Object.values(bugGroups).forEach(bug => {
      tableRows += `
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px;"><a href="${baseUrl}/browse/${bug.key}">${bug.key}</a></td>
          <td style="border: 1px solid #ddd; padding: 8px;">${bug.summary || 'N/A'}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${bug.severity || 'N/A'}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${bug.status || 'Desconocido'}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${bug.assignee || 'Sin asignar'}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${bug.resolution || 'Unresolved'}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${bug.linkedCases.length} caso${bug.linkedCases.length !== 1 ? 's' : ''} impactado${bug.linkedCases.length !== 1 ? 's' : ''}</td>
        </tr>
      `;
    });

    const htmlTemplate = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Resumen de Pruebas: ${reportSelectedCycles.length === 1 ? filteredCycles[0]?.summary : 'Todos los ciclos'}</h2>
        <p>A continuación se presenta el resumen ejecutivo de la ejecución de pruebas:</p>
        
        <ul style="list-style-type: none; padding-left: 0; line-height: 1.8;">
          <li>📋 <strong>Total de Casos:</strong> ${allTotal}</li>
          <li>🟢 <strong>Pasados:</strong> ${passed} <em>(${pPct.toFixed(1)}%)</em></li>
          <li>🔴 <strong>Fallados:</strong> ${failed} <em>(${fPct.toFixed(1)}%)</em></li>
          <li>🟡 <strong>Bloqueados:</strong> ${blocked} <em>(${bPct.toFixed(1)}%)</em></li>
          <li>🔵 <strong>No Ejecutados:</strong> ${notRun} <em>(${nPct.toFixed(1)}%)</em></li>
          <li>🎯 <strong>Cobertura de Ejecución:</strong> ${coverageRate}%</li>
          <li>🐞 <strong>Defectos Reportados:</strong> ${totalBugs} <em>(Cerrados: ${closedBugs})</em></li>
        </ul>
        
        <h3 style="margin-top: 20px;">Detalle de Defectos Reportados</h3>
        ${totalBugs > 0 ? `
        <table style="border-collapse: collapse; width: 100%;">
          <tr style="background-color: #f4f5f7;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Id del bug</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Descripción</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Severidad</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Estado</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Responsable</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Resolución</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Casos impactados</th>
          </tr>
          ${tableRows}
        </table>
        ` : '<p>No se encontraron defectos en este ciclo.</p>'}

        <h3 style="margin-top: 20px;">Riesgos o Bloqueos</h3>
        <ul>
          <li>[Ingresa aquí cualquier riesgo identificado...]</li>
        </ul>

        <h3 style="margin-top: 20px;">Siguientes Pasos</h3>
        <ul>
          <li>[Ingresa aquí las siguientes acciones...]</li>
        </ul>
      </div>
    `;

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
      
      const success = document.execCommand('copy');
      
      selection.removeAllRanges();
      document.body.removeChild(el);
      
      if (!success) {
         console.warn("execCommand returned false, possible permission issue.");
      }

      const subject = encodeURIComponent(`Resumen de Pruebas: ${reportSelectedCycles.length === 1 ? filteredCycles[0]?.summary : 'Todos los ciclos'}`);
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      alert(`Plantilla copiada al portapapeles. Usa ${isMac ? 'Cmd + V' : 'Ctrl + V'} en el correo para pegar la tabla. Abriendo Gmail...`);
      router.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}`);
    } catch(err) {
      console.error('Error al copiar:', err);
      alert("Error crítico al exportar reporte: " + err.message);
    }
  };

    return (
      <div className="tab-layout full-width" style={{padding: '2rem'}}>
        <div className="header" style={{marginBottom: '0'}}>
          <h1>Dashboard: Métricas de Calidad</h1>
          <div style={{ marginLeft: 'auto', marginRight: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button
              onClick={loadReportData}
              disabled={reportLoading}
              style={{ padding: '0.4rem 0.8rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: reportLoading ? 'not-allowed' : 'pointer', color: 'var(--text-primary)', fontSize: '0.9rem' }}
              title="Recargar datos del reporte"
            >
              🔄 Actualizar
            </button>
            {reportData._loadedAt && !reportLoading && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {Math.round((Date.now() - reportData._loadedAt) / 60000) < 1
                  ? 'Actualizado < 1 min'
                  : `Hace ${Math.round((Date.now() - reportData._loadedAt) / 60000)} min`}
              </span>
            )}
            {circuitBreakerActive && (
              <span style={{ fontSize: '0.75rem', color: '#ff991f', fontWeight: 600, whiteSpace: 'nowrap' }}>
                ⏸ Rate limit (3 min)
              </span>
            )}
          </div>
          <button 
            className="btn-primary" 
            onClick={handleCopyReportToClipboard}
            style={{padding: '0.4rem 0.8rem', marginRight: '1rem'}}
          >
            📋 Enviar reporte de Estatus
          </button>
          <div style={{display: 'flex', gap: '1rem'}}>
            <details style={{ position: 'relative' }}>
              <summary style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', cursor: 'pointer', minWidth: '180px' }}>
                {reportSelectedPlans.length === 0 ? "Todos los Planes" : `${reportSelectedPlans.length} Planes seleccionados`}
              </summary>
              <div style={{ position: 'absolute', top: '100%', left: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', zIndex: 10, padding: '0.5rem', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', minWidth: '220px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                 <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input type="checkbox" checked={reportSelectedPlans.length === 0} onChange={() => { setReportSelectedPlans([]); setReportSelectedCycles([]); }} /> Todos los Planes
                 </label>
                 {testPlans.map(p => (
                   <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                     <input type="checkbox" checked={reportSelectedPlans.includes(p.id)} onChange={(e) => {
                       let newVals = [...reportSelectedPlans];
                       if (e.target.checked) newVals.push(p.id);
                       else newVals = newVals.filter(v => v !== p.id);
                       setReportSelectedPlans(newVals);
                       setReportSelectedCycles([]);
                     }} />
                     {p.summary}
                   </label>
                 ))}
              </div>
            </details>

            <details style={{ position: 'relative' }}>
              <summary style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', cursor: 'pointer', minWidth: '180px' }}>
                {reportSelectedCycles.length === 0 ? "Todos los Ciclos" : `${reportSelectedCycles.length} Ciclos seleccionados`}
              </summary>
              <div style={{ position: 'absolute', top: '100%', left: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', zIndex: 10, padding: '0.5rem', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', minWidth: '220px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                 <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input type="checkbox" checked={reportSelectedCycles.length === 0} onChange={() => { setReportSelectedCycles([]); }} /> Todos los Ciclos
                 </label>
                 {(reportSelectedPlans.length > 0 ? (reportData.cycles || []).filter(c => reportSelectedPlans.includes(c.planId)) : (reportData.cycles || [])).map(c => (
                   <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                     <input type="checkbox" checked={reportSelectedCycles.includes(c.id)} onChange={(e) => {
                       let newVals = [...reportSelectedCycles];
                       if (e.target.checked) newVals.push(c.id);
                       else newVals = newVals.filter(v => v !== c.id);
                       setReportSelectedCycles(newVals);
                     }} />
                     {c.summary}
                   </label>
                 ))}
              </div>
            </details>
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
              
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.95rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--success-color, #22A06B)'}}></div> Passed ({pPct.toFixed(1)}%)</div>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--danger-color, #E34935)'}}></div> Failed ({fPct.toFixed(1)}%)</div>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--warning-color, #F6C000)'}}></div> Blocked ({bPct.toFixed(1)}%)</div>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--brand-color, #0C66E4)'}}></div> Not Run ({nPct.toFixed(1)}%)</div>
              </div>
            </div>
          </div>

          {showExecTypeStats && (
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
          )}
          
          {showTesterStats && (
            <div className="chart-card">
              <h3>Estado por Tester</h3>
              <div className="bar-chart-container" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {Object.entries(testerStats).map(([tester, stats]) => {
                  return (
                    <div className="bar-row" key={tester}>
                      <div className="bar-label">
                        <span>{tester}</span>
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
          )}
          
          {showFeatureStats && (
            <div className="chart-card">
              <h3>Estado por Funcionalidad</h3>
              <div className="bar-chart-container" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {Object.entries(featureStats).sort((a, b) => b[1].total - a[1].total).map(([folder, stats]) => {
                  return (
                    <div className="bar-row" key={folder}>
                      <div className="bar-label">
                        <span title={folder} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{folder}</span>
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
          )}

          {(showProgreso || showBugTimes) && (
            <div style={{ 
              gridColumn: '1 / -1', 
              display: 'grid', 
              gridTemplateColumns: (showProgreso && showBugTimes) ? '2fr 1fr' : '1fr', 
              gap: '1.5rem', 
              alignItems: 'start' 
            }}>
              {showProgreso && (
                <div className="chart-card" style={{ margin: 0 }}>
                   <h3>Progreso por Ciclo de Pruebas</h3>
                   <div className="bar-chart-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem', marginTop: '1rem' }}>
                     {filteredCycles.length === 0 ? (
                       <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>No hay ciclos para mostrar.</div>
                     ) : (
                       filteredCycles.map(cycle => {
                         let cPassed = 0, cFailed = 0, cBlocked = 0, cNotRun = 0;
                         if (cycle.execution && Array.isArray(cycle.execution)) {
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
              )}
              
              {showBugTimes && (
                <div className="chart-card" style={{ margin: 0 }}>
                   <h3>Resolución de Bugs (Tiempo Promedio)</h3>
                   <div className="bar-chart-container" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                     {Object.keys(bugTimes).length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>No hay datos suficientes.</div>
                     ) : (
                        (() => {
                          const maxAvg = Math.max(...Object.values(bugTimes).map(d => d.count > 0 ? (d.totalHours / d.count) : 0));
                          return Object.entries(bugTimes)
                            .sort((a, b) => {
                               const avgA = a[1].count > 0 ? (a[1].totalHours / a[1].count) : 0;
                               const avgB = b[1].count > 0 ? (b[1].totalHours / b[1].count) : 0;
                               return avgB - avgA;
                            })
                            .map(([state, data]) => {
                              const avg = data.count > 0 ? (data.totalHours / data.count) : 0;
                              const w = maxAvg > 0 ? (avg / maxAvg) * 100 : 0;
                              return (
                                <div className="bar-row" key={state}>
                                  <div className="bar-label">
                                    <span style={{ textTransform: 'capitalize', fontWeight: '500' }}>{state}</span>
                                    <div style={{ display: 'flex', gap: '1rem', color: 'var(--text-secondary)' }}>
                                      <span>{data.totalHours.toFixed(1)}h Tot</span>
                                      <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{avg.toFixed(1)}h Prom</span>
                                    </div>
                                  </div>
                                  <div className="bar-track">
                                    {avg > 0 ? (
                                      <div className="bar-segment" style={{ width: `${w}%`, background: 'var(--brand-color, #0C66E4)' }} title={`Promedio: ${avg.toFixed(1)} hrs`}></div>
                                    ) : (
                                      <div style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Sin tiempo medible</div>
                                    )}
                                  </div>
                                </div>
                              );
                            });
                        })()
                     )}
                   </div>
                </div>
              )}
            </div>
          )}

          {(() => {
            // Collect ALL tests from filtered cycles — split into with/without bugs
            const withBugsMap = {}; // bugKey → { ...bugInfo, linkedCases: [] }
            const withBugsCases = []; // { id, key, summary, status, cycleName, bugs[] }
            const withoutBugsCases = []; // { id, key, summary, status, cycleName }
            const seenTestIds = new Set();

            filteredCycles.forEach(cycle => {
              (cycle.execution || []).forEach(ex => {
                if (seenTestIds.has(ex.id)) return;
                seenTestIds.add(ex.id);
                const tc = testCases.find(t => String(t.id) === String(ex.id));
                const tcKey = tc ? tc.key : (ex.key || ex.id);
                const tcSummary = tc ? tc.summary : (ex.summary || 'Sin título');
                const tcStatus = ex.status || 'Not Run';

                if (ex.linkedBugs && ex.linkedBugs.length > 0) {
                  withBugsCases.push({ id: ex.id, key: tcKey, summary: tcSummary, status: tcStatus, cycleName: cycle.name, bugs: ex.linkedBugs });
                  ex.linkedBugs.forEach(bug => {
                    let finalSeverity = bug.severity;
                    if (bug.rawFields && bug.rawFields['customfield_10238']) {
                      const sf = bug.rawFields['customfield_10238'];
                      finalSeverity = typeof sf === 'object' ? (sf.value || sf.name || String(sf)) : String(sf);
                    }
                    if (!withBugsMap[bug.key]) {
                      withBugsMap[bug.key] = { ...bug, finalSeverity, linkedCases: [tcKey] };
                    } else if (!withBugsMap[bug.key].linkedCases.includes(tcKey)) {
                      withBugsMap[bug.key].linkedCases.push(tcKey);
                    }
                  });
                } else {
                  withoutBugsCases.push({ id: ex.id, key: tcKey, summary: tcSummary, status: tcStatus, cycleName: cycle.name });
                }
              });
            });

            const bugsArr = Object.values(withBugsMap);
            const hasBugs = bugsArr.length > 0;

            return (
              <div style={{ gridColumn: '1 / -1', marginTop: '2.5rem', marginBottom: '1rem' }}>
                {/* ─── Sección A: Tests CON bugs ─── */}
                <div className="chart-card" style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    🐞 Tests con Defectos
                    <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                      ({withBugsCases.length} caso{withBugsCases.length !== 1 ? 's' : ''} · {bugsArr.length} bug{bugsArr.length !== 1 ? 's' : ''} único{bugsArr.length !== 1 ? 's' : ''})
                    </span>
                  </h3>
                  {hasBugs ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--ds-background-neutral)', borderBottom: '2px solid var(--ds-border)' }}>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Id del bug</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descripción del bug</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>*Severity</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Responsable</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Resolución</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Casos impactados</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bugsArr.map((bug, i) => (
                          <tr key={bug.key + '-' + i} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                            <td style={{ padding: '0.5rem' }}>
                              <a href="#" onClick={(e) => { e.preventDefault(); router.open('/browse/' + bug.key); }}>{bug.key}</a>
                            </td>
                            <td style={{ padding: '0.5rem' }}>{bug.summary || 'N/A'}</td>
                            <td style={{ padding: '0.5rem' }}>{bug.finalSeverity || 'N/A'}</td>
                            <td style={{ padding: '0.5rem' }}>
                              <span className="status-badge" style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem', backgroundColor: (bug.resolution && bug.resolution !== 'Unresolved') ? 'var(--success-bg)' : 'var(--danger-bg)', color: (bug.resolution && bug.resolution !== 'Unresolved') ? 'var(--success-color)' : 'var(--danger-color)' }}>
                                {bug.status || 'Desconocido'}
                              </span>
                            </td>
                            <td style={{ padding: '0.5rem' }}>{bug.assignee || 'Sin asignar'}</td>
                            <td style={{ padding: '0.5rem' }}>{bug.resolution || 'Unresolved'}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                              <span style={{ display: 'inline-block', minWidth: '2rem', padding: '0.15rem 0.5rem', borderRadius: '999px', backgroundColor: 'var(--ds-background-neutral)', fontWeight: 600, fontSize: '0.85rem' }}>
                                {bug.linkedCases.length}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ color: 'var(--text-secondary)', marginTop: '0.75rem', fontSize: '0.9rem' }}>✅ No se encontraron defectos en los ciclos seleccionados.</p>
                  )}
                </div>

                {/* ─── Sección B: Bugs del proyecto SIN caso de prueba asociado ─── */}

                <div className="chart-card" style={{ overflowX: 'auto', marginTop: '1.5rem' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    🔴 Bugs sin caso de prueba asociado
                    <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                      ({unlinkedBugs.length} en el proyecto)
                    </span>
                  </h3>
                  {unlinkedBugs.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--ds-background-neutral)', borderBottom: '2px solid var(--ds-border)' }}>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Bug</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descripción</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Prioridad</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Responsable</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Resolución</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Reportado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unlinkedBugs.map((bug, i) => (
                          <tr key={bug.key + '-unlinked-' + i} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                            <td style={{ padding: '0.5rem' }}>
                              <a href="#" onClick={(e) => { e.preventDefault(); router.open('/browse/' + bug.key); }}>{bug.key}</a>
                            </td>
                            <td style={{ padding: '0.5rem', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bug.summary}</td>
                            <td style={{ padding: '0.5rem', fontSize: '0.8rem' }}>{bug.priority || '—'}</td>
                            <td style={{ padding: '0.5rem' }}>
                              <span className="status-badge" style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem', backgroundColor: bug.statusCategory === 'done' ? 'var(--success-bg)' : (bug.statusCategory === 'indeterminate' ? '#fff7e6' : 'var(--danger-bg)'), color: bug.statusCategory === 'done' ? 'var(--success-color)' : (bug.statusCategory === 'indeterminate' ? '#ff991f' : 'var(--danger-color)') }}>
                                {bug.status || '—'}
                              </span>
                            </td>
                            <td style={{ padding: '0.5rem', fontSize: '0.8rem' }}>{bug.assignee || 'Sin asignar'}</td>
                            <td style={{ padding: '0.5rem', fontSize: '0.8rem' }}>{bug.resolution || 'Unresolved'}</td>
                            <td style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{bug.created ? new Date(bug.created).toLocaleDateString('es-MX') : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ color: 'var(--text-secondary)', marginTop: '0.75rem', fontSize: '0.9rem' }}>
                      {reportLoading ? '⏳ Cargando...' : '✅ Todos los bugs del proyecto están asociados a al menos un caso de prueba.'}
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

        </div>
      </div>
    );
  };;;

    const handleBackupProject = async () => {
    try {
      setLoading(true);
      
      const backupData = {
        timestamp: new Date().toISOString(),
        project: selectedProjectId,
        config: projectConfig,
        folders: folders,
        testCases: testCases,
        testPlans: testPlans,
        testCycles: testCycles,
        cycleExecutions: {}
      };

      for (const cycle of testCycles) {
        const execution = await invoke('getCycleExecution', { cycleId: cycle.id });
        if (execution) {
          backupData.cycleExecutions[cycle.id] = execution;
        }
      }

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const filename = `backup_testpulse_${selectedProjectId}_${new Date().toISOString().split('T')[0]}.json`;

      let taskType = projectIssueTypes.find(it => it.name.toLowerCase() === 'task' || it.name.toLowerCase() === 'tarea');
      if (!taskType && projectIssueTypes.length > 0) {
        taskType = projectIssueTypes[0];
      }
      if (!taskType) throw new Error("No se encontraron tipos de ticket en este proyecto.");

      const issuePayload = {
        fields: {
          project: { id: selectedProjectId },
          summary: `TestPulse Backup - ${new Date().toISOString().split('T')[0]}`,
          issuetype: { id: taskType.id },
          description: {
             type: "doc",
             version: 1,
             content: [
               { type: "paragraph", content: [{ type: "text", text: "Respaldo automático generado por Test Pulse." }] }
             ]
          }
        }
      };

      const createRes = await requestJira('/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify(issuePayload),
        headers: { 'Content-Type': 'application/json' }
      });
      if (!createRes.ok) throw new Error("Fallo al crear el ticket de respaldo.");
      const newIssue = await createRes.json();

      const formData = new FormData();
      formData.append('file', blob, filename);

      const attachRes = await requestJira(`/rest/api/3/issue/${newIssue.key}/attachments`, {
          method: 'POST',
          body: formData,
          headers: { 'Accept': 'application/json', 'X-Atlassian-Token': 'no-check' }
      });

      if (!attachRes.ok) throw new Error("Ticket creado pero falló la subida.");

      alert(`¡Respaldo exitoso! Se generó el ticket: ${newIssue.key}`);
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
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
              
              <hr style={{ margin: '2rem 0', borderColor: 'var(--ds-border)' }} />
              <h3 style={{ marginBottom: '1rem' }}>Bug / Defect Issue Types</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Selecciona los tipos de issue que representan bugs en tu proyecto (usados en Reportes). Si no seleccionas ninguno, se usarán todos los tipos comunes: Bug, Defect, Falla, Error, Incident, etc.
              </p>

              <div className="form-group">
                <label>Tipos de Bug / Defecto</label>
                <select
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)', height: '100px' }}
                  multiple
                  value={projectConfig.bugIssueTypes || []}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
                    setProjectConfig({...projectConfig, bugIssueTypes: selected});
                  }}
                >
                  {projectIssueTypes.map(it => (
                    <option key={it.id} value={it.name}>{it.name}</option>
                  ))}
                </select>
                <small style={{ color: 'var(--text-secondary)' }}>
                  Ctrl/Cmd + clic para seleccionar múltiples. Vacío = busca Bug, Defect, Falla, Error, Incident, Incidente, Problem, Issue en todos los proyectos accesibles.
                </small>
              </div>

              <hr style={{ margin: '2rem 0', borderColor: 'var(--ds-border)' }} />
              <h3 style={{ marginBottom: '1rem' }}>Widgets del Tablero de Reportes</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Selecciona qué métricas y gráficas estarán visibles en la pestaña de Reportes.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input 
                     type="checkbox" 
                     checked={projectConfig.showProgreso !== false}
                     onChange={e => setProjectConfig({...projectConfig, showProgreso: e.target.checked})}
                     style={{ width: '1.2rem', height: '1.2rem' }}
                   />
                   <span style={{ fontWeight: '500' }}>Mostrar Progreso por Ciclo de Pruebas</span>
                </label>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input 
                     type="checkbox" 
                     checked={projectConfig.showTesterStats !== false}
                     onChange={e => setProjectConfig({...projectConfig, showTesterStats: e.target.checked})}
                     style={{ width: '1.2rem', height: '1.2rem' }}
                   />
                   <span style={{ fontWeight: '500' }}>Mostrar Casos por Tester</span>
                </label>
    
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input 
                     type="checkbox" 
                     checked={projectConfig.showExecTypeStats !== false}
                     onChange={e => setProjectConfig({...projectConfig, showExecTypeStats: e.target.checked})}
                     style={{ width: '1.2rem', height: '1.2rem' }}
                   />
                   <span style={{ fontWeight: '500' }}>Mostrar Casos por Tipo de Ejecución (Manual/Auto)</span>
                </label>
    
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input 
                     type="checkbox" 
                     checked={projectConfig.showBugTimes !== false}
                     onChange={e => setProjectConfig({...projectConfig, showBugTimes: e.target.checked})}
                     style={{ width: '1.2rem', height: '1.2rem' }}
                   />
                   <span style={{ fontWeight: '500' }}>Mostrar Tiempo de Resolución de Defectos (Horas Laborales)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input 
                     type="checkbox" 
                     checked={projectConfig.showFeatureStats !== false}
                     onChange={e => setProjectConfig({...projectConfig, showFeatureStats: e.target.checked})}
                     style={{ width: '1.2rem', height: '1.2rem' }}
                   />
                   <span style={{ fontWeight: '500' }}>Mostrar Casos por Funcionalidad (Carpetas)</span>
                </label>
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
          <div className="glass" style={{ padding: '2rem', borderRadius: '8px', marginTop: '2rem', marginBottom: '2rem' }}>
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

        {/* Respaldo Section */}
        {selectedProjectId && isAdmin && (
          <div className="glass" style={{ padding: '2rem', borderRadius: '8px', marginTop: '2rem', marginBottom: '2rem' }}>
            <h2 style={{ marginBottom: '1rem', color: 'var(--brand-color)' }}>Respaldo General (Backup)</h2>
            <p style={{ marginBottom: '1.5rem', color: 'var(--ds-text-subtlest)' }}>
              Genera un archivo JSON con absolutamente toda la información estructural del proyecto: carpetas, casos de prueba, planes, ciclos, iteraciones, estado de ejecución y referencias a bugs e imágenes. Útil como red de seguridad.
            </p>
            
            <button 
                id="backup-ticket-btn"
                className="btn-primary"
                onClick={handleBackupProject}
                style={{ background: '#FF5630', border: 'none', padding: '1rem 2rem', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', marginTop: '1rem' }}
            >
              ⬇ Generar Ticket de Respaldo (Crear Issue)
            </button>
          </div>
        )}



        {/* ── Migración de datos ── */}
        <hr style={{ margin: '2rem 0', borderColor: 'var(--ds-border)' }} />
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1.5rem', marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>🔧 Mantenimiento de datos</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Migra todos los ciclos al formato moderno de índice. Ejecuta esto <strong>una sola vez</strong> para
            eliminar la sobrecarga de healing y prevenir el rate limiting de Jira. Se procesa 1 ciclo por llamada para no exceder el límite de 25s de Forge.
          </p>

          {/* Barra de progreso mientras migra */}
          {isMigrating && migrateProgress && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>
                Migrando... {migrateProgress.processed} / {migrateProgress.total} ciclos procesados
                {migrateProgress.migrated > 0 && ` · ${migrateProgress.migrated} migrados`}
                {migrateProgress.modern > 0 && ` · ${migrateProgress.modern} ya modernos`}
              </div>
              <div style={{ background: 'var(--border-color)', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
                <div style={{
                  background: 'linear-gradient(90deg, #78256F, #a855a0)',
                  height: '100%',
                  width: `${migrateProgress.total > 0 ? Math.round((migrateProgress.processed / migrateProgress.total) * 100) : 0}%`,
                  transition: 'width 0.4s ease'
                }} />
              </div>
            </div>
          )}

          {/* Resultado final */}
          {!isMigrating && migrateProgress?.done && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: '6px', background: migrateProgress.errors?.length ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', fontSize: '0.85rem' }}>
              ✅ Completado — Migrados: <strong>{migrateProgress.migrated}</strong>, Ya modernos: <strong>{migrateProgress.modern}</strong>, Sin datos: <strong>{migrateProgress.skipped}</strong>
              {migrateProgress.errors?.length > 0 && (
                <div style={{ color: 'var(--danger-color)', marginTop: '0.25rem' }}>Errores: {migrateProgress.errors.join(', ')}</div>
              )}
            </div>
          )}

          <button
            className="btn-secondary"
            disabled={isMigrating}
            onClick={async () => {
              if (!window.confirm('¿Migrar todos los ciclos al formato moderno?\n\nEsto puede tardar varios minutos. No cierres la ventana.\nSe procesará 1 ciclo por vez.')) return;
              setIsMigrating(true);
              setMigrateProgress(null);
              const totals = { processed: 0, total: 1, migrated: 0, modern: 0, skipped: 0, errors: [], done: false };
              try {
                let offset = 0;
                let done = false;
                while (!done) {
                  const result = await invoke('migrateAllCycles', {
                    projectId: selectedProjectId,
                    config: projectConfig,
                    offset,
                    limit: 1  // 1 ciclo por llamada — bien dentro del límite de 25s de Forge
                  });
                  totals.processed = result.processed || (offset + 1);
                  totals.total = result.total || totals.total;
                  totals.migrated += result.migrated || 0;
                  totals.modern += result.alreadyModern || 0;
                  totals.skipped += result.skipped || 0;
                  if (result.errors?.length) totals.errors.push(...result.errors);
                  done = result.done;
                  totals.done = done;
                  setMigrateProgress({ ...totals });
                  offset = result.nextOffset ?? (offset + 1);
                  if (!done) await new Promise(r => setTimeout(r, 300));
                }
              } catch (err) {
                totals.errors.push(err.message);
                setMigrateProgress({ ...totals, done: true });
                alert('Error en migración: ' + err.message);
              } finally {
                setIsMigrating(false);
              }
            }}
            style={{ padding: '0.6rem 1.2rem' }}
          >
            {isMigrating ? '⏳ Migrando...' : '⚡ Migrar todos los ciclos al formato moderno'}
          </button>
        </div>



      </main>
    </div>
  );;;

  const renderModal = () => null;

  const renderModals = () => (
    <>
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={() => {
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          confirmModal.onConfirm?.();
        }}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        danger={confirmModal.danger}
        confirmLabel={confirmModal.confirmLabel}
      />
      <TextInputModal
        isOpen={textInputModal.isOpen}
        title={textInputModal.title}
        label={textInputModal.label}
        defaultValue={textInputModal.defaultValue}
        placeholder={textInputModal.placeholder}
        onConfirm={(v) => { textInputModal.onConfirm(v); setTextInputModal(prev => ({ ...prev, isOpen: false })); }}
        onCancel={() => setTextInputModal(prev => ({ ...prev, isOpen: false }))}
      />
    </>
  );

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
              <h2 style={{margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1}}>{previewModalData.filename}</h2>
              <button className="btn-secondary" onClick={() => setPreviewModalData(null)} style={{flexShrink: 0, marginLeft: '1rem', padding: '0.4rem 0.8rem', background: 'var(--danger-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', zIndex: 10000}}>✕ Cerrar</button>
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

      <div style={{ textAlign: 'center', marginTop: '3rem', padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', borderTop: '1px solid var(--ds-border)' }}>
        <strong>Test Pulse</strong> v1.2.0 © El Puerto de Liverpool
      </div>
      {renderModals()}
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
    <NotificationProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </NotificationProvider>
  );
}

export default WrappedApp;

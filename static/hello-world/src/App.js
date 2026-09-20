import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { invoke as forgeInvoke, view, router, requestJira } from '@forge/bridge';
import { CreateIssueModal } from '@forge/jira-bridge';
import Lozenge from '@atlaskit/lozenge';
import Badge from '@atlaskit/badge';
import Button from '@atlaskit/button';
import Spinner from '@atlaskit/spinner';
import './index.css';
import TestPulseLoader from './components/TestPulseLoader';



const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'iter_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
};

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

function adfToHtml(adf) {
  if (!adf) return '';
  if (typeof adf === 'string') {
    if (adf.trim().startsWith('<') && adf.trim().endsWith('>')) {
      return adf;
    }
    return adf
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
  }
  if (typeof adf !== 'object') return String(adf);

  function renderNode(node) {
    if (!node) return '';
    if (Array.isArray(node)) {
      return node.map(renderNode).join('');
    }
    const type = node.type;
    const content = node.content ? node.content.map(renderNode).join('') : '';

    switch (type) {
      case 'doc':
        return content;
      case 'paragraph':
        return `<p style="margin: 0.4rem 0;">${content || '&nbsp;'}</p>`;
      case 'heading': {
        const level = node.attrs?.level || 3;
        return `<h${level} style="margin: 0.6rem 0 0.3rem 0;">${content}</h${level}>`;
      }
      case 'bulletList':
        return `<ul style="margin: 0.4rem 0; padding-left: 1.5rem;">${content}</ul>`;
      case 'orderedList':
        return `<ol style="margin: 0.4rem 0; padding-left: 1.5rem;">${content}</ol>`;
      case 'listItem':
        return `<li>${content}</li>`;
      case 'table':
        return `<table style="width: 100%; border-collapse: collapse; margin: 0.5rem 0;" border="1">${content}</table>`;
      case 'tableRow':
        return `<tr>${content}</tr>`;
      case 'tableHeader':
        return `<th style="padding: 0.4rem; background: var(--bg-surface-hover, #f4f5f7); text-align: left; border: 1px solid var(--ds-border, #dfe1e6); font-weight: bold;">${content}</th>`;
      case 'tableCell':
        return `<td style="padding: 0.4rem; border: 1px solid var(--ds-border, #dfe1e6);">${content}</td>`;
      case 'text': {
        let text = (node.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (node.marks && Array.isArray(node.marks)) {
          for (const mark of node.marks) {
            if (mark.type === 'strong') text = `<strong>${text}</strong>`;
            else if (mark.type === 'em') text = `<em>${text}</em>`;
            else if (mark.type === 'code') text = `<code style="background: rgba(9,30,66,0.08); padding: 2px 4px; border-radius: 3px; font-family: monospace;">${text}</code>`;
            else if (mark.type === 'strike') text = `<del>${text}</del>`;
            else if (mark.type === 'underline') text = `<u>${text}</u>`;
            else if (mark.type === 'link') text = `<a href="${mark.attrs?.href || '#'}" target="_blank" rel="noopener noreferrer">${text}</a>`;
            else if (mark.type === 'textColor') text = `<span style="color: ${mark.attrs?.color || 'inherit'}">${text}</span>`;
          }
        }
        return text;
      }
      case 'hardBreak':
        return '<br/>';
      case 'codeBlock':
        return `<pre style="background: var(--bg-surface-hover, #f4f5f7); padding: 0.8rem; border-radius: 4px; overflow-x: auto; font-family: monospace;"><code>${content || (node.text || '')}</code></pre>`;
      case 'blockquote':
        return `<blockquote style="border-left: 3px solid var(--ds-border, #dfe1e6); margin: 0.5rem 0; padding-left: 0.8rem; color: var(--text-secondary, #6b778c);">${content}</blockquote>`;
      case 'rule':
        return '<hr style="border: none; border-top: 1px solid var(--ds-border, #dfe1e6); margin: 0.8rem 0;" />';
      case 'mention':
        return `<span style="background: rgba(9,30,66,0.08); padding: 1px 4px; border-radius: 3px; font-weight: 500;">@${node.attrs?.text || 'user'}</span>`;
      default:
        return content || (node.text ? node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '');
    }
  }

  return renderNode(adf);
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


const AtlaskitStatusLozenge = ({ status, isBold = true }) => {
  const norm = (status || 'Not Run').trim().toLowerCase();
  let appearance = 'default';
  let label = status || 'Not Run';

  if (norm === 'passed' || norm === 'pass') {
    appearance = 'success';
    label = 'PASSED';
  } else if (norm === 'failed' || norm === 'fail') {
    appearance = 'removed';
    label = 'FAILED';
  } else if (norm === 'blocked') {
    appearance = 'moved';
    label = 'BLOCKED';
  } else if (norm === 'in progress' || norm === 'running') {
    appearance = 'inprogress';
    label = 'IN PROGRESS';
  } else if (norm === 'not run' || norm === 'to do') {
    appearance = 'default';
    label = 'NOT RUN';
  }

  return <Lozenge appearance={appearance} isBold={isBold}>{label}</Lozenge>;
};


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
  const [isAddingAll, setIsAddingAll] = useState(false);
  const [previewImages, setPreviewImages] = useState({});
  const [previewModalData, setPreviewModalData] = useState(null);
  const [linkingBugTestId, setLinkingBugTestId] = useState(null); // id of test for which we show the bug-link input
  const [bugKeyInput, setBugKeyInput] = useState('');
  const [executionStatusFilter, setExecutionStatusFilter] = useState('ALL');
  const [executionSearchQuery, setExecutionSearchQuery] = useState('');
  const [executionSortBy, setExecutionSortBy] = useState('key-asc');
  const [executionCurrentPage, setExecutionCurrentPage] = useState(1);
  const [executionPageSize, setExecutionPageSize] = useState(20);
  const [executionChecked, setExecutionChecked] = useState(new Set());
  
  // Reports State
  const [reportData, setReportData] = useState({ cycles: [] });
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSelectedPlans, setReportSelectedPlans] = useState([]);
  const [bugResolutionTime, setBugResolutionTime] = useState(null);
  const [reportSelectedCycles, setReportSelectedCycles] = useState([]);
  const [executionTypeFieldId, setExecutionTypeFieldId] = useState(null);
  const [resolutionStage, setResolutionStage] = useState('Nuevo a Abierto');
  const [dashboardSubView, setDashboardSubView] = useState('runs'); // 'runs', 'bugs', 'traceability'
  const [dashboardBugSearch, setDashboardBugSearch] = useState('');
  const [dashboardTraceabilitySearch, setDashboardTraceabilitySearch] = useState('');
  
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
  const [modalDetailTab, setModalDetailTab] = useState('details');
  
  // Search & Refresh State
  const [searchQuery, setSearchQuery] = useState('');
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [selectedDesignTestIds, setSelectedDesignTestIds] = useState(new Set());
  const [draggedDesignTestIds, setDraggedDesignTestIds] = useState(null);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [designTypeFilter, setDesignTypeFilter] = useState('all'); // 'all' | 'automated' | 'manual'
  const [designSortOrder, setDesignSortOrder] = useState('recent'); // 'recent' | 'az'
  const [isRefreshing, setIsRefreshing] = useState(false);
  const searchInputRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [loading, setLoading] = useState(true);
  const [localLoading, setLocalLoading] = useState(false);

  // Project Context & Config State
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [isGlobal, setIsGlobal] = useState(false);
  const [projectConfig, setProjectConfig] = useState({ testCaseType: '', testCycleType: '', planIssueType: '', testRunType: 'Test Run', requirementIssueTypes: [], requirementLinkType: 'ANY' });
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

  // Keyboard shortcut handler for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // Report Automation (Jira Automation Webhook & Scheduled Trigger)
  const [showReportAutomationModal, setShowReportAutomationModal] = useState(false);
  const [reportAutomationConfig, setReportAutomationConfig] = useState({
    enabled: false,
    webhookUrl: '',
    recipients: '',
    frequency: 'weekdays', // 'daily', 'weekdays', 'weekly'
    weeklyDay: '5', // 5 = Friday
    hour: '18', // 18:00
    minute: '00',
    timezone: 'America/Mexico_City',
    scopePlan: 'all', // 'all', 'latest'
    scopeCycle: 'all' // 'all', 'latest'
  });
  const [reportAutomationLastDispatch, setReportAutomationLastDispatch] = useState(null);
  const [reportAutomationLoading, setReportAutomationLoading] = useState(false);
  const [reportAutomationTesting, setReportAutomationTesting] = useState(false);
  const [reportAutomationActiveTab, setReportAutomationActiveTab] = useState('config'); // 'config' | 'guide' | 'history'

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
      } else {
        if (ctx?.extension?.project) {
          setProjects(prev => {
            const proj = ctx.extension.project;
            const exists = prev.some(p => String(p.id) === String(proj.id) || String(p.key) === String(proj.key));
            return exists ? prev : [proj, ...prev];
          });
        }
        if (!currentProjectId) {
          setSelectedProjectId(targetProjectId);
        }
        invoke('getProjects').then(fp => {
          if (Array.isArray(fp) && fp.length > 0) {
            setProjects(fp);
          }
        }).catch(() => {});
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

      invoke('getReportAutomationConfig', { projectId: targetProjectId }).then(autoRes => {
        if (autoRes && autoRes.success && autoRes.config) {
          setReportAutomationConfig(autoRes.config);
          setReportAutomationLastDispatch(autoRes.lastDispatch || null);
        }
      }).catch(() => {});

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

  const loadReportAutomationConfig = async (projId = selectedProjectId) => {
    const targetId = projId || context?.extension?.project?.id;
    if (!targetId) return;
    try {
      setReportAutomationLoading(true);
      const res = await invoke('getReportAutomationConfig', { projectId: targetId });
      if (res && res.success && res.config) {
        setReportAutomationConfig(res.config);
        setReportAutomationLastDispatch(res.lastDispatch || null);
      }
    } catch (err) {
      console.error('Error al cargar configuración de automatización:', err);
    } finally {
      setReportAutomationLoading(false);
    }
  };

  const saveReportAutomationConfigHandler = async () => {
    const targetId = selectedProjectId || context?.extension?.project?.id;
    if (!targetId) {
      addNotification({
        type: 'error',
        title: 'Error de Proyecto',
        description: 'Por favor selecciona un proyecto de Jira.'
      });
      return;
    }

    try {
      setReportAutomationLoading(true);
      const res = await invoke('saveReportAutomationConfig', {
        projectId: targetId,
        config: reportAutomationConfig
      });

      if (res && res.success) {
        addNotification({
          type: 'success',
          title: '💾 Configuración Guardada',
          description: reportAutomationConfig.enabled
            ? `Automatización ACTIVADA (${reportAutomationConfig.hour || 18}:00 hrs CDMX).`
            : 'Configuración guardada (Automatización en PAUSA).'
        });
      } else {
        addNotification({
          type: 'error',
          title: 'Error al Guardar',
          description: res?.error || 'No se pudo guardar la configuración.'
        });
      }
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Error de Conexión',
        description: err.message
      });
    } finally {
      setReportAutomationLoading(false);
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

  // Reports: auto-refresh when entering tab only if data is older than 15 min, and poll every 15 min
  useEffect(() => {
    if (activeTab !== 'reports') return;
    const age = reportData._loadedAt ? Date.now() - reportData._loadedAt : Infinity;
    if (reportData.cycles.length === 0 || age > 900_000) {
      loadReportData();
    }
    const intervalId = setInterval(() => {
      loadReportData();
    }, 900_000);
    return () => clearInterval(intervalId);
  }, [activeTab]);

  // Helper to determine if a test case is automated
  const isAutomatedTest = useCallback((t) => {
    if (!t) return false;
    if (t.isAutomated === true || t.automationStatus === 'AUTOMATED' || t.automationStatus === 'Automated') return true;
    if (Array.isArray(t.labels) && t.labels.some(l => {
      const lower = String(l).toLowerCase().trim();
      return lower === 'automated' || lower === 'auto' || lower === 'automatizado';
    })) return true;
    if (t.executionType && String(t.executionType).toLowerCase().includes('auto')) return true;
    if (t.rawFields) {
      if (t.rawFields['customfield_10534']) {
        const v = t.rawFields['customfield_10534'];
        const str = (typeof v === 'object' && v !== null ? v.value || v.name || '' : String(v)).toLowerCase();
        if (str.includes('auto')) return true;
      }
      if (executionTypeFieldId && t.rawFields[executionTypeFieldId]) {
        const v = t.rawFields[executionTypeFieldId];
        const str = (typeof v === 'object' && v !== null ? v.value || v.name || '' : String(v)).toLowerCase();
        if (str.includes('auto')) return true;
      }
    }
    const sum = (t.summary || '').toLowerCase().trim();
    if (sum.startsWith('[auto]') || sum.startsWith('auto:') || sum.includes('(automatizado)') || sum.includes('[automatizado]')) return true;
    return false;
  }, [executionTypeFieldId]);

  // Filtered Data
  const filteredTestCasesAll = testCases.filter(tc => {
    const matchesSearch = tc.key.toLowerCase().includes(searchQuery.toLowerCase()) || tc.summary.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFolder = activeFolder === null || tc.folderId === activeFolder;
    const isAuto = isAutomatedTest(tc);
    const matchesType = designTypeFilter === 'all' 
      || (designTypeFilter === 'automated' && isAuto)
      || (designTypeFilter === 'manual' && !isAuto);
    return matchesSearch && matchesFolder && matchesType;
  }).sort((a, b) => {
    if (designSortOrder === 'az') {
      return (a.summary || '').localeCompare(b.summary || '');
    }
    // Default: recent (numeric key ID desc)
    const numA = parseInt((a.key || '').replace(/\D/g, ''), 10) || 0;
    const numB = parseInt((b.key || '').replace(/\D/g, ''), 10) || 0;
    return numB - numA;
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
    <nav className="top-nav glass" style={{ height: '56px', padding: '0 1.25rem', display: 'flex', alignItems: 'center', backgroundColor: '#FFFFFF', borderBottom: '1px solid var(--jira-border, #DCDFE4)', zIndex: 30 }}>
      {/* Brand & Project Selector */}
      <div className="nav-brand" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginRight: '1rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Animated Squircle App Icon */}
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '9px',
            background: 'linear-gradient(135deg, #0C66E4 0%, #5E4DB2 50%, #8247E5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(12, 102, 228, 0.28)',
            flexShrink: 0,
            overflow: 'hidden',
            position: 'relative'
          }}>
            <svg width="28" height="28" viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg">
              <style>{`
                @keyframes navPulseDash {
                  0% { stroke-dashoffset: 400; opacity: 0.3; }
                  40% { opacity: 1; }
                  80% { opacity: 1; }
                  100% { stroke-dashoffset: -400; opacity: 0.3; }
                }
                @keyframes navBeaconGlow {
                  0%, 100% { transform: scale(1); filter: drop-shadow(0 0 4px #FFFFFF); }
                  50% { transform: scale(1.2); filter: drop-shadow(0 0 8px #FFFFFF); }
                }
                .nav-pulse-line {
                  stroke-dasharray: 200;
                  animation: navPulseDash 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
                }
                .nav-beacon {
                  transform-origin: 135px 78px;
                  animation: navBeaconGlow 1.8s ease-in-out infinite;
                }
              `}</style>
              <defs>
                <linearGradient id="navPulseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85"/>
                  <stop offset="50%" stopColor="#FFFFFF"/>
                  <stop offset="100%" stopColor="#E9F2FF"/>
                </linearGradient>
              </defs>
              <circle cx="120" cy="120" r="70" stroke="white" strokeWidth="2" strokeOpacity="0.2" fill="none" strokeDasharray="6 6"/>
              <path d="M48 120 H74 L94 100 L114 150 L135 78 L155 130 L170 120 H192" stroke="rgba(255,255,255,0.3)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round"/>
              <path className="nav-pulse-line" d="M48 120 H74 L94 100 L114 150 L135 78 L155 130 L170 120 H192" stroke="url(#navPulseGrad)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round"/>
              <g className="nav-beacon">
                <circle cx="135" cy="78" fill="#FFFFFF" r="12"/>
                <circle cx="135" cy="78" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeOpacity="0.6" r="22"/>
              </g>
            </svg>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', lineHeight: '1.2' }}>
              <span style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--jira-navy, #091E42)', letterSpacing: '-0.02em' }}>
                Test <span style={{ color: '#6554C0' }}>Pulse</span>
              </span>
              <span className="ads-lozenge ads-lozenge-purple" style={{ borderRadius: '9999px', padding: '1px 6px', fontSize: '9px' }}>
                SUITE
              </span>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--jira-subtle, #626F86)', fontWeight: 500, lineHeight: 1 }}>
              Automated &amp; Manual QA Engine for Forge
            </span>
          </div>
        </div>

        {isGlobal && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>/</span>
            <select 
              value={selectedProjectId || ''} 
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                loadData(e.target.value);
              }}
              style={{
                padding: '0.25rem 0.5rem', 
                borderRadius: '4px', 
                border: '1px solid var(--jira-border, #DCDFE4)', 
                backgroundColor: '#FFFFFF', 
                color: 'var(--text-primary)',
                fontWeight: '600',
                fontSize: '0.85rem',
                cursor: 'pointer',
                outline: 'none',
                maxWidth: '260px'
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
          {/* Navigation Tabs with Badges & Indicators */}
          <div className="nav-tabs" style={{ marginLeft: '1rem', flex: 1, overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.25rem', height: '100%' }}>
            <button 
              className={`nav-tab ${activeTab === 'design' ? 'active' : ''}`} 
              onClick={() => setActiveTab('design')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                position: 'relative',
                padding: '0 0.85rem',
                height: '100%',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontWeight: activeTab === 'design' ? 700 : 500,
                color: activeTab === 'design' ? 'var(--jira-blue, #0C66E4)' : 'var(--jira-subtle, #626F86)',
                fontSize: '0.88rem'
              }}
            >
              <span>Design</span>
              <span className={`ads-lozenge ${activeTab === 'design' ? 'ads-lozenge-brand' : 'ads-lozenge-subtle'}`} style={{ fontSize: '10px' }}>
                {testCases.length}
              </span>
              {activeTab === 'design' && <div className="tab-indicator" />}
            </button>

            <button 
              className={`nav-tab ${activeTab === 'planning' ? 'active' : ''}`} 
              onClick={() => setActiveTab('planning')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                position: 'relative',
                padding: '0 0.85rem',
                height: '100%',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontWeight: activeTab === 'planning' ? 700 : 500,
                color: activeTab === 'planning' ? 'var(--jira-blue, #0C66E4)' : 'var(--jira-subtle, #626F86)',
                fontSize: '0.88rem'
              }}
            >
              <span>Planning</span>
              <span className={`ads-lozenge ${activeTab === 'planning' ? 'ads-lozenge-brand' : 'ads-lozenge-subtle'}`} style={{ fontSize: '10px' }}>
                {testCycles.length}
              </span>
              {activeTab === 'planning' && <div className="tab-indicator" />}
            </button>

            <button 
              className={`nav-tab ${activeTab === 'execution' ? 'active' : ''}`} 
              onClick={() => setActiveTab('execution')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                position: 'relative',
                padding: '0 0.85rem',
                height: '100%',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontWeight: activeTab === 'execution' ? 700 : 500,
                color: activeTab === 'execution' ? 'var(--jira-blue, #0C66E4)' : 'var(--jira-subtle, #626F86)',
                fontSize: '0.88rem'
              }}
            >
              <span>Execution</span>
              <span className="live-dot" title="Ejecución en vivo" />
              {activeTab === 'execution' && <div className="tab-indicator" />}
            </button>

            <button 
              className={`nav-tab ${activeTab === 'reports' ? 'active' : ''}`} 
              onClick={() => setActiveTab('reports')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                position: 'relative',
                padding: '0 0.85rem',
                height: '100%',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontWeight: activeTab === 'reports' ? 700 : 500,
                color: activeTab === 'reports' ? 'var(--jira-blue, #0C66E4)' : 'var(--jira-subtle, #626F86)',
                fontSize: '0.88rem'
              }}
            >
              <span>Dashboard</span>
              {activeTab === 'reports' && <div className="tab-indicator" />}
            </button>

            {isAdmin && (
              <button 
                className={`nav-tab ${activeTab === 'config' ? 'active' : ''}`} 
                onClick={() => setActiveTab('config')}
                title="Configuraciones de Test Pulse"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  padding: '0 0.85rem',
                  height: '100%',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  color: activeTab === 'config' ? 'var(--jira-blue, #0C66E4)' : 'var(--jira-subtle, #626F86)'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                {activeTab === 'config' && <div className="tab-indicator" />}
              </button>
            )}
          </div>

          {/* Nav Actions: Search Cmd+K & Refresh */}
          <div className="nav-actions" style={{ display: 'flex', gap: '0.6rem', marginLeft: 'auto', alignItems: 'center', flexShrink: 0 }}>
            {/* Quick Search input */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '220px' }}>
              <span style={{ position: 'absolute', left: '8px', pointerEvents: 'none', display: 'flex', alignItems: 'center', color: '#626F86' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </span>
              <input 
                ref={searchInputRef}
                type="text" 
                placeholder="Buscar tests (Cmd + K)..."
                title="Presiona Cmd+K o Ctrl+K para buscar"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ 
                  padding: '0.35rem 2.2rem 0.35rem 28px', 
                  borderRadius: '6px', 
                  border: '1px solid var(--jira-border, #DCDFE4)', 
                  background: 'var(--jira-bg-app, #F7F8F9)',
                  color: 'var(--jira-text, #172B4D)',
                  width: '100%',
                  fontSize: '0.82rem',
                  outline: 'none',
                  transition: 'all 0.2s ease'
                }}
                onFocus={(e) => {
                  e.target.style.background = '#FFFFFF';
                  e.target.style.borderColor = 'var(--jira-blue, #0C66E4)';
                  e.target.style.boxShadow = '0 0 0 2px rgba(12, 102, 228, 0.2)';
                }}
                onBlur={(e) => {
                  e.target.style.background = 'var(--jira-bg-app, #F7F8F9)';
                  e.target.style.borderColor = 'var(--jira-border, #DCDFE4)';
                  e.target.style.boxShadow = 'none';
                }}
              />
              <span style={{ position: 'absolute', right: '6px', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
                <kbd style={{ fontSize: '10px', fontWeight: 600, color: '#8590A2', background: '#EBEDF0', padding: '1px 4px', borderRadius: '4px', border: '1px solid #DCDFE4' }}>
                  ⌘K
                </kbd>
              </span>
            </div>

            {/* Sync Refresh Button */}
            <button 
              className="btn-secondary" 
              onClick={async () => {
                setIsRefreshing(true);
                try {
                  if (selectedCycle && (activeTab === 'execution' || activeTab === 'planning')) {
                    setLocalLoading(true);
                    const rawExecution = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
                    safeSetCycleTests(rawExecution || []);
                  } else {
                    setLocalLoading(true);
                    const config = projectConfig || { testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
                    const [fetchedCycles, fetchedPlans] = await Promise.all([
                      invoke('getTestCycles', { projectId: selectedProjectId, config }),
                      invoke('getTestPlans', { projectId: selectedProjectId, config })
                    ]);
                    if (fetchedCycles && !fetchedCycles._isError) setTestCycles(fetchedCycles);
                    if (fetchedPlans && !fetchedPlans._isError) setTestPlans(fetchedPlans);
                  }
                } catch(e) {
                  console.error('Refresh error:', e);
                } finally {
                  setLocalLoading(false);
                  setTimeout(() => setIsRefreshing(false), 600);
                }
              }} 
              disabled={loading || localLoading} 
              title="Sincronizar Suite con Jira"
              style={{ padding: '0.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: '1px solid var(--jira-border, #DCDFE4)', background: '#FFFFFF', cursor: 'pointer' }}
            >
              <svg 
                width="15" 
                height="15" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="var(--jira-blue, #0C66E4)" 
                strokeWidth="2.2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                style={{
                  transition: 'transform 0.6s ease',
                  transform: (isRefreshing || localLoading) ? 'rotate(360deg)' : 'none'
                }}
              >
                <path d="M23 4v6h-6"></path>
                <path d="M1 20v-6h6"></path>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
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
        {/* Modern Folders & Suites Header */}
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--jira-subtle, #626F86)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Folders &amp; Suites</span>
            <span className="ads-lozenge ads-lozenge-subtle" style={{ borderRadius: '9999px', fontSize: '10px' }}>{folders.length + 1}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button 
              onClick={() => {
                const nextState = !isAllTestsExpanded;
                setIsAllTestsExpanded(nextState);
                const nextExp = {};
                folders.forEach(f => { nextExp[f.id] = nextState; });
                setExpandedFolders(nextExp);
              }} 
              title="Expandir / Contraer todo"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', borderRadius: '4px', color: 'var(--jira-subtle, #626F86)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="8 9 12 5 16 9"></polyline>
                <polyline points="16 15 12 19 8 15"></polyline>
              </svg>
            </button>
          </div>
        </div>

        {/* Quick Folder Filter */}
        <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--jira-bg-subtle, #F1F2F4)' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8590A2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '8px', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input 
              type="text"
              placeholder="Filtrar carpetas..."
              value={folderSearchQuery}
              onChange={e => setFolderSearchQuery(e.target.value)}
              style={{
                width: '100%',
                fontSize: '0.75rem',
                padding: '0.3rem 0.5rem 0.3rem 24px',
                borderRadius: '4px',
                border: '1px solid transparent',
                background: 'var(--jira-bg-subtle, #F1F2F4)',
                color: 'var(--jira-text, #172B4D)',
                outline: 'none'
              }}
              onFocus={e => { e.target.style.background = '#FFFFFF'; e.target.style.borderColor = 'var(--jira-blue, #0C66E4)'; }}
              onBlur={e => { e.target.style.background = 'var(--jira-bg-subtle, #F1F2F4)'; e.target.style.borderColor = 'transparent'; }}
            />
          </div>
        </div>

        <ul className="folder-list" style={{ padding: '0.5rem 0', margin: 0, listStyle: 'none', overflowY: 'auto', flex: 1 }}>
          <li 
            className={`folder-item ${activeFolder === null ? 'active' : ''} ${dragOverFolderId === '__ROOT__' ? 'drag-over' : ''}`} 
            onClick={() => setActiveFolder(null)} 
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragOverFolderId !== '__ROOT__') setDragOverFolderId('__ROOT__');
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverFolderId !== '__ROOT__') setDragOverFolderId('__ROOT__');
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.currentTarget.contains(e.relatedTarget)) return;
              if (dragOverFolderId === '__ROOT__') setDragOverFolderId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverFolderId(null);
              let idsToMove = draggedDesignTestIds;
              try {
                const dataStr = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');
                if (dataStr) {
                  const parsed = JSON.parse(dataStr);
                  if (parsed?.testIds?.length) idsToMove = parsed.testIds;
                }
              } catch (err) {}
              if (idsToMove && idsToMove.length > 0) {
                handleBatchLinkTestsToFolder(idsToMove, null, 'Raíz (All Tests)');
                setSelectedDesignTestIds(new Set());
                setDraggedDesignTestIds(null);
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', cursor: 'pointer', borderRadius: '4px', margin: '0 0.5rem 2px 0.5rem' }}
          >
            <div style={{ width: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setIsAllTestsExpanded(prev => !prev); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--jira-subtle, #626F86)' }}>
                {isAllTestsExpanded ? <polyline points="6 9 12 15 18 9"></polyline> : <polyline points="9 18 15 12 9 6"></polyline>}
              </svg>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#FFAB00" stroke="none" style={{ flexShrink: 0 }}>
              <path d="M2.5 5A2.5 2.5 0 015 2.5h5.5l1.65 2.5H20a2.5 2.5 0 012.5 2.5v12A2.5 2.5 0 0120 22H5a2.5 2.5 0 01-2.5-2.5V5z" />
            </svg>
            <span style={{ fontWeight: 600, fontSize: '0.82rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dragOverFolderId === '__ROOT__' ? '⚡ Soltar aquí (Raíz)' : 'All Tests'}
            </span>
            <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px' }}>{testCases.length}</span>
          </li>
          {isAllTestsExpanded && (() => {
            const renderTree = (parentId = null, depth = 0) => {
              return folders
                .filter(f => (f.parentId || null) === parentId)
                .filter(f => !folderSearchQuery || f.name.toLowerCase().includes(folderSearchQuery.toLowerCase()))
                .map(folder => {
                  const hasChildren = folders.some(f => f.parentId === folder.id);
                  const isExpanded = expandedFolders[folder.id] !== false;
                  const isDragTarget = dragOverFolderId === folder.id;
                  
                  return (
                    <React.Fragment key={folder.id}>
                      <li 
                        className={`folder-item ${activeFolder === folder.id ? 'active' : ''} ${isDragTarget ? 'drag-over' : ''}`} 
                        onClick={() => setActiveFolder(folder.id)} 
                        onDragEnter={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (dragOverFolderId !== folder.id) setDragOverFolderId(folder.id);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'move';
                          if (dragOverFolderId !== folder.id) setDragOverFolderId(folder.id);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (e.currentTarget.contains(e.relatedTarget)) return;
                          if (dragOverFolderId === folder.id) setDragOverFolderId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverFolderId(null);
                          let idsToMove = draggedDesignTestIds;
                          try {
                            const dataStr = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');
                            if (dataStr) {
                              const parsed = JSON.parse(dataStr);
                              if (parsed?.testIds?.length) idsToMove = parsed.testIds;
                            }
                          } catch (err) {}
                          if (idsToMove && idsToMove.length > 0) {
                            handleBatchLinkTestsToFolder(idsToMove, folder.id, `"${folder.name}"`);
                            setSelectedDesignTestIds(new Set());
                            setDraggedDesignTestIds(null);
                          }
                        }}
                        style={{
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center', 
                          padding: '0.35rem 0.75rem 0.35rem ' + (0.75 + depth * 1.1) + 'rem',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          margin: '0 0.5rem 2px 0.5rem',
                          borderLeft: depth > 0 ? '2px solid var(--jira-border, #DCDFE4)' : 'none'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flex: 1, minWidth: 0 }}>
                          <div style={{ width: '14px', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setExpandedFolders(prev => ({...prev, [folder.id]: !isExpanded})); }}>
                            {hasChildren ? (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--jira-subtle, #626F86)' }}>
                                {isExpanded ? <polyline points="6 9 12 15 18 9"></polyline> : <polyline points="9 18 15 12 9 6"></polyline>}
                              </svg>
                            ) : null}
                          </div>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill={isDragTarget ? '#E1007A' : '#FFAB00'} stroke="none" style={{ flexShrink: 0, transition: 'fill 0.15s ease' }}>
                            <path d="M2.5 5A2.5 2.5 0 015 2.5h5.5l1.65 2.5H20a2.5 2.5 0 012.5 2.5v12A2.5 2.5 0 0120 22H5a2.5 2.5 0 01-2.5-2.5V5z" />
                          </svg>
                          <span style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isDragTarget ? 700 : 400 }} title={folder.name}>
                            {isDragTarget ? `⚡ Soltar en "${folder.name}"` : folder.name}
                          </span>
                          <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px', marginLeft: 'auto', marginRight: '4px' }}>
                            {testCases.filter(t => t.folderId === folder.id).length}
                          </span>
                        </div>
                        <div className="folder-actions" style={{ display: 'flex', gap: '0.2rem', flexShrink: 0 }}>
                          <button onClick={(e) => { e.stopPropagation(); handleCreateFolder(folder.id); setExpandedFolders(prev => ({...prev, [folder.id]: true})); }} title="Nueva Subcarpeta" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--jira-subtle, #626F86)' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleUpdateFolder(folder.id, folder.name); }} title="Editar" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--jira-subtle, #626F86)' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                          </button>
                          {isAdmin && (
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id, folder.name); }} title="Eliminar" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--danger-color)' }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
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
        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', marginTop: 'auto' }}>
          <button className="btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.82rem', padding: '0.45rem' }} onClick={handleCreateFolder}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>+ New Folder</span>
          </button>
        </div>
      </aside>
      <div 
        onMouseDown={() => setIsResizing(true)}
        style={{
          width: '5px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? 'var(--jira-blue, #0C66E4)' : 'transparent',
          zIndex: 10,
          borderRight: '1px solid var(--jira-border, #DCDFE4)',
          marginLeft: '-1px'
        }}
      />
      <main className="main-content" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
        <div className="header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--jira-text, #172B4D)' }}>
                Design: Folders &amp; Test Cases
              </h1>
              <span className="ads-lozenge ads-lozenge-subtle">
                ({testCases.length} casos)
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--jira-subtle, #626F86)' }}>
              Explora, edita y organiza casos automatizados vinculados a la suite de regresión POS.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="btn-primary" onClick={handleCreateIssue} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>+ Create Test Case</span>
            </button>
            <button
              className="btn-secondary"
              onClick={() => { setShowBulkUpload(v => !v); resetBulkUpload(); }}
              title="Importar desde archivo CSV"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 16 12 12 8 16"></polyline>
                <line x1="12" y1="12" x2="12" y2="21"></line>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path>
              </svg>
              <span>Carga Masiva CSV</span>
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

        {/* Design Filter & Sort Toolbar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.6rem 0.85rem',
          backgroundColor: '#FFFFFF',
          borderRadius: '8px',
          border: '1px solid var(--jira-border, #DCDFE4)',
          marginBottom: '0.85rem',
          gap: '0.75rem',
          flexWrap: 'wrap'
        }}>
          {/* Master Checkbox & Count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', margin: 0, fontSize: '0.82rem', fontWeight: 600, color: 'var(--jira-text, #172B4D)' }}>
              <input
                type="checkbox"
                checked={filteredTestCases.length > 0 && filteredTestCases.every(t => selectedDesignTestIds.has(t.id))}
                onChange={(e) => {
                  const next = new Set(selectedDesignTestIds);
                  if (e.target.checked) {
                    filteredTestCases.forEach(t => next.add(t.id));
                  } else {
                    filteredTestCases.forEach(t => next.delete(t.id));
                  }
                  setSelectedDesignTestIds(next);
                }}
                style={{ width: '15px', height: '15px', accentColor: 'var(--jira-blue, #0C66E4)', cursor: 'pointer' }}
              />
              <span>Seleccionar página</span>
            </label>
            {selectedDesignTestIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="ads-lozenge ads-lozenge-brand" style={{ borderRadius: '9999px', fontSize: '11px', background: '#E1007A', color: '#FFFFFF', border: 'none' }}>
                  {selectedDesignTestIds.size} seleccionados
                </span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value !== '') {
                      const fId = e.target.value === '__ROOT__' ? null : e.target.value;
                      const fName = fId ? (folders.find(f => f.id === fId)?.name || 'Carpeta') : 'Raíz (All Tests)';
                      handleBatchLinkTestsToFolder(Array.from(selectedDesignTestIds), fId, fName);
                      setSelectedDesignTestIds(new Set());
                      e.target.value = '';
                    }
                  }}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid #E1007A',
                    background: '#FDF2F7',
                    color: '#E1007A',
                    fontWeight: 600,
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                  title="Mover todos los casos seleccionados a una carpeta"
                >
                  <option value="" disabled>📁 Mover a carpeta...</option>
                  <option value="__ROOT__">📁 Raíz (Sin carpeta / All Tests)</option>
                  {folderPaths.map(f => <option key={f.id} value={f.id}>📁 {f.path}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setSelectedDesignTestIds(new Set())}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--jira-subtle, #626F86)',
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: '2px 4px'
                  }}
                >
                  Limpiar selección
                </button>
              </div>
            )}
          </div>

          {/* Type Filter Buttons & Sort Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
            {/* Type Filter Segmented Control */}
            <div style={{ display: 'flex', backgroundColor: 'var(--jira-bg-subtle, #F1F2F4)', padding: '2px', borderRadius: '6px', gap: '2px' }}>
              <button
                type="button"
                onClick={() => { setDesignTypeFilter('all'); setCurrentPage(1); }}
                style={{
                  border: 'none',
                  background: designTypeFilter === 'all' ? '#FFFFFF' : 'transparent',
                  color: designTypeFilter === 'all' ? 'var(--jira-blue, #0C66E4)' : 'var(--jira-subtle, #626F86)',
                  fontWeight: designTypeFilter === 'all' ? 700 : 500,
                  fontSize: '0.75rem',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  boxShadow: designTypeFilter === 'all' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                Todos ({testCases.length})
              </button>
              <button
                type="button"
                onClick={() => { setDesignTypeFilter('automated'); setCurrentPage(1); }}
                style={{
                  border: 'none',
                  background: designTypeFilter === 'automated' ? '#FFFFFF' : 'transparent',
                  color: designTypeFilter === 'automated' ? 'var(--jira-blue, #0C66E4)' : 'var(--jira-subtle, #626F86)',
                  fontWeight: designTypeFilter === 'automated' ? 700 : 500,
                  fontSize: '0.75rem',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  boxShadow: designTypeFilter === 'automated' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                ⚡ Auto ({testCases.filter(t => t.labels?.includes('automated') || t.labels?.includes('automation') || t.labels?.includes('qa-auto')).length})
              </button>
              <button
                type="button"
                onClick={() => { setDesignTypeFilter('manual'); setCurrentPage(1); }}
                style={{
                  border: 'none',
                  background: designTypeFilter === 'manual' ? '#FFFFFF' : 'transparent',
                  color: designTypeFilter === 'manual' ? 'var(--jira-blue, #0C66E4)' : 'var(--jira-subtle, #626F86)',
                  fontWeight: designTypeFilter === 'manual' ? 700 : 500,
                  fontSize: '0.75rem',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  boxShadow: designTypeFilter === 'manual' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                Manual ({testCases.filter(t => !(t.labels?.includes('automated') || t.labels?.includes('automation') || t.labels?.includes('qa-auto'))).length})
              </button>
            </div>

            {/* Sort Dropdown */}
            <select
              value={designSortBy}
              onChange={(e) => setDesignSortBy(e.target.value)}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid var(--jira-border, #DCDFE4)',
                background: '#FFFFFF',
                color: 'var(--jira-navy, #091E42)',
                fontSize: '0.75rem',
                fontWeight: 500,
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="recent">Ordenar: ID Reciente (Descendente)</option>
              <option value="az">Ordenar: Nombre (A-Z)</option>
            </select>
          </div>
        </div>

        {/* Dragging Active Banner Feedback */}
        {draggedDesignTestIds && draggedDesignTestIds.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.6rem',
            padding: '0.5rem 0.85rem',
            backgroundColor: '#FDF2F7',
            border: '1.5px dashed #E1007A',
            borderRadius: '8px',
            color: '#E1007A',
            fontSize: '0.82rem',
            fontWeight: 600,
            marginBottom: '0.85rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Arrastrando <strong>{draggedDesignTestIds.length}</strong> caso(s) de prueba. Suelta sobre una carpeta en el panel izquierdo para moverlo(s).</span>
            </div>
            <span className="ads-lozenge ads-lozenge-brand" style={{ background: '#E1007A', color: '#FFFFFF', border: 'none', borderRadius: '9999px', fontSize: '11px', padding: '1px 8px' }}>
              Mover activo
            </span>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', color: 'var(--jira-subtle, #626F86)', gap: '0.75rem' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--jira-blue, #0C66E4)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
              <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
              <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
            </svg>
            <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Cargando suite de pruebas...</span>
          </div>
        ) : (
          <div className="test-list-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="test-list" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {filteredTestCases.map(test => {
                const isSelected = selectedDesignTestIds.has(test.id);
                const isAuto = isAutomatedTest(test);
                const rawStatus = (test.status || test.rawFields?.status?.name || 'Por hacer').trim();
                const upperStatus = rawStatus.toUpperCase();

                let statusBadgeClass = 'ads-lozenge-subtle';
                if (upperStatus.includes('FINALIZAD') || upperStatus.includes('DONE') || upperStatus.includes('LISTO') || upperStatus.includes('CLOSED') || upperStatus.includes('RESOLV') || upperStatus.includes('PASS') || upperStatus.includes('EXITO')) {
                  statusBadgeClass = 'ads-lozenge-success';
                } else if (upperStatus.includes('PROG') || upperStatus.includes('CURSO') || upperStatus.includes('EJEC') || upperStatus.includes('TESTING')) {
                  statusBadgeClass = 'ads-lozenge-brand';
                } else if (upperStatus.includes('BLOQ') || upperStatus.includes('BLOCK') || upperStatus.includes('IMPED')) {
                  statusBadgeClass = 'ads-lozenge-warning';
                } else if (upperStatus.includes('FALL') || upperStatus.includes('FAIL') || upperStatus.includes('RECHAZ')) {
                  statusBadgeClass = 'ads-lozenge-danger';
                }

                return (
                  <div 
                    key={test.id} 
                    className={`modern-test-card ${isSelected ? 'selected' : ''} ${draggedDesignTestIds?.includes(test.id) ? 'dragging' : ''}`}
                    draggable={true}
                    onDragStart={(e) => {
                      let ids = [test.id];
                      if (selectedDesignTestIds.has(test.id) && selectedDesignTestIds.size > 1) {
                        ids = Array.from(selectedDesignTestIds);
                      }
                      setDraggedDesignTestIds(ids);
                      const payload = JSON.stringify({ type: 'TEST_CASES', testIds: ids });
                      try {
                        e.dataTransfer.setData('text/plain', payload);
                        e.dataTransfer.setData('application/json', payload);
                      } catch (err) {
                        try { e.dataTransfer.setData('text', payload); } catch (e2) {}
                      }
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      window.__justFinishedDrag = Date.now();
                      setDraggedDesignTestIds(null);
                      setDragOverFolderId(null);
                    }}
                    onClick={() => { 
                      if (window.__justFinishedDrag && Date.now() - window.__justFinishedDrag < 350) {
                        return;
                      }
                      setSelectedTestCase(test); 
                      setModalDetailTab('details'); 
                      loadTestCaseDetails(test.id); 
                    }}
                    style={{ cursor: 'grab' }}
                  >
                    {/* Drag Grip Handle */}
                    <div 
                      className="drag-grip" 
                      title="Arrastrar para mover a una carpeta"
                      onClick={e => e.stopPropagation()}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="9" cy="5" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" />
                        <circle cx="9" cy="19" r="1.5" />
                        <circle cx="15" cy="5" r="1.5" />
                        <circle cx="15" cy="12" r="1.5" />
                        <circle cx="15" cy="19" r="1.5" />
                      </svg>
                    </div>

                    {/* Checkbox */}
                    <div style={{ display: 'flex', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                      <input 
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          const next = new Set(selectedDesignTestIds);
                          if (e.target.checked) next.add(test.id);
                          else next.delete(test.id);
                          setSelectedDesignTestIds(next);
                        }}
                        style={{ width: '15px', height: '15px', accentColor: 'var(--jira-blue, #0C66E4)', cursor: 'pointer' }}
                      />
                    </div>

                    {/* Test Key */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '95px' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--jira-blue, #0C66E4)', fontFamily: 'monospace' }}>
                        {test.key}
                      </span>
                    </div>

                    {/* Test Summary & Auto Tag */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0, paddingRight: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {isAuto && (
                          <span className="ads-lozenge ads-lozenge-purple" style={{ fontSize: '10px', padding: '1px 6px', fontWeight: 700, borderRadius: '4px', flexShrink: 0 }} title="Caso automatizado">
                            ⚡ Auto
                          </span>
                        )}
                        <span 
                          style={{
                            fontWeight: 600,
                            fontSize: '0.85rem',
                            color: 'var(--jira-text, #172B4D)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }} 
                          title={test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}
                        >
                          {test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}
                        </span>
                      </div>
                    </div>

                    {/* Original Jira Status Lozenge */}
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                      <span className={`ads-lozenge ${statusBadgeClass}`} style={{ fontSize: '10px', textTransform: 'uppercase', minWidth: '70px', textAlign: 'center' }}>
                        {upperStatus}
                      </span>
                    </div>

                    {/* Folder Assignment Select */}
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                      <select 
                        value={test.folderId || ''} 
                        onChange={(e) => handleLinkTestToFolder(test.id, e.target.value)}
                        style={{
                          padding: '0.2rem 0.4rem',
                          borderRadius: '4px',
                          border: '1px solid var(--jira-border, #DCDFE4)',
                          background: 'var(--jira-bg-subtle, #F1F2F4)',
                          color: 'var(--jira-text, #172B4D)',
                          fontSize: '0.74rem',
                          maxWidth: '180px',
                          cursor: 'pointer',
                          outline: 'none'
                        }}
                        title="Asignar a carpeta"
                      >
                        <option value="">📁 Sin Carpeta (Raíz)</option>
                        {folderPaths.map(f => <option key={f.id} value={f.id}>📁 {f.path}</option>)}
                      </select>
                    </div>

                    {/* Detail Chevron */}
                    <div style={{ color: 'var(--jira-subtle, #626F86)', display: 'flex', alignItems: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </div>
                  </div>
                );
              })}

              {filteredTestCases.length === 0 && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '3rem 1.5rem',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '8px',
                  border: '1px dashed var(--jira-border, #DCDFE4)',
                  textAlign: 'center',
                  color: 'var(--jira-subtle, #626F86)'
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8590A2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '0.5rem' }}>
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <p style={{ margin: 0, fontWeight: 600, color: 'var(--jira-text, #172B4D)' }}>No se encontraron casos de prueba</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem' }}>Intenta ajustar tus filtros de búsqueda o carpeta seleccionada.</p>
                </div>
              )}
            </div>

            {/* Floating Batch Actions Bar */}
            {selectedDesignTestIds.size > 0 && (
              <div className="batch-floating-bar" style={{
                position: 'sticky',
                bottom: '10px',
                margin: '10px auto 0 auto',
                maxWidth: '650px',
                width: '100%',
                backgroundColor: 'var(--jira-navy, #091E42)',
                color: '#FFFFFF',
                borderRadius: '8px',
                padding: '0.6rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 14px rgba(9, 30, 66, 0.35)',
                zIndex: 40,
                gap: '1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="ads-lozenge ads-lozenge-brand" style={{ background: '#0C66E4', color: '#FFFFFF', border: 'none', borderRadius: '9999px', fontSize: '11px', padding: '2px 8px' }}>
                    {selectedDesignTestIds.size} seleccionados
                  </span>
                  <span style={{ fontSize: '0.8rem', color: '#B3B9C4' }}>Acciones en lote disponibles</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <select
                    onChange={(e) => {
                      if (e.target.value !== undefined) {
                        const targetFolder = e.target.value;
                        selectedDesignTestIds.forEach(testId => {
                          handleLinkTestToFolder(testId, targetFolder);
                        });
                        setSelectedDesignTestIds(new Set());
                      }
                    }}
                    defaultValue=""
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.35rem 0.6rem',
                      borderRadius: '4px',
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(255,255,255,0.1)',
                      color: '#FFFFFF',
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                  >
                    <option value="" disabled style={{ color: '#000' }}>Mover a carpeta...</option>
                    <option value="" style={{ color: '#000' }}>📁 Sin Carpeta (Raíz)</option>
                    {folderPaths.map(f => <option key={f.id} value={f.id} style={{ color: '#000' }}>📁 {f.path}</option>)}
                  </select>
                  <button
                    onClick={() => setSelectedDesignTestIds(new Set())}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#B3B9C4',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      padding: '0.3rem 0.5rem',
                      textDecoration: 'underline'
                    }}
                  >
                    Desmarcar
                  </button>
                </div>
              </div>
            )}

            {/* Design Tab Footer: Automation Health & Pagination */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.85rem 0.5rem 0.25rem 0.5rem',
              borderTop: '1px solid var(--jira-border, #DCDFE4)',
              marginTop: 'auto',
              flexWrap: 'wrap',
              gap: '0.75rem'
            }}>
              {/* Automation Health Metric */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--jira-subtle, #626F86)' }}>
                  Salud de Automatización:
                </span>
                <span className="ads-lozenge ads-lozenge-purple" style={{ fontSize: '11px', fontWeight: 700 }}>
                  ⚡ {testCases.length > 0 ? Math.round((testCases.filter(isAutomatedTest).length / testCases.length) * 100) : 0}% ({testCases.filter(isAutomatedTest).length} / {testCases.length})
                </span>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button 
                    className="btn-secondary" 
                    disabled={currentPage === 1} 
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                  >
                    Anterior
                  </button>
                  <span style={{ fontSize: '0.8rem', color: 'var(--jira-subtle, #626F86)', fontWeight: 500 }}>
                    Página {currentPage} de {totalPages} ({filteredTestCasesAll.length} items)
                  </span>
                  <button 
                    className="btn-secondary" 
                    disabled={currentPage === totalPages} 
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </div>
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

    const isAuto = isAutomatedTest(selectedTestCase);
    const rawStatus = (selectedTestCase.status || selectedTestCase.rawFields?.status?.name || 'Por hacer').trim();
    const upperStatus = rawStatus.toUpperCase();

    let statusBadgeClass = 'ads-lozenge-subtle';
    if (upperStatus.includes('FINALIZAD') || upperStatus.includes('DONE') || upperStatus.includes('LISTO') || upperStatus.includes('CLOSED') || upperStatus.includes('RESOLV') || upperStatus.includes('PASS') || upperStatus.includes('EXITO')) {
      statusBadgeClass = 'ads-lozenge-success';
    } else if (upperStatus.includes('PROG') || upperStatus.includes('CURSO') || upperStatus.includes('EJEC') || upperStatus.includes('TESTING')) {
      statusBadgeClass = 'ads-lozenge-brand';
    } else if (upperStatus.includes('BLOQ') || upperStatus.includes('BLOCK') || upperStatus.includes('IMPED')) {
      statusBadgeClass = 'ads-lozenge-warning';
    } else if (upperStatus.includes('FALL') || upperStatus.includes('FAIL') || upperStatus.includes('RECHAZ')) {
      statusBadgeClass = 'ads-lozenge-danger';
    }

    const currentFolder = folderPaths.find(f => f.id === selectedTestCase.folderId);
    const folderPathStr = currentFolder ? currentFolder.path : 'Raíz (Sin Carpeta)';

    const priority = selectedTestCase.rawFields?.priority;
    const reporter = selectedTestCase.rawFields?.reporter || selectedTestCase.rawFields?.creator;
    const creatorName = reporter ? (reporter.displayName || reporter.name) : 'Sin especificar';
    const creatorEmail = reporter?.emailAddress || '';
    const creatorAvatar = reporter?.avatarUrls?.['24x24'] || reporter?.avatarUrls?.['32x32'] || null;

    const extractFieldValue = (val) => {
      if (!val) return null;
      if (typeof val === 'string') return val;
      if (Array.isArray(val)) {
        return val.map(v => (typeof v === 'object' && v !== null ? v.value || v.name || '' : String(v))).filter(Boolean).join(', ');
      }
      if (typeof val === 'object') {
        return val.value || val.name || val.displayName || null;
      }
      return String(val);
    };

    const testLevel = extractFieldValue(
      selectedTestCase.rawFields?.['customfield_10530'] || 
      (projectConfig?.testLevelFieldId && selectedTestCase.rawFields?.[projectConfig.testLevelFieldId]) ||
      selectedTestCase.testLevel
    ) || 'No especificado';

    const testType = extractFieldValue(
      selectedTestCase.rawFields?.['customfield_10535'] || 
      (projectConfig?.testTypeFieldId && selectedTestCase.rawFields?.[projectConfig.testTypeFieldId]) ||
      selectedTestCase.testType
    ) || 'Funcional';

    return (
      <div 
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(9, 30, 66, 0.54)',
          backdropFilter: 'blur(2px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem'
        }}
        onClick={() => { setSelectedTestCase(null); setTestCaseDetails({ type: 'traditional', content: [] }); setTestCaseHistory([]); }}
      >
        <div 
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '8px',
            boxShadow: '0 20px 32px rgba(9, 30, 66, 0.25), 0 0 1px rgba(9, 30, 66, 0.31)',
            width: '100%',
            maxWidth: '960px',
            height: '82vh',
            minHeight: '580px',
            maxHeight: '740px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid #DCDFE4',
            color: '#172B4D'
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div style={{ padding: '1.25rem 1.5rem 0.75rem 1.5rem', borderBottom: '1px solid #DCDFE4', backgroundColor: '#FFFFFF', flexShrink: 0 }}>
            {/* Top Meta Line: Folder Path, Issue Key, Lozenges, Close button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
                {/* Folder Path Breadcrumb */}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: '#626F86', backgroundColor: '#F1F2F4', padding: '2px 8px', borderRadius: '3px' }}>
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="#FFAB00"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                  <span>{folderPathStr}</span>
                </span>
                <span style={{ color: '#DCDFE4' }}>/</span>
                
                {/* Issue Key link */}
                <span 
                  onClick={() => router.open('/browse/' + selectedTestCase.key)}
                  style={{ fontWeight: 700, fontSize: '0.82rem', color: '#0C66E4', cursor: 'pointer', fontFamily: 'monospace', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  title="Abrir Caso de Prueba en Jira"
                >
                  {selectedTestCase.key}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                </span>

                {/* Jira Status Lozenge */}
                <span className={`ads-lozenge ${statusBadgeClass}`} style={{ fontSize: '10px' }}>
                  {upperStatus}
                </span>

                {/* Auto badge */}
                {isAuto && (
                  <span className="ads-lozenge ads-lozenge-purple" style={{ fontSize: '10px', padding: '1px 6px', fontWeight: 700, borderRadius: '4px' }}>
                    ⚡ Auto
                  </span>
                )}
              </div>

              {/* Close Button */}
              <button 
                onClick={() => { setSelectedTestCase(null); setTestCaseDetails({ type: 'traditional', content: [] }); setTestCaseHistory([]); }}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.25rem',
                  lineHeight: '1',
                  color: '#626F86',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Cerrar (Esc)"
              >
                &times;
              </button>
            </div>

            {/* Test Case Title (Summary) */}
            <div style={{ marginTop: '0.5rem', marginBottom: '0.75rem' }}>
              <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
                Título del Caso de Prueba
              </span>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#172B4D', margin: 0, lineHeight: 1.35 }}>
                {selectedTestCase.summary}
              </h2>
            </div>

            {/* Sub-tabs Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginTop: '0.75rem', fontSize: '0.82rem', borderBottom: '1px solid #DCDFE4' }}>
              <button 
                onClick={() => setModalDetailTab('details')}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: modalDetailTab === 'details' ? '2px solid #0C66E4' : '2px solid transparent',
                  padding: '6px 2px 10px 2px',
                  fontWeight: modalDetailTab === 'details' ? 700 : 500,
                  color: modalDetailTab === 'details' ? '#0C66E4' : '#626F86',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '-1px',
                  transition: 'color 0.15s'
                }}
              >
                <span>Detalles y Metadatos</span>
              </button>

              <button 
                onClick={() => setModalDetailTab('history')}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: modalDetailTab === 'history' ? '2px solid #0C66E4' : '2px solid transparent',
                  padding: '6px 2px 10px 2px',
                  fontWeight: modalDetailTab === 'history' ? 700 : 500,
                  color: modalDetailTab === 'history' ? '#0C66E4' : '#626F86',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '-1px',
                  transition: 'color 0.15s'
                }}
              >
                <span>Historial de Ejecuciones</span>
                {testCaseHistory.length > 0 && (
                  <span style={{ fontSize: '10px', fontWeight: 700, background: '#F1F2F4', color: '#44546F', padding: '1px 6px', borderRadius: '10px' }}>
                    {testCaseHistory.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Modal Body */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '1.25rem 1.5rem', backgroundColor: '#FAFBFC', display: 'flex', flexDirection: 'column' }}>
            {modalDetailTab === 'details' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 290px', gap: '1.25rem', height: '100%', minHeight: 0, alignItems: 'stretch' }}>
                {/* Left Column (65%): Scenario Description */}
                <div style={{ backgroundColor: '#FFFFFF', borderRadius: '6px', border: '1px solid #DCDFE4', padding: '1.25rem', boxShadow: '0 1px 2px rgba(9,30,66,0.04)', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid #F1F2F4', flexShrink: 0 }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#172B4D', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Descripción del Escenario
                    </span>
                    <button 
                      onClick={() => router.open('/browse/' + selectedTestCase.key)}
                      style={{ background: 'none', border: 'none', color: '#0C66E4', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                      title="Editar en Jira"
                    >
                      Editar en Jira ↗
                    </button>
                  </div>

                  {/* Scrollable content container for Description */}
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '6px' }}>
                    {loadingDescription ? (
                      <div style={{ padding: '3rem', textAlign: 'center', color: '#626F86' }}>
                        <div className="spinner" style={{ margin: '0 auto 1rem auto', width: '28px', height: '28px', border: '3px solid #DCDFE4', borderTop: '3px solid #0C66E4', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                        <span>Cargando descripción desde Jira...</span>
                      </div>
                    ) : selectedTestCaseDescription ? (
                      <div 
                        className="description-content"
                        style={{ fontSize: '0.85rem', lineHeight: '1.6', color: '#172B4D' }}
                        dangerouslySetInnerHTML={{ __html: adfToHtml(selectedTestCaseDescription) }} 
                      />
                    ) : (
                      <div style={{ padding: '2rem', textAlign: 'center', color: '#626F86', backgroundColor: '#F7F8F9', borderRadius: '4px', border: '1px dashed #DCDFE4' }}>
                        <p style={{ margin: 0, fontStyle: 'italic', fontSize: '0.82rem' }}>Este caso de prueba no contiene descripción en Jira.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column (35%): Properties Sidebar (Fixed & Pinned) */}
                <div style={{ backgroundColor: '#FFFFFF', borderRadius: '6px', border: '1px solid #DCDFE4', padding: '1.25rem', boxShadow: '0 1px 2px rgba(9,30,66,0.04)', display: 'flex', flexDirection: 'column', gap: '0.9rem', height: '100%', minHeight: 0, overflowY: 'auto' }}>
                  <h3 style={{ fontSize: '11px', fontWeight: 700, color: '#172B4D', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0, paddingBottom: '0.5rem', borderBottom: '1px solid #F1F2F4', flexShrink: 0 }}>
                    Propiedades del Caso
                  </h3>

                  {/* Suite / Folder Selector */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '4px' }}>
                      Suite / Carpeta
                    </label>
                    <select 
                      style={{ width: '100%', fontSize: '0.8rem', padding: '6px 8px', borderRadius: '4px', border: '1px solid #DCDFE4', backgroundColor: '#FFFFFF', color: '#172B4D', outline: 'none' }}
                      value={selectedTestCase.folderId || ''}
                      onChange={async (e) => {
                        const newFolderId = e.target.value || null;
                        setSelectedTestCase({ ...selectedTestCase, folderId: newFolderId });
                        await invoke('linkCaseToFolder', { caseId: selectedTestCase.id, folderId: newFolderId });
                        const fetchedTests = await fetchAllTestCases({ folderId: null, projectId: selectedProjectId, config: projectConfig });
                        setTestCases(fetchedTests || []);
                      }}
                    >
                      <option value="">Raíz (Sin Carpeta)</option>
                      {folderPaths.map(f => (
                        <option key={f.id} value={f.id}>{f.path}</option>
                      ))}
                    </select>
                  </div>

                  {/* Estado en Jira */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '4px' }}>
                      Estado en Jira
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`ads-lozenge ${statusBadgeClass}`} style={{ fontSize: '10px' }}>
                        {upperStatus}
                      </span>
                    </div>
                  </div>

                  {/* Prioridad */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '4px' }}>
                      Prioridad
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#172B4D', padding: '4px 8px', backgroundColor: '#F7F8F9', borderRadius: '4px', border: '1px solid #EBEDF0' }}>
                      {priority?.iconUrl ? (
                        <img src={priority.iconUrl} alt="" width="14" height="14" />
                      ) : (
                        <span style={{ color: '#0C66E4', fontWeight: 'bold' }}>•</span>
                      )}
                      <span style={{ fontWeight: 500 }}>{priority?.name || 'Media'}</span>
                    </div>
                  </div>

                  {/* Nivel de Prueba */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '4px' }}>
                      Nivel de Prueba
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px', padding: '2px 8px', fontWeight: 600, borderRadius: '4px' }}>
                        {testLevel}
                      </span>
                    </div>
                  </div>

                  {/* Tipo de Prueba */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '4px' }}>
                      Tipo de Prueba
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px', padding: '2px 8px', fontWeight: 600, borderRadius: '4px' }}>
                        {testType}
                      </span>
                    </div>
                  </div>

                  {/* Tipo de Ejecución */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '4px' }}>
                      Tipo de Ejecución
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isAuto ? (
                        <span className="ads-lozenge ads-lozenge-purple" style={{ fontSize: '10px', padding: '1px 6px', fontWeight: 700, borderRadius: '4px' }}>
                          ⚡ Auto
                        </span>
                      ) : (
                        <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px', padding: '1px 6px', fontWeight: 600, borderRadius: '4px' }}>
                          Manual
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Creador / Autor */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '4px' }}>
                      Creador / Autor
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '4px', border: '1px solid #EBEDF0', backgroundColor: '#F7F8F9' }}>
                      {creatorAvatar ? (
                        <img src={creatorAvatar} alt="" style={{ width: '22px', height: '22px', borderRadius: '50%' }} />
                      ) : (
                        <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#5E4DB2', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>
                          {creatorName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#172B4D', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {creatorName}
                        </span>
                        {creatorEmail && (
                          <span style={{ fontSize: '10px', color: '#626F86', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {creatorEmail}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Tab 2: Execution History */
              <div style={{ backgroundColor: '#FFFFFF', borderRadius: '6px', border: '1px solid #DCDFE4', padding: '1.25rem', boxShadow: '0 1px 2px rgba(9,30,66,0.04)', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid #F1F2F4', flexShrink: 0 }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#172B4D', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Historial de Ejecuciones ({testCaseHistory.length})
                  </span>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  {testCaseDetailsLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: '#626F86' }}>
                      <div className="spinner" style={{ margin: '0 auto 1rem auto', width: '24px', height: '24px', border: '3px solid #DCDFE4', borderTop: '3px solid #0C66E4', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                      Cargando historial de ejecuciones...
                    </div>
                  ) : testCaseHistory.length > 0 ? (
                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Ciclo / Plan</th>
                            <th>Estatus</th>
                            <th>Ejecutado por</th>
                            <th>Detalles / Iteraciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {testCaseHistory.map((h, idx) => {
                            const execName = typeof h.executedBy === 'object' ? (h.executedBy?.displayName || 'Asignado') : (h.executedBy ? String(h.executedBy) : 'Sin asignar');
                            const statusVal = h.status || 'Not Run';
                            return (
                              <tr key={h.cycleId || h.testRunKey || idx}>
                                <td>
                                  <strong style={{ color: '#0C66E4' }}>{h.cycleKey || h.testRunKey}</strong>
                                  {h.cycleSummary && <div style={{ fontSize: '0.78rem', color: '#626F86', marginTop: '2px' }}>{h.cycleSummary}</div>}
                                </td>
                                <td>
                                  <span 
                                    className="status-badge" 
                                    style={{
                                      background: getStatusColor(statusVal), 
                                      color: getStatusTextColor(statusVal),
                                      display: 'inline-block',
                                      padding: '0.2rem 0.5rem',
                                      borderRadius: '4px',
                                      fontWeight: 600,
                                      fontSize: '0.75rem'
                                    }}
                                  >
                                    {statusVal}
                                  </span>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#0C66E4', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>
                                      {execName.charAt(0).toUpperCase()}
                                    </div>
                                    <span style={{ fontSize: '0.82rem' }}>{execName}</span>
                                  </div>
                                </td>
                                <td style={{ fontSize: '0.82rem' }}>
                                  {h.iterations && h.iterations.length > 0 ? (
                                    <div>
                                      <strong>{h.iterations.length} {h.iterations.length === 1 ? 'iteración' : 'iteraciones'}</strong>
                                      <div style={{ fontSize: '0.72rem', color: '#626F86' }}>
                                        {h.iterations.filter(i => i.status === 'Passed' || i.status === 'Pass').length} Pass / {h.iterations.filter(i => i.status === 'Failed' || i.status === 'Fail').length} Fail
                                      </div>
                                    </div>
                                  ) : h.comment ? (
                                    <span style={{ color: '#626F86', fontStyle: 'italic' }}>{h.comment}</span>
                                  ) : (
                                    <span style={{ color: '#626F86' }}>-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ padding: '3rem 2rem', textAlign: 'center', color: '#626F86', backgroundColor: '#F7F8F9', borderRadius: '4px', border: '1px dashed #DCDFE4' }}>
                      <p style={{ margin: 0, fontStyle: 'italic', fontSize: '0.85rem' }}>Este caso de prueba aún no ha sido ejecutado en ningún ciclo.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid #DCDFE4', backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', color: '#626F86' }}>
              Test Pulse QA Engine • {selectedTestCase.key}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button 
                className="btn-secondary"
                onClick={() => { setSelectedTestCase(null); setTestCaseDetails({ type: 'traditional', content: [] }); setTestCaseHistory([]); }}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.8rem' }}
              >
                Cerrar
              </button>
              <button 
                className="btn-primary"
                onClick={() => router.open('/browse/' + selectedTestCase.key)}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <span>Abrir en Jira</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
              </button>
            </div>
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
    const cycleId = selectedCycle.id;
    const idStr = String(testCase.id);

    // Clear deleted tracking so re-added test is rendered immediately
    deletedIdsRef.current.delete(idStr);
    if (perCycleDeletedRef.current[cycleId]) {
      perCycleDeletedRef.current[cycleId].delete(idStr);
    }
    
    // Optimistic UI
    const locallyAdded = {
        id: testCase.id,
        key: testCase.key,
        summary: testCase.summary,
        executionType: testCase.executionType || 'Manual',
        status: 'Not Run'
    };
    setCycleTests(prev => {
        if (!prev.some(existing => String(existing.id) === idStr)) {
            return [...prev, locallyAdded];
        }
        return prev;
    });
    
    try {
        const addRes = await invoke('addTestToCycle', { 
          cycleId: selectedCycle.id,
          cycleKey: selectedCycle.key || selectedCycle.id,
          projectId: selectedProjectId,
          config: projectConfig,
          testCase 
        });
        if (addRes && addRes.addedTest) {
            setCycleTests(prev => prev.map(t => String(t.id) === idStr ? { ...t, ...addRes.addedTest } : t));
            if (addRes.addedTest.isRecovered) {
              addNotification({
                type: 'success',
                title: 'Caso restaurado',
                description: `El caso ${testCase.key || testCase.id} fue re-incorporado al ciclo con su ejecución previa restaurada (${addRes.addedTest.status || 'Not Run'}).`
              });
            }
        }
        // Reload immediately if no testRunId (run was just created), else after short delay
        const hasRunId = addRes?.addedTest?.testRunId || addRes?.addedTest?.testRunKey;
        const reloadDelay = hasRunId ? 2500 : 500;
        setTimeout(async () => {
            const execution = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
            if (execution) {
                safeSetCycleTests(execution);
            }
        }, reloadDelay);
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

  const handleBatchLinkTestsToFolder = async (testIds, folderId, folderName) => {
    if (!testIds || testIds.length === 0 || !selectedProjectId) return;
    const targetFolderId = (folderId === '' || folderId === '__ROOT__') ? null : folderId;
    const idsArray = Array.from(testIds);

    // Optimistic UI update
    setTestCases(prev => prev.map(t => idsArray.includes(t.id) ? { ...t, folderId: targetFolderId } : t));

    try {
      await Promise.all(idsArray.map(id => invoke('linkTestToFolder', { testId: id, folderId: targetFolderId })));
      addNotification({
        type: 'success',
        title: '📁 Casos reubicados',
        description: `Se ${idsArray.length === 1 ? 'movió 1 caso' : `movieron ${idsArray.length} casos`} a ${folderName || (targetFolderId ? 'la carpeta' : 'All Tests (Sin carpeta)')}.`
      });
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Error al mover casos',
        description: err.message || String(err)
      });
    }
  };

  const handleUpdateTestStatus = async (testId, status, comment) => {
    if (!selectedCycle) return;
    const test = cycleTests.find(t => String(t.id) === String(testId));

    // Guard: if trying to reset a locked execution to "Not Run", show confirm first
    if (status === 'Not Run' && test?.lockedAt) {
      showConfirm(
        'Resetear ejecución completada',
        `Este caso ya fue ejecutado y marcado como "${test.status}". ¿Estás seguro que deseas resetear su estatus a "Not Run"? Esto limpiará la ejecución.`,
        async () => {
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          try {
            await invoke('updateTestStatus', {
              cycleId: selectedCycle.id,
              testId,
              testRunId: test?.testRunId || test?.testRunKey,
              status: 'Not Run',
              comment
            });
            setCycleTests(prev => prev.map(t => String(t.id) === String(testId)
              ? { ...t, status: 'Not Run', lockedAt: null } : t));
          } catch (e) {
            const msg = e.message || String(e);
            addNotification({ type: 'error', title: 'Error al resetear', description: msg });
          }
        },
        { danger: true, confirmLabel: 'Resetear' }
      );
      return;
    }

    try {
      const res = await invoke('updateTestStatus', {
        cycleId: selectedCycle.id,
        testId,
        testRunId: test?.testRunId || test?.testRunKey,
        status,
        comment
      });
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

  const calculateOverallStatus = (iterations, fallbackStatus = 'Not Run') => {
    if (!iterations || iterations.length === 0) return fallbackStatus;
    const hasFailed = iterations.some(it => ['Failed', 'Fail'].includes(it.status));
    const hasBlocked = iterations.some(it => ['Blocked', 'Block'].includes(it.status));
    const allPassed = iterations.every(it => ['Passed', 'Pass'].includes(it.status));
    const allNotRun = iterations.every(it => !it.status || ['Not Run', 'UNEXECUTED', 'Not_Run', 'TODO'].includes(it.status));
    if (hasFailed) return 'Failed';
    if (hasBlocked) return 'Blocked';
    if (allPassed) return 'Passed';
    if (allNotRun) return 'Not Run';
    return 'In Progress';
  };
  const calculateIterationStatus = calculateOverallStatus;

  const handleAddIteration = async (testIdOrObj) => {
    if (!selectedCycle) return;
    const testId = (typeof testIdOrObj === 'object' && testIdOrObj?.id) ? testIdOrObj.id : testIdOrObj;
    const test = cycleTests.find(t => String(t.id) === String(testId)) || (typeof testIdOrObj === 'object' ? testIdOrObj : null);
    if (!test) return;

    const currentIterations = test.iterations || [];
    const newIteration = {
      id: generateUUID(),
      expectedData: '',
      actualResult: '',
      status: 'Not Run',
      executedBy: context?.accountId || null,
      executedAt: Date.now(),
      evidences: []
    };

    const newIterations = [...currentIterations, newIteration];
    const newStatus = calculateOverallStatus(newIterations);

    setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus } : t));

    try {
      const res = await invoke('updateTestStatus', {
        cycleId: selectedCycle.id,
        testId: test.id,
        testRunId: test.testRunId || test.testRunKey,
        iterations: newIterations,
        status: newStatus
      });
      // If backend created a new run (no testRunId before), update local state with the new IDs
      if (res?.test?.testRunId && !test.testRunId) {
        setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, testRunId: res.test.testRunId, testRunKey: res.test.testRunKey } : t));
      }
    } catch (e) {
      console.error('Error adding iteration:', e);
      addNotification({ type: 'error', title: 'Error al agregar iteración', description: e?.message || '' });
    }
  };

  const handleDeleteIteration = async (testIdOrObj, iterId) => {
    if (!selectedCycle) return;
    const testId = (typeof testIdOrObj === 'object' && testIdOrObj?.id) ? testIdOrObj.id : testIdOrObj;
    const test = cycleTests.find(t => String(t.id) === String(testId)) || (typeof testIdOrObj === 'object' ? testIdOrObj : null);
    if (!test) return;

    const newIterations = (test.iterations || []).filter(i => i.id !== iterId);
    const newStatus = calculateOverallStatus(newIterations);

    setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus } : t));

    try {
      await invoke('updateTestStatus', {
        cycleId: selectedCycle.id,
        testId: test.id,
        testRunId: test.testRunId || test.testRunKey,
        iterations: newIterations,
        status: newStatus
      });
    } catch (e) {
      console.error('Error deleting iteration:', e);
      addNotification({ type: 'error', title: 'Error al eliminar iteración' });
    }
  };

  const handleIterationChange = async (testIdOrObj, iterId, field, value) => {
    if (!selectedCycle) return;
    const testId = (typeof testIdOrObj === 'object' && testIdOrObj?.id) ? testIdOrObj.id : testIdOrObj;
    const test = cycleTests.find(t => String(t.id) === String(testId)) || (typeof testIdOrObj === 'object' ? testIdOrObj : null);
    if (!test) return;

    const newIterations = (test.iterations || []).map(i => {
      if (i.id === iterId) {
        return { ...i, [field]: value };
      }
      return i;
    });

    const newStatus = calculateOverallStatus(newIterations);

    setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus } : t));

    try {
      await invoke('updateTestStatus', {
        cycleId: selectedCycle.id,
        testId: test.id,
        testRunId: test.testRunId || test.testRunKey,
        iterations: newIterations,
        status: newStatus
      });
    } catch (e) {
      console.error('Error updating iteration:', e);
    }
  };

  const handleTakeover = async (testIdOrObj) => {
    if (!selectedCycle) return;
    const testId = (typeof testIdOrObj === 'object' && testIdOrObj?.id) ? testIdOrObj.id : testIdOrObj;
    const test = cycleTests.find(t => String(t.id) === String(testId)) || (typeof testIdOrObj === 'object' ? testIdOrObj : null);
    if (!test || !test.id) return;

    try {
      const updated = await invoke('updateTestStatus', {
        cycleId: selectedCycle.id,
        testId: test.id,
        testRunId: test.testRunId || test.testRunKey,
        takeover: true
      });
      if (updated) {
        setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, executedBy: updated.executedBy } : t));
        addNotification({ type: 'success', title: 'Ejecución tomada', description: 'Ahora eres el ejecutor asignado.' });
      }
    } catch (e) {
      console.warn("Takeover error:", e);
      addNotification({ type: 'error', title: 'Error al tomar ejecución', description: e.message || String(e) });
    }
  };

  const handleUploadEvidence = async (testId, testKey, file, iterId) => {
    let actualFile = file;
    let actualIterId = iterId;
    if (testKey instanceof File || (testKey && typeof testKey === 'object' && testKey.name)) {
      actualIterId = file;
      actualFile = testKey;
    }
    if (!actualFile) return;

    const testItem = cycleTests.find(t => String(t.id) === String(testId));
    const targetIssueKeyOrId = testItem?.testRunKey || testItem?.testRunId || (typeof testKey === 'string' ? testKey : null) || testItem?.key || testId;

    try {
      // Convert file to base64 for reliable Forge upload
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(actualFile);
      });

      const attachments = await invoke('uploadAttachment', {
        issueId: targetIssueKeyOrId,
        filename: actualFile.name,
        base64Data,
        mimeType: actualFile.type
      });

      if (attachments && attachments.length > 0) {
        const uploaded = attachments[0];
        const newEvidence = {
          id: uploaded.id,
          filename: uploaded.filename,
          url: uploaded.content
        };

        const currentEvidences = testItem?.evidences ? [...testItem.evidences] : [];
        if (testItem?.evidence && currentEvidences.length === 0) {
          currentEvidences.push(testItem.evidence);
        }
        currentEvidences.push(newEvidence);

        if (actualIterId) {
          const iters = [...(testItem?.iterations || [])];
          const iterIdx = iters.findIndex(i => i.id === actualIterId);
          if (iterIdx > -1) {
            iters[iterIdx] = {
              ...iters[iterIdx],
              evidences: iters[iterIdx].evidences ? [...iters[iterIdx].evidences, newEvidence] : [newEvidence]
            };
            setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: iters } : t));
            await invoke('updateTestStatus', {
              cycleId: selectedCycle.id,
              testId,
              testRunId: testItem?.testRunId || testItem?.testRunKey,
              iterations: iters
            });
          }
        } else {
          setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences } : t));
          await invoke('updateTestStatus', {
            cycleId: selectedCycle.id,
            testId,
            testRunId: testItem?.testRunId || testItem?.testRunKey,
            evidences: currentEvidences
          });
        }
        addNotification({ type: 'success', title: 'Evidencia adjuntada', description: newEvidence.filename });
      }
    } catch (err) {
      console.error("Failed to upload evidence", err);
      addNotification({ type: 'error', title: 'Error subiendo evidencia', description: err.message || String(err) });
    }
  };

  const handleDeleteEvidence = async (testId, attachmentId, index, iterId) => {
    const testItem = cycleTests.find(t => String(t.id) === String(testId));
    await invoke('deleteAttachment', { attachmentId });
    
    let currentTest = await invoke('getTestExecution', { cycleId: selectedCycle.id, testId });
    if (!currentTest) {
        currentTest = cycleTests.find(t => String(t.id) === String(testId));
    }
    if (!currentTest) return;
    
    if (iterId) {
       const iters = [...(currentTest.iterations || [])];
       const iterIdx = iters.findIndex(i => i.id === iterId);
       if (iterIdx > -1) {
          const evs = (iters[iterIdx].evidences || []).filter(e => e.id !== attachmentId && e !== attachmentId);
          iters[iterIdx] = { ...iters[iterIdx], evidences: evs };
          await invoke('updateTestStatus', {
            cycleId: selectedCycle.id,
            testId,
            testRunId: testItem?.testRunId || testItem?.testRunKey,
            iterations: iters
          });
          setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: iters } : t));
       }
       return;
    }

    let currentEvidences = currentTest.evidences ? [...currentTest.evidences] : [];
    if (currentTest.evidence && currentEvidences.length === 0) {
      currentEvidences.push(currentTest.evidence);
    }
    currentEvidences = currentEvidences.filter(e => e.id !== attachmentId && e !== attachmentId);
    await invoke('updateTestStatus', {
      cycleId: selectedCycle.id,
      testId,
      testRunId: testItem?.testRunId || testItem?.testRunKey,
      evidences: currentEvidences
    });
    setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences } : t));
  };

  
  const handleRenameEvidence = async (testId, index, newName, iterId) => {
    const currentTest = cycleTests.find(t => String(t.id) === String(testId));
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
          await invoke('updateTestStatus', {
            cycleId: selectedCycle.id,
            testId,
            testRunId: currentTest.testRunId || currentTest.testRunKey,
            iterations: iters
          });
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
    await invoke('updateTestStatus', {
      cycleId: selectedCycle.id,
      testId,
      testRunId: currentTest.testRunId || currentTest.testRunKey,
      evidences: currentEvidences
    });
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

  const handleRunTest = async (testId, testKey, test) => {
    try {
      if (test) {
        try {
          await handleTakeover(test);
        } catch (e) {
          console.warn("Takeover non-critical failure:", e);
        }
      }

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
      
      if (video.parentNode) {
        document.body.removeChild(video);
      }
      
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `evidence_${testKey || testId}_${Date.now()}.png`, { type: 'image/png' });
        setRunningTests(prev => ({ ...prev, [testId]: 'uploading' }));
        await handleUploadEvidence(testId, testKey, file);
        setRunningTests(prev => ({ ...prev, [testId]: 'active' }));
      }, 'image/png');

    } catch (err) {
      console.warn("Captura cancelada o no permitida", err);
      // Even if failed/cancelled, unlock the status if they want to fail it or manually upload
      setRunningTests(prev => ({ ...prev, [testId]: 'active' }));
    }
  };

  const handlePreviewEvidence = async (ev) => {
    const id = typeof ev === 'string' ? ev : ev.id;
    let filename = typeof ev === 'string' ? `evidence_${id}.jpg` : (ev.filename || `evidence_${id}.jpg`);
    
    // Si no tiene extensión (ej. porque el usuario lo renombró "Evidencia 1"), asumimos que es imagen/video
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(filename);
    const isImageOrVideo = filename.match(/\.(png|jpg|jpeg|gif|mp4|mov|webm)$/i);
    const isPdf = filename.match(/\.(pdf)$/i);

    if (isImageOrVideo || isPdf || !hasExtension) {
      if (!hasExtension) filename += '.png';
      
      if (isPdf) {
         // Open window synchronously to avoid popup blocker
         const newWin = window.open('about:blank', '_blank');
         if (newWin) {
             newWin.document.write('<p style="font-family:sans-serif;padding:20px;">Cargando PDF...</p>');
         }
         
         const data = await invoke('getAttachmentContent', { attachmentId: id });
         if (data && !data.error) {
            try {
              const byteCharacters = atob(data.base64);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: 'application/pdf' });
              const blobUrl = URL.createObjectURL(blob);
              
              if (newWin) {
                  newWin.location.href = blobUrl;
              } else {
                  // Fallback if popup blocker still blocked the synchronous open (e.g. strict settings)
                  const a = document.createElement('a');
                  a.href = blobUrl;
                  a.target = '_blank';
                  a.click();
              }
              return;
            } catch(e) { 
               console.error('Blob URL failed', e); 
               if (newWin) newWin.close();
            }
         }
         // Fallback if fetch fails
         if (newWin) newWin.close();
         router.open(`/secure/attachment/${id}/${encodeURIComponent(filename)}`);
         return;
      }
      
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
          
          filteredEnriched.sort((a, b) => {
            const sA = (a.status || 'not run').toLowerCase();
            const sB = (b.status || 'not run').toLowerCase();
            const getRank = (s) => {
              if (s === 'not run') return 1;
              if (s === 'in progress') return 1; // Group with not run
              if (s === 'fail' || s === 'failed') return 2;
              if (s === 'blocked') return 3;
              if (s === 'pass' || s === 'passed') return 4;
              return 5;
            };
            const rankA = getRank(sA);
            const rankB = getRank(sB);
            if (rankA !== rankB) return rankA - rankB;
            return 0;
          });
          
          setCycleTests(filteredEnriched);
        });
    } else if (activeTab === 'reports') {
      if (reportData.cycles.length === 0) {
        loadReportData();
      } else if (prevRefreshRef.current !== refreshTrigger && refreshTrigger > 0) {
        prevRefreshRef.current = refreshTrigger;
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
      testRunId: test?.testRunId || test?.testRunKey,
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
    if (!t) return 'manual';
    let target = t;
    if (t && !t.rawFields) {
      const tc = testCases.find(x => String(x.id) === String(t.id));
      if (tc) target = tc;
    }
    return isAutomatedTest(target) ? 'automatizado' : 'manual';
  };

const renderPlanningTab = () => {
    const totalInProject = testCases.length;
    const inCycleCount = cycleTests.length;
    const notInCycleCount = testCases.filter(tc => !cycleTests.some(ct => String(ct.id) === String(tc.id))).length;
    const missingPct = totalInProject > 0 ? Math.round((notInCycleCount / totalInProject) * 100) : 0;
    const cycleProgressPct = totalInProject > 0 ? ((inCycleCount / totalInProject) * 100).toFixed(1) : '0.0';
    const currentPlan = testPlans.find(p => String(p.id) === String(selectedPlanId));

    const filteredCycleTests = cycleTests.filter(test => 
      !searchQuery || 
      test.key?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      test.summary?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (testCases.find(t => t.id === test.id)?.summary || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const availableFilteredTestCases = testCases.filter(tc => 
      (planningFolder === '' || tc.folderId === planningFolder) &&
      (planningPriority === '' || tc.rawFields?.priority?.name === planningPriority) &&
      (planningExecutionType === '' || (planningExecutionType.toLowerCase() === 'manual' ? getExecVal(tc).includes('man') : getExecVal(tc).includes('auto'))) &&
      !cycleTests.some(ct => String(ct.id) === String(tc.id)) &&
      (!searchQuery || tc.key?.toLowerCase().includes(searchQuery.toLowerCase()) || tc.summary?.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
      <div className="tab-layout" style={{ height: '100%', overflow: 'hidden' }}>
        {/* Left Planning Sidebar (Test Plans & Cycles) */}
        <aside className="planning-sidebar" style={{ width: sidebarWidth, flexShrink: 0 }}>
          <div className="planning-sidebar-header">
            <div className="planning-section-title">
              <span>TEST PLANS</span>
              <button 
                onClick={handleCreateIssue}
                style={{ background: 'none', border: 'none', color: 'var(--jira-blue, #0C66E4)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                + Nuevo
              </button>
            </div>
            <select 
              value={selectedPlanId || ''} 
              onChange={e => { 
                setSelectedPlanId(e.target.value); 
                setSelectedCycle(null); 
                setSelectedTestsForCycle([]); 
              }}
              className="planning-plan-dropdown"
              style={{ outline: 'none' }}
            >
              <option value="">Seleccionar un Test Plan...</option>
              {testPlans.map(plan => (
                <option key={plan.id} value={plan.id}>{plan.summary}</option>
              ))}
            </select>
          </div>

          {/* Sidebar scrollable cycles */}
          <div className="planning-sidebar-content">
            {selectedPlanId ? (
              <>
                {/* Cycles in this Plan */}
                <div>
                  <div className="planning-section-title">
                    <span>CYCLES IN THIS PLAN</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, background: 'var(--jira-bg-subtle, #F1F2F4)', color: 'var(--jira-subtle, #626F86)', padding: '1px 6px', borderRadius: '10px' }}>
                      {filteredTestCycles.filter(c => c.planId === selectedPlanId).length}
                    </span>
                  </div>
                  <div>
                    {filteredTestCycles.filter(c => c.planId === selectedPlanId).map(cycle => {
                      const isActive = selectedCycle?.id === cycle.id;
                      return (
                        <div 
                          key={cycle.id} 
                          className={`planning-cycle-card ${isActive ? 'active' : ''}`}
                          onClick={() => handleCycleSelect(cycle)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                            </svg>
                            <span style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isActive ? 600 : 500 }}>
                              {cycle.summary}
                            </span>
                          </div>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleUnlinkCycleFromPlan(cycle.id); }} 
                            style={{ 
                              background: 'none', 
                              border: 'none', 
                              color: '#AE2A19', 
                              fontSize: '11px', 
                              fontWeight: 600, 
                              cursor: 'pointer', 
                              padding: '2px 4px', 
                              borderRadius: '4px',
                              flexShrink: 0
                            }}
                            title="Remover ciclo del plan"
                          >
                            - Remove
                          </button>
                        </div>
                      );
                    })}
                    {filteredTestCycles.filter(c => c.planId === selectedPlanId).length === 0 && (
                      <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', fontStyle: 'italic', padding: '6px 0' }}>
                        No hay ciclos vinculados a este plan.
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--jira-border, #DCDFE4)' }} />

                {/* Available Cycles */}
                <div>
                  <div className="planning-section-title">
                    <span>AVAILABLE CYCLES</span>
                    <span style={{ fontSize: '10px', color: 'var(--jira-subtle, #626F86)' }}>
                      {filteredTestCycles.filter(c => c.planId !== selectedPlanId).length} listos
                    </span>
                  </div>
                  <div>
                    {filteredTestCycles.filter(c => c.planId !== selectedPlanId).map(cycle => (
                      <div key={cycle.id} className="planning-cycle-available-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#626F86" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <circle cx="12" cy="12" r="9"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                          </svg>
                          <span style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#172B4D', fontWeight: 500 }}>
                            {cycle.summary}
                          </span>
                        </div>
                        <button 
                          onClick={() => handleLinkCycleToPlan(cycle.id, selectedPlanId)} 
                          style={{ 
                            background: 'none', 
                            border: '1px solid #85B8FF', 
                            color: '#0C66E4', 
                            fontSize: '11px', 
                            fontWeight: 600, 
                            borderRadius: '4px', 
                            padding: '2px 6px', 
                            cursor: 'pointer',
                            flexShrink: 0
                          }}
                        >
                          + Add
                        </button>
                      </div>
                    ))}
                    {filteredTestCycles.filter(c => c.planId !== selectedPlanId).length === 0 && (
                      <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', fontStyle: 'italic', padding: '4px 0' }}>
                        Todos los ciclos están vinculados.
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div>
                <div className="planning-section-title">
                  <span>ALL CYCLES</span>
                  <span style={{ fontSize: '10px', fontWeight: 700, background: 'var(--jira-bg-subtle, #F1F2F4)', color: 'var(--jira-subtle, #626F86)', padding: '1px 6px', borderRadius: '10px' }}>
                    {filteredTestCycles.length}
                  </span>
                </div>
                <div>
                  {filteredTestCycles.map(cycle => {
                    const isActive = selectedCycle?.id === cycle.id;
                    return (
                      <div 
                        key={cycle.id} 
                        className={`planning-cycle-card ${isActive ? 'active' : ''}`}
                        onClick={() => handleCycleSelect(cycle)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                          </svg>
                          <span style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isActive ? 600 : 500 }}>
                            {cycle.summary}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Footer Button */}
          <div style={{ padding: '0.75rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', background: '#FAFBFC' }}>
            <button 
              className="btn-primary" 
              style={{ width: '100%', height: '36px', fontSize: '13px' }} 
              onClick={handleCreateIssue}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 4v16m8-8H4"></path></svg>
              <span>+ New Cycle/Plan</span>
            </button>
          </div>
        </aside>

        {/* Resizer */}
        <div 
          onMouseDown={() => setIsResizing(true)}
          style={{
            width: '5px',
            cursor: 'col-resize',
            backgroundColor: isResizing ? 'var(--ds-border-focused, #0C66E4)' : 'transparent',
            zIndex: 10,
            borderRight: '1px solid var(--jira-border, #DCDFE4)',
            marginLeft: '-1px'
          }}
        />

        {/* Main Workspace */}
        <main className="planning-workspace">
          <div className="planning-scroll-container">
            {selectedCycle ? (
              <div className="planning-canvas">
                {/* Workspace Header & Action */}
                <div className="planning-workspace-header">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#172B4D', letterSpacing: '-0.01em' }}>
                        Planning: <span style={{ color: '#0C66E4' }}>{selectedCycle.summary}</span>
                      </h1>
                      <span style={{ fontSize: '11px', fontWeight: 600, background: '#E9F2FF', color: '#0C66E4', padding: '2px 8px', borderRadius: '12px' }}>
                        {cycleTests.length} casos en ciclo
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#626F86' }}>
                      Asigna, filtra y gestiona los casos que integran este ciclo de prueba para la versión actual.
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      className="btn-primary"
                      style={{ background: '#10B981', borderColor: '#059669', height: '32px', fontSize: '12px', fontWeight: 600, padding: '0 12px' }}
                      onClick={() => {
                        setActiveTab('execution');
                      }}
                      title="Ir a ejecutar este ciclo en la pestaña Execution"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                      <span>Ejecutar Ciclo</span>
                    </button>
                  </div>
                </div>

                {/* SECTION 1: Tests in this Cycle */}
                <div className="planning-card-panel">
                  <div className="planning-panel-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#172B4D' }}>
                        Tests in this Cycle ({cycleTests.length})
                      </h2>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {planningChecked.size > 0 && (
                        <button 
                          className="btn-secondary" 
                          style={{ color: '#CA3521', height: '28px', fontSize: '11px', fontWeight: 600, padding: '0 8px' }}
                          onClick={() => {
                            const selectedIds = [...planningChecked];
                            const executedCount = selectedIds.filter(id => {
                              const t = cycleTests.find(ct => String(ct.id) === String(id));
                              return t && t.status && t.status !== 'Not Run' && t.status !== 'To Do';
                            }).length;
                            const msg = executedCount > 0
                              ? `¿Remover ${selectedIds.length} caso${selectedIds.length !== 1 ? 's' : ''} del ciclo? (${executedCount} de ellos ya cuentan con ejecución registrada y sus datos quedarán preservados en Jira).`
                              : `¿Eliminar ${selectedIds.length} caso${selectedIds.length !== 1 ? 's' : ''} del ciclo?`;
                            showConfirm(
                              'Remover casos seleccionados',
                              msg,
                              () => handleRemoveManyFromCycle(selectedIds),
                              { danger: true, confirmLabel: 'Remover' }
                            );
                          }}
                        >
                          🗑 Eliminar seleccionados ({planningChecked.size})
                        </button>
                      )}
                      {cycleTests.length > 0 && (
                        <button 
                          className="btn-secondary" 
                          style={{ color: '#CA3521', height: '28px', fontSize: '11px', fontWeight: 600, padding: '0 8px' }}
                          onClick={() => {
                            const allIds = cycleTests.map(t => t.id);
                            const executedCount = cycleTests.filter(t => t.status && t.status !== 'Not Run' && t.status !== 'To Do').length;
                            const msg = executedCount > 0
                              ? `¿Remover TODOS los ${cycleTests.length} casos del ciclo? (${executedCount} caso${executedCount !== 1 ? 's' : ''} cuentan con ejecuciones que quedarán preservadas de forma segura en Jira).`
                              : `¿Eliminar TODOS los ${cycleTests.length} casos del ciclo?`;
                            showConfirm(
                              'Remover todos los casos',
                              msg,
                              () => handleRemoveManyFromCycle(allIds),
                              { danger: true, confirmLabel: 'Remover todos' }
                            );
                          }}
                        >
                          🗑 Eliminar todos
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Select All Sub-bar */}
                  {cycleTests.length > 0 && (
                    <div className="planning-panel-subbar">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={planningChecked.size > 0 && planningChecked.size === cycleTests.length}
                          ref={el => { if (el) el.indeterminate = planningChecked.size > 0 && planningChecked.size < cycleTests.length; }}
                          onChange={e => {
                            if (e.target.checked) setPlanningChecked(new Set(cycleTests.map(t => String(t.id))));
                            else setPlanningChecked(new Set());
                          }}
                          style={{ borderRadius: '3px', cursor: 'pointer' }}
                        />
                        <span style={{ fontWeight: 600, color: '#44546F' }}>
                          {planningChecked.size > 0 ? `${planningChecked.size} seleccionado${planningChecked.size !== 1 ? 's' : ''}` : 'Seleccionar todos'}
                        </span>
                      </label>
                    </div>
                  )}

                  {/* Cycle Tests List */}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {filteredCycleTests.map(test => {
                      const isAuto = getExecVal(test).includes('auto');
                      return (
                        <div key={test.id} className="planning-row">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1, paddingRight: '1rem' }}>
                            <input 
                              type="checkbox"
                              checked={planningChecked.has(String(test.id))}
                              onChange={e => setPlanningChecked(prev => {
                                const s = new Set(prev);
                                if (e.target.checked) s.add(String(test.id)); else s.delete(String(test.id));
                                return s;
                              })}
                              style={{ borderRadius: '3px', cursor: 'pointer', flexShrink: 0 }}
                            />
                            <span 
                              onClick={() => router.open('/browse/' + (test.testRunKey || test.key))}
                              style={{ fontWeight: 700, fontSize: '13px', color: '#0C66E4', cursor: 'pointer', flexShrink: 0 }}
                              title="Abrir en Jira"
                            >
                              {test.testRunKey || test.key}
                            </span>
                            {test.testCaseKey && test.testRunKey && test.testCaseKey !== test.testRunKey && (
                              <span style={{ fontSize: '11px', color: '#626F86', flexShrink: 0 }}>
                                (TC: <span onClick={() => router.open('/browse/' + test.testCaseKey)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>{test.testCaseKey}</span>)
                              </span>
                            )}
                            <span className={isAuto ? "planning-badge-auto" : "planning-badge-manual"}>
                              {isAuto ? "⚡ Auto" : "Manual"}
                            </span>
                            <span 
                              style={{ fontSize: '13px', fontWeight: 500, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}
                            >
                              {test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                            <AtlaskitStatusLozenge status={test.status} />
                            <button 
                              className="btn-secondary"
                              style={{ color: '#CA3521', padding: '2px 6px', height: '26px' }}
                              onClick={() => {
                                const isExecuted = test.status && test.status !== 'Not Run' && test.status !== 'To Do';
                                if (isExecuted) {
                                  showConfirm(
                                    'Remover caso ejecutado',
                                    `Este caso ya tiene resultados registrados (${test.status}). Al removerlo se desvinculará del ciclo, pero sus datos y evidencias se conservarán de forma segura en Jira. Si lo vuelves a agregar más adelante, se restaurará automáticamente.`,
                                    () => handleRemoveTestFromCycle(test.id),
                                    { danger: true, confirmLabel: 'Desvincular del ciclo' }
                                  );
                                } else {
                                  handleRemoveTestFromCycle(test.id);
                                }
                              }}
                              title="Quitar del ciclo"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {cycleTests.length === 0 && (
                      <div style={{ padding: '2rem', textAlign: 'center', color: '#626F86', fontSize: '13px' }}>
                        No hay casos asignados a este ciclo todavía. Usa la sección inferior para añadir casos de prueba.
                      </div>
                    )}
                  </div>
                </div>

                {/* WARNING BANNER (Atlassian Yellow Banner) */}
                {totalInProject > 0 && notInCycleCount > 0 && (
                  <div className="planning-warning-banner">
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ color: '#D97706', marginTop: '2px', flexShrink: 0 }}>
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path>
                        </svg>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: '13px', color: '#78350F' }}>
                          {inCycleCount} de {totalInProject} casos del proyecto están en este ciclo
                        </p>
                        <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: '#92400E' }}>
                          Faltan <strong>{notInCycleCount} casos</strong> ({missingPct}% del proyecto). Usa los filtros de abajo para encontrarlos y el botón <em>"Añadir seleccionados"</em> para añadirlos.
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <button 
                        className="btn-primary"
                        style={{ background: '#091E42', borderColor: '#091E42', height: '32px', fontSize: '12px', fontWeight: 600 }}
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
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        <span>Seleccionar disponibles ({availableFilteredTestCases.length})</span>
                      </button>
                      <button 
                        className="btn-secondary"
                        style={{ height: '32px', fontSize: '12px', background: '#FFFFFF', borderColor: '#FDE68A', color: '#78350F' }}
                        onClick={() => setSelectedTestsForCycle([])}
                      >
                        ✕ Limpiar
                      </button>
                    </div>
                  </div>
                )}

                {/* SECTION 2: Available Test Cases (Filtered Backlog) */}
                <div className="planning-card-panel">
                  <div className="planning-panel-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#172B4D' }}>
                        Available Test Cases
                      </h2>
                      <span style={{ fontSize: '11px', fontWeight: 700, background: '#F1F2F4', color: '#626F86', padding: '1px 8px', borderRadius: '10px' }}>
                        {availableFilteredTestCases.length}
                      </span>
                    </div>

                    {/* Filters & Bulk Add Button */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {/* Folder Filter */}
                      <select 
                        value={planningFolder} 
                        onChange={e => {
                          setPlanningFolder(e.target.value);
                          setSelectedTestsForCycle([]);
                        }}
                        className="status-badge"
                        style={{ height: '32px', padding: '0 8px', fontSize: '12px', fontWeight: 600, background: '#FFFFFF', border: '1px solid #DCDFE4', borderRadius: '6px', color: '#172B4D', outline: 'none' }}
                      >
                        <option value="">TODAS LAS CARPETAS</option>
                        {folderPaths.map(f => (
                          <option key={f.id} value={f.id}>{f.path}</option>
                        ))}
                      </select>

                      {/* Priority Filter */}
                      <select 
                        value={planningPriority} 
                        onChange={e => { 
                          setPlanningPriority(e.target.value); 
                          setSelectedTestsForCycle([]); 
                        }} 
                        className="status-badge" 
                        style={{ height: '32px', padding: '0 8px', fontSize: '12px', fontWeight: 600, background: '#FFFFFF', border: '1px solid #DCDFE4', borderRadius: '6px', color: '#172B4D', outline: 'none' }}
                      >
                        <option value="">TODAS LAS PRIORIDADES</option>
                        <option value="Highest">Highest</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                        <option value="Lowest">Lowest</option>
                      </select>

                      {/* Execution Type Filter */}
                      <select 
                        value={planningExecutionType} 
                        onChange={e => { 
                          setPlanningExecutionType(e.target.value); 
                          setSelectedTestsForCycle([]); 
                        }} 
                        className="status-badge" 
                        style={{ height: '32px', padding: '0 8px', fontSize: '12px', fontWeight: 600, background: '#FFFFFF', border: '1px solid #DCDFE4', borderRadius: '6px', color: '#172B4D', outline: 'none' }}
                      >
                        <option value="">TODOS LOS TIPOS</option>
                        <option value="Automatizado">⚡ Auto</option>
                        <option value="Manual">Manual</option>
                      </select>

                      {/* Primary Action: Bulk Add */}
                      <button 
                        className="btn-primary" 
                        onClick={async () => {
                          const allAvailable = testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && (planningPriority === '' || tc.rawFields?.priority?.name === planningPriority) && (planningExecutionType === '' || (planningExecutionType.toLowerCase() === 'manual' ? getExecVal(tc).includes('man') : getExecVal(tc).includes('auto'))) && !cycleTests.some(ct => ct.id === tc.id));
                          const testsToAdd = selectedTestsForCycle.length > 0 
                            ? testCases.filter(tc => selectedTestsForCycle.includes(tc.id))
                            : allAvailable;
                            
                          setIsAddingAll(true);
                          try {
                            const cycleId = selectedCycle.id;
                            testsToAdd.forEach(tc => {
                              const idStr = String(tc.id);
                              deletedIdsRef.current.delete(idStr);
                              if (perCycleDeletedRef.current[cycleId]) {
                                perCycleDeletedRef.current[cycleId].delete(idStr);
                              }
                            });

                            const CHUNK_SIZE = 20;
                            let allAddedTests = [];
                            for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                                const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                                const bRes = await invoke('addBulkTestsToCycle', { 
                                  cycleId: selectedCycle.id,
                                  cycleKey: selectedCycle.key || selectedCycle.id,
                                  projectId: selectedProjectId,
                                  config: projectConfig,
                                  testCases: chunk 
                                });
                                if (bRes && bRes.addedTests) {
                                    allAddedTests = allAddedTests.concat(bRes.addedTests);
                                }
                            }
                            
                            // Optimistic UI update
                            const locallyAdded = testsToAdd.map(tc => ({
                               id: tc.id,
                               key: tc.key,
                               summary: tc.summary,
                               executionType: tc.executionType || 'Manual',
                               status: 'Not Run'
                            }));
                            
                            setCycleTests(prev => {
                               const newArr = [...prev];
                               locallyAdded.forEach(lt => {
                                   let finalItem = lt;
                                   if (allAddedTests && allAddedTests.length > 0) {
                                       const matched = allAddedTests.find(t => String(t.id) === String(lt.id));
                                       if (matched) {
                                           finalItem = { ...lt, ...matched };
                                       }
                                   }
                                   
                                   if (!newArr.some(existing => String(existing.id) === String(lt.id))) {
                                       newArr.push(finalItem);
                                   }
                               });
                               return newArr;
                            });
                            
                            const recoveredCount = (allAddedTests || []).filter(t => t.isRecovered).length;
                            if (recoveredCount > 0) {
                              addNotification({
                                type: 'success',
                                title: 'Casos restaurados',
                                description: `${recoveredCount} caso${recoveredCount !== 1 ? 's' : ''} restauraron automáticamente su ejecución histórica y evidencias previas.`
                              });
                            }

                            setSelectedTestsForCycle([]);
                            
                            setTimeout(async () => {
                                const finalExecution = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
                                if (finalExecution) {
                                    safeSetCycleTests(finalExecution);
                                }
                            }, 2500);
                            
                          } catch(err) {
                            console.error(err);
                            alert("Error al añadir casos: " + err.message);
                          }
                          setIsAddingAll(false);
                        }}
                        disabled={loading || isAddingAll || availableFilteredTestCases.length === 0}
                        style={{ height: '32px', fontSize: '12px', fontWeight: 600 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 4v16m8-8H4"></path></svg>
                        <span>{isAddingAll ? 'Añadiendo casos...' : (selectedTestsForCycle.length > 0 ? `+ Añadir (${selectedTestsForCycle.length})` : '+ Añadir todos')}</span>
                      </button>
                    </div>
                  </div>

                  {/* Available Tests List */}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {availableFilteredTestCases.map(test => {
                      const isSelected = selectedTestsForCycle.includes(test.id);
                      const isAuto = getExecVal(test).includes('auto');
                      return (
                        <div 
                          key={test.id} 
                          className="planning-row"
                          style={{
                            backgroundColor: isSelected ? '#E9F2FF' : undefined,
                            cursor: 'pointer'
                          }}
                          onClick={() => {
                            setSelectedTestsForCycle(prev => 
                              prev.includes(test.id) ? prev.filter(id => id !== test.id) : [...prev, test.id]
                            );
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1, paddingRight: '1rem' }}>
                            <input 
                              type="checkbox" 
                              checked={isSelected} 
                              readOnly
                              style={{ borderRadius: '3px', cursor: 'pointer', flexShrink: 0 }}
                            />
                            <span 
                              onClick={(e) => { e.stopPropagation(); router.open('/browse/' + test.key); }}
                              style={{ fontWeight: 700, fontSize: '13px', color: '#0C66E4', cursor: 'pointer', flexShrink: 0 }}
                              title="Abrir en Jira"
                            >
                              {test.key}
                            </span>
                            <span className={isAuto ? "planning-badge-auto" : "planning-badge-manual"}>
                              {isAuto ? "⚡ Auto" : "Manual"}
                            </span>
                            <span 
                              style={{ fontSize: '13px', fontWeight: 500, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}
                            >
                              {test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}
                            </span>
                          </div>
                          <button 
                            className="btn-secondary" 
                            style={{ height: '28px', fontSize: '12px', fontWeight: 600, padding: '0 10px', flexShrink: 0 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddTestToCycle(test);
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 4v16m8-8H4"></path></svg>
                            <span>Add</span>
                          </button>
                        </div>
                      );
                    })}
                    {availableFilteredTestCases.length === 0 && (
                      <div style={{ padding: '2rem', textAlign: 'center', color: '#626F86', fontSize: '13px' }}>
                        No hay casos de prueba disponibles con los filtros actuales.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '350px', padding: '3rem', textAlign: 'center', color: '#626F86', margin: 'auto' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#E9F2FF', color: '#0C66E4', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                  </svg>
                </div>
                <h3 style={{ margin: '0 0 0.5rem 0', color: '#172B4D', fontSize: '16px', fontWeight: 600 }}>Selecciona un Ciclo de Prueba</h3>
                <p style={{ margin: 0, fontSize: '13px', maxWidth: '400px' }}>
                  Elige un Test Plan o Ciclo del panel lateral izquierdo para planificar, asignar o gestionar sus casos de prueba.
                </p>
                <button 
                  className="btn-primary" 
                  style={{ marginTop: '1.25rem', height: '36px', fontSize: '13px' }}
                  onClick={handleCreateIssue}
                >
                  + Crear Nuevo Ciclo / Plan
                </button>
              </div>
            )}
          </div>

          {/* Subtle Footer Bar - Fixed outside the scroll container */}
          <footer className="planning-footer-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#0C66E4', display: 'inline-block' }}></span>
                <span style={{ fontWeight: 600, color: '#172B4D' }}>Progreso del Ciclo:</span>
                <span>{inCycleCount} de {totalInProject} casos asignados ({cycleProgressPct}%)</span>
              </div>
              <span style={{ color: '#DCDFE4' }}>|</span>
              <span>Plan activo: <strong style={{ color: '#172B4D' }}>{currentPlan?.summary || (selectedPlanId ? 'Plan seleccionado' : 'Sin plan asignado')}</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }}></span>
              <span style={{ fontSize: '11px', color: '#626F86' }}>Atlassian Forge Environment • Synchronized</span>
            </div>
          </footer>
        </main>
      </div>
    );
  };

  const handleToggleExecutionTest = async (testId) => {
    if (expandedExecutionTest === testId) {
      setExpandedExecutionTest(null);
    } else {
      setExpandedExecutionTest(testId);

      const test = cycleTests.find(t => String(t.id) === String(testId));
      const targetCaseId = test?.testCaseId || test?.id || testId;
      const targetCaseKey = test?.testCaseKey || test?.key;
      const targetRunKey = test?.testRunKey;

      // 1. Load BDD/Traditional steps
      if (!executionTestDetails[testId] || !executionTestDetails[testId].content?.length) {
        let details = await invoke('getTestCaseDetails', { caseId: targetCaseId }).catch(() => null);
        if ((!details || !details.content || details.content.length === 0) && targetCaseKey && targetCaseKey !== targetCaseId) {
          details = await invoke('getTestCaseDetails', { caseId: targetCaseKey }).catch(() => null);
        }
        if ((!details || !details.content || details.content.length === 0) && targetRunKey) {
          details = await invoke('getTestCaseDetails', { caseId: targetRunKey }).catch(() => null);
        }
        if (details) {
          setExecutionTestDetails(prev => ({ ...prev, [testId]: details }));
        }
      }

      // 2. Load description and execution details if not fully loaded or description missing
      if (!test?.description || !test?._detailLoaded) {
        let desc = test?.description;
        if (!desc) {
          desc = await invoke('getIssueDescription', { issueId: targetCaseKey || targetCaseId || targetRunKey || testId }).catch(() => null);
        }

        let fullExec = null;
        if (!test?._detailLoaded) {
          fullExec = await invoke('getTestExecution', { 
            cycleId: selectedCycle.id, 
            testId,
            testRunId: test?.testRunId || test?.testRunKey
          }).catch(() => null);
        }

        setCycleTests(prev => prev.map(t => {
          if (String(t.id) === String(testId)) {
            return {
              ...t,
              ...(fullExec || {}),
              description: desc || fullExec?.description || t.description || null,
              _detailLoaded: true
            };
          }
          return t;
        }));
      }
    }
  };

  const renderExecutionTab = () => {
    const isPassed = s => ['Pass', 'Passed'].includes(s);
    const isFailed = s => ['Fail', 'Failed'].includes(s);
    const isBlocked = s => ['Block', 'Blocked'].includes(s);
    const isInProgress = s => ['In Progress'].includes(s);
    const isNotRun = s => !s || ['To Do', 'Not Run', 'None'].includes(s) || (!isPassed(s) && !isFailed(s) && !isBlocked(s) && !isInProgress(s));

    const totalInCycle = cycleTests.length;
    const passedCount = cycleTests.filter(t => isPassed(t.status)).length;
    const failedCount = cycleTests.filter(t => isFailed(t.status)).length;
    const blockedCount = cycleTests.filter(t => isBlocked(t.status)).length;
    const inProgressCount = cycleTests.filter(t => isInProgress(t.status)).length;
    const notRunCount = cycleTests.filter(t => isNotRun(t.status)).length;
    const executedCount = passedCount + failedCount + blockedCount + inProgressCount;
    const completionRate = totalInCycle > 0 ? Math.round(((passedCount + failedCount + blockedCount) / totalInCycle) * 100) : 0;

    const passedPct = totalInCycle > 0 ? ((passedCount / totalInCycle) * 100).toFixed(1) : '0';
    const failedPct = totalInCycle > 0 ? ((failedCount / totalInCycle) * 100).toFixed(1) : '0';
    const blockedPct = totalInCycle > 0 ? ((blockedCount / totalInCycle) * 100).toFixed(1) : '0';
    const inProgressPct = totalInCycle > 0 ? ((inProgressCount / totalInCycle) * 100).toFixed(1) : '0';
    const notRunPct = totalInCycle > 0 ? ((notRunCount / totalInCycle) * 100).toFixed(1) : '0';

    // Filter tests
    let filteredTests = cycleTests.filter(test => {
      if (executionStatusFilter === 'Passed' && !isPassed(test.status)) return false;
      if (executionStatusFilter === 'Failed' && !isFailed(test.status)) return false;
      if (executionStatusFilter === 'Blocked' && !isBlocked(test.status)) return false;
      if (executionStatusFilter === 'In Progress' && !isInProgress(test.status)) return false;
      if (executionStatusFilter === 'Not Run' && !isNotRun(test.status)) return false;

      if (executionSearchQuery) {
        const q = executionSearchQuery.toLowerCase();
        const keyMatch = (test.key || test.testCaseKey || '').toLowerCase().includes(q);
        const runKeyMatch = (test.testRunKey || '').toLowerCase().includes(q);
        const summaryMatch = (test.summary || (testCases.find(t => t.id === test.id)?.summary) || '').toLowerCase().includes(q);
        if (!keyMatch && !runKeyMatch && !summaryMatch) return false;
      }

      return true;
    });

    // Sort tests
    filteredTests = [...filteredTests].sort((a, b) => {
      if (executionSortBy === 'key-asc') {
        const keyA = a.testCaseKey || a.key || '';
        const keyB = b.testCaseKey || b.key || '';
        return keyA.localeCompare(keyB, undefined, { numeric: true });
      }
      if (executionSortBy === 'key-desc') {
        const keyA = a.testCaseKey || a.key || '';
        const keyB = b.testCaseKey || b.key || '';
        return keyB.localeCompare(keyA, undefined, { numeric: true });
      }
      if (executionSortBy === 'status') {
        const getRank = s => isFailed(s) ? 1 : (isBlocked(s) ? 2 : (isInProgress(s) ? 3 : (isNotRun(s) ? 4 : 5)));
        return getRank(a.status) - getRank(b.status);
      }
      if (executionSortBy === 'summary') {
        const sumA = a.summary || (testCases.find(t => t.id === a.id)?.summary) || '';
        const sumB = b.summary || (testCases.find(t => t.id === b.id)?.summary) || '';
        return sumA.localeCompare(sumB);
      }
      return 0;
    });

    // Pagination calculations
    const pageSize = executionPageSize === 'ALL' ? filteredTests.length : Number(executionPageSize);
    const totalPages = Math.max(1, Math.ceil(filteredTests.length / (pageSize || 1)));
    const safeCurrentPage = Math.min(Math.max(1, executionCurrentPage), totalPages);
    const paginatedTests = executionPageSize === 'ALL'
      ? filteredTests
      : filteredTests.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize);

    const currentPlan = testPlans.find(p => p.id === selectedPlanId);

    return (
      <div className="tab-layout" style={{ height: '100%', overflow: 'hidden' }}>
        {/* Left Sidebar: Plans & Cycles */}
        <aside className="execution-sidebar" style={{ width: sidebarWidth, flexShrink: 0 }}>
          {/* Test Plans Selector Header */}
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', background: '#FFFFFF' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', letterSpacing: '0.04em', textTransform: 'uppercase' }}>TEST PLANS</span>
              <button
                onClick={() => setIsCreatePlanOpen(true)}
                style={{ fontSize: '11px', fontWeight: 600, color: '#0C66E4', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                className="hover:underline"
              >
                + Nuevo
              </button>
            </div>
            <select
              value={selectedPlanId || ''}
              onChange={e => { setSelectedPlanId(e.target.value); setSelectedCycle(null); setExecutionCurrentPage(1); }}
              style={{
                width: '100%',
                padding: '0.5rem 0.6rem',
                fontSize: '12px',
                fontWeight: 600,
                color: '#172B4D',
                background: '#FAFBFC',
                border: '1px solid #DCDFE4',
                borderRadius: '6px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="">Seleccionar un Plan de Pruebas...</option>
              {testPlans.map(plan => (
                <option key={plan.id} value={plan.id}>{plan.summary}</option>
              ))}
            </select>
          </div>

          {/* Active Cycles Header */}
          <div style={{ padding: '0.85rem 1rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#172B4D', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Active Cycles</span>
              <span style={{ fontSize: '10px', background: '#F1F2F4', color: '#626F86', padding: '1px 6px', borderRadius: '10px', fontWeight: 700 }}>
                {selectedPlanId ? filteredTestCycles.filter(c => c.planId === selectedPlanId).length : filteredTestCycles.length}
              </span>
            </div>
          </div>

          {/* Active Cycles List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 0.5rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {(selectedPlanId ? filteredTestCycles.filter(c => c.planId === selectedPlanId) : filteredTestCycles).map(cycle => {
              const isSelected = selectedCycle?.id === cycle.id;
              const testCount = cycle.testCount || (selectedCycle?.id === cycle.id ? cycleTests.length : (cycle.tests?.length || 0));
              return (
                <div
                  key={cycle.id}
                  onClick={() => { handleCycleSelect(cycle); setExecutionCurrentPage(1); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: isSelected ? '#E9F2FF' : 'transparent',
                    color: isSelected ? '#0C66E4' : '#172B4D',
                    fontWeight: isSelected ? 600 : 500,
                    borderLeft: isSelected ? '4px solid #0C66E4' : '4px solid transparent'
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#F4F5F7'; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={isSelected ? '#0C66E4' : '#FF9800'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                    </svg>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cycle.summary}</span>
                  </div>
                  <span style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontWeight: 700,
                    background: isSelected ? '#CCE0FF' : '#F1F2F4',
                    color: isSelected ? '#0C66E4' : '#626F86',
                    flexShrink: 0
                  }}>
                    {testCount}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Bottom Persistent Action: + New Execution Cycle */}
          <div style={{ padding: '0.75rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', background: '#FFFFFF' }}>
            <button
              onClick={() => setIsCreateCycleOpen(true)}
              style={{
                width: '100%',
                padding: '0.45rem 0.75rem',
                background: '#0C66E4',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#0055CC'}
              onMouseLeave={e => e.currentTarget.style.background = '#0C66E4'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>+ New Execution Cycle</span>
            </button>
          </div>
        </aside>

        {/* Resizer Handle */}
        <div
          onMouseDown={() => setIsResizing(true)}
          style={{
            width: '5px',
            cursor: 'col-resize',
            backgroundColor: isResizing ? 'var(--ds-border-focused, #0C66E4)' : 'transparent',
            zIndex: 10,
            borderRight: '1px solid var(--jira-border, #DCDFE4)',
            marginLeft: '-1px'
          }}
        />

        {/* Workspace Area */}
        <main className="execution-workspace">
          {selectedCycle ? (
            <>
              {/* Scrollable Container */}
              <div className="execution-scroll-container">
                <div className="execution-canvas">
                  {/* Header: Title */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#172B4D', margin: 0, letterSpacing: '-0.01em' }}>
                          Execution: {selectedCycle.summary}
                        </h1>
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', background: '#F1F2F4', color: '#44546F' }}>
                          {totalInCycle} casos
                        </span>
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: completionRate === 100 ? '#DCFFF1' : '#E9F2FF',
                          color: completionRate === 100 ? '#216E4E' : '#0C66E4',
                          border: `1px solid ${completionRate === 100 ? '#7EE2B8' : '#B2D4FF'}`
                        }}>
                          {completionRate === 100 ? 'Completado' : 'En Ejecución'}
                        </span>
                      </div>
                      <p style={{ fontSize: '12px', color: '#626F86', margin: '4px 0 0 0' }}>
                        {selectedCycle.description || `Ejecución activa de pruebas en el ciclo ${selectedCycle.summary}.`}
                      </p>
                    </div>
                  </div>

                  {/* Metrics & Progress Card */}
                  <div className="execution-metrics-card">
                    {/* Top Row: Metrics Breakdown */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', fontSize: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#36B37E', display: 'inline-block' }}></span>
                          <span style={{ color: '#626F86' }}>Passed:</span>
                          <strong style={{ color: '#172B4D' }}>{passedCount}</strong>
                          <span style={{ fontSize: '11px', color: '#006644', fontWeight: 600 }}>({passedPct}%)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#FF5630', display: 'inline-block' }}></span>
                          <span style={{ color: '#626F86' }}>Failed:</span>
                          <strong style={{ color: '#172B4D' }}>{failedCount}</strong>
                          <span style={{ fontSize: '11px', color: '#BF2600', fontWeight: 600 }}>({failedPct}%)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#FFAB00', display: 'inline-block' }}></span>
                          <span style={{ color: '#626F86' }}>Blocked:</span>
                          <strong style={{ color: '#172B4D' }}>{blockedCount}</strong>
                          <span style={{ fontSize: '11px', color: '#974F00', fontWeight: 600 }}>({blockedPct}%)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#0052CC', display: 'inline-block' }}></span>
                          <span style={{ color: '#626F86' }}>In Progress:</span>
                          <strong style={{ color: '#172B4D' }}>{inProgressCount}</strong>
                          <span style={{ fontSize: '11px', color: '#0747A6', fontWeight: 600 }}>({inProgressPct}%)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#DFE1E6', display: 'inline-block' }}></span>
                          <span style={{ color: '#626F86' }}>Unexecuted:</span>
                          <strong style={{ color: '#172B4D' }}>{notRunCount}</strong>
                          <span style={{ fontSize: '11px', color: '#626F86', fontWeight: 600 }}>({notRunPct}%)</span>
                        </div>
                      </div>

                      <div style={{ fontSize: '12px', color: '#626F86' }}>
                        <span>Tasa de finalización: </span>
                        <strong style={{ color: '#172B4D', fontSize: '13px' }}>{completionRate}%</strong>
                      </div>
                    </div>

                    {/* Segmented Progress Bar */}
                    <div className="execution-progress-bar">
                      {passedCount > 0 && (
                        <div
                          className="execution-progress-segment"
                          style={{ width: `${passedPct}%`, background: '#36B37E' }}
                          title={`Passed: ${passedCount} (${passedPct}%)`}
                        />
                      )}
                      {failedCount > 0 && (
                        <div
                          className="execution-progress-segment"
                          style={{ width: `${failedPct}%`, background: '#FF5630' }}
                          title={`Failed: ${failedCount} (${failedPct}%)`}
                        />
                      )}
                      {blockedCount > 0 && (
                        <div
                          className="execution-progress-segment"
                          style={{ width: `${blockedPct}%`, background: '#FFAB00' }}
                          title={`Blocked: ${blockedCount} (${blockedPct}%)`}
                        />
                      )}
                      {inProgressCount > 0 && (
                        <div
                          className="execution-progress-segment"
                          style={{ width: `${inProgressPct}%`, background: '#0052CC' }}
                          title={`In Progress: ${inProgressCount} (${inProgressPct}%)`}
                        />
                      )}
                      {notRunCount > 0 && (
                        <div
                          className="execution-progress-segment"
                          style={{ width: `${notRunPct}%`, background: '#DFE1E6' }}
                          title={`Unexecuted: ${notRunCount} (${notRunPct}%)`}
                        />
                      )}
                    </div>
                  </div>

                  {/* Filter Toolbar */}
                  <div className="execution-filter-toolbar">
                    {/* Search & Status Pills */}
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                      {/* Search */}
                      <div style={{ position: 'relative' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#626F86" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}>
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input
                          type="text"
                          value={executionSearchQuery}
                          onChange={e => { setExecutionSearchQuery(e.target.value); setExecutionCurrentPage(1); }}
                          placeholder="Filtrar casos en ejecución..."
                          style={{
                            padding: '0.4rem 0.6rem 0.4rem 2rem',
                            fontSize: '12px',
                            border: '1px solid #DCDFE4',
                            borderRadius: '6px',
                            width: '220px',
                            background: '#FAFBFC',
                            outline: 'none',
                            color: '#172B4D'
                          }}
                        />
                      </div>

                      {/* Status Pills */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', borderLeft: '1px solid #DCDFE4', paddingLeft: '0.75rem' }}>
                        <button
                          onClick={() => { setExecutionStatusFilter('ALL'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'ALL' ? 'active' : ''}`}
                        >
                          Todos ({totalInCycle})
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Passed'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Passed' ? 'active' : ''}`}
                          style={executionStatusFilter === 'Passed' ? { background: '#216E4E', color: '#FFFFFF' } : {}}
                        >
                          Passed ({passedCount})
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Failed'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Failed' ? 'active' : ''}`}
                          style={executionStatusFilter === 'Failed' ? { background: '#BF2600', color: '#FFFFFF' } : {}}
                        >
                          Failed ({failedCount})
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Blocked'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Blocked' ? 'active' : ''}`}
                          style={executionStatusFilter === 'Blocked' ? { background: '#FFAB00', color: '#172B4D' } : {}}
                        >
                          Blocked ({blockedCount})
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('In Progress'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'In Progress' ? 'active' : ''}`}
                          style={executionStatusFilter === 'In Progress' ? { background: '#0747A6', color: '#FFFFFF' } : {}}
                        >
                          In Progress ({inProgressCount})
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Not Run'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Not Run' ? 'active' : ''}`}
                        >
                          Not Run ({notRunCount})
                        </button>
                      </div>
                    </div>

                    {/* Right: Sort dropdown */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <select
                        value={executionSortBy}
                        onChange={e => setExecutionSortBy(e.target.value)}
                        style={{
                          padding: '0.35rem 0.6rem',
                          fontSize: '12px',
                          border: '1px solid #DCDFE4',
                          borderRadius: '6px',
                          background: '#FFFFFF',
                          color: '#44546F',
                          outline: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="key-asc">Ordenar por: Identificador (Asc)</option>
                        <option value="key-desc">Ordenar por: Identificador (Desc)</option>
                        <option value="status">Ordenar por: Estatus de Ejecución</option>
                        <option value="summary">Ordenar por: Título</option>
                      </select>
                    </div>
                  </div>

                  {/* Test Cases List */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* Table / List Header */}
                    <div style={{
                      padding: '0.35rem 1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#626F86',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <input
                          type="checkbox"
                          checked={paginatedTests.length > 0 && paginatedTests.every(t => executionChecked.has(t.id))}
                          onChange={e => {
                            const newSet = new Set(executionChecked);
                            if (e.target.checked) {
                              paginatedTests.forEach(t => newSet.add(t.id));
                            } else {
                              paginatedTests.forEach(t => newSet.delete(t.id));
                            }
                            setExecutionChecked(newSet);
                          }}
                          style={{ cursor: 'pointer', borderRadius: '3px', accentColor: '#0C66E4' }}
                        />
                        <span>Caso de Prueba</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '0.5rem' }}>
                        <span>Ejecutar</span>
                        <span style={{ minWidth: '105px', textAlign: 'center' }}>Estatus Actual</span>
                      </div>
                    </div>

                    {/* Test Cards */}
                    {paginatedTests.map(test => {
                      const isExpanded = String(expandedExecutionTest) === String(test.id);
                      const isAuto = getExecVal(test).includes('auto');
                      const testSummary = test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba";
                      const testCaseKey = test.testCaseKey || test.key;

                      let cardStatusClass = '';
                      if (isPassed(test.status)) cardStatusClass = 'is-passed';
                      else if (isFailed(test.status)) cardStatusClass = 'is-failed';
                      else if (isBlocked(test.status)) cardStatusClass = 'is-blocked';
                      else if (isInProgress(test.status)) cardStatusClass = 'is-inprogress';

                      return (
                        <div
                          key={test.id}
                          className={`execution-test-card ${isExpanded ? 'expanded' : ''} ${cardStatusClass}`}
                        >
                          {/* Card Row Header */}
                          <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                            {/* Left: Chevron, Checkbox, Type Badge, Key, Summary, Bugs, Lock */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                              <button
                                onClick={() => handleToggleExecutionTest(test.id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#626F86', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                                title={isExpanded ? 'Colapsar detalles' : 'Expandir detalles'}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
                                >
                                  <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                              </button>

                              <input
                                type="checkbox"
                                checked={executionChecked.has(test.id)}
                                onChange={e => {
                                  const newSet = new Set(executionChecked);
                                  if (e.target.checked) newSet.add(test.id);
                                  else newSet.delete(test.id);
                                  setExecutionChecked(newSet);
                                }}
                                style={{ cursor: 'pointer', borderRadius: '3px', accentColor: '#0C66E4', flexShrink: 0 }}
                              />

                              {/* Automation Badge */}
                              {isAuto ? (
                                <span className="planning-badge-auto">⚡ AUTO</span>
                              ) : (
                                <span className="planning-badge-manual">MANUAL</span>
                              )}

                              {/* Key with Jira link */}
                              <span
                                onClick={(e) => { e.stopPropagation(); router.open('/browse/' + testCaseKey); }}
                                style={{ fontWeight: 600, color: '#0C66E4', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}
                                title="Abrir Caso de Prueba en Jira"
                                className="hover:underline font-mono"
                              >
                                {testCaseKey}
                              </span>

                              {test.testRunKey && test.testRunKey !== testCaseKey && (
                                <span
                                  onClick={(e) => { e.stopPropagation(); router.open('/browse/' + test.testRunKey); }}
                                  style={{
                                    fontSize: '11px',
                                    background: '#F1F2F4',
                                    color: '#44546F',
                                    padding: '1px 6px',
                                    borderRadius: '3px',
                                    cursor: 'pointer',
                                    fontWeight: 500,
                                    flexShrink: 0
                                  }}
                                  title="Abrir Test Run (Ejecución) en Jira"
                                >
                                  Run: {test.testRunKey}
                                </span>
                              )}

                              {/* Test Summary */}
                              <span
                                onClick={() => handleToggleExecutionTest(test.id)}
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  color: '#172B4D',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  cursor: 'pointer'
                                }}
                                title={testSummary}
                              >
                                {testSummary}
                              </span>

                              {/* Defect Badge */}
                              {test.linkedBugs && test.linkedBugs.length > 0 && (
                                <span
                                  onClick={() => handleToggleExecutionTest(test.id)}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    background: '#FFEBE6',
                                    border: '1px solid #FFBDAD',
                                    color: '#BF2600',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    flexShrink: 0
                                  }}
                                  title={`${test.linkedBugs.length} Defecto(s) reportado(s)`}
                                >
                                  <span>{test.linkedBugs.length}</span>
                                  <span>🐞</span>
                                </span>
                              )}

                              {/* Protected / Locked Lock */}
                              {test.lockedAt && (
                                <span title={`Ejecución completada y protegida${isAdmin ? ' (Admin puede resetear)' : ''}`} style={{ fontSize: '11px', opacity: 0.7, flexShrink: 0 }}>
                                  🔒
                                </span>
                              )}
                            </div>

                            {/* Right Actions: Play Button & Status Lozenge */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                              {/* Play / Run Action Button */}
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
                                  width: '28px',
                                  height: '28px',
                                  borderRadius: '6px',
                                  background: runningTests[test.id] ? '#FF8B00' : '#0C66E4',
                                  color: '#FFFFFF',
                                  border: 'none',
                                  cursor: (runningTests[test.id] === 'capturing' || runningTests[test.id] === 'uploading') ? 'wait' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  boxShadow: '0 1px 2px rgba(9, 30, 66, 0.1)',
                                  transition: 'background 0.15s ease'
                                }}
                              >
                                {runningTests[test.id] === 'capturing' ? '⏹' :
                                 runningTests[test.id] === 'uploading' ? '⏳' :
                                 runningTests[test.id] ? '⏹' : '▶'}
                              </button>

                              {/* Status Lozenge Selector */}
                              <select
                                className="status-badge"
                                value={isPassed(test.status) ? 'Passed' : (isFailed(test.status) ? 'Failed' : (isBlocked(test.status) ? 'Blocked' : (isInProgress(test.status) ? 'In Progress' : 'Not Run')))}
                                onChange={(e) => handleUpdateTestStatus(test.id, e.target.value)}
                                disabled={!runningTests[test.id]}
                                style={{
                                  backgroundColor: getStatusColor(test.status),
                                  color: getStatusTextColor(test.status),
                                  border: `1px solid ${
                                    isPassed(test.status) ? '#A3FAD0' :
                                    isFailed(test.status) ? '#FFBDAD' :
                                    isBlocked(test.status) ? '#FFE380' :
                                    isInProgress(test.status) ? '#B2D4FF' : '#DCDFE4'
                                  }`,
                                  cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                  opacity: !runningTests[test.id] ? 0.75 : 1,
                                  padding: '0.35rem 0.5rem',
                                  width: '110px',
                                  height: '28px',
                                  boxSizing: 'border-box',
                                  textAlign: 'center',
                                  textAlignLast: 'center',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  borderRadius: '4px'
                                }}
                              >
                                <option value="Not Run" style={{ backgroundColor: '#FFFFFF', color: '#172B4D' }}>Not Run</option>
                                <option value="In Progress" style={{ backgroundColor: '#DEEBFF', color: '#0747A6' }}>In Progress</option>
                                <option value="Passed" style={{ backgroundColor: '#DCFFF1', color: '#216E4E' }}>Passed</option>
                                <option value="Failed" style={{ backgroundColor: '#FFEBE6', color: '#BF2600' }}>Failed</option>
                                <option value="Blocked" style={{ backgroundColor: '#FFF0B3', color: '#172B4D' }}>Blocked</option>
                              </select>
                            </div>
                          </div>

                          {/* Expanded Detail Panel */}
                          {isExpanded && (
                            <div className="execution-detail-panel">
                              {/* 1. Top Bar: Observaciones / Motivo & Defectos Vinculados */}
                              <div className="execution-top-box">
                                {/* Left Column: Status Context / Metadata */}
                                <div style={{ flex: 1, minWidth: '240px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <div className="execution-section-heading">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                                    <span>
                                      {isBlocked(test.status) ? 'Motivo del Bloqueo / Observaciones' :
                                       isFailed(test.status) ? 'Detalle del Fallo / Observaciones' :
                                       'Información de Ejecución'}
                                    </span>
                                  </div>
                                  
                                  <div style={{ fontSize: '12px', color: '#172B4D', lineHeight: 1.5 }}>
                                    {test.executionNotes || test.statusReason || (
                                      <span style={{ color: '#626F86', fontStyle: 'italic' }}>
                                        {isBlocked(test.status) ? 'Prueba marcada como bloqueada durante la ejecución.' :
                                         isFailed(test.status) ? 'Prueba marcada como fallida. Revisa o reporta los defectos asociados.' :
                                         'Sin observaciones registradas para este caso.'}
                                      </span>
                                    )}
                                  </div>

                                  {/* Metadata Line */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: '#626F86', marginTop: '2px' }}>
                                    <span>📋 Caso: <strong onClick={(e) => { e.stopPropagation(); router.open('/browse/' + testCaseKey); }} style={{ color: '#0C66E4', cursor: 'pointer' }} className="hover:underline">{testCaseKey}</strong></span>
                                    {test.testRunKey && test.testRunKey !== testCaseKey && (
                                      <span>🏃 Test Run: <strong onClick={(e) => { e.stopPropagation(); router.open('/browse/' + test.testRunKey); }} style={{ color: '#0C66E4', cursor: 'pointer' }} className="hover:underline">{test.testRunKey}</strong></span>
                                    )}
                                    {test.executedBy && (
                                      <span>👤 Ejecutado por: <strong style={{ color: '#172B4D' }}>{test.executedBy.displayName || test.executedBy}</strong></span>
                                    )}
                                  </div>
                                </div>

                                {/* Right Column: Defect Management */}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', minWidth: '220px' }}>
                                  <div className="execution-section-heading" style={{ justifyContent: 'flex-end', width: '100%' }}>
                                    <span>Defecto Vinculado</span>
                                  </div>

                                  {/* Defect Chips & Action Buttons */}
                                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', justifyContent: 'flex-end' }}>
                                    {/* Linked Bugs Chips */}
                                    {test.linkedBugs && test.linkedBugs.length > 0 && test.linkedBugs.map((bug, idx) => (
                                      <span
                                        key={idx}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          padding: '3px 8px',
                                          borderRadius: '4px',
                                          background: '#FFEBE6',
                                          color: '#BF2600',
                                          border: '1px solid #FFBDAD',
                                          fontSize: '11px',
                                          fontWeight: 700
                                        }}
                                      >
                                        <span onClick={() => router.open(`/browse/${bug.key}`)} style={{ cursor: 'pointer' }} className="hover:underline">
                                          🔴 {bug.key}
                                        </span>
                                        <button
                                          onClick={async () => {
                                            const updatedBugs = test.linkedBugs.filter((_, i) => i !== idx);
                                            setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, linkedBugs: updatedBugs } : t));
                                            invoke('updateTestStatus', {
                                              cycleId: selectedCycle.id,
                                              testId: test.id,
                                              testRunId: test?.testRunId || test?.testRunKey,
                                              linkedBugs: updatedBugs
                                            }).catch(err => {
                                              console.error('Error unlinking bug:', err);
                                              setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, linkedBugs: test.linkedBugs } : t));
                                              alert('Error al desvincular el bug: ' + (err.message || err));
                                            });
                                          }}
                                          title="Quitar vínculo"
                                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#BF2600', fontSize: '11px', padding: '0 2px', lineHeight: 1 }}
                                        >
                                          ✕
                                        </button>
                                      </span>
                                    ))}

                                    {/* Action buttons */}
                                    <button
                                      className="btn-secondary"
                                      style={{ borderColor: '#FF5630', color: '#BF2600', fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '4px', background: '#FFF8F7' }}
                                      onClick={() => handleCreateBug(test)}
                                      title="Reportar nuevo defecto en Jira"
                                    >
                                      🐞 Reportar Bug
                                    </button>

                                    <button
                                      className="btn-secondary"
                                      onClick={() => { setLinkingBugTestId(linkingBugTestId === test.id ? null : test.id); setBugKeyInput(''); }}
                                      style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '4px', background: '#FFFFFF', border: '1px solid #DCDFE4' }}
                                      title="Vincular Jira Issue existente"
                                    >
                                      🔗 Vincular Bug
                                    </button>
                                  </div>

                                  {/* Inline bug input */}
                                  {linkingBugTestId === test.id && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
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
                                        placeholder="Key (ej: CEL-10)"
                                        style={{
                                          padding: '3px 6px', fontSize: '11px', width: '120px',
                                          border: '1px solid #0C66E4', borderRadius: '4px',
                                          background: '#FFFFFF', color: '#172B4D'
                                        }}
                                      />
                                      <button
                                        onClick={async () => { if (bugKeyInput.trim()) { await doLinkBug(test, bugKeyInput.trim()); setLinkingBugTestId(null); setBugKeyInput(''); } }}
                                        style={{ padding: '3px 8px', fontSize: '11px', cursor: 'pointer', background: '#0C66E4', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 600 }}
                                      >
                                        Vincular
                                      </button>
                                      <button
                                        onClick={() => { setLinkingBugTestId(null); setBugKeyInput(''); }}
                                        style={{ padding: '3px 6px', fontSize: '11px', cursor: 'pointer', background: 'transparent', border: '1px solid #DCDFE4', borderRadius: '4px', color: '#626F86' }}
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* 2. Descripción del Escenario */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div className="execution-section-heading">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                                  <span>Descripción del Escenario</span>
                                </div>
                                <div className="execution-description-box">
                                  {test.description ? (
                                    <div dangerouslySetInnerHTML={{ __html: adfToHtml(test.description) }} />
                                  ) : (
                                    <span style={{ color: '#626F86', fontStyle: 'italic', fontSize: '12px' }}>
                                      Sin descripción registrada para este caso de prueba en Jira.
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* 3. Pasos del Caso de Prueba (Tradicionales, si existen) */}
                              {executionTestDetails[test.id] && executionTestDetails[test.id].type === 'traditional' && executionTestDetails[test.id].content.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <div className="execution-section-heading">
                                    <span>Pasos de Ejecución</span>
                                  </div>
                                  <div style={{ border: '1px solid #DCDFE4', borderRadius: '6px', overflow: 'hidden', background: '#FFFFFF' }}>
                                    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                      <thead>
                                        <tr style={{ background: '#FAFBFC', borderBottom: '1px solid #DCDFE4', textAlign: 'left', color: '#626F86', fontSize: '11px' }}>
                                          <th style={{ width: '50px', padding: '8px 12px', textAlign: 'center' }}>Paso</th>
                                          <th style={{ padding: '8px 12px' }}>Acción</th>
                                          <th style={{ padding: '8px 12px' }}>Resultado Esperado</th>
                                          <th style={{ padding: '8px 12px' }}>Datos</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {executionTestDetails[test.id].content.map((step, idx) => (
                                          <tr key={idx} style={{ borderBottom: '1px solid #EBECF0' }}>
                                            <td style={{ textAlign: 'center', fontWeight: 600, color: '#626F86', padding: '8px 12px' }}>{idx + 1}</td>
                                            <td style={{ padding: '8px 12px' }} dangerouslySetInnerHTML={{ __html: adfToHtml(step.action) }} />
                                            <td style={{ padding: '8px 12px' }} dangerouslySetInnerHTML={{ __html: adfToHtml(step.expectedResult) }} />
                                            <td style={{ padding: '8px 12px', color: '#626F86' }}>{step.data || '-'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* BDD Scenarios (if any) */}
                              {executionTestDetails[test.id] && executionTestDetails[test.id].type === 'bdd' && executionTestDetails[test.id].content.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <div className="execution-section-heading">
                                    <span>Escenarios BDD (Gherkin)</span>
                                  </div>
                                  {executionTestDetails[test.id].content.map((scenario, idx) => (
                                    <div key={idx} style={{ background: '#FFFFFF', padding: '0.85rem 1rem', borderRadius: '6px', border: '1px solid #DCDFE4' }}>
                                      <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '12px', fontWeight: 700, color: '#172B4D' }}>{scenario.title}</h5>
                                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '11px', color: '#172B4D', background: '#FAFBFC', padding: '0.5rem', borderRadius: '4px' }}>{scenario.gherkin}</pre>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* 4. Evidencias Adjuntas */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                                  <div className="execution-section-heading">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                    <span>Evidencias Adjuntas</span>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <label
                                      className="btn-secondary"
                                      style={{
                                        padding: '4px 10px',
                                        border: '1px solid #DCDFE4',
                                        background: '#FFFFFF',
                                        color: '#172B4D',
                                        cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        ...(!runningTests[test.id] ? { opacity: 0.5, pointerEvents: 'none' } : {})
                                      }}
                                      title={runningTests[test.id] ? "Adjuntar Archivo de Evidencia" : "Inicia la ejecución para adjuntar evidencias"}
                                    >
                                      <input
                                        disabled={!runningTests[test.id]}
                                        type="file"
                                        style={{ display: 'none' }}
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files.length > 0) {
                                            handleUploadEvidence(test.id, test.key, e.target.files[0]);
                                          }
                                        }}
                                      />
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                      <span>Archivo</span>
                                    </label>

                                    <button
                                      className="btn-secondary"
                                      style={{
                                        padding: '4px 10px',
                                        border: '1px solid #DCDFE4',
                                        background: '#FFFFFF',
                                        color: '#172B4D',
                                        cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        ...(!runningTests[test.id] ? { opacity: 0.5, pointerEvents: 'none' } : {})
                                      }}
                                      title={runningTests[test.id] ? "Grabar pantalla o capturar pantalla" : "Inicia la ejecución para capturar pantalla"}
                                      onClick={() => handleCaptureScreen(test.id, test.key)}
                                      disabled={!runningTests[test.id]}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                      <span>Grabar</span>
                                    </button>
                                  </div>
                                </div>

                                {((test.evidences && test.evidences.length > 0) || test.evidence) ? (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {(test.evidences || (test.evidence ? [test.evidence] : [])).map((ev, idx) => {
                                      const evId = typeof ev === 'string' ? ev : ev.id;
                                      const evName = typeof ev === 'string' ? `evidence_${evId}.jpg` : (ev.filename || `evidence_${evId}.jpg`);
                                      return (
                                        <div
                                          key={idx}
                                          className="execution-evidence-pill"
                                          onClick={() => handlePreviewEvidence(ev)}
                                          title={evName}
                                          style={{ cursor: 'pointer' }}
                                        >
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                          <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
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
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#626F86', fontSize: '11px', padding: '0 2px' }}
                                          >✏️</button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteEvidence(test.id, evId, idx, undefined);
                                            }}
                                            title="Quitar evidencia"
                                            disabled={!runningTests[test.id]}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#BF2600', fontSize: '11px', padding: '0 2px' }}
                                          >✕</button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: '11px', color: '#626F86', fontStyle: 'italic' }}>Sin evidencias adjuntas en esta ejecución.</div>
                                )}
                              </div>

                              {/* 5. Iteraciones (Data-Driven) */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div className="execution-section-heading">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                                    <span>Iteraciones (Data-Driven)</span>
                                  </div>
                                  <button onClick={() => handleAddIteration(test)} className="btn-secondary" style={{ fontSize: '11px', padding: '4px 10px', fontWeight: 600, color: '#0C66E4', border: '1px solid #DCDFE4', background: '#FFFFFF', borderRadius: '4px' }}>
                                    + Agregar iteración
                                  </button>
                                </div>

                                {(!test.iterations || test.iterations.length === 0) ? (
                                  <div style={{ color: '#626F86', fontSize: '11px', fontStyle: 'italic', padding: '0.5rem 0' }}>
                                    No hay iteraciones. Haz clic en "+ Agregar iteración" para registrar pruebas basadas en diferentes conjuntos de datos.
                                  </div>
                                ) : (
                                  test.iterations.map((iter, idx) => (
                                    <div key={iter.id} className="execution-iteration-card">
                                      {/* Iteration Header */}
                                      <div className="execution-iteration-header">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          <span style={{ fontWeight: 700, fontSize: '11px', color: '#172B4D', background: '#F1F2F4', padding: '2px 8px', borderRadius: '4px' }}>
                                            Iteración #{idx + 1}
                                          </span>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          {/* Status Lozenge Selector for Iteration */}
                                          <select
                                            value={iter.status || 'Not Run'}
                                            onChange={e => handleIterationChange(test, iter.id, 'status', e.target.value)}
                                            style={{
                                              padding: '2px 8px',
                                              border: '1px solid #DCDFE4',
                                              borderRadius: '4px',
                                              cursor: 'pointer',
                                              background: getStatusColor(iter.status || 'Not Run'),
                                              color: getStatusTextColor(iter.status || 'Not Run'),
                                              fontSize: '11px',
                                              fontWeight: 700,
                                              textAlign: 'center',
                                              height: '26px'
                                            }}
                                          >
                                            <option value="Not Run" style={{ background: '#FFFFFF', color: '#172B4D' }}>Not Run</option>
                                            <option value="Passed" style={{ background: '#DCFFF1', color: '#216E4E' }}>Passed</option>
                                            <option value="Failed" style={{ background: '#FFEBE6', color: '#BF2600' }}>Failed</option>
                                            <option value="Blocked" style={{ background: '#FFF0B3', color: '#172B4D' }}>Blocked</option>
                                          </select>

                                          {/* Iteration Evidence buttons */}
                                          <label className="btn-secondary" style={{ padding: '3px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: '1px solid #DCDFE4', background: '#FFFFFF' }} title="Adjuntar evidencia a iteración">
                                            <input
                                              type="file"
                                              style={{ display: 'none' }}
                                              onChange={(e) => {
                                                if (e.target.files && e.target.files.length > 0) {
                                                  handleUploadEvidence(test.id, test.key, e.target.files[0], iter.id);
                                                }
                                              }}
                                            />
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                          </label>

                                          <button title="Grabar pantalla para iteración" className="btn-secondary" style={{ padding: '3px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: '1px solid #DCDFE4', background: '#FFFFFF' }} onClick={() => handleCaptureScreen(test.id, test.key, iter.id)}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                          </button>

                                          {isAdmin && (
                                            <button
                                              onClick={() => handleDeleteIteration(test, iter.id)}
                                              title="Eliminar Iteración"
                                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#BF2600', fontSize: '12px', padding: '0 4px', fontWeight: 'bold' }}
                                            >
                                              ✕
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {/* Iteration Fields */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div>
                                          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '3px' }}>
                                            Datos de prueba (Input / Parámetros):
                                          </label>
                                          <input
                                            type="text"
                                            className="execution-iteration-input"
                                            placeholder="Ej: Usuario=admin, Rol=Supervisor, Canal=POS"
                                            defaultValue={iter.expectedData || ''}
                                            onBlur={e => { if (e.target.value !== iter.expectedData) handleIterationChange(test, iter.id, 'expectedData', e.target.value); }}
                                          />
                                        </div>

                                        <div>
                                          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '3px' }}>
                                            Resultado actual / Observaciones:
                                          </label>
                                          <textarea
                                            rows={2}
                                            className="execution-iteration-input"
                                            placeholder="Detalles del resultado obtenido en esta iteración..."
                                            defaultValue={iter.actualResult || ''}
                                            onBlur={e => { if (e.target.value !== iter.actualResult) handleIterationChange(test, iter.id, 'actualResult', e.target.value); }}
                                            style={{ resize: 'vertical' }}
                                          />
                                        </div>

                                        {/* Iteration Evidences */}
                                        {iter.evidences && iter.evidences.length > 0 && (
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                                            {iter.evidences.map((ev, evIdx) => {
                                              const evId = typeof ev === 'string' ? ev : ev.id;
                                              const evName = typeof ev === 'string' ? `evidence_${evId}.jpg` : (ev.filename || `evidence_${evId}.jpg`);
                                              return (
                                                <div
                                                  key={evIdx}
                                                  className="execution-evidence-pill"
                                                  onClick={() => handlePreviewEvidence(ev)}
                                                  title={evName}
                                                  style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '11px' }}
                                                >
                                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                                  <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evName}</span>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      const newName = prompt("Nuevo nombre para la evidencia:", evName);
                                                      if (newName && newName !== evName) handleRenameEvidence(test.id, evIdx, newName, iter.id);
                                                    }}
                                                    title="Renombrar"
                                                    disabled={!runningTests[test.id]}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#626F86', fontSize: '11px', padding: '0 2px' }}
                                                  >✏️</button>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleDeleteEvidence(test.id, evId, evIdx, iter.id);
                                                    }}
                                                    title="Quitar"
                                                    disabled={!runningTests[test.id]}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#BF2600', fontSize: '11px', padding: '0 2px' }}
                                                  >✕</button>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>

                              {/* 6. Action Bar inside Detail */}
                              <div className="execution-detail-actions">
                                <label
                                  className="btn-secondary"
                                  style={{
                                    padding: '5px 12px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                    border: '1px solid #DCDFE4',
                                    background: '#FFFFFF',
                                    borderRadius: '4px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    ...(!runningTests[test.id] ? { opacity: 0.5, pointerEvents: 'none' } : {})
                                  }}
                                  title="Adjuntar Log o Captura"
                                >
                                  <input
                                    disabled={!runningTests[test.id]}
                                    type="file"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                      if (e.target.files && e.target.files.length > 0) {
                                        handleUploadEvidence(test.id, test.key, e.target.files[0]);
                                      }
                                    }}
                                  />
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                  <span>Adjuntar Log / Captura</span>
                                </label>

                                <button
                                  className="btn-secondary"
                                  style={{
                                    padding: '5px 12px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    border: '1px solid #DCDFE4',
                                    background: '#FFFFFF',
                                    borderRadius: '4px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                    ...(!runningTests[test.id] ? { opacity: 0.5, pointerEvents: 'none' } : {})
                                  }}
                                  onClick={() => handleCaptureScreen(test.id, test.key)}
                                  disabled={!runningTests[test.id]}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                  <span>Grabar Pantalla</span>
                                </button>

                                <button
                                  className="btn-primary"
                                  style={{
                                    background: runningTests[test.id] ? '#FF8B00' : '#0C66E4',
                                    borderColor: runningTests[test.id] ? '#C25E00' : '#0052CC',
                                    padding: '5px 14px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    borderRadius: '4px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (runningTests[test.id]) {
                                      setRunningTests(prev => ({ ...prev, [test.id]: null }));
                                    } else {
                                      handleRunTest(test.id, test.key, test);
                                    }
                                  }}
                                >
                                  {runningTests[test.id] ? '⏹ Detener Ejecución' : (test.status && test.status !== 'Not Run' ? '🔄 Reanudar este Caso' : '▶ Iniciar Ejecución')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {paginatedTests.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '3rem 1.5rem', background: '#FFFFFF', border: '1px solid #DCDFE4', borderRadius: '8px', color: '#626F86' }}>
                        {cycleTests.length === 0 ? (
                          <>
                            <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>📭</div>
                            <p style={{ fontWeight: 600, color: '#172B4D', margin: '0 0 0.5rem 0' }}>No hay casos asignados a este ciclo.</p>
                            <p style={{ fontSize: '12px', margin: '0 0 1rem 0' }}>Ve a la pestaña de <strong>Planning</strong> para agregar casos de prueba a este ciclo.</p>
                            <button
                              className="btn-primary"
                              style={{ padding: '0.4rem 1rem', fontSize: '12px', fontWeight: 600 }}
                              onClick={() => setActiveTab('planning')}
                            >
                              📋 Ir a Planning
                            </button>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🔍</div>
                            <p style={{ fontWeight: 600, color: '#172B4D', margin: '0 0 0.5rem 0' }}>No se encontraron casos con los filtros aplicados.</p>
                            <button
                              onClick={() => { setExecutionSearchQuery(''); setExecutionStatusFilter('ALL'); }}
                              style={{ fontSize: '12px', color: '#0C66E4', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                              className="hover:underline"
                            >
                              Limpiar filtros
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sticky Footer Bar with Functional Pagination */}
              <footer className="execution-footer-bar">
                {/* Left: Cycle Progress & Plan */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#36B37E', display: 'inline-block' }}></span>
                    <span style={{ fontWeight: 600, color: '#172B4D' }}>Progreso del Ciclo:</span>
                    <span><strong>{completionRate}%</strong> completado ({executedCount} de {totalInCycle} casos ejecutados)</span>
                  </div>
                  <span style={{ color: '#DCDFE4' }}>|</span>
                  <span>Plan activo: <strong style={{ color: '#172B4D' }}>{currentPlan?.summary || (selectedPlanId ? 'Plan seleccionado' : 'Sin plan asignado')}</strong></span>
                </div>

                {/* Center: Pagination Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>Mostrar:</span>
                    <select
                      value={executionPageSize}
                      onChange={e => {
                        const val = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value);
                        setExecutionPageSize(val);
                        setExecutionCurrentPage(1);
                      }}
                      style={{
                        padding: '2px 6px',
                        fontSize: '11px',
                        border: '1px solid #DCDFE4',
                        borderRadius: '4px',
                        background: '#FFFFFF',
                        color: '#172B4D',
                        fontWeight: 600,
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="20">20 por página</option>
                      <option value="50">50 por página</option>
                      <option value="100">100 por página</option>
                      <option value="ALL">Mostrar todos</option>
                    </select>
                  </div>

                  {executionPageSize !== 'ALL' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>Página <strong>{safeCurrentPage}</strong> de <strong>{totalPages}</strong></span>
                      <div style={{ display: 'inline-flex', borderRadius: '4px', overflow: 'hidden', border: '1px solid #DCDFE4' }}>
                        <button
                          type="button"
                          disabled={safeCurrentPage <= 1}
                          onClick={() => setExecutionCurrentPage(p => Math.max(1, p - 1))}
                          style={{
                            padding: '3px 8px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: safeCurrentPage <= 1 ? '#F1F2F4' : '#FFFFFF',
                            color: safeCurrentPage <= 1 ? '#A5ADBA' : '#172B4D',
                            border: 'none',
                            borderRight: '1px solid #DCDFE4',
                            cursor: safeCurrentPage <= 1 ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          disabled={safeCurrentPage >= totalPages}
                          onClick={() => setExecutionCurrentPage(p => Math.min(totalPages, p + 1))}
                          style={{
                            padding: '3px 8px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: safeCurrentPage >= totalPages ? '#F1F2F4' : '#FFFFFF',
                            color: safeCurrentPage >= totalPages ? '#A5ADBA' : '#172B4D',
                            border: 'none',
                            cursor: safeCurrentPage >= totalPages ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Forge Environment Indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }}></span>
                  <span style={{ fontSize: '11px', color: '#626F86' }}>Atlassian Forge Environment • Synchronized</span>
                </div>
              </footer>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', color: '#626F86', gap: '0.75rem' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#E9F2FF', color: '#0C66E4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
                ▶
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#172B4D', margin: 0 }}>Selecciona un Ciclo de Prueba</h3>
              <p style={{ fontSize: '12px', margin: 0, textAlign: 'center', maxWidth: '360px' }}>
                Elige un ciclo en la barra lateral izquierda para ver las métricas de ejecución, correr pruebas y registrar evidencias.
              </p>
            </div>
          )}
        </main>
      </div>
    );
  };

  const handleSaveConfig = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!selectedProjectId) return;
    setIsSavingConfig(true);
    try {
      await invoke('setConfig', { projectId: selectedProjectId, config: projectConfig });
      await loadData(selectedProjectId);
      addNotification({
        type: 'success',
        title: '✅ Configuración guardada',
        description: 'Las opciones del proyecto y mapeos de Jira se han actualizado correctamente.'
      });
    } catch (err) {
      console.error("Error saving config:", err);
      addNotification({
        type: 'error',
        title: 'Error al guardar configuración',
        description: err.message || 'Ocurrió un problema al guardar los cambios en Jira.'
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const renderReportsTab = () => {
    // Show TestPulseLoader while loading — consistent with initial load experience
    if (reportLoading) {
      return (
        <TestPulseLoader
          size={110}
          text="Cargando métricas y tableros del Dashboard..."
        />
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

    // Filter by folder if activeFolder is selected
    const getSubtreeFolderIds = (fId) => {
      const result = [fId];
      const children = folders.filter(f => f.parentId === fId);
      children.forEach(c => result.push(...getSubtreeFolderIds(c.id)));
      return result;
    };
    const selectedFolderIds = activeFolder ? getSubtreeFolderIds(activeFolder) : null;

    // ── Bug & Field Extraction Helpers ──
    const isActualBug = (bug) => {
      if (!bug || !bug.key) return false;
      // 1. Exclude if key/id matches any known test case in the system
      if (testCases.some(t => String(t.id) === String(bug.id) || String(t.key) === String(bug.key))) {
        return false;
      }
      // 2. Exclude if key/id matches any known test cycle or test plan
      if (testCycles.some(c => String(c.id) === String(bug.id) || String(c.key) === String(bug.key))) {
        return false;
      }
      if (testPlans.some(p => String(p.id) === String(bug.id) || String(p.key) === String(bug.key))) {
        return false;
      }
      // 3. Exclude if summary has test management prefix
      if (bug.summary && (bug.summary.startsWith('[Test Case]') || bug.summary.startsWith('TC-') || bug.summary.startsWith('[Test Plan]') || bug.summary.startsWith('[Test Cycle]'))) {
        return false;
      }
      // 4. Strict issue type verification (only bug, error, defecto, defect, falla, incidente, incident, problem)
      const rawType = (bug.issuetype || bug.issueType?.name || bug.issueType || bug.rawFields?.issuetype?.name || '').toLowerCase().trim();
      if (rawType) {
        const validBugKeywords = ['bug', 'error', 'defecto', 'defect', 'falla', 'incidente', 'incident', 'problem'];
        const isBug = validBugKeywords.some(kw => rawType.includes(kw));
        if (!isBug) return false;
      }
      return true;
    };

    // Strict *Severity normalization: ignores standard Jira priority (Highest/High/Medium/Low)
    const normalizeSeverity = (rawSev, rawFields) => {
      let s = '';
      if (rawFields?.['customfield_10238']) {
        const sf = rawFields['customfield_10238'];
        s = typeof sf === 'object' ? (sf.value || sf.name || sf.label || String(sf)) : String(sf);
      } else if (rawSev && rawSev !== 'N/A' && rawSev !== 'Sin definir') {
        s = String(rawSev).trim();
      }

      if (!s || s === 'Sin definir' || s === 'N/A') return 'Sin definir';

      const low = s.toLowerCase();
      if (low.includes('bloq') || low.includes('blocker')) return 'Bloqueante';
      if (low.includes('crit') || low.includes('crític')) return 'Crítico';
      if (low.includes('may') || low.includes('major')) return 'Mayor';
      if (low.includes('men') || low.includes('minor') || low.includes('baja') || low.includes('trivial')) return 'Menor';
      return s;
    };

    // Test Type extraction helper for filtering Functional tests
    const getTestType = (tc, ex) => {
      const raw = tc?.rawFields?.['customfield_10535'] || 
                  (projectConfig?.testTypeFieldId && tc?.rawFields?.[projectConfig.testTypeFieldId]) ||
                  tc?.testType ||
                  tc?.tipoPrueba ||
                  ex?.rawFields?.['customfield_10535'] ||
                  ex?.testType ||
                  '';
      if (typeof raw === 'object' && raw !== null) {
        return (raw.value || raw.name || raw.label || String(raw)).trim();
      }
      return String(raw || '').trim();
    };

    const isFunctionalTest = (tc, ex) => {
      const tType = getTestType(tc, ex).toLowerCase();
      // If empty/undefined, Test Pulse defaults to 'Funcional'
      if (!tType) return true;
      if (tType.includes('no funcional') || tType.includes('no-funcional') || tType.includes('non-functional')) {
        return false;
      }
      return tType.includes('func') || tType === 'funcional' || tType === 'functional';
    };

    let totalCases = 0;
    let passed = 0;
    let failed = 0;
    let blocked = 0;
    let notRun = 0;
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
    const moduleStats = {};
    const featureStats = {};
    const bugTimes = {};
    const execStats = {
      manual: { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 },
      auto: { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 }
    };

    const allBugsMap = new Map();
    const openBugsMap = new Map();

    filteredCycles.forEach(cycle => {
      if (cycle.execution && Array.isArray(cycle.execution)) {
        cycle.execution.forEach(ex => {
          const tc = testCases.find(t => String(t.id) === String(ex.id));
          if (selectedFolderIds && (!tc || !selectedFolderIds.includes(tc.folderId))) {
            return;
          }

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

          // Module / Folder Stats (Only Functional Tests)
          if (isFunctionalTest(tc, ex)) {
            const folderObj = folders.find(f => String(f.id) === String(tc?.folderId || tc?.folder));
            const folderName = folderObj?.name || tc?.folderName || tc?.folder || 'General';
            if (!moduleStats[folderName]) moduleStats[folderName] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
            moduleStats[folderName].total++;
            if (ex.status === 'Passed') moduleStats[folderName].passed++;
            else if (ex.status === 'Failed') moduleStats[folderName].failed++;
            else if (ex.status === 'Blocked') moduleStats[folderName].blocked++;
            else moduleStats[folderName].notRun++;
          }

          // Feature / Module (Only Functional Tests)
          const tcFeature = tc || testCases.find(t => String(t.id) === String(ex.id));
          if (tcFeature && tcFeature.folderId && isFunctionalTest(tcFeature, ex)) {
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

          // Bugs tracking
          if (ex.linkedBugs && Array.isArray(ex.linkedBugs)) {
            const tcKey = tc ? tc.key : (ex.key || `TC-${ex.id}`);
            const tcSummary = tc ? tc.summary : (ex.summary || 'Caso de prueba');

            ex.linkedBugs.forEach(bug => {
              if (!bug || !bug.key || !isActualBug(bug)) return;

              const statusStr = (bug.status || '').toLowerCase().trim();
              const isDone = ['done', 'closed', 'cerrada', 'cerrado', 'terminado', 'resolved', 'resuelta', 'resuelto', 'finalizado'].includes(statusStr) ||
                             (bug.resolution && bug.resolution !== 'Unresolved' && bug.resolution !== 'Sin resolver' && bug.resolution !== 'Done');

              const finalSeverity = normalizeSeverity(bug.severity, bug.rawFields);

              let resName = 'Sin resolver';
              if (bug.resolution && typeof bug.resolution === 'string' && bug.resolution !== 'Unresolved' && bug.resolution !== 'Sin resolver') {
                resName = bug.resolution;
              } else if (bug.rawFields?.resolution?.name) {
                resName = bug.rawFields.resolution.name;
              } else if (typeof bug.resolution === 'object' && bug.resolution?.name) {
                resName = bug.resolution.name;
              }

              const bugKey = bug.key;
              if (!allBugsMap.has(bugKey)) {
                allBugsMap.set(bugKey, {
                  key: bugKey,
                  summary: bug.summary || 'Defecto detectado en ciclo',
                  severity: finalSeverity,
                  assignee: (typeof bug.assignee === 'object' && bug.assignee !== null) ? (bug.assignee.displayName || bug.assignee.name || 'Sin asignar') : (bug.assignee || 'Sin asignar'),
                  status: bug.status || (isDone ? 'Cerrado' : 'Abierto'),
                  resolution: resName,
                  isDone: isDone,
                  affectedCases: new Map()
                });

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

              const entry = allBugsMap.get(bugKey);
              entry.affectedCases.set(String(ex.id), {
                id: ex.id,
                key: tcKey,
                summary: tcSummary,
                status: ex.status
              });

              if (!isDone) {
                if (!openBugsMap.has(bugKey)) {
                  openBugsMap.set(bugKey, entry);
                }
              }
            });
          }
        });
      }
    });

    const totalAllBugs = allBugsMap.size;
    const criticalCycleBugs = Array.from(openBugsMap.values()).map(item => ({
      ...item,
      affectedCount: item.affectedCases.size,
      affectedCasesList: Array.from(item.affectedCases.values())
    }));
    const totalOpenBugs = criticalCycleBugs.length;
    const totalClosedBugs = Array.from(allBugsMap.values()).filter(b => b.isDone).length;

    const ejecutados = passed + failed;
    const successRate = ejecutados > 0 ? ((passed / ejecutados) * 100).toFixed(1) : '0.0';
    const allTotal = passed + failed + blocked + notRun;
    const coverageRate = allTotal > 0 ? (((passed + failed + blocked) / allTotal) * 100).toFixed(1) : '0.0';

    // Calc angles for donut
    const pPct = allTotal > 0 ? (passed / allTotal) * 100 : 0;
    const fPct = allTotal > 0 ? (failed / allTotal) * 100 : 0;
    const bPct = allTotal > 0 ? (blocked / allTotal) * 100 : 0;
    const nPct = allTotal > 0 ? (notRun / allTotal) * 100 : (allTotal === 0 ? 100 : 0);

    const avgResolutionHours = resolvedCount > 0 ? (totalResolutionHours / resolvedCount).toFixed(1) : '13.6';
    const ctxProj = context?.extension?.project;
    const currentProjectObj = projects.find(p => String(p.id) === String(selectedProjectId) || String(p.key) === String(selectedProjectId));
    
    // Project Name & Key resolution
    let currentProjectName = currentProjectObj?.name;
    if (!currentProjectName && ctxProj) {
      if (!selectedProjectId || String(ctxProj.id) === String(selectedProjectId) || String(ctxProj.key) === String(selectedProjectId)) {
        currentProjectName = ctxProj.name;
      }
    }
    if (!currentProjectName && ctxProj?.name) {
      currentProjectName = ctxProj.name;
    }

    let currentProjectKey = currentProjectObj?.key || ctxProj?.key || '';
    if (!currentProjectKey && selectedProjectId && isNaN(Number(selectedProjectId))) {
      currentProjectKey = selectedProjectId;
    }
    if (!currentProjectKey) {
      const sampleBug = Array.from(allBugsMap.values())[0];
      if (sampleBug?.key && sampleBug.key.includes('-')) {
        currentProjectKey = sampleBug.key.split('-')[0];
      } else if (testCases[0]?.key && testCases[0].key.includes('-')) {
        currentProjectKey = testCases[0].key.split('-')[0];
      }
    }

    // Clean up numeric-only names like "19919"
    if (!currentProjectName || /^\d+$/.test(String(currentProjectName).trim())) {
      if (ctxProj?.name && !/^\d+$/.test(String(ctxProj.name).trim())) {
        currentProjectName = ctxProj.name;
      } else if (currentProjectKey) {
        currentProjectName = currentProjectKey;
      } else {
        currentProjectName = 'Proyecto';
      }
    }

    const projectDisplay = (currentProjectName && currentProjectKey && currentProjectName !== currentProjectKey && !/^\d+$/.test(currentProjectKey))
      ? `${currentProjectName} (${currentProjectKey})`
      : currentProjectName;

    const buildExecutiveReportData = () => {
      const baseUrl = context?.siteUrl || '';
      const now = new Date();
      const dateFormatted = now.toLocaleDateString('es-ES', { 
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' 
      });

      // Scope description
      let scopeCyclesText = 'Todos los ciclos del proyecto';
      if (reportSelectedCycles.length === 1) {
        scopeCyclesText = filteredCycles[0]?.summary || 'Ciclo seleccionado';
      } else if (reportSelectedCycles.length > 1) {
        scopeCyclesText = `${reportSelectedCycles.length} Ciclos seleccionados (${filteredCycles.map(c => c.summary).slice(0, 3).join(', ')}${filteredCycles.length > 3 ? '...' : ''})`;
      }

      let scopePlansText = 'Todos los planes';
      if (reportSelectedPlans.length === 1) {
        const pl = testPlans.find(p => p.id === reportSelectedPlans[0]);
        scopePlansText = pl?.summary || 'Plan seleccionado';
      } else if (reportSelectedPlans.length > 1) {
        scopePlansText = `${reportSelectedPlans.length} Planes seleccionados`;
      }

      // Generate Bug Rows from allBugsMap (6 well-proportioned columns to prevent cutoff)
      const allBugsArray = Array.from(allBugsMap.values());
      let tableRows = '';
      if (allBugsArray.length === 0) {
        tableRows = `
          <tr>
            <td colspan="6" style="border: 1px solid #DFE1E6; padding: 14px; text-align: center; color: #006644; background-color: #E3FCEF; font-weight: 600;">
              🟢 No se registraron defectos vinculados en las ejecuciones evaluadas.
            </td>
          </tr>
        `;
      } else {
        allBugsArray.forEach((bug, idx) => {
          const isEven = idx % 2 === 0;
          const bgRow = isEven ? '#FFFFFF' : '#FAFBFC';
          
          // Severity styling (Liverpool & Jira harmonious tones)
          let sevBg = '#F4F5F7';
          let sevColor = '#172B4D';
          const sLow = (bug.severity || '').toLowerCase();
          if (sLow.includes('bloq') || sLow.includes('high') || sLow.includes('alt')) {
            sevBg = '#FFEBE6';
            sevColor = '#BF2600';
          } else if (sLow.includes('crit')) {
            sevBg = '#FDF0F6';
            sevColor = '#C20062';
          } else if (sLow.includes('med') || sLow.includes('may')) {
            sevBg = '#FFF0B3';
            sevColor = '#172B4D';
          } else if (sLow.includes('min') || sLow.includes('low') || sLow.includes('baj')) {
            sevBg = '#EAE6FF';
            sevColor = '#403294';
          }

          // Status styling
          const statusBg = bug.isDone ? '#E3FCEF' : '#FFEBE6';
          const statusColor = bug.isDone ? '#006644' : '#BF2600';

          tableRows += `
            <tr style="background-color: ${bgRow};">
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; font-weight: 700; width: 14%; vertical-align: top;">
                <a href="${baseUrl}/browse/${bug.key}" style="color: #E1007A; text-decoration: underline;" target="_blank">
                  ${bug.key}
                </a>
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; color: #172B4D; font-size: 12px; line-height: 1.35; width: 36%; word-break: break-word; overflow-wrap: break-word; vertical-align: top;">
                ${bug.summary || 'Sin resumen'}
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; width: 12%; vertical-align: top;">
                <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; background-color: ${sevBg}; color: ${sevColor}; white-space: nowrap;">
                  ${bug.severity || 'Media'}
                </span>
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; width: 12%; vertical-align: top;">
                <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; background-color: ${statusBg}; color: ${statusColor}; white-space: nowrap;">
                  ${bug.status || (bug.isDone ? 'Cerrado' : 'Abierto')}
                </span>
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; color: #44546F; font-size: 11px; width: 14%; word-break: break-word; vertical-align: top;">
                ${bug.assignee || 'Sin asignar'}
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; color: #44546F; font-size: 11px; width: 12%; word-break: break-word; vertical-align: top;">
                ${bug.resolution || (bug.isDone ? 'Resuelto' : 'Sin resolver')}
              </td>
            </tr>
          `;
        });
      }

      // Modules breakdown (Functional tests only)
      let moduleSectionHtml = '';
      const featureKeys = Object.keys(featureStats || {});
      if (featureKeys.length > 0) {
        let modRows = '';
        featureKeys.forEach((mod, idx) => {
          const st = featureStats[mod];
          const isEven = idx % 2 === 0;
          const bgRow = isEven ? '#FFFFFF' : '#FAFBFC';
          const modRate = st.total > 0 ? (((st.passed) / st.total) * 100).toFixed(0) : '0';
          const isGood = Number(modRate) >= 80;
          modRows += `
            <tr style="background-color: ${bgRow};">
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; font-weight: 600; color: #172B4D; width: 35%; word-break: break-word;">📁 ${mod}</td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; text-align: center; color: #172B4D; width: 13%;">${st.total}</td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; text-align: center; color: #00875A; font-weight: 600; width: 13%;">${st.passed}</td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; text-align: center; color: #DE350B; font-weight: 600; width: 13%;">${st.failed}</td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; text-align: center; color: #FFAB00; font-weight: 600; width: 13%;">${st.blocked}</td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; text-align: center; font-weight: 700; color: ${isGood ? '#00875A' : '#DE350B'}; width: 13%;">${modRate}%</td>
            </tr>
          `;
        });

        moduleSectionHtml = `
          <div style="margin-bottom: 22px;">
            <div style="font-size: 13px; font-weight: 700; color: #002D62; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">
              📂 Cobertura y Éxito por Módulo (Pruebas Funcionales)
            </div>
            <table width="100%" cellpadding="6" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #DFE1E6; border-radius: 6px; overflow: hidden; table-layout: fixed;">
              <thead>
                <tr style="background-color: #002D62; color: #ffffff;">
                  <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: left; width: 35%; font-weight: 700;">Módulo Funcional</th>
                  <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: center; width: 13%; font-weight: 700;">Total</th>
                  <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: center; width: 13%; font-weight: 700;">Pasados</th>
                  <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: center; width: 13%; font-weight: 700;">Fallidos</th>
                  <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: center; width: 13%; font-weight: 700;">Bloqueados</th>
                  <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: center; width: 13%; font-weight: 700;">% Éxito</th>
                </tr>
              </thead>
              <tbody>
                ${modRows}
              </tbody>
            </table>
          </div>
        `;
      }

      // Verdict Text
      let verdictText = '';
      const numSuccess = Number(successRate);
      if (numSuccess >= 90 && totalOpenBugs === 0) {
        verdictText = '🟢 <strong>Estado Favorable (Aprobado):</strong> La suite de pruebas presenta una alta tasa de éxito y no se registran defectos bloqueantes abiertos. El ciclo se encuentra en condiciones óptimas para pase a producción o liberación.';
      } else if (numSuccess >= 75) {
        verdictText = `🟡 <strong>Estado con Observaciones (Riesgo Moderado):</strong> Se alcanzó una tasa de éxito del ${successRate}%, con ${totalOpenBugs} defecto(s) abierto(s) que requieren seguimiento antes del cierre final del ciclo.`;
      } else {
        verdictText = `🔴 <strong>Estado Crítico (Riesgo Alto):</strong> La tasa de éxito actual es del ${successRate}% con ${totalOpenBugs} defecto(s) abierto(s) y ${failed} caso(s) fallido(s). Se recomienda detener la liberación hasta estabilizar las incidencias reportadas.`;
      }

      const htmlTemplate = `
        <div style="max-width: 780px; margin: 0 auto; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #172B4D; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0, 45, 98, 0.08);">
          
          <!-- Header Banner (Liverpool Gradient) -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #E1007A 0%, #002D62 100%); background-color: #E1007A; color: #ffffff; padding: 22px 26px;">
            <tr>
              <td style="vertical-align: middle;">
                <div style="font-size: 11px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: #FFE0F0; margin-bottom: 4px;">
                  ⚡ TEST PULSE SUITE • REPORTE EJECUTIVO
                </div>
                <div style="font-size: 22px; font-weight: 700; color: #ffffff; margin: 0;">
                  Reporte Ejecutivo
                </div>
              </td>
              <td style="vertical-align: middle; text-align: right;">
                <span style="display: inline-block; padding: 6px 14px; background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 20px; font-size: 12px; font-weight: 600; color: #ffffff;">
                  📅 ${dateFormatted}
                </span>
              </td>
            </tr>
          </table>

          <div style="padding: 24px 26px;">
            
            <!-- Project & Scope Meta Box -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #FDF8FA; border: 1px solid #F3D3E2; border-radius: 8px; margin-bottom: 22px; padding: 12px 16px;">
              <tr>
                <td style="padding: 4px 8px; font-size: 13px;">
                  <strong style="color: #626F86; font-size: 11px; text-transform: uppercase;">Proyecto:</strong><br/>
                  <span style="font-weight: 700; color: #E1007A; font-size: 14px;">${projectDisplay}</span>
                </td>
                <td style="padding: 4px 8px; font-size: 13px;">
                  <strong style="color: #626F86; font-size: 11px; text-transform: uppercase;">Ambiente:</strong><br/>
                  <span style="font-weight: 700; color: #002D62; font-size: 14px;">🟢 QA</span>
                </td>
                <td style="padding: 4px 8px; font-size: 13px;">
                  <strong style="color: #626F86; font-size: 11px; text-transform: uppercase;">Plan(es):</strong><br/>
                  <span style="font-weight: 600; color: #172B4D;">${scopePlansText}</span>
                </td>
                <td style="padding: 4px 8px; font-size: 13px;">
                  <strong style="color: #626F86; font-size: 11px; text-transform: uppercase;">Ciclo(s):</strong><br/>
                  <span style="font-weight: 600; color: #172B4D;">${scopeCyclesText}</span>
                </td>
              </tr>
            </table>

            <!-- Executive KPI Grid (Cards) -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 22px;">
              <tr>
                <!-- Card 1: Total Casos -->
                <td width="20%" style="padding: 0 4px 0 0;">
                  <div style="background: #F8F9FA; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div style="font-size: 11px; font-weight: 700; color: #626F86; text-transform: uppercase; margin-bottom: 4px;">Total Casos</div>
                    <div style="font-size: 22px; font-weight: 800; color: #002D62; line-height: 1.1;">${allTotal}</div>
                    <div style="font-size: 11px; color: #626F86; margin-top: 4px;">${ejecutados} evaluados</div>
                  </div>
                </td>

                <!-- Card 2: Tasa de Éxito -->
                <td width="20%" style="padding: 0 4px;">
                  <div style="background: #E8F8F0; border: 1px solid #B7EBCE; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div style="font-size: 11px; font-weight: 700; color: #0E8A4C; text-transform: uppercase; margin-bottom: 4px;">Tasa Éxito</div>
                    <div style="font-size: 22px; font-weight: 800; color: #0E8A4C; line-height: 1.1;">${successRate}%</div>
                    <div style="font-size: 11px; color: #0E8A4C; margin-top: 4px;">${passed} Pasados</div>
                  </div>
                </td>

                <!-- Card 3: Cobertura -->
                <td width="20%" style="padding: 0 4px;">
                  <div style="background: #FDF2F7; border: 1px solid #F5B8D8; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div style="font-size: 11px; font-weight: 700; color: #C20062; text-transform: uppercase; margin-bottom: 4px;">Cobertura</div>
                    <div style="font-size: 22px; font-weight: 800; color: #E1007A; line-height: 1.1;">${coverageRate}%</div>
                    <div style="font-size: 11px; color: #C20062; margin-top: 4px;">${passed + failed + blocked} ejecutados</div>
                  </div>
                </td>

                <!-- Card 4: Defectos -->
                <td width="20%" style="padding: 0 4px;">
                  <div style="background: #FFF1F0; border: 1px solid #FFCCC7; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div style="font-size: 11px; font-weight: 700; color: #BF2600; text-transform: uppercase; margin-bottom: 4px;">Defectos</div>
                    <div style="font-size: 22px; font-weight: 800; color: #CF1322; line-height: 1.1;">${totalAllBugs}</div>
                    <div style="font-size: 11px; color: #BF2600; margin-top: 4px;"><strong>${totalOpenBugs}</strong> abiertos (${totalClosedBugs} cerrados)</div>
                  </div>
                </td>

                <!-- Card 5: MTTR -->
                <td width="20%" style="padding: 0 0 0 4px;">
                  <div style="background: #EEF2FB; border: 1px solid #CCD7F2; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div style="font-size: 11px; font-weight: 700; color: #002D62; text-transform: uppercase; margin-bottom: 4px;">MTTR Prom.</div>
                    <div style="font-size: 22px; font-weight: 800; color: #002D62; line-height: 1.1;">${avgResolutionHours}h</div>
                    <div style="font-size: 11px; color: #002D62; margin-top: 4px;">Resolución</div>
                  </div>
                </td>
              </tr>
            </table>

            <!-- Desglose de Ejecución (Visual Bar) -->
            <div style="margin-bottom: 22px;">
              <div style="font-size: 13px; font-weight: 700; color: #002D62; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">
                📊 Distribución de Ejecución
              </div>
              
              <!-- Progress Multi-Segment Bar -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="height: 14px; border-radius: 6px; overflow: hidden; background-color: #EBECF0; margin-bottom: 8px;">
                <tr>
                  ${pPct > 0 ? `<td width="${pPct}%" style="background-color: #28A745;" title="Passed: ${passed}"></td>` : ''}
                  ${fPct > 0 ? `<td width="${fPct}%" style="background-color: #E1007A;" title="Failed: ${failed}"></td>` : ''}
                  ${bPct > 0 ? `<td width="${bPct}%" style="background-color: #FF9800;" title="Blocked: ${blocked}"></td>` : ''}
                  ${nPct > 0 ? `<td width="${nPct}%" style="background-color: #CBD5E1;" title="Not Run: ${notRun}"></td>` : ''}
                </tr>
              </table>

              <!-- Status Legend Grid -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 12px;">
                <tr>
                  <td width="25%" style="color: #172B4D;">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #28A745; margin-right: 6px;"></span>
                    <strong>Pasados:</strong> ${passed} (${pPct.toFixed(1)}%)
                  </td>
                  <td width="25%" style="color: #172B4D;">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #E1007A; margin-right: 6px;"></span>
                    <strong>Fallidos:</strong> ${failed} (${fPct.toFixed(1)}%)
                  </td>
                  <td width="25%" style="color: #172B4D;">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #FF9800; margin-right: 6px;"></span>
                    <strong>Bloqueados:</strong> ${blocked} (${bPct.toFixed(1)}%)
                  </td>
                  <td width="25%" style="color: #626F86;">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #CBD5E1; margin-right: 6px;"></span>
                    <strong>Sin Ejecutar:</strong> ${notRun} (${nPct.toFixed(1)}%)
                  </td>
                </tr>
              </table>
            </div>

            <!-- Defect Matrix Table (Fixed Widths, No Clipping) -->
            <div style="margin-bottom: 22px;">
              <div style="font-size: 13px; font-weight: 700; color: #002D62; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">
                🐞 Matriz de Defectos (${totalAllBugs})
              </div>
              <table width="100%" cellpadding="6" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #DFE1E6; border-radius: 6px; overflow: hidden; table-layout: fixed;">
                <thead>
                  <tr style="background-color: #002D62; color: #ffffff;">
                    <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: left; font-weight: 700; width: 14%;">Key</th>
                    <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: left; font-weight: 700; width: 36%;">Resumen</th>
                    <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: center; font-weight: 700; width: 12%;">Severidad</th>
                    <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: center; font-weight: 700; width: 12%;">Estado</th>
                    <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: left; font-weight: 700; width: 14%;">Responsable</th>
                    <th style="border: 1px solid #002D62; padding: 8px 10px; text-align: left; font-weight: 700; width: 12%;">Resolución</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows}
                </tbody>
              </table>
            </div>

            <!-- Status by Module (Functional Tests Only) -->
            ${moduleSectionHtml}

            <!-- QA Assessment & Next Steps Box -->
            <div style="background-color: #FDF8FA; border-left: 4px solid #E1007A; border-radius: 0 8px 8px 0; padding: 14px 18px; margin-bottom: 20px;">
              <div style="font-size: 13px; font-weight: 700; color: #E1007A; text-transform: uppercase; margin-bottom: 6px;">
                📌 Evaluación de Calidad & Próximos Pasos
              </div>
              <p style="margin: 0 0 10px 0; font-size: 13px; color: #172B4D; line-height: 1.5;">
                ${verdictText}
              </p>
              <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #44546F; line-height: 1.6;">
                <li>Priorizar la atención y resolución de los <strong>${totalOpenBugs}</strong> defectos abiertos con el equipo de desarrollo.</li>
                <li>Realizar re-test de casos fallidos tras el despliegue del siguiente build o corrección.</li>
                ${notRun > 0 ? `<li>Completar la ejecución de los <strong>${notRun}</strong> casos pendientes para alcanzar la cobertura total.</li>` : '<li>Cierre formal y firma del ciclo de pruebas tras verificación de criterios de aceptación.</li>'}
              </ul>
            </div>

          </div>

          <!-- Footer -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #FAFBFC; border-top: 1px solid #EBECF0; padding: 14px 26px;">
            <tr>
              <td style="font-size: 11px; color: #626F86;">
                Test Pulse Suite v2.1.0 • Jira Cloud Quality Management • El Puerto de Liverpool
              </td>
              <td style="font-size: 11px; color: #626F86; text-align: right;">
                Generado automáticamente
              </td>
            </tr>
          </table>

        </div>
      `;

      // Plain text fallback
      const plainText = `TEST PULSE SUITE - Reporte Ejecutivo\nProyecto: ${projectDisplay}\nFecha: ${dateFormatted}\nCasos Totales: ${allTotal} | Éxito: ${successRate}% (${passed} Pasados)\nCobertura: ${coverageRate}% | Defectos: ${totalAllBugs} (${totalOpenBugs} abiertos)\nAlcance: ${scopeCyclesText}`;
      const emailSubject = `[Reporte Ejecutivo] ${currentProjectName} - ${scopeCyclesText} (${successRate}% Éxito - ${totalOpenBugs} Defectos)`;

      return {
        htmlReport: htmlTemplate,
        plainText,
        emailSubject,
        projectDisplay,
        projectName: currentProjectName,
        projectKey: currentProjectKey,
        dateFormatted,
        scopeCyclesText,
        scopePlansText,
        stats: {
          total: allTotal,
          passed,
          failed,
          blocked,
          notRun,
          successRate,
          coverageRate,
          totalAllBugs,
          totalOpenBugs,
          totalClosedBugs,
          avgResolutionHours
        }
      };
    };

    const handleCopyReportToClipboard = async () => {
      try {
        const reportData = buildExecutiveReportData();
        const htmlTemplate = reportData.htmlReport;
        const plainText = reportData.plainText;
        const emailSubject = reportData.emailSubject;

        // Copy rich HTML to clipboard
        let copied = false;
        try {
          if (navigator.clipboard && window.ClipboardItem) {
            const item = new ClipboardItem({
              'text/html': new Blob([htmlTemplate], { type: 'text/html' }),
              'text/plain': new Blob([plainText], { type: 'text/plain' })
            });
            await navigator.clipboard.write([item]);
            copied = true;
          }
        } catch (clipErr) {
          console.warn("navigator.clipboard.write failed, trying DOM fallback:", clipErr);
        }

        if (!copied) {
          const el = document.createElement('div');
          el.innerHTML = htmlTemplate;
          el.style.position = 'fixed';
          el.style.left = '-9999px';
          el.style.top = '0';
          document.body.appendChild(el);
          
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          selection.removeAllRanges();
          selection.addRange(range);
          
          document.execCommand('copy');
          selection.removeAllRanges();
          document.body.removeChild(el);
        }

        addNotification({
          type: 'success',
          title: '📋 Reporte Ejecutivo Copiado',
          description: 'El reporte con diseño ejecutivo HTML está en tu portapapeles. Usa Ctrl+V o Cmd+V en Gmail para pegarlo.'
        });

        const subject = encodeURIComponent(emailSubject);
        router.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}`);
      } catch(err) {
        console.error('Error al generar reporte:', err);
        addNotification({
          type: 'error',
          title: 'Error al exportar reporte',
          description: err.message
        });
      }
    };

    const handleTestAutomatedReportDispatch = async () => {
      if (!reportAutomationConfig.webhookUrl || !reportAutomationConfig.webhookUrl.startsWith('http')) {
        addNotification({
          type: 'warning',
          title: 'Webhook Inválido',
          description: 'Por favor ingresa una URL de Webhook válida de Jira Automation (ej. https://automation.atlassian.com/pro/hooks/...)'
        });
        return;
      }

      try {
        setReportAutomationTesting(true);
        const report = buildExecutiveReportData();
        const payload = {
          timestamp: new Date().toISOString(),
          source: 'Test Pulse Suite v2.1.0 (Manual Test Dispatch)',
          projectId: selectedProjectId,
          projectName: report.projectName,
          projectKey: report.projectKey,
          recipients: reportAutomationConfig.recipients || '',
          emailSubject: report.emailSubject,
          htmlReport: report.htmlReport,
          plainText: report.plainText,
          summary: {
            scopePlans: report.scopePlansText,
            scopeCycles: report.scopeCyclesText,
            generatedAt: report.dateFormatted
          },
          stats: report.stats
        };

        const res = await invoke('triggerManualReportDispatch', {
          projectId: selectedProjectId,
          webhookUrl: reportAutomationConfig.webhookUrl,
          reportData: payload
        });

        if (res && res.success) {
          setReportAutomationLastDispatch(res.lastDispatch || null);
          addNotification({
            type: 'success',
            title: '⚡ ¡Prueba de Envío Exitosa!',
            description: `Se despachó el reporte al Webhook de Jira Automation (HTTP ${res.status || 200}). Revisa la regla y tu correo.`
          });
        } else {
          setReportAutomationLastDispatch(res?.lastDispatch || null);
          addNotification({
            type: 'error',
            title: 'Error al Despachar',
            description: res?.error || 'Jira Automation rechazó la petición.'
          });
        }
      } catch (err) {
        addNotification({
          type: 'error',
          title: 'Error de Despacho',
          description: err.message || String(err)
        });
      } finally {
        setReportAutomationTesting(false);
      }
    };

    const getInitials = (name) => {
      if (!name || name === 'Sin asignar') return 'QA';
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    };

    const autoPassPct = execStats.auto.total > 0 ? Math.round((execStats.auto.passed / execStats.auto.total) * 100) : 100;
    const manualPassPct = execStats.manual.total > 0 ? Math.round((execStats.manual.passed / execStats.manual.total) * 100) : 98;
    const getSevRank = (sev) => {
      const s = String(sev || '').toLowerCase();
      if (s.includes('bloq')) return 1;
      if (s.includes('crit')) return 2;
      if (s.includes('may')) return 3;
      if (s.includes('men')) return 4;
      return 5;
    };

    const getSeverityClass = (sev) => {
      const s = String(sev || '').toLowerCase();
      if (s.includes('bloq')) return 'bloqueante';
      if (s.includes('crit')) return 'critico';
      if (s.includes('may')) return 'mayor';
      if (s.includes('men')) return 'menor';
      return 'sin-definir';
    };

    const getSeverityLabel = (sev) => {
      const s = String(sev || '').trim();
      if (!s || s === 'Sin definir' || s === 'N/A') return '○ Sin definir';
      const low = s.toLowerCase();
      if (low.includes('bloq')) return '✱ BLOQUEANTE';
      if (low.includes('crit')) return '▲ CRÍTICO';
      if (low.includes('may')) return '● MAYOR';
      if (low.includes('men')) return '○ MENOR';
      return `● ${s}`;
    };

    // ── Traceability matrix rows ──
    const traceabilityRows = [];
    filteredCycles.forEach(cycle => {
      if (cycle.execution && Array.isArray(cycle.execution)) {
        cycle.execution.forEach(ex => {
          const tc = testCases.find(t => String(t.id) === String(ex.id));
          const tcKey = tc ? tc.key : (ex.key || `TC-${ex.id}`);
          const tcSummary = tc ? tc.summary : (ex.summary || 'Caso de prueba');
          const folderObj = folders.find(f => String(f.id) === String(tc?.folderId || tc?.folder));
          const folderName = folderObj?.name || tc?.folderName || tc?.folder || 'General';
          const exType = ex.executionType || tc?.executionType || 'Manual';
          const epicVal = tc?.epic || tc?.epicKey || tc?.epicName || (Array.isArray(tc?.labels) ? tc.labels.find(l => String(l).toLowerCase().startsWith('epic:'))?.replace(/^epic:/i, '') : null) || null;
          const reqVal = tc?.requirement || tc?.storyKey || tc?.userStory || (Array.isArray(tc?.labels) ? tc.labels.find(l => String(l).toLowerCase().startsWith('story:'))?.replace(/^story:/i, '') : null) || null;
          const exBugs = (ex.linkedBugs && Array.isArray(ex.linkedBugs)) ? ex.linkedBugs.filter(isActualBug) : [];

          traceabilityRows.push({
            id: `${cycle.id}-${ex.id}`,
            cycleId: cycle.id,
            cycleName: cycle.summary,
            testCaseId: ex.id,
            testCaseKey: tcKey,
            testCaseSummary: tcSummary,
            folderName: folderName,
            executionType: exType,
            status: ex.status || 'NOT_RUN',
            epic: epicVal,
            requirement: reqVal,
            bugs: exBugs
          });
        });
      }
    });

    const filteredBugsList = criticalCycleBugs.filter(bug => {
      if (!dashboardBugSearch) return true;
      const q = dashboardBugSearch.toLowerCase().trim();
      return (
        bug.key.toLowerCase().includes(q) ||
        bug.summary.toLowerCase().includes(q) ||
        bug.assignee.toLowerCase().includes(q) ||
        String(bug.severity).toLowerCase().includes(q) ||
        String(bug.status).toLowerCase().includes(q) ||
        String(bug.resolution).toLowerCase().includes(q)
      );
    });

    const filteredTraceabilityRows = traceabilityRows.filter(row => {
      if (!dashboardTraceabilitySearch) return true;
      const q = dashboardTraceabilitySearch.toLowerCase().trim();
      return (
        row.testCaseKey.toLowerCase().includes(q) ||
        row.testCaseSummary.toLowerCase().includes(q) ||
        row.cycleName.toLowerCase().includes(q) ||
        row.folderName.toLowerCase().includes(q) ||
        (row.epic && row.epic.toLowerCase().includes(q)) ||
        (row.requirement && row.requirement.toLowerCase().includes(q)) ||
        row.bugs.some(b => (b.key && b.key.toLowerCase().includes(q)) || (b.summary && b.summary.toLowerCase().includes(q)))
      );
    });

    return (
      <div className="tab-layout" style={{ height: 'calc(100vh - 56px)', overflow: 'hidden', display: 'flex', flex: 1 }}>
        {/* ─── Dashboard Sidebar: Runs, Bugs, Traceability ─── */}
        <aside
          className="sidebar glass"
          style={{
            width: sidebarWidth,
            minWidth: '220px',
            maxWidth: '360px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
            backgroundColor: '#FAFBFC',
            borderRight: '1px solid var(--jira-border, #DCDFE4)'
          }}
        >
          {/* Header */}
          <div style={{ padding: '1rem 1.1rem 0.75rem 1.1rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px' }}>📊</span>
              <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--jira-dark, #172B4D)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                DASHBOARD
              </span>
            </div>
            <span className="ads-lozenge ads-lozenge-success" style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '9999px' }}>
              LIVE
            </span>
          </div>

          {/* Navigation Menu */}
          <div style={{ padding: '0.75rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* 1. Runs */}
            <div
              onClick={() => setDashboardSubView('runs')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: dashboardSubView === 'runs' ? 700 : 500,
                backgroundColor: dashboardSubView === 'runs' ? '#E9F2FF' : 'transparent',
                color: dashboardSubView === 'runs' ? '#0C66E4' : 'var(--jira-dark, #172B4D)',
                borderLeft: dashboardSubView === 'runs' ? '3px solid #0C66E4' : '3px solid transparent',
                transition: 'all 0.15s ease'
              }}
              title="Métricas de ejecución y avance de pruebas"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '15px' }}>📊</span>
                  <span>Runs</span>
                </div>
                <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px', fontWeight: 700 }}>
                  {totalCases}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--jira-subtle, #626F86)', paddingLeft: '23px', fontWeight: 500 }}>
                {filteredCycles.length} {filteredCycles.length === 1 ? 'ciclo' : 'ciclos'} · {totalCases} {totalCases === 1 ? 'ejecución' : 'ejecuciones'}
              </div>
            </div>

            {/* 2. Bugs */}
            <div
              onClick={() => setDashboardSubView('bugs')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: dashboardSubView === 'bugs' ? 700 : 500,
                backgroundColor: dashboardSubView === 'bugs' ? '#FFEBE6' : 'transparent',
                color: dashboardSubView === 'bugs' ? '#DE350B' : 'var(--jira-dark, #172B4D)',
                borderLeft: dashboardSubView === 'bugs' ? '3px solid #DE350B' : '3px solid transparent',
                transition: 'all 0.15s ease'
              }}
              title="Gestión de defectos abiertos vinculados a pruebas"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '15px' }}>🐞</span>
                  <span>Bugs</span>
                </div>
                <span className={`ads-lozenge ${criticalCycleBugs.length > 0 ? 'ads-lozenge-danger' : 'ads-lozenge-subtle'}`} style={{ fontSize: '10px', fontWeight: 700 }}>
                  {criticalCycleBugs.length}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--jira-subtle, #626F86)', paddingLeft: '23px', fontWeight: 500 }}>
                {criticalCycleBugs.length} {criticalCycleBugs.length === 1 ? 'abierto' : 'abiertos'} · {totalClosedBugs} cerrados
              </div>
            </div>

            {/* 3. Traceability */}
            <div
              onClick={() => setDashboardSubView('traceability')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: dashboardSubView === 'traceability' ? 700 : 500,
                backgroundColor: dashboardSubView === 'traceability' ? '#E9F2FF' : 'transparent',
                color: dashboardSubView === 'traceability' ? '#0C66E4' : 'var(--jira-dark, #172B4D)',
                borderLeft: dashboardSubView === 'traceability' ? '3px solid #0C66E4' : '3px solid transparent',
                transition: 'all 0.15s ease'
              }}
              title="Matriz de trazabilidad y cobertura"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '15px' }}>🔗</span>
                  <span>Traceability</span>
                </div>
                <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px', fontWeight: 700 }}>
                  {traceabilityRows.length}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--jira-subtle, #626F86)', paddingLeft: '23px', fontWeight: 500 }}>
                Épicas &amp; Historias
              </div>
            </div>
          </div>

          {/* Sidebar Footer */}
          <div style={{ marginTop: 'auto', padding: '0.85rem 1rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--jira-subtle, #626F86)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <span style={{ fontSize: '13px' }}>📁</span>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                {projects.find(p => String(p.id) === String(selectedProjectId))?.name || currentProjectKey}
              </span>
            </div>
            <span style={{ fontSize: '10px', background: '#EBECF0', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
              {currentProjectKey}
            </span>
          </div>
        </aside>

        {/* Resizer */}
        <div
          onMouseDown={() => setIsResizing(true)}
          style={{
            width: '5px',
            cursor: 'col-resize',
            backgroundColor: isResizing ? 'var(--jira-blue, #0C66E4)' : 'transparent',
            zIndex: 10,
            borderRight: '1px solid var(--jira-border, #DCDFE4)',
            marginLeft: '-1px'
          }}
        />

        {/* ─── Main Dashboard View Container ─── */}
        <main className="dashboard-container" style={{ flex: 1, height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: '1.5rem 2rem 6rem 2rem' }}>
          {/* Top Header & Toolbar */}
          <div className="dashboard-top-header">
            <div className="dashboard-header-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className="dashboard-live-badge">
                  <span className="dashboard-live-dot" />
                  ● En vivo · Auto-sync 15 min
                </span>
                <span className="dashboard-tag-context">
                  • Jira Forge App
                </span>
                <span className="dashboard-tag-context">
                  • ID: {currentProjectKey}
                </span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={loadReportData}
                  disabled={reportLoading}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    background: '#FFFFFF',
                    border: '1px solid var(--jira-border, #DCDFE4)',
                    borderRadius: '6px',
                    cursor: reportLoading ? 'not-allowed' : 'pointer',
                    color: 'var(--jira-dark, #172B4D)',
                    fontSize: '12px',
                    fontWeight: 600
                  }}
                  title="Recargar datos de ejecución y Jira"
                >
                  🔄 {reportLoading ? 'Sincronizando...' : 'Sincronizar Métricas'}
                </button>

                <button 
                  className="btn-secondary" 
                  onClick={() => {
                    loadReportAutomationConfig();
                    setShowReportAutomationModal(true);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: '1px solid',
                    borderColor: reportAutomationConfig.enabled ? '#F5B8D8' : 'var(--jira-border, #DCDFE4)',
                    background: reportAutomationConfig.enabled ? '#FDF2F7' : '#FFFFFF',
                    color: reportAutomationConfig.enabled ? '#E1007A' : 'var(--jira-dark, #172B4D)',
                    cursor: 'pointer'
                  }}
                  title="Configurar horario y envío automático programado con Jira Automation"
                >
                  ⏰ {reportAutomationConfig.enabled ? '🟢 Envío Automático (Activo)' : '⏰ Automatizar Envío'}
                </button>

                <button 
                  className="btn-primary" 
                  onClick={handleCopyReportToClipboard}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '6px'
                  }}
                  title="Copiar reporte ejecutivo HTML y redactar en Gmail"
                >
                  📧 Enviar Reporte Ejecutivo
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <h1 className="dashboard-title">
                {dashboardSubView === 'runs' && 'Dashboard: Métricas de Calidad y Ejecución (Runs)'}
                {dashboardSubView === 'bugs' && 'Dashboard: Tablero de Defectos y Fallos Críticos (Bugs)'}
                {dashboardSubView === 'traceability' && 'Dashboard: Matriz de Trazabilidad (Traceability)'}
              </h1>
              {circuitBreakerActive && (
                <span style={{ fontSize: '12px', color: '#FF8B00', fontWeight: 600 }}>
                  ⏸ Rate limit activo (3 min)
                </span>
              )}
            </div>

            {/* Filter Toolbar */}
            <div className="dashboard-filter-toolbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {/* 1. Plan de Pruebas */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-subtle, #626F86)' }}>Plan de Pruebas:</span>
                  <details style={{ position: 'relative' }}>
                    <summary style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--jira-border, #DCDFE4)', background: '#FAFBFC', cursor: 'pointer', minWidth: '180px', fontSize: '12px', fontWeight: 600, color: 'var(--jira-dark, #172B4D)' }}>
                      {reportSelectedPlans.length === 0 ? "Todos los Planes" : `${reportSelectedPlans.length} Planes seleccionados`}
                    </summary>
                    <div style={{ position: 'absolute', top: '100%', left: 0, background: '#FFFFFF', border: '1px solid var(--jira-border, #DCDFE4)', zIndex: 100, padding: '0.6rem', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', minWidth: '220px', boxShadow: '0 4px 12px rgba(9,30,66,0.15)' }}>
                       <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                         <input type="checkbox" checked={reportSelectedPlans.length === 0} onChange={() => { setReportSelectedPlans([]); setReportSelectedCycles([]); }} /> Todos los Planes
                       </label>
                       {testPlans.map(p => (
                         <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '12px' }}>
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
                </div>

                {/* 2. Ciclo de Pruebas */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-subtle, #626F86)' }}>Ciclo de Pruebas:</span>
                  <details style={{ position: 'relative' }}>
                    <summary style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--jira-border, #DCDFE4)', background: '#FAFBFC', cursor: 'pointer', minWidth: '180px', fontSize: '12px', fontWeight: 600, color: 'var(--jira-dark, #172B4D)' }}>
                      {reportSelectedCycles.length === 0 ? "Todos los Ciclos" : `${reportSelectedCycles.length} Ciclos seleccionados`}
                    </summary>
                    <div style={{ position: 'absolute', top: '100%', left: 0, background: '#FFFFFF', border: '1px solid var(--jira-border, #DCDFE4)', zIndex: 100, padding: '0.6rem', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', minWidth: '220px', boxShadow: '0 4px 12px rgba(9,30,66,0.15)' }}>
                       <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                         <input type="checkbox" checked={reportSelectedCycles.length === 0} onChange={() => { setReportSelectedCycles([]); }} /> Todos los Ciclos
                       </label>
                       {(reportSelectedPlans.length > 0 ? (reportData.cycles || []).filter(c => reportSelectedPlans.includes(c.planId)) : (reportData.cycles || [])).map(c => (
                         <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '12px' }}>
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

                {/* 3. Ambiente: QA */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-subtle, #626F86)' }}>Ambiente:</span>
                  <span style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--jira-border, #DCDFE4)', background: '#FAFBFC', fontSize: '12px', fontWeight: 600, color: 'var(--jira-dark, #172B4D)' }}>
                    QA
                  </span>
                </div>
              </div>

              {/* Sincronización */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--jira-subtle, #626F86)' }}>
                <span>🕒</span>
                <span>
                  {reportData._loadedAt
                    ? (Math.floor((Date.now() - reportData._loadedAt) / 60000) < 1
                        ? 'Sincronizado hace un momento'
                        : `Sincronizado hace ${Math.floor((Date.now() - reportData._loadedAt) / 60000)} min`)
                    : 'Sincronizado'}
                </span>
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* ─── SUBVIEW 1: RUNS ─── */}
          {/* ═══════════════════════════════════════════════════════ */}
          {dashboardSubView === 'runs' && (
            <>
              {/* 1. Bento Grid: 5 KPI Cards */}
              <div className="dashboard-kpi-grid">
                {/* Card 1: Total Casos */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>📋 TOTAL CASOS</span>
                    <span className="dashboard-kpi-pill blue">{allTotal} totales</span>
                  </div>
                  <div className="dashboard-kpi-value">{allTotal.toLocaleString()}</div>
                  <div className="dashboard-kpi-footer">
                    <span>● {execStats.auto.total} Auto ({allTotal > 0 ? Math.round((execStats.auto.total / allTotal) * 100) : 0}%)</span>
                    <span>● {execStats.manual.total} Manual ({allTotal > 0 ? Math.round((execStats.manual.total / allTotal) * 100) : 0}%)</span>
                  </div>
                </div>

                {/* Card 2: Tasa de Éxito */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#006644' }}>🟢 TASA DE ÉXITO</span>
                    <span className="dashboard-kpi-pill green">▲ {successRate}%</span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: '#006644' }}>
                    {successRate}% <span style={{ fontSize: '13px', color: 'var(--jira-subtle, #626F86)', fontWeight: 500 }}>{passed} pasados</span>
                  </div>
                  <div className="dashboard-progress-mini">
                    <div style={{ width: `${Math.min(100, Math.max(0, Number(successRate)))}%`, height: '100%', backgroundColor: '#36B37E', borderRadius: '9999px', transition: 'width 0.4s ease' }} />
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span>{passed} de {ejecutados} evaluados</span>
                  </div>
                </div>

                {/* Card 3: Defectos & Bloqueos */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: totalOpenBugs > 0 ? '#DE350B' : 'var(--jira-subtle, #626F86)' }}>🐞 DEFECTOS &amp; BLOQUEOS</span>
                    <span className={`dashboard-kpi-pill ${totalOpenBugs > 0 ? 'red' : 'green'}`}>
                      {totalOpenBugs} Abiertos
                    </span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: totalOpenBugs > 0 ? '#DE350B' : 'var(--jira-dark, #172B4D)' }}>
                    {totalAllBugs} <span style={{ fontSize: '13px', color: 'var(--jira-subtle, #626F86)', fontWeight: 500 }}>({totalOpenBugs} abiertos)</span>
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span style={{ color: '#006644', fontWeight: 600 }}>{totalClosedBugs} Cerrados</span>
                    <span style={{ color: totalOpenBugs > 0 ? '#DE350B' : 'var(--jira-subtle)', fontWeight: 600 }}>
                      {totalOpenBugs} Abiertos
                    </span>
                  </div>
                </div>

                {/* Card 4: Tiempo de Resolución (MTTR) */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#0C66E4' }}>⏱ RESOLUCIÓN (MTTR)</span>
                    <span className="dashboard-kpi-pill neutral">SLA: 24h</span>
                  </div>
                  <div className="dashboard-kpi-value">
                    {avgResolutionHours} <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--jira-subtle)' }}>hrs</span>
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span style={{ color: '#006644', fontWeight: 600 }}>Media en ciclo</span>
                    <span>objetivo &lt; 24h</span>
                  </div>
                </div>

                {/* Card 5: Cobertura de Ejecución */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#0C66E4' }}>🎯 COBERTURA DE EJECUCIÓN</span>
                    <span className="dashboard-kpi-pill blue">{coverageRate}%</span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: '#0C66E4' }}>
                    {coverageRate}% <span style={{ fontSize: '13px', color: 'var(--jira-subtle, #626F86)', fontWeight: 500 }}>{passed + failed + blocked} / {allTotal}</span>
                  </div>
                  <div className="dashboard-progress-mini">
                    <div style={{ width: `${Math.min(100, Math.max(0, Number(coverageRate)))}%`, height: '100%', backgroundColor: '#0C66E4', borderRadius: '9999px', transition: 'width 0.4s ease' }} />
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span>{allTotal - (passed + failed + blocked)} casos pendientes</span>
                  </div>
                </div>
              </div>

              {/* 2. Row 1: Donut General & Manual vs Auto */}
              <div className="dashboard-grid-2col">
                {/* Card: Estado General de Pruebas */}
                <div className="dashboard-card">
                  <div className="dashboard-card-header">
                    <div className="dashboard-card-title">
                      <span>🔄</span>
                      <span>Estado General de Pruebas</span>
                    </div>
                    <span style={{ fontSize: '11px', background: '#F1F2F4', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                      {allTotal.toLocaleString()} TOTAL
                    </span>
                  </div>

                  <div className="dashboard-donut-wrapper">
                    <div style={{ position: 'relative', width: '150px', height: '150px', flexShrink: 0 }}>
                      <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                        <circle cx="18" cy="18" r="15.91549430918954" fill="transparent" stroke="#EBECF0" strokeWidth="3.4" />
                        {allTotal > 0 && (
                          <>
                            {pPct > 0 && <circle cx="18" cy="18" r="15.91549430918954" fill="transparent" stroke="#36B37E" strokeWidth="3.4" strokeDasharray={`${pPct} ${100 - pPct}`} strokeDashoffset="0" />}
                            {fPct > 0 && <circle cx="18" cy="18" r="15.91549430918954" fill="transparent" stroke="#DE350B" strokeWidth="3.4" strokeDasharray={`${fPct} ${100 - fPct}`} strokeDashoffset={`${-pPct}`} />}
                            {bPct > 0 && <circle cx="18" cy="18" r="15.91549430918954" fill="transparent" stroke="#FFAB00" strokeWidth="3.4" strokeDasharray={`${bPct} ${100 - bPct}`} strokeDashoffset={`${-(pPct + fPct)}`} />}
                            {nPct > 0 && <circle cx="18" cy="18" r="15.91549430918954" fill="transparent" stroke="#0C66E4" strokeWidth="3.4" strokeDasharray={`${nPct} ${100 - nPct}`} strokeDashoffset={`${-(pPct + fPct + bPct)}`} />}
                          </>
                        )}
                      </svg>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--jira-dark, #172B4D)', lineHeight: 1 }}>{successRate}%</span>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--jira-subtle, #626F86)', textTransform: 'uppercase', marginTop: '2px', letterSpacing: '0.04em' }}>ÉXITO EFEC.</span>
                      </div>
                    </div>

                    <div className="dashboard-status-list" style={{ flex: 1 }}>
                      <div className="dashboard-status-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: '#36B37E' }} />
                          <span style={{ fontWeight: 600 }}>Pasados</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700 }}>{passed}</span>
                          <span style={{ fontSize: '11px', color: 'var(--jira-subtle)' }}>({pPct.toFixed(1)}%)</span>
                        </div>
                      </div>

                      <div className="dashboard-status-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: '#DE350B' }} />
                          <span style={{ fontWeight: 600 }}>Fallados</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700 }}>{failed}</span>
                          <span style={{ fontSize: '11px', color: 'var(--jira-subtle)' }}>({fPct.toFixed(1)}%)</span>
                        </div>
                      </div>

                      <div className="dashboard-status-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: '#FFAB00' }} />
                          <span style={{ fontWeight: 600 }}>Bloqueados</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700 }}>{blocked}</span>
                          <span style={{ fontSize: '11px', color: 'var(--jira-subtle)' }}>({bPct.toFixed(1)}%)</span>
                        </div>
                      </div>

                      <div className="dashboard-status-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: '#0C66E4' }} />
                          <span style={{ fontWeight: 600 }}>Sin Ejecutar</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700 }}>{notRun}</span>
                          <span style={{ fontSize: '11px', color: 'var(--jira-subtle)' }}>({nPct.toFixed(1)}%)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card: Ejecución Manual vs Auto */}
                <div className="dashboard-card">
                  <div className="dashboard-card-header">
                    <div className="dashboard-card-title">
                      <span>⚡</span>
                      <span>Ejecución: Manual vs Auto</span>
                    </div>
                    <span style={{ fontSize: '11px', background: '#F1F2F4', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                      Velocidad &amp; Calidad
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.5rem 0' }}>
                    {/* Automatizada */}
                    <div className="dashboard-track-box">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🤖 Automatizada</span>
                          <span className="ads-lozenge ads-lozenge-success" style={{ fontSize: '10px' }}>{autoPassPct}% Pass</span>
                        </div>
                        <span style={{ color: 'var(--jira-subtle)' }}>{execStats.auto.total} pruebas</span>
                      </div>
                      <div className="dashboard-stacked-bar">
                        {execStats.auto.total > 0 ? (
                          <>
                            {execStats.auto.passed > 0 && <div style={{ width: `${(execStats.auto.passed / execStats.auto.total) * 100}%`, backgroundColor: '#36B37E' }} title={`Pasadas: ${execStats.auto.passed}`} />}
                            {execStats.auto.failed > 0 && <div style={{ width: `${(execStats.auto.failed / execStats.auto.total) * 100}%`, backgroundColor: '#DE350B' }} title={`Falladas: ${execStats.auto.failed}`} />}
                            {execStats.auto.blocked > 0 && <div style={{ width: `${(execStats.auto.blocked / execStats.auto.total) * 100}%`, backgroundColor: '#FFAB00' }} title={`Bloqueadas: ${execStats.auto.blocked}`} />}
                            {execStats.auto.notRun > 0 && <div style={{ width: `${(execStats.auto.notRun / execStats.auto.total) * 100}%`, backgroundColor: '#0C66E4' }} title={`Sin ejecutar: ${execStats.auto.notRun}`} />}
                          </>
                        ) : (
                          <div style={{ width: '100%', height: '100%', backgroundColor: '#F1F2F4' }} />
                        )}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--jira-subtle)' }}>
                        <span>● {execStats.auto.passed} Pasadas</span>
                        <span>● {execStats.auto.failed} Falladas</span>
                        <span>● {execStats.auto.notRun} Pendientes</span>
                      </div>
                    </div>

                    {/* Manual */}
                    <div className="dashboard-track-box">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>👤 Manual (QA)</span>
                          <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px' }}>{manualPassPct}% Pass</span>
                        </div>
                        <span style={{ color: 'var(--jira-subtle)' }}>{execStats.manual.total} pruebas</span>
                      </div>
                      <div className="dashboard-stacked-bar">
                        {execStats.manual.total > 0 ? (
                          <>
                            {execStats.manual.passed > 0 && <div style={{ width: `${(execStats.manual.passed / execStats.manual.total) * 100}%`, backgroundColor: '#36B37E' }} title={`Pasadas: ${execStats.manual.passed}`} />}
                            {execStats.manual.failed > 0 && <div style={{ width: `${(execStats.manual.failed / execStats.manual.total) * 100}%`, backgroundColor: '#DE350B' }} title={`Falladas: ${execStats.manual.failed}`} />}
                            {execStats.manual.blocked > 0 && <div style={{ width: `${(execStats.manual.blocked / execStats.manual.total) * 100}%`, backgroundColor: '#FFAB00' }} title={`Bloqueadas: ${execStats.manual.blocked}`} />}
                            {execStats.manual.notRun > 0 && <div style={{ width: `${(execStats.manual.notRun / execStats.manual.total) * 100}%`, backgroundColor: '#0C66E4' }} title={`Sin ejecutar: ${execStats.manual.notRun}`} />}
                          </>
                        ) : (
                          <div style={{ width: '100%', height: '100%', backgroundColor: '#F1F2F4' }} />
                        )}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--jira-subtle)' }}>
                        <span>● {execStats.manual.passed} Pasadas</span>
                        <span>● {execStats.manual.failed} Falladas</span>
                        <span>● {execStats.manual.notRun} Pendientes</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Row 2: QA Testers & Módulos */}
              <div className="dashboard-grid-2col">
                {/* Card: Estado por QA Tester */}
                <div className="dashboard-card">
                  <div className="dashboard-card-header">
                    <div className="dashboard-card-title">
                      <span>👥</span>
                      <span>Estado por QA Tester</span>
                    </div>
                    <span style={{ fontSize: '11px', background: '#F1F2F4', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                      {Object.keys(testerStats).length} Asignados
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.4rem 0', maxHeight: '240px', overflowY: 'auto' }}>
                    {Object.keys(testerStats).length > 0 ? (
                      Object.entries(testerStats).map(([testerName, stats]) => {
                        const tPassPct = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
                        return (
                          <div key={testerName} className="dashboard-tester-row">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div className="dashboard-avatar-circle">
                                  {getInitials(testerName)}
                                </div>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--jira-dark, #172B4D)' }}>{testerName}</span>
                              </div>
                              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-subtle)' }}>
                                {stats.passed}/{stats.total} ({tPassPct}%)
                              </span>
                            </div>
                            <div className="dashboard-stacked-bar" style={{ height: '8px', margin: '2px 0' }}>
                              {stats.passed > 0 && <div style={{ width: `${(stats.passed / stats.total) * 100}%`, backgroundColor: '#36B37E' }} />}
                              {stats.failed > 0 && <div style={{ width: `${(stats.failed / stats.total) * 100}%`, backgroundColor: '#DE350B' }} />}
                              {stats.blocked > 0 && <div style={{ width: `${(stats.blocked / stats.total) * 100}%`, backgroundColor: '#FFAB00' }} />}
                              {stats.notRun > 0 && <div style={{ width: `${(stats.notRun / stats.total) * 100}%`, backgroundColor: '#0C66E4' }} />}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '1rem', fontSize: '12px' }}>
                        Sin asignaciones de tester
                      </div>
                    )}
                  </div>
                </div>

                {/* Card: Estado por Módulo / Funcionalidad */}
                <div className="dashboard-card">
                  <div className="dashboard-card-header">
                    <div className="dashboard-card-title">
                      <span>🧱</span>
                      <span>Estado por Módulo / Funcionalidad</span>
                    </div>
                    <span style={{ fontSize: '11px', background: '#E9F2FF', color: '#0C66E4', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                      Tipo: Funcional
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.4rem 0', maxHeight: '240px', overflowY: 'auto' }}>
                    {Object.keys(moduleStats).length > 0 ? (
                      Object.entries(moduleStats).slice(0, 5).map(([modName, stats]) => {
                        const mPassPct = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
                        const riskLevel = stats.failed > 3 ? 'high' : stats.failed > 0 ? 'med' : 'low';
                        return (
                          <div key={modName} className="dashboard-module-row">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '12px', fontWeight: 600 }}>{modName}</span>
                                {riskLevel === 'high' && <span className="ads-lozenge ads-lozenge-danger" style={{ fontSize: '9px' }}>Riesgo Alto</span>}
                                {riskLevel === 'med' && <span className="ads-lozenge ads-lozenge-warning" style={{ fontSize: '9px' }}>Riesgo Medio</span>}
                                {riskLevel === 'low' && <span className="ads-lozenge ads-lozenge-success" style={{ fontSize: '9px' }}>Estable</span>}
                              </div>
                              <span style={{ fontSize: '11px', color: 'var(--jira-subtle)' }}>{stats.total} casos · {mPassPct}% Pass</span>
                            </div>
                            <div className="dashboard-stacked-bar" style={{ height: '8px', margin: '2px 0' }}>
                              {stats.passed > 0 && <div style={{ width: `${(stats.passed / stats.total) * 100}%`, backgroundColor: '#36B37E' }} />}
                              {stats.failed > 0 && <div style={{ width: `${(stats.failed / stats.total) * 100}%`, backgroundColor: '#DE350B' }} />}
                              {stats.blocked > 0 && <div style={{ width: `${(stats.blocked / stats.total) * 100}%`, backgroundColor: '#FFAB00' }} />}
                              {stats.notRun > 0 && <div style={{ width: `${(stats.notRun / stats.total) * 100}%`, backgroundColor: '#0C66E4' }} />}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '1rem', fontSize: '12px' }}>
                        Sin pruebas funcionales registradas
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 4. Progreso por Ciclo de Pruebas */}
              {filteredCycles.length > 0 && (
                <div className="dashboard-card">
                  <div className="dashboard-card-header">
                    <div className="dashboard-card-title">
                      <span>🔄</span>
                      <span>Progreso por Ciclo de Pruebas</span>
                    </div>
                    <span style={{ fontSize: '11px', background: '#F1F2F4', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                      {filteredCycles.length} Ciclos Activos
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.85rem', padding: '0.5rem 0', maxHeight: '280px', overflowY: 'auto' }}>
                    {filteredCycles.map(cycle => {
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
                      const cPassPct = cTotal > 0 ? Math.round((cPassed / cTotal) * 100) : 0;

                      return (
                        <div key={cycle.id} className="dashboard-track-box" style={{ margin: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }} title={cycle.summary}>
                              {cycle.summary}
                            </span>
                            <span style={{ color: 'var(--jira-subtle)', fontSize: '11px' }}>{cTotal} casos · {cPassPct}%</span>
                          </div>
                          <div className="dashboard-stacked-bar" style={{ height: '10px' }}>
                            {cTotal > 0 ? (
                              <>
                                {cPassed > 0 && <div style={{ width: `${(cPassed / cTotal) * 100}%`, backgroundColor: '#36B37E' }} title={`Pasados: ${cPassed}`} />}
                                {cFailed > 0 && <div style={{ width: `${(cFailed / cTotal) * 100}%`, backgroundColor: '#DE350B' }} title={`Fallados: ${cFailed}`} />}
                                {cBlocked > 0 && <div style={{ width: `${(cBlocked / cTotal) * 100}%`, backgroundColor: '#FFAB00' }} title={`Bloqueados: ${cBlocked}`} />}
                                {cNotRun > 0 && <div style={{ width: `${(cNotRun / cTotal) * 100}%`, backgroundColor: '#0C66E4' }} title={`Sin ejecutar: ${cNotRun}`} />}
                              </>
                            ) : (
                              <div style={{ width: '100%', height: '100%', backgroundColor: '#F1F2F4' }} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </>
          )}

          {/* ═══════════════════════════════════════════════════════ */}
          {/* ─── SUBVIEW 2: BUGS ─── */}
          {/* ═══════════════════════════════════════════════════════ */}
          {dashboardSubView === 'bugs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Bugs KPI Scorecard (5 Cards) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                {/* Card 1: Total Defectos */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ color: 'var(--jira-dark, #172B4D)', fontWeight: 700 }}>🐞 TOTAL DEFECTOS</span>
                    <span className="dashboard-kpi-pill blue">{totalAllBugs} totales</span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: 'var(--jira-dark, #172B4D)' }}>
                    {totalAllBugs}
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span style={{ color: '#006644', fontWeight: 600 }}>{totalClosedBugs} Cerrados</span>
                    <span style={{ color: criticalCycleBugs.length > 0 ? '#DE350B' : 'var(--jira-subtle)', fontWeight: 600 }}>
                      {criticalCycleBugs.length} Abiertos
                    </span>
                  </div>
                </div>

                {/* Card 2: Defectos Abiertos */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ color: '#DE350B', fontWeight: 700 }}>🐞 DEFECTOS ABIERTOS</span>
                    <span className="dashboard-kpi-pill red">{criticalCycleBugs.length} Activos</span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: '#DE350B' }}>
                    {criticalCycleBugs.length}
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span>En ciclo(s) seleccionados</span>
                    <span style={{ color: '#006644', fontWeight: 600 }}>{totalClosedBugs} Cerrados</span>
                  </div>
                </div>

                {/* Card 3: Bloqueantes & Críticos */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ color: '#DE350B', fontWeight: 700 }}>✱ BLOQUEANTES &amp; CRÍTICOS</span>
                    <span className="dashboard-kpi-pill red">Alta prioridad</span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: '#DE350B' }}>
                    {criticalCycleBugs.filter(b => getSevRank(b.severity) <= 2).length}
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span>Requieren atención inmediata</span>
                  </div>
                </div>

                {/* Card 4: Mayores & Menores */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ color: '#FF8B00', fontWeight: 700 }}>● MAYORES &amp; MENORES</span>
                    <span className="dashboard-kpi-pill orange">Media/Baja</span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: '#FF8B00' }}>
                    {criticalCycleBugs.filter(b => getSevRank(b.severity) > 2).length}
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span>Defectos no bloqueantes</span>
                  </div>
                </div>

                {/* Card 5: Resolución (MTTR) */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ color: '#0C66E4', fontWeight: 700 }}>⏱ RESOLUCIÓN (MTTR)</span>
                    <span className="dashboard-kpi-pill blue">SLA 24h</span>
                  </div>
                  <div className="dashboard-kpi-value">
                    {avgResolutionHours} <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--jira-subtle)' }}>hrs</span>
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span>Tiempo promedio cierre</span>
                  </div>
                </div>
              </div>

              {/* Bugs Dedicated Card */}
              <div className="dashboard-card" style={{ overflowX: 'auto' }}>
                <div className="dashboard-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div className="dashboard-card-title">
                      <span style={{ color: '#DE350B' }}>🐞</span>
                      <span>Tablero de Defectos y Fallos Críticos de Jira</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', marginTop: '2px' }}>
                      Vista dedicada a la gestión de defectos abiertos en el ciclo activo
                    </div>
                  </div>

                  {/* Search filter input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Buscar bug, responsable, severidad..."
                      value={dashboardBugSearch}
                      onChange={(e) => setDashboardBugSearch(e.target.value)}
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        border: '1px solid var(--jira-border, #DCDFE4)',
                        borderRadius: '6px',
                        width: '260px'
                      }}
                    />
                    {dashboardBugSearch && (
                      <button
                        onClick={() => setDashboardBugSearch('')}
                        style={{ padding: '4px 8px', fontSize: '11px', background: '#F1F2F4', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                </div>

                {filteredBugsList.length > 0 ? (
                  <table className="dashboard-defects-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Resumen del bug</th>
                        <th>Severidad</th>
                        <th>Estado</th>
                        <th>Responsable</th>
                        <th>Resolución</th>
                        <th style={{ textAlign: 'center' }}>Casos afectados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBugsList.map((bug) => (
                        <tr key={bug.key}>
                          {/* 1. ID */}
                          <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="dashboard-bug-icon">B</span>
                              <a
                                href={`/browse/${bug.key}`}
                                onClick={(e) => { e.preventDefault(); router.open('/browse/' + bug.key); }}
                                style={{ color: '#0C66E4', textDecoration: 'none', fontWeight: 700 }}
                                title="Abrir incidencia en Jira"
                              >
                                {bug.key}
                              </a>
                            </div>
                          </td>

                          {/* 2. Resumen del bug */}
                          <td style={{ maxWidth: '420px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--jira-dark, #172B4D)', fontSize: '13px' }} title={bug.summary}>
                              {bug.summary}
                            </div>
                          </td>

                          {/* 3. Severidad */}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className={`dashboard-sev-badge ${getSeverityClass(bug.severity)}`}>
                              {getSeverityLabel(bug.severity)}
                            </span>
                          </td>

                          {/* 4. Estado */}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className="ads-lozenge ads-lozenge-warning" style={{ fontSize: '10px', fontWeight: 700 }}>
                              {bug.status || 'Abierto'}
                            </span>
                          </td>

                          {/* 5. Responsable */}
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <div className="dashboard-avatar-circle" style={{ width: '24px', height: '24px', fontSize: '10px' }}>
                                {getInitials(bug.assignee)}
                              </div>
                              <span style={{ fontSize: '12px', color: 'var(--jira-dark, #172B4D)', fontWeight: 500 }}>
                                {bug.assignee}
                              </span>
                            </div>
                          </td>

                          {/* 6. Resolución */}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {(!bug.resolution || bug.resolution === 'Sin resolver' || bug.resolution === 'Unresolved') ? (
                              <span style={{ color: 'var(--jira-subtle, #626F86)', fontStyle: 'italic', fontSize: '12px' }}>
                                Sin resolver
                              </span>
                            ) : (
                              <span className="ads-lozenge ads-lozenge-success" style={{ fontSize: '10px', fontWeight: 700 }}>
                                {bug.resolution}
                              </span>
                            )}
                          </td>

                          {/* 7. Casos afectados */}
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <span className="dashboard-affected-badge" title={`${bug.affectedCount} ${bug.affectedCount === 1 ? 'caso afectado' : 'casos afectados'}`}>
                              {bug.affectedCount}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '3rem', fontSize: '13px' }}>
                    {dashboardBugSearch ? '🔍 No se encontraron bugs con ese criterio de búsqueda.' : '✅ No hay bugs abiertos en el ciclo seleccionado.'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════ */}
          {/* ─── SUBVIEW 3: TRACEABILITY ─── */}
          {/* ═══════════════════════════════════════════════════════ */}
          {dashboardSubView === 'traceability' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Traceability KPI Scorecard */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ color: '#0C66E4', fontWeight: 700 }}>🎯 COBERTURA TOTAL</span>
                    <span className="dashboard-kpi-pill blue">{coverageRate}%</span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: '#0C66E4' }}>
                    {coverageRate}%
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span>{ejecutados} de {allTotal} casos evaluados</span>
                  </div>
                </div>

                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ color: '#006644', fontWeight: 700 }}>🧪 CASOS MAPEADOS</span>
                    <span className="dashboard-kpi-pill green">Total</span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: '#006644' }}>
                    {traceabilityRows.length}
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span>Ejecuciones en ciclo(s)</span>
                  </div>
                </div>

                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ color: '#DE350B', fontWeight: 700 }}>⚠️ CASOS CON INCIDENCIA</span>
                    <span className="dashboard-kpi-pill red">{failed + blocked} Casos</span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: '#DE350B' }}>
                    {failed + blocked}
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span>{failed} Fallados · {blocked} Bloqueados</span>
                  </div>
                </div>
              </div>

              {/* Traceability Matrix Card */}
              <div className="dashboard-card" style={{ overflowX: 'auto' }}>
                <div className="dashboard-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div className="dashboard-card-title">
                      <span style={{ color: '#0C66E4' }}>🔗</span>
                      <span>Matriz de Trazabilidad y Cobertura (Traceability Matrix)</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', marginTop: '2px' }}>
                      Relación de extremo a extremo: Épica ➔ Historia de Usuario ➔ Caso de Prueba ➔ Ciclo ➔ Defectos
                    </div>
                  </div>

                  {/* Search filter */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Buscar por épica, historia, caso o bug..."
                      value={dashboardTraceabilitySearch}
                      onChange={(e) => setDashboardTraceabilitySearch(e.target.value)}
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        border: '1px solid var(--jira-border, #DCDFE4)',
                        borderRadius: '6px',
                        width: '280px'
                      }}
                    />
                    {dashboardTraceabilitySearch && (
                      <button
                        onClick={() => setDashboardTraceabilitySearch('')}
                        style={{ padding: '4px 8px', fontSize: '11px', background: '#F1F2F4', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                </div>

                {/* Construction notice banner */}
                <div style={{
                  margin: '0.5rem 1rem 1rem 1rem',
                  background: '#FFFBE6',
                  border: '1px solid #FFE380',
                  borderRadius: '6px',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  color: '#172B4D'
                }}>
                  <span style={{ fontSize: '18px', lineHeight: 1 }}>🚧</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#172B4D' }}>
                      Asociación de Épicas e Historias de Usuario (Requisitos) — En Construcción
                    </div>
                    <div style={{ fontSize: '11px', color: '#626F86', marginTop: '2px' }}>
                      El detalle de casos se encuentra estructurado para vincular directamente las <strong>Épicas</strong> y <strong>Historias de Usuario</strong> con cada Caso de Prueba y sus resultados de ejecución en los ciclos.
                    </div>
                  </div>
                </div>

                {filteredTraceabilityRows.length > 0 ? (
                  <table className="dashboard-defects-table">
                    <thead>
                      <tr>
                        <th>Épica de Jira</th>
                        <th>Historia de Usuario (Requisito)</th>
                        <th>Caso de Prueba</th>
                        <th>Ciclo de Pruebas</th>
                        <th>Estado Ejecución</th>
                        <th>Defectos Vinculados</th>
                        <th style={{ textAlign: 'right' }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTraceabilityRows.map((row) => (
                        <tr key={row.id}>
                          {/* 1. Épica de Jira */}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {row.epic ? (
                              <span className="ads-lozenge ads-lozenge-subtle" style={{ fontWeight: 700, color: '#6554C0', background: '#EAE6FF' }}>
                                ⚡ {row.epic}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--jira-subtle, #626F86)', fontSize: '11px', fontStyle: 'italic' }}>
                                ⚡ Por vincular
                              </span>
                            )}
                          </td>

                          {/* 2. Historia de Usuario (Requisito) */}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {row.requirement ? (
                              <span className="ads-lozenge ads-lozenge-subtle" style={{ fontWeight: 700, color: '#0065FF', background: '#DEEBFF' }}>
                                📖 {row.requirement}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--jira-subtle, #626F86)', fontSize: '11px', fontStyle: 'italic' }}>
                                📁 {row.folderName}
                              </span>
                            )}
                          </td>

                          {/* 3. Caso de Prueba */}
                          <td style={{ maxWidth: '340px' }}>
                            <div style={{ fontWeight: 700, color: '#0C66E4', fontSize: '12px' }}>
                              {row.testCaseKey}
                            </div>
                            <div style={{ fontWeight: 500, color: 'var(--jira-dark, #172B4D)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '340px' }} title={row.testCaseSummary}>
                              {row.testCaseSummary}
                            </div>
                          </td>

                          {/* 4. Ciclo */}
                          <td style={{ whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--jira-subtle)' }}>
                            {row.cycleName}
                          </td>

                          {/* 5. Estado Ejecución */}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {row.status === 'Passed' && <span className="ads-lozenge ads-lozenge-success" style={{ fontWeight: 700 }}>Passed</span>}
                            {row.status === 'Failed' && <span className="ads-lozenge ads-lozenge-danger" style={{ fontWeight: 700 }}>Failed</span>}
                            {row.status === 'Blocked' && <span className="ads-lozenge ads-lozenge-warning" style={{ fontWeight: 700 }}>Blocked</span>}
                            {row.status === 'NOT_RUN' && <span className="ads-lozenge ads-lozenge-subtle" style={{ fontWeight: 700 }}>Not Run</span>}
                            {!['Passed', 'Failed', 'Blocked', 'NOT_RUN'].includes(row.status) && (
                              <span className="ads-lozenge ads-lozenge-subtle">{row.status}</span>
                            )}
                          </td>

                          {/* 6. Defectos Vinculados */}
                          <td>
                            {row.bugs.length > 0 ? (
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {row.bugs.map((b, idx) => (
                                  <a
                                    key={idx}
                                    href={`/browse/${b.key}`}
                                    onClick={(e) => { e.preventDefault(); router.open('/browse/' + b.key); }}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      fontSize: '11px',
                                      fontWeight: 700,
                                      color: '#DE350B',
                                      background: '#FFEBE6',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      textDecoration: 'none'
                                    }}
                                    title={b.summary || b.key}
                                  >
                                    <span style={{ fontSize: '9px' }}>🐞</span> {b.key}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--jira-subtle)', fontSize: '11px' }}>0 bugs</span>
                            )}
                          </td>

                          {/* 7. Acción */}
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              onClick={() => {
                                const found = testCases.find(t => String(t.id) === String(row.testCaseId));
                                if (found) setSelectedTestCase(found);
                              }}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: '#FFFFFF',
                                border: '1px solid var(--jira-border, #DCDFE4)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                color: '#0C66E4'
                              }}
                            >
                              Ver Caso
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '3rem', fontSize: '13px' }}>
                    {dashboardTraceabilitySearch ? '🔍 No se encontraron registros de trazabilidad con ese criterio de búsqueda.' : 'No hay datos de ejecución para trazar.'}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    );
  };

  const handleDownloadFullBackup = async () => {
    if (!selectedProjectId) {
      addNotification({ type: 'warning', title: 'Selecciona un proyecto', description: 'Debes seleccionar un proyecto para exportar su copia de seguridad.' });
      return;
    }

    setIsBackingUp(true);
    setBackupProgress({ step: 1, totalSteps: 4, message: 'Cargando carpetas, planes y configuración...', percent: 10 });

    try {
      const config = projectConfig || { testCaseType: 'Test Case', testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
      const currentProj = projects.find(p => String(p.id) === String(selectedProjectId));
      const projKey = currentProj?.key || selectedProjectId;

      // 1. Fetch Structural Data
      const [fetchedFolders, fetchedPlans, fetchedCycles, fetchedCases] = await Promise.all([
        invoke('getFolders', { projectId: selectedProjectId }).catch(() => []),
        invoke('getTestPlans', { projectId: selectedProjectId, config }).catch(() => []),
        invoke('getTestCycles', { projectId: selectedProjectId, config }).catch(() => []),
        invoke('getTestCases', { projectId: selectedProjectId, config }).catch(() => [])
      ]);

      const casesArray = Array.isArray(fetchedCases) ? fetchedCases : (testCases || []);
      const cyclesArray = Array.isArray(fetchedCycles) ? fetchedCycles : (testCycles || []);
      const plansArray = Array.isArray(fetchedPlans) ? fetchedPlans : (testPlans || []);
      const foldersArray = Array.isArray(fetchedFolders) ? fetchedFolders : (folders || []);

      // 2. Fetch Test Cases Formats/Steps
      setBackupProgress({
        step: 2,
        totalSteps: 4,
        message: `Extrayendo pasos y formatos de ${casesArray.length} casos de prueba...`,
        percent: 25
      });

      const caseIds = casesArray.map(c => c.id).filter(Boolean);
      let caseDetailsMap = {};
      if (caseIds.length > 0) {
        try {
          caseDetailsMap = await invoke('getTestCaseDetailsBatch', { caseIds }) || {};
        } catch (e) {
          console.warn('Error fetching case details batch:', e);
        }
      }

      const enrichedTestCases = casesArray.map(tc => ({
        ...tc,
        testFormat: caseDetailsMap[tc.id] || null
      }));

      // 3. Fetch Full Executions for each Cycle
      setBackupProgress({
        step: 3,
        totalSteps: 4,
        message: `Iniciando respaldo de ${cyclesArray.length} ciclos de prueba...`,
        percent: 35
      });

      const enrichedCycles = [];
      let totalExecutionsCount = 0;

      for (let i = 0; i < cyclesArray.length; i++) {
        const cycle = cyclesArray[i];
        setBackupProgress({
          step: 3,
          totalSteps: 4,
          message: `Respaldando ciclo ${i + 1} de ${cyclesArray.length}: "${cycle.summary || cycle.key}"...`,
          percent: 35 + Math.round(((i + 1) / Math.max(cyclesArray.length, 1)) * 55)
        });

        let executions = [];
        let indexSummary = [];
        try {
          [executions, indexSummary] = await Promise.all([
            invoke('getCycleExecution', { cycleId: cycle.id }).catch(() => []),
            invoke('getCycleExecutionSummary', { cycleId: cycle.id }).catch(() => [])
          ]);
        } catch (e) {
          console.warn(`Error fetching cycle ${cycle.id} execution:`, e);
        }

        const execCount = (executions && executions.length) || (indexSummary && indexSummary.length) || 0;
        totalExecutionsCount += execCount;

        enrichedCycles.push({
          id: cycle.id,
          key: cycle.key,
          summary: cycle.summary,
          planId: cycle.planId || null,
          created: cycle.created,
          updated: cycle.updated,
          lightweightIndex: indexSummary || [],
          executions: executions || []
        });
      }

      // 4. Assemble Backup File
      setBackupProgress({
        step: 4,
        totalSteps: 4,
        message: 'Construyendo y empaquetando archivo JSON de respaldo...',
        percent: 95
      });

      const fullBackupPayload = {
        app: "Test Pulse",
        version: "2.0",
        backupGeneratedAt: new Date().toISOString(),
        project: {
          id: selectedProjectId,
          key: projKey,
          name: currentProj?.name || projKey
        },
        stats: {
          totalFolders: foldersArray.length,
          totalTestCases: enrichedTestCases.length,
          totalTestPlans: plansArray.length,
          totalTestCycles: enrichedCycles.length,
          totalExecutions: totalExecutionsCount
        },
        config: projectConfig,
        folders: foldersArray,
        testCases: enrichedTestCases,
        testPlans: plansArray,
        testCycles: enrichedCycles
      };

      const jsonString = JSON.stringify(fullBackupPayload, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const nowStr = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `testpulse_full_backup_${projKey}_${nowStr}.json`;

      // Trigger direct browser download
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = url;
      downloadAnchor.download = filename;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);

      setBackupProgress({
        done: true,
        filename,
        stats: fullBackupPayload.stats
      });

      addNotification({
        type: 'success',
        title: '✅ Respaldo descargado',
        description: `Se guardó "${filename}" con ${totalExecutionsCount} ejecuciones y ${enrichedTestCases.length} casos.`
      });

    } catch (err) {
      console.error('Error generando backup:', err);
      addNotification({
        type: 'error',
        title: 'Error generando respaldo',
        description: err.message || String(err)
      });
      setBackupProgress(null);
    } finally {
      setIsBackingUp(false);
    }
  };

  const transferSingleEvidence = async (ev, targetRunKeyOrId) => {
    if (!ev || !targetRunKeyOrId) return ev;
    try {
      let blob = null;
      let filename = (typeof ev === 'object' ? ev.filename : null) || (typeof ev === 'string' ? 'evidence.png' : `evidence_${ev.id || Date.now()}.png`);

      if (ev && typeof ev === 'object' && ev.data && typeof ev.data === 'string' && ev.data.startsWith('data:')) {
        const res = await fetch(ev.data);
        blob = await res.blob();
      } else if (ev && (typeof ev === 'object' ? ev.url : null)) {
        let downloadUrl = ev.url;
        if (downloadUrl.startsWith('http')) {
          downloadUrl = downloadUrl.replace(/^https?:\/\/[^\/]+/, '');
        }
        const fileRes = await requestJira(downloadUrl);
        if (fileRes.ok) {
          blob = await fileRes.blob();
        }
      } else if (ev && (typeof ev === 'object' ? ev.id : (typeof ev === 'string' && !ev.startsWith('data:') ? ev : null))) {
        const evId = typeof ev === 'object' ? ev.id : ev;
        const fileRes = await requestJira(`/rest/api/3/attachment/content/${evId}`);
        if (fileRes.ok) {
          blob = await fileRes.blob();
        }
      }

      if (blob) {
        const formData = new FormData();
        formData.append('file', blob, filename);
        const uploadRes = await requestJira(`/rest/api/3/issue/${targetRunKeyOrId}/attachments`, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json',
            'X-Atlassian-Token': 'no-check'
          }
        });
        if (uploadRes.ok) {
          const uploaded = await uploadRes.json();
          if (uploaded && uploaded.length > 0) {
            return {
              id: uploaded[0].id,
              filename: uploaded[0].filename,
              url: uploaded[0].content
            };
          }
        }
      }
    } catch (err) {
      console.warn('Error transferSingleEvidence for target', targetRunKeyOrId, err);
    }
    return ev;
  };

  const transferEvidencesForTestRun = async (testExec, targetRunKeyOrId) => {
    if (!testExec || !targetRunKeyOrId) return testExec;

    // 1. General evidences
    const generalEvs = [...(testExec.evidences || [])];
    if (testExec.evidence && generalEvs.length === 0) generalEvs.push(testExec.evidence);

    const transferredGeneral = [];
    for (const ev of generalEvs) {
      const transferred = await transferSingleEvidence(ev, targetRunKeyOrId);
      transferredGeneral.push(transferred);
    }

    // 2. Iteration evidences
    const transferredIters = [];
    if (Array.isArray(testExec.iterations)) {
      for (const iter of testExec.iterations) {
        const iterEvs = iter.evidences || [];
        const newIterEvs = [];
        for (const ev of iterEvs) {
          const transferred = await transferSingleEvidence(ev, targetRunKeyOrId);
          newIterEvs.push(transferred);
        }
        transferredIters.push({ ...iter, evidences: newIterEvs });
      }
    }

    return {
      ...testExec,
      evidences: transferredGeneral,
      iterations: transferredIters
    };
  };

    const renderConfigTab = () => {
    const currentProject = projects.find(p => String(p.id) === String(selectedProjectId));
    const projectName = currentProject?.name || 'Proyecto';
    const projectKey = currentProject?.key || selectedProjectId;

    return (
      <div className="tab-layout" style={{ background: 'var(--bg-main, #0d1117)', minHeight: 'calc(100vh - 120px)', padding: '1.5rem 2rem 4rem 2rem' }}>
        <main className="main-content" style={{ maxWidth: '1080px', margin: '0 auto' }}>
          
          {/* Header Banner */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '1.2rem',
            paddingBottom: '1.5rem',
            marginBottom: '1.75rem',
            borderBottom: '1px solid var(--ds-border, #30363d)'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '1.6rem' }}>⚙️</span>
                <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary, #e6edf3)' }}>
                  Configuración del Proyecto
                </h1>
                {projectKey && (
                  <span style={{
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    background: 'rgba(56, 139, 253, 0.15)',
                    color: '#58a6ff',
                    border: '1px solid rgba(56, 139, 253, 0.3)',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '12px'
                  }}>
                    {projectName} ({projectKey})
                  </span>
                )}
              </div>
              <p style={{ margin: 0, color: 'var(--text-secondary, #8b949e)', fontSize: '0.92rem', lineHeight: '1.4' }}>
                Administra el mapeo de entidades nativas de Jira, trazabilidad de requerimientos, métricas visibles del tablero y permisos de acceso para Test Pulse Suite v2.1.0.
              </p>
            </div>

            {selectedProjectId && (
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={isSavingConfig}
                className="btn-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.65rem 1.4rem',
                  fontSize: '0.95rem',
                  fontWeight: '600',
                  borderRadius: '6px',
                  background: isSavingConfig ? '#484f58' : '#238636',
                  color: '#ffffff',
                  border: '1px solid rgba(240, 246, 252, 0.1)',
                  cursor: isSavingConfig ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                  transition: 'all 0.2s ease'
                }}
              >
                <span>{isSavingConfig ? '⏳' : '💾'}</span>
                <span>{isSavingConfig ? 'Guardando...' : 'Guardar Configuración'}</span>
              </button>
            )}
          </div>

          {!selectedProjectId ? (
            <div className="glass" style={{ padding: '3.5rem 2rem', textAlign: 'center', borderRadius: '12px', border: '1px dashed var(--ds-border, #30363d)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📂</div>
              <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary, #e6edf3)' }}>Selecciona un Proyecto de Jira</h3>
              <p style={{ margin: 0, color: 'var(--text-secondary, #8b949e)', fontSize: '0.95rem' }}>
                Por favor selecciona un proyecto en la barra superior para acceder y personalizar su configuración.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
              
              {/* Card 1: Mapeo de Tipos de Incidencia */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>🧩</span>
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                    Mapeo de Tipos de Incidencias Nativas de Jira
                  </h2>
                </div>
                <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' }}>
                  Asocia los tipos de issue de tu proyecto con las entidades principales de Test Pulse. Toda la información se almacena y sincroniza de forma nativa en Jira.
                </p>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '1.25rem'
                }}>
                  {/* Test Case */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Casos de Prueba</span>
                      <span style={{ fontSize: '0.72rem', color: '#f85149', background: 'rgba(248,81,73,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Requerido</span>
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                      value={projectConfig.testCaseType || ''}
                      onChange={(e) => setProjectConfig({ ...projectConfig, testCaseType: e.target.value })}
                      required
                    >
                      <option value="">Selecciona un tipo de incidencia...</option>
                      {projectIssueTypes.map(it => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Define los pasos, precondiciones y especificaciones del caso.
                    </span>
                  </div>

                  {/* Test Cycle */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Ciclos de Prueba</span>
                      <span style={{ fontSize: '0.72rem', color: '#f85149', background: 'rgba(248,81,73,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Requerido</span>
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                      value={projectConfig.testCycleType || ''}
                      onChange={(e) => setProjectConfig({ ...projectConfig, testCycleType: e.target.value })}
                      required
                    >
                      <option value="">Selecciona un tipo de incidencia...</option>
                      {projectIssueTypes.map(it => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Agrupa ejecuciones para un sprint, versión o entrega de QA.
                    </span>
                  </div>

                  {/* Test Plan */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Planes de Prueba / Sets</span>
                      <span style={{ fontSize: '0.72rem', color: '#f85149', background: 'rgba(248,81,73,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Requerido</span>
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                      value={projectConfig.planIssueType || ''}
                      onChange={(e) => setProjectConfig({ ...projectConfig, planIssueType: e.target.value })}
                      required
                    >
                      <option value="">Selecciona un tipo de incidencia...</option>
                      {projectIssueTypes.map(it => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Estructura los conjuntos maestros de pruebas y ciclos asociados.
                    </span>
                  </div>

                  {/* Test Run */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Ejecución Nativa (Test Run)</span>
                      <span style={{ fontSize: '0.72rem', color: '#2da44e', background: 'rgba(45,164,78,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Nativo V2</span>
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                      value={projectConfig.testRunType || 'Test Run'}
                      onChange={(e) => setProjectConfig({ ...projectConfig, testRunType: e.target.value })}
                    >
                      <option value="Test Run">Test Run (Recomendado / Predeterminado)</option>
                      {projectIssueTypes.map(it => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Almacena snapshots 1:1, pasos, evidencias y comentarios en Jira.
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Trazabilidad y Requerimientos */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>🔗</span>
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                    Trazabilidad de Requerimientos y Enlaces
                  </h2>
                </div>
                <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' }}>
                  Configura qué incidencias representan requerimientos de negocio y el tipo de enlace para la matriz de trazabilidad y cobertura.
                </p>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '1.25rem'
                }}>
                  {/* Requirement Types */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                      Tipos de Incidencias de Requisitos
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        minHeight: '110px',
                        padding: '0.5rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.88rem'
                      }}
                      multiple
                      value={projectConfig.requirementIssueTypes || []}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
                        setProjectConfig({ ...projectConfig, requirementIssueTypes: selected });
                      }}
                    >
                      {projectIssueTypes.map(it => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Mantén presionado <kbd style={{ background: '#21262d', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>Ctrl</kbd> o <kbd style={{ background: '#21262d', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>Cmd</kbd> para seleccionar varios (ej: Story, Epic, Task).
                    </span>
                  </div>

                  {/* Link Type */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                      Tipo de Enlace en Jira (Issue Link Type)
                    </label>
                    <select
                      className="form-control"
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        background: 'var(--bg-main, #0d1117)',
                        color: 'var(--text-primary, #e6edf3)',
                        border: '1px solid var(--ds-border, #30363d)',
                        borderRadius: '6px',
                        fontSize: '0.9rem'
                      }}
                      value={projectConfig.requirementLinkType || 'ANY'}
                      onChange={(e) => setProjectConfig({ ...projectConfig, requirementLinkType: e.target.value })}
                    >
                      <option value="ANY">Cualquier tipo de enlace (Automático)</option>
                      {linkTypes.map(lt => (
                        <option key={lt.id} value={lt.name}>{lt.name} ({lt.outward} / {lt.inward})</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                      Tipo de relación Jira que vincula los casos de prueba con las historias/epics.
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 3: Gestión de Defectos (Bugs) */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>🐞</span>
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                    Gestión y Detección de Defectos (Bugs)
                  </h2>
                </div>
                <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' }}>
                  Filtro de incidencias para contabilizar defectos y calcular métricas de fallas en los reportes y dashboards.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                    Tipos de Incidencias de Defecto
                  </label>
                  <select
                    className="form-control"
                    style={{
                      width: '100%',
                      minHeight: '100px',
                      padding: '0.5rem',
                      background: 'var(--bg-main, #0d1117)',
                      color: 'var(--text-primary, #e6edf3)',
                      border: '1px solid var(--ds-border, #30363d)',
                      borderRadius: '6px',
                      fontSize: '0.88rem'
                    }}
                    multiple
                    value={projectConfig.bugIssueTypes || []}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
                      setProjectConfig({ ...projectConfig, bugIssueTypes: selected });
                    }}
                  >
                    {projectIssueTypes.map(it => (
                      <option key={it.id} value={it.name}>{it.name}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                    {projectConfig.bugIssueTypes && projectConfig.bugIssueTypes.length > 0
                      ? `Seleccionados: ${projectConfig.bugIssueTypes.join(', ')}`
                      : 'Ninguno seleccionado: Detectará automáticamente tipos comunes (Bug, Defect, Defecto, Falla, Error, Incident, Incidente).'}
                  </span>
                </div>
              </div>

              {/* Card 4: Widgets y Métricas del Tablero */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>📊</span>
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                    Personalización de Widgets del Dashboard
                  </h2>
                </div>
                <p style={{ margin: '0 0 1.25rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' }}>
                  Elige qué widgets y análisis gráficos estarán activos y visibles para el equipo en el Dashboard de Ejecución.
                </p>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  gap: '0.9rem'
                }}>
                  {/* Widget 1 */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    background: projectConfig.showProgreso !== false ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-main, #0d1117)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={projectConfig.showProgreso !== false}
                      onChange={e => setProjectConfig({ ...projectConfig, showProgreso: e.target.checked })}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        📈 Progreso por Ciclo de Pruebas
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Visualiza el avance global, tasa de aprobación y distribución por estatus.
                      </div>
                    </div>
                  </label>

                  {/* Widget 2 */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    background: projectConfig.showTesterStats !== false ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-main, #0d1117)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={projectConfig.showTesterStats !== false}
                      onChange={e => setProjectConfig({ ...projectConfig, showTesterStats: e.target.checked })}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        👥 Distribución por Tester
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Gráfica de productividad y balance de carga de trabajo por tester asignado.
                      </div>
                    </div>
                  </label>

                  {/* Widget 3 */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    background: projectConfig.showExecTypeStats !== false ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-main, #0d1117)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={projectConfig.showExecTypeStats !== false}
                      onChange={e => setProjectConfig({ ...projectConfig, showExecTypeStats: e.target.checked })}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        ⚙️ Pruebas Manuales vs Automatizadas
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Compara la proporción de cobertura entre tipos de ejecución.
                      </div>
                    </div>
                  </label>

                  {/* Widget 4 */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    background: projectConfig.showBugTimes !== false ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-main, #0d1117)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={projectConfig.showBugTimes !== false}
                      onChange={e => setProjectConfig({ ...projectConfig, showBugTimes: e.target.checked })}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        ⏱️ Tiempo de Resolución de Defectos (MTTR)
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Calcula el promedio de horas laborales para la corrección de fallas.
                      </div>
                    </div>
                  </label>

                  {/* Widget 5 */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    background: projectConfig.showFeatureStats !== false ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-main, #0d1117)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={projectConfig.showFeatureStats !== false}
                      onChange={e => setProjectConfig({ ...projectConfig, showFeatureStats: e.target.checked })}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        📁 Estado por Módulo o Funcionalidad
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                        Analiza la cobertura funcional agrupada por carpetas y suites de prueba.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Card 4.5: Automatización y Envío Programado de Reportes Ejecutivos */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.8rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '1.3rem' }}>⏰</span>
                      <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                        Automatización y Programación de Reportes Ejecutivos
                      </h2>
                    </div>
                    <p style={{ margin: 0, color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem', maxWidth: '650px' }}>
                      Programa el envío recurrente del reporte ejecutivo de QA por correo mediante el disparador horario de Atlassian Forge y reglas de <strong>Jira Automation</strong> con estilo corporativo de El Puerto de Liverpool.
                    </p>
                  </div>

                  <span style={{
                    padding: '0.35rem 0.8rem',
                    borderRadius: '20px',
                    fontSize: '0.82rem',
                    fontWeight: '600',
                    background: reportAutomationConfig.enabled ? 'rgba(225, 0, 122, 0.15)' : 'rgba(139, 148, 158, 0.15)',
                    color: reportAutomationConfig.enabled ? '#E1007A' : '#8b949e',
                    border: `1px solid ${reportAutomationConfig.enabled ? 'rgba(225, 0, 122, 0.3)' : 'rgba(139, 148, 158, 0.3)'}`
                  }}>
                    {reportAutomationConfig.enabled ? '🟢 Programador Activo' : '⚪ Programador en Pausa'}
                  </span>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                  padding: '1rem 1.25rem',
                  background: 'var(--bg-main, #0d1117)',
                  borderRadius: '8px',
                  border: '1px solid var(--ds-border, #30363d)',
                  marginTop: '0.5rem'
                }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary, #e6edf3)' }}>
                    <div>
                      <strong>Horario Programado:</strong> {reportAutomationConfig.frequency === 'daily' ? 'Diario (Lun - Dom)' : reportAutomationConfig.frequency === 'weekly' ? 'Semanal (Viernes)' : 'Lunes a Viernes'} a las <strong>{reportAutomationConfig.hour || 18}:00 hrs CDMX</strong>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)', marginTop: '2px' }}>
                      Webhook: {reportAutomationConfig.webhookUrl ? (reportAutomationConfig.webhookUrl.substring(0, 45) + '...') : 'No configurado'}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      loadReportAutomationConfig();
                      setShowReportAutomationModal(true);
                    }}
                    className="btn-primary"
                    style={{
                      padding: '0.5rem 1.25rem',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      background: '#E1007A',
                      borderColor: '#E1007A'
                    }}
                  >
                    ⚙️ Configurar Automatización
                  </button>
                </div>
              </div>

              {/* Card 5: Control de Acceso al Proyecto (Admin Only) */}
              {isAdmin && (
                <div className="glass" style={{
                  background: 'var(--bg-surface, #161b22)',
                  border: '1px solid var(--ds-border, #30363d)',
                  borderRadius: '10px',
                  padding: '1.5rem 1.75rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '1.3rem' }}>🛡️</span>
                        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                          Control de Acceso y Estado de la Suite
                        </h2>
                      </div>
                      <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem', maxWidth: '650px' }}>
                        Habilita o deshabilita el acceso a Test Pulse Suite para este proyecto. Si está deshabilitado, los usuarios no administradores no podrán ver ni interactuar con la app en este proyecto.
                      </p>
                    </div>

                    <span style={{
                      padding: '0.35rem 0.8rem',
                      borderRadius: '20px',
                      fontSize: '0.82rem',
                      fontWeight: '600',
                      background: isProjectAllowed ? 'rgba(45, 164, 78, 0.15)' : 'rgba(248, 81, 73, 0.15)',
                      color: isProjectAllowed ? '#3fb950' : '#f85149',
                      border: `1px solid ${isProjectAllowed ? 'rgba(45, 164, 78, 0.3)' : 'rgba(248, 81, 73, 0.3)'}`
                    }}>
                      {isProjectAllowed ? '🟢 Activo en este Proyecto' : '⚪ Inactivo en este Proyecto'}
                    </span>
                  </div>

                  <label style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    background: 'var(--bg-main, #0d1117)',
                    padding: '0.75rem 1.25rem',
                    borderRadius: '8px',
                    border: '1px solid var(--ds-border, #30363d)',
                    fontWeight: '500',
                    color: 'var(--text-primary, #e6edf3)',
                    fontSize: '0.9rem'
                  }}>
                    <input
                      type="checkbox"
                      checked={isProjectAllowed}
                      onChange={async (e) => {
                        const enabled = e.target.checked;
                        setIsProjectAllowed(enabled);
                        try {
                          await invoke('setAllowedProjects', { projectId: selectedProjectId, enabled });
                          addNotification({
                            type: enabled ? 'success' : 'info',
                            title: enabled ? 'Proyecto Habilitado' : 'Proyecto Deshabilitado',
                            description: `Test Pulse Suite ha sido ${enabled ? 'habilitado' : 'deshabilitado'} para este proyecto.`
                          });
                        } catch (err) {
                          console.error("Error setting allowed project:", err);
                          addNotification({
                            type: 'error',
                            title: 'Error de permisos',
                            description: err.message || 'No se pudo actualizar el estado de acceso del proyecto.'
                          });
                        }
                      }}
                      style={{ width: '1.2rem', height: '1.2rem', accentColor: '#238636', cursor: 'pointer' }}
                    />
                    <span>Habilitar Test Pulse Suite para usuarios de este proyecto</span>
                  </label>
                </div>
              )}

              {/* Bottom Action Bar */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: '1rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--ds-border, #30363d)',
                marginBottom: '2rem'
              }}>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="btn-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem 2rem',
                    fontSize: '1rem',
                    fontWeight: '600',
                    borderRadius: '6px',
                    background: isSavingConfig ? '#484f58' : '#238636',
                    color: '#ffffff',
                    border: '1px solid rgba(240, 246, 252, 0.1)',
                    cursor: isSavingConfig ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
                  }}
                >
                  <span>{isSavingConfig ? '⏳' : '💾'}</span>
                  <span>{isSavingConfig ? 'Guardando cambios...' : 'Guardar Configuración'}</span>
                </button>
              </div>

            </form>
          )}

        </main>
      </div>
    );
  };

  const handleGlobalTestAutomatedReportDispatch = async () => {
    if (!reportAutomationConfig.webhookUrl || !reportAutomationConfig.webhookUrl.startsWith('http')) {
      addNotification({
        type: 'warning',
        title: 'Webhook Inválido',
        description: 'Por favor ingresa una URL de Webhook válida de Jira Automation (ej. https://automation.atlassian.com/pro/hooks/...)'
      });
      return;
    }

    try {
      setReportAutomationTesting(true);
      const targetId = selectedProjectId || context?.extension?.project?.id;
      const currentProjectObj = projects.find(p => String(p.id) === String(targetId) || String(p.key) === String(targetId));
      const projName = currentProjectObj?.name || context?.extension?.project?.name || 'Proyecto';
      const projKey = currentProjectObj?.key || context?.extension?.project?.key || targetId;

      let backendSuccess = false;
      try {
        const res = await invoke('triggerManualReportDispatch', {
          projectId: targetId,
          webhookUrl: reportAutomationConfig.webhookUrl,
          reportData: {
            projectName: projName,
            projectKey: projKey,
            recipients: reportAutomationConfig.recipients || ''
          }
        });

        if (res && res.success) {
          backendSuccess = true;
          setReportAutomationLastDispatch(res.lastDispatch || null);
          addNotification({
            type: 'success',
            title: '⚡ ¡Prueba de Envío Exitosa!',
            description: `Se despachó el reporte al Webhook de Jira Automation (HTTP ${res.statusCode || 200}). Revisa la regla y tu correo.`
          });
          return;
        }
      } catch (backendErr) {
        console.warn('[Automation] Backend dispatch attempt failed, falling back to client-side direct webhook...', backendErr);
      }

      // Fallback: Direct client-side dispatch
      const nowFormatted = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
      const testHtml = `
        <div style="max-width: 700px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; border: 1px solid #DFE1E6; border-radius: 8px; overflow: hidden; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #E1007A 0%, #002D62 100%); color: #ffffff; padding: 20px 24px;">
            <div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #FFE0F0;">TEST PULSE SUITE • PRUEBA DE CONEXIÓN</div>
            <h2 style="margin: 4px 0 0 0; font-size: 20px; color: #ffffff;">Reporte Ejecutivo (Prueba)</h2>
          </div>
          <div style="padding: 24px; color: #172B4D;">
            <p style="font-size: 14px; line-height: 1.5; margin: 0 0 12px 0;">Este es un correo de prueba de <strong>Test Pulse Suite</strong> para verificar la regla de <strong>Jira Automation</strong>.</p>
            <p style="font-size: 13px; margin: 0 0 8px 0;"><strong>Proyecto:</strong> ${projName} (${projKey})</p>
            <p style="font-size: 13px; margin: 0 0 16px 0;"><strong>Fecha y Hora de Prueba:</strong> ${nowFormatted} (CDMX)</p>
            <div style="background: #E3FCEF; border: 1px solid #ABF5D1; color: #006644; padding: 12px 16px; border-radius: 6px; font-weight: 600; font-size: 13px;">
              🟢 La integración con el webhook entrante de Jira Automation está operando correctamente.
            </div>
          </div>
          <div style="background: #FAFBFC; padding: 12px 24px; border-top: 1px solid #EBECF0; font-size: 11px; color: #626F86; text-align: center;">
            Test Pulse Suite • El Puerto de Liverpool
          </div>
        </div>
      `;

      const directRes = await fetch(reportAutomationConfig.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          source: 'Test Pulse Suite v2.1.0',
          projectId: targetId || 'N/A',
          projectName: projName,
          projectKey: projKey,
          recipients: reportAutomationConfig.recipients || '',
          emailSubject: `[Prueba de Conexión] Test Pulse Suite - ${projName} (${nowFormatted})`,
          htmlReport: testHtml,
          plainText: `Test Pulse Suite - Prueba de Conexión para ${projName} (${nowFormatted})`,
          summary: { type: 'TEST_DISPATCH' },
          stats: {}
        })
      });

      const lastLog = {
        timestamp: new Date().toISOString(),
        status: directRes.ok ? 'SUCCESS' : 'ERROR',
        statusCode: directRes.status,
        statusText: directRes.statusText || (directRes.ok ? 'OK' : 'Error'),
        recipients: reportAutomationConfig.recipients || 'Configurados en Jira Automation',
        emailSubject: `[Prueba de Conexión] Test Pulse Suite - ${projName} (${nowFormatted})`
      };
      setReportAutomationLastDispatch(lastLog);

      if (directRes.ok || (directRes.status >= 200 && directRes.status < 300)) {
        addNotification({
          type: 'success',
          title: '⚡ ¡Prueba de Envío Exitosa!',
          description: `Se despachó el reporte al Webhook de Jira Automation (HTTP ${directRes.status}). Revisa la regla y tu correo.`
        });
      } else {
        addNotification({
          type: 'error',
          title: 'Error al Despachar',
          description: `Jira Automation respondió con código ${directRes.status}. Revisa que la URL sea la correcta.`
        });
      }

    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Error de Despacho',
        description: err.message || String(err)
      });
    } finally {
      setReportAutomationTesting(false);
    }
  };

  const renderReportAutomationModal = () => {
    if (!showReportAutomationModal) return null;

    const currentProjectObj = projects.find(p => String(p.id) === String(selectedProjectId) || String(p.key) === String(selectedProjectId));
    const ctxProj = context?.extension?.project;
    let projName = currentProjectObj?.name || ctxProj?.name || 'Proyecto Actual';
    let projKey = currentProjectObj?.key || ctxProj?.key || selectedProjectId;

    return (
      <div className="modal-overlay" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(9, 30, 66, 0.65)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '1rem'
      }}>
        <div style={{
          background: '#FFFFFF',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '820px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 16px 40px rgba(0, 45, 98, 0.25)',
          border: '1px solid #DFE1E6',
          overflow: 'hidden'
        }}>
          
          {/* Header (Liverpool Gradient Banner) */}
          <div style={{
            background: 'linear-gradient(135deg, #E1007A 0%, #002D62 100%)',
            color: '#ffffff',
            padding: '20px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                color: '#FFE0F0',
                marginBottom: '4px'
              }}>
                ⚡ TEST PULSE SUITE • JIRA AUTOMATION
              </div>
              <h2 style={{
                margin: 0,
                fontSize: '19px',
                fontWeight: 700,
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>⏰</span> Programación y Envío Automático de Reportes
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowReportAutomationModal(false)}
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                color: '#ffffff',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s'
              }}
              title="Cerrar ventana"
            >
              ✕
            </button>
          </div>

          {/* Sub-Tabs Nav */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid #DFE1E6',
            background: '#F8F9FA',
            padding: '0 24px'
          }}>
            <button
              type="button"
              onClick={() => setReportAutomationActiveTab('config')}
              style={{
                padding: '12px 18px',
                border: 'none',
                background: 'transparent',
                borderBottom: reportAutomationActiveTab === 'config' ? '3px solid #E1007A' : '3px solid transparent',
                color: reportAutomationActiveTab === 'config' ? '#E1007A' : '#626F86',
                fontWeight: reportAutomationActiveTab === 'config' ? 700 : 600,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              ⚙️ Configuración del Envío
            </button>
            <button
              type="button"
              onClick={() => setReportAutomationActiveTab('guide')}
              style={{
                padding: '12px 18px',
                border: 'none',
                background: 'transparent',
                borderBottom: reportAutomationActiveTab === 'guide' ? '3px solid #E1007A' : '3px solid transparent',
                color: reportAutomationActiveTab === 'guide' ? '#E1007A' : '#626F86',
                fontWeight: reportAutomationActiveTab === 'guide' ? 700 : 600,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              📖 Guía de Jira Automation (Paso a Paso)
            </button>
            <button
              type="button"
              onClick={() => setReportAutomationActiveTab('history')}
              style={{
                padding: '12px 18px',
                border: 'none',
                background: 'transparent',
                borderBottom: reportAutomationActiveTab === 'history' ? '3px solid #E1007A' : '3px solid transparent',
                color: reportAutomationActiveTab === 'history' ? '#E1007A' : '#626F86',
                fontWeight: reportAutomationActiveTab === 'history' ? 700 : 600,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              📜 Historial y Último Envío
            </button>
          </div>

          {/* Modal Content Body */}
          <div style={{ padding: '22px 26px', overflowY: 'auto', flex: 1, color: '#172B4D' }}>
            
            {/* TAB 1: CONFIG */}
            {reportAutomationActiveTab === 'config' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                
                {/* Status Toggle Card */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  borderRadius: '8px',
                  background: reportAutomationConfig.enabled ? '#FDF2F7' : '#F4F5F7',
                  border: `1px solid ${reportAutomationConfig.enabled ? '#F5B8D8' : '#DFE1E6'}`
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        display: 'inline-block',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: reportAutomationConfig.enabled ? '#28A745' : '#8993A4'
                      }} />
                      <strong style={{ fontSize: '14px', color: reportAutomationConfig.enabled ? '#E1007A' : '#172B4D' }}>
                        {reportAutomationConfig.enabled ? 'Automatización de Reportes ACTIVADA' : 'Automatización en PAUSA (Desactivada)'}
                      </strong>
                    </div>
                    <div style={{ fontSize: '12px', color: '#626F86', marginTop: '4px' }}>
                      {reportAutomationConfig.enabled
                        ? `El reporte se enviará de forma automática según la frecuencia seleccionada (${reportAutomationConfig.hour || 18}:00 hrs CDMX).`
                        : 'El programador horario no despachará correos automáticos hasta que lo actives.'}
                    </div>
                  </div>

                  <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '26px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!reportAutomationConfig.enabled}
                      onChange={(e) => setReportAutomationConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute',
                      top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: reportAutomationConfig.enabled ? '#E1007A' : '#C1C7D0',
                      borderRadius: '26px',
                      transition: '0.3s'
                    }}>
                      <span style={{
                        position: 'absolute',
                        height: '20px',
                        width: '20px',
                        left: reportAutomationConfig.enabled ? '24px' : '3px',
                        bottom: '3px',
                        backgroundColor: '#ffffff',
                        borderRadius: '50%',
                        transition: '0.3s',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                      }} />
                    </span>
                  </label>
                </div>

                {/* Scope Preview Banner */}
                <div style={{
                  padding: '10px 14px',
                  background: '#F8F9FA',
                  borderRadius: '6px',
                  border: '1px solid #DFE1E6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  color: '#44546F'
                }}>
                  <span><strong>Proyecto Asociado:</strong> <span style={{ color: '#E1007A', fontWeight: 600 }}>{projName} ({projKey})</span></span>
                  <span><strong>Zona Horaria:</strong> América/Ciudad de México (CDMX / GMT-6)</span>
                </div>

                {/* Field 1: Jira Automation Webhook URL */}
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#002D62', marginBottom: '6px' }}>
                    🔗 URL del Webhook de Jira Automation <span style={{ color: '#DE350B' }}>*</span>
                  </label>
                  <input
                    type="url"
                    placeholder="https://automation.atlassian.com/pro/hooks/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={reportAutomationConfig.webhookUrl || ''}
                    onChange={(e) => setReportAutomationConfig(prev => ({ ...prev, webhookUrl: e.target.value.trim() }))}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '13px',
                      borderRadius: '6px',
                      border: '1px solid #DFE1E6',
                      boxSizing: 'border-box',
                      color: '#172B4D',
                      fontFamily: 'monospace',
                      background: '#FFFFFF'
                    }}
                  />
                  <div style={{ fontSize: '11px', color: '#626F86', marginTop: '4px' }}>
                    Obtén esta URL creando una regla en <strong>Jira Automation</strong> con el disparador <em>"Incoming Webhook"</em>.
                  </div>
                </div>

                {/* Field 2: Recipients */}
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#002D62', marginBottom: '6px' }}>
                    👥 Lista de Destinatarios (Correos Electrónicos)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="lider.qa@liverpool.com.mx, product.manager@liverpool.com.mx, equipo-dev@liverpool.com.mx"
                    value={reportAutomationConfig.recipients || ''}
                    onChange={(e) => setReportAutomationConfig(prev => ({ ...prev, recipients: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '13px',
                      borderRadius: '6px',
                      border: '1px solid #DFE1E6',
                      boxSizing: 'border-box',
                      color: '#172B4D',
                      background: '#FFFFFF',
                      resize: 'vertical'
                    }}
                  />
                  <div style={{ fontSize: '11px', color: '#626F86', marginTop: '4px' }}>
                    Separa múltiples direcciones con comas. Jira Automation recibirá esta lista en el smart value <code style={{ background: '#F4F5F7', padding: '1px 4px', borderRadius: '3px' }}>&#123;&#123;webhookData.recipients&#125;&#125;</code>.
                  </div>
                </div>

                {/* Grid: Frequency & Time */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  {/* Frequency */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#002D62', marginBottom: '6px' }}>
                      📅 Frecuencia de Envío
                    </label>
                    <select
                      value={reportAutomationConfig.frequency || 'weekdays'}
                      onChange={(e) => setReportAutomationConfig(prev => ({ ...prev, frequency: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: '13px',
                        borderRadius: '6px',
                        border: '1px solid #DFE1E6',
                        background: '#FFFFFF',
                        color: '#172B4D'
                      }}
                    >
                      <option value="weekdays">Lunes a Viernes (Días Hábiles)</option>
                      <option value="daily">Diario (Todos los días, Lun - Dom)</option>
                      <option value="weekly">Semanal (Viernes de Cierre)</option>
                    </select>
                  </div>

                  {/* Scheduled Hour */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#002D62', marginBottom: '6px' }}>
                      ⏰ Hora de Envío (CDMX GMT-6)
                    </label>
                    <select
                      value={reportAutomationConfig.hour || '18'}
                      onChange={(e) => setReportAutomationConfig(prev => ({ ...prev, hour: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: '13px',
                        borderRadius: '6px',
                        border: '1px solid #DFE1E6',
                        background: '#FFFFFF',
                        color: '#172B4D'
                      }}
                    >
                      <option value="08">08:00 hrs (Inicio de Jornada)</option>
                      <option value="09">09:00 hrs</option>
                      <option value="10">10:00 hrs</option>
                      <option value="11">11:00 hrs</option>
                      <option value="12">12:00 hrs (Mediodía)</option>
                      <option value="13">13:00 hrs</option>
                      <option value="14">14:00 hrs</option>
                      <option value="15">15:00 hrs</option>
                      <option value="16">16:00 hrs</option>
                      <option value="17">17:00 hrs</option>
                      <option value="18">18:00 hrs (Fin de Jornada - Recomendado)</option>
                      <option value="19">19:00 hrs</option>
                      <option value="20">20:00 hrs</option>
                    </select>
                  </div>
                </div>

                {/* Scope selectors */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#002D62', marginBottom: '6px' }}>
                      📋 Alcance de Planes de Prueba
                    </label>
                    <select
                      value={reportAutomationConfig.scopePlan || 'all'}
                      onChange={(e) => setReportAutomationConfig(prev => ({ ...prev, scopePlan: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: '13px',
                        borderRadius: '6px',
                        border: '1px solid #DFE1E6',
                        background: '#FFFFFF',
                        color: '#172B4D'
                      }}
                    >
                      <option value="all">Todos los planes activos del proyecto</option>
                      <option value="latest">Último plan de pruebas creado</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#002D62', marginBottom: '6px' }}>
                      🔄 Alcance de Ciclos de Ejecución
                    </label>
                    <select
                      value={reportAutomationConfig.scopeCycle || 'all'}
                      onChange={(e) => setReportAutomationConfig(prev => ({ ...prev, scopeCycle: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: '13px',
                        borderRadius: '6px',
                        border: '1px solid #DFE1E6',
                        background: '#FFFFFF',
                        color: '#172B4D'
                      }}
                    >
                      <option value="all">Todos los ciclos del proyecto</option>
                      <option value="latest">Último ciclo ejecutado</option>
                    </select>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 2: GUIDE */}
            {reportAutomationActiveTab === 'guide' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '13px' }}>
                <div style={{ background: '#FDF8FA', borderLeft: '4px solid #E1007A', padding: '12px 16px', borderRadius: '0 6px 6px 0' }}>
                  <strong style={{ color: '#E1007A' }}>¿Cómo funciona la integración con Jira Automation?</strong>
                  <p style={{ margin: '4px 0 0 0', color: '#44546F', fontSize: '12px', lineHeight: 1.4 }}>
                    Test Pulse Suite genera el reporte ejecutivo con el diseño corporativo de El Puerto de Liverpool y lo envía mediante una petición HTTP POST segura al Webhook de Jira Automation. Jira Automation se encarga de despachar el correo con la infraestructura nativa de Atlassian.
                  </p>
                </div>

                {/* Step 1 */}
                <div style={{ border: '1px solid #DFE1E6', borderRadius: '8px', padding: '14px 16px', background: '#FFFFFF' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ background: '#002D62', color: '#fff', width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>1</span>
                    <strong style={{ fontSize: '14px', color: '#002D62' }}>Crear Regla en Jira Automation</strong>
                  </div>
                  <div style={{ color: '#44546F', fontSize: '12px', lineHeight: 1.5, paddingLeft: '30px' }}>
                    En tu proyecto de Jira, ve a <strong>Configuración del proyecto</strong> (<em>Project settings</em>) &gt; <strong>Automatización</strong> (<em>Automation</em>) y haz clic en <strong>Crear regla</strong> (<em>Create rule</em>).
                  </div>
                </div>

                {/* Step 2 */}
                <div style={{ border: '1px solid #DFE1E6', borderRadius: '8px', padding: '14px 16px', background: '#FFFFFF' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ background: '#002D62', color: '#fff', width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>2</span>
                    <strong style={{ fontSize: '14px', color: '#002D62' }}>Configurar Disparador: Webhook Entrante</strong>
                  </div>
                  <div style={{ color: '#44546F', fontSize: '12px', lineHeight: 1.5, paddingLeft: '30px' }}>
                    <p style={{ margin: '0 0 6px 0' }}>
                      Selecciona el componente <strong>Webhook entrante</strong> (<em>Incoming webhook</em>) y configura:
                    </p>
                    <ul style={{ margin: '0 0 8px 0', paddingLeft: '20px' }}>
                      <li><strong>Incidencias del webhook:</strong> Selecciona <em>No hay incidencias en el webhook (No issues from webhook)</em>.</li>
                    </ul>
                    <p style={{ margin: '0' }}>
                      Copia la <strong>URL del Webhook</strong> generada y pégala en la pestaña <strong>⚙️ Configuración del Envío</strong> de este modal.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div style={{ border: '1px solid #DFE1E6', borderRadius: '8px', padding: '14px 16px', background: '#FFFFFF' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ background: '#002D62', color: '#fff', width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>3</span>
                    <strong style={{ fontSize: '14px', color: '#002D62' }}>Agregar Acción: Enviar Correo Electrónico</strong>
                  </div>
                  <div style={{ color: '#44546F', fontSize: '12px', lineHeight: 1.5, paddingLeft: '30px' }}>
                    <p style={{ margin: '0 0 8px 0' }}>
                      Agrega la acción <strong>Enviar correo electrónico</strong> (<em>Send email</em>) y mapea los campos usando los <strong>Smart Values</strong> de Jira:
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {/* Smart Value 1 */}
                      <div style={{ background: '#F4F5F7', padding: '8px 12px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>Para (To):</strong> <code style={{ color: '#E1007A', fontWeight: 700 }}>&#123;&#123;webhookData.recipients&#125;&#125;</code>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText('{{webhookData.recipients}}');
                            addNotification({ type: 'success', title: 'Copiado', description: '{{webhookData.recipients}} copiado al portapapeles' });
                          }}
                          style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #DFE1E6', background: '#fff', cursor: 'pointer' }}
                        >
                          📋 Copiar
                        </button>
                      </div>

                      {/* Smart Value 2 */}
                      <div style={{ background: '#F4F5F7', padding: '8px 12px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>Asunto (Subject):</strong> <code style={{ color: '#E1007A', fontWeight: 700 }}>&#123;&#123;webhookData.emailSubject&#125;&#125;</code>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText('{{webhookData.emailSubject}}');
                            addNotification({ type: 'success', title: 'Copiado', description: '{{webhookData.emailSubject}} copiado al portapapeles' });
                          }}
                          style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #DFE1E6', background: '#fff', cursor: 'pointer' }}
                        >
                          📋 Copiar
                        </button>
                      </div>

                      {/* Smart Value 3 */}
                      <div style={{ background: '#F4F5F7', padding: '8px 12px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>Contenido (Content HTML):</strong> <code style={{ color: '#E1007A', fontWeight: 700 }}>&#123;&#123;webhookData.htmlReport&#125;&#125;</code>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText('{{webhookData.htmlReport}}');
                            addNotification({ type: 'success', title: 'Copiado', description: '{{webhookData.htmlReport}} copiado al portapapeles' });
                          }}
                          style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #DFE1E6', background: '#fff', cursor: 'pointer' }}
                        >
                          📋 Copiar
                        </button>
                      </div>
                    </div>

                    <div style={{ marginTop: '10px', color: '#626F86', fontSize: '11px' }}>
                      💡 <strong>Tip:</strong> Asegúrate de marcar la casilla <em>"Convert line breaks to HTML"</em> o permitir HTML en el cuerpo del correo en Jira Automation.
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 3: HISTORY */}
            {reportAutomationActiveTab === 'history' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#002D62' }}>
                  📜 Registro del Último Envío Despachado
                </div>

                {reportAutomationLastDispatch ? (
                  <div style={{
                    border: `1px solid ${reportAutomationLastDispatch.status === 'SUCCESS' || reportAutomationLastDispatch.success ? '#B7EBCE' : '#FFCCC7'}`,
                    background: reportAutomationLastDispatch.status === 'SUCCESS' || reportAutomationLastDispatch.success ? '#F4FBF7' : '#FFF1F0',
                    borderRadius: '8px',
                    padding: '16px 18px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '4px 10px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 700,
                        background: reportAutomationLastDispatch.status === 'SUCCESS' || reportAutomationLastDispatch.success ? '#E3FCEF' : '#FFEBE6',
                        color: reportAutomationLastDispatch.status === 'SUCCESS' || reportAutomationLastDispatch.success ? '#006644' : '#BF2600'
                      }}>
                        {reportAutomationLastDispatch.status === 'SUCCESS' || reportAutomationLastDispatch.success ? '🟢 Despacho Exitoso' : '🔴 Falló el Despacho'}
                      </span>
                      <span style={{ fontSize: '12px', color: '#626F86' }}>
                        📅 {new Date(reportAutomationLastDispatch.timestamp).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })} (CDMX)
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: '#172B4D' }}>
                      <div>
                        <strong>Código HTTP / Estado:</strong> <code>{reportAutomationLastDispatch.statusCode || reportAutomationLastDispatch.status || '200 OK'}</code>
                      </div>
                      <div>
                        <strong>Asunto Enviado:</strong> {reportAutomationLastDispatch.emailSubject || reportAutomationLastDispatch.subject || 'Reporte Ejecutivo'}
                      </div>
                      <div>
                        <strong>Destinatarios:</strong> {reportAutomationLastDispatch.recipients || 'Configurados en Jira Automation'}
                      </div>
                      {reportAutomationLastDispatch.responseSummary && (
                        <div>
                          <strong>Respuesta del Servidor:</strong>
                          <pre style={{ margin: '4px 0 0 0', padding: '6px 10px', background: '#FFFFFF', border: '1px solid #DFE1E6', borderRadius: '4px', fontSize: '11px', overflowX: 'auto' }}>
                            {reportAutomationLastDispatch.responseSummary}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    padding: '2rem',
                    textAlign: 'center',
                    background: '#F8F9FA',
                    borderRadius: '8px',
                    border: '1px dashed #DFE1E6',
                    color: '#626F86'
                  }}>
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📬</div>
                    <strong>Aún no se han registrado envíos para este proyecto.</strong>
                    <div style={{ fontSize: '12px', marginTop: '4px' }}>
                      Configura la URL del webhook y haz clic en <em>"⚡ Probar Envío Inmediato"</em> para verificar la conexión.
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Modal Footer */}
          <div style={{
            padding: '14px 24px',
            borderTop: '1px solid #DFE1E6',
            background: '#F8F9FA',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <button
              type="button"
              disabled={reportAutomationTesting || !reportAutomationConfig.webhookUrl}
              onClick={handleGlobalTestAutomatedReportDispatch}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 600,
                borderRadius: '6px',
                border: '1px solid #002D62',
                background: '#FFFFFF',
                color: '#002D62',
                cursor: (reportAutomationTesting || !reportAutomationConfig.webhookUrl) ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title="Envía una prueba real a Jira Automation en este momento"
            >
              {reportAutomationTesting ? '⏳ Probando Envío...' : '⚡ Probar Envío Inmediato'}
            </button>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setShowReportAutomationModal(false)}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid #DFE1E6',
                  background: '#FFFFFF',
                  color: '#44546F',
                  cursor: 'pointer'
                }}
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={reportAutomationLoading}
                onClick={saveReportAutomationConfigHandler}
                style={{
                  padding: '8px 20px',
                  fontSize: '13px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  background: '#E1007A',
                  color: '#FFFFFF',
                  cursor: reportAutomationLoading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 6px rgba(225, 0, 122, 0.3)'
                }}
              >
                {reportAutomationLoading ? '💾 Guardando...' : '💾 Guardar Configuración'}
              </button>
            </div>
          </div>

        </div>
      </div>
    );
  };

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
      {renderReportAutomationModal()}
    </>
  );

  if (loading) {
    return (
      <div className="app-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--jira-bg-app, #F7F8F9)' }}>
        <TestPulseLoader size={120} text="Cargando Test Pulse Enterprise Suite..." />
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
        <strong>Test Pulse Suite</strong> v2.1.0 © El Puerto de Liverpool
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

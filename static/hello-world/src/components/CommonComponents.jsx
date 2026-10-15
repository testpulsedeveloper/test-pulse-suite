import React, { useState, useEffect, useCallback } from 'react';
import { requestJira } from '@forge/bridge';
import { formatAttachmentSize } from '../utils/constants';

export const RichTextEditor = ({ value, onChange, disabled }) => {
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

export const SearchableSelect = ({ value, onChange, options, placeholder }) => {
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

export function BugAttachmentImageCard({ att, onPreview }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let createdUrl = null;

    async function loadThumb() {
      try {
        const res = await requestJira(`/rest/api/3/attachment/content/${att.id}`);
        if (res.ok && active) {
          const blob = await res.blob();
          createdUrl = URL.createObjectURL(blob);
          setBlobUrl(createdUrl);
        }
      } catch (e) {
        // Fallback gracefully without breaking UI
      } finally {
        if (active) setLoading(false);
      }
    }

    loadThumb();

    return () => {
      active = false;
      if (createdUrl) {
        try { URL.revokeObjectURL(createdUrl); } catch (e) {}
      }
    };
  }, [att.id]);

  return (
    <div
      onClick={() => onPreview(att)}
      style={{
        border: '1px solid #DCDFE4',
        borderRadius: '6px',
        overflow: 'hidden',
        background: '#FFFFFF',
        cursor: 'pointer',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        display: 'flex',
        flexDirection: 'column'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 8px rgba(9,30,66,0.12)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
      title="Clic para ver en pantalla completa"
    >
      <div style={{ height: '110px', backgroundColor: '#F4F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderBottom: '1px solid #EBECF0', position: 'relative' }}>
        {blobUrl ? (
          <img
            src={blobUrl}
            alt={att.filename}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#626F86', fontSize: '10px' }}>
            <div style={{ width: '16px', height: '16px', border: '2px solid #DCDFE4', borderTop: '2px solid #0C66E4', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
            <span>Cargando...</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: '#0C66E4' }}>
            <span style={{ fontSize: '24px' }}>📷</span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#626F86' }}>Ver Imagen</span>
          </div>
        )}
      </div>
      <div style={{ padding: '6px 8px', fontSize: '11px' }}>
        <div style={{ fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={att.filename}>
          {att.filename}
        </div>
        <div style={{ color: '#626F86', fontSize: '10px', marginTop: '2px' }}>
          {formatAttachmentSize(att.size)}
        </div>
      </div>
    </div>
  );
}

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

export function NotificationProvider({ children }) {
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

export const useNotification = () => {
  const ctx = React.useContext(NotificationContext);
  if (!ctx) return { addNotification: ({ title, description }) => console.warn('Notification:', title, description) };
  return ctx;
};

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { formatAttachmentSize, normalizeUiStatus } from '../utils/constants';
import { fetchAttachmentBlobData, getCachedAttachmentBlobUrl, sanitizeHtml } from '../utils/adfUtils';

export const RichTextEditor = ({ value, onChange, disabled }) => {
  const editorRef = React.useRef(null);

  React.useEffect(() => {
    // Stored rich text is sanitized before it becomes live DOM inside the editor.
    const safeValue = sanitizeHtml(value || '');
    if (editorRef.current && editorRef.current.innerHTML !== safeValue) {
      editorRef.current.innerHTML = safeValue;
    }
  }, [value]);

  const execCmd = (cmd) => {
    document.execCommand(cmd, false, null);
    if (editorRef.current) {
      onChange(sanitizeHtml(editorRef.current.innerHTML));
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
        onBlur={() => onChange(sanitizeHtml(editorRef.current.innerHTML))}
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
  const [blobUrl, setBlobUrl] = useState(() => getCachedAttachmentBlobUrl(att.id));
  const [loading, setLoading] = useState(() => !getCachedAttachmentBlobUrl(att.id));

  useEffect(() => {
    let active = true;
    const existing = getCachedAttachmentBlobUrl(att.id);
    if (existing) {
      setBlobUrl(existing);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchAttachmentBlobData(att.id, att.mimeType || 'image/png')
      .then((res) => {
        if (active && res && res.blobUrl) {
          setBlobUrl(res.blobUrl);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [att.id, att.mimeType]);

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

/**
 * Renders a single PDF page onto a high-DPI HTML5 canvas.
 */
function PdfPageCanvas({ pdfDoc, pageNumber, scale }) {
  const canvasRef = useRef(null);
  const [pageError, setPageError] = useState(null);

  useEffect(() => {
    let active = true;
    let renderTask = null;

    async function renderPage() {
      if (!pdfDoc || !canvasRef.current) return;
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (!active || !canvasRef.current) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale });
        const outputViewport = page.getViewport({ scale: scale * dpr });

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        canvas.width = Math.floor(outputViewport.width);
        canvas.height = Math.floor(outputViewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTask = page.render({
          canvasContext: context,
          viewport: outputViewport
        });
        await renderTask.promise;
      } catch (err) {
        if (active && err?.name !== 'RenderingCancelledException') {
          setPageError(err?.message || 'Error al renderizar página');
        }
      }
    }

    renderPage();

    return () => {
      active = false;
      if (renderTask && typeof renderTask.cancel === 'function') {
        try { renderTask.cancel(); } catch (e) {}
      }
    };
  }, [pdfDoc, pageNumber, scale]);

  return (
    <div style={{
      background: '#FFFFFF',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
      borderRadius: '4px',
      overflow: 'hidden',
      marginBottom: '16px',
      position: 'relative',
      display: 'inline-block'
    }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {pageError && (
        <div style={{ padding: '16px', color: '#DE350B', fontSize: '12px' }}>
          No se pudo renderizar la página {pageNumber}: {pageError}
        </div>
      )}
      <div style={{
        position: 'absolute',
        bottom: '8px',
        right: '10px',
        background: 'rgba(9, 30, 66, 0.65)',
        color: '#FFFFFF',
        fontSize: '10px',
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: '10px',
        pointerEvents: 'none'
      }}>
        Pág. {pageNumber}
      </div>
    </div>
  );
}

/**
 * In-app PDF Document Viewer using Mozilla PDF.js on HTML5 Canvas.
 * Avoids browser iframe/embed download behavior inside Atlassian Forge sandboxed iframes.
 */
export function PdfDocumentPreview({ byteArray, blobUrl, filename }) {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    let active = true;
    let loadedDoc = null;

    async function loadPdf() {
      setLoading(true);
      setErrorMsg(null);
      try {
        let dataBytes = null;
        if (byteArray && byteArray.length > 0) {
          // Clone the Uint8Array so PDF.js does not detach the cached buffer
          dataBytes = new Uint8Array(byteArray);
        } else if (blobUrl) {
          const resp = await fetch(blobUrl);
          const ab = await resp.arrayBuffer();
          dataBytes = new Uint8Array(ab);
        }

        if (!dataBytes || dataBytes.length === 0) {
          throw new Error('El archivo PDF está vacío o no se pudo leer.');
        }

        // PDF.js v4 is ESM-only and no longer ships `pdf.worker.entry`. Exposing the worker
        // module as `globalThis.pdfjsWorker` keeps the previous behaviour: PDF parsing runs on
        // the main thread, so no separate Worker/blob URL is needed inside the Forge iframe.
        const [pdfjsModule, pdfjsWorkerModule] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs')
        ]);
        if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = pdfjsWorkerModule;
        const pdfjsLib = pdfjsModule.default || pdfjsModule;

        const loadingTask = pdfjsLib.getDocument({
          data: dataBytes,
          isEvalSupported: false
        });
        const doc = await loadingTask.promise;
        if (!active) {
          doc.destroy();
          return;
        }
        loadedDoc = doc;
        setPdfDoc(doc);
        setNumPages(doc.numPages || 0);
      } catch (err) {
        if (active) {
          setErrorMsg(err?.message || 'No fue posible previsualizar el documento PDF.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPdf();

    return () => {
      active = false;
      if (loadedDoc && typeof loadedDoc.destroy === 'function') {
        try { loadedDoc.destroy(); } catch (e) {}
      }
    };
  }, [byteArray, blobUrl]);

  return (
    <div style={{
      width: '100%',
      height: '78vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#2C333A',
      borderRadius: '8px',
      overflow: 'hidden',
      border: '1px solid rgba(255, 255, 255, 0.14)'
    }}>
      {/* PDF Viewer Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: '#1D2125',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#FFFFFF',
        fontSize: '12px',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 700, color: '#B3D4FF' }}>
            📄 {loading ? 'Cargando PDF...' : `${numPages} ${numPages === 1 ? 'página' : 'páginas'}`}
          </span>
          {filename && (
            <span style={{ color: '#9FADBC', maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              • {filename}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setScale(s => Math.max(0.6, +(s - 0.2).toFixed(2)))}
            style={{ background: 'rgba(255,255,255,0.1)', color: '#FFF', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}
            title="Alejar"
          >
            ➖
          </button>
          <button
            type="button"
            onClick={() => setScale(1.25)}
            style={{ background: 'rgba(255,255,255,0.08)', color: '#FFF', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontWeight: 600, fontSize: '11px', minWidth: '58px' }}
            title="Restablecer zoom"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setScale(s => Math.min(2.6, +(s + 0.2).toFixed(2)))}
            style={{ background: 'rgba(255,255,255,0.1)', color: '#FFF', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}
            title="Acercar"
          >
            ➕
          </button>
        </div>
      </div>

      {/* Scrollable Pages Area */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}>
        {loading && (
          <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', color: '#FFFFFF' }}>
            <div style={{ width: '32px', height: '32px', border: '3px solid rgba(255,255,255,0.2)', borderTop: '3px solid #388BFF', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '13px', fontWeight: 500 }}>Renderizando páginas del PDF...</span>
          </div>
        )}
        {!loading && errorMsg && (
          <div style={{ margin: 'auto', background: '#FFFFFF', color: '#172B4D', padding: '24px', borderRadius: '8px', maxWidth: '420px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>⚠️</div>
            <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px' }}>No se pudo mostrar la vista previa del PDF</div>
            <div style={{ fontSize: '12px', color: '#626F86', marginBottom: '16px' }}>{errorMsg}</div>
            {blobUrl && (
              <a
                href={blobUrl}
                download={filename || 'documento.pdf'}
                style={{ display: 'inline-block', background: '#0C66E4', color: '#FFFFFF', textDecoration: 'none', padding: '8px 16px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}
              >
                ⬇️ Descargar PDF
              </a>
            )}
          </div>
        )}
        {!loading && !errorMsg && pdfDoc && Array.from({ length: numPages }, (_, idx) => (
          <PdfPageCanvas
            key={idx + 1}
            pdfDoc={pdfDoc}
            pageNumber={idx + 1}
            scale={scale}
          />
        ))}
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

export function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmLabel = 'Confirmar', danger = false }) {
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

export function TextInputModal({ isOpen, title, label, defaultValue = '', placeholder = '', onConfirm, onCancel }) {
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

export const AtlaskitStatusLozenge = ({ status, style = {} }) => {
  const norm = normalizeUiStatus(status);
  let label = 'NOT RUN';
  let bg = '#F1F2F4';
  let color = '#44546F';
  let border = '#DCDFE4';

  if (norm === 'Passed') {
    label = 'PASSED';
    bg = '#DCFFF1';
    color = '#216E4E';
    border = '#A3FAD0';
  } else if (norm === 'Failed') {
    label = 'FAILED';
    bg = '#FFEBE6';
    color = '#BF2600';
    border = '#FFBDAD';
  } else if (norm === 'Blocked') {
    label = 'BLOCKED';
    bg = '#FFF0B3';
    color = '#172B4D';
    border = '#FFE380';
  } else if (norm === 'In Progress') {
    label = 'IN PROGRESS';
    bg = '#DEEBFF';
    color = '#0747A6';
    border = '#B2D4FF';
  } else {
    label = 'NOT RUN';
    bg = '#F1F2F4';
    color = '#44546F';
    border = '#DCDFE4';
  }

  return (
    <span
      className="status-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        color: color,
        border: `1px solid ${border}`,
        width: '110px',
        height: '28px',
        boxSizing: 'border-box',
        fontSize: '11px',
        fontWeight: 700,
        borderRadius: '4px',
        letterSpacing: '0.3px',
        textAlign: 'center',
        boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)',
        userSelect: 'none',
        flexShrink: 0,
        ...style
      }}
    >
      {label}
    </span>
  );
};

export const LIST_BATCH_SIZE = 100;

export function LoadMoreSentinel({ onVisible, remaining }) {
  const ref = useRef(null);
  const cbRef = useRef(onVisible);
  cbRef.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0] && entries[0].isIntersecting) cbRef.current && cbRef.current();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      onClick={() => cbRef.current && cbRef.current()}
      style={{ padding: '0.75rem', textAlign: 'center', fontSize: '12px', color: '#626F86', cursor: 'pointer' }}
    >
      Cargando más casos… ({remaining} restantes)
    </div>
  );
}


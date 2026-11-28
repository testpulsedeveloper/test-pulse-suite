/**
 * EvidenceViewer5.jsx — evidence viewer of Test Pulse 5.0 (v4.48.0).
 *
 * Replaces the classic dark preview modal when the 5.0 design is on. It shows:
 *  - a white header with the file type, name, where the file belongs (case or iteration)
 *    and its position ("2 de 5");
 *  - a neutral stage that fits the image / video / PDF to the window, with a 100 % zoom toggle
 *    for images (useful to read small text in a POS screenshot);
 *  - ‹ › buttons (and the ← → keys) to browse the other evidences of the same group, Esc to close;
 *  - the tester's note, when the evidence has one.
 *
 * It renders exactly the data that App.js `handlePreviewEvidence` already loads
 * (`previewModalData`): no extra Jira requests are made here.
 *
 * Props:
 *  - data:      the `previewModalData` object (filename, loading, error, blobUrl, base64, mimeType,
 *               isPdf, isVideo, note, downloadUrl, group: { items, index, label }).
 *  - onClose:   closes the viewer.
 *  - onNavigate(index): opens another evidence of `data.group.items`.
 *  - onDownload(url):  opens the Jira download URL (router.open in App.js).
 *  - PdfPreview: the shared PDF renderer component (PdfDocumentPreview).
 */
import React, { useEffect, useState } from 'react';

const kindOf = (d) => {
  const name = String(d.filename || '');
  if (d.isPdf || /\.pdf$/i.test(name)) return 'pdf';
  if (d.isVideo || /\.(mp4|mov|webm|avi|mkv)$/i.test(name)) return 'video';
  return 'image';
};
const KIND_LABEL = { pdf: 'PDF', video: 'Video', image: 'Imagen' };

export default function EvidenceViewer5({ data, onClose, onNavigate, onDownload, PdfPreview }) {
  const [zoomed, setZoomed] = useState(false);
  const group = data.group && Array.isArray(data.group.items) && data.group.items.length > 1 ? data.group : null;
  const idx = group ? data.group.index : 0;
  const hasPrev = !!group && idx > 0;
  const hasNext = !!group && idx < group.items.length - 1;
  const kind = kindOf(data);
  const src = data.blobUrl || (data.base64 ? `data:${data.mimeType || (kind === 'video' ? 'video/mp4' : 'image/png')};base64,${data.base64}` : '');

  // Back to "fit" whenever another file is shown.
  useEffect(() => { setZoomed(false); }, [data.id]);

  // Keyboard: Esc closes, ← / → browse the group.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onNavigate(idx - 1);
      else if (e.key === 'ArrowRight' && hasNext) onNavigate(idx + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasPrev, hasNext, idx, onClose, onNavigate]);

  return (
    <div className="tp5-evview" role="dialog" aria-modal="true" aria-label={`Evidencia ${data.filename || ''}`} onClick={onClose}>
      <div className="tp5-evview__box" onClick={(e) => e.stopPropagation()}>
        <header className="tp5-evview__head">
          <span className={`tp5-evview__kind tp5-evview__kind--${kind}`}>{KIND_LABEL[kind]}</span>
          <div className="tp5-evview__title">
            <strong className="tp5-ellipsis" title={data.filename}>{data.filename}</strong>
            <span className="tp5-subtle tp5-small">
              {[data.group?.label, group ? `${idx + 1} de ${group.items.length}` : null].filter(Boolean).join(' · ') || 'Evidencia'}
            </span>
          </div>
          <div className="tp5-evview__tools">
            {kind === 'image' && src && !data.loading && !data.error && (
              <button type="button" className="tp5-btn tp5-btn--secondary tp5-btn--sm" aria-pressed={zoomed} onClick={() => setZoomed(z => !z)}>
                {zoomed ? 'Ajustar a pantalla' : 'Tamaño real'}
              </button>
            )}
            {data.blobUrl && <a className="tp5-btn tp5-btn--secondary tp5-btn--sm" href={data.blobUrl} download={data.filename}>Descargar</a>}
            {!data.blobUrl && data.downloadUrl && <button type="button" className="tp5-btn tp5-btn--secondary tp5-btn--sm" onClick={() => onDownload(data.downloadUrl)}>Descargar</button>}
            <button type="button" className="tp5-iconbtn" aria-label="Cerrar visor" title="Cerrar (Esc)" onClick={onClose}>✕</button>
          </div>
        </header>

        <div className={`tp5-evview__stage${zoomed ? ' is-zoomed' : ''}`}>
          {hasPrev && <button type="button" className="tp5-evview__nav is-prev" aria-label="Evidencia anterior" onClick={() => onNavigate(idx - 1)}>‹</button>}
          {data.loading ? (
            <div className="tp5-evview__msg"><span className="tp5-evview__spin" aria-hidden="true" />Cargando evidencia…</div>
          ) : data.error ? (
            <div className="tp5-evview__msg">
              <p style={{ margin: 0 }}>{data.error}</p>
              {data.downloadUrl && <button type="button" className="tp5-btn tp5-btn--primary" onClick={() => onDownload(data.downloadUrl)}>Descargar el archivo</button>}
            </div>
          ) : kind === 'pdf' ? (
            <div className="tp5-evview__pdf"><PdfPreview byteArray={data.byteArray} blobUrl={data.blobUrl} filename={data.filename} /></div>
          ) : kind === 'video' ? (
            <video className="tp5-evview__media" controls autoPlay playsInline controlsList="nodownload" src={src} />
          ) : (
            <img className="tp5-evview__media" src={src} alt={data.filename || 'Evidencia'} onClick={() => setZoomed(z => !z)} />
          )}
          {hasNext && <button type="button" className="tp5-evview__nav is-next" aria-label="Evidencia siguiente" onClick={() => onNavigate(idx + 1)}>›</button>}
        </div>

        {data.note && (
          <footer className="tp5-evview__note"><strong>Nota del tester:</strong> {data.note}</footer>
        )}
        {group && (
          <footer className="tp5-evview__strip" aria-label="Otras evidencias">
            {group.items.map((it, i) => {
              const name = typeof it === 'object' && it ? (it.filename || it.name || `Evidencia ${i + 1}`) : `Evidencia ${i + 1}`;
              return (
                <button key={i} type="button" className={`tp5-evview__pill${i === idx ? ' is-on' : ''}`} aria-current={i === idx} title={name} onClick={() => i !== idx && onNavigate(i)}>
                  <span className="tp5-ellipsis">{name}</span>
                </button>
              );
            })}
          </footer>
        )}
      </div>
    </div>
  );
}

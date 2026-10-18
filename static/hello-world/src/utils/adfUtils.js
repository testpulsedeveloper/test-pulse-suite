import { invoke, requestJira } from '@forge/bridge';
import { formatAttachmentSize } from './constants';

/**
 * In-memory cache of resolved attachment blobs keyed by attachment ID.
 * Prevents redundant network calls when the same image appears both inline in
 * the ADF description/comments and in the attachment gallery below.
 */
const MAX_ATTACHMENT_BLOB_CACHE = 80;
const attachmentBlobCache = new Map();
const attachmentPendingMap = new Map();

/**
 * Stores a resolved blob entry in the bounded LRU cache and revokes the oldest
 * ObjectURL if the cache exceeds MAX_ATTACHMENT_BLOB_CACHE entries.
 */
function setCachedAttachmentBlob(key, entry) {
  if (attachmentBlobCache.has(key)) {
    attachmentBlobCache.delete(key);
  } else if (attachmentBlobCache.size >= MAX_ATTACHMENT_BLOB_CACHE) {
    const oldestKey = attachmentBlobCache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldest = attachmentBlobCache.get(oldestKey);
      attachmentBlobCache.delete(oldestKey);
      if (oldest && oldest.blobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(oldest.blobUrl);
        } catch (_e) {
          // Ignore revoke errors
        }
      }
    }
  }
  attachmentBlobCache.set(key, entry);
}

/**
 * Synchronously retrieves a previously cached blobUrl for an attachment ID, if available.
 */
export function getCachedAttachmentBlobUrl(attachmentId) {
  if (!attachmentId) return null;
  const key = String(attachmentId);
  const cached = attachmentBlobCache.get(key);
  if (cached) {
    // Refresh LRU order on access
    attachmentBlobCache.delete(key);
    attachmentBlobCache.set(key, cached);
    return cached.blobUrl;
  }
  return null;
}

/**
 * Downloads an attachment's binary content and returns { blobUrl, mimeType, byteArray }.
 * First attempts requestJira on the frontend; if blocked by Jira's 303 redirect to
 * api.media.atlassian.com (CSP restriction in Forge), automatically falls back to
 * the backend resolver `getAttachmentContent`.
 */
export async function fetchAttachmentBlobData(attachmentId, fallbackMimeType = 'application/octet-stream') {
  if (!attachmentId) return null;
  const key = String(attachmentId);

  if (attachmentBlobCache.has(key)) {
    const hit = attachmentBlobCache.get(key);
    attachmentBlobCache.delete(key);
    attachmentBlobCache.set(key, hit);
    return hit;
  }
  if (attachmentPendingMap.has(key)) {
    return attachmentPendingMap.get(key);
  }

  const loadPromise = (async () => {
    let byteArray = null;
    let resolvedMime = fallbackMimeType || 'application/octet-stream';

    // 1. Try direct frontend requestJira first
    try {
      const res = await requestJira(`/rest/api/3/attachment/content/${key}`);
      if (res && res.ok) {
        const contentType = res.headers && typeof res.headers.get === 'function'
          ? res.headers.get('content-type')
          : null;
        if (contentType && contentType !== 'application/octet-stream') {
          resolvedMime = contentType.split(';')[0].trim();
        }
        const ab = await res.arrayBuffer();
        if (ab && ab.byteLength > 0) {
          byteArray = new Uint8Array(ab);
        }
      }
    } catch (frontendErr) {
      // Expected in Forge Custom UI when Jira redirects (303) to api.media.atlassian.com
    }

    // 2. Fallback to backend resolver if frontend fetch failed or returned empty bytes
    if (!byteArray || byteArray.length === 0) {
      try {
        const b64Res = await invoke('getAttachmentContent', { attachmentId: key });
        if (b64Res && !b64Res.error && b64Res.base64) {
          if (b64Res.mimeType && b64Res.mimeType !== 'application/octet-stream') {
            resolvedMime = b64Res.mimeType.split(';')[0].trim();
          }
          const byteCharacters = atob(b64Res.base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          byteArray = new Uint8Array(byteNumbers);
        }
      } catch (backendErr) {
        // Ignore and return null below
      }
    }

    if (!byteArray || byteArray.length === 0) {
      return null;
    }

    // Detect PDF magic header (%PDF-) even if mimeType was generic octet-stream
    if (
      byteArray.length >= 4 &&
      byteArray[0] === 0x25 &&
      byteArray[1] === 0x50 &&
      byteArray[2] === 0x44 &&
      byteArray[3] === 0x46
    ) {
      resolvedMime = 'application/pdf';
    }

    const blob = new Blob([byteArray], { type: resolvedMime });
    const blobUrl = URL.createObjectURL(blob);
    const result = { blobUrl, mimeType: resolvedMime, byteArray };
    setCachedAttachmentBlob(key, result);
    return result;
  })();

  attachmentPendingMap.set(key, loadPromise);
  try {
    return await loadPromise;
  } finally {
    attachmentPendingMap.delete(key);
  }
}

export function textToAdf(text) {
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

export function sanitizeRenderedHtml(html, attachments = [], attachmentUrls = {}) {
  if (!html) return '';
  const attList = Array.isArray(attachments) ? attachments : [];
  let cleaned = String(html)
    .replace(/URL validation failed/gi, '')
    .replace(/<span[^>]*class="[^"]*inline-card-resolving[^"]*"[^>]*>.*?<\/span>/gi, '')
    .replace(/<div[^>]*class="[^"]*media-card-error[^"]*"[^>]*>.*?<\/div>/gi, '')
    .replace(/<p>\s*(&nbsp;|\s)*<\/p>/gi, '');

  // Rewrite Jira relative attachment URLs inside rendered HTML <img> tags to resolved blob URLs
  cleaned = cleaned.replace(/<img\b([^>]*)>/gi, (fullMatch, attrsStr) => {
    const idFromSrcMatch = attrsStr.match(/(?:\/rest\/api\/[23]\/attachment\/(?:content|thumbnail)\/|\/secure\/attachment\/)(\d+)/i);
    const altMatch = attrsStr.match(/\balt=["']([^"']+)["']/i) || attrsStr.match(/\bdata-attachment-name=["']([^"']+)["']/i);
    const rawId = idFromSrcMatch ? idFromSrcMatch[1] : null;
    const rawAlt = altMatch ? altMatch[1] : '';

    const matchedAtt = attList.find(a =>
      (rawId && String(a.id) === String(rawId)) ||
      (rawAlt && (a.filename === rawAlt || a.filename?.toLowerCase() === rawAlt.toLowerCase()))
    );

    const targetId = matchedAtt ? String(matchedAtt.id) : rawId;
    const targetName = matchedAtt ? matchedAtt.filename : (rawAlt || 'imagen.png');
    const resolvedUrl = targetId ? (attachmentUrls[targetId] || getCachedAttachmentBlobUrl(targetId)) : null;

    if (resolvedUrl) {
      const safeId = String(targetId).replace(/"/g, '&quot;');
      const safeName = String(targetName).replace(/"/g, '&quot;');
      return `<span class="adf-inline-image-card" data-preview-attachment-id="${safeId}" data-preview-attachment-name="${safeName}" title="Clic para ampliar ${safeName}"><img class="adf-inline-image" src="${resolvedUrl}" alt="${safeName}" /></span>`;
    }
    return fullMatch;
  });

  // Rewrite Test Pulse comment attachment tokens `📎 [Evidencia adjunta: filename (#12345)]` into rich inline preview cards
  cleaned = cleaned.replace(/(?:📎\s*)?\[Evidencia adjunta:\s*([^\]]+?)\s*\(#(\d+)\)\]/gi, (fullMatch, rawName, rawId) => {
    const matchedAtt = attList.find(a => String(a.id) === String(rawId) || a.filename === rawName.trim());
    const targetId = matchedAtt ? String(matchedAtt.id) : String(rawId);
    const targetName = matchedAtt ? matchedAtt.filename : rawName.trim();
    const safeId = targetId.replace(/"/g, '&quot;');
    const safeName = targetName.replace(/"/g, '&quot;');
    const isImg = matchedAtt ? matchedAtt.isImage : /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(targetName);
    const resolvedUrl = attachmentUrls[targetId] || getCachedAttachmentBlobUrl(targetId);

    if (isImg && resolvedUrl) {
      return `<div class="adf-inline-image-card" data-preview-attachment-id="${safeId}" data-preview-attachment-name="${safeName}" title="Clic para ver ${safeName} en pantalla completa" style="margin-top:6px;max-width:340px;cursor:pointer;"><img class="adf-inline-image" src="${resolvedUrl}" alt="${safeName}" style="max-height:220px;object-fit:contain;border-radius:6px;border:1px solid #DCDFE4;" /><div class="adf-inline-image-footer" style="font-size:11px;color:#0C66E4;margin-top:3px;">📷 ${safeName} • Clic para ampliar 🔍</div></div>`;
    }
    return `<span class="adf-inline-file-card" data-preview-attachment-id="${safeId}" data-preview-attachment-name="${safeName}" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:#E9F2FF;border:1px solid #85B8FF;border-radius:6px;color:#0C66E4;font-size:11.5px;font-weight:700;cursor:pointer;margin-top:4px;" title="Clic para previsualizar ${safeName}">📎 ${safeName} (Ver evidencia)</span>`;
  });

  return cleaned.trim();
}

export function adfToHtml(adf, attachments = [], attachmentUrls = {}) {
  if (!adf) return '';
  if (typeof adf === 'string') {
    const trimmed = adf.trim();
    const looksLikeHtml = (trimmed.startsWith('<') && trimmed.endsWith('>')) ||
      /<\/?(p|br|h[1-6]|div|span|ul|ol|li|strong|b|em|i|a|table|tr|td|th|pre|code|blockquote|img)\b[^>]*>/i.test(trimmed);
    if (looksLikeHtml) {
      return sanitizeRenderedHtml(adf, attachments, attachmentUrls);
    }
    return sanitizeRenderedHtml(
      adf
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>'),
      attachments,
      attachmentUrls
    );
  }
  if (typeof adf !== 'object') return sanitizeRenderedHtml(String(adf), attachments, attachmentUrls);

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
        return `<p>${content || '&nbsp;'}</p>`;
      case 'heading': {
        const level = node.attrs?.level || 3;
        return `<h${level}>${content}</h${level}>`;
      }
      case 'bulletList':
        return `<ul>${content}</ul>`;
      case 'orderedList':
        return `<ol>${content}</ol>`;
      case 'listItem':
        return `<li>${content}</li>`;
      case 'table':
        return `<table border="1">${content}</table>`;
      case 'tableRow':
        return `<tr>${content}</tr>`;
      case 'tableHeader':
        return `<th>${content}</th>`;
      case 'tableCell':
        return `<td>${content}</td>`;
      case 'text': {
        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        let text = esc(node.text || '');
        if (text.includes('URL validation failed')) text = '';
        if (node.marks && Array.isArray(node.marks)) {
          for (const mark of node.marks) {
            if (mark.type === 'strong') text = `<strong>${text}</strong>`;
            else if (mark.type === 'em') text = `<em>${text}</em>`;
            else if (mark.type === 'code') text = `<code>${text}</code>`;
            else if (mark.type === 'strike') text = `<del>${text}</del>`;
            else if (mark.type === 'underline') text = `<u>${text}</u>`;
            else if (mark.type === 'link') {
              const rawHref = String(mark.attrs?.href || '#');
              const safeHref = /^(https?:|mailto:|\/|#)/i.test(rawHref) ? esc(rawHref) : '#';
              text = `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${text}</a>`;
            }
            else if (mark.type === 'textColor') text = `<span>${text}</span>`;
          }
        }
        return text;
      }
      case 'hardBreak':
        return '<br/>';
      case 'codeBlock': {
        const escCode = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<pre><code>${content || escCode(node.text || '')}</code></pre>`;
      }
      case 'blockquote':
        return `<blockquote>${content}</blockquote>`;
      case 'rule':
        return '<hr />';
      case 'mention': {
        const escMention = String(node.attrs?.text || 'user').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<span class="adf-mention">@${escMention}</span>`;
      }
      case 'emoji':
        return String(node.attrs?.text || node.attrs?.shortName || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      case 'mediaSingle': {
        return `<div class="adf-media-single">${content}</div>`;
      }
      case 'mediaGroup': {
        return `<div class="adf-media-group">${content}</div>`;
      }
      case 'media': {
        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const mediaId = node.attrs?.id;
        const mediaAlt = node.attrs?.alt || node.attrs?.__fileName || '';
        const safeMediaAlt = esc(mediaAlt);
        const attList = Array.isArray(attachments) ? attachments : [];
        let matchedAtt = attList.find(a =>
          (mediaId && String(a.id) === String(mediaId)) ||
          (mediaAlt && (
            a.filename === mediaAlt ||
            String(a.id) === String(mediaAlt) ||
            (a.filename && a.filename.toLowerCase() === String(mediaAlt).toLowerCase())
          ))
        );
        // Fallback: if there is only 1 image attachment on the issue and the media node has no alt matching, pair it
        if (!matchedAtt && !mediaAlt && attList.filter(a => a.isImage).length === 1) {
          matchedAtt = attList.find(a => a.isImage);
        }

        if (matchedAtt) {
          const safeFilename = esc(matchedAtt.filename);
          const safeId = esc(matchedAtt.id);
          const resolvedBlobUrl = (attachmentUrls && attachmentUrls[String(matchedAtt.id)]) || getCachedAttachmentBlobUrl(matchedAtt.id);

          if (matchedAtt.isVideo) {
            return `<div class="adf-inline-video-card" data-preview-attachment-id="${safeId}" data-preview-attachment-name="${safeFilename}">
              <div class="adf-inline-video-header">
                <div class="adf-inline-video-title">
                  <span>🎥</span> <span>${safeFilename}</span>
                </div>
                <span class="adf-inline-video-size">${formatAttachmentSize(matchedAtt.size)}</span>
              </div>
              <div class="adf-inline-video-actions">
                <button type="button" class="adf-inline-action-btn" data-preview-attachment-id="${safeId}" data-preview-attachment-name="${safeFilename}">
                  ▶ Reproducir Video
                </button>
              </div>
            </div>`;
          } else if (matchedAtt.isImage) {
            if (resolvedBlobUrl) {
              return `<div class="adf-inline-image-card" data-preview-attachment-id="${safeId}" data-preview-attachment-name="${safeFilename}" title="Clic para ver ${safeFilename} en pantalla completa">
                <img class="adf-inline-image" src="${resolvedBlobUrl}" alt="${safeFilename}" />
                <div class="adf-inline-image-footer">
                  <span class="adf-inline-image-name" title="${safeFilename}">📷 ${safeFilename}</span>
                  <span class="adf-inline-image-meta">${formatAttachmentSize(matchedAtt.size)} • Clic para ampliar 🔍</span>
                </div>
              </div>`;
            }
            return `<div class="adf-inline-file-card" data-preview-attachment-id="${safeId}" data-preview-attachment-name="${safeFilename}">
              <div class="adf-inline-file-info">
                <div class="adf-inline-file-icon">📷</div>
                <div class="adf-inline-file-text">
                  <div class="adf-inline-file-title" title="${safeFilename}">${safeFilename}</div>
                  <div class="adf-inline-file-sub">${formatAttachmentSize(matchedAtt.size)} • Imagen adjunta</div>
                </div>
              </div>
              <button type="button" class="adf-inline-action-btn" data-preview-attachment-id="${safeId}" data-preview-attachment-name="${safeFilename}">
                🔍 Ver Imagen
              </button>
            </div>`;
          } else {
            return `<div class="adf-inline-file-card" data-preview-attachment-id="${safeId}" data-preview-attachment-name="${safeFilename}">
              <div class="adf-inline-file-info">
                <div class="adf-inline-file-icon">📄</div>
                <div class="adf-inline-file-text">
                  <div class="adf-inline-file-title" title="${safeFilename}">${safeFilename}</div>
                  <div class="adf-inline-file-sub">${formatAttachmentSize(matchedAtt.size)} • Documento adjunto</div>
                </div>
              </div>
              <button type="button" class="adf-inline-action-btn" data-preview-attachment-id="${safeId}" data-preview-attachment-name="${safeFilename}">
                👁️ Previsualizar
              </button>
            </div>`;
          }
        }

        if (mediaAlt && mediaAlt.match(/\.(mp4|mov|webm|avi|mkv)$/i)) {
          return `<div class="adf-inline-badge"><span>🎥 Video: ${safeMediaAlt}</span></div>`;
        }
        if (mediaAlt && mediaAlt.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) {
          return `<div class="adf-inline-badge"><span>📷 ${safeMediaAlt}</span></div>`;
        }
        if (mediaAlt) {
          return `<span class="adf-inline-badge">📎 ${safeMediaAlt}</span>`;
        }
        return '';
      }
      case 'inlineCard':
      case 'blockCard':
      case 'embedCard': {
        const cardUrl = String(node.attrs?.url || '');
        if (!cardUrl || cardUrl.includes('URL validation failed') || !/^(https?:|mailto:|\/)/i.test(cardUrl)) return '';
        const safeUrl = cardUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="adf-inline-link-card">🔗 ${safeUrl}</a>`;
      }
      case 'panel': {
        const pType = String(node.attrs?.panelType || 'info').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let pIcon = 'ℹ️';
        if (pType === 'warning' || pType === 'note') pIcon = '⚠️';
        else if (pType === 'error') pIcon = '🚨';
        else if (pType === 'success') pIcon = '✅';
        return `<div class="adf-panel adf-panel-${pType}">
          <div class="adf-panel-title">${pIcon} ${pType.toUpperCase()}</div>
          ${content}
        </div>`;
      }
      case 'expand':
      case 'nestedExpand': {
        const title = String(node.attrs?.title || 'Detalles').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<details class="adf-expand">
          <summary>${title}</summary>
          <div>${content}</div>
        </details>`;
      }
      case 'status': {
        const sText = String(node.attrs?.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<span class="adf-status-lozenge">${sText}</span>`;
      }
      case 'date': {
        const ts = node.attrs?.timestamp ? parseInt(node.attrs.timestamp, 10) : null;
        const dStr = ts ? new Date(ts).toLocaleDateString('es-MX') : '';
        return `<span class="adf-date-lozenge">📅 ${dStr}</span>`;
      }
      default:
        return content || (node.text ? node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '');
    }
  }

  return sanitizeRenderedHtml(renderNode(adf), attachments, attachmentUrls);
}


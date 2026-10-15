import { formatAttachmentSize } from './constants';

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

export function sanitizeRenderedHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/URL validation failed/gi, '')
    .replace(/<span[^>]*class="[^"]*inline-card-resolving[^"]*"[^>]*>.*?<\/span>/gi, '')
    .replace(/<div[^>]*class="[^"]*media-card-error[^"]*"[^>]*>.*?<\/div>/gi, '')
    .replace(/<p>\s*(&nbsp;|\s)*<\/p>/gi, '')
    .trim();
}

export function adfToHtml(adf, attachments = []) {
  if (!adf) return '';
  if (typeof adf === 'string') {
    const trimmed = adf.trim();
    const looksLikeHtml = (trimmed.startsWith('<') && trimmed.endsWith('>')) ||
      /<\/?(p|br|h[1-6]|div|span|ul|ol|li|strong|b|em|i|a|table|tr|td|th|pre|code|blockquote)\b[^>]*>/i.test(trimmed);
    if (looksLikeHtml) {
      return sanitizeRenderedHtml(adf);
    }
    return sanitizeRenderedHtml(
      adf
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>')
    );
  }
  if (typeof adf !== 'object') return sanitizeRenderedHtml(String(adf));

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
        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        let text = esc(node.text || '');
        if (text.includes('URL validation failed')) text = '';
        if (node.marks && Array.isArray(node.marks)) {
          for (const mark of node.marks) {
            if (mark.type === 'strong') text = `<strong>${text}</strong>`;
            else if (mark.type === 'em') text = `<em>${text}</em>`;
            else if (mark.type === 'code') text = `<code style="background: rgba(9,30,66,0.08); padding: 2px 4px; border-radius: 3px; font-family: monospace;">${text}</code>`;
            else if (mark.type === 'strike') text = `<del>${text}</del>`;
            else if (mark.type === 'underline') text = `<u>${text}</u>`;
            else if (mark.type === 'link') {
              const rawHref = String(mark.attrs?.href || '#');
              const safeHref = /^(https?:|mailto:|\/|#)/i.test(rawHref) ? esc(rawHref) : '#';
              text = `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${text}</a>`;
            }
            else if (mark.type === 'textColor') text = `<span style="color: ${esc(mark.attrs?.color || 'inherit')}">${text}</span>`;
          }
        }
        return text;
      }
      case 'hardBreak':
        return '<br/>';
      case 'codeBlock': {
        const escCode = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<pre style="background: var(--bg-surface-hover, #f4f5f7); padding: 0.8rem; border-radius: 4px; overflow-x: auto; font-family: monospace;"><code>${content || escCode(node.text || '')}</code></pre>`;
      }
      case 'blockquote':
        return `<blockquote style="border-left: 3px solid var(--ds-border, #dfe1e6); margin: 0.5rem 0; padding-left: 0.8rem; color: var(--text-secondary, #6b778c);">${content}</blockquote>`;
      case 'rule':
        return '<hr style="border: none; border-top: 1px solid var(--ds-border, #dfe1e6); margin: 0.8rem 0;" />';
      case 'mention': {
        const escMention = String(node.attrs?.text || 'user').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<span style="background: rgba(9,30,66,0.08); padding: 1px 4px; border-radius: 3px; font-weight: 500;">@${escMention}</span>`;
      }
      case 'emoji':
        return String(node.attrs?.text || node.attrs?.shortName || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      case 'mediaSingle': {
        const layout = node.attrs?.layout || 'center';
        return `<div class="adf-media-single" style="margin: 0.8rem 0; text-align: ${layout === 'center' ? 'center' : 'left'};">${content}</div>`;
      }
      case 'mediaGroup': {
        return `<div class="adf-media-group" style="display: flex; flex-wrap: wrap; gap: 8px; margin: 0.8rem 0;">${content}</div>`;
      }
      case 'media': {
        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const mediaId = node.attrs?.id;
        const mediaAlt = node.attrs?.alt || '';
        const safeMediaAlt = esc(mediaAlt);
        const attList = Array.isArray(attachments) ? attachments : [];
        const matchedAtt = attList.find(a =>
          (mediaId && String(a.id) === String(mediaId)) ||
          (mediaAlt && (a.filename === mediaAlt || String(a.id) === String(mediaAlt)))
        );

        if (matchedAtt) {
          const safeFilename = esc(matchedAtt.filename);
          const safeId = esc(matchedAtt.id);
          if (matchedAtt.isVideo) {
            return `<div style="margin: 8px 0; display: inline-flex; flex-direction: column; border: 1px solid #DCDFE4; border-radius: 8px; overflow: hidden; background: #FFFFFF; max-width: 420px; box-shadow: 0 1px 3px rgba(9,30,66,0.08); text-align: left;">
              <div style="background: #091E42; color: #FFF; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <span>🎥</span> <span>${safeFilename}</span>
                </div>
                <span style="font-size: 10px; color: #B3D4FF; flex-shrink: 0;">${formatAttachmentSize(matchedAtt.size)}</span>
              </div>
              <div style="padding: 8px 12px; display: flex; justify-content: flex-end; background: #F8FAFD;">
                <button onclick="window.__previewAttachment &amp;&amp; window.__previewAttachment('${safeId}', decodeURIComponent('${encodeURIComponent(matchedAtt.filename)}'))" style="background: #0C66E4; color: #FFF; border: none; border-radius: 4px; padding: 6px 12px; font-size: 11px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
                  ▶ Reproducir Video
                </button>
              </div>
            </div>`;
          } else if (matchedAtt.isImage) {
            return `<div style="margin: 6px 0; display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 14px; border: 1px solid #DCDFE4; border-radius: 8px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(9,30,66,0.06); max-width: 460px; cursor: pointer; text-align: left;" onclick="window.__previewAttachment &amp;&amp; window.__previewAttachment('${safeId}', decodeURIComponent('${encodeURIComponent(matchedAtt.filename)}'))">
              <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                <div style="width: 32px; height: 32px; border-radius: 6px; background: #E9F2FF; color: #0C66E4; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;">📷</div>
                <div style="overflow: hidden;">
                  <div style="font-weight: 600; font-size: 12px; color: #172B4D; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${safeFilename}">${safeFilename}</div>
                  <div style="font-size: 10px; color: #626F86; margin-top: 1px;">${formatAttachmentSize(matchedAtt.size)} • Imagen adjunta</div>
                </div>
              </div>
              <button style="background: #0C66E4; color: #FFF; border: none; border-radius: 4px; padding: 5px 10px; font-size: 11px; font-weight: 700; cursor: pointer; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;">
                🔍 Ver Imagen
              </button>
            </div>`;
          } else {
            return `<div style="margin: 6px 0; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; background: #F4F5F7; border: 1px solid #DCDFE4; border-radius: 6px; cursor: pointer; text-align: left;" onclick="window.__previewAttachment &amp;&amp; window.__previewAttachment('${safeId}', decodeURIComponent('${encodeURIComponent(matchedAtt.filename)}'))">
              <span style="font-size: 14px;">📄</span>
              <span style="font-size: 12px; font-weight: 600; color: #0C66E4; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${safeFilename}</span>
              <span style="color: #626F86; font-size: 10px;">(${formatAttachmentSize(matchedAtt.size)})</span>
            </div>`;
          }
        }

        if (mediaAlt && mediaAlt.match(/\.(mp4|mov|webm|avi|mkv)$/i)) {
          return `<div style="margin: 6px 0; display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: #091E42; color: #FFF; border-radius: 6px; font-size: 12px; font-weight: 600;">
            <span>🎥 Video: ${safeMediaAlt}</span>
          </div>`;
        }
        if (mediaAlt && mediaAlt.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) {
          return `<div style="margin: 6px 0; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; background: #F4F5F7; border: 1px solid #DCDFE4; border-radius: 6px; font-size: 12px; font-weight: 500; color: #172B4D;">
            <span>📷 ${safeMediaAlt}</span>
          </div>`;
        }
        if (mediaAlt) {
          return `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background: #F4F5F7; border: 1px solid #DCDFE4; border-radius: 4px; font-size: 11px;">📎 ${safeMediaAlt}</span>`;
        }
        return '';
      }
      case 'inlineCard':
      case 'blockCard':
      case 'embedCard': {
        const cardUrl = String(node.attrs?.url || '');
        if (!cardUrl || cardUrl.includes('URL validation failed') || !/^(https?:|mailto:|\/)/i.test(cardUrl)) return '';
        const safeUrl = cardUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; background: #F4F5F7; border: 1px solid #DCDFE4; border-radius: 4px; color: #0C66E4; text-decoration: none; font-size: 12px; font-weight: 500; margin: 2px 0;">
          🔗 ${safeUrl}
        </a>`;
      }
      case 'panel': {
        const pType = String(node.attrs?.panelType || 'info').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let pBg = '#E9F2FF';
        let pBorder = '#0C66E4';
        let pIcon = 'ℹ️';
        if (pType === 'warning' || pType === 'note') {
          pBg = '#FFF7D6';
          pBorder = '#F5CD47';
          pIcon = '⚠️';
        } else if (pType === 'error') {
          pBg = '#FFEBE6';
          pBorder = '#DE350B';
          pIcon = '🚨';
        } else if (pType === 'success') {
          pBg = '#E3FCEF';
          pBorder = '#36B37E';
          pIcon = '✅';
        }
        return `<div style="margin: 0.6rem 0; padding: 0.75rem 1rem; border-radius: 6px; border-left: 4px solid ${pBorder}; background: ${pBg}; color: #172B4D; font-size: 12.5px;">
          <div style="font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">${pIcon} ${pType.toUpperCase()}</div>
          ${content}
        </div>`;
      }
      case 'expand':
      case 'nestedExpand': {
        const title = String(node.attrs?.title || 'Detalles').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<details style="margin: 0.5rem 0; padding: 0.5rem 0.75rem; background: #FAFBFC; border: 1px solid #DCDFE4; border-radius: 6px;">
          <summary style="font-weight: 600; cursor: pointer; color: #172B4D;">${title}</summary>
          <div style="margin-top: 0.5rem;">${content}</div>
        </details>`;
      }
      case 'status': {
        const sText = String(node.attrs?.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<span style="background: #E9F2FF; color: #0C66E4; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 700; text-transform: uppercase;">${sText}</span>`;
      }
      case 'date': {
        const ts = node.attrs?.timestamp ? parseInt(node.attrs.timestamp, 10) : null;
        const dStr = ts ? new Date(ts).toLocaleDateString('es-MX') : '';
        return `<span style="background: #EBECF0; padding: 2px 6px; border-radius: 3px; font-size: 11px; color: #172B4D; font-weight: 500;">📅 ${dStr}</span>`;
      }
      default:
        return content || (node.text ? node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '');
    }
  }

  return sanitizeRenderedHtml(renderNode(adf));
}

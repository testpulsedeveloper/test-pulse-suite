import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { invoke as forgeInvoke, view, router, requestJira } from '@forge/bridge';
import { CreateIssueModal } from '@forge/jira-bridge';
import Lozenge from '@atlaskit/lozenge';
import Badge from '@atlaskit/badge';
import Button from '@atlaskit/button';
import Spinner from '@atlaskit/spinner';
import './index.css';
import TestPulseLoader from './components/TestPulseLoader';
import { LIVERPOOL_LOGO_WHITE_ANIMATED_B64, LIVERPOOL_LOGO_WHITE_B64, LIVERPOOL_LOGO_PINK_B64 } from './assets/liverpool-logo-b64';
import packageJson from '../package.json';
import { generateQrSvg, generateQrDataUrl } from './utils/qrCodeGenerator';

const APP_VERSION = `v${packageJson.version || '3.11.0'}`;

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'iter_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
};

export const normalizeUiStatus = (status) => {
  if (!status) return 'Not Run';
  const s = String(status).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if ([
    'passed', 'pass', 'listo', 'done', 'aprobado', 'aprobada', 'exito', 'exitoso', 'exitosa',
    'finalizado', 'finalizada', 'completado', 'completada', 'terminado', 'terminada',
    'resuelto', 'resuelta', 'resolved', 'closed', 'cerrado', 'cerrada', 'ok',
    'satisfactorio', 'satisfactoria', 'superado', 'superada', 'conforme', 'validated',
    'validado', 'validada', 'accepted', 'aceptado', 'aceptada', 'success', 'successful'
  ].includes(s)) return 'Passed';
  if ([
    'failed', 'fail', 'fallido', 'fallida', 'fallo', 'rechazado', 'rechazada',
    'error', 'defectuoso', 'defectuosa', 'no superado', 'no superada', 'no conforme',
    'no paso', 'rejected', 'failing', 'bug', 'descartado', 'descartada'
  ].includes(s)) return 'Failed';
  if ([
    'blocked', 'block', 'bloqueado', 'bloqueada', 'bloqueo', 'impedido', 'impedida',
    'detenido', 'detenida', 'pausado', 'pausada', 'on hold', 'hold', 'detener', 'bloq'
  ].includes(s)) return 'Blocked';
  if ([
    'in progress', 'en curso', 'en progreso', 'running', 'en desarrollo', 'en pruebas',
    'en ejecucion', 'en revision', 'testing', 'qa', 'in review', 'ejecutando',
    'en proceso', 'work in progress', 'wip'
  ].includes(s)) return 'In Progress';
  return 'Not Run';
};

const DEFAULT_DASHBOARD_WIDGETS = [
  { id: 'w_kpi_scorecard', type: 'kpi_scorecard', title: 'Métricas Clave (Bento Grid)', width: 'full', visible: true },
  { id: 'w_general_status', type: 'general_status', title: 'Estado General de Pruebas', width: 'half', visible: true },
  { id: 'w_manual_vs_auto', type: 'manual_vs_auto', title: 'Ejecución: Manual vs Auto', width: 'half', visible: true },
  { id: 'w_tester_stats', type: 'tester_stats', title: 'Estado por QA Tester', width: 'half', visible: true },
  { id: 'w_module_stats', type: 'module_stats', title: 'Estado por Módulo / Funcionalidad', width: 'half', visible: true },
  { id: 'w_cycles_progress', type: 'cycles_progress', title: 'Progreso por Ciclo de Pruebas', width: 'full', visible: true },
];

const AVAILABLE_WIDGET_CATALOG = [
  {
    type: 'kpi_scorecard',
    title: 'Métricas Clave (Bento Grid)',
    category: 'Métricas',
    categoryColor: '#0C66E4',
    icon: '📊',
    defaultWidth: 'full',
    description: 'Scorecard con 5 tarjetas ejecutivas: Total de Casos, Tasa de Éxito, Defectos Abiertos, MTTR y Cobertura.'
  },
  {
    type: 'general_status',
    title: 'Estado General de Pruebas',
    category: 'Calidad',
    categoryColor: '#36B37E',
    icon: '🍩',
    defaultWidth: 'half',
    description: 'Gráfico Donut interactivo con desglose de casos Pasados, Fallados, Bloqueados y Sin Ejecutar.'
  },
  {
    type: 'manual_vs_auto',
    title: 'Ejecución: Manual vs Auto',
    category: 'Automatización',
    categoryColor: '#6554C0',
    icon: '⚡',
    defaultWidth: 'half',
    description: 'Comparativa de volumen, tasas de aprobación y velocidad entre pruebas automatizadas y manuales.'
  },
  {
    type: 'tester_stats',
    title: 'Estado por QA Tester',
    category: 'Equipo',
    categoryColor: '#FFAB00',
    icon: '👥',
    defaultWidth: 'half',
    description: 'Productividad, balance de carga y desglose de avance por cada tester asignado con avatares.'
  },
  {
    type: 'module_stats',
    title: 'Estado por Módulo / Funcionalidad',
    category: 'Calidad',
    categoryColor: '#36B37E',
    icon: '🧱',
    defaultWidth: 'half',
    description: 'Cobertura funcional agrupada por carpetas/módulos con semáforo de nivel de riesgo (Alto, Medio, Estable).'
  },
  {
    type: 'cycles_progress',
    title: 'Progreso por Ciclo de Pruebas',
    category: 'Métricas',
    categoryColor: '#0C66E4',
    icon: '🔄',
    defaultWidth: 'full',
    description: 'Barras apiladas de avance individual para cada Ciclo de Pruebas activo en el proyecto.'
  },
  {
    type: 'severity_breakdown',
    title: 'Distribución de Defectos por Severidad',
    category: 'Defectos',
    categoryColor: '#DE350B',
    icon: '🐞',
    defaultWidth: 'half',
    description: 'Conteo y proporciones de bugs clasificados en Bloqueante, Crítico, Mayor, Menor y Sin Definir.'
  },
  {
    type: 'automation_health',
    title: 'Salud de Automatización & CI/CD',
    category: 'Automatización',
    categoryColor: '#6554C0',
    icon: '🚀',
    defaultWidth: 'half',
    description: 'Métricas de madurez de automatización, ratio de automatización y preparación de la suite para CI/CD.'
  }
];

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

function formatAttachmentSize(bytes) {
  if (!bytes || isNaN(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function sanitizeRenderedHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/URL validation failed/gi, '')
    .replace(/<span[^>]*class="[^"]*inline-card-resolving[^"]*"[^>]*>.*?<\/span>/gi, '')
    .replace(/<div[^>]*class="[^"]*media-card-error[^"]*"[^>]*>.*?<\/div>/gi, '')
    .replace(/<p>\s*(&nbsp;|\s)*<\/p>/gi, '')
    .trim();
}

function adfToHtml(adf, attachments = []) {
  if (!adf) return '';
  if (typeof adf === 'string') {
    if (adf.trim().startsWith('<') && adf.trim().endsWith('>')) {
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
        let text = (node.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (text.includes('URL validation failed')) text = '';
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
      case 'emoji':
        return node.attrs?.text || node.attrs?.shortName || '';
      case 'mediaSingle': {
        const layout = node.attrs?.layout || 'center';
        return `<div class="adf-media-single" style="margin: 0.8rem 0; text-align: ${layout === 'center' ? 'center' : 'left'};">${content}</div>`;
      }
      case 'mediaGroup': {
        return `<div class="adf-media-group" style="display: flex; flex-wrap: wrap; gap: 8px; margin: 0.8rem 0;">${content}</div>`;
      }
      case 'media': {
        const mediaId = node.attrs?.id;
        const mediaAlt = node.attrs?.alt || '';
        const attList = Array.isArray(attachments) ? attachments : [];
        const matchedAtt = attList.find(a => 
          (mediaId && String(a.id) === String(mediaId)) || 
          (mediaAlt && (a.filename === mediaAlt || String(a.id) === String(mediaAlt)))
        );

        if (matchedAtt) {
          if (matchedAtt.isVideo) {
            return `<div style="margin: 8px 0; display: inline-flex; flex-direction: column; border: 1px solid #DCDFE4; border-radius: 8px; overflow: hidden; background: #FFFFFF; max-width: 420px; box-shadow: 0 1px 3px rgba(9,30,66,0.08); text-align: left;">
              <div style="background: #091E42; color: #FFF; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <span>🎥</span> <span>${matchedAtt.filename}</span>
                </div>
                <span style="font-size: 10px; color: #B3D4FF; flex-shrink: 0;">${formatAttachmentSize(matchedAtt.size)}</span>
              </div>
              <div style="padding: 8px 12px; display: flex; justify-content: flex-end; background: #F8FAFD;">
                <button onclick="window.__previewAttachment &amp;&amp; window.__previewAttachment('${matchedAtt.id}', decodeURIComponent('${encodeURIComponent(matchedAtt.filename)}'))" style="background: #0C66E4; color: #FFF; border: none; border-radius: 4px; padding: 6px 12px; font-size: 11px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
                  ▶ Reproducir Video
                </button>
              </div>
            </div>`;
          } else if (matchedAtt.isImage) {
            return `<div style="margin: 6px 0; display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 14px; border: 1px solid #DCDFE4; border-radius: 8px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(9,30,66,0.06); max-width: 460px; cursor: pointer; text-align: left;" onclick="window.__previewAttachment &amp;&amp; window.__previewAttachment('${matchedAtt.id}', decodeURIComponent('${encodeURIComponent(matchedAtt.filename)}'))">
              <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                <div style="width: 32px; height: 32px; border-radius: 6px; background: #E9F2FF; color: #0C66E4; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;">📷</div>
                <div style="overflow: hidden;">
                  <div style="font-weight: 600; font-size: 12px; color: #172B4D; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${matchedAtt.filename}">${matchedAtt.filename}</div>
                  <div style="font-size: 10px; color: #626F86; margin-top: 1px;">${formatAttachmentSize(matchedAtt.size)} • Imagen adjunta</div>
                </div>
              </div>
              <button style="background: #0C66E4; color: #FFF; border: none; border-radius: 4px; padding: 5px 10px; font-size: 11px; font-weight: 700; cursor: pointer; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;">
                🔍 Ver Imagen
              </button>
            </div>`;
          } else {
            return `<div style="margin: 6px 0; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; background: #F4F5F7; border: 1px solid #DCDFE4; border-radius: 6px; cursor: pointer; text-align: left;" onclick="window.__previewAttachment &amp;&amp; window.__previewAttachment('${matchedAtt.id}', decodeURIComponent('${encodeURIComponent(matchedAtt.filename)}'))">
              <span style="font-size: 14px;">📄</span>
              <span style="font-size: 12px; font-weight: 600; color: #0C66E4; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${matchedAtt.filename}</span>
              <span style="color: #626F86; font-size: 10px;">(${formatAttachmentSize(matchedAtt.size)})</span>
            </div>`;
          }
        }

        // If not matched directly in attachments array
        if (mediaAlt && mediaAlt.match(/\.(mp4|mov|webm|avi|mkv)$/i)) {
          return `<div style="margin: 6px 0; display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: #091E42; color: #FFF; border-radius: 6px; font-size: 12px; font-weight: 600;">
            <span>🎥 Video: ${mediaAlt}</span>
          </div>`;
        }
        if (mediaAlt && mediaAlt.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) {
          return `<div style="margin: 6px 0; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; background: #F4F5F7; border: 1px solid #DCDFE4; border-radius: 6px; font-size: 12px; font-weight: 500; color: #172B4D;">
            <span>📷 ${mediaAlt}</span>
          </div>`;
        }
        if (mediaAlt) {
          return `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background: #F4F5F7; border: 1px solid #DCDFE4; border-radius: 4px; font-size: 11px;">📎 ${mediaAlt}</span>`;
        }
        return '';
      }
      case 'inlineCard':
      case 'blockCard':
      case 'embedCard': {
        const cardUrl = node.attrs?.url;
        if (!cardUrl || cardUrl.includes('URL validation failed')) return '';
        return `<a href="${cardUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; background: #F4F5F7; border: 1px solid #DCDFE4; border-radius: 4px; color: #0C66E4; text-decoration: none; font-size: 12px; font-weight: 500; margin: 2px 0;">
          🔗 ${cardUrl}
        </a>`;
      }
      case 'panel': {
        const pType = node.attrs?.panelType || 'info';
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
        const title = node.attrs?.title || 'Detalles';
        return `<details style="margin: 0.5rem 0; padding: 0.5rem 0.75rem; background: #FAFBFC; border: 1px solid #DCDFE4; border-radius: 6px;">
          <summary style="font-weight: 600; cursor: pointer; color: #172B4D;">${title}</summary>
          <div style="margin-top: 0.5rem;">${content}</div>
        </details>`;
      }
      case 'status': {
        const sText = node.attrs?.text || '';
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

function BugAttachmentImageCard({ att, onPreview }) {
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

const MX_HOLIDAYS_SET = new Set([
  '2024-01-01', '2024-02-05', '2024-03-18', '2024-05-01', '2024-09-16', '2024-10-01', '2024-11-18', '2024-12-25',
  '2025-01-01', '2025-02-03', '2025-03-17', '2025-05-01', '2025-09-16', '2025-11-17', '2025-12-25',
  '2026-01-01', '2026-02-02', '2026-03-16', '2026-05-01', '2026-09-16', '2026-11-16', '2026-12-25',
  '2027-01-01', '2027-02-01', '2027-03-15', '2027-05-01', '2027-09-16', '2027-11-15', '2027-12-25'
]);

function getBusinessHoursBetween(startMs, endMs) {
  if (!startMs || !endMs || startMs >= endMs) return 0;
  let current = new Date(startMs);
  const end = new Date(endMs);
  let businessMinutes = 0;
  const mxOffset = -6 * 60 * 60 * 1000;

  while (current < end) {
    const mxTime = new Date(current.getTime() + mxOffset);
    const day = mxTime.getUTCDay();
    const hour = mxTime.getUTCHours();
    const dateString = mxTime.toISOString().split('T')[0];

    let isBusiness = false;
    if (!MX_HOLIDAYS_SET.has(dateString)) {
      if (day >= 1 && day <= 4) {
        if (hour >= 7 && hour < 18) isBusiness = true;
      } else if (day === 5) {
        if (hour >= 7 && hour < 13) isBusiness = true;
      }
    }
    if (isBusiness) businessMinutes++;
    current.setTime(current.getTime() + 60000);
  }
  return businessMinutes / 60;
}

function formatBugCreatedDate(createdStr) {
  if (!createdStr) return { dateStr: 'Sin fecha', timeStr: '' };
  try {
    const d = new Date(createdStr);
    if (isNaN(d.getTime())) return { dateStr: 'Sin fecha', timeStr: '' };
    const dateStr = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return { dateStr, timeStr };
  } catch (e) {
    return { dateStr: 'Sin fecha', timeStr: '' };
  }
}

function formatBugAge(createdStr, resolutionDateStr, isDone) {
  if (!createdStr) return { label: 'Sin registro', tone: 'neutral', hours: 0, days: 0, bHoursFormatted: '0' };
  try {
    const created = new Date(createdStr).getTime();
    if (isNaN(created)) return { label: 'Sin registro', tone: 'neutral', hours: 0, days: 0, bHoursFormatted: '0' };

    let end = Date.now();
    if (isDone && resolutionDateStr) {
      const resTime = new Date(resolutionDateStr).getTime();
      if (!isNaN(resTime) && resTime >= created) {
        end = resTime;
      }
    }

    const businessHours = getBusinessHoursBetween(created, end);
    const bHoursFormatted = businessHours.toFixed(1);
    const bDays = Math.floor(businessHours / 10);

    let label = '';
    let tone = 'neutral';

    if (isDone) {
      if (businessHours < 1) {
        const mins = Math.max(1, Math.round(businessHours * 60));
        label = `Resuelto en ${mins}m hábiles`;
      } else if (businessHours < 10) {
        label = `Resuelto en ${bHoursFormatted}h hábiles`;
      } else {
        const days = Math.round(businessHours / 10);
        label = `Resuelto en ${days}d hábiles (${bHoursFormatted}h)`;
      }
      tone = 'done';
    } else {
      if (businessHours < 1) {
        const mins = Math.max(1, Math.round(businessHours * 60));
        label = `Abierto hace ${mins}m hábiles`;
        tone = 'green';
      } else if (businessHours <= 20) {
        const days = Math.floor(businessHours / 10);
        label = days > 0 ? `Abierto hace ${days}d hábil (${bHoursFormatted}h)` : `Abierto hace ${bHoursFormatted}h hábiles`;
        tone = 'green';
      } else if (businessHours <= 50) {
        const days = Math.floor(businessHours / 10);
        label = `Abierto hace ${days}d hábiles (${bHoursFormatted}h)`;
        tone = 'orange';
      } else {
        const days = Math.floor(businessHours / 10);
        label = `Abierto hace ${days}d hábiles (${bHoursFormatted}h)`;
        tone = 'red';
      }
    }

    return { label, tone, hours: businessHours, days: bDays, bHoursFormatted };
  } catch (e) {
    return { label: 'Sin registro', tone: 'neutral', hours: 0, days: 0, bHoursFormatted: '0' };
  }
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


const AtlaskitStatusLozenge = ({ status, style = {} }) => {
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
  const activeCycleIdRef = useRef(null);   // currently selected / active cycle ID
  const deletedIdsRef = useRef(new Set()); // in-session deletions (current cycle)
  const perCycleDeletedRef = useRef({});   // { [cycleId]: Set<testId> } — persists across cycle switches
  const perCycleCacheRef = useRef({});     // { [cycleId]: Array<TestCase> } — in-memory cache for 0ms transitions

  const getCycleAuthoritativeCount = useCallback((cycle) => {
    if (!cycle) return 0;
    const cId = String(cycle.id);
    const cached = perCycleCacheRef.current[cId];
    if (cached && Array.isArray(cached)) {
      return cached.length;
    }
    if (selectedCycle && String(selectedCycle.id) === cId && activeCycleIdRef.current === cId && cycleTests.length > 0) {
      return cycleTests.length;
    }
    return cycle.testCount !== undefined ? cycle.testCount : (cycle.tests?.length || 0);
  }, [selectedCycle, cycleTests.length]);

  const safeSetCycleTests = useCallback((newExecutionData, targetCycleId = null) => {
      const cId = targetCycleId ? String(targetCycleId) : (selectedCycle ? String(selectedCycle.id) : null);
      if (!cId) return [];
      if (!newExecutionData || !Array.isArray(newExecutionData)) { 
        console.error('safeSetCycleTests got non-array:', newExecutionData); 
        return []; 
      }

      const deletedForCycle = perCycleDeletedRef.current[cId] || new Set();
      const existingCycleItems = perCycleCacheRef.current[cId] || [];
      const existingMap = new Map();
      existingCycleItems.forEach(item => {
        if (item.id) existingMap.set(String(item.id), item);
        const itemKey = item.testCaseKey || item.key;
        if (itemKey) existingMap.set(String(itemKey), item);
      });

      // 1. Authoritative mapping from backend Jira response (preserves rich local details if present)
      const merged = newExecutionData
        .filter(backendItem => {
          const tcId = String(backendItem.id || backendItem.testCaseId || '');
          const tcKey = backendItem.testCaseKey || backendItem.key || '';
          return !deletedForCycle.has(tcId) && (!tcKey || !deletedForCycle.has(tcKey));
        })
        .map(backendItem => {
          const tcId = String(backendItem.id || backendItem.testCaseId || '');
          const tcKey = backendItem.testCaseKey || backendItem.key || '';
          const existing = existingMap.get(tcId) || (tcKey ? existingMap.get(tcKey) : null);
          if (existing) {
            return {
              ...existing,
              ...backendItem,
              description: backendItem.description || existing.description,
              iterations: (backendItem.iterations && backendItem.iterations.length > 0) ? backendItem.iterations : (existing.iterations || []),
              evidences: (backendItem.evidences && backendItem.evidences.length > 0) ? backendItem.evidences : (existing.evidences || []),
              linkedBugs: (backendItem.linkedBugs && backendItem.linkedBugs.length > 0) ? backendItem.linkedBugs : (existing.linkedBugs || []),
              _detailLoaded: existing._detailLoaded || backendItem._detailLoaded || false
            };
          }
          return backendItem;
        });

      // 2. Deduplicate final array strictly by key and id
      const dedupedMap = new Map();
      for (const item of merged) {
        const tcKey = item.testCaseKey || item.key;
        const tcId = String(item.testCaseId || item.id);
        const dKey = tcKey ? `key_${tcKey}` : `id_${tcId}`;
        if (!dedupedMap.has(dKey)) {
          dedupedMap.set(dKey, item);
        } else {
          const existing = dedupedMap.get(dKey);
          const hasExec = item.status && normalizeUiStatus(item.status) !== 'Not Run';
          const existingHasExec = existing.status && normalizeUiStatus(existing.status) !== 'Not Run';
          if (hasExec && !existingHasExec) {
            dedupedMap.set(dKey, item);
          }
        }
      }
      const finalDedupedArray = Array.from(dedupedMap.values());

      perCycleCacheRef.current[cId] = finalDedupedArray;
      setTestCycles(cycles => cycles.map(c => String(c.id) === cId ? { ...c, testCount: finalDedupedArray.length } : c));

      // Only update active cycleTests if this target cycle is currently active
      if (activeCycleIdRef.current === cId) {
        setCycleTests(finalDedupedArray);
        setSelectedCycle(prev => (prev && String(prev.id) === cId ? { ...prev, testCount: finalDedupedArray.length } : prev));
      }

      return finalDedupedArray;
  }, [selectedCycle]);

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
  const [addingProgress, setAddingProgress] = useState({ current: 0, total: 0 });
  const [previewImages, setPreviewImages] = useState({});
  const [previewModalData, setPreviewModalData] = useState(null);
  const [linkingBugTestId, setLinkingBugTestId] = useState(null); // id of test for which we show the bug-link input
  const [bugKeyInput, setBugKeyInput] = useState('');
  const [executionStatusFilter, setExecutionStatusFilter] = useState('ALL');
  const [executionSearchQuery, setExecutionSearchQuery] = useState('');
  const [executionSortBy, setExecutionSortBy] = useState('none');
  const [executionCurrentPage, setExecutionCurrentPage] = useState(1);
  const [executionPageSize, setExecutionPageSize] = useState(20);
  const [executionChecked, setExecutionChecked] = useState(new Set());
  
  // Mobile QR Upload State
  const [qrModalSession, setQrModalSession] = useState(null);
  const [qrModalLoading, setQrModalLoading] = useState(false);
  const [qrModalCopied, setQrModalCopied] = useState(false);
  const [qrModalReceived, setQrModalReceived] = useState(false);
  
  // Reports State
  const [reportData, setReportData] = useState({ cycles: [] });
  const [reportLoading, setReportLoading] = useState(false);
  const [isRefreshingReport, setIsRefreshingReport] = useState(false);
  const [isHydratingReport, setIsHydratingReport] = useState(false);
  const [hydrationProgress, setHydrationProgress] = useState({ loaded: 0, total: 0 });
  const hydrationSessionRef = useRef(0);
  const [isFolderSidebarVisible, setIsFolderSidebarVisible] = useState(() => {
    try {
      return localStorage.getItem('tp_folders_sidebar_visible') !== 'false';
    } catch (e) {
      return true;
    }
  });

  const toggleFolderSidebar = () => {
    setIsFolderSidebarVisible(prev => {
      const next = !prev;
      try {
        localStorage.setItem('tp_folders_sidebar_visible', String(next));
      } catch (e) {}
      return next;
    });
  };
  const [reportSelectedPlans, setReportSelectedPlans] = useState([]);
  const [bugResolutionTime, setBugResolutionTime] = useState(null);
  const [reportSelectedCycles, setReportSelectedCycles] = useState([]);
  const [reportSelectedVersions, setReportSelectedVersions] = useState([]);
  const [selectedDashboardSeverityFilter, setSelectedDashboardSeverityFilter] = useState(null);
  const [executionTypeFieldId, setExecutionTypeFieldId] = useState(null);
  const [resolutionStage, setResolutionStage] = useState('Nuevo a Abierto');
  const [dashboardSubView, setDashboardSubView] = useState('runs'); // 'runs', 'bugs', 'traceability'
  const [dashboardBugSearch, setDashboardBugSearch] = useState('');
  const [dashboardGeneralBugSearch, setDashboardGeneralBugSearch] = useState('');
  const [dashboardGeneralBugStatusTab, setDashboardGeneralBugStatusTab] = useState('ALL'); // 'ALL', 'OPEN', 'CLOSED'
  const [dashboardTraceabilitySearch, setDashboardTraceabilitySearch] = useState('');
  const [showUnlinkedBugsModal, setShowUnlinkedBugsModal] = useState(false);
  const [linkingUnlinkedBug, setLinkingUnlinkedBug] = useState(null);
  const [targetCycleForBug, setTargetCycleForBug] = useState('');
  const [targetTestForBug, setTargetTestForBug] = useState('');
  const [isLinkingUnlinkedBugLoading, setIsLinkingUnlinkedBugLoading] = useState(false);
  
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

  // Bug Details Modal / Drawer State (Lazy Loading)
  const [selectedBug, setSelectedBug] = useState(null);
  const [selectedBugDetails, setSelectedBugDetails] = useState(null);
  const [selectedBugLoading, setSelectedBugLoading] = useState(false);
  const [selectedMediaModal, setSelectedMediaModal] = useState(null);

  useEffect(() => {
    if (selectedBug) {
      setSelectedBugLoading(true);
      setSelectedBugDetails(null);
      const bugKeyOrId = selectedBug.key || selectedBug.id;
      invoke('getBugFullDetails', { issueIdOrKey: bugKeyOrId })
        .then(details => {
          setSelectedBugDetails(details);
          setSelectedBugLoading(false);
        })
        .catch(err => {
          console.error('Error fetching bug full details:', err);
          setSelectedBugLoading(false);
        });
    } else {
      setSelectedBugDetails(null);
      setSelectedBugLoading(false);
    }
  }, [selectedBug]);
  
  // Search & Refresh State
  const [searchQuery, setSearchQuery] = useState('');
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [selectedDesignTestIds, setSelectedDesignTestIds] = useState(new Set());
  const [draggedDesignTestIds, setDraggedDesignTestIds] = useState(null);
  const [pointerDragState, setPointerDragState] = useState(null);
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
  const [isFetchingTests, setIsFetchingTests] = useState(true);
  const [isLoadingCycleTests, setIsLoadingCycleTests] = useState(false);

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

  // Dashboard Customizable Widgets State
  const [dashboardWidgets, setDashboardWidgets] = useState(DEFAULT_DASHBOARD_WIDGETS);
  const [isCustomizingDashboard, setIsCustomizingDashboard] = useState(false);
  const [showAddWidgetModal, setShowAddWidgetModal] = useState(false);
  const [draggedWidgetIndex, setDraggedWidgetIndex] = useState(null);

  // Sync dashboardWidgets with projectConfig or localStorage
  useEffect(() => {
    if (projectConfig?.dashboardWidgets && Array.isArray(projectConfig.dashboardWidgets) && projectConfig.dashboardWidgets.length > 0) {
      setDashboardWidgets(projectConfig.dashboardWidgets);
    } else if (selectedProjectId) {
      try {
        const cached = localStorage.getItem(`testpulse_widgets_${selectedProjectId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setDashboardWidgets(parsed);
            return;
          }
        }
      } catch (e) {}
      setDashboardWidgets(DEFAULT_DASHBOARD_WIDGETS);
    }
  }, [projectConfig?.dashboardWidgets, selectedProjectId]);

  const handleSaveDashboardLayout = (newWidgets) => {
    setDashboardWidgets(newWidgets);
    if (selectedProjectId) {
      try {
        localStorage.setItem(`testpulse_widgets_${selectedProjectId}`, JSON.stringify(newWidgets));
      } catch (e) {}
      const updatedConf = { ...projectConfig, dashboardWidgets: newWidgets };
      setProjectConfig(updatedConf);
      invoke('setConfig', { projectId: selectedProjectId, config: updatedConf }).catch(() => {});
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedWidgetIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(index));
    } catch (err) {}
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedWidgetIndex === null || draggedWidgetIndex === targetIndex) {
      setDraggedWidgetIndex(null);
      return;
    }
    const updated = [...dashboardWidgets];
    const [moved] = updated.splice(draggedWidgetIndex, 1);
    updated.splice(targetIndex, 0, moved);
    setDraggedWidgetIndex(null);
    handleSaveDashboardLayout(updated);
    addNotification({ type: 'info', title: 'Tablero Reorganizado', description: `Widget movido a la posición ${targetIndex + 1}`, duration: 2500 });
  };

  const handleMoveWidget = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= dashboardWidgets.length) return;
    const updated = [...dashboardWidgets];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    handleSaveDashboardLayout(updated);
  };

  const handleToggleWidgetWidth = (widgetId) => {
    const updated = dashboardWidgets.map(w => {
      if (w.id === widgetId || w.type === widgetId) {
        return { ...w, width: w.width === 'full' ? 'half' : 'full' };
      }
      return w;
    });
    handleSaveDashboardLayout(updated);
  };

  const handleRemoveWidget = (widgetId) => {
    const widgetToRemove = dashboardWidgets.find(w => w.id === widgetId || w.type === widgetId);
    const updated = dashboardWidgets.filter(w => w.id !== widgetId && w.type !== widgetId);
    handleSaveDashboardLayout(updated);
    addNotification({
      type: 'info',
      title: 'Widget Ocultado',
      description: `"${widgetToRemove?.title || widgetId}" quitado del tablero. Puedes volver a agregarlo desde "+ Agregar Widget".`,
      duration: 3500
    });
  };

  const handleRemoveWidgetByType = (type) => {
    const updated = dashboardWidgets.filter(w => w.type !== type);
    handleSaveDashboardLayout(updated);
  };

  const handleAddWidget = (widgetType) => {
    const catalogItem = AVAILABLE_WIDGET_CATALOG.find(c => c.type === widgetType);
    if (!catalogItem) return;
    
    if (dashboardWidgets.some(w => w.type === widgetType)) {
      addNotification({ type: 'warning', title: 'Widget ya presente', description: `El widget "${catalogItem.title}" ya está en tu tablero.`, duration: 3000 });
      return;
    }

    const newWidget = {
      id: `w_${widgetType}_${Date.now()}`,
      type: widgetType,
      title: catalogItem.title,
      width: catalogItem.defaultWidth || 'half',
      visible: true
    };

    const updated = [...dashboardWidgets, newWidget];
    handleSaveDashboardLayout(updated);
    addNotification({
      type: 'success',
      title: 'Widget Agregado',
      description: `"${catalogItem.title}" añadido exitosamente al Dashboard.`,
      duration: 3000
    });
  };

  const handleResetDashboardLayout = () => {
    showConfirm(
      'Restablecer diseño predeterminado',
      '¿Deseas volver a la distribución original de widgets del Dashboard?',
      () => {
        handleSaveDashboardLayout(DEFAULT_DASHBOARD_WIDGETS);
        addNotification({ type: 'success', title: 'Diseño Restablecido', description: 'Se ha restaurado el diseño original de widgets.', duration: 3000 });
      }
    );
  };

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


  const fetchAllTestCases = async (args, retries = 2) => {
      let allIssues = [];
      let token = null;
      let isLast = false;
      let pagesFetched = 0;
      const MAX_PAGES = 35;
      
      while (!isLast && pagesFetched < MAX_PAGES) {
          const res = await invoke('getTestCases', { ...args, nextPageToken: token });
          if (Array.isArray(res)) {
             if (res.length > 0 && res[0].id === '999999') {
                 if (retries > 0) {
                     await new Promise(r => setTimeout(r, 1200 + Math.random() * 500));
                     return fetchAllTestCases(args, retries - 1);
                 }
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
              if (retries > 0 && allIssues.length === 0) {
                  await new Promise(r => setTimeout(r, 1200 + Math.random() * 500));
                  return fetchAllTestCases(args, retries - 1);
              }
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
        const plans = Array.isArray(plansRes.value) ? plansRes.value : [];
        setTestPlans(plans);
        if (plans.length > 0) {
          setSelectedPlanId(prev => (prev && plans.some(p => String(p.id) === String(prev))) ? prev : plans[0].id);
        }
      }
      if (cyclesRes.status === 'fulfilled') {
        const cycs = Array.isArray(cyclesRes.value) ? cyclesRes.value : [];
        setTestCycles(cycs);
      }
      setRefreshTrigger(prev => prev + 1);

      // Phase 3: background
      // 3a. sessionStorage cache for testCases (instant on second open)
      const cacheKey = `tp_${targetProjectId}_tc`;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const { ts, data } = JSON.parse(raw);
          if (Date.now() - ts < 300_000 && Array.isArray(data) && data.length > 0) {
            setTestCases(data);
          }
        }
      } catch (e) {}

      setIsFetchingTests(true);
      fetchAllTestCases({ folderId: null, projectId: targetProjectId, config })
        .then(tests => {
          setTestCases(tests || []);
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: tests || [] })); } catch (e) {}
        })
        .catch(console.warn)
        .finally(() => {
          setIsFetchingTests(false);
        });

      // 3b. Fields (bulk upload + execution type)
      invoke('getFields').then(processFields).catch(console.warn);

      // 3c. Admin-only: allowed project list
      if (adminVal) invoke('getAllowedProjects').then(a => setAllowedProjects(a)).catch(console.warn);

      // 3d. Preload Execution & Cycle metrics
      loadReportData(targetProjectId, config).catch(console.warn);

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

  // Reports: load on entering tab only if not loaded yet, and poll quietly in the background
  useEffect(() => {
    if (activeTab !== 'reports') return;
    if (!reportData.cycles || reportData.cycles.length === 0 || !reportData._loadedAt) {
      loadReportData(null, null, false);
    }
    const intervalId = setInterval(() => {
      if (document.hidden) return;
      loadReportData(null, null, true); // Silent background auto-sync
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

  // Helper to get all descendant folder IDs for a given folder (including itself)
  const getFolderDescendantIds = useCallback((folderId) => {
    const result = new Set([folderId]);
    const addChildren = (fId) => {
      folders.filter(f => f.parentId === fId).forEach(child => {
        result.add(child.id);
        addChildren(child.id);
      });
    };
    addChildren(folderId);
    return result;
  }, [folders]);

  // Set of valid folder IDs currently existing in the project
  const existingFolderIdSet = useMemo(() => new Set(folders.map(f => f.id)), [folders]);

  // Helper to count test cases in a folder and all its subfolders recursively
  const getFolderTotalCount = useCallback((folderId) => {
    const descendantIds = getFolderDescendantIds(folderId);
    return testCases.filter(t => t.folderId && descendantIds.has(t.folderId)).length;
  }, [getFolderDescendantIds, testCases]);

  // Scoped tests for the active folder selection in Design Tab
  const activeFolderScopedTestCases = useMemo(() => {
    if (activeFolder === null) {
      // "Sin Carpeta" -> Only tests without folder assigned OR assigned to a deleted folder
      return testCases.filter(tc => !tc.folderId || !existingFolderIdSet.has(tc.folderId));
    }
    const descendantIds = getFolderDescendantIds(activeFolder);
    return testCases.filter(tc => tc.folderId && descendantIds.has(tc.folderId));
  }, [activeFolder, testCases, getFolderDescendantIds, existingFolderIdSet]);

  // Filtered Data based on active folder scope, search, and type filter
  const filteredTestCasesAll = useMemo(() => {
    return activeFolderScopedTestCases.filter(tc => {
      const matchesSearch = tc.key.toLowerCase().includes(searchQuery.toLowerCase()) || (tc.summary || '').toLowerCase().includes(searchQuery.toLowerCase());
      const isAuto = isAutomatedTest(tc);
      const matchesType = designTypeFilter === 'all' 
        || (designTypeFilter === 'automated' && isAuto)
        || (designTypeFilter === 'manual' && !isAuto);
      return matchesSearch && matchesType;
    }).sort((a, b) => {
      if (designSortOrder === 'az') {
        return (a.summary || '').localeCompare(b.summary || '');
      }
      // Default: recent (numeric key ID desc)
      const numA = parseInt((a.key || '').replace(/\D/g, ''), 10) || 0;
      const numB = parseInt((b.key || '').replace(/\D/g, ''), 10) || 0;
      return numB - numA;
    });
  }, [activeFolderScopedTestCases, searchQuery, isAutomatedTest, designTypeFilter, designSortOrder]);
  
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

    const CHUNK = 10; // enviamos en lotes de 10 para no saturar la API ni exceder 25s
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
                const newPid = e.target.value;
                perCycleCacheRef.current = {};
                perCycleDeletedRef.current = {};
                setCycleTests([]);
                setSelectedCycle(null);
                setSelectedProjectId(newPid);
                setTestCases([]);
                setIsFetchingTests(true);
                loadData(newPid);
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
          <div className="nav-tabs" style={{ marginLeft: '1rem', flex: 1, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.25rem', height: '100%' }}>
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
                {isFetchingTests && testCases.length === 0 ? '...' : testCases.length}
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
                placeholder="Buscar Test..."
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
                  perCycleCacheRef.current = {};
                  perCycleDeletedRef.current = {};
                  if (selectedProjectId) {
                    try {
                      sessionStorage.removeItem(`tp_${selectedProjectId}_tc`);
                    } catch (e) {}
                  }

                  if (activeTab === 'execution' || activeTab === 'planning') {
                    setLocalLoading(true);
                    const config = projectConfig || { testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
                    const [fetchedCycles, fetchedPlans] = await Promise.all([
                      invoke('getTestCycles', { projectId: selectedProjectId, config }),
                      invoke('getTestPlans', { projectId: selectedProjectId, config })
                    ]);
                    if (fetchedCycles && !fetchedCycles._isError) setTestCycles(fetchedCycles);
                    if (fetchedPlans && !fetchedPlans._isError) setTestPlans(fetchedPlans);
                    if (selectedCycle) {
                      const rawExecution = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
                      safeSetCycleTests(rawExecution || [], selectedCycle.id);
                    }
                  } else if (activeTab === 'design') {
                    setLocalLoading(true);
                    setIsFetchingTests(true);
                    const config = projectConfig || { testCaseType: 'Test Case', testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
                    const [fetchedCases, fetchedFolders] = await Promise.all([
                      fetchAllTestCases({ folderId: null, projectId: selectedProjectId, config }),
                      invoke('getFolders', { projectId: selectedProjectId })
                    ]);
                    if (fetchedCases && !fetchedCases._isError) setTestCases(fetchedCases);
                    if (fetchedFolders && !fetchedFolders._isError) setFolders(fetchedFolders);
                  } else if (activeTab === 'reports') {
                    setLocalLoading(true);
                    const config = projectConfig || { testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
                    const [fetchedCycles, fetchedPlans] = await Promise.all([
                      invoke('getTestCycles', { projectId: selectedProjectId, config }),
                      invoke('getTestPlans', { projectId: selectedProjectId, config }),
                      loadReportData(selectedProjectId, config)
                    ]);
                    if (fetchedCycles && !fetchedCycles._isError) setTestCycles(fetchedCycles);
                    if (fetchedPlans && !fetchedPlans._isError) setTestPlans(fetchedPlans);
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
                  setIsFetchingTests(false);
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

  const handleCardPointerDown = (e, test) => {
    // If clicking an interactive control like checkbox, dropdown, button, link, don't drag
    if (e.target.closest('input, select, button, a, option')) {
      return;
    }
    // Only primary mouse button or touch
    if (e.button !== undefined && e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let isDragging = false;
    
    let ids = [test.id];
    if (selectedDesignTestIds.has(test.id) && selectedDesignTestIds.size > 1) {
      ids = Array.from(selectedDesignTestIds);
    }

    const onPointerMove = (moveEvent) => {
      const dx = Math.abs(moveEvent.clientX - startX);
      const dy = Math.abs(moveEvent.clientY - startY);
      
      if (!isDragging && (dx > 5 || dy > 5)) {
        isDragging = true;
        setPointerDragState({
          active: true,
          testIds: ids,
          primaryTest: test,
          x: moveEvent.clientX,
          y: moveEvent.clientY
        });
        document.body.style.cursor = 'grabbing';
      }

      if (isDragging) {
        setPointerDragState(prev => prev ? ({
          ...prev,
          x: moveEvent.clientX,
          y: moveEvent.clientY
        }) : null);

        // Find folder element under cursor
        const elem = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const folderElem = elem?.closest('[data-folder-id]');
        if (folderElem) {
          const fId = folderElem.getAttribute('data-folder-id');
          setDragOverFolderId(fId);
        } else {
          setDragOverFolderId(null);
        }
      }
    };

    const onPointerUp = (upEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      document.body.style.cursor = '';

      if (isDragging) {
        window.__justFinishedDrag = Date.now();
        const elem = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const folderElem = elem?.closest('[data-folder-id]');
        if (folderElem) {
          const targetFolderId = folderElem.getAttribute('data-folder-id');
          const finalFolderId = targetFolderId === '__ROOT__' ? null : targetFolderId;
          const targetFolderName = finalFolderId ? (folders.find(f => f.id === finalFolderId)?.name || 'Carpeta') : 'Sin Carpeta (Raíz)';
          handleBatchLinkTestsToFolder(ids, finalFolderId, targetFolderName);
          setSelectedDesignTestIds(new Set());
        }
        setPointerDragState(null);
        setDragOverFolderId(null);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const renderDesignTab = () => (
    <div className="tab-layout">
      {/* Sidebar Navigation (Folders) */}
      {isFolderSidebarVisible && (
        <>
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
                <button
                  onClick={toggleFolderSidebar}
                  title="Ocultar panel de carpetas (Sidebar)"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '3px',
                    borderRadius: '4px',
                    color: 'var(--jira-subtle, #626F86)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--jira-bg-subtle, #F1F2F4)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <path d="M15 15l-3-3 3-3" />
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
            data-folder-id="__ROOT__"
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
                handleBatchLinkTestsToFolder(idsToMove, null, 'Sin Carpeta (Raíz)');
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
            <span style={{ fontSize: '15px', flexShrink: 0, lineHeight: 1 }}>📁</span>
            <span style={{ fontWeight: 600, fontSize: '0.82rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dragOverFolderId === '__ROOT__' ? '⚡ Soltar aquí (Sin Carpeta)' : 'Sin Carpeta'}
            </span>
            <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px' }}>
              {isFetchingTests && testCases.length === 0 ? '...' : testCases.filter(t => !t.folderId || !existingFolderIdSet.has(t.folderId)).length}
            </span>
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
                        data-folder-id={folder.id}
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
                          <span style={{ fontSize: '15px', flexShrink: 0, lineHeight: 1 }}>📁</span>
                          <span style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isDragTarget ? 700 : (activeFolder === folder.id ? 600 : 400) }} title={folder.name}>
                            {isDragTarget ? `⚡ Soltar en "${folder.name}"` : folder.name}
                          </span>
                          <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '10px', marginLeft: 'auto', marginRight: '4px' }}>
                            {isFetchingTests && testCases.length === 0 ? '...' : getFolderTotalCount(folder.id)}
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
      </>
      )}
      <main className="main-content" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
        <div className="header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {!isFolderSidebarVisible && (
                <button
                  onClick={toggleFolderSidebar}
                  className="btn-secondary"
                  title="Mostrar panel de carpetas (Sidebar)"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '0.78rem',
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    marginRight: '2px'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <path d="M13 9l3 3-3 3" />
                  </svg>
                  <span>Carpetas</span>
                </button>
              )}
              <span style={{ fontSize: '18px', lineHeight: 1, flexShrink: 0 }}>📁</span>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--jira-text, #172B4D)' }}>
                {activeFolder === null ? 'Sin Carpeta (Raíz)' : (folders.find(f => f.id === activeFolder)?.name || 'Carpeta')}
              </h1>
              <span className="ads-lozenge ads-lozenge-subtle">
                {isFetchingTests && testCases.length === 0 ? '(Cargando casos...)' : `(${activeFolderScopedTestCases.length} casos)`}
              </span>
              {isFetchingTests && testCases.length > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#0C66E4', backgroundColor: '#E9F2FF', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>
                  <span className="spinner" style={{ width: '9px', height: '9px', border: '2px solid #B3D4FF', borderTop: '2px solid #0C66E4', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
                  Sincronizando...
                </span>
              )}
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--jira-subtle, #626F86)' }}>
              Explora, edita y organiza casos de prueba vinculados a la suite de regresión y diseño.
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
                    <option value="">Sin Carpeta (Raíz)</option>
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
              <span className="ads-lozenge ads-lozenge-brand" style={{ borderRadius: '9999px', fontSize: '11px', background: 'var(--jira-blue, #0C66E4)', color: '#FFFFFF', border: 'none' }}>
                {selectedDesignTestIds.size} seleccionados
              </span>
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
                Todos ({isFetchingTests && testCases.length === 0 ? '...' : activeFolderScopedTestCases.length})
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
                ⚡ Auto ({isFetchingTests && testCases.length === 0 ? '...' : activeFolderScopedTestCases.filter(isAutomatedTest).length})
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
                Manual ({isFetchingTests && testCases.length === 0 ? '...' : activeFolderScopedTestCases.filter(t => !isAutomatedTest(t)).length})
              </button>
            </div>

            {/* Sort Dropdown */}
            <select
              value={designSortOrder}
              onChange={(e) => setDesignSortOrder(e.target.value)}
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

        {loading || (isFetchingTests && testCases.length === 0) ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4rem 2rem',
            backgroundColor: '#FFFFFF',
            borderRadius: '8px',
            border: '1px solid var(--jira-border, #DCDFE4)',
            boxShadow: '0 1px 3px rgba(9, 30, 66, 0.05)',
            textAlign: 'center',
            color: 'var(--jira-subtle, #626F86)',
            margin: '0.5rem 0'
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: '3px solid #DCDFE4',
              borderTopColor: 'var(--jira-blue, #0C66E4)',
              animation: 'spin 0.8s linear infinite',
              marginBottom: '1rem'
            }} />
            <p style={{ margin: '0 0 0.35rem 0', fontWeight: 600, fontSize: '0.95rem', color: 'var(--jira-text, #172B4D)' }}>
              Cargando casos de prueba...
            </p>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--jira-subtle, #626F86)' }}>
              Sincronizando casos y carpetas desde Jira. Por favor espera un momento.
            </p>
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

                const isBeingDragged = (pointerDragState?.testIds?.includes(test.id)) || (draggedDesignTestIds?.includes(test.id));

                return (
                  <div 
                    key={test.id} 
                    className={`modern-test-card ${isSelected ? 'selected' : ''} ${isBeingDragged ? 'dragging' : ''}`}
                    onPointerDown={(e) => handleCardPointerDown(e, test)}
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

                    {/* Detail Chevron */}
                    <div style={{ color: 'var(--jira-subtle, #626F86)', display: 'flex', alignItems: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </div>
                  </div>
                );
              })}

              {!isFetchingTests && filteredTestCases.length === 0 && (
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
                      if (e.target.value !== '') {
                        const targetFolder = e.target.value === '__ROOT__' ? null : e.target.value;
                        const targetFolderName = targetFolder ? (folders.find(f => f.id === targetFolder)?.name || 'Carpeta') : 'Sin Carpeta (Raíz)';
                        handleBatchLinkTestsToFolder(Array.from(selectedDesignTestIds), targetFolder, targetFolderName);
                        setSelectedDesignTestIds(new Set());
                        e.target.value = '';
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
                    <option value="" disabled style={{ color: '#000' }}>📁 Mover a carpeta...</option>
                    <option value="__ROOT__" style={{ color: '#000' }}>📁 Sin Carpeta (Raíz)</option>
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
                  ⚡ {isFetchingTests && testCases.length === 0 ? 'Calculando...' : `${activeFolderScopedTestCases.length > 0 ? Math.round((activeFolderScopedTestCases.filter(isAutomatedTest).length / activeFolderScopedTestCases.length) * 100) : 0}% (${activeFolderScopedTestCases.filter(isAutomatedTest).length} / ${activeFolderScopedTestCases.length})`}
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

      {/* Floating Pointer Drag Ghost Badge */}
      {pointerDragState?.active && (
        <div style={{
          position: 'fixed',
          left: pointerDragState.x + 14,
          top: pointerDragState.y + 14,
          zIndex: 999999,
          pointerEvents: 'none',
          backgroundColor: '#FFFFFF',
          border: '2px solid #E1007A',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(225, 0, 122, 0.35)',
          padding: '0.6rem 0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          maxWidth: '320px',
          transform: 'rotate(-2deg)',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{ background: '#FDF2F7', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: '16px', lineHeight: 1 }}>📁</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <strong style={{ color: '#E1007A', fontSize: '0.82rem', fontFamily: 'monospace' }}>
                {pointerDragState.primaryTest?.key}
              </strong>
              {pointerDragState.testIds?.length > 1 && (
                <span style={{ background: '#E1007A', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '9999px' }}>
                  +{pointerDragState.testIds.length - 1} más
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--jira-navy, #091E42)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '230px' }}>
              {pointerDragState.primaryTest?.summary || pointerDragState.primaryTest?.name}
            </span>
            <span style={{ fontSize: '0.7rem', color: dragOverFolderId ? '#E1007A' : '#626F86', fontWeight: dragOverFolderId ? 700 : 400, marginTop: '2px' }}>
              {dragOverFolderId ? '⚡ Suelta para mover' : '👉 Arrastra sobre una carpeta'}
            </span>
          </div>
        </div>
      )}
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
            width: '98%',
            maxWidth: '1440px',
            height: '92vh',
            minHeight: '620px',
            maxHeight: '940px',
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
                  <span style={{ fontSize: '12px', lineHeight: 1 }}>📁</span>
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

              {/* Header Right Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button 
                  onClick={() => { setSelectedTestCase(null); setTestCaseDetails({ type: 'traditional', content: [] }); setTestCaseHistory([]); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '1.25rem',
                    lineHeight: '1',
                    color: '#626F86',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  aria-label="Cerrar panel"
                >
                  ✕
                </button>
              </div>
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
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '1.25rem 1.5rem 1.75rem 1.5rem', backgroundColor: '#FAFBFC', display: 'flex', flexDirection: 'column' }}>
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
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '8px', paddingBottom: '2.5rem' }}>
                    {loadingDescription ? (
                      <div style={{ padding: '3rem', textAlign: 'center', color: '#626F86' }}>
                        <div className="spinner" style={{ margin: '0 auto 1rem auto', width: '28px', height: '28px', border: '3px solid #DCDFE4', borderTop: '3px solid #0C66E4', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                        <span>Cargando descripción desde Jira...</span>
                      </div>
                    ) : selectedTestCaseDescription ? (
                      <div 
                        className="description-content"
                        style={{ fontSize: '0.85rem', lineHeight: '1.6', color: '#172B4D', paddingBottom: '2.5rem' }}
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
                <div style={{ backgroundColor: '#FFFFFF', borderRadius: '6px', border: '1px solid #DCDFE4', padding: '1.25rem 1.25rem 2.5rem 1.25rem', boxShadow: '0 1px 2px rgba(9,30,66,0.04)', display: 'flex', flexDirection: 'column', gap: '0.9rem', height: '100%', minHeight: 0, overflowY: 'auto' }}>
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

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: '2.5rem' }}>
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
                                  <AtlaskitStatusLozenge status={statusVal} />
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

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const renderQrModal = () => {
    if (!qrModalSession && !qrModalLoading) return null;

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(9, 30, 66, 0.65)',
          backdropFilter: 'blur(6px)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          animation: 'fadeIn 0.2s ease-out'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setQrModalSession(null);
            setQrModalReceived(false);
          }
        }}
      >
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '16px',
            boxShadow: '0 24px 48px rgba(9, 30, 66, 0.35)',
            width: '100%',
            maxWidth: '460px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid #DCDFE4'
          }}
        >
          {/* Header */}
          <div
            style={{
              background: 'linear-gradient(135deg, #E1007A 0%, #0C66E4 100%)',
              padding: '16px 20px',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '24px' }}>📱</span>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '0.2px' }}>
                  Captura Móvil de Evidencia (QR)
                </div>
                <div style={{ fontSize: '11.5px', opacity: 0.9, fontWeight: 500 }}>
                  Apunta con la cámara de tu celular para subir fotos
                </div>
              </div>
            </div>
            <button
              onClick={() => { setQrModalSession(null); setQrModalReceived(false); }}
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                borderRadius: '50%',
                width: '28px',
                height: '28px',
                color: '#FFFFFF',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            
            {/* Target Metadata Card */}
            {qrModalSession && (
              <div
                style={{
                  width: '100%',
                  background: '#F7F8F9',
                  border: '1px solid #DCDFE4',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        background: '#E9F2FF',
                        color: '#0C66E4',
                        fontWeight: 800,
                        fontSize: '12px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                      title="Test Run asignado a esta ejecución"
                    >
                      🏃 {qrModalSession.testRunKey || qrModalSession.testRunId || qrModalSession.testKey}
                    </span>
                    {qrModalSession.testKey && qrModalSession.testKey !== (qrModalSession.testRunKey || qrModalSession.testRunId) && (
                      <span
                        style={{
                          background: '#F1F2F4',
                          color: '#44546F',
                          fontWeight: 600,
                          fontSize: '11px',
                          padding: '2px 6px',
                          borderRadius: '4px'
                        }}
                        title="Caso de prueba base"
                      >
                        Caso: {qrModalSession.testKey}
                      </span>
                    )}
                  </div>
                  {qrModalSession.iterName && (
                    <span style={{ background: '#EAE6FF', color: '#5E4DB2', fontWeight: 700, fontSize: '11px', padding: '2px 6px', borderRadius: '4px' }}>
                      📁 {qrModalSession.iterName}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {qrModalSession.testSummary}
                </div>
              </div>
            )}

            {/* QR Code Container or Loading */}
            {qrModalLoading ? (
              <div style={{ height: '240px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <Spinner size="large" />
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#626F86' }}>Generando enlace seguro para cámara...</div>
              </div>
            ) : qrModalSession?.dataUrl ? (
              <div
                style={{
                  padding: '12px',
                  background: '#FFFFFF',
                  borderRadius: '16px',
                  border: '2px solid #0C66E4',
                  boxShadow: '0 8px 24px rgba(12, 102, 224, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <img
                  src={qrModalSession.dataUrl}
                  alt="Código QR para escaneo móvil"
                  width={280}
                  height={280}
                  style={{ display: 'block', borderRadius: '8px', imageRendering: 'pixelated' }}
                />
              </div>
            ) : qrModalSession?.svg ? (
              <div
                style={{
                  padding: '10px',
                  background: '#FFFFFF',
                  borderRadius: '16px',
                  border: '2px solid #0C66E4',
                  boxShadow: '0 8px 24px rgba(12, 102, 224, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                dangerouslySetInnerHTML={{ __html: qrModalSession.svg }}
              />
            ) : null}

            {/* Real-time Status Indicator */}
            {qrModalReceived ? (
              <div
                style={{
                  width: '100%',
                  background: '#DCFFF1',
                  border: '1px solid #7EE2B8',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  color: '#1F845A',
                  fontWeight: 700,
                  fontSize: '13px'
                }}
              >
                <span style={{ fontSize: '20px' }}>✅</span>
                <div>
                  <div>¡Evidencia Recibida con Éxito!</div>
                  <div style={{ fontSize: '11px', fontWeight: 500, color: '#216E4E' }}>La imagen ya fue adjuntada a la ejecución.</div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  width: '100%',
                  background: '#F1F2F4',
                  border: '1px solid #DCDFE4',
                  borderRadius: '10px',
                  padding: '8px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  color: '#44546F',
                  fontSize: '12px',
                  fontWeight: 600
                }}
              >
                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#0C66E4' }} />
                <span>Esperando captura desde el celular...</span>
              </div>
            )}

            {/* Instructions Step-by-Step */}
            <div style={{ width: '100%', fontSize: '11.5px', color: '#626F86', background: '#FAFBFC', padding: '10px 14px', borderRadius: '8px', border: '1px solid #EBECF0' }}>
              <div style={{ fontWeight: 700, color: '#172B4D', marginBottom: '4px' }}>📌 Pasos rápidos:</div>
              <div>1. Abre la app de <strong>Cámara</strong> en tu iPhone o Android.</div>
              <div>2. Apunta al código QR y toca el enlace que aparece.</div>
              <div>3. Toma la foto y presiona <strong>"Enviar a la Pantalla"</strong>.</div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', width: '100%', gap: '10px', marginTop: '4px' }}>
              <button
                onClick={() => {
                  if (qrModalSession?.uploadUrl) {
                    navigator.clipboard.writeText(qrModalSession.uploadUrl);
                    setQrModalCopied(true);
                    setTimeout(() => setQrModalCopied(false), 2500);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #DCDFE4',
                  background: '#FFFFFF',
                  color: '#172B4D',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <span>{qrModalCopied ? '✅ Copiado' : '🔗 Copiar Enlace'}</span>
              </button>

              <button
                onClick={() => { setQrModalSession(null); setQrModalReceived(false); }}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#0C66E4',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Cerrar
              </button>
            </div>

          </div>
        </div>
      </div>
    );
  };

  const renderMediaModal = () => {
    if (!selectedMediaModal) return null;
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem'
        }}
        onClick={() => setSelectedMediaModal(null)}
      >
        <div
          style={{
            position: 'relative',
            maxWidth: '90vw',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: '#1E1F21',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ width: '100%', padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#141517', borderBottom: '1px solid #333', color: '#FFF' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
              📷 {selectedMediaModal.name || 'Evidencia adjunta'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {selectedMediaModal.url && (
                <a
                  href={selectedMediaModal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  style={{ color: '#579DFF', fontSize: '12px', textDecoration: 'none', fontWeight: 600 }}
                >
                  Descargar ↗
                </a>
              )}
              <button
                onClick={() => setSelectedMediaModal(null)}
                style={{ background: 'transparent', border: 'none', color: '#FFF', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Media Body */}
          <div style={{ padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', maxHeight: 'calc(90vh - 60px)' }}>
            {selectedMediaModal.type === 'video' ? (
              <video
                controls
                autoPlay
                src={selectedMediaModal.url}
                style={{ maxWidth: '85vw', maxHeight: '75vh', borderRadius: '4px' }}
              />
            ) : (
              <img
                src={selectedMediaModal.url}
                alt={selectedMediaModal.name}
                style={{ maxWidth: '85vw', maxHeight: '75vh', objectFit: 'contain', borderRadius: '4px' }}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderBugSlidePanel = () => {
    if (!selectedBug) return null;

    const b = selectedBugDetails || selectedBug;
    const bugKey = b.key || selectedBug.key || 'BUG';
    const summary = b.summary || selectedBug.summary || 'Sin título';
    const rawStatus = b.status || selectedBug.status || 'Abierto';
    const isDone = ['closed', 'cerrada', 'cerrado'].includes(String(rawStatus).toLowerCase().trim());

    // Severities
    const rawSev = b.rawSeverity || b.severity || selectedBug.severity || 'Sin definir';
    const sevNormalized = typeof rawSev === 'string' ? rawSev : (rawSev.value || rawSev.name || 'Sin definir');
    const sevLow = sevNormalized.toLowerCase();

    let sevBg = '#F1F2F4';
    let sevColor = '#626F86';
    let sevBorder = '#DCDFE4';

    if (sevLow.includes('bloq') || sevLow.includes('blocker')) {
      sevBg = '#FFEBE6';
      sevColor = '#BF2600';
      sevBorder = '#FF8F73';
    } else if (sevLow.includes('crit') || sevLow.includes('crít')) {
      sevBg = '#FFF0ED';
      sevColor = '#DE350B';
      sevBorder = '#FFBDAD';
    } else if (sevLow.includes('may') || sevLow.includes('major') || sevLow.includes('alta') || sevLow.includes('high')) {
      sevBg = '#FFFAE6';
      sevColor = '#974F00';
      sevBorder = '#FFE380';
    } else if (sevLow.includes('men') || sevLow.includes('minor') || sevLow.includes('baja') || sevLow.includes('low') || sevLow.includes('trivial')) {
      sevBg = '#E3FCEF';
      sevColor = '#006644';
      sevBorder = '#ABF5D1';
    }

    // Dates & Aging
    const createdDate = b.created || selectedBug.created;
    const resDate = b.resolutiondate || selectedBug.resolutiondate;
    const { dateStr, timeStr } = formatBugCreatedDate(createdDate);
    const age = formatBugAge(createdDate, resDate, isDone);

    const badgeColor = age.tone === 'red' ? '#FFEBE6' : age.tone === 'orange' ? '#FFF0B3' : age.tone === 'green' ? '#E3FCEF' : '#F1F2F4';
    const textColor = age.tone === 'red' ? '#BF2600' : age.tone === 'orange' ? '#172B4D' : age.tone === 'green' ? '#006644' : '#44546F';

    // Due Date
    const dueDateStr = b.duedate || selectedBug.duedate || null;
    let formattedDueDate = null;
    let isDueDateFlagged = false;

    if (dueDateStr) {
      try {
        const d = new Date(dueDateStr);
        if (!isNaN(d.getTime())) {
          formattedDueDate = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
          const statusLower = String(rawStatus).toLowerCase();
          const isInProgress = statusLower.includes('curso') || statusLower.includes('progress') || statusLower.includes('progreso') || statusLower.includes('desarrollo') || statusLower.includes('testing') || statusLower.includes('atención');
          const isOverdue = d.getTime() < Date.now() && !isDone;
          if (isInProgress || isOverdue) {
            isDueDateFlagged = true;
          }
        }
      } catch (e) {}
    }

    // Versions
    let versionsList = [];
    if (Array.isArray(b.versions) && b.versions.length > 0) versionsList = b.versions;
    else if (b.version) versionsList = [b.version];
    else if (Array.isArray(b.fixVersions) && b.fixVersions.length > 0) versionsList = b.fixVersions;

    // Attachments
    const attachments = b.attachments || [];
    const imageAttachments = attachments.filter(a => a.isImage);
    const videoAttachments = attachments.filter(a => a.isVideo);
    const otherAttachments = attachments.filter(a => !a.isImage && !a.isVideo);

    // Comments
    const comments = b.comments || [];

    // Description HTML (clean and mapped with attachments)
    let descHtml = '';
    if (b.descriptionRaw) {
      descHtml = sanitizeRenderedHtml(adfToHtml(b.descriptionRaw, attachments));
    } else if (b.descriptionRendered) {
      descHtml = sanitizeRenderedHtml(b.descriptionRendered);
    } else if (selectedBug.description) {
      descHtml = sanitizeRenderedHtml(adfToHtml(selectedBug.description, attachments));
    }

    return (
      <div 
        className="jira-modal-overlay"
        onClick={() => setSelectedBug(null)}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(9, 30, 66, 0.54)',
          backdropFilter: 'blur(2px)',
          zIndex: 1050,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'fadeIn 0.15s ease-out'
        }}
      >
        <div 
          className="jira-modal-content"
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: '1380px',
            width: '95%',
            height: '90vh',
            minHeight: '640px',
            maxHeight: '920px',
            backgroundColor: '#FFFFFF',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 32px -8px rgba(9, 30, 66, 0.25), 0 0 1px rgba(9, 30, 66, 0.31)',
            overflow: 'hidden'
          }}
        >
          {/* Header */}
          <div style={{
            padding: '1rem 1.5rem',
            borderBottom: '1px solid #DCDFE4',
            backgroundColor: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ 
                backgroundColor: '#FFEBE6', 
                color: '#DE350B', 
                padding: '3px 8px', 
                borderRadius: '4px', 
                fontSize: '11px', 
                fontWeight: 700, 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '4px',
                border: '1px solid #FFBDAD'
              }}>
                🐞 DEFECTO / BUG
              </span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#0C66E4' }}>
                {bugKey}
              </span>
              <span className={`ads-lozenge ${isDone ? 'ads-lozenge-success' : 'ads-lozenge-current'}`} style={{ fontSize: '11px', fontWeight: 600 }}>
                {rawStatus}
              </span>
              {selectedBugLoading && (
                <span style={{ fontSize: '11px', color: '#626F86', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="spinner-border spinner-border-sm" style={{ width: '12px', height: '12px', border: '2px solid #0C66E4', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                  Cargando detalles...
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn-primary"
                onClick={() => router.open('/browse/' + bugKey)}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                title="Abrir este defecto directamente en la vista nativa de Jira"
              >
                <span>Abrir en Jira</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
              </button>
              <button
                className="btn-icon"
                onClick={() => setSelectedBug(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '4px', color: '#626F86', fontSize: '16px', lineHeight: 1 }}
                title="Cerrar modal"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Modal Main Body (2 Columns) */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Columna Izquierda / Principal (65%) */}
            <div style={{ flex: 1, minWidth: 0, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Resumen / Título */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                  Resumen del Bug
                </div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', margin: 0, lineHeight: 1.35 }}>
                  {summary}
                </h2>
              </div>

              {/* Detalle o Descripción del Bug */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #F1F2F4', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    📝 Descripción &amp; Pasos de Reproducción
                  </span>
                </div>

                {selectedBugLoading && !descHtml ? (
                  <div style={{ padding: '1.5rem', background: '#F8FAFD', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ height: '14px', width: '85%', background: '#E9F2FF', borderRadius: '4px', animation: 'pulse 1.2s infinite' }} />
                    <div style={{ height: '14px', width: '60%', background: '#E9F2FF', borderRadius: '4px', animation: 'pulse 1.2s infinite' }} />
                    <div style={{ height: '14px', width: '75%', background: '#E9F2FF', borderRadius: '4px', animation: 'pulse 1.2s infinite' }} />
                  </div>
                ) : descHtml ? (
                  <div 
                    style={{ 
                      padding: '1rem', 
                      background: '#FAFBFC', 
                      border: '1px solid #EBECF0', 
                      borderRadius: '6px', 
                      fontSize: '13px', 
                      lineHeight: '1.6', 
                      color: 'var(--jira-dark, #172B4D)',
                      overflowX: 'auto'
                    }}
                    dangerouslySetInnerHTML={{ __html: descHtml }}
                  />
                ) : (
                  <div style={{ padding: '1.25rem', background: '#F8FAFD', border: '1px dashed #DCDFE4', borderRadius: '6px', fontSize: '12px', color: '#626F86', fontStyle: 'italic', textAlign: 'center' }}>
                    Este defecto no cuenta con descripción de texto registrada en Jira.
                  </div>
                )}
              </div>

              {/* Imágenes, Videos & Evidencias Adjuntas */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #F1F2F4', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🖼️ Evidencias &amp; Archivos Adjuntos ({attachments.length})
                  </span>
                </div>

                {attachments.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Galería de Imágenes */}
                    {imageAttachments.length > 0 && (
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '6px' }}>
                          Imágenes ({imageAttachments.length}):
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                          {imageAttachments.map(att => (
                            <BugAttachmentImageCard
                              key={att.id}
                              att={att}
                              onPreview={handlePreviewEvidence}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Videos Adjuntos */}
                    {videoAttachments.length > 0 && (
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '6px' }}>
                          Videos &amp; Grabaciones ({videoAttachments.length}):
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
                          {videoAttachments.map(att => (
                            <div
                              key={att.id}
                              onClick={() => handlePreviewEvidence(att)}
                              style={{
                                border: '1px solid #DCDFE4',
                                borderRadius: '6px',
                                overflow: 'hidden',
                                background: '#FFFFFF',
                                padding: '8px',
                                cursor: 'pointer',
                                transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 8px rgba(9,30,66,0.12)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                              title="Clic para reproducir video en pantalla completa"
                            >
                              <div style={{ height: '110px', backgroundColor: '#091E42', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', color: '#FFF' }}>
                                <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', marginBottom: '4px' }}>
                                  ▶
                                </div>
                                <span style={{ fontSize: '11px', fontWeight: 600 }}>Reproducir Video</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px' }}>
                                <span style={{ fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }} title={att.filename}>
                                  🎥 {att.filename}
                                </span>
                                <span style={{ color: '#626F86', fontSize: '10px' }}>
                                  {formatFileSize(att.size)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Otros Documentos / Logs */}
                    {otherAttachments.length > 0 && (
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#626F86', marginBottom: '6px' }}>
                          Otros Archivos &amp; Logs ({otherAttachments.length}):
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {otherAttachments.map(att => (
                            <div
                              key={att.id}
                              onClick={() => handlePreviewEvidence(att)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 10px',
                                background: '#F4F5F7',
                                border: '1px solid #DCDFE4',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                color: '#0C66E4',
                                fontSize: '12px',
                                fontWeight: 600
                              }}
                              title="Clic para previsualizar o descargar"
                            >
                              <span>📄</span>
                              <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.filename}</span>
                              <span style={{ color: '#626F86', fontSize: '10px', fontWeight: 400 }}>({formatFileSize(att.size)})</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: '0.85rem 1rem', background: '#F8FAFD', border: '1px dashed #DCDFE4', borderRadius: '6px', fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>
                    Sin evidencias ni archivos adjuntos registrados.
                  </div>
                )}
              </div>

              {/* Historial de Comentarios (Último Primero) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #F1F2F4', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    💬 Historial de Comentarios ({comments.length})
                  </span>
                  <span style={{ fontSize: '11px', color: '#626F86' }}>
                    Ordenado por el más reciente
                  </span>
                </div>

                {comments.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {comments.map((comm) => {
                      const commDate = formatBugCreatedDate(comm.created);
                      const commBodyHtml = sanitizeRenderedHtml(comm.bodyRendered || adfToHtml(comm.bodyRaw, attachments));

                      return (
                        <div
                          key={comm.id}
                          style={{
                            border: '1px solid #EBECF0',
                            borderRadius: '8px',
                            padding: '10px 14px',
                            backgroundColor: '#FFFFFF',
                            boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)'
                          }}
                        >
                          {/* Comment Header */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {comm.author.avatarUrl ? (
                                <img
                                  src={comm.author.avatarUrl}
                                  alt={comm.author.displayName}
                                  style={{ width: '22px', height: '22px', borderRadius: '50%' }}
                                />
                              ) : (
                                <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#0C66E4', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>
                                  {(comm.author.displayName || 'U').charAt(0).toUpperCase()}
                                </div>
                              )}
                              <span style={{ fontSize: '12px', fontWeight: 700, color: '#172B4D' }}>
                                {comm.author.displayName}
                              </span>
                            </div>
                            <span style={{ fontSize: '11px', color: '#626F86' }}>
                              📅 {commDate.dateStr} {commDate.timeStr && `a las ${commDate.timeStr}`}
                            </span>
                          </div>

                          {/* Comment Body */}
                          <div
                            style={{ fontSize: '12.5px', lineHeight: '1.5', color: '#172B4D', paddingLeft: '30px' }}
                            dangerouslySetInnerHTML={{ __html: commBodyHtml }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '1rem', background: '#F8FAFD', border: '1px dashed #DCDFE4', borderRadius: '6px', fontSize: '12px', color: '#626F86', fontStyle: 'italic', textAlign: 'center' }}>
                    No hay comentarios registrados en este defecto.
                  </div>
                )}
              </div>
            </div>

            {/* Columna Derecha / Panel Lateral de Metadatos (35%) */}
            <div style={{ width: '320px', flexShrink: 0, borderLeft: '1px solid #DCDFE4', backgroundColor: '#F8FAFD', padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#172B4D', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #DCDFE4', paddingBottom: '6px' }}>
                Detalles &amp; Metadatos
              </div>

              {/* 1. Persona Asignada */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  👤 PERSONA ASIGNADA
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FFFFFF', padding: '6px 10px', borderRadius: '6px', border: '1px solid #EBECF0' }}>
                  {b.assignee?.avatarUrl ? (
                    <img src={b.assignee.avatarUrl} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: b.assignee ? '#0C66E4' : '#626F86', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>
                      {(b.assignee?.displayName || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.assignee?.displayName || 'Sin asignar'}
                    </span>
                    {b.assignee?.email && (
                      <span style={{ fontSize: '10px', color: '#626F86', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.assignee.email}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 2. Informador (Reporter) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  📣 INFORMADOR / REPORTER
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FFFFFF', padding: '6px 10px', borderRadius: '6px', border: '1px solid #EBECF0' }}>
                  {b.reporter?.avatarUrl ? (
                    <img src={b.reporter.avatarUrl} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#6554C0', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>
                      {(b.reporter?.displayName || 'R').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.reporter?.displayName || 'Sin especificar'}
                  </span>
                </div>
              </div>

              {/* 3. Severidad (en colores) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  🚨 SEVERIDAD
                </div>
                <div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: sevBg,
                      color: sevColor,
                      border: `1px solid ${sevBorder}`,
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 700,
                      textTransform: 'uppercase'
                    }}
                  >
                    <span>●</span> {sevNormalized}
                  </span>
                </div>
              </div>

              {/* 4. Versiones Afectadas */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  🏷️ VERSIONES AFECTADAS
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {versionsList.length > 0 ? (
                    versionsList.map((ver, idx) => (
                      <span
                        key={idx}
                        className="ads-lozenge ads-lozenge-subtle"
                        style={{ fontSize: '11px', fontWeight: 600 }}
                      >
                        🏷️ {ver}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>
                      Sin versión asignada
                    </span>
                  )}
                </div>
              </div>

              {/* 5. Tiempo Abierto / Transcurrido (Aging laboral con semáforo) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  ⏱️ TIEMPO TRANSCURRIDO (AGING LABORAL)
                </div>
                <div
                  style={{
                    background: badgeColor,
                    color: textColor,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    border: `1px solid ${textColor}30`
                  }}
                >
                  <span>⏱️</span>
                  <span>{age.label}</span>
                </div>
              </div>

              {/* 6. Fecha de Solución Estimada (DueDate) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  📅 FECHA ESTIMADA DE SOLUCIÓN
                </div>
                {formattedDueDate ? (
                  isDueDateFlagged ? (
                    <div
                      style={{
                        background: '#FFEBE6',
                        border: '1px solid #FF8F73',
                        color: '#BF2600',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <span style={{ fontSize: '14px' }}>🚩</span>
                      <div>
                        <div>{formattedDueDate}</div>
                        <div style={{ fontSize: '9.5px', textTransform: 'uppercase', opacity: 0.9 }}>
                          {rawStatus.toUpperCase()} • EN ATENCIÓN
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#172B4D', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span>📅</span> <span>{formattedDueDate}</span>
                    </div>
                  )
                ) : (
                  <div style={{ fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>
                    No definida en Jira
                  </div>
                )}
              </div>

              {/* 7. Ambiente (Environment) */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', marginBottom: '4px' }}>
                  🌐 AMBIENTE / ENTORNO
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {b.environment ? (
                    <span
                      style={{
                        background: '#E9F2FF',
                        color: '#0C66E4',
                        border: '1px solid #85B8FF',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 700
                      }}
                      dangerouslySetInnerHTML={{ __html: typeof b.environment === 'string' ? b.environment : adfToHtml(b.environment) }}
                    />
                  ) : (
                    <span style={{ fontSize: '12px', color: '#626F86', fontStyle: 'italic' }}>
                      No especificado
                    </span>
                  )}
                </div>
              </div>

              {/* 8. Fecha de Creación & Resolución */}
              <div style={{ borderTop: '1px solid #EBECF0', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#626F86' }}>
                <div><strong>Registrado:</strong> {dateStr} {timeStr}</div>
                {resDate && <div><strong>Resuelto:</strong> {formatBugCreatedDate(resDate).dateStr}</div>}
                {b.resolution && <div><strong>Resolución:</strong> {b.resolution}</div>}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid #DCDFE4', backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', color: '#626F86' }}>
              Test Pulse QA Engine • Incidencia {bugKey}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button 
                className="btn-secondary"
                onClick={() => setSelectedBug(null)}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.8rem' }}
              >
                Cerrar
              </button>
              <button 
                className="btn-primary"
                onClick={() => router.open('/browse/' + bugKey)}
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

  const handleCycleSelect = async (cycle, forceRefresh = false) => {
    if (!cycle) return;
    const cycleId = String(cycle.id);
    activeCycleIdRef.current = cycleId;
    prevCycleIdRef.current = cycle.id;
    prevRefreshRef.current = refreshTrigger;
    deletedIdsRef.current = new Set(perCycleDeletedRef.current[cycleId] || []);
    setPlanningChecked(new Set()); // clear multi-select
    setExecutionChecked(new Set()); // clear execution multi-select

    const cached = perCycleCacheRef.current[cycleId];
    if (cached && Array.isArray(cached) && !forceRefresh) {
      // ⚡ INSTANT 0 MS TRANSITION FROM MEMORY - NO JUMPING, NO BACKGROUND RESYNC
      setCycleTests(cached);
      setIsLoadingCycleTests(false);
      setTestCycles(prev => prev.map(c => String(c.id) === cycleId ? { ...c, testCount: cached.length } : c));
      setSelectedCycle({ ...cycle, testCount: cached.length });
      return;
    }

    setSelectedCycle(cycle);
    setIsLoadingCycleTests(true);
    setCycleTests([]); // Clear previous cycle items while fetching to avoid jump/mix
    try {
      const executionSummary = await invoke('getCycleExecutionSummary', { cycleId: cycle.id });
      if (activeCycleIdRef.current !== cycleId) return;

      const deletedForCycle = perCycleDeletedRef.current[cycleId] || new Set();
      const enriched = (executionSummary || []).map(ex => {
        if (ex.key && ex.summary) return ex;
        const tc = testCases.find(t => String(t.id) === String(ex.id));
        return tc ? { ...ex, key: tc.key, summary: tc.summary } : ex;
      });
      const filtered = enriched.filter(t => {
        const id = String(t.id || t.testCaseId || '');
        const key = String(t.key || t.testCaseKey || '');
        return !deletedForCycle.has(id) && (!key || !deletedForCycle.has(key));
      });

      // Strict deduplication by testCaseKey / id
      const dedupedMap = new Map();
      filtered.forEach(item => {
        const tcKey = item.testCaseKey || item.key;
        const tcId = String(item.testCaseId || item.id);
        const dKey = tcKey ? `key_${tcKey}` : `id_${tcId}`;
        if (!dedupedMap.has(dKey)) {
          dedupedMap.set(dKey, item);
        } else {
          const existing = dedupedMap.get(dKey);
          const hasExec = item.status && normalizeUiStatus(item.status) !== 'Not Run';
          const existingHasExec = existing.status && normalizeUiStatus(existing.status) !== 'Not Run';
          if (hasExec && !existingHasExec) {
            dedupedMap.set(dKey, item);
          }
        }
      });
      const finalTests = Array.from(dedupedMap.values());

      perCycleCacheRef.current[cycleId] = finalTests;
      if (activeCycleIdRef.current === cycleId) {
        setCycleTests(finalTests);
        setSelectedCycle(prev => (prev && String(prev.id) === cycleId ? { ...prev, testCount: finalTests.length } : prev));
      }
      setTestCycles(prev => prev.map(c => String(c.id) === cycleId ? { ...c, testCount: finalTests.length } : c));
    } catch (err) {
      if (activeCycleIdRef.current === cycleId) {
        addNotification({ type: 'error', title: 'Error cargando casos', description: err.message });
      }
    } finally {
      if (activeCycleIdRef.current === cycleId) {
        setIsLoadingCycleTests(false);
      }
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
    const cycleId = String(selectedCycle.id);
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
        let updated;
        if (!prev.some(existing => String(existing.id) === idStr)) {
            updated = [...prev, locallyAdded];
        } else {
            updated = prev;
        }
        perCycleCacheRef.current[cycleId] = updated;
        setTestCycles(cycles => cycles.map(c => String(c.id) === cycleId ? { ...c, testCount: updated.length } : c));
        setSelectedCycle(c => (c && String(c.id) === cycleId ? { ...c, testCount: updated.length } : c));
        return updated;
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
            setCycleTests(prev => {
              const next = prev.map(t => String(t.id) === idStr ? { ...t, ...addRes.addedTest } : t);
              perCycleCacheRef.current[cycleId] = next;
              return next;
            });
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
                safeSetCycleTests(execution, cycleId);
            }
        }, reloadDelay);
    } catch(err) {
        console.error(err);
        addNotification({ type: 'error', title: 'Error al añadir caso', description: err.message });
        // revert optimistic on error by reloading
        const execution = await invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id });
        safeSetCycleTests(execution || [], cycleId);
    }
  };

  const handleRemoveTestFromCycle = async (testId) => {
    if (!selectedCycle) return;
    const id = String(testId);
    // Optimistic: remove from UI immediately, track to prevent ghost reappear
    const cycleId = String(selectedCycle.id);
    deletedIdsRef.current.add(id);
    if (!perCycleDeletedRef.current[cycleId]) perCycleDeletedRef.current[cycleId] = new Set();
    perCycleDeletedRef.current[cycleId].add(id);
    setPlanningChecked(prev => { const s = new Set(prev); s.delete(id); return s; });
    setCycleTests(prev => {
      const next = prev.filter(t => String(t.id) !== id);
      perCycleCacheRef.current[cycleId] = next;
      setTestCycles(cycles => cycles.map(c => String(c.id) === cycleId ? { ...c, testCount: next.length } : c));
      setSelectedCycle(c => (c && String(c.id) === cycleId ? { ...c, testCount: next.length } : c));
      return next;
    });
    try {
      await invoke('removeTestFromCycle', { cycleId, testId: id });
    } catch (err) {
      // Rollback on error
      deletedIdsRef.current.delete(id);
      perCycleDeletedRef.current[cycleId]?.delete(id);
      addNotification({ type: 'error', title: 'Error al eliminar caso', description: err.message });
      const execution = await invoke('getCycleExecutionSummary', { cycleId }).catch(() => null);
      if (execution) safeSetCycleTests(execution);
    }
  };

  const handleRemoveManyFromCycle = async (testIds) => {
    if (!selectedCycle || !testIds || testIds.length === 0) return;
    const ids = testIds.map(String);
    const cycleId = String(selectedCycle.id);
    // Optimistic: remove all from UI and clear selection
    if (!perCycleDeletedRef.current[cycleId]) perCycleDeletedRef.current[cycleId] = new Set();
    ids.forEach(id => { deletedIdsRef.current.add(id); perCycleDeletedRef.current[cycleId].add(id); });
    setPlanningChecked(new Set());
    setCycleTests(prev => {
      const next = prev.filter(t => !ids.includes(String(t.id)));
      perCycleCacheRef.current[cycleId] = next;
      setTestCycles(cycles => cycles.map(c => String(c.id) === cycleId ? { ...c, testCount: next.length } : c));
      setSelectedCycle(c => (c && String(c.id) === cycleId ? { ...c, testCount: next.length } : c));
      return next;
    });
    try {
      await invoke('removeManyTestsFromCycle', { cycleId, testIds: ids });
      addNotification({ type: 'success', title: `${ids.length} caso${ids.length !== 1 ? 's' : ''} eliminado${ids.length !== 1 ? 's' : ''} del ciclo` });
    } catch (err) {
      // Rollback on error
      ids.forEach(id => { deletedIdsRef.current.delete(id); perCycleDeletedRef.current[cycleId]?.delete(id); });
      addNotification({ type: 'error', title: 'Error al eliminar casos', description: err.message });
      const execution = await invoke('getCycleExecutionSummary', { cycleId }).catch(() => null);
      if (execution) safeSetCycleTests(execution);
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
        description: `Se ${idsArray.length === 1 ? 'movió 1 caso' : `movieron ${idsArray.length} casos`} a ${folderName || (targetFolderId ? 'la carpeta' : 'Sin Carpeta (Raíz)')}.`
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
    const cycleIdStr = String(selectedCycle.id);

    setCycleTests(prev => {
      const updated = prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus, _detailLoaded: true } : t);
      if (perCycleCacheRef.current[cycleIdStr]) {
        perCycleCacheRef.current[cycleIdStr] = updated;
      }
      return updated;
    });

    try {
      const res = await invoke('updateTestStatus', {
        cycleId: selectedCycle.id,
        testId: test.id,
        testRunId: test.testRunId || test.testRunKey,
        iterations: newIterations,
        status: newStatus
      });
      // If backend created/returned a run ID, update local state and cache immediately
      if (res?.test?.testRunId) {
        const newRunId = res.test.testRunId;
        const newRunKey = res.test.testRunKey || test.testRunKey;
        setCycleTests(prev => {
          const updated = prev.map(t => String(t.id) === String(test.id) ? { ...t, testRunId: newRunId, testRunKey: newRunKey, _detailLoaded: true } : t);
          if (perCycleCacheRef.current[cycleIdStr]) {
            perCycleCacheRef.current[cycleIdStr] = updated;
          }
          return updated;
        });
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
    const cycleIdStr = String(selectedCycle.id);

    setCycleTests(prev => {
      const updated = prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus, _detailLoaded: true } : t);
      if (perCycleCacheRef.current[cycleIdStr]) {
        perCycleCacheRef.current[cycleIdStr] = updated;
      }
      return updated;
    });

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

    const isRunning = !!runningTests[test.id];
    const calculated = calculateOverallStatus(newIterations);
    // Si la prueba está en ejecución activa (Play), mantenemos 'In Progress' en la UI para evitar saltos
    const newStatus = isRunning ? 'In Progress' : calculated;
    const cycleIdStr = String(selectedCycle.id);

    setCycleTests(prev => {
      const updated = prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus, _detailLoaded: true } : t);
      if (perCycleCacheRef.current[cycleIdStr]) {
        perCycleCacheRef.current[cycleIdStr] = updated;
      }
      return updated;
    });

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

  const handleStopExecution = async (testIdOrObj, testObj) => {
    const testId = (typeof testIdOrObj === 'object' && testIdOrObj?.id) ? testIdOrObj.id : testIdOrObj;
    setRunningTests(prev => ({ ...prev, [testId]: null }));

    const test = testObj || cycleTests.find(t => String(t.id) === String(testId)) || (typeof testIdOrObj === 'object' ? testIdOrObj : null);
    if (!test || !selectedCycle) return;

    // Consolidar estatus final si tiene iteraciones
    if (test.iterations && test.iterations.length > 0) {
      const finalStatus = calculateOverallStatus(test.iterations);
      const cycleIdStr = String(selectedCycle.id);

      setCycleTests(prev => {
        const updated = prev.map(t => String(t.id) === String(testId) ? { ...t, status: finalStatus, _detailLoaded: true } : t);
        if (perCycleCacheRef.current[cycleIdStr]) {
          perCycleCacheRef.current[cycleIdStr] = updated;
        }
        return updated;
      });

      try {
        await invoke('updateTestStatus', {
          cycleId: selectedCycle.id,
          testId: test.id,
          testRunId: test.testRunId || test.testRunKey,
          iterations: test.iterations,
          status: finalStatus
        });
      } catch (e) {
        console.error('Error consolidating status upon stop:', e);
      }
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

        const cycleIdStr = selectedCycle ? String(selectedCycle.id) : null;
        if (actualIterId) {
          const iters = [...(testItem?.iterations || [])];
          const iterIdx = iters.findIndex(i => i.id === actualIterId);
          if (iterIdx > -1) {
            iters[iterIdx] = {
              ...iters[iterIdx],
              evidences: iters[iterIdx].evidences ? [...iters[iterIdx].evidences, newEvidence] : [newEvidence]
            };
            const cleanEvidences = (testItem?.evidences || []).filter(e => {
              const id = typeof e === 'object' ? String(e.id || '') : String(e || '');
              const name = typeof e === 'object' ? String(e.filename || '') : '';
              return id !== String(newEvidence.id) && (!name || name !== String(newEvidence.filename));
            });
            setCycleTests(prev => {
              const updated = prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: cleanEvidences, iterations: iters, _detailLoaded: true } : t);
              if (cycleIdStr && perCycleCacheRef.current[cycleIdStr]) {
                perCycleCacheRef.current[cycleIdStr] = updated;
              }
              return updated;
            });
            await invoke('updateTestStatus', {
              cycleId: selectedCycle.id,
              testId,
              testRunId: testItem?.testRunId || testItem?.testRunKey,
              iterations: iters,
              evidences: cleanEvidences
            });
          }
        } else {
          const currentEvidences = testItem?.evidences ? [...testItem.evidences] : [];
          if (testItem?.evidence && currentEvidences.length === 0) {
            currentEvidences.push(testItem.evidence);
          }
          currentEvidences.push(newEvidence);

          setCycleTests(prev => {
            const updated = prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences, _detailLoaded: true } : t);
            if (cycleIdStr && perCycleCacheRef.current[cycleIdStr]) {
              perCycleCacheRef.current[cycleIdStr] = updated;
            }
            return updated;
          });
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
    
    let currentTest = cycleTests.find(t => String(t.id) === String(testId));
    if (!currentTest) return;
    const cycleIdStr = selectedCycle ? String(selectedCycle.id) : null;
    
    if (iterId) {
       const iters = [...(currentTest.iterations || [])];
       const iterIdx = iters.findIndex(i => i.id === iterId);
       if (iterIdx > -1) {
          const evs = (iters[iterIdx].evidences || []).filter(e => {
            const eId = typeof e === 'object' ? (e.id || e.url) : e;
            return String(eId) !== String(attachmentId);
          });
          iters[iterIdx] = { ...iters[iterIdx], evidences: evs };
          setCycleTests(prev => {
            const updated = prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: iters, _detailLoaded: true } : t);
            if (cycleIdStr && perCycleCacheRef.current[cycleIdStr]) {
              perCycleCacheRef.current[cycleIdStr] = updated;
            }
            return updated;
          });
          await invoke('updateTestStatus', {
            cycleId: selectedCycle.id,
            testId,
            testRunId: testItem?.testRunId || testItem?.testRunKey,
            iterations: iters
          });
       }
       return;
    }

    let currentEvidences = currentTest.evidences ? [...currentTest.evidences] : [];
    if (currentTest.evidence && currentEvidences.length === 0) {
      currentEvidences.push(currentTest.evidence);
    }
    currentEvidences = currentEvidences.filter(e => e.id !== attachmentId && e !== attachmentId);
    setCycleTests(prev => {
      const updated = prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences, _detailLoaded: true } : t);
      if (cycleIdStr && perCycleCacheRef.current[cycleIdStr]) {
        perCycleCacheRef.current[cycleIdStr] = updated;
      }
      return updated;
    });
    await invoke('updateTestStatus', {
      cycleId: selectedCycle.id,
      testId,
      testRunId: testItem?.testRunId || testItem?.testRunKey,
      evidences: currentEvidences
    });
  };

  
  const handleRenameEvidence = async (testId, index, newName, iterId) => {
    const currentTest = cycleTests.find(t => String(t.id) === String(testId));
    if (!currentTest) return;
    const cycleIdStr = selectedCycle ? String(selectedCycle.id) : null;
    
    if (iterId) {
       const iters = [...(currentTest.iterations || [])];
       const iterIdx = iters.findIndex(i => i.id === iterId);
       if (iterIdx > -1) {
          const evs = iters[iterIdx].evidences ? [...iters[iterIdx].evidences] : [];
          if (typeof evs[index] === 'object') {
             evs[index] = { ...evs[index], filename: newName };
          }
          iters[iterIdx] = { ...iters[iterIdx], evidences: evs };
          setCycleTests(prev => {
            const updated = prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: iters, _detailLoaded: true } : t);
            if (cycleIdStr && perCycleCacheRef.current[cycleIdStr]) {
              perCycleCacheRef.current[cycleIdStr] = updated;
            }
            return updated;
          });
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
    
    setCycleTests(prev => {
      const updated = prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences, evidence: null, _detailLoaded: true } : t);
      if (cycleIdStr && perCycleCacheRef.current[cycleIdStr]) {
        perCycleCacheRef.current[cycleIdStr] = updated;
      }
      return updated;
    });
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

  const handleOpenQrCapture = async (test, iterId, iterName) => {
    try {
      setQrModalLoading(true);
      setQrModalReceived(false);
      setQrModalCopied(false);

      const testItem = typeof test === 'object' ? test : cycleTests.find(t => String(t.id) === String(test));
      const testId = testItem ? testItem.id : test;
      const testCaseKey = testItem?.testCaseKey || testItem?.key || testId;
      const testRunKey = testItem?.testRunKey || testItem?.testRunId || testCaseKey;
      const testRunId = testItem?.testRunId || testItem?.testRunKey || testId;
      const testSummary = testItem?.summary || testItem?.name || 'Caso de Prueba';

      const res = await invoke('createMobileUploadSession', {
        testId,
        testKey: testCaseKey,
        testRunKey,
        testRunId,
        testSummary,
        iterId: iterId || null,
        iterName: iterName || null,
        cycleId: selectedCycle?.id
      });

      if (!res || !res.uploadUrl) {
        throw new Error("No se pudo generar la sesión de carga móvil.");
      }

      const [svg, dataUrl] = await Promise.all([
        generateQrSvg(res.uploadUrl, { size: 280, margin: 4, darkColor: '#000000', lightColor: '#FFFFFF' }),
        generateQrDataUrl(res.uploadUrl, { size: 280, margin: 4, darkColor: '#000000', lightColor: '#FFFFFF' })
      ]);

      setQrModalSession({
        sessionId: res.sessionId,
        uploadUrl: res.uploadUrl,
        testId,
        testKey: testCaseKey,
        testRunKey: res.testRunKey || testRunKey,
        testRunId: res.testRunId || testRunId,
        testSummary,
        iterId: iterId || null,
        iterName: iterName || null,
        svg,
        dataUrl
      });
    } catch (err) {
      console.error('Error opening QR capture:', err);
      addNotification({
        type: 'error',
        title: 'Error al generar código QR',
        description: err.message || String(err)
      });
    } finally {
      setQrModalLoading(false);
    }
  };

  // Polling for QR Mobile Evidence Upload
  useEffect(() => {
    if (!qrModalSession || !qrModalSession.sessionId || qrModalReceived) return;

    const interval = setInterval(async () => {
      try {
        const res = await invoke('checkMobileUploadStatus', { sessionId: qrModalSession.sessionId });
        if (res && res.uploaded && res.evidence) {
          setQrModalReceived(true);
          const newEvidence = {
            id: res.evidence.id,
            filename: res.evidence.filename,
            url: res.evidence.url,
            note: res.evidence.note
          };

          const testId = qrModalSession.testId;
          const iterId = qrModalSession.iterId;
          const testItem = cycleTests.find(t => String(t.id) === String(testId));
          const cycleIdStr = selectedCycle ? String(selectedCycle.id) : null;

          if (iterId) {
            const iters = [...(testItem?.iterations || [])];
            const iterIdx = iters.findIndex(i => i.id === iterId);
            if (iterIdx > -1) {
              iters[iterIdx] = {
                ...iters[iterIdx],
                evidences: iters[iterIdx].evidences ? [...iters[iterIdx].evidences, newEvidence] : [newEvidence]
              };
              const cleanEvidences = (testItem?.evidences || []).filter(e => {
                const id = typeof e === 'object' ? String(e.id || '') : String(e || '');
                const name = typeof e === 'object' ? String(e.filename || '') : '';
                return id !== String(newEvidence.id) && (!name || name !== String(newEvidence.filename));
              });
              setCycleTests(prev => {
                const updated = prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: cleanEvidences, iterations: iters, _detailLoaded: true } : t);
                if (cycleIdStr && perCycleCacheRef.current[cycleIdStr]) {
                  perCycleCacheRef.current[cycleIdStr] = updated;
                }
                return updated;
              });
              await invoke('updateTestStatus', {
                cycleId: selectedCycle?.id,
                testId,
                testRunId: testItem?.testRunId || testItem?.testRunKey,
                iterations: iters,
                evidences: cleanEvidences
              });
            }
          } else {
            const currentEvidences = testItem?.evidences ? [...testItem.evidences] : [];
            if (testItem?.evidence && currentEvidences.length === 0) {
              currentEvidences.push(testItem.evidence);
            }
            currentEvidences.push(newEvidence);

            setCycleTests(prev => {
              const updated = prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences, _detailLoaded: true } : t);
              if (cycleIdStr && perCycleCacheRef.current[cycleIdStr]) {
                perCycleCacheRef.current[cycleIdStr] = updated;
              }
              return updated;
            });

            await invoke('updateTestStatus', {
              cycleId: selectedCycle?.id,
              testId,
              testRunId: testItem?.testRunId || testItem?.testRunKey,
              evidences: currentEvidences
            });
          }

          addNotification({
            type: 'success',
            title: '📸 ¡Evidencia Móvil Recibida!',
            description: `Captura adjuntada a ${qrModalSession.testRunKey || qrModalSession.testRunId || qrModalSession.testKey}.`
          });
        }
      } catch (e) {
        console.warn('[QR Poll] Error checking mobile upload status:', e);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [qrModalSession, qrModalReceived, cycleTests, selectedCycle, addNotification]);

  const handleRunTest = async (testId, testKey, test) => {
    try {
      setRunningTests(prev => ({ ...prev, [testId]: 'active' }));
      if (test) {
        handleTakeover(test).catch(e => console.warn("Takeover non-critical failure:", e));
      }
    } catch (err) {
      console.warn("Error iniciando ejecución de prueba", err);
      setRunningTests(prev => ({ ...prev, [testId]: 'active' }));
    }
  };

  const handlePreviewEvidence = async (ev) => {
    if (!ev) return;
    const id = typeof ev === 'string' ? ev : (ev.id || ev.attachmentId);
    let filename = typeof ev === 'string' ? `evidence_${id}.jpg` : (ev.filename || `evidence_${id}.jpg`);
    const note = (typeof ev === 'object' && ev.note) ? ev.note : null;
    
    // Si no tiene extensión, determinamos según el tipo
    const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(filename);
    const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(filename);
    const isPdf = /\.(pdf)$/i.test(filename);
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(filename);

    if (isPdf) {
      const newWin = window.open('about:blank', '_blank');
      if (newWin) {
        newWin.document.write('<p style="font-family:sans-serif;padding:20px;color:#172B4D;">Cargando documento PDF...</p>');
      }
      try {
        let blobUrl = null;
        const res = await requestJira(`/rest/api/3/attachment/content/${id}`);
        if (res.ok) {
          const blob = await res.blob();
          const pdfBlob = new Blob([blob], { type: 'application/pdf' });
          blobUrl = URL.createObjectURL(pdfBlob);
        } else {
          const data = await invoke('getAttachmentContent', { attachmentId: id });
          if (data && !data.error && data.base64) {
            const byteCharacters = atob(data.base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const pdfBlob = new Blob([byteArray], { type: 'application/pdf' });
            blobUrl = URL.createObjectURL(pdfBlob);
          }
        }
        if (blobUrl) {
          if (newWin) newWin.location.href = blobUrl;
          else {
            const a = document.createElement('a');
            a.href = blobUrl;
            a.target = '_blank';
            a.click();
          }
          return;
        }
      } catch (e) {
        console.error('PDF preview error:', e);
      }
      if (newWin) newWin.close();
      router.open(`/secure/attachment/${id}/${encodeURIComponent(filename)}`);
      return;
    }

    if (isVideo || isImage || !hasExtension) {
      if (!hasExtension && !isVideo) filename += '.png';

      // Limpiar URL Blob anterior si existía
      if (previewModalData && previewModalData.blobUrl) {
        try { URL.revokeObjectURL(previewModalData.blobUrl); } catch(e){}
      }

      setPreviewModalData({ id, filename, note, loading: true });

      try {
        let blobUrl = null;
        let mimeType = isVideo ? 'video/mp4' : 'image/png';

        // 1. Fetch directo en navegador vía requestJira (soporta streaming, archivos grandes y aceleración por HW)
        try {
          const res = await requestJira(`/rest/api/3/attachment/content/${id}`);
          if (res.ok) {
            const blob = await res.blob();
            mimeType = res.headers?.get?.('content-type') || blob.type || (isVideo ? 'video/mp4' : 'image/png');
            blobUrl = URL.createObjectURL(blob);
          }
        } catch (fetchErr) {
          console.warn('requestJira attachment content failed, falling back to backend resolver:', fetchErr);
        }

        // 2. Fallback a resolver backend si requestJira no respondió
        if (!blobUrl) {
          const data = await invoke('getAttachmentContent', { attachmentId: id });
          if (data && !data.error && data.base64) {
            const byteCharacters = atob(data.base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: data.mimeType || (isVideo ? 'video/mp4' : 'image/png') });
            blobUrl = URL.createObjectURL(blob);
            mimeType = data.mimeType || (isVideo ? 'video/mp4' : 'image/png');
          }
        }

        if (blobUrl) {
          setPreviewModalData({
            id,
            filename,
            note,
            loading: false,
            blobUrl,
            mimeType,
            isVideo: isVideo || mimeType.startsWith('video/')
          });
        } else {
          setPreviewModalData({
            id,
            filename,
            note,
            loading: false,
            error: 'No se pudo generar la vista previa directa del archivo.',
            downloadUrl: `/secure/attachment/${id}/${encodeURIComponent(filename)}`
          });
        }
      } catch (err) {
        console.error('Error in handlePreviewEvidence:', err);
        setPreviewModalData({
          id,
          filename,
          note,
          loading: false,
          error: `Error al cargar archivo: ${err.message || String(err)}`,
          downloadUrl: `/secure/attachment/${id}/${encodeURIComponent(filename)}`
        });
      }
    } else {
      router.open(`/secure/attachment/${id}/${encodeURIComponent(filename)}`);
    }
  };

  useEffect(() => {
    window.__previewAttachment = (id, filename) => {
      try {
        const decodedName = filename ? decodeURIComponent(filename) : undefined;
        handlePreviewEvidence({ id, filename: decodedName });
      } catch (e) {
        handlePreviewEvidence({ id, filename });
      }
    };
    return () => {
      delete window.__previewAttachment;
    };
  }, []);

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
    
    try {
      // Check permissions
      const admin = await invoke('checkAdminPermission', { projectId: selectedProjectId });
      setIsAdmin(admin);

      // Get config first
      const config = await invoke('getConfig', { projectId: selectedProjectId });
      if (config) {
        setProjectConfig(config);
      }

      const cfg = config || projectConfig;

      // Load folders, plans, and cycles
      const [foldersRes, plansRes, cyclesRes] = await Promise.allSettled([
        invoke('getFolders', { projectId: selectedProjectId }),
        invoke('getTestPlans', { projectId: selectedProjectId, config: cfg }),
        invoke('getTestCycles', { projectId: selectedProjectId, config: cfg })
      ]);

      if (foldersRes.status === 'fulfilled') setFolders(foldersRes.value || []);
      if (plansRes.status === 'fulfilled') {
        const plans = Array.isArray(plansRes.value) ? plansRes.value : [];
        setTestPlans(plans);
        if (plans.length > 0) {
          setSelectedPlanId(prev => (prev && plans.some(p => String(p.id) === String(prev))) ? prev : plans[0].id);
        }
      }
      if (cyclesRes.status === 'fulfilled') {
        setTestCycles(Array.isArray(cyclesRes.value) ? cyclesRes.value : []);
      }

      // Fetch test cases
      setIsFetchingTests(true);
      const fetchedCases = await fetchAllTestCases({ projectId: selectedProjectId, config: cfg });
      setTestCases(fetchedCases || []);
    } catch (e) {
      console.error("loadProjectData error:", e);
    } finally {
      setIsFetchingTests(false);
      setLoading(false);
    }
  };

  const loadReportData = async (overrideProjectId = null, overrideConfig = null, isSilent = false) => {
    const projId = overrideProjectId || selectedProjectId;
    const cfg = overrideConfig || projectConfig;
    if (!projId) return;
    if (isCircuitBroken()) {
      if (!isSilent) {
        addNotification({ type: 'warning', title: 'Rate limit activo', description: 'Espera unos minutos antes de recargar el reporte.' });
      }
      return;
    }

    const currentSession = ++hydrationSessionRef.current;
    const hasExistingData = reportData && Array.isArray(reportData.cycles) && reportData.cycles.length > 0 && reportData._loadedAt;
    if (!hasExistingData && !isSilent) {
      setReportLoading(true);
    } else {
      setIsRefreshingReport(true);
    }

    try {
      // Phase 1: Rapid load of recent cycles (limit: 8)
      const initialLimit = 8;
      const data = await invoke('getExecutionReport', { 
        projectId: projId, 
        config: cfg, 
        limit: initialLimit, 
        offset: 0 
      });

      if (currentSession !== hydrationSessionRef.current) return;

      const initialCycles = data?.cycles || [];
      const initialBugMap = data?.bugMap || {};
      const totalCycles = data?.totalCycles || initialCycles.length;

      setReportData({
        cycles: initialCycles,
        bugMap: initialBugMap,
        totalCycles: totalCycles,
        _loadedAt: Date.now()
      });

      // Populate or sync testCycles immediately with all known cycle summaries from Jira
      if (data?.allCycleSummaries && Array.isArray(data.allCycleSummaries)) {
        setTestCycles(prev => {
          const prevMap = new Map((prev || []).map(c => [String(c.id), c]));
          return data.allCycleSummaries.map(s => {
            const existing = prevMap.get(String(s.id));
            const loadedCycle = initialCycles.find(ic => String(ic.id) === String(s.id));
            return {
              id: s.id,
              key: s.key,
              summary: s.summary,
              status: existing?.status || 'To Do',
              planId: s.planId || existing?.planId || null,
              testCount: loadedCycle ? (loadedCycle.execution?.length || 0) : (existing?.testCount || 0)
            };
          });
        });
      }

      // Collect all bug keys already linked through Test Pulse
      const linkedBugKeysSet = new Set();
      initialCycles.forEach(cycle => {
        (cycle.execution || []).forEach(ex => {
          (ex.linkedBugs || []).forEach(bug => { if (bug?.key) linkedBugKeysSet.add(bug.key); });
        });
      });
      Object.values(perCycleCacheRef.current || {}).forEach(cachedList => {
        (cachedList || []).forEach(ex => {
          (ex.linkedBugs || []).forEach(bug => { if (bug?.key) linkedBugKeysSet.add(bug.key); });
        });
      });
      const linkedBugKeys = Array.from(linkedBugKeysSet);

      // Fetch unlinked bugs from the current workspace
      const currentProj = projects.find(p => String(p.id) === String(projId) || String(p.key) === String(projId));
      const targetProjectKey = currentProj?.key || (isNaN(projId) ? projId : null);
      invoke('getProjectUnlinkedBugs', {
        projectId: projId,
        projectKey: targetProjectKey,
        linkedBugKeys,
        bugIssueTypes: cfg?.bugIssueTypes || [],
      })
        .then(bugs => setUnlinkedBugs(bugs || []))
        .catch(console.warn);

      // Initial rapid load is finished! UI becomes interactive right away
      setReportLoading(false);
      setIsRefreshingReport(false);

      // Phase 2: Silent background hydration of historical cycles
      if (data?.hasMore && data.nextOffset < totalCycles) {
        setIsHydratingReport(true);
        setHydrationProgress({ loaded: initialCycles.length, total: totalCycles });

        (async () => {
          let currentOffset = data.nextOffset;
          const batchLimit = 10;
          let keepHydrating = true;

          while (keepHydrating && currentSession === hydrationSessionRef.current) {
            try {
              const batchData = await invoke('getExecutionReport', {
                projectId: projId,
                config: cfg,
                limit: batchLimit,
                offset: currentOffset
              });

              if (currentSession !== hydrationSessionRef.current) break;

              if (batchData?.cycles && Array.isArray(batchData.cycles)) {
                setReportData(prev => {
                  const existingCycles = prev?.cycles || [];
                  const existingMap = new Map(existingCycles.map(c => [String(c.id), c]));
                  batchData.cycles.forEach(c => {
                    existingMap.set(String(c.id), c);
                  });
                  const mergedCycles = Array.from(existingMap.values());
                  const mergedBugMap = { ...(prev?.bugMap || {}), ...(batchData.bugMap || {}) };

                  setHydrationProgress({ loaded: mergedCycles.length, total: totalCycles });
                  return {
                    ...prev,
                    cycles: mergedCycles,
                    bugMap: mergedBugMap,
                    _loadedAt: Date.now()
                  };
                });

                // Update testCounts in testCycles
                setTestCycles(prev => (prev || []).map(c => {
                  const found = batchData.cycles.find(bc => String(bc.id) === String(c.id));
                  if (found && Array.isArray(found.execution)) {
                    return { ...c, testCount: found.execution.length };
                  }
                  return c;
                }));
              }

              if (batchData?.hasMore && batchData.nextOffset < totalCycles) {
                currentOffset = batchData.nextOffset;
              } else {
                keepHydrating = false;
              }
            } catch (batchErr) {
              console.warn('[loadReportData] Background hydration chunk warning:', batchErr);
              keepHydrating = false;
            }
          }

          if (currentSession === hydrationSessionRef.current) {
            setIsHydratingReport(false);
          }
        })();
      }
    } catch(err) {
      console.error("loadReportData error:", err);
      if (err?.message?.includes('429') || err?.status === 429) tripCircuitBreaker();
      setReportData(prev => {
        if (!prev || !prev.cycles || prev.cycles.length === 0) {
          return { ...prev, _loadError: true };
        }
        return prev;
      });
      if (!isSilent) {
        addNotification({
          type: 'warning',
          title: 'Sincronización de métricas',
          description: 'Jira tardó en responder. Mostrando los datos actuales disponibles.'
        });
      }
    } finally {
      setReportLoading(false);
      setIsRefreshingReport(false);
    }
  };

  const prevCycleIdRef = useRef(null);
  const prevRefreshRef = useRef(null);

  // Auto-preload all cycles of selected test plan in background
  useEffect(() => {
    if (!selectedPlanId || !testCycles || testCycles.length === 0) return;
    const planCycles = testCycles.filter(c => String(c.planId) === String(selectedPlanId));
    if (planCycles.length === 0) return;

    // If no cycle selected or selected cycle doesn't belong to this plan, select first cycle
    if (!selectedCycle || !planCycles.some(c => String(c.id) === String(selectedCycle.id))) {
      handleCycleSelect(planCycles[0]);
    }
  }, [selectedPlanId, testCycles.length]);

  useEffect(() => {
    if ((activeTab === 'execution' || activeTab === 'planning') && selectedCycle) {
      const cycleId = String(selectedCycle.id);

      // If we have cached tests and no explicit refresh requested, use cache immediately
      const cached = perCycleCacheRef.current[cycleId];
      if (cached && prevCycleIdRef.current === selectedCycle.id && prevRefreshRef.current === refreshTrigger) {
        return;
      }
      if (cached && prevRefreshRef.current === refreshTrigger) {
        prevCycleIdRef.current = selectedCycle.id;
        setCycleTests(cached);
        setIsLoadingCycleTests(false);
        return;
      }
      
      prevCycleIdRef.current = selectedCycle.id;
      prevRefreshRef.current = refreshTrigger;

      // Use getCycleExecutionSummary instead of full getCycleExecution
      setIsLoadingCycleTests(true);
      invoke('getCycleExecutionSummary', { cycleId: selectedCycle.id })
        .then(async (executionSummary) => {
          if (activeCycleIdRef.current !== cycleId) return;

          if (!executionSummary || executionSummary.length === 0) {
            perCycleCacheRef.current[cycleId] = [];
            setCycleTests([]); // direct set
            setTestCycles(prev => prev.map(c => String(c.id) === cycleId ? { ...c, testCount: 0 } : c));
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
          const deletedForCycle = perCycleDeletedRef.current[cycleId] || (selectedCycle ? perCycleDeletedRef.current[String(selectedCycle.id)] : null) || new Set();
          const filteredEnriched = enriched.filter(t => {
            const id = String(t.id || t.testCaseId || '');
            const key = String(t.key || t.testCaseKey || '');
            return !deletedForCycle.has(id) && (!key || !deletedForCycle.has(key));
          });
          
          // Preserve exact order as added / linked
          perCycleCacheRef.current[cycleId] = filteredEnriched;
          if (activeCycleIdRef.current === cycleId) {
            setCycleTests(filteredEnriched);
          }
          setTestCycles(prev => prev.map(c => String(c.id) === cycleId ? { ...c, testCount: filteredEnriched.length } : c));
        })
        .finally(() => {
          if (activeCycleIdRef.current === cycleId) {
            setIsLoadingCycleTests(false);
          }
        });
    } else if (activeTab === 'reports') {
      if (!reportData._loadedAt || !reportData.cycles || reportData.cycles.length === 0) {
        loadReportData(null, null, false);
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
    const cleanKey = (bugKey || '').trim().toUpperCase();
    if (!cleanKey) return;

    // 1. Avoid duplicates
    const currentBugs = test.linkedBugs || [];
    if (currentBugs.some(b => b.key === cleanKey)) return;

    // 2. Validate against Jira and create Issue Link
    try {
      const res = await invoke('linkBugToTest', { testCaseId: test.id, bugKey: cleanKey });
      if (res && res.success === false) {
        addNotification({
          type: 'error',
          title: 'Incidencia no válida',
          description: res.error || `La clave "${cleanKey}" no existe en Jira.`
        });
        return;
      }

      const verifiedBug = res?.bug || { key: cleanKey };
      const updatedBugs = [...currentBugs, verifiedBug];

      // 3. Update UI
      setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, linkedBugs: updatedBugs } : t));

      // 4. Save in background
      await invoke('updateTestStatus', {
        cycleId: selectedCycle.id,
        testId: test.id,
        testRunId: test?.testRunId || test?.testRunKey,
        linkedBugs: updatedBugs
      });

      addNotification({
        type: 'success',
        title: '✅ Defecto Vinculado',
        description: `Incidencia ${cleanKey} vinculada correctamente.`
      });
    } catch (err) {
      console.error('Error linking bug:', err);
      // Rollback on error
      setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, linkedBugs: currentBugs } : t));
      addNotification({
        type: 'error',
        title: 'Error al vincular defecto',
        description: err.message || 'No se pudo vincular la incidencia.'
      });
    }
  };

  const handleConfirmLinkUnlinkedBug = async () => {
    if (!linkingUnlinkedBug || !targetCycleForBug || !targetTestForBug) {
      addNotification({
        type: 'warning',
        title: 'Selección incompleta',
        description: 'Por favor selecciona un ciclo y un caso de prueba para vincular el defecto.'
      });
      return;
    }

    const bugKey = linkingUnlinkedBug.key;
    const cycle = testCycles.find(c => String(c.id) === String(targetCycleForBug));
    const targetTc = testCases.find(t => String(t.id) === String(targetTestForBug));

    setIsLinkingUnlinkedBugLoading(true);
    try {
      // 1. Link in Jira Issue Link
      const res = await invoke('linkBugToTest', { testCaseId: targetTestForBug, bugKey });
      if (res && res.success === false) {
        addNotification({
          type: 'error',
          title: 'Incidencia no encontrada',
          description: res.error || `La clave "${bugKey}" no existe en Jira.`
        });
        setIsLinkingUnlinkedBugLoading(false);
        return;
      }

      const bugData = res?.bug || linkingUnlinkedBug;

      // 2. Update cycle execution status with the linked bug
      const reportCycle = (reportData.cycles || []).find(rc => String(rc.id) === String(targetCycleForBug));
      const existingEx = reportCycle?.execution?.find(e => String(e.id) === String(targetTestForBug));
      const currentLinkedBugs = existingEx?.linkedBugs || [];
      const updatedLinkedBugs = currentLinkedBugs.some(b => b.key === bugKey)
        ? currentLinkedBugs
        : [...currentLinkedBugs, { 
            key: bugKey, 
            summary: bugData.summary || linkingUnlinkedBug.summary, 
            severity: bugData.severity || linkingUnlinkedBug.severity, 
            status: bugData.status || linkingUnlinkedBug.status,
            version: bugData.version || linkingUnlinkedBug.version || 'Sin versión',
            versions: bugData.versions || linkingUnlinkedBug.versions || [],
            fixVersions: bugData.fixVersions || linkingUnlinkedBug.fixVersions || [],
            created: bugData.created || linkingUnlinkedBug.created,
            resolutiondate: bugData.resolutiondate || linkingUnlinkedBug.resolutiondate
          }];

      await invoke('updateTestStatus', {
        cycleId: targetCycleForBug,
        testId: targetTestForBug,
        testRunId: existingEx?.testRunId || existingEx?.testRunKey,
        linkedBugs: updatedLinkedBugs
      });

      // 3. Optimistic local update: mark as linked in unlinkedBugs state
      setUnlinkedBugs(prev => (prev || []).map(b => b.key === bugKey ? { ...b, isLinked: true } : b));

      // 4. Update reportData state
      setReportData(prev => {
        const nextCycles = (prev.cycles || []).map(c => {
          if (String(c.id) !== String(targetCycleForBug)) return c;
          const nextExec = (c.execution || []).map(ex => {
            if (String(ex.id) !== String(targetTestForBug)) return ex;
            return {
              ...ex,
              linkedBugs: updatedLinkedBugs
            };
          });
          return { ...c, execution: nextExec };
        });
        const nextBugMap = {
          ...(prev.bugMap || {}),
          [bugKey]: {
            ...bugData,
            key: bugKey
          }
        };
        return { ...prev, cycles: nextCycles, bugMap: nextBugMap };
      });

      addNotification({
        type: 'success',
        title: '✅ Defecto Vinculado',
        description: `El defecto ${bugKey} fue vinculado con éxito al caso ${targetTc?.key || targetTestForBug} en el ciclo ${cycle?.summary || targetCycleForBug}.`
      });

      setLinkingUnlinkedBug(null);
      setTargetCycleForBug('');
      setTargetTestForBug('');
    } catch (err) {
      console.error('Error linking unlinked bug:', err);
      addNotification({
        type: 'error',
        title: 'Error al vincular defecto',
        description: err.message || 'No se pudo completar la vinculación en Jira.'
      });
    } finally {
      setIsLinkingUnlinkedBugLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const s = normalizeUiStatus(status);
    switch(s) {
      case 'Passed': return 'var(--success-bg, #DCFFF1)';
      case 'Failed': return 'var(--danger-bg, #FFEBE6)';
      case 'Blocked': return '#FFF0B3';
      case 'In Progress': return '#DEEBFF';
      case 'Not Run':
      default: return '#F1F2F4';
    }
  };

  const getStatusTextColor = (status) => {
    const s = normalizeUiStatus(status);
    switch(s) {
      case 'Passed': return 'var(--success-color, #216E4E)';
      case 'Failed': return 'var(--danger-color, #BF2600)';
      case 'Blocked': return '#172B4D'; 
      case 'In Progress': return '#0747A6';
      case 'Not Run':
      default: return '#44546F'; 
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
    // Deduplicate cycleTests strictly by test case key and ID
    const uniqueCycleTestsMap = new Map();
    for (const test of cycleTests) {
      const tcKey = test.testCaseKey || test.key;
      const tcId = String(test.testCaseId || test.id);
      const dedupeKey = tcKey ? `key_${tcKey}` : `id_${tcId}`;
      if (!uniqueCycleTestsMap.has(dedupeKey)) {
        uniqueCycleTestsMap.set(dedupeKey, test);
      } else {
        const existing = uniqueCycleTestsMap.get(dedupeKey);
        const hasExec = test.status && normalizeUiStatus(test.status) !== 'Not Run';
        const existingHasExec = existing.status && normalizeUiStatus(existing.status) !== 'Not Run';
        if (hasExec && !existingHasExec) {
          uniqueCycleTestsMap.set(dedupeKey, test);
        }
      }
    }
    const deduplicatedCycleTests = Array.from(uniqueCycleTestsMap.values());

    const totalInProject = testCases.length;
    const inCycleCount = selectedCycle ? deduplicatedCycleTests.length : 0;
    const notInCycleCount = totalInProject > inCycleCount ? totalInProject - inCycleCount : 0;
    const missingPct = totalInProject > 0 ? Math.round((notInCycleCount / totalInProject) * 100) : 0;
    const cycleProgressPct = totalInProject > 0 ? ((inCycleCount / totalInProject) * 100).toFixed(1) : '0.0';
    const currentPlan = testPlans.find(p => String(p.id) === String(selectedPlanId));

    const filteredCycleTests = deduplicatedCycleTests.filter(test => 
      !searchQuery || 
      test.key?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      test.summary?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (testCases.find(t => String(t.id) === String(test.id))?.summary || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const cycleTestIds = new Set(deduplicatedCycleTests.map(ct => String(ct.id)));
    const cycleTestKeys = new Set(deduplicatedCycleTests.map(ct => ct.testCaseKey || ct.key).filter(Boolean));

    const availableFilteredTestCases = testCases.filter(tc => 
      (planningFolder === '' || tc.folderId === planningFolder) &&
      (planningPriority === '' || tc.rawFields?.priority?.name === planningPriority) &&
      (planningExecutionType === '' || (planningExecutionType.toLowerCase() === 'manual' ? getExecVal(tc).includes('man') : getExecVal(tc).includes('auto'))) &&
      !cycleTestIds.has(String(tc.id)) &&
      (!tc.key || !cycleTestKeys.has(tc.key)) &&
      (!searchQuery || tc.key?.toLowerCase().includes(searchQuery.toLowerCase()) || tc.summary?.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
      <div className="tab-layout" style={{ height: '100%', overflow: 'hidden' }}>
        {/* Left Planning Sidebar (Test Plans & Cycles) */}
        {isFolderSidebarVisible && (
          <>
            <aside className="planning-sidebar" style={{ width: sidebarWidth, flexShrink: 0 }}>
              <div className="planning-sidebar-header">
                <div className="planning-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>TEST PLANS</span>
                    <button 
                      onClick={handleCreateIssue}
                      style={{ background: 'none', border: 'none', color: 'var(--jira-blue, #0C66E4)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                    >
                      + Nuevo
                    </button>
                  </div>
                  <button
                    onClick={toggleFolderSidebar}
                    title="Ocultar panel lateral (Sidebar)"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '3px',
                      borderRadius: '4px',
                      color: 'var(--jira-subtle, #626F86)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--jira-bg-subtle, #F1F2F4)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                      <path d="M15 15l-3-3 3-3" />
                    </svg>
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
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                            </svg>
                            <span style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isActive ? 600 : 500 }}>
                              {cycle.summary}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
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
                                borderRadius: '4px'
                              }}
                              title="Remover ciclo del plan"
                            >
                              - Remove
                            </button>
                          </div>
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
                      <div key={cycle.id} className="planning-cycle-available-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#626F86" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <circle cx="12" cy="12" r="9"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                          </svg>
                          <span style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#172B4D', fontWeight: 500 }}>
                            {cycle.summary}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
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
                              cursor: 'pointer'
                            }}
                          >
                            + Add
                          </button>
                        </div>
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
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}
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
              onClick={() => setIsCreateCycleOpen(true)}
              className="btn-secondary"
              style={{ width: '100%', justifyContent: 'center', fontSize: '12px', height: '32px' }}
            >
              + Nuevo Ciclo de Prueba
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
        </>
        )}

        {/* Main Workspace */}
        <main className="planning-workspace">
          <div className="planning-scroll-container">
            {selectedCycle ? (
              <div className="planning-canvas">
                {/* Workspace Header & Action */}
                <div className="planning-workspace-header">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      {!isFolderSidebarVisible && (
                        <button
                          onClick={toggleFolderSidebar}
                          className="btn-secondary"
                          title="Mostrar panel de planes y ciclos"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: '0.78rem',
                            padding: '0.35rem 0.65rem',
                            borderRadius: '6px'
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <line x1="9" y1="3" x2="9" y2="21" />
                            <path d="M13 9l3 3-3 3" />
                          </svg>
                          <span>Planes &amp; Ciclos</span>
                        </button>
                      )}
                      <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#172B4D', letterSpacing: '-0.01em' }}>
                        Planning: <span style={{ color: '#0C66E4' }}>{selectedCycle.summary}</span>
                      </h1>
                      <span style={{ fontSize: '11px', fontWeight: 600, background: '#E9F2FF', color: '#0C66E4', padding: '2px 8px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {isLoadingCycleTests ? (
                          <>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1.5px solid #0C66E4', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                            <span>Sincronizando...</span>
                          </>
                        ) : (
                          `${deduplicatedCycleTests.length} casos en ciclo`
                        )}
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
                      <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#172B4D', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>Tests in this Cycle</span>
                        {isLoadingCycleTests ? (
                          <span style={{ fontSize: '11px', fontWeight: 500, color: '#626F86' }}>(Sincronizando...)</span>
                        ) : (
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#626F86' }}>({deduplicatedCycleTests.length})</span>
                        )}
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
                              const t = deduplicatedCycleTests.find(ct => String(ct.id) === String(id));
                              return t && t.status && normalizeUiStatus(t.status) !== 'Not Run';
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
                      {deduplicatedCycleTests.length > 0 && (
                        <button 
                          className="btn-secondary" 
                          style={{ color: '#CA3521', height: '28px', fontSize: '11px', fontWeight: 600, padding: '0 8px' }}
                          onClick={() => {
                            const allIds = deduplicatedCycleTests.map(t => t.id);
                            const executedCount = deduplicatedCycleTests.filter(t => t.status && normalizeUiStatus(t.status) !== 'Not Run').length;
                            const msg = executedCount > 0
                              ? `¿Remover TODOS los ${deduplicatedCycleTests.length} casos del ciclo? (${executedCount} caso${executedCount !== 1 ? 's' : ''} cuentan con ejecuciones que quedarán preservadas de forma segura en Jira).`
                              : `¿Eliminar TODOS los ${deduplicatedCycleTests.length} casos del ciclo?`;
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
                  {deduplicatedCycleTests.length > 0 && (
                    <div className="planning-panel-subbar">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={planningChecked.size > 0 && planningChecked.size === deduplicatedCycleTests.length}
                          ref={el => { if (el) el.indeterminate = planningChecked.size > 0 && planningChecked.size < deduplicatedCycleTests.length; }}
                          onChange={e => {
                            if (e.target.checked) setPlanningChecked(new Set(deduplicatedCycleTests.map(t => String(t.id))));
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
                    {isLoadingCycleTests ? (
                      <div style={{ padding: '3rem 2rem', textAlign: 'center', color: '#626F86', fontSize: '13px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '22px', height: '22px', borderRadius: '50%', border: '2px solid #DCDFE4', borderTopColor: '#0C66E4', animation: 'spin 0.8s linear infinite' }}></div>
                        <span style={{ fontWeight: 500, color: '#172B4D' }}>Cargando casos del ciclo...</span>
                        <span style={{ fontSize: '12px', color: '#626F86' }}>Sincronizando casos desde Jira</span>
                      </div>
                    ) : (
                      <>
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
                                  style={{ 
                                    color: '#CA3521', 
                                    borderColor: '#FFD2CC',
                                    backgroundColor: '#FFF5F5',
                                    padding: '0 8px', 
                                    height: '28px',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#FFEBE6'; e.currentTarget.style.borderColor = '#FFBDAD'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFF5F5'; e.currentTarget.style.borderColor = '#FFD2CC'; }}
                                  onClick={() => {
                                    const isExecuted = test.status && normalizeUiStatus(test.status) !== 'Not Run';
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
                        {deduplicatedCycleTests.length === 0 && (
                          <div style={{ padding: '2rem', textAlign: 'center', color: '#626F86', fontSize: '13px' }}>
                            No hay casos asignados a este ciclo todavía. Usa la sección inferior para añadir casos de prueba.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* WARNING BANNER (Atlassian Yellow Banner) */}
                {isLoadingCycleTests ? (
                  <div style={{ padding: '10px 14px', background: '#FAFBFC', border: '1px solid #DCDFE4', borderRadius: '6px', fontSize: '12px', color: '#626F86', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 1rem 0' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid #0C66E4', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                    <span>Sincronizando casos de prueba del ciclo...</span>
                  </div>
                ) : (totalInProject > 0 && notInCycleCount > 0 ? (
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
                            !cycleTestIds.has(String(tc.id)) &&
                            (!tc.key || !cycleTestKeys.has(tc.key))
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
                ) : null)}

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
                          setAddingProgress({ current: 0, total: testsToAdd.length });
                          try {
                            const cycleId = String(selectedCycle.id);
                            testsToAdd.forEach(tc => {
                              const idStr = String(tc.id);
                              deletedIdsRef.current.delete(idStr);
                              if (perCycleDeletedRef.current[cycleId]) {
                                perCycleDeletedRef.current[cycleId].delete(idStr);
                              }
                            });

                            const CHUNK_SIZE = 25;
                            let allAddedTests = [];
                            for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                                const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                                let retries = 2;
                                let bRes = null;
                                while (retries >= 0) {
                                  try {
                                    bRes = await invoke('addBulkTestsToCycle', { 
                                      cycleId: selectedCycle.id,
                                      cycleKey: selectedCycle.key || selectedCycle.id,
                                      projectId: selectedProjectId,
                                      config: projectConfig,
                                      testCases: chunk,
                                      skipIndexWrite: true
                                    });
                                    break;
                                  } catch (errChunk) {
                                    retries--;
                                    if (retries < 0) {
                                      console.warn('[addBulkTestsToCycle] Chunk error:', errChunk);
                                    } else {
                                      await new Promise(r => setTimeout(r, 600));
                                    }
                                  }
                                }
                                if (bRes && bRes.addedTests) {
                                    allAddedTests = allAddedTests.concat(bRes.addedTests);
                                }
                                setAddingProgress({ current: Math.min(i + CHUNK_SIZE, testsToAdd.length), total: testsToAdd.length });
                            }

                            // Write unified cycle index once at the end
                            if (allAddedTests.length > 0) {
                              try {
                                await invoke('syncCycleIndexWithRuns', {
                                  cycleId: selectedCycle.id,
                                  addedRuns: allAddedTests
                                });
                              } catch (errSync) {
                                console.warn('[syncCycleIndexWithRuns] Index sync warning:', errSync);
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
                            
                            const cycleIdStr = String(cycleId);
                            const existingBase = perCycleCacheRef.current[cycleIdStr] || [];
                            const newArr = [...existingBase];
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
                            perCycleCacheRef.current[cycleIdStr] = newArr;
                            setTestCycles(cycles => cycles.map(c => String(c.id) === cycleIdStr ? { ...c, testCount: newArr.length } : c));
                            if (activeCycleIdRef.current === cycleIdStr) {
                              setCycleTests(newArr);
                              setSelectedCycle(c => (c && String(c.id) === cycleIdStr ? { ...c, testCount: newArr.length } : c));
                            }
                            
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
                                    safeSetCycleTests(finalExecution, cycleId);
                                }
                            }, 2500);
                            
                          } catch(err) {
                            console.error(err);
                            alert("Error al añadir casos: " + err.message);
                          }
                          setIsAddingAll(false);
                          setAddingProgress({ current: 0, total: 0 });
                        }}
                        disabled={loading || isAddingAll || availableFilteredTestCases.length === 0}
                        style={{ height: '32px', fontSize: '12px', fontWeight: 600 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 4v16m8-8H4"></path></svg>
                        <span>{isAddingAll ? (addingProgress.total > 0 ? `Añadiendo (${addingProgress.current}/${addingProgress.total})...` : 'Añadiendo casos...') : (selectedTestsForCycle.length > 0 ? `+ Añadir (${selectedTestsForCycle.length})` : '+ Añadir todos')}</span>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '1.25rem' }}>
                  {!isFolderSidebarVisible && (
                    <button
                      onClick={toggleFolderSidebar}
                      className="btn-secondary"
                      style={{ height: '36px', fontSize: '13px' }}
                    >
                      📂 Ver Planes y Ciclos
                    </button>
                  )}
                  <button 
                    className="btn-primary" 
                    style={{ height: '36px', fontSize: '13px' }}
                    onClick={handleCreateIssue}
                  >
                    + Crear Nuevo Ciclo / Plan
                  </button>
                </div>
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

      // 2. Load description and execution details if not fully loaded
      if (!test?._detailLoaded) {
        let desc = test?.description;
        if (!desc && desc !== '') {
          desc = await invoke('getIssueDescription', { issueId: targetCaseKey || targetCaseId || targetRunKey || testId }).catch(() => null);
        }

        const fullExec = await invoke('getTestExecution', { 
          cycleId: selectedCycle.id, 
          testId,
          testRunId: test?.testRunId || test?.testRunKey
        }).catch(() => null);

        const cycleIdStr = selectedCycle ? String(selectedCycle.id) : null;
        setCycleTests(prev => {
          const updated = prev.map(t => {
            if (String(t.id) === String(testId)) {
              const mergedIterations = (fullExec?.iterations && fullExec.iterations.length > 0)
                ? fullExec.iterations
                : (t.iterations && t.iterations.length > 0 ? t.iterations : (fullExec?.iterations || []));

              const mergedEvidences = (fullExec?.evidences && fullExec.evidences.length > 0)
                ? fullExec.evidences
                : (t.evidences && t.evidences.length > 0 ? t.evidences : (fullExec?.evidences || []));

              const mergedBugs = (fullExec?.linkedBugs && fullExec.linkedBugs.length > 0)
                ? fullExec.linkedBugs
                : (t.linkedBugs && t.linkedBugs.length > 0 ? t.linkedBugs : (fullExec?.linkedBugs || []));

              return {
                ...t,
                ...(fullExec || {}),
                iterations: mergedIterations,
                evidences: mergedEvidences,
                linkedBugs: mergedBugs,
                description: desc || fullExec?.description || t.description || null,
                _detailLoaded: true
              };
            }
            return t;
          });
          if (cycleIdStr && perCycleCacheRef.current[cycleIdStr]) {
            perCycleCacheRef.current[cycleIdStr] = updated;
          }
          return updated;
        });
      }
    }
  };

  const renderExecutionTab = () => {
    const isPassed = s => normalizeUiStatus(s) === 'Passed';
    const isFailed = s => normalizeUiStatus(s) === 'Failed';
    const isBlocked = s => normalizeUiStatus(s) === 'Blocked';
    const isInProgress = s => normalizeUiStatus(s) === 'In Progress';
    const isNotRun = s => normalizeUiStatus(s) === 'Not Run';

    // Deduplicate cycleTests strictly to guarantee zero duplicate artifacts
    const uniqueCycleTestsMap = new Map();
    cycleTests.forEach(test => {
      const matchKey = test.key || test.testCaseKey || (testCases.find(t => String(t.id) === String(test.id))?.key) || String(test.id);
      if (!uniqueCycleTestsMap.has(matchKey)) {
        uniqueCycleTestsMap.set(matchKey, test);
      } else {
        const existing = uniqueCycleTestsMap.get(matchKey);
        const hasExec = test.status && normalizeUiStatus(test.status) !== 'Not Run';
        const existingHasExec = existing.status && normalizeUiStatus(existing.status) !== 'Not Run';
        if (hasExec && !existingHasExec) {
          uniqueCycleTestsMap.set(matchKey, test);
        }
      }
    });
    const deduplicatedCycleTests = Array.from(uniqueCycleTestsMap.values());

    const totalInCycle = deduplicatedCycleTests.length;
    const passedCount = deduplicatedCycleTests.filter(t => isPassed(t.status)).length;
    const failedCount = deduplicatedCycleTests.filter(t => isFailed(t.status)).length;
    const blockedCount = deduplicatedCycleTests.filter(t => isBlocked(t.status)).length;
    const inProgressCount = deduplicatedCycleTests.filter(t => isInProgress(t.status)).length;
    const notRunCount = deduplicatedCycleTests.filter(t => isNotRun(t.status)).length;
    const executedCount = passedCount + failedCount + blockedCount + inProgressCount;
    const completionRate = totalInCycle > 0 ? Math.round(((passedCount + failedCount + blockedCount) / totalInCycle) * 100) : 0;

    const passedPct = totalInCycle > 0 ? ((passedCount / totalInCycle) * 100).toFixed(1) : '0';
    const failedPct = totalInCycle > 0 ? ((failedCount / totalInCycle) * 100).toFixed(1) : '0';
    const blockedPct = totalInCycle > 0 ? ((blockedCount / totalInCycle) * 100).toFixed(1) : '0';
    const inProgressPct = totalInCycle > 0 ? ((inProgressCount / totalInCycle) * 100).toFixed(1) : '0';
    const notRunPct = totalInCycle > 0 ? ((notRunCount / totalInCycle) * 100).toFixed(1) : '0';

    // Filter tests
    let filteredTests = deduplicatedCycleTests.filter(test => {
      const isCurrentlyRunning = !!runningTests[test.id];
      if (!isCurrentlyRunning) {
        if (executionStatusFilter === 'Passed' && !isPassed(test.status)) return false;
        if (executionStatusFilter === 'Failed' && !isFailed(test.status)) return false;
        if (executionStatusFilter === 'Blocked' && !isBlocked(test.status)) return false;
        if (executionStatusFilter === 'In Progress' && !isInProgress(test.status)) return false;
        if (executionStatusFilter === 'Not Run' && !isNotRun(test.status)) return false;
      }

      if (executionSearchQuery) {
        const q = executionSearchQuery.toLowerCase();
        const keyMatch = (test.key || test.testCaseKey || '').toLowerCase().includes(q);
        const runKeyMatch = (test.testRunKey || '').toLowerCase().includes(q);
        const summaryMatch = (test.summary || (testCases.find(t => t.id === test.id)?.summary) || '').toLowerCase().includes(q);
        if (!keyMatch && !runKeyMatch && !summaryMatch) return false;
      }

      return true;
    });

    // Sort tests (only if explicitly requested by user)
    if (executionSortBy && executionSortBy !== 'none') {
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
    }

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
        {isFolderSidebarVisible && (
          <>
            <aside className="execution-sidebar" style={{ width: sidebarWidth, flexShrink: 0 }}>
              {/* Test Plans Selector Header */}
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', background: '#FFFFFF' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#626F86', letterSpacing: '0.04em', textTransform: 'uppercase' }}>TEST PLANS</span>
                    <button
                      onClick={() => setIsCreatePlanOpen(true)}
                      style={{ fontSize: '11px', fontWeight: 600, color: '#0C66E4', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      className="hover:underline"
                    >
                      + Nuevo
                    </button>
                  </div>
                  <button
                    onClick={toggleFolderSidebar}
                    title="Ocultar panel lateral (Sidebar)"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '3px',
                      borderRadius: '4px',
                      color: 'var(--jira-subtle, #626F86)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--jira-bg-subtle, #F1F2F4)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                      <path d="M15 15l-3-3 3-3" />
                    </svg>
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
        </>
        )}

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
                        {!isFolderSidebarVisible && (
                          <button
                            onClick={toggleFolderSidebar}
                            className="btn-secondary"
                            title="Mostrar panel de planes y ciclos"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              fontSize: '0.78rem',
                              padding: '0.35rem 0.65rem',
                              borderRadius: '6px'
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                              <line x1="9" y1="3" x2="9" y2="21" />
                              <path d="M13 9l3 3-3 3" />
                            </svg>
                            <span>Planes &amp; Ciclos</span>
                          </button>
                        )}
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#172B4D', margin: 0, letterSpacing: '-0.01em' }}>
                          Execution: {selectedCycle.summary}
                        </h1>
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', background: isLoadingCycleTests ? '#E9F2FF' : '#F1F2F4', color: isLoadingCycleTests ? '#0C66E4' : '#44546F', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          {isLoadingCycleTests ? (
                            <>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1.5px solid #0C66E4', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                              <span>Sincronizando...</span>
                            </>
                          ) : (
                            `${totalInCycle} casos`
                          )}
                        </span>
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: isLoadingCycleTests ? '#F1F2F4' : (completionRate === 100 ? '#DCFFF1' : '#E9F2FF'),
                          color: isLoadingCycleTests ? '#626F86' : (completionRate === 100 ? '#216E4E' : '#0C66E4'),
                          border: `1px solid ${isLoadingCycleTests ? '#DCDFE4' : (completionRate === 100 ? '#7EE2B8' : '#B2D4FF')}`
                        }}>
                          {isLoadingCycleTests ? 'Sincronizando...' : (completionRate === 100 ? 'Completado' : 'En Ejecución')}
                        </span>
                      </div>
                      <p style={{ fontSize: '12px', color: '#626F86', margin: '4px 0 0 0' }}>
                        {selectedCycle.description || `Ejecución activa de pruebas en el ciclo ${selectedCycle.summary}.`}
                      </p>
                    </div>
                  </div>

                  {/* Metrics & Progress Card */}
                  <div className="execution-metrics-card">
                    {isLoadingCycleTests ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '0.8rem 0', color: '#0C66E4', fontSize: '12px', fontWeight: 600 }}>
                        <span style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid #0C66E4', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                        <span>Sincronizando métricas de ejecución con Jira...</span>
                      </div>
                    ) : (
                      <>
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
                      </>
                    )}
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
                          Todos {isLoadingCycleTests ? '(...)' : `(${totalInCycle})`}
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Passed'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Passed' ? 'active' : ''}`}
                          style={executionStatusFilter === 'Passed' ? { background: '#216E4E', color: '#FFFFFF' } : {}}
                        >
                          Passed {isLoadingCycleTests ? '(...)' : `(${passedCount})`}
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Failed'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Failed' ? 'active' : ''}`}
                          style={executionStatusFilter === 'Failed' ? { background: '#BF2600', color: '#FFFFFF' } : {}}
                        >
                          Failed {isLoadingCycleTests ? '(...)' : `(${failedCount})`}
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Blocked'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Blocked' ? 'active' : ''}`}
                          style={executionStatusFilter === 'Blocked' ? { background: '#FFAB00', color: '#172B4D' } : {}}
                        >
                          Blocked {isLoadingCycleTests ? '(...)' : `(${blockedCount})`}
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('In Progress'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'In Progress' ? 'active' : ''}`}
                          style={executionStatusFilter === 'In Progress' ? { background: '#0747A6', color: '#FFFFFF' } : {}}
                        >
                          In Progress {isLoadingCycleTests ? '(...)' : `(${inProgressCount})`}
                        </button>
                        <button
                          onClick={() => { setExecutionStatusFilter('Not Run'); setExecutionCurrentPage(1); }}
                          className={`execution-status-pill ${executionStatusFilter === 'Not Run' ? 'active' : ''}`}
                        >
                          Not Run {isLoadingCycleTests ? '(...)' : `(${notRunCount})`}
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
                        <option value="none">Orden: Como se agregaron (Predeterminado)</option>
                        <option value="key-asc">Ordenar por: Identificador (Asc)</option>
                        <option value="key-desc">Ordenar por: Identificador (Desc)</option>
                        <option value="status">Ordenar por: Estatus de Ejecución</option>
                        <option value="summary">Ordenar por: Título</option>
                      </select>
                    </div>
                  </div>

                  {/* Test Cases List */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {isLoadingCycleTests ? (
                      <div style={{ textAlign: 'center', padding: '3.5rem 1.5rem', background: '#FFFFFF', border: '1px solid #DCDFE4', borderRadius: '8px', color: '#626F86' }}>
                        <div style={{ display: 'inline-block', width: '32px', height: '32px', borderRadius: '50%', border: '3px solid #0C66E4', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', marginBottom: '1rem' }} />
                        <p style={{ fontWeight: 600, color: '#172B4D', margin: '0 0 0.4rem 0', fontSize: '14px' }}>Sincronizando casos de prueba del ciclo...</p>
                        <p style={{ fontSize: '12px', color: '#626F86', margin: 0 }}>Obteniendo estados de ejecución oficiales desde Jira.</p>
                      </div>
                    ) : (
                      <>
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                              {/* Play / Run Action Button */}
                              <button
                                title={runningTests[test.id] ? 'Detener Ejecución' : 'Iniciar Ejecución'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (runningTests[test.id]) {
                                    handleStopExecution(test.id, test);
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
                                        <span onClick={() => setSelectedBug(bug)} style={{ cursor: 'pointer' }} className="hover:underline" title="Ver detalle del bug en Test Pulse">
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
                                      title={runningTests[test.id] ? "Adjuntar Archivo de Evidencia" : "Inicia la ejecución (Play) para adjuntar evidencias"}
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
                                      disabled={!runningTests[test.id]}
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
                                      title={runningTests[test.id] ? "Grabar pantalla o capturar pantalla" : "Inicia la ejecución (Play) para grabar pantalla"}
                                      onClick={() => handleCaptureScreen(test.id, test.key)}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                      <span>Grabar</span>
                                    </button>

                                    <button
                                      className="btn-secondary"
                                      disabled={!runningTests[test.id]}
                                      style={{
                                        padding: '4px 10px',
                                        border: '1px solid #0C66E4',
                                        background: '#E9F2FF',
                                        color: '#0C66E4',
                                        cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        ...(!runningTests[test.id] ? { opacity: 0.5, pointerEvents: 'none' } : {})
                                      }}
                                      title={runningTests[test.id] ? "Escanear QR para capturar con cámara del celular" : "Inicia la ejecución (Play) para capturar con celular"}
                                      onClick={() => handleOpenQrCapture(test)}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                                      <span>📱 Celular (QR)</span>
                                    </button>
                                  </div>
                                </div>

                                {(() => {
                                  const iterEvKeys = new Set();
                                  (test.iterations || []).forEach(it => {
                                    (it.evidences || []).forEach(e => {
                                      if (e) {
                                        const id = typeof e === 'object' ? (e.id ? String(e.id) : '') : String(e);
                                        const name = typeof e === 'object' ? (e.filename ? String(e.filename) : '') : '';
                                        const url = typeof e === 'object' ? (e.url ? String(e.url) : '') : '';
                                        if (id) iterEvKeys.add(id);
                                        if (name) iterEvKeys.add(name);
                                        if (url) iterEvKeys.add(url);
                                      }
                                    });
                                  });
                                  const rawEvs = (test.evidences || (test.evidence ? [test.evidence] : [])).filter(ev => {
                                    if (!ev) return false;
                                    const id = typeof ev === 'object' ? (ev.id ? String(ev.id) : '') : String(ev);
                                    const name = typeof ev === 'object' ? (ev.filename ? String(ev.filename) : '') : '';
                                    const url = typeof ev === 'object' ? (ev.url ? String(ev.url) : '') : '';
                                    if (id && iterEvKeys.has(id)) return false;
                                    if (name && iterEvKeys.has(name)) return false;
                                    if (url && iterEvKeys.has(url)) return false;
                                    return true;
                                  });

                                  return rawEvs.length > 0 ? (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                      {rawEvs.map((ev, idx) => {
                                        const evId = typeof ev === 'string' ? ev : ev.id;
                                        const evName = typeof ev === 'string' ? `evidence_${evId}.jpg` : (ev.filename || `evidence_${evId}.jpg`);
                                        return (
                                          <div
                                            key={idx}
                                            className="execution-evidence-pill"
                                            onClick={() => handlePreviewEvidence(ev)}
                                            title={ev.note ? `${evName} — Nota: ${ev.note}` : evName}
                                            style={{ cursor: 'pointer' }}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                            <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                                              {evName}
                                            </span>
                                            {ev.note && (
                                              <span title={`Nota: ${ev.note}`} style={{ fontSize: '10px', background: '#E9F2FF', color: '#0C66E4', padding: '1px 5px', borderRadius: '3px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                                💬 Nota
                                              </span>
                                            )}
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
                                  );
                                })()}
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
                                          <label
                                            className="btn-secondary"
                                            style={{
                                              padding: '3px 6px',
                                              cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderRadius: '4px',
                                              border: '1px solid #DCDFE4',
                                              background: '#FFFFFF',
                                              ...(!runningTests[test.id] ? { opacity: 0.5, pointerEvents: 'none' } : {})
                                            }}
                                            title={runningTests[test.id] ? "Adjuntar evidencia a iteración" : "Inicia la ejecución (Play) para adjuntar evidencias"}
                                          >
                                            <input
                                              disabled={!runningTests[test.id]}
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

                                          <button
                                            title={runningTests[test.id] ? "Grabar pantalla para iteración" : "Inicia la ejecución (Play) para grabar"}
                                            disabled={!runningTests[test.id]}
                                            className="btn-secondary"
                                            style={{
                                              padding: '3px 6px',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderRadius: '4px',
                                              border: '1px solid #DCDFE4',
                                              background: '#FFFFFF',
                                              cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                              ...(!runningTests[test.id] ? { opacity: 0.5, pointerEvents: 'none' } : {})
                                            }}
                                            onClick={() => handleCaptureScreen(test.id, test.key, iter.id)}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                          </button>

                                          <button
                                            title={runningTests[test.id] ? "Capturar evidencia con cámara del celular (QR)" : "Inicia la ejecución (Play) para capturar con celular"}
                                            disabled={!runningTests[test.id]}
                                            className="btn-secondary"
                                            style={{
                                              padding: '3px 6px',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderRadius: '4px',
                                              border: '1px solid #0C66E4',
                                              background: '#E9F2FF',
                                              color: '#0C66E4',
                                              cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                              ...(!runningTests[test.id] ? { opacity: 0.5, pointerEvents: 'none' } : {})
                                            }}
                                            onClick={() => handleOpenQrCapture(test, iter.id, `Iteración #${idx + 1}`)}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
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
                                                  title={ev.note ? `${evName} — Nota: ${ev.note}` : evName}
                                                  style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '11px' }}
                                                >
                                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0C66E4" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                                  <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evName}</span>
                                                  {ev.note && (
                                                    <span title={`Nota: ${ev.note}`} style={{ fontSize: '10px', background: '#E9F2FF', color: '#0C66E4', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                                      💬 Nota
                                                    </span>
                                                  )}
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
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {paginatedTests.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '3rem 1.5rem', background: '#FFFFFF', border: '1px solid #DCDFE4', borderRadius: '8px', color: '#626F86' }}>
                        {deduplicatedCycleTests.length === 0 ? (
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
                      </>
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
                    {isLoadingCycleTests ? (
                      <span style={{ color: '#0C66E4', fontSize: '11px', fontWeight: 600 }}>Sincronizando...</span>
                    ) : (
                      <span><strong>{completionRate}%</strong> completado ({executedCount} de {totalInCycle} casos ejecutados)</span>
                    )}
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
              {!isFolderSidebarVisible && (
                <button
                  onClick={toggleFolderSidebar}
                  className="btn-primary"
                  style={{ marginTop: '0.5rem', fontSize: '12px' }}
                >
                  📂 Ver Planes y Ciclos
                </button>
              )}
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
    // Show TestPulseLoader only on initial load if no reportData is available yet
    if (reportLoading && (!reportData.cycles || reportData.cycles.length === 0)) {
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

    // 1. Plan Cycles (all cycles within the selected plan(s), or all cycles if no plan filter)
    const baseReportCycles = reportData.cycles || [];
    let planCycles = baseReportCycles.map(c => {
      const tcCycle = (testCycles || []).find(tc => String(tc.id) === String(c.id));
      const cMerged = {
        ...tcCycle,
        ...c,
        version: c.version || tcCycle?.version,
        versions: c.versions || tcCycle?.versions,
        fixVersions: c.fixVersions || tcCycle?.fixVersions,
        build: c.build || tcCycle?.build,
        buildVersion: c.buildVersion || tcCycle?.buildVersion,
        rawFields: c.rawFields || tcCycle?.rawFields
      };
      const cIdStr = String(c.id);
      const cached = perCycleCacheRef.current[cIdStr];
      if (cached && Array.isArray(cached) && cached.length > 0) {
        const execMap = new Map();
        (c.execution || []).forEach(item => {
          const k = item.testCaseKey || item.key || item.id;
          if (k) execMap.set(String(k), item);
        });
        // Live in-memory execution from Planning/Execution takes precedence for completeness & latest status, while preserving enriched bug details
        (cached || []).forEach(item => {
          const k = item.testCaseKey || item.key || item.id;
          if (k) {
            const existing = execMap.get(String(k));
            if (existing) {
              const mergedBugs = (item.linkedBugs || existing.linkedBugs || []).map(b => {
                const eb = (existing.linkedBugs || []).find(x => x.key === b.key) || reportData?.bugMap?.[b.key] || {};
                return { ...eb, ...b, severity: eb.severity || b.severity, summary: eb.summary || b.summary };
              });
              execMap.set(String(k), { ...existing, ...item, linkedBugs: mergedBugs });
            } else {
              execMap.set(String(k), item);
            }
          }
        });
        return {
          ...cMerged,
          execution: Array.from(execMap.values())
        };
      }
      return cMerged;
    });

    // Also include any cycles from testCycles that might belong to the plan but aren't yet in reportData
    (testCycles || []).forEach(tcCycle => {
      const exists = planCycles.some(pc => String(pc.id) === String(tcCycle.id));
      if (!exists) {
        const cIdStr = String(tcCycle.id);
        const cached = perCycleCacheRef.current[cIdStr] || [];
        planCycles.push({
          ...tcCycle,
          id: tcCycle.id,
          key: tcCycle.key,
          summary: tcCycle.summary,
          planId: tcCycle.planId,
          version: tcCycle.version,
          versions: tcCycle.versions,
          fixVersions: tcCycle.fixVersions,
          build: tcCycle.build,
          buildVersion: tcCycle.buildVersion,
          rawFields: tcCycle.rawFields,
          execution: cached
        });
      }
    });

    if (reportSelectedPlans && reportSelectedPlans.length > 0) {
      planCycles = planCycles.filter(c => reportSelectedPlans.some(pId => String(pId) === String(c.planId)));
    }

    // Helper to extract clean version strings and semantic versions from an entity (bug, cycle, etc.)
    const extractVersions = (entity, isBug = false) => {
      if (!entity) return { versions: [], semanticVersions: [] };
      const rawList = [];
      const addVal = (val) => {
        if (!val) return;
        if (typeof val === 'string') {
          val.split(',').forEach(s => {
            const trimmed = s.trim();
            if (trimmed && trimmed.toLowerCase() !== 'sin versión' && trimmed.toLowerCase() !== 'sin version') {
              rawList.push(trimmed);
            }
          });
        } else if (typeof val === 'object' && val !== null) {
          const name = val.name || val.value || val.label || '';
          if (name && typeof name === 'string') {
            const trimmed = name.trim();
            if (trimmed && trimmed.toLowerCase() !== 'sin versión' && trimmed.toLowerCase() !== 'sin version') {
              rawList.push(trimmed);
            }
          }
        }
      };

      const processList = (list) => {
        if (!list) return;
        if (Array.isArray(list)) list.forEach(addVal);
        else addVal(list);
      };

      processList(entity.versions);
      processList(entity.fixVersions);
      processList(entity.version);
      processList(entity.build);
      processList(entity.buildVersion);
      if (entity.rawFields) {
        processList(entity.rawFields.versions);
        processList(entity.rawFields.fixVersions);
      }

      // ONLY extract version from summary/name for non-bugs (e.g. cycles, plans, test suites)
      if (!isBug) {
        const entityName = String(entity.summary || entity.name || '').trim();
        if (entityName) {
          const semVerRegex = /\b\d+(\.\d+)+\b/g;
          const matches = entityName.match(semVerRegex);
          if (matches) {
            matches.forEach(m => rawList.push(m));
          }
        }
      }

      const normalized = Array.from(new Set(rawList.map(v => v.trim().toLowerCase())));
      const semanticVersions = Array.from(new Set(
        normalized.flatMap(v => {
          const m = v.match(/\b\d+(\.\d+)+\b/g);
          return m ? m : [];
        })
      ));

      return { versions: normalized, semanticVersions };
    };

    // Helper to test if any item (bug, cycle, execution, test case) matches reportSelectedVersions
    const matchSelectedVersions = (item, selectedVers) => {
      if (!selectedVers || !Array.isArray(selectedVers) || selectedVers.length === 0) return true;
      if (!item) return false;

      const isBugItem = isActualBug(item);
      const itemVer = extractVersions(item, isBugItem);
      const targetsLower = selectedVers.map(t => String(t).trim().toLowerCase());
      const wantsSinVersion = targetsLower.includes('sin versión') || targetsLower.includes('sin version');

      if (itemVer.versions.length === 0 && itemVer.semanticVersions.length === 0) {
        return wantsSinVersion;
      }

      for (const t of targetsLower) {
        if (t === 'sin versión' || t === 'sin version') continue;
        const tSemVers = t.match(/\b\d+(\.\d+)+\b/g) || [];
        if (tSemVers.length > 0 && itemVer.semanticVersions.length > 0) {
          if (tSemVers.some(tsv => itemVer.semanticVersions.includes(tsv))) {
            return true;
          }
        }
        for (const ex of itemVer.versions) {
          if (ex === t || ex.includes(t) || t.includes(ex)) {
            return true;
          }
        }
      }

      return false;
    };

    // Helper to determine if a bug belongs to a specific cycle
    const bugMatchesCycle = (bug, cycle) => {
      if (!bug || !cycle) return false;

      const bugVer = extractVersions(bug, true);
      const cycleVer = extractVersions(cycle, false);

      const bugHasExplicitVersion = bugVer.versions.length > 0 || bugVer.semanticVersions.length > 0;
      const cycleHasExplicitVersion = cycleVer.versions.length > 0 || cycleVer.semanticVersions.length > 0;

      // Check if bug was explicitly recorded in this cycle's test executions
      const isDirectlyExecutedInCycle = Array.isArray(cycle.execution) && cycle.execution.some(ex => 
        Array.isArray(ex.linkedBugs) && ex.linkedBugs.some(lb => lb && (lb.key === bug.key || String(lb.id) === String(bug.id)))
      );

      // 1. If BOTH bug and cycle have semantic version numbers (e.g. Bug: 3.72.12.07 vs Cycle: 3.72.12.12)
      if (bugVer.semanticVersions.length > 0 && cycleVer.semanticVersions.length > 0) {
        const hasMatchingSemVer = bugVer.semanticVersions.some(bv => cycleVer.semanticVersions.includes(bv));
        if (hasMatchingSemVer) return true;
        // HARD CONFLICT: Bug is explicitly for a different version than this cycle!
        // Never include in this cycle even if a test case has historical links.
        return false;
      }

      // 2. If BOTH have named versions (e.g. Bug: "Release Sprint 4" vs Cycle: "Release Sprint 5")
      if (bugVer.versions.length > 0 && cycleVer.versions.length > 0) {
        const hasMatchingVer = bugVer.versions.some(bv => 
          cycleVer.versions.some(cv => cv === bv || cv.includes(bv) || bv.includes(cv))
        );
        if (hasMatchingVer) return true;
        // HARD CONFLICT: Named versions differ
        return false;
      }

      // 3. If Bug has an explicit version, but Cycle has NO version info:
      if (bugHasExplicitVersion && !cycleHasExplicitVersion) {
        const cycleSummaryLower = String(cycle.summary || cycle.key || '').toLowerCase();
        const matchesSummary = bugVer.versions.some(bv => cycleSummaryLower.includes(bv)) ||
                               bugVer.semanticVersions.some(bv => cycleSummaryLower.includes(bv));
        if (matchesSummary) return true;
        // If not in summary, only include if directly executed in this unversioned cycle
        return isDirectlyExecutedInCycle;
      }

      // 4. If Bug has NO version ("Sin versión"):
      // It belongs to this cycle ONLY IF it was directly linked/executed in this cycle
      if (!bugHasExplicitVersion) {
        return isDirectlyExecutedInCycle;
      }

      return false;
    };

    // 2. Cycle-filtered Cycles (cycles filtered by specific cycle selection for Runs & Cycle Bugs)
    let filteredCycles = planCycles;
    if (reportSelectedCycles && reportSelectedCycles.length > 0) {
      filteredCycles = filteredCycles.filter(c => reportSelectedCycles.some(rcId => String(rcId) === String(c.id)));
    }

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
        const validBugKeywords = ['bug', 'error', 'defecto', 'defect', 'falla', 'incidente', 'incident', 'problem', 'problema', 'fallo', 'anomalia', 'anomalía'];
        const isBug = validBugKeywords.some(kw => rawType.includes(kw));
        if (!isBug) return false;
      }
      // 5. If it is only a raw stub from linkedBugs without matching real Jira issue in bugMap, unlinkedBugs, or rawFields
      const mapBug = reportData?.bugMap?.[bug.key];
      const projBug = (unlinkedBugs || []).find(ub => ub.key === bug.key);
      if (!mapBug && !projBug && !bug.rawFields && (!bug.summary || bug.summary === 'Defecto detectado en ciclo')) {
        return false;
      }
      return true;
    };

    // Strict *Severity normalization: checks customfield_10238, customfields holding severity, or explicit severity
    const normalizeSeverity = (rawSev, rawFields) => {
      let s = '';
      if (rawFields?.['customfield_10238']) {
        const sf = rawFields['customfield_10238'];
        s = typeof sf === 'object' ? (sf.value || sf.name || sf.label || String(sf)) : String(sf);
      } else if (rawFields) {
        for (const [fKey, fVal] of Object.entries(rawFields)) {
          if (fKey.startsWith('customfield_') && fVal) {
            const vStr = typeof fVal === 'object' ? (fVal.value || fVal.name || '') : String(fVal);
            if (['bloqueante', 'crítico', 'critico', 'mayor', 'menor', 'medio', 'media', 'blocker', 'critical', 'major', 'minor', 'medium', 'alta', 'high', 'low'].includes(String(vStr).toLowerCase())) {
              s = vStr;
              break;
            }
          }
        }
      }
      if (!s && rawSev && rawSev !== 'N/A' && rawSev !== 'Sin definir') {
        s = String(rawSev).trim();
      }

      if (!s || s === 'Sin definir' || s === 'N/A') return 'Sin definir';

      const low = s.toLowerCase();
      if (low.includes('bloq') || low.includes('blocker')) return 'Bloqueante';
      if (low.includes('crit') || low.includes('crític')) return 'Crítico';
      if (low.includes('may') || low.includes('major') || low.includes('alta') || low.includes('high')) return 'Mayor';
      if (low.includes('med') || low.includes('medio') || low.includes('media')) return 'Medio';
      if (low.includes('men') || low.includes('minor') || low.includes('baja') || low.includes('low') || low.includes('trivial')) return 'Menor';
      return s;
    };

    // Strict business rule: ONLY 'closed', 'cerrado', 'cerrada' are considered closed; everything else is open!
    const isBugDone = (b) => {
      if (!b) return false;
      const statusStr = (typeof b === 'string' ? b : (b.status || b.fields?.status?.name || b.rawFields?.status?.name || '')).toLowerCase().trim();
      return ['closed', 'cerrado', 'cerrada'].includes(statusStr);
    };

    // Business calendar calculation (Mexico: Mon-Thu 7-18h, Fri 7-13h, Sat/Sun/Holidays excluded)
    const MX_HOLIDAYS_SET = new Set([
      '2024-01-01', '2024-02-05', '2024-03-18', '2024-05-01', '2024-09-16', '2024-10-01', '2024-11-18', '2024-12-25',
      '2025-01-01', '2025-02-03', '2025-03-17', '2025-05-01', '2025-09-16', '2025-11-17', '2025-12-25',
      '2026-01-01', '2026-02-02', '2026-03-16', '2026-05-01', '2026-09-16', '2026-11-16', '2026-12-25',
      '2027-01-01', '2027-02-01', '2027-03-15', '2027-05-01', '2027-09-16', '2027-11-15', '2027-12-25'
    ]);

    const getBusinessHoursBetween = (startMs, endMs) => {
      if (!startMs || !endMs || startMs >= endMs) return 0;
      let current = new Date(startMs);
      const end = new Date(endMs);
      let businessMinutes = 0;
      const mxOffset = -6 * 60 * 60 * 1000;

      while (current < end) {
        const mxTime = new Date(current.getTime() + mxOffset);
        const day = mxTime.getUTCDay();
        const hour = mxTime.getUTCHours();
        const dateString = mxTime.toISOString().split('T')[0];

        let isBusiness = false;
        if (!MX_HOLIDAYS_SET.has(dateString)) {
          if (day >= 1 && day <= 4) {
            if (hour >= 7 && hour < 18) isBusiness = true;
          } else if (day === 5) {
            if (hour >= 7 && hour < 13) isBusiness = true;
          }
        }
        if (isBusiness) businessMinutes++;
        current.setTime(current.getTime() + 60000);
      }
      return businessMinutes / 60;
    };

    const formatBugCreatedDate = (createdStr) => {
      if (!createdStr) return { dateStr: 'Sin fecha', timeStr: '' };
      try {
        const d = new Date(createdStr);
        if (isNaN(d.getTime())) return { dateStr: 'Sin fecha', timeStr: '' };
        const dateStr = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        return { dateStr, timeStr };
      } catch (e) {
        return { dateStr: 'Sin fecha', timeStr: '' };
      }
    };

    const formatBugAge = (createdStr, resolutionDateStr, isDone) => {
      if (!createdStr) return { label: 'Sin registro', tone: 'neutral', hours: 0, days: 0, bHoursFormatted: '0' };
      try {
        const created = new Date(createdStr).getTime();
        if (isNaN(created)) return { label: 'Sin registro', tone: 'neutral', hours: 0, days: 0, bHoursFormatted: '0' };

        let end = Date.now();
        if (isDone && resolutionDateStr) {
          const resTime = new Date(resolutionDateStr).getTime();
          if (!isNaN(resTime) && resTime >= created) {
            end = resTime;
          }
        }

        const businessHours = getBusinessHoursBetween(created, end);
        const bHoursFormatted = businessHours.toFixed(1);
        const bDays = Math.floor(businessHours / 10);

        let label = '';
        let tone = 'neutral';

        if (isDone) {
          if (businessHours < 1) {
            const mins = Math.max(1, Math.round(businessHours * 60));
            label = `Resuelto en ${mins}m hábiles`;
          } else if (businessHours < 10) {
            label = `Resuelto en ${bHoursFormatted}h hábiles`;
          } else {
            const days = Math.round(businessHours / 10);
            label = `Resuelto en ${days}d hábiles (${bHoursFormatted}h)`;
          }
          tone = 'done';
        } else {
          if (businessHours < 1) {
            const mins = Math.max(1, Math.round(businessHours * 60));
            label = `Abierto hace ${mins}m hábiles`;
            tone = 'green';
          } else if (businessHours <= 20) {
            const days = Math.floor(businessHours / 10);
            label = days > 0 ? `Abierto hace ${days}d hábil (${bHoursFormatted}h)` : `Abierto hace ${bHoursFormatted}h hábiles`;
            tone = 'green';
          } else if (businessHours <= 50) {
            const days = Math.floor(businessHours / 10);
            label = `Abierto hace ${days}d hábiles (${bHoursFormatted}h)`;
            tone = 'orange';
          } else {
            const days = Math.floor(businessHours / 10);
            label = `Abierto hace ${days}d hábiles (${bHoursFormatted}h)`;
            tone = 'red';
          }
        }

        return { label, tone, hours: businessHours, days: bDays, bHoursFormatted };
      } catch (e) {
        return { label: 'Sin registro', tone: 'neutral', hours: 0, days: 0, bHoursFormatted: '0' };
      }
    };

    const renderBugStatusLozenge = (statusStr, isDone) => {
      const st = (statusStr || '').trim();
      const low = st.toLowerCase();
      if (['closed', 'cerrada', 'cerrado'].includes(low) || isDone) {
        return <span className="ads-lozenge ads-lozenge-success" style={{ fontSize: '10px', fontWeight: 700 }}>{st || 'Cerrado'}</span>;
      }
      if (low.includes('prog') || low.includes('curs') || low.includes('desarr') || low.includes('dev')) {
        return <span className="ads-lozenge ads-lozenge-brand" style={{ fontSize: '10px', fontWeight: 700 }}>{st || 'En progreso'}</span>;
      }
      if (low.includes('hold') || low.includes('espera') || low.includes('anal') || low.includes('rev') || low.includes('block') || low.includes('bloq') || low.includes('qa') || low.includes('test') || low.includes('resuel') || low.includes('resolv') || low.includes('done')) {
        return <span className="ads-lozenge ads-lozenge-warning" style={{ fontSize: '10px', fontWeight: 700 }}>{st || 'En análisis'}</span>;
      }
      return <span className="ads-lozenge ads-lozenge-danger" style={{ fontSize: '10px', fontWeight: 700 }}>{st || 'Abierto'}</span>;
    };

    const renderBugDueDate = (dueDateStr, isDone) => {
      if (!dueDateStr) {
        return <span style={{ color: 'var(--jira-subtle, #626F86)', fontStyle: 'italic', fontSize: '11px' }}>No definida</span>;
      }
      try {
        const d = new Date(dueDateStr + (dueDateStr.includes('T') ? '' : 'T23:59:59'));
        if (isNaN(d.getTime())) {
          return <span style={{ color: 'var(--jira-subtle, #626F86)', fontSize: '11px' }}>{dueDateStr}</span>;
        }
        const formatted = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
        const isOverdue = !isDone && (d.getTime() < Date.now());
        
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ fontSize: '11px', color: isOverdue ? '#BF2600' : 'var(--jira-dark, #172B4D)', fontWeight: isOverdue ? 700 : 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>📅</span> <span>{formatted}</span>
            </div>
            {isOverdue ? (
              <span className="ads-lozenge ads-lozenge-danger" style={{ fontSize: '9px', fontWeight: 700, width: 'fit-content', padding: '1px 5px' }} title="Fecha estimada de resolución vencida">
                ⚠️ VENCIDA
              </span>
            ) : !isDone ? (
              <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '9px', fontWeight: 600, width: 'fit-content', padding: '1px 5px' }}>
                En tiempo
              </span>
            ) : null}
          </div>
        );
      } catch (e) {
        return <span style={{ color: 'var(--jira-subtle, #626F86)', fontSize: '11px' }}>{dueDateStr}</span>;
      }
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

    // ── 1. Plan-Level Bugs (Consolidated across all cycles in plan, all statuses) ──
    const planAllBugsMap = new Map();
    planCycles.forEach(cycle => {
      if (cycle.execution && Array.isArray(cycle.execution)) {
        const seenTcInCycle = new Set();
        cycle.execution.forEach((ex, idx) => {
          const tcKey = ex.key || ex.testCaseKey || (testCases.find(t => String(t.id) === String(ex.id))?.key) || '';
          const tcId = String(ex.id || ex.testCaseId || '');
          const dedupeKey = tcKey ? `key_${tcKey}` : (tcId ? `id_${tcId}` : `item_${idx}`);
          if (seenTcInCycle.has(dedupeKey)) return;
          seenTcInCycle.add(dedupeKey);

          if (ex.linkedBugs && Array.isArray(ex.linkedBugs)) {
            const tc = testCases.find(t => String(t.id) === String(ex.id));
            const tcKeyDisplay = tc ? tc.key : (ex.key || `TC-${ex.id}`);
            const tcSummary = tc ? tc.summary : (ex.summary || 'Caso de prueba');

            ex.linkedBugs.forEach(rawBug => {
              if (!rawBug || !rawBug.key || !isActualBug(rawBug)) return;

              const bugKey = rawBug.key;
              const projectBug = (unlinkedBugs || []).find(ub => ub.key === bugKey);
              const mapBug = reportData?.bugMap?.[bugKey];
              const bug = {
                ...rawBug,
                ...(mapBug || {}),
                ...(projectBug || {}),
                summary: mapBug?.summary || projectBug?.summary || ((rawBug.summary && rawBug.summary !== 'Defecto detectado en ciclo') ? rawBug.summary : 'Defecto detectado en ciclo'),
                severity: mapBug?.severity || projectBug?.severity || ((rawBug.severity && rawBug.severity !== 'Sin definir') ? rawBug.severity : 'Sin definir'),
                assignee: mapBug?.assignee || projectBug?.assignee || ((rawBug.assignee && rawBug.assignee !== 'Sin asignar') ? rawBug.assignee : 'Sin asignar'),
                status: mapBug?.status || projectBug?.status || rawBug.status || 'Abierto',
                resolution: mapBug?.resolution || projectBug?.resolution || rawBug.resolution || 'Sin resolver',
                created: mapBug?.created || projectBug?.created || rawBug.created || rawBug.rawFields?.created || null,
                resolutiondate: mapBug?.resolutiondate || projectBug?.resolutiondate || rawBug.resolutiondate || rawBug.rawFields?.resolutiondate || null,
                duedate: mapBug?.duedate || projectBug?.duedate || rawBug.duedate || rawBug.rawFields?.duedate || null,
                version: mapBug?.version || projectBug?.version || rawBug.version || 'Sin versión',
                versions: mapBug?.versions || projectBug?.versions || rawBug.versions || [],
                fixVersions: mapBug?.fixVersions || projectBug?.fixVersions || rawBug.fixVersions || [],
                rawFields: mapBug?.rawFields || projectBug?.rawFields || rawBug.rawFields
              };

              // Ensure bug belongs to this cycle (checks version compatibility and execution)
              if (!bugMatchesCycle(bug, cycle)) return;

              const isDone = isBugDone(bug);
              const finalSeverity = normalizeSeverity(bug.severity, bug.rawFields);

              let resName = 'Sin resolver';
              if (bug.resolution && typeof bug.resolution === 'string' && bug.resolution !== 'Unresolved' && bug.resolution !== 'Sin resolver') {
                resName = bug.resolution;
              } else if (bug.rawFields?.resolution?.name) {
                resName = bug.rawFields.resolution.name;
              } else if (typeof bug.resolution === 'object' && bug.resolution?.name) {
                resName = bug.resolution.name;
              }

              const rawAff = bug.versions || bug.rawFields?.versions || [];
              const rawFix = bug.fixVersions || bug.rawFields?.fixVersions || [];
              const affectsVersions = (Array.isArray(rawAff) ? rawAff : [rawAff]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
              const fixVersions = (Array.isArray(rawFix) ? rawFix : [rawFix]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
              const versionDisplay = (bug.version && bug.version !== 'Sin versión')
                ? bug.version 
                : (affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión'));

              const cycleName = cycle.summary || cycle.key || String(cycle.id);
              const cycleMatchesVersion = !reportSelectedVersions || reportSelectedVersions.length === 0 || matchSelectedVersions(cycle, reportSelectedVersions);
              const shouldAddCycle = cycleMatchesVersion || !reportSelectedVersions || reportSelectedVersions.length === 0;

              if (!planAllBugsMap.has(bugKey)) {
                planAllBugsMap.set(bugKey, {
                  key: bugKey,
                  summary: bug.summary || 'Defecto detectado en ciclo',
                  severity: finalSeverity,
                  assignee: (typeof bug.assignee === 'object' && bug.assignee !== null) ? (bug.assignee.displayName || bug.assignee.name || 'Sin asignar') : (bug.assignee || 'Sin asignar'),
                  status: bug.status || (isDone ? 'Cerrado' : 'Abierto'),
                  resolution: resName,
                  isDone: isDone,
                  version: versionDisplay,
                  versions: affectsVersions,
                  fixVersions: fixVersions,
                  created: bug.created || bug.rawFields?.created || null,
                  resolutiondate: bug.resolutiondate || bug.rawFields?.resolutiondate || null,
                  duedate: bug.duedate || null,
                  cycles: shouldAddCycle ? new Set([cycleName]) : new Set(),
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
              } else {
                if (shouldAddCycle) {
                  planAllBugsMap.get(bugKey).cycles.add(cycleName);
                }
              }

              const entry = planAllBugsMap.get(bugKey);
              entry.affectedCases.set(String(ex.id), {
                id: ex.id,
                key: tcKeyDisplay,
                summary: tcSummary,
                status: ex.status,
                cycleName: cycleName
              });
            });
          }
        });
      }
    });

    // ── 2. Cycle-Level Runs & Bugs (Scoped to filteredCycles) ──
    const cycleOpenBugsMap = new Map();
    const cycleAllBugsMap = new Map();

    filteredCycles.forEach(cycle => {
      if (cycle.execution && Array.isArray(cycle.execution)) {
        const cycleName = cycle.summary || cycle.key || `Ciclo-${cycle.id}`;
        const seenTcInCycle = new Set();
        cycle.execution.forEach((ex, idx) => {
          const tcKey = ex.key || ex.testCaseKey || (testCases.find(t => String(t.id) === String(ex.id))?.key) || '';
          const tcId = String(ex.id || ex.testCaseId || '');
          const dedupeKey = tcKey ? `key_${tcKey}` : (tcId ? `id_${tcId}` : `item_${idx}`);
          if (seenTcInCycle.has(dedupeKey)) return;
          seenTcInCycle.add(dedupeKey);

          const tc = testCases.find(t => String(t.id) === String(ex.id));

          const normExStatus = normalizeUiStatus(ex.status);
          totalCases++;
          if (normExStatus === 'Passed') passed++;
          else if (normExStatus === 'Failed') failed++;
          else if (normExStatus === 'Blocked') blocked++;
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
          if (normExStatus === 'Passed') stats.passed++;
          else if (normExStatus === 'Failed') stats.failed++;
          else if (normExStatus === 'Blocked') stats.blocked++;
          else stats.notRun++;

          // Tester
          const tester = (ex.executedBy && typeof ex.executedBy === 'object') ? (ex.executedBy.displayName || ex.executedBy.name || 'Sin asignar') : (ex.executedBy || 'Sin asignar');
          if (!testerStats[tester]) testerStats[tester] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
          testerStats[tester].total++;
          if (normExStatus === 'Passed') testerStats[tester].passed++;
          else if (normExStatus === 'Failed') testerStats[tester].failed++;
          else if (normExStatus === 'Blocked') testerStats[tester].blocked++;
          else testerStats[tester].notRun++;

          // Module / Folder Stats (Only Functional Tests)
          if (isFunctionalTest(tc, ex)) {
            const folderObj = folders.find(f => String(f.id) === String(tc?.folderId || tc?.folder));
            const folderName = folderObj?.name || tc?.folderName || tc?.folder || 'General';
            if (!moduleStats[folderName]) moduleStats[folderName] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
            moduleStats[folderName].total++;
            if (normExStatus === 'Passed') moduleStats[folderName].passed++;
            else if (normExStatus === 'Failed') moduleStats[folderName].failed++;
            else if (normExStatus === 'Blocked') moduleStats[folderName].blocked++;
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
              if (normExStatus === 'Passed') featureStats[folderPath].passed++;
              else if (normExStatus === 'Failed') featureStats[folderPath].failed++;
              else if (normExStatus === 'Blocked') featureStats[folderPath].blocked++;
              else featureStats[folderPath].notRun++;
            }
          }

          // Bugs tracking (Scoped to selected cycle(s))
          if (ex.linkedBugs && Array.isArray(ex.linkedBugs)) {
            const tcKeyDisplay = tc ? tc.key : (ex.key || `TC-${ex.id}`);
            const tcSummary = tc ? tc.summary : (ex.summary || 'Caso de prueba');

            ex.linkedBugs.forEach(rawBug => {
              if (!rawBug || !rawBug.key || !isActualBug(rawBug)) return;

              const bugKey = rawBug.key;
              const projectBug = (unlinkedBugs || []).find(ub => ub.key === bugKey);
              const mapBug = reportData?.bugMap?.[bugKey];
              const bug = {
                ...rawBug,
                ...(mapBug || {}),
                ...(projectBug || {}),
                summary: mapBug?.summary || projectBug?.summary || ((rawBug.summary && rawBug.summary !== 'Defecto detectado en ciclo') ? rawBug.summary : 'Defecto detectado en ciclo'),
                severity: mapBug?.severity || projectBug?.severity || ((rawBug.severity && rawBug.severity !== 'Sin definir') ? rawBug.severity : 'Sin definir'),
                assignee: mapBug?.assignee || projectBug?.assignee || ((rawBug.assignee && rawBug.assignee !== 'Sin asignar') ? rawBug.assignee : 'Sin asignar'),
                status: mapBug?.status || projectBug?.status || rawBug.status || 'Abierto',
                resolution: mapBug?.resolution || projectBug?.resolution || rawBug.resolution || 'Sin resolver',
                created: mapBug?.created || projectBug?.created || rawBug.created || rawBug.rawFields?.created || null,
                resolutiondate: mapBug?.resolutiondate || projectBug?.resolutiondate || rawBug.resolutiondate || rawBug.rawFields?.resolutiondate || null,
                duedate: mapBug?.duedate || projectBug?.duedate || rawBug.duedate || rawBug.rawFields?.duedate || null,
                version: mapBug?.version || projectBug?.version || rawBug.version || 'Sin versión',
                versions: mapBug?.versions || projectBug?.versions || rawBug.versions || [],
                fixVersions: mapBug?.fixVersions || projectBug?.fixVersions || rawBug.fixVersions || [],
                rawFields: mapBug?.rawFields || projectBug?.rawFields || rawBug.rawFields
              };

              // Ensure bug belongs to this cycle (checks version compatibility and execution)
              if (!bugMatchesCycle(bug, cycle)) return;

              const isDone = isBugDone(bug);
              const finalSeverity = normalizeSeverity(bug.severity, bug.rawFields);

              let resName = 'Sin resolver';
              if (bug.resolution && typeof bug.resolution === 'string' && bug.resolution !== 'Unresolved' && bug.resolution !== 'Sin resolver') {
                resName = bug.resolution;
              } else if (bug.rawFields?.resolution?.name) {
                resName = bug.rawFields.resolution.name;
              } else if (typeof bug.resolution === 'object' && bug.resolution?.name) {
                resName = bug.resolution.name;
              }

              const rawAff = bug.versions || bug.rawFields?.versions || [];
              const rawFix = bug.fixVersions || bug.rawFields?.fixVersions || [];
              const affectsVersions = (Array.isArray(rawAff) ? rawAff : [rawAff]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
              const fixVersions = (Array.isArray(rawFix) ? rawFix : [rawFix]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
              const versionDisplay = (bug.version && bug.version !== 'Sin versión')
                ? bug.version 
                : (affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión'));

              // 1. Add to cycleAllBugsMap (All bugs found in the selected cycle runs)
              if (!cycleAllBugsMap.has(bugKey)) {
                cycleAllBugsMap.set(bugKey, {
                  key: bugKey,
                  summary: bug.summary || 'Defecto detectado en ciclo',
                  severity: finalSeverity,
                  assignee: (typeof bug.assignee === 'object' && bug.assignee !== null) ? (bug.assignee.displayName || bug.assignee.name || 'Sin asignar') : (bug.assignee || 'Sin asignar'),
                  status: bug.status || (isDone ? 'Cerrado' : 'Abierto'),
                  resolution: resName,
                  isDone: isDone,
                  version: versionDisplay,
                  versions: affectsVersions,
                  fixVersions: fixVersions,
                  created: bug.created || bug.rawFields?.created || null,
                  resolutiondate: bug.resolutiondate || bug.rawFields?.resolutiondate || null,
                  duedate: bug.duedate || null,
                  cycles: new Set([cycleName]),
                  affectedCases: new Map()
                });
              } else {
                cycleAllBugsMap.get(bugKey).cycles.add(cycleName);
              }

              const allEntry = cycleAllBugsMap.get(bugKey);
              allEntry.affectedCases.set(String(ex.id), {
                id: ex.id,
                key: tcKeyDisplay,
                summary: tcSummary,
                status: ex.status,
                cycleName: cycleName
              });

              // 2. Add to cycleOpenBugsMap if not closed
              if (!isDone) {
                if (!cycleOpenBugsMap.has(bugKey)) {
                  cycleOpenBugsMap.set(bugKey, {
                    key: bugKey,
                    summary: bug.summary || 'Defecto detectado en ciclo',
                    severity: finalSeverity,
                    assignee: (typeof bug.assignee === 'object' && bug.assignee !== null) ? (bug.assignee.displayName || bug.assignee.name || 'Sin asignar') : (bug.assignee || 'Sin asignar'),
                    status: bug.status || 'Abierto',
                    resolution: resName,
                    isDone: false,
                    version: versionDisplay,
                    versions: affectsVersions,
                    fixVersions: fixVersions,
                    created: bug.created || bug.rawFields?.created || null,
                    resolutiondate: bug.resolutiondate || bug.rawFields?.resolutiondate || null,
                    duedate: bug.duedate || null,
                    cycles: new Set([cycleName]),
                    affectedCases: new Map()
                  });
                } else {
                  cycleOpenBugsMap.get(bugKey).cycles.add(cycleName);
                }

                const openEntry = cycleOpenBugsMap.get(bugKey);
                openEntry.affectedCases.set(String(ex.id), {
                  id: ex.id,
                  key: tcKeyDisplay,
                  summary: tcSummary,
                  status: ex.status,
                  cycleName: cycleName
                });
              }
            });
          }
        });
      }
    });

    // Filter and consolidate project bugs
    const currentProjObj = projects.find(p => String(p.id) === String(selectedProjectId) || String(p.key) === String(selectedProjectId));
    const currentProjKey = currentProjObj?.key;

    // Filter project bugs by workspace project and valid bug type
    const relevantProjectBugs = unlinkedBugs.filter(b => {
      if (!isActualBug(b)) return false;
      if (b.project) {
        const pKey = typeof b.project === 'object' ? (b.project.key || b.project.id) : String(b.project);
        if (currentProjKey && pKey && pKey !== currentProjKey && !b.key.startsWith(currentProjKey + '-')) return false;
      } else if (currentProjKey && b.key && !b.key.startsWith(currentProjKey + '-')) {
        return false;
      }
      return true;
    });

    const allBugsMap = new Map(planAllBugsMap);
    const projectUnlinkedBugs = [];

    relevantProjectBugs.forEach(ub => {
      const isDone = isBugDone(ub);
      const finalSeverity = normalizeSeverity(ub.severity, ub.rawFields);
      const isLinkedToAnyTest = ub.isLinked || (ub.linkedTests && ub.linkedTests.length > 0);

      const rawAff = ub.versions || ub.rawFields?.versions || [];
      const rawFix = ub.fixVersions || ub.rawFields?.fixVersions || [];
      const affectsVersions = (Array.isArray(rawAff) ? rawAff : [rawAff]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
      const fixVersions = (Array.isArray(rawFix) ? rawFix : [rawFix]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
      const versionDisplay = (ub.version && ub.version !== 'Sin versión')
        ? ub.version 
        : (affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión'));

      // Resolve origin cycles for any linked tests / runs
      const foundCycles = new Set();
      const affectedMap = new Map();

      // Search target cycles: target cycles for Plan bugs should ALWAYS be planCycles (or all project cycles if no plan selected)
      const targetCyclesForBugs = (reportSelectedPlans && reportSelectedPlans.length > 0)
        ? (planCycles || [])
        : (testCycles && testCycles.length > 0 ? testCycles : (reportData?.cycles || []));

      // 1. Populate affectedMap if bug has linked test cases in Jira
      if (ub.linkedTests && ub.linkedTests.length > 0) {
        ub.linkedTests.forEach(lt => {
          const tcKey = lt.key || lt.id;
          if (tcKey) {
            affectedMap.set(tcKey, {
              key: lt.key,
              summary: lt.summary,
              status: lt.status || 'Ejecutado',
              type: lt.type
            });
          }
        });
      }

      // 2. Associate bug to cycle ONLY if bug belongs to that cycle (via execution or version match)
      targetCyclesForBugs.forEach(c => {
        const cName = c.summary || c.key || String(c.id);
        if (bugMatchesCycle(ub, c)) {
          foundCycles.add(cName);
        }
      });

      if (allBugsMap.has(ub.key)) {
        // Bug was already registered in a cycle execution of this plan — enrich its linked test details
        const existing = allBugsMap.get(ub.key);
        affectedMap.forEach((val, k) => {
          if (!existing.affectedCases.has(k)) {
            existing.affectedCases.set(k, val);
          }
        });
        // Only add inferred cycle if existing has no direct execution cycle
        if (!existing.cycles || existing.cycles.size === 0) {
          foundCycles.forEach(cName => {
            existing.cycles.add(cName);
          });
        }
        if (!existing.version || existing.version === 'Sin versión') {
          existing.version = versionDisplay;
        }
        if (!existing.created) {
          existing.created = ub.created || ub.rawFields?.created || null;
        }
        if (!existing.resolutiondate) {
          existing.resolutiondate = ub.resolutiondate || ub.rawFields?.resolutiondate || null;
        }
        if (!existing.duedate) {
          existing.duedate = ub.duedate || ub.rawFields?.duedate || null;
        }
      } else {
        // Bug is in the project but wasn't part of planAllBugsMap
        // ONLY include if it matched at least one target cycle in scope
        if (foundCycles.size > 0) {
          allBugsMap.set(ub.key, {
            key: ub.key,
            summary: ub.summary || (isLinkedToAnyTest ? 'Defecto vinculado a prueba' : 'Defecto sin vincular'),
            severity: finalSeverity,
            assignee: (typeof ub.assignee === 'object' && ub.assignee !== null) ? (ub.assignee.displayName || ub.assignee.name || 'Sin asignar') : (ub.assignee || 'Sin asignar'),
            status: ub.status || (isDone ? 'Cerrado' : 'Abierto'),
            resolution: ub.resolution || (isDone ? 'Resuelto' : 'Sin resolver'),
            isDone: isDone,
            isUnlinked: !isLinkedToAnyTest && foundCycles.size === 0,
            version: versionDisplay,
            versions: affectsVersions,
            fixVersions: fixVersions,
            created: ub.created || ub.rawFields?.created || null,
            resolutiondate: ub.resolutiondate || ub.rawFields?.resolutiondate || null,
            duedate: ub.duedate || ub.rawFields?.duedate || null,
            cycles: foundCycles,
            affectedCases: affectedMap
          });
        }

        if (!isLinkedToAnyTest) {
          projectUnlinkedBugs.push({
            ...ub,
            version: versionDisplay,
            versions: affectsVersions,
            fixVersions: fixVersions,
            created: ub.created || ub.rawFields?.created || null,
            resolutiondate: ub.resolutiondate || ub.rawFields?.resolutiondate || null,
            duedate: ub.duedate || ub.rawFields?.duedate || null
          });
        }
      }
    });

    const sortBugsByCreatedDesc = (a, b) => {
      const timeA = a && a.created ? new Date(a.created).getTime() : 0;
      const timeB = b && b.created ? new Date(b.created).getTime() : 0;
      const validA = isNaN(timeA) ? 0 : timeA;
      const validB = isNaN(timeB) ? 0 : timeB;
      if (validA !== validB) return validB - validA;
      const numA = parseInt((a?.key || '').split('-')[1] || '0', 10);
      const numB = parseInt((b?.key || '').split('-')[1] || '0', 10);
      if (numA !== numB) return numB - numA;
      return (b?.key || '').localeCompare(a?.key || '');
    };

    projectUnlinkedBugs.sort(sortBugsByCreatedDesc);

    const openUnlinkedBugs = projectUnlinkedBugs.filter(b => !isBugDone(b));
    const closedUnlinkedBugs = projectUnlinkedBugs.filter(b => isBugDone(b));

    let planGeneralBugsList = Array.from(allBugsMap.values()).map(item => ({
      ...item,
      cycleList: item.cycles && item.cycles.size > 0 ? Array.from(item.cycles).join(', ') : 'Sin vincular',
      affectedCount: item.affectedCases ? item.affectedCases.size : 0,
      affectedCasesList: item.affectedCases ? Array.from(item.affectedCases.values()) : []
    })).sort(sortBugsByCreatedDesc);

    // Strictly scope planGeneralBugsList to the selected test plan(s)
    // NOTE: It intentionally ignores the cycle filter (reportSelectedCycles) so that Table 2 represents the whole Plan
    if (reportSelectedPlans && reportSelectedPlans.length > 0) {
      planGeneralBugsList = planGeneralBugsList.filter(b => 
        planCycles.some(pc => bugMatchesCycle(b, pc))
      );
    }

    // Filter by affected version if selected
    if (reportSelectedVersions && reportSelectedVersions.length > 0) {
      planGeneralBugsList = planGeneralBugsList.filter(b => matchSelectedVersions(b, reportSelectedVersions));
    }

    // Cycle-specific Bug Totals (Used in Runs subview and Cycle bugs)
    let criticalCycleBugs = Array.from(cycleOpenBugsMap.values()).map(item => ({
      ...item,
      affectedCount: item.affectedCases ? item.affectedCases.size : 0,
      affectedCasesList: item.affectedCases ? Array.from(item.affectedCases.values()) : []
    })).sort(sortBugsByCreatedDesc);

    let cycleAllBugsList = Array.from(cycleAllBugsMap.values()).sort(sortBugsByCreatedDesc);

    const activeCyclesForVersions = (reportSelectedCycles && reportSelectedCycles.length > 0)
      ? filteredCycles
      : ((reportSelectedPlans && reportSelectedPlans.length > 0) ? planCycles : (planCycles.length > 0 ? planCycles : (testCycles || [])));

    // Extract available versions for filtering across dashboard entities
    const availableDashboardVersions = Array.from(new Set(
      [
        ...(planGeneralBugsList.flatMap(b => b.versions || (b.version && b.version !== 'Sin versión' ? [b.version] : []))),
        ...(activeCyclesForVersions.flatMap(c => {
          const cVers = extractVersions(c, false);
          return cVers.versions;
        }))
      ].filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    // Filter by affected version if selected
    if (reportSelectedVersions && reportSelectedVersions.length > 0) {
      criticalCycleBugs = criticalCycleBugs.filter(b => matchSelectedVersions(b, reportSelectedVersions));
      cycleAllBugsList = cycleAllBugsList.filter(b => matchSelectedVersions(b, reportSelectedVersions));
    }

    // Global / Plan-wide Bug Totals (Used in Bugs subview)
    const totalAllPlanBugs = planGeneralBugsList.length;
    const totalAllBugs = totalAllPlanBugs;
    const totalOpenPlanBugs = planGeneralBugsList.filter(b => !b.isDone).length;
    const totalOpenBugs = totalOpenPlanBugs;
    const totalClosedPlanBugs = planGeneralBugsList.filter(b => b.isDone).length;
    const totalClosedBugs = totalClosedPlanBugs;

    const totalCycleBugs = cycleAllBugsList.length;
    const openCycleBugs = cycleAllBugsList.filter(b => !b.isDone).length;
    const closedCycleBugs = cycleAllBugsList.filter(b => b.isDone).length;

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
        const pl = testPlans.find(p => String(p.id) === String(reportSelectedPlans[0]));
        scopePlansText = pl?.summary || 'Plan seleccionado';
      } else if (reportSelectedPlans.length > 1) {
        scopePlansText = `${reportSelectedPlans.length} Planes seleccionados`;
      }

      // Cycle bugs array (Scoped strictly to active cycle runs, filtered by version if selected)
      let cycleBugsArray = (cycleAllBugsList || []).slice().sort(sortBugsByCreatedDesc);

      // Blocker bugs from the general test plan bug table (Only Bloqueante / Blocker AND ONLY OPEN: "deberían ser sólo los abiertos. Los cerrados no importan.")
      const isBlockerBug = (bug) => {
        const s = String(bug.severity || '').toLowerCase();
        return s.includes('bloq') || s.includes('blocker');
      };
      let generalBlockerBugs = (planGeneralBugsList || []).filter(b => isBlockerBug(b) && !b.isDone);
      generalBlockerBugs.sort(sortBugsByCreatedDesc);
      const openGeneralBlockersCount = generalBlockerBugs.length;
      const closedGeneralBlockersCount = (planGeneralBugsList || []).filter(b => isBlockerBug(b) && b.isDone).length;

      // Version extraction from cycle bugs or test cases & blocker bugs
      const uniqueVersionsSet = new Set();
      cycleBugsArray.forEach(b => {
        if (b.version && b.version !== 'Sin versión') uniqueVersionsSet.add(b.version);
        if (Array.isArray(b.versions)) b.versions.forEach(v => v && uniqueVersionsSet.add(v));
        if (Array.isArray(b.fixVersions)) b.fixVersions.forEach(v => v && uniqueVersionsSet.add(v));
      });
      generalBlockerBugs.forEach(b => {
        if (b.version && b.version !== 'Sin versión') uniqueVersionsSet.add(b.version);
        if (Array.isArray(b.versions)) b.versions.forEach(v => v && uniqueVersionsSet.add(v));
        if (Array.isArray(b.fixVersions)) b.fixVersions.forEach(v => v && uniqueVersionsSet.add(v));
      });
      const scopeVersionsText = (reportSelectedVersions && reportSelectedVersions.length > 0)
        ? reportSelectedVersions.join(', ')
        : (uniqueVersionsSet.size > 0 ? Array.from(uniqueVersionsSet).join(', ') : null);

      // ── 1. Table Rows: Cycle Bugs ──
      let tableRows = '';
      if (cycleBugsArray.length === 0) {
        tableRows = `
          <tr>
            <td colspan="6" style="border: 1px solid #DFE1E6; padding: 14px; text-align: center; color: #006644; background-color: #E3FCEF; font-weight: 600;">
              🟢 No se registraron defectos vinculados en las ejecuciones del ciclo actual.
            </td>
          </tr>
        `;
      } else {
        cycleBugsArray.forEach((bug, idx) => {
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

          // Dates, Aging & TTR
          const bugCreated = formatBugCreatedDate(bug.created);
          const bugAge = formatBugAge(bug.created, bug.resolutiondate, bug.isDone);
          let resFormatted = null;
          if (bug.isDone && bug.resolutiondate) {
            resFormatted = formatBugCreatedDate(bug.resolutiondate);
          }

          let agePillBg = '#E3FCEF';
          let agePillColor = '#006644';
          let agePillBorder = '#ABF5D1';
          if (!bug.isDone) {
            if (bugAge.tone === 'orange') {
              agePillBg = '#FFF0B3';
              agePillColor = '#172B4D';
              agePillBorder = '#FFE380';
            } else if (bugAge.tone === 'red') {
              agePillBg = '#FFEBE6';
              agePillColor = '#BF2600';
              agePillBorder = '#FFBDAD';
            }
          }

          const verVal = bug.version || (Array.isArray(bug.versions) && bug.versions.length > 0 ? bug.versions.join(', ') : (Array.isArray(bug.fixVersions) && bug.fixVersions.length > 0 ? bug.fixVersions.join(', ') : ''));

          tableRows += `
            <tr style="background-color: ${bgRow};">
              <td style="border: 1px solid #DFE1E6; padding: 8px 8px; font-weight: 700; width: 15%; vertical-align: top;">
                <a href="${baseUrl}/browse/${bug.key}" style="color: #E1007A; text-decoration: underline; font-size: 13px;" target="_blank">
                  ${bug.key}
                </a>
                ${verVal && verVal !== 'Sin versión' ? `
                  <div style="margin-top: 4px;">
                    <span style="font-size: 10px; font-weight: 700; color: #0C66E4; background-color: #E9F2FF; border: 1px solid #CCE0FF; padding: 1px 5px; border-radius: 4px; display: inline-block;">
                      🏷️ ${verVal}
                    </span>
                  </div>` : ''}
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 8px 8px; color: #172B4D; font-size: 12px; line-height: 1.35; width: 31%; word-break: break-word; overflow-wrap: break-word; vertical-align: top;">
                ${bug.summary || 'Sin resumen'}
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; width: 11%; vertical-align: top;">
                <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${sevBg}; color: ${sevColor}; white-space: nowrap;">
                  ${bug.severity || 'Media'}
                </span>
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; width: 11%; vertical-align: top;">
                <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${statusBg}; color: ${statusColor}; white-space: nowrap;">
                  ${bug.status || (bug.isDone ? 'Cerrado' : 'Abierto')}
                </span>
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 8px 8px; width: 20%; vertical-align: top; font-size: 11px;">
                <div style="color: #626F86; margin-bottom: 3px;">
                  📅 <strong>Creado:</strong> ${bugCreated.dateStr}${bugCreated.timeStr ? ` ${bugCreated.timeStr}` : ''}
                </div>
                <div style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${agePillBg}; color: ${agePillColor}; border: 1px solid ${agePillBorder};">
                  ${bug.isDone ? `✅ ${bugAge.label}` : `⏱️ ${bugAge.label}`}
                </div>
                ${bug.isDone && resFormatted?.dateStr ? `
                  <div style="color: #006644; font-size: 10px; margin-top: 3px;">
                    🏁 Resuelto: ${resFormatted.dateStr}${resFormatted.timeStr ? ` ${resFormatted.timeStr}` : ''}
                  </div>` : ''}
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 8px 8px; color: #44546F; font-size: 11px; width: 12%; word-break: break-word; vertical-align: top;">
                <div style="font-weight: 600; color: #172B4D;">${bug.assignee || 'Sin asignar'}</div>
                <div style="color: #626F86; font-size: 10px; margin-top: 2px;">${bug.resolution || (bug.isDone ? 'Resuelto' : 'Sin resolver')}</div>
              </td>
            </tr>
          `;
        });
      }

      // ── 2. Table Rows: General Plan Blocker Bugs (Only Bloqueantes Abiertos) ──
      let generalBlockerTableRows = '';
      if (generalBlockerBugs.length === 0) {
        generalBlockerTableRows = `
          <tr>
            <td colspan="6" style="border: 1px solid #DFE1E6; padding: 14px; text-align: center; color: #006644; background-color: #E3FCEF; font-weight: 600;">
              🟢 No se registran defectos bloqueantes abiertos en la relación general del plan de pruebas.
            </td>
          </tr>
        `;
      } else {
        generalBlockerBugs.forEach((bug, idx) => {
          const isEven = idx % 2 === 0;
          const bgRow = isEven ? '#FFFFFF' : '#FAFBFC';
          
          // Severity styling (Bloqueante Red Badge)
          const sevBg = '#FFEBE6';
          const sevColor = '#BF2600';

          // Status styling
          const statusBg = bug.isDone ? '#E3FCEF' : '#FFEBE6';
          const statusColor = bug.isDone ? '#006644' : '#BF2600';

          // Dates, Aging & TTR
          const bugCreated = formatBugCreatedDate(bug.created);
          const bugAge = formatBugAge(bug.created, bug.resolutiondate, bug.isDone);
          let resFormatted = null;
          if (bug.isDone && bug.resolutiondate) {
            resFormatted = formatBugCreatedDate(bug.resolutiondate);
          }

          let agePillBg = '#E3FCEF';
          let agePillColor = '#006644';
          let agePillBorder = '#ABF5D1';
          if (!bug.isDone) {
            if (bugAge.tone === 'orange') {
              agePillBg = '#FFF0B3';
              agePillColor = '#172B4D';
              agePillBorder = '#FFE380';
            } else if (bugAge.tone === 'red') {
              agePillBg = '#FFEBE6';
              agePillColor = '#BF2600';
              agePillBorder = '#FFBDAD';
            }
          }

          const verVal = bug.version || (Array.isArray(bug.versions) && bug.versions.length > 0 ? bug.versions.join(', ') : (Array.isArray(bug.fixVersions) && bug.fixVersions.length > 0 ? bug.fixVersions.join(', ') : ''));
          const cycleDisplay = bug.cycleList && bug.cycleList !== 'Sin vincular' ? bug.cycleList : 'General del Plan';

          generalBlockerTableRows += `
            <tr style="background-color: ${bgRow};">
              <td style="border: 1px solid #DFE1E6; padding: 8px 8px; font-weight: 700; width: 14%; vertical-align: top;">
                <a href="${baseUrl}/browse/${bug.key}" style="color: #DE350B; text-decoration: underline; font-size: 13px; font-weight: 800;" target="_blank">
                  ${bug.key}
                </a>
                ${verVal && verVal !== 'Sin versión' ? `
                  <div style="margin-top: 4px;">
                    <span style="font-size: 10px; font-weight: 700; color: #0C66E4; background-color: #E9F2FF; border: 1px solid #CCE0FF; padding: 1px 5px; border-radius: 4px; display: inline-block;">
                      🏷️ ${verVal}
                    </span>
                  </div>` : ''}
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 8px 8px; color: #172B4D; font-size: 12px; line-height: 1.35; width: 28%; word-break: break-word; overflow-wrap: break-word; vertical-align: top;">
                ${bug.summary || 'Sin resumen'}
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; width: 12%; vertical-align: top;">
                <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${sevBg}; color: ${sevColor}; border: 1px solid #FFBDAD; white-space: nowrap;">
                  ✱ Bloqueante
                </span>
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; width: 11%; vertical-align: top;">
                <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${statusBg}; color: ${statusColor}; white-space: nowrap;">
                  ${bug.status || (bug.isDone ? 'Cerrado' : 'Abierto')}
                </span>
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 8px 6px; width: 15%; vertical-align: top; font-size: 11px; color: #44546F; word-break: break-word;">
                <div style="font-weight: 600; color: #172B4D;">🔄 ${cycleDisplay}</div>
                ${bug.affectedCount > 0 ? `<div style="font-size: 10px; color: #626F86; margin-top: 2px;">${bug.affectedCount} caso(s) afectado(s)</div>` : ''}
              </td>
              <td style="border: 1px solid #DFE1E6; padding: 8px 8px; width: 20%; vertical-align: top; font-size: 11px;">
                <div style="color: #626F86; margin-bottom: 3px;">
                  📅 <strong>Creado:</strong> ${bugCreated.dateStr}${bugCreated.timeStr ? ` ${bugCreated.timeStr}` : ''}
                </div>
                <div style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; background-color: ${agePillBg}; color: ${agePillColor}; border: 1px solid ${agePillBorder};">
                  ${bug.isDone ? `✅ ${bugAge.label}` : `⏱️ ${bugAge.label}`}
                </div>
                ${bug.isDone && resFormatted?.dateStr ? `
                  <div style="color: #006644; font-size: 10px; margin-top: 3px;">
                    🏁 Resuelto: ${resFormatted.dateStr}${resFormatted.timeStr ? ` ${resFormatted.timeStr}` : ''}
                  </div>` : ''}
                <div style="color: #44546F; font-size: 10px; margin-top: 4px;">
                  👤 <strong>Resp:</strong> ${bug.assignee || 'Sin asignar'}
                </div>
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
        featureKeys.forEach((fk, idx) => {
          const mod = featureStats[fk];
          const mRate = mod.total > 0 ? ((mod.passed / mod.total) * 100).toFixed(0) : '0';
          const isEven = idx % 2 === 0;
          modRows += `
            <tr style="background-color: ${isEven ? '#FFFFFF' : '#FAFBFC'};">
              <td style="border: 1px solid #DFE1E6; padding: 6px 8px; font-weight: 600; color: #172B4D;">${fk}</td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; font-weight: 700;">${mod.total}</td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; color: #006644; font-weight: 700;">${mod.passed}</td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; color: #DE350B; font-weight: 700;">${mod.failed}</td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; color: #FF8B00; font-weight: 700;">${mod.blocked}</td>
              <td style="border: 1px solid #DFE1E6; padding: 6px 6px; text-align: center; font-weight: 700; color: ${Number(mRate) >= 80 ? '#006644' : '#DE350B'};">${mRate}%</td>
            </tr>
          `;
        });

        moduleSectionHtml = `
          <div style="margin-bottom: 22px;">
            <div style="font-size: 13px; font-weight: 700; color: #002D62; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">
              📁 Cobertura Funcional por Módulo / Funcionalidad
            </div>
            <table width="100%" cellpadding="6" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #DFE1E6; border-radius: 6px; overflow: hidden;">
              <thead>
                <tr style="background-color: #F4F5F7; color: #172B4D;">
                  <th style="border: 1px solid #DFE1E6; padding: 8px 10px; text-align: left; font-weight: 700;">Módulo / Carpeta</th>
                  <th style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; font-weight: 700;">Total</th>
                  <th style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; font-weight: 700; color: #006644;">Pasados</th>
                  <th style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; font-weight: 700; color: #DE350B;">Fallidos</th>
                  <th style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; font-weight: 700; color: #FF8B00;">Bloqueados</th>
                  <th style="border: 1px solid #DFE1E6; padding: 8px 6px; text-align: center; font-weight: 700;">% Éxito</th>
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
      if (numSuccess >= 90 && openCycleBugs === 0 && openGeneralBlockersCount === 0) {
        verdictText = '🟢 <strong>Estado Favorable (Aprobado):</strong> La suite de pruebas presenta una alta tasa de éxito y no se registran defectos bloqueantes abiertos en el ciclo ni en el plan. El avance se encuentra en condiciones óptimas para pase a producción o liberación.';
      } else if (openGeneralBlockersCount > 0) {
        verdictText = `🔴 <strong>Estado Crítico (Defectos Bloqueantes Activos):</strong> Se detectaron <strong>${openGeneralBlockersCount} defecto(s) bloqueante(s) abiertos</strong> en el plan general que impiden la liberación segura. La tasa de éxito actual es del ${successRate}%.`;
      } else if (numSuccess >= 75) {
        verdictText = `🟡 <strong>Estado con Observaciones (Riesgo Moderado):</strong> Se alcanzó una tasa de éxito del ${successRate}%, con ${openCycleBugs} defecto(s) abierto(s) en el ciclo que requieren seguimiento antes del cierre final.`;
      } else {
        verdictText = `🔴 <strong>Estado Crítico (Riesgo Alto):</strong> La tasa de éxito actual es del ${successRate}% con ${openCycleBugs} defecto(s) abierto(s) y ${failed} caso(s) fallido(s). Se recomienda estabilizar las incidencias reportadas antes de autorizar la liberación.`;
      }

      const htmlTemplate = `
        <div style="max-width: 780px; margin: 0 auto; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #172B4D; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0, 45, 98, 0.08);">
          <style>
            @keyframes liverpoolGlowPulse {
              0% {
                transform: scale(1);
                filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.7)) brightness(1);
              }
              50% {
                transform: scale(1.05);
                filter: drop-shadow(0 0 10px #FFFFFF) drop-shadow(0 0 22px #FFE0F0) brightness(1.25);
              }
              100% {
                transform: scale(1);
                filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.7)) brightness(1);
              }
            }
            .liverpool-animated-logo {
              animation: liverpoolGlowPulse 2.4s ease-in-out infinite alternate !important;
              display: inline-block !important;
              transition: all 0.3s ease-in-out !important;
            }
            .liverpool-animated-logo:hover {
              transform: scale(1.08) !important;
              filter: drop-shadow(0 0 14px #FFFFFF) drop-shadow(0 0 26px #FFE0F0) brightness(1.3) !important;
            }
          </style>
          
          <!-- Header Banner (Liverpool Gradient & Logo) -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #E1007A 0%, #002D62 100%); background-color: #E1007A; color: #ffffff; padding: 22px 26px;">
            <tr>
              <td style="vertical-align: middle;">
                <div style="font-size: 13px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: #FFE0F0; margin-bottom: 8px;">
                  ⚡ TEST PULSE SUITE • REPORTE DE ESTATUS
                </div>
                <div style="margin-top: 4px;">
                  <img src="${LIVERPOOL_LOGO_WHITE_ANIMATED_B64 || LIVERPOOL_LOGO_WHITE_B64}" alt="Liverpool" class="liverpool-animated-logo" style="height: 30px; width: auto; max-width: 150px; display: block; border: 0;" />
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
                <td style="padding: 4px 8px; font-size: 13px; vertical-align: top;">
                  <strong style="color: #626F86; font-size: 11px; text-transform: uppercase;">Proyecto:</strong><br/>
                  <span style="font-weight: 700; color: #E1007A; font-size: 14px;">${projectDisplay}</span>
                </td>
                <td style="padding: 4px 8px; font-size: 13px; vertical-align: top;">
                  <strong style="color: #626F86; font-size: 11px; text-transform: uppercase;">Ambiente:</strong><br/>
                  <span style="font-weight: 700; color: #002D62; font-size: 14px;">🟢 QA</span>
                </td>
                <td style="padding: 4px 8px; font-size: 13px; vertical-align: top;">
                  <strong style="color: #626F86; font-size: 11px; text-transform: uppercase;">Plan(es):</strong><br/>
                  <span style="font-weight: 600; color: #172B4D;">${scopePlansText}</span>
                </td>
                <td style="padding: 4px 8px; font-size: 13px; vertical-align: top;">
                  <strong style="color: #626F86; font-size: 11px; text-transform: uppercase;">Ciclo(s):</strong><br/>
                  <span style="font-weight: 600; color: #172B4D;">${scopeCyclesText}</span>
                </td>
                ${scopeVersionsText ? `
                <td style="padding: 4px 8px; font-size: 13px; vertical-align: top;">
                  <strong style="color: #626F86; font-size: 11px; text-transform: uppercase;">Versión / Build:</strong><br/>
                  <span style="font-weight: 700; color: #0C66E4; font-size: 13px;">${scopeVersionsText}</span>
                </td>` : ''}
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

                <!-- Card 4: Defectos del Ciclo -->
                <td width="20%" style="padding: 0 4px;">
                  <div style="background: #FFF1F0; border: 1px solid #FFCCC7; border-radius: 8px; padding: 12px 8px; text-align: center;">
                    <div style="font-size: 11px; font-weight: 700; color: #BF2600; text-transform: uppercase; margin-bottom: 4px;">Defectos Ciclo</div>
                    <div style="font-size: 22px; font-weight: 800; color: #CF1322; line-height: 1.1;">${totalCycleBugs}</div>
                    <div style="font-size: 11px; color: #BF2600; margin-top: 4px;"><strong>${openCycleBugs}</strong> abiertos (${closedCycleBugs} cerrados)</div>
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

            <!-- Resumen de Cambios & Actividad del Ciclo -->
            <div style="background-color: #F8F9FA; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px 18px; margin-bottom: 22px;">
              <div style="margin-bottom: 10px;">
                <span style="font-size: 13px; font-weight: 800; color: #002D62; text-transform: uppercase; letter-spacing: 0.5px;">
                  📋 Resumen de Cambios & Actividad
                </span>
                <span style="font-size: 11px; font-weight: 600; color: #626F86; background: #EBECF0; padding: 2px 8px; border-radius: 12px; margin-left: 8px;">
                  Corte: ${dateFormatted}
                </span>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 12px; line-height: 1.6; color: #172B4D;">
                <tr>
                  <td width="33%" style="vertical-align: top; padding-right: 12px;">
                    <div style="font-weight: 700; color: #0E8A4C; margin-bottom: 4px;">✅ Avance de Ejecución</div>
                    <div style="color: #44546F; font-size: 11.5px;">
                      • <strong>${ejecutados}</strong> de ${allTotal} casos evaluados (<strong>${coverageRate}%</strong> cobertura).<br/>
                      • <strong>${passed}</strong> aprobados (${successRate}% éxito).
                    </div>
                  </td>
                  <td width="33%" style="vertical-align: top; padding-right: 12px; border-left: 1px solid #E2E8F0; padding-left: 12px;">
                    <div style="font-weight: 700; color: #DE350B; margin-bottom: 4px;">🐞 Estatus de Defectos</div>
                    <div style="color: #44546F; font-size: 11.5px;">
                      • <strong>${openCycleBugs}</strong> defecto(s) abiertos en el ciclo actual.<br/>
                      • <strong>${openGeneralBlockersCount}</strong> defecto(s) bloqueante(s) abiertos en el plan general.<br/>
                      • MTTR de resolución: <strong>${avgResolutionHours}h</strong> hábiles.
                    </div>
                  </td>
                  <td width="34%" style="vertical-align: top; border-left: 1px solid #E2E8F0; padding-left: 12px;">
                    <div style="font-weight: 700; color: #0C66E4; margin-bottom: 4px;">🎯 Estabilidad & Cierre</div>
                    <div style="color: #44546F; font-size: 11.5px;">
                      ${notRun > 0 ? `• Restan <strong>${notRun}</strong> caso(s) por ejecutar.<br/>` : `• <strong>100% de los casos</strong> evaluados en el ciclo.<br/>`}
                      ${openGeneralBlockersCount > 0 ? `• ⛔ <strong>${openGeneralBlockersCount} Bloqueante(s) Abierto(s) en Plan</strong> impiden liberación.` : (openCycleBugs === 0 ? `• 🟢 Sin defectos bloqueantes ni abiertos que impidan liberación.` : `• ⚠️ Requiere seguimiento de defectos antes de liberar.`)}
                    </div>
                  </td>
                </tr>
              </table>
            </div>

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

            <!-- Defect Matrix Table (Scoped Strictly to Active Cycle) -->
            <div style="margin-bottom: 22px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="font-size: 13px; font-weight: 700; color: #002D62; text-transform: uppercase; letter-spacing: 0.5px;">
                  🐞 DEFECTOS DEL CICLO ACTUAL (${cycleBugsArray.length})
                </div>
                <span style="font-size: 11px; font-weight: 600; color: #626F86; background: #EBECF0; padding: 2px 8px; border-radius: 12px;">
                  Todos los defectos vinculados al ciclo
                </span>
              </div>
              <table width="100%" cellpadding="6" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #DFE1E6; border-radius: 6px; overflow: hidden; table-layout: fixed;">
                <thead>
                  <tr style="background-color: #002D62; color: #ffffff;">
                    <th style="border: 1px solid #002D62; padding: 8px 8px; text-align: left; font-weight: 700; width: 15%;">Incidencia</th>
                    <th style="border: 1px solid #002D62; padding: 8px 8px; text-align: left; font-weight: 700; width: 31%;">Resumen</th>
                    <th style="border: 1px solid #002D62; padding: 8px 6px; text-align: center; font-weight: 700; width: 11%;">Severidad</th>
                    <th style="border: 1px solid #002D62; padding: 8px 6px; text-align: center; font-weight: 700; width: 11%;">Estado</th>
                    <th style="border: 1px solid #002D62; padding: 8px 8px; text-align: left; font-weight: 700; width: 20%;">Línea de Tiempo / TTR</th>
                    <th style="border: 1px solid #002D62; padding: 8px 8px; text-align: left; font-weight: 700; width: 12%;">Responsable</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows}
                </tbody>
              </table>
            </div>

            <!-- General Plan Blocker Defects Table (Only Bloqueantes Abiertos) -->
            <div style="margin-bottom: 22px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="font-size: 13px; font-weight: 700; color: #BF2600; text-transform: uppercase; letter-spacing: 0.5px;">
                  ⛔ DEFECTOS BLOQUEANTES DE LA RELACIÓN GENERAL DEL PLAN (${generalBlockerBugs.length})
                </div>
                <span style="font-size: 11px; font-weight: 600; color: #BF2600; background: #FFEBE6; border: 1px solid #FFBDAD; padding: 2px 8px; border-radius: 12px;">
                  Filtrado estricto: Solo Bloqueantes Abiertos
                </span>
              </div>
              <table width="100%" cellpadding="6" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #DFE1E6; border-radius: 6px; overflow: hidden; table-layout: fixed;">
                <thead>
                  <tr style="background-color: #BF2600; color: #ffffff;">
                    <th style="border: 1px solid #BF2600; padding: 8px 8px; text-align: left; font-weight: 700; width: 14%;">Incidencia</th>
                    <th style="border: 1px solid #BF2600; padding: 8px 8px; text-align: left; font-weight: 700; width: 28%;">Resumen</th>
                    <th style="border: 1px solid #BF2600; padding: 8px 6px; text-align: center; font-weight: 700; width: 12%;">Severidad</th>
                    <th style="border: 1px solid #BF2600; padding: 8px 6px; text-align: center; font-weight: 700; width: 11%;">Estado</th>
                    <th style="border: 1px solid #BF2600; padding: 8px 6px; text-align: left; font-weight: 700; width: 15%;">Ciclos / Origen</th>
                    <th style="border: 1px solid #BF2600; padding: 8px 8px; text-align: left; font-weight: 700; width: 20%;">Línea de Tiempo / TTR</th>
                  </tr>
                </thead>
                <tbody>
                  ${generalBlockerTableRows}
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
                ${openGeneralBlockersCount > 0 ? `<li>⛔ <strong>Prioridad Crítica:</strong> Resolver de inmediato los <strong>${openGeneralBlockersCount}</strong> defecto(s) bloqueante(s) abiertos en el plan general.</li>` : ''}
                <li>Priorizar la atención y resolución de los <strong>${openCycleBugs}</strong> defectos abiertos en el ciclo con el equipo de desarrollo.</li>
                <li>Realizar re-test de casos fallidos tras el despliegue del siguiente build o corrección.</li>
                ${notRun > 0 ? `<li>Completar la ejecución de los <strong>${notRun}</strong> casos pendientes para alcanzar la cobertura total.</li>` : '<li>Cierre formal y firma del ciclo de pruebas tras verificación de criterios de aceptación.</li>'}
              </ul>
            </div>

          </div>

          <!-- Footer -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #FAFBFC; border-top: 1px solid #EBECF0; padding: 14px 26px;">
            <tr>
              <td style="font-size: 11px; color: #626F86;">
                Test Pulse Suite ${APP_VERSION} • Jira Cloud Quality Management • El Puerto de Liverpool
              </td>
              <td style="font-size: 11px; color: #626F86; text-align: right;">
                Generado automáticamente
              </td>
            </tr>
          </table>

        </div>
      `;

      // Plain text fallback
      const plainText = `TEST PULSE SUITE - REPORTE DE ESTATUS\nProyecto: ${projectDisplay}\nFecha: ${dateFormatted}\nVersión: ${scopeVersionsText || 'N/A'}\nCasos Totales: ${allTotal} | Éxito: ${successRate}% (${passed} Pasados)\nCobertura: ${coverageRate}% | Defectos del Ciclo: ${cycleBugsArray.length} (${openCycleBugs} abiertos, ${closedCycleBugs} cerrados) | Defectos Bloqueantes Abiertos en Plan: ${openGeneralBlockersCount} | MTTR Prom: ${avgResolutionHours}h\nAlcance: ${scopeCyclesText} / ${scopePlansText}`;
      const emailSubject = `[Reporte de Estatus] ${currentProjectName} - ${scopeCyclesText} (${successRate}% Éxito - ${openCycleBugs} Defectos en Ciclo${openGeneralBlockersCount > 0 ? ` | ⛔ ${openGeneralBlockersCount} Bloqueantes Abiertos` : ''})`;

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
        scopeVersionsText,
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
          totalCycleBugs,
          openCycleBugs,
          closedCycleBugs,
          totalGeneralBlockerBugs: generalBlockerBugs.length,
          openGeneralBlockerBugs: openGeneralBlockersCount,
          closedGeneralBlockerBugs: closedGeneralBlockersCount,
          avgResolutionHours
        },
        generalBlockerBugs: generalBlockerBugs.map(b => ({
          key: b.key,
          summary: b.summary,
          severity: b.severity,
          status: b.status,
          isDone: b.isDone,
          assignee: b.assignee,
          created: b.created,
          cycles: Array.from(b.cycles || [])
        }))
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
          source: `Test Pulse Suite ${APP_VERSION} (Manual Test Dispatch)`,
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
      if (s.includes('bloq') || s.includes('blocker')) return 1;
      if (s.includes('crit') || s.includes('crític')) return 2;
      if (s.includes('may') || s.includes('major') || s.includes('alta') || s.includes('high')) return 3;
      if (s.includes('med') || s.includes('medio') || s.includes('media') || s.includes('medium')) return 4;
      if (s.includes('men') || s.includes('minor') || s.includes('baja') || s.includes('low') || s.includes('trivial')) return 5;
      return 6;
    };

    const getSeverityClass = (sev) => {
      const s = String(sev || '').toLowerCase();
      if (s.includes('bloq') || s.includes('blocker')) return 'bloqueante';
      if (s.includes('crit') || s.includes('crític')) return 'critico';
      if (s.includes('may') || s.includes('major') || s.includes('alta') || s.includes('high')) return 'mayor';
      if (s.includes('med') || s.includes('medio') || s.includes('media') || s.includes('medium')) return 'medio';
      if (s.includes('men') || s.includes('minor') || s.includes('baja') || s.includes('low') || s.includes('trivial')) return 'menor';
      return 'sin-definir';
    };

    const getSeverityLabel = (sev) => {
      const s = String(sev || '').trim();
      if (!s || s === 'Sin definir' || s === 'N/A') return '○ Sin definir';
      const low = s.toLowerCase();
      if (low.includes('bloq') || low.includes('blocker')) return '✱ BLOQUEANTE';
      if (low.includes('crit') || low.includes('crític')) return '▲ CRÍTICO';
      if (low.includes('may') || low.includes('major') || low.includes('alta') || low.includes('high')) return '● MAYOR';
      if (low.includes('med') || low.includes('medio') || low.includes('media') || low.includes('medium')) return '◆ MEDIO';
      if (low.includes('men') || low.includes('minor') || low.includes('baja') || low.includes('low') || low.includes('trivial')) return '○ MENOR';
      return `● ${s}`;
    };

    // Severity breakdown of OPEN bugs for interactive widget (Opción A)
    const openPlanBugs = planGeneralBugsList.filter(b => !b.isDone);
    const sevOpenCounts = {
      bloqueante: openPlanBugs.filter(b => getSevRank(b.severity) === 1).length,
      critico: openPlanBugs.filter(b => getSevRank(b.severity) === 2).length,
      mayor: openPlanBugs.filter(b => getSevRank(b.severity) === 3).length,
      medio: openPlanBugs.filter(b => getSevRank(b.severity) === 4).length,
      menor: openPlanBugs.filter(b => getSevRank(b.severity) === 5).length,
      sinDefinir: openPlanBugs.filter(b => getSevRank(b.severity) >= 6).length,
      total: openPlanBugs.length
    };

    const allDonutSegments = [
      { key: 'Bloqueante', label: 'Bloqueante', count: sevOpenCounts.bloqueante, color: '#DE350B', bg: '#FFEBE6', border: '#FFBDAD', enabled: conf.showSevBloqueante !== false },
      { key: 'Crítico', label: 'Crítico', count: sevOpenCounts.critico, color: '#E5493A', bg: '#FFF0ED', border: '#FFC4BA', enabled: conf.showSevCritico !== false },
      { key: 'Mayor', label: 'Mayor', count: sevOpenCounts.mayor, color: '#FF8B00', bg: '#FFFAE6', border: '#FFE380', enabled: conf.showSevMayor !== false },
      { key: 'Medio', label: 'Medio', count: sevOpenCounts.medio, color: '#E2B203', bg: '#FFFBE6', border: '#F5CD47', enabled: conf.showSevMedio !== false },
      { key: 'Menor', label: 'Menor', count: sevOpenCounts.menor, color: '#006644', bg: '#E3FCEF', border: '#ABF5D1', enabled: conf.showSevMenor !== false },
      { key: 'Sin definir', label: 'Sin Definir', count: sevOpenCounts.sinDefinir, color: '#626F86', bg: '#F1F2F4', border: '#DCDFE4', enabled: conf.showSevSinDefinir !== false }
    ];
    const donutSegments = allDonutSegments.filter(s => s.enabled);
    const visibleSevOpenTotal = donutSegments.reduce((sum, seg) => sum + seg.count, 0);

    // ── Traceability matrix rows ──
    const traceabilityRows = [];
    filteredCycles.forEach(cycle => {
      if (cycle.execution && Array.isArray(cycle.execution)) {
        const seenTcInCycle = new Set();
        cycle.execution.forEach((ex, idx) => {
          const tc = testCases.find(t => String(t.id) === String(ex.id));
          const tcKey = tc ? tc.key : (ex.key || `TC-${ex.id}`);
          const tcId = String(ex.id || ex.testCaseId || '');
          const dedupeKey = tcKey ? `key_${tcKey}` : (tcId ? `id_${tcId}` : `item_${idx}`);
          if (seenTcInCycle.has(dedupeKey)) return;
          seenTcInCycle.add(dedupeKey);

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
        String(bug.resolution).toLowerCase().includes(q) ||
        (bug.version && String(bug.version).toLowerCase().includes(q))
      );
    }).sort(sortBugsByCreatedDesc);

    const filteredPlanGeneralBugsList = planGeneralBugsList.filter(bug => {
      if (dashboardGeneralBugStatusTab === 'OPEN' && bug.isDone) return false;
      if (dashboardGeneralBugStatusTab === 'CLOSED' && !bug.isDone) return false;

      // Filter by interactive severity widget if selected
      if (selectedDashboardSeverityFilter) {
        const rank = getSevRank(bug.severity);
        if (selectedDashboardSeverityFilter === 'Bloqueante' && rank !== 1) return false;
        if (selectedDashboardSeverityFilter === 'Crítico' && rank !== 2) return false;
        if (selectedDashboardSeverityFilter === 'Mayor' && rank !== 3) return false;
        if (selectedDashboardSeverityFilter === 'Medio' && rank !== 4) return false;
        if (selectedDashboardSeverityFilter === 'Menor' && rank !== 5) return false;
        if (selectedDashboardSeverityFilter === 'Sin definir' && rank < 6) return false;
      }

      if (!dashboardGeneralBugSearch) return true;
      const q = dashboardGeneralBugSearch.toLowerCase().trim();
      return (
        bug.key.toLowerCase().includes(q) ||
        bug.summary.toLowerCase().includes(q) ||
        bug.assignee.toLowerCase().includes(q) ||
        String(bug.severity).toLowerCase().includes(q) ||
        String(bug.status).toLowerCase().includes(q) ||
        String(bug.resolution).toLowerCase().includes(q) ||
        (bug.version && String(bug.version).toLowerCase().includes(q)) ||
        (bug.cycleList && bug.cycleList.toLowerCase().includes(q))
      );
    }).sort(sortBugsByCreatedDesc);

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
        {isFolderSidebarVisible && (
          <>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="ads-lozenge ads-lozenge-success" style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '9999px' }}>
                    LIVE
                  </span>
                  <button
                    onClick={toggleFolderSidebar}
                    title="Ocultar panel lateral (Sidebar)"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '3px',
                      borderRadius: '4px',
                      color: 'var(--jira-subtle, #626F86)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--jira-bg-subtle, #F1F2F4)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                      <path d="M15 15l-3-3 3-3" />
                    </svg>
                  </button>
                </div>
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
                {totalOpenPlanBugs} {totalOpenPlanBugs === 1 ? 'abierto' : 'abiertos'} · {totalClosedPlanBugs} cerrados
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
        </>
        )}

        {/* ─── Main Dashboard View Container ─── */}
        <main className="dashboard-container" style={{ flex: 1, height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: '1.5rem 2rem 6rem 2rem' }}>
          {/* Top Header & Toolbar */}
          <div className="dashboard-top-header">
            <div className="dashboard-header-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {!isFolderSidebarVisible && (
                  <button
                    onClick={toggleFolderSidebar}
                    className="btn-secondary"
                    title="Mostrar panel lateral del Dashboard"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '0.78rem',
                      padding: '0.35rem 0.65rem',
                      borderRadius: '6px'
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                      <path d="M13 9l3 3-3 3" />
                    </svg>
                    <span>Dashboard</span>
                  </button>
                )}
                {!isFolderSidebarVisible && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', background: '#F1F2F4', padding: '2px', borderRadius: '6px', gap: '2px' }}>
                    <button
                      onClick={() => setDashboardSubView('runs')}
                      style={{
                        background: dashboardSubView === 'runs' ? '#FFFFFF' : 'transparent',
                        color: dashboardSubView === 'runs' ? '#0C66E4' : '#626F86',
                        fontWeight: dashboardSubView === 'runs' ? 700 : 500,
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        boxShadow: dashboardSubView === 'runs' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                      }}
                    >
                      📊 Runs
                    </button>
                    <button
                      onClick={() => setDashboardSubView('bugs')}
                      style={{
                        background: dashboardSubView === 'bugs' ? '#FFFFFF' : 'transparent',
                        color: dashboardSubView === 'bugs' ? '#DE350B' : '#626F86',
                        fontWeight: dashboardSubView === 'bugs' ? 700 : 500,
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        boxShadow: dashboardSubView === 'bugs' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                      }}
                    >
                      🐞 Bugs
                    </button>
                    <button
                      onClick={() => setDashboardSubView('traceability')}
                      style={{
                        background: dashboardSubView === 'traceability' ? '#FFFFFF' : 'transparent',
                        color: dashboardSubView === 'traceability' ? '#0C66E4' : '#626F86',
                        fontWeight: dashboardSubView === 'traceability' ? 700 : 500,
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        boxShadow: dashboardSubView === 'traceability' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                      }}
                    >
                      🔗 Traceability
                    </button>
                  </div>
                )}
                <span className="dashboard-live-badge">
                  <span className="dashboard-live-dot" />
                  ● {isHydratingReport 
                      ? `Sincronizando histórico (${reportData?.cycles?.length || 0}/${reportData?.totalCycles || '...'})` 
                      : isRefreshingReport 
                        ? 'Sincronizando...' 
                        : `En vivo · ${reportData._loadedAt ? new Date(reportData._loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Auto-sync silencioso'}`}
                </span>
                <span className="dashboard-tag-context">
                  • Jira Forge App
                </span>
                <span className="dashboard-tag-context">
                  • ID: {currentProjectKey}
                </span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {dashboardSubView === 'runs' && (
                  <button
                    onClick={() => setIsCustomizingDashboard(!isCustomizingDashboard)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      background: isCustomizingDashboard ? '#E9F2FF' : '#FFFFFF',
                      border: '1px solid',
                      borderColor: isCustomizingDashboard ? '#0C66E4' : 'var(--jira-border, #DCDFE4)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      color: isCustomizingDashboard ? '#0C66E4' : 'var(--jira-dark, #172B4D)',
                      fontSize: '12px',
                      fontWeight: 600
                    }}
                    title="Personalizar, reordenar y agregar widgets en el dashboard"
                  >
                    ⚙️ {isCustomizingDashboard ? 'Terminar Personalización' : 'Personalizar Widgets'}
                  </button>
                )}


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
                       {testPlans.map(p => {
                         const isSelected = reportSelectedPlans.some(pId => String(pId) === String(p.id));
                         return (
                           <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '12px' }}>
                             <input type="checkbox" checked={isSelected} onChange={(e) => {
                               let newVals = isSelected 
                                 ? reportSelectedPlans.filter(v => String(v) !== String(p.id))
                                 : [...reportSelectedPlans, String(p.id)];
                               setReportSelectedPlans(newVals);
                               setReportSelectedCycles([]);
                             }} />
                             {p.summary}
                           </label>
                         );
                       })}
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
                       {(() => {
                         const allCyclesList = (testCycles && testCycles.length > 0) ? testCycles : (reportData?.cycles || []);
                         const filteredForDropdown = reportSelectedPlans.length > 0
                           ? allCyclesList.filter(c => reportSelectedPlans.some(pId => String(pId) === String(c.planId)))
                           : allCyclesList;
                         return filteredForDropdown.map(c => {
                           const isSelected = reportSelectedCycles.some(rcId => String(rcId) === String(c.id));
                           return (
                             <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '12px' }}>
                               <input type="checkbox" checked={isSelected} onChange={(e) => {
                                 let newVals = isSelected
                                   ? reportSelectedCycles.filter(v => String(v) !== String(c.id))
                                   : [...reportSelectedCycles, String(c.id)];
                                 setReportSelectedCycles(newVals);
                               }} />
                               {c.summary}
                             </label>
                           );
                         });
                       })()}
                    </div>
                  </details>
                </div>

                {/* 4. Ambiente: QA */}
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
          {/* ─── SUBVIEW 1: RUNS (CUSTOMIZABLE WIDGETS) ─── */}
          {/* ═══════════════════════════════════════════════════════ */}
          {dashboardSubView === 'runs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Customizer Mode Banner */}
              {isCustomizingDashboard && (
                <div className="dashboard-customizer-banner">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>🎨</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--jira-dark, #172B4D)' }}>
                        Modo de Personalización del Tablero
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)' }}>
                        Arrastra las tarjetas para reordenarlas (o usa ◀ ▶). Cambia su ancho (50% / 100%) u ocúltalas (✕).
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      className="btn-primary"
                      onClick={() => setShowAddWidgetModal(true)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', fontSize: '12px' }}
                    >
                      ➕ Agregar Widget
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={handleResetDashboardLayout}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', fontSize: '12px' }}
                      title="Restablecer disposición original"
                    >
                      ↺ Restablecer
                    </button>
                    <button
                      onClick={() => {
                        setIsCustomizingDashboard(false);
                        handleSaveDashboardLayout(dashboardWidgets);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 14px',
                        fontSize: '12px',
                        fontWeight: 700,
                        background: '#006644',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                    >
                      ✓ Guardar y Salir
                    </button>
                  </div>
                </div>
              )}

            {/* ⚠️ Defectos de Jira sin vincular a pruebas Banner */}
            {projectUnlinkedBugs.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  backgroundColor: '#FFF0ED',
                  border: '1px solid #FFBDAD',
                  borderRadius: '8px',
                  marginBottom: '1rem',
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>⚠️</span>
                  <div>
                    <div style={{ color: '#DE350B', fontSize: '13px', fontWeight: 700 }}>
                      Defectos de Jira sin vincular a pruebas ({projectUnlinkedBugs.length})
                    </div>
                    <div style={{ fontSize: '12px', color: '#44546F', marginTop: '2px' }}>
                      Existen {projectUnlinkedBugs.length} {projectUnlinkedBugs.length === 1 ? 'incidencia tipo Bug en Jira que no está asociada' : 'incidencias tipo Bug en Jira que no están asociadas'} a ningún Test Run o caso de prueba.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowUnlinkedBugsModal(true)}
                  style={{
                    backgroundColor: '#DE350B',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '6px 14px',
                    borderRadius: '6px',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(222, 53, 11, 0.3)'
                  }}
                >
                  🔍 Ver y Asociar ({projectUnlinkedBugs.length})
                </button>
              </div>
            )}

            {/* Dynamic Grid of Configured Widgets */}
              <div className="dashboard-widgets-grid">
                {dashboardWidgets
                  .filter(w => w.visible !== false)
                  .map((widget, index) => {
                    const isFull = widget.width === 'full';
                    const isDragging = draggedWidgetIndex === index;

                    return (
                      <div
                        key={widget.id || widget.type}
                        className={`dashboard-widget-wrapper ${isFull ? 'dashboard-widget-full' : 'dashboard-widget-half'} ${isCustomizingDashboard ? 'is-customizing' : ''} ${isDragging ? 'is-dragging' : ''}`}
                        draggable={isCustomizingDashboard}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, index)}
                      >
                        {/* Customizer Edit Toolbar on Top of Each Widget */}
                        {isCustomizingDashboard && (
                          <div className="dashboard-widget-toolbar">
                            <div className="dashboard-widget-drag-handle" title="Arrastrar para reordenar">
                              <span>⠿</span>
                              <span style={{ fontWeight: 700, fontSize: '12px' }}>{widget.title || widget.type}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <button
                                className="widget-mini-btn"
                                disabled={index === 0}
                                onClick={() => handleMoveWidget(index, -1)}
                                title="Mover arriba / izquierda"
                              >
                                ◀
                              </button>
                              <button
                                className="widget-mini-btn"
                                disabled={index === dashboardWidgets.length - 1}
                                onClick={() => handleMoveWidget(index, 1)}
                                title="Mover abajo / derecha"
                              >
                                ▶
                              </button>
                              <button
                                className="widget-mini-btn"
                                onClick={() => handleToggleWidgetWidth(widget.id)}
                                title={isFull ? 'Cambiar a 1 Columna (50%)' : 'Cambiar a 2 Columnas (100%)'}
                              >
                                {isFull ? '◫ 50%' : '▭ 100%'}
                              </button>
                              <button
                                className="widget-mini-btn delete"
                                onClick={() => handleRemoveWidget(widget.id)}
                                title="Quitar widget del tablero"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Widget Content Renderer */}
                        {widget.type === 'kpi_scorecard' && (
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

                            {/* Card 3: Defectos & Bloqueos (Ciclo) */}
                            <div className="dashboard-kpi-card">
                              <div className="dashboard-kpi-header">
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: openCycleBugs > 0 ? '#DE350B' : 'var(--jira-subtle, #626F86)' }}>🐞 DEFECTOS &amp; BLOQUEOS</span>
                                <span className={`dashboard-kpi-pill ${openCycleBugs > 0 ? 'red' : 'green'}`}>
                                  {openCycleBugs} Abiertos
                                </span>
                              </div>
                              <div className="dashboard-kpi-value" style={{ color: openCycleBugs > 0 ? '#DE350B' : 'var(--jira-dark, #172B4D)' }}>
                                {totalCycleBugs} <span style={{ fontSize: '13px', color: 'var(--jira-subtle, #626F86)', fontWeight: 500 }}>({openCycleBugs} abiertos)</span>
                              </div>
                              <div className="dashboard-kpi-footer">
                                <span style={{ color: '#006644', fontWeight: 600 }}>{closedCycleBugs} Cerrados</span>
                                <span style={{ color: openCycleBugs > 0 ? '#DE350B' : 'var(--jira-subtle)', fontWeight: 600 }}>
                                  {openCycleBugs} Abiertos
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
                        )}

                        {widget.type === 'general_status' && (
                          <div className="dashboard-card" style={{ height: '100%' }}>
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
                              <div style={{ position: 'relative', width: '150px', height: '150px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <svg viewBox="0 0 42 42" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                                  <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#EBECF0" strokeWidth="7.5" />
                                  {allTotal > 0 && (
                                    <>
                                      {pPct > 0 && <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#36B37E" strokeWidth="7.5" strokeDasharray={`${pPct} ${100 - pPct}`} strokeDashoffset="0" />}
                                      {fPct > 0 && <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#DE350B" strokeWidth="7.5" strokeDasharray={`${fPct} ${100 - fPct}`} strokeDashoffset={`${-pPct}`} />}
                                      {bPct > 0 && <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#FFAB00" strokeWidth="7.5" strokeDasharray={`${bPct} ${100 - bPct}`} strokeDashoffset={`${-(pPct + fPct)}`} />}
                                      {nPct > 0 && <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#0C66E4" strokeWidth="7.5" strokeDasharray={`${nPct} ${100 - nPct}`} strokeDashoffset={`${-(pPct + fPct + bPct)}`} />}
                                    </>
                                  )}
                                </svg>
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
                        )}

                        {widget.type === 'manual_vs_auto' && (
                          <div className="dashboard-card" style={{ height: '100%' }}>
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
                        )}

                        {widget.type === 'tester_stats' && (
                          <div className="dashboard-card" style={{ height: '100%' }}>
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
                        )}

                        {widget.type === 'module_stats' && (
                          <div className="dashboard-card" style={{ height: '100%' }}>
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
                        )}

                        {widget.type === 'cycles_progress' && (
                          <div className="dashboard-card" style={{ height: '100%' }}>
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
                              {filteredCycles.length > 0 ? (
                                filteredCycles.map(cycle => {
                                  let cPassed = 0, cFailed = 0, cBlocked = 0, cNotRun = 0;
                                  if (cycle.execution && Array.isArray(cycle.execution)) {
                                    cycle.execution.forEach(ex => {
                                      const normS = normalizeUiStatus(ex.status);
                                      if (normS === 'Passed') cPassed++;
                                      else if (normS === 'Failed') cFailed++;
                                      else if (normS === 'Blocked') cBlocked++;
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
                                })
                              ) : (
                                <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '1rem', fontSize: '12px', gridColumn: '1 / -1' }}>
                                  No hay ciclos de prueba seleccionados
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {widget.type === 'severity_breakdown' && (() => {
                          const sevCounts = { bloqueante: 0, critico: 0, mayor: 0, menor: 0, sinDefinir: 0 };
                          const bugsList = cycleAllBugsList;
                          bugsList.forEach(b => {
                            const s = (b.severity || '').toLowerCase();
                            if (s.includes('bloq')) sevCounts.bloqueante++;
                            else if (s.includes('crit')) sevCounts.critico++;
                            else if (s.includes('may')) sevCounts.mayor++;
                            else if (s.includes('men') || s.includes('baj') || s.includes('triv')) sevCounts.menor++;
                            else sevCounts.sinDefinir++;
                          });
                          const totalSevBugs = bugsList.length;

                          return (
                            <div className="dashboard-card" style={{ height: '100%' }}>
                              <div className="dashboard-card-header">
                                <div className="dashboard-card-title">
                                  <span>🐞</span>
                                  <span>Distribución de Defectos por Severidad</span>
                                </div>
                                <span style={{ fontSize: '11px', background: '#FFEBE6', color: '#DE350B', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                                  {totalSevBugs} Defectos en Ciclo
                                </span>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', padding: '0.4rem 0' }}>
                                <div className="dashboard-stacked-bar" style={{ height: '12px' }}>
                                  {totalSevBugs > 0 ? (
                                    <>
                                      {sevCounts.bloqueante > 0 && <div style={{ width: `${(sevCounts.bloqueante / totalSevBugs) * 100}%`, backgroundColor: '#DE350B' }} title={`Bloqueante: ${sevCounts.bloqueante}`} />}
                                      {sevCounts.critico > 0 && <div style={{ width: `${(sevCounts.critico / totalSevBugs) * 100}%`, backgroundColor: '#FF5630' }} title={`Crítico: ${sevCounts.critico}`} />}
                                      {sevCounts.mayor > 0 && <div style={{ width: `${(sevCounts.mayor / totalSevBugs) * 100}%`, backgroundColor: '#FFAB00' }} title={`Mayor: ${sevCounts.mayor}`} />}
                                      {sevCounts.menor > 0 && <div style={{ width: `${(sevCounts.menor / totalSevBugs) * 100}%`, backgroundColor: '#36B37E' }} title={`Menor: ${sevCounts.menor}`} />}
                                      {sevCounts.sinDefinir > 0 && <div style={{ width: `${(sevCounts.sinDefinir / totalSevBugs) * 100}%`, backgroundColor: '#626F86' }} title={`Sin Definir: ${sevCounts.sinDefinir}`} />}
                                    </>
                                  ) : (
                                    <div style={{ width: '100%', height: '100%', backgroundColor: '#E3FCEF' }} title="Sin defectos" />
                                  )}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '6px' }}>
                                  <div style={{ background: '#FFEBE6', border: '1px solid #FFBDAD', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#DE350B' }}>{sevCounts.bloqueante}</div>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#BF2600', textTransform: 'uppercase' }}>Bloqueante</div>
                                  </div>
                                  <div style={{ background: '#FFF0ED', border: '1px solid #FFC4BA', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#FF5630' }}>{sevCounts.critico}</div>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#DE350B', textTransform: 'uppercase' }}>Crítico</div>
                                  </div>
                                  <div style={{ background: '#FFFAE6', border: '1px solid #FFE380', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#FF8B00' }}>{sevCounts.mayor}</div>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#974F00', textTransform: 'uppercase' }}>Mayor</div>
                                  </div>
                                  <div style={{ background: '#E3FCEF', border: '1px solid #ABF5D1', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#006644' }}>{sevCounts.menor}</div>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#006644', textTransform: 'uppercase' }}>Menor</div>
                                  </div>
                                  <div style={{ background: '#F1F2F4', border: '1px solid #DCDFE4', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#626F86' }}>{sevCounts.sinDefinir}</div>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase' }}>Sin Definir</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {widget.type === 'automation_health' && (() => {
                          const autoCasesCount = execStats.auto.total;
                          const totalEvalCases = allTotal;
                          const autoCoverageRatio = totalEvalCases > 0 ? Math.round((autoCasesCount / totalEvalCases) * 100) : 0;
                          const autoSuccessRate = execStats.auto.total > 0 ? Math.round((execStats.auto.passed / execStats.auto.total) * 100) : 0;
                          const isCiCdReady = autoSuccessRate >= 80 && autoCoverageRatio >= 30;

                          return (
                            <div className="dashboard-card" style={{ height: '100%' }}>
                              <div className="dashboard-card-header">
                                <div className="dashboard-card-title">
                                  <span>🚀</span>
                                  <span>Salud de Automatización &amp; CI/CD</span>
                                </div>
                                <span className={`ads-lozenge ${isCiCdReady ? 'ads-lozenge-success' : 'ads-lozenge-warning'}`} style={{ fontSize: '10px' }}>
                                  {isCiCdReady ? '✅ CI/CD Ready' : '⚠️ En Estabilización'}
                                </span>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', padding: '0.5rem 0' }}>
                                <div style={{ background: '#F8FAFD', border: '1px solid #DCDFE4', borderRadius: '6px', padding: '10px', textAlign: 'center' }}>
                                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#6554C0' }}>{autoCoverageRatio}%</div>
                                  <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', fontWeight: 600 }}>Ratio de Auto</div>
                                  <div style={{ fontSize: '10px', color: 'var(--jira-subtle)', marginTop: '2px' }}>{autoCasesCount} / {totalEvalCases} casos</div>
                                </div>

                                <div style={{ background: '#F8FAFD', border: '1px solid #DCDFE4', borderRadius: '6px', padding: '10px', textAlign: 'center' }}>
                                  <div style={{ fontSize: '18px', fontWeight: 800, color: autoSuccessRate >= 80 ? '#006644' : '#DE350B' }}>{autoSuccessRate}%</div>
                                  <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', fontWeight: 600 }}>Tasa Pass Auto</div>
                                  <div style={{ fontSize: '10px', color: 'var(--jira-subtle)', marginTop: '2px' }}>{execStats.auto.passed} pasados</div>
                                </div>

                                <div style={{ background: '#F8FAFD', border: '1px solid #DCDFE4', borderRadius: '6px', padding: '10px', textAlign: 'center' }}>
                                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#0C66E4' }}>{execStats.auto.notRun}</div>
                                  <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', fontWeight: 600 }}>Pendientes Auto</div>
                                  <div style={{ fontSize: '10px', color: 'var(--jira-subtle)', marginTop: '2px' }}>Para pipeline</div>
                                </div>
                              </div>
                              
                              <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', borderTop: '1px solid #F1F2F4', paddingTop: '6px', marginTop: '4px' }}>
                                💡 <strong>Recomendación:</strong> Mantén la tasa de aprobación superior al 90% para integrar las suites automáticas en el despliegue continuo de CI/CD.
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════ */}
          {/* ─── SUBVIEW 2: BUGS ─── */}
          {/* ═══════════════════════════════════════════════════════ */}
          {dashboardSubView === 'bugs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Bugs KPI Scorecard */}
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
                    <span style={{ color: totalOpenBugs > 0 ? '#DE350B' : 'var(--jira-subtle)', fontWeight: 600 }}>
                      {totalOpenBugs} Abiertos
                    </span>
                  </div>
                </div>

                {/* Card 2: Defectos Abiertos en Ciclo */}
                <div className="dashboard-kpi-card">
                  <div className="dashboard-kpi-header">
                    <span style={{ color: '#DE350B', fontWeight: 700 }}>🐞 DEFECTOS ABIERTOS (CICLO)</span>
                    <span className="dashboard-kpi-pill red">{criticalCycleBugs.length} Activos</span>
                  </div>
                  <div className="dashboard-kpi-value" style={{ color: '#DE350B' }}>
                    {criticalCycleBugs.length}
                  </div>
                  <div className="dashboard-kpi-footer">
                    <span>En ciclo(s) seleccionados</span>
                    <span style={{ color: '#0C66E4', fontWeight: 600 }}>{totalOpenPlanBugs} en Plan</span>
                  </div>
                </div>

                {/* Card 3: Bloqueantes & Críticos (Configurable) */}
                {(conf.showSevBloqueante !== false || conf.showSevCritico !== false) && (
                  <div className="dashboard-kpi-card">
                    <div className="dashboard-kpi-header">
                      <span style={{ color: '#DE350B', fontWeight: 700 }}>
                        {conf.showSevBloqueante !== false && conf.showSevCritico !== false
                          ? '✱ BLOQUEANTES & CRÍTICOS'
                          : conf.showSevBloqueante !== false
                            ? '✱ BLOQUEANTES'
                            : '▲ CRÍTICOS'}
                      </span>
                      <span className="dashboard-kpi-pill red">Alta prioridad</span>
                    </div>
                    <div className="dashboard-kpi-value" style={{ color: '#DE350B' }}>
                      {planGeneralBugsList.filter(b => !b.isDone && (
                        (conf.showSevBloqueante !== false && getSevRank(b.severity) === 1) ||
                        (conf.showSevCritico !== false && getSevRank(b.severity) === 2)
                      )).length}
                    </div>
                    <div className="dashboard-kpi-footer">
                      <span>Abiertos en el Plan</span>
                    </div>
                  </div>
                )}

                {/* Card 4: Mayores, Medios & Menores (Configurable) */}
                {(conf.showSevMayor !== false || conf.showSevMedio !== false || conf.showSevMenor !== false) && (
                  <div className="dashboard-kpi-card">
                    <div className="dashboard-kpi-header">
                      <span style={{ color: '#FF8B00', fontWeight: 700 }}>
                        {(() => {
                          const activeLabels = [];
                          if (conf.showSevMayor !== false) activeLabels.push('MAYORES');
                          if (conf.showSevMedio !== false) activeLabels.push('MEDIOS');
                          if (conf.showSevMenor !== false) activeLabels.push('MENORES');
                          if (activeLabels.length >= 2) {
                            return `● ${activeLabels[0]} & ${activeLabels[activeLabels.length - 1]}`;
                          }
                          return `● ${activeLabels[0] || 'MEDIA / BAJA'}`;
                        })()}
                      </span>
                      <span className="dashboard-kpi-pill orange">Media/Baja</span>
                    </div>
                    <div className="dashboard-kpi-value" style={{ color: '#FF8B00' }}>
                      {planGeneralBugsList.filter(b => !b.isDone && (
                        (conf.showSevMayor !== false && getSevRank(b.severity) === 3) ||
                        (conf.showSevMedio !== false && getSevRank(b.severity) === 4) ||
                        (conf.showSevMenor !== false && getSevRank(b.severity) === 5)
                      )).length}
                    </div>
                    <div className="dashboard-kpi-footer">
                      <span>Abiertos no bloqueantes</span>
                    </div>
                  </div>
                )}

                {/* Card 5: Resolución (MTTR) */}
                {conf.showBugTimes !== false && (
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
                )}
              </div>

              {/* ─── TABLA 1: DEFECTOS ABIERTOS EN CICLO(S) SELECCIONADOS ─── */}
              <div className="dashboard-card" style={{ overflowX: 'auto' }}>
                <div className="dashboard-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div className="dashboard-card-title">
                      <span style={{ color: '#DE350B' }}>🐞</span>
                      <span>Defectos Abiertos en Ciclo(s) Seleccionados</span>
                      <span className="ads-lozenge ads-lozenge-danger" style={{ fontSize: '11px', fontWeight: 700, marginLeft: '8px' }}>
                        {criticalCycleBugs.length} activos
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', marginTop: '2px' }}>
                      Defectos no resueltos vinculados a casos de prueba en los ciclos actualmente seleccionados en la barra superior.
                    </div>
                  </div>

                  {/* Search filter input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Buscar bug en ciclo..."
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
                        <th>Versión Afectada</th>
                        <th>Fecha Registro / Antigüedad</th>
                        <th>Fecha Estimada Solución</th>
                        <th>Severidad</th>
                        <th>Estado</th>
                        <th>Responsable</th>
                        <th>Resolución</th>
                        <th style={{ textAlign: 'center' }}>Casos afectados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBugsList.map((bug) => {
                        const { dateStr, timeStr } = formatBugCreatedDate(bug.created);
                        const age = formatBugAge(bug.created, bug.resolutiondate, false);
                        const badgeColor = age.tone === 'red' ? '#FFEBE6' : age.tone === 'orange' ? '#FFF0B3' : age.tone === 'green' ? '#E3FCEF' : '#F1F2F4';
                        const textColor = age.tone === 'red' ? '#BF2600' : age.tone === 'orange' ? '#172B4D' : age.tone === 'green' ? '#006644' : '#44546F';

                        return (
                          <tr key={bug.key} onClick={() => setSelectedBug(bug)} style={{ cursor: 'pointer' }}>
                            {/* 1. ID */}
                            <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className="dashboard-bug-icon">B</span>
                                <span
                                  onClick={(e) => { e.stopPropagation(); setSelectedBug(bug); }}
                                  style={{ color: '#0C66E4', fontWeight: 700, cursor: 'pointer' }}
                                  className="hover:underline"
                                  title="Ver detalle del bug en Test Pulse"
                                >
                                  {bug.key}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); router.open('/browse/' + bug.key); }}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: '#626F86', display: 'inline-flex', alignItems: 'center' }}
                                  title="Abrir directamente en Jira"
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                </button>
                              </div>
                            </td>

                            {/* 2. Resumen del bug */}
                            <td style={{ maxWidth: '380px' }}>
                              <div 
                                style={{ fontWeight: 600, color: 'var(--jira-dark, #172B4D)', fontSize: '13px' }} 
                                title={bug.summary}
                              >
                                {bug.summary}
                              </div>
                            </td>

                            {/* 3. Versión */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span
                                className="ads-lozenge ads-lozenge-subtle"
                                style={{ fontSize: '11px', fontWeight: 600, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}
                                title={bug.version || 'Sin versión'}
                              >
                                🏷️ {bug.version || 'Sin versión'}
                              </span>
                            </td>

                            {/* 4. Fecha Registro / Antigüedad (Aging laboral) */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--jira-dark, #172B4D)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span>📅</span> <span>{dateStr}</span> {timeStr && <span style={{ color: 'var(--jira-subtle, #626F86)', fontWeight: 400, fontSize: '10px' }}>({timeStr})</span>}
                                </div>
                                {bug.created && (
                                  <div
                                    style={{
                                      fontSize: '10px',
                                      fontWeight: 700,
                                      background: badgeColor,
                                      color: textColor,
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      width: 'fit-content'
                                    }}
                                    title={`Jornada laboral México (L-J 7-18h, V 7-13h): ${age.bHoursFormatted} hrs hábiles transcurridas`}
                                  >
                                    <span>⏱️</span> <span>{age.label}</span>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* 4.1. Fecha Estimada Solución */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {renderBugDueDate(bug.estimatedResolutionDate || bug.duedate, false)}
                            </td>

                            {/* 5. Severidad */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span className={`dashboard-sev-badge ${getSeverityClass(bug.severity)}`}>
                                {getSeverityLabel(bug.severity)}
                              </span>
                            </td>

                            {/* 6. Estado */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {renderBugStatusLozenge(bug.status, false)}
                            </td>

                            {/* 7. Responsable */}
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

                            {/* 8. Resolución */}
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

                            {/* 9. Casos afectados */}
                            <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <span className="dashboard-affected-badge" title={`${bug.affectedCount} ${bug.affectedCount === 1 ? 'caso afectado' : 'casos afectados'}`}>
                                {bug.affectedCount}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '3rem', fontSize: '13px' }}>
                    {dashboardBugSearch ? '🔍 No se encontraron bugs con ese criterio de búsqueda.' : '✅ No hay bugs abiertos en el ciclo seleccionado.'}
                  </div>
                )}
              </div>

              {/* ─── WIDGET DONUT INTERACTIVO DE SEVERIDADES (DEBAJO DE TABLA 1) ─── */}
              <div className="dashboard-card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>🍩</span>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--jira-dark, #172B4D)' }}>
                        Distribución de Defectos Abiertos por Severidad
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--jira-subtle, #626F86)' }}>
                        Haz clic en un segmento del gráfico circular o en una tarjeta para filtrar la relación general de defectos.
                      </div>
                    </div>
                  </div>
                  {selectedDashboardSeverityFilter && (
                    <button
                      onClick={() => setSelectedDashboardSeverityFilter(null)}
                      style={{
                        background: '#FFEBE6',
                        border: '1px solid #FFBDAD',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#DE350B',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>✕</span>
                      <span>Quitar filtro ({selectedDashboardSeverityFilter})</span>
                    </button>
                  )}
                </div>

                {donutSegments.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--jira-subtle, #626F86)', fontSize: '12px' }}>
                    ℹ️ Todas las severidades han sido ocultadas en la configuración del proyecto.
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
                    {/* Donut SVG Responsivo */}
                    <div style={{ position: 'relative', width: '150px', height: '150px', flexShrink: 0, margin: '0 auto' }}>
                      <svg width="150" height="150" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
                        {/* Fondo */}
                        <circle cx="70" cy="70" r="52" fill="transparent" stroke="#F1F2F4" strokeWidth="15" />
                        {/* Segmentos */}
                        {(() => {
                          let accumulatedPct = 0;
                          return donutSegments.map(seg => {
                            if (seg.count === 0 || visibleSevOpenTotal === 0) return null;
                            const pct = seg.count / visibleSevOpenTotal;
                            const strokeDash = `${pct * 326.7256} ${326.7256}`;
                            const strokeOffset = -(accumulatedPct * 326.7256);
                            accumulatedPct += pct;
                            const isSelected = selectedDashboardSeverityFilter === seg.key;
                            return (
                              <circle
                                key={seg.key}
                                cx="70"
                                cy="70"
                                r="52"
                                fill="transparent"
                                stroke={seg.color}
                                strokeWidth={isSelected ? "19" : "15"}
                                strokeDasharray={strokeDash}
                                strokeDashoffset={strokeOffset}
                                style={{
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  opacity: (!selectedDashboardSeverityFilter || isSelected) ? 1 : 0.35,
                                  filter: isSelected ? 'drop-shadow(0 0 4px rgba(0,0,0,0.35))' : 'none'
                                }}
                                onClick={() => setSelectedDashboardSeverityFilter(prev => prev === seg.key ? null : seg.key)}
                              >
                                <title>{`${seg.label}: ${seg.count} (${Math.round(pct * 100)}%)`}</title>
                              </circle>
                            );
                          });
                        })()}
                      </svg>
                      {/* Centro con total / filtro */}
                      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <span style={{ fontSize: '22px', fontWeight: 800, color: '#172B4D', lineHeight: 1 }}>
                          {selectedDashboardSeverityFilter ? (donutSegments.find(s => s.key === selectedDashboardSeverityFilter)?.count ?? visibleSevOpenTotal) : visibleSevOpenTotal}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: '#626F86', textTransform: 'uppercase', marginTop: '3px' }}>
                          {selectedDashboardSeverityFilter ? selectedDashboardSeverityFilter : 'Abiertos'}
                        </span>
                      </div>
                    </div>

                    {/* Pills / Tarjetas Interactivas de Severidad */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', flex: 1, minWidth: '280px' }}>
                      {donutSegments.map(seg => {
                        const isSelected = selectedDashboardSeverityFilter === seg.key;
                        const pct = visibleSevOpenTotal > 0 ? Math.round((seg.count / visibleSevOpenTotal) * 100) : 0;
                        return (
                          <button
                            key={seg.key}
                            type="button"
                            onClick={() => setSelectedDashboardSeverityFilter(prev => prev === seg.key ? null : seg.key)}
                            style={{
                              background: isSelected ? seg.bg : '#FAFBFC',
                              border: isSelected ? `2px solid ${seg.color}` : `1px solid ${seg.border}`,
                              borderRadius: '8px',
                              padding: '10px 12px',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-start',
                              gap: '4px',
                              transition: 'all 0.15s ease',
                              boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                              textAlign: 'left'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                              <span style={{ fontSize: '11px', fontWeight: 700, color: isSelected ? seg.color : '#44546F', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: seg.color, display: 'inline-block' }} />
                                {seg.label}
                              </span>
                              {isSelected && (
                                <span style={{ fontSize: '10px', fontWeight: 800, color: seg.color }}>✓</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                              <span style={{ fontSize: '18px', fontWeight: 800, color: seg.color }}>{seg.count}</span>
                              <span style={{ fontSize: '11px', color: '#626F86', fontWeight: 600 }}>({pct}%)</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ─── TABLA 2: RELACIÓN GENERAL DE BUGS DEL PLAN DE PRUEBAS ─── */}
              <div className="dashboard-card" style={{ overflowX: 'auto' }}>
                <div className="dashboard-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div className="dashboard-card-title">
                      <span style={{ color: '#0C66E4' }}>📋</span>
                      <span>Relación General de Bugs del Plan de Pruebas</span>
                      <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '11px', fontWeight: 700, marginLeft: '8px' }}>
                        {planGeneralBugsList.length} total
                      </span>
                      {selectedDashboardSeverityFilter && (
                        <span className="ads-lozenge ads-lozenge-warning" style={{ fontSize: '11px', fontWeight: 700, marginLeft: '6px' }}>
                          Filtrado: {selectedDashboardSeverityFilter} ({filteredPlanGeneralBugsList.length})
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)', marginTop: '2px' }}>
                      Listado general consolidado de todos los defectos vinculados al Plan (Abiertos, On Hold, En progreso, En análisis y Cerrados).
                    </div>
                  </div>

                  {/* Filter controls: Status Tabs & Search input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    {/* Status filter tabs */}
                    <div style={{ display: 'flex', background: '#F1F2F4', padding: '2px', borderRadius: '6px', gap: '2px' }}>
                      <button
                        type="button"
                        onClick={() => setDashboardGeneralBugStatusTab('ALL')}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: dashboardGeneralBugStatusTab === 'ALL' ? 700 : 500,
                          background: dashboardGeneralBugStatusTab === 'ALL' ? '#FFFFFF' : 'transparent',
                          color: dashboardGeneralBugStatusTab === 'ALL' ? '#0C66E4' : '#44546F',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          boxShadow: dashboardGeneralBugStatusTab === 'ALL' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        Todos ({planGeneralBugsList.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDashboardGeneralBugStatusTab('OPEN')}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: dashboardGeneralBugStatusTab === 'OPEN' ? 700 : 500,
                          background: dashboardGeneralBugStatusTab === 'OPEN' ? '#FFFFFF' : 'transparent',
                          color: dashboardGeneralBugStatusTab === 'OPEN' ? '#DE350B' : '#44546F',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          boxShadow: dashboardGeneralBugStatusTab === 'OPEN' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        Abiertos ({totalOpenPlanBugs})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDashboardGeneralBugStatusTab('CLOSED')}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: dashboardGeneralBugStatusTab === 'CLOSED' ? 700 : 500,
                          background: dashboardGeneralBugStatusTab === 'CLOSED' ? '#FFFFFF' : 'transparent',
                          color: dashboardGeneralBugStatusTab === 'CLOSED' ? '#006644' : '#44546F',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          boxShadow: dashboardGeneralBugStatusTab === 'CLOSED' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                        }}
                      >
                        Cerrados ({totalClosedPlanBugs})
                      </button>
                    </div>

                    {/* Search input */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="text"
                        placeholder="Buscar en bugs del plan..."
                        value={dashboardGeneralBugSearch}
                        onChange={(e) => setDashboardGeneralBugSearch(e.target.value)}
                        style={{
                          padding: '6px 12px',
                          fontSize: '12px',
                          border: '1px solid var(--jira-border, #DCDFE4)',
                          borderRadius: '6px',
                          width: '240px'
                        }}
                      />
                      {dashboardGeneralBugSearch && (
                        <button
                          onClick={() => setDashboardGeneralBugSearch('')}
                          style={{ padding: '4px 8px', fontSize: '11px', background: '#F1F2F4', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Banner de filtro por severidad si está activo */}
                {selectedDashboardSeverityFilter && (
                  <div style={{ background: '#E9F2FF', border: '1px solid #B3D4FF', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 1rem 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#0C66E4', fontWeight: 600 }}>
                      <span>🍩</span>
                      <span>Filtrando tabla por severidad: <strong>{selectedDashboardSeverityFilter}</strong> ({filteredPlanGeneralBugsList.length} coincidencias)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDashboardSeverityFilter(null)}
                      style={{ background: '#FFFFFF', border: '1px solid #0C66E4', borderRadius: '4px', color: '#0C66E4', fontWeight: 700, cursor: 'pointer', fontSize: '11px', padding: '3px 8px' }}
                    >
                      ✕ Quitar filtro
                    </button>
                  </div>
                )}

                {filteredPlanGeneralBugsList.length > 0 ? (
                  <table className="dashboard-defects-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Resumen del bug</th>
                        <th>Versión Afectada</th>
                        <th>Fecha Registro / Antigüedad</th>
                        <th>Fecha Estimada Solución</th>
                        <th>Severidad</th>
                        <th>Estado</th>
                        <th>Responsable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPlanGeneralBugsList.map((bug) => {
                        const { dateStr, timeStr } = formatBugCreatedDate(bug.created);
                        const age = formatBugAge(bug.created, bug.resolutiondate, bug.isDone);
                        const badgeColor = age.tone === 'red' ? '#FFEBE6' : age.tone === 'orange' ? '#FFF0B3' : age.tone === 'green' ? '#E3FCEF' : '#F1F2F4';
                        const textColor = age.tone === 'red' ? '#BF2600' : age.tone === 'orange' ? '#172B4D' : age.tone === 'green' ? '#006644' : '#44546F';

                        return (
                          <tr key={bug.key} onClick={() => setSelectedBug(bug)} style={{ opacity: bug.isDone ? 0.85 : 1, cursor: 'pointer' }}>
                            {/* 1. ID */}
                            <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className={`dashboard-bug-icon ${bug.isDone ? 'done' : ''}`}>B</span>
                                <span
                                  onClick={(e) => { e.stopPropagation(); setSelectedBug(bug); }}
                                  style={{ color: '#0C66E4', fontWeight: 700, cursor: 'pointer' }}
                                  className="hover:underline"
                                  title="Ver detalle del bug en Test Pulse"
                                >
                                  {bug.key}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); router.open('/browse/' + bug.key); }}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: '#626F86', display: 'inline-flex', alignItems: 'center' }}
                                  title="Abrir directamente en Jira"
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                </button>
                              </div>
                            </td>

                            {/* 2. Resumen del bug */}
                            <td style={{ maxWidth: '380px' }}>
                              <div 
                                style={{ fontWeight: 600, color: bug.isDone ? '#626F86' : 'var(--jira-dark, #172B4D)', fontSize: '13px' }} 
                                title={bug.summary}
                              >
                                {bug.summary}
                              </div>
                            </td>

                            {/* 3. Versión */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span
                                className="ads-lozenge ads-lozenge-subtle"
                                style={{ fontSize: '11px', fontWeight: 600, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}
                                title={bug.version || 'Sin versión'}
                              >
                                🏷️ {bug.version || 'Sin versión'}
                              </span>
                            </td>

                            {/* 4. Fecha Registro / Antigüedad (Aging laboral) */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--jira-dark, #172B4D)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span>📅</span> <span>{dateStr}</span> {timeStr && <span style={{ color: 'var(--jira-subtle, #626F86)', fontWeight: 400, fontSize: '10px' }}>({timeStr})</span>}
                                </div>
                                {bug.created && (
                                  <div
                                    style={{
                                      fontSize: '10px',
                                      fontWeight: 700,
                                      background: badgeColor,
                                      color: textColor,
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      width: 'fit-content'
                                    }}
                                    title={`Jornada laboral México (L-J 7-18h, V 7-13h): ${age.bHoursFormatted} hrs hábiles ${bug.isDone ? 'invertidas hasta resolución' : 'transcurridas'}`}
                                  >
                                    <span>⏱️</span> <span>{age.label}</span>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* 4.1. Fecha Estimada Solución */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {renderBugDueDate(bug.estimatedResolutionDate || bug.duedate, bug.isDone)}
                            </td>

                            {/* 5. Severidad */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span className={`dashboard-sev-badge ${getSeverityClass(bug.severity)}`}>
                                {getSeverityLabel(bug.severity)}
                              </span>
                            </td>

                            {/* 6. Estado */}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {renderBugStatusLozenge(bug.status, bug.isDone)}
                            </td>

                            {/* 7. Responsable */}
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
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--jira-subtle)', padding: '3rem', fontSize: '13px' }}>
                    {dashboardGeneralBugSearch ? '🔍 No se encontraron bugs en el plan con ese criterio de búsqueda.' : '✅ No hay defectos registrados en este Plan de Pruebas.'}
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
                            <AtlaskitStatusLozenge status={row.status} />
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

          {/* ─── Add Widget Catalog Modal ─── */}
          {showAddWidgetModal && (
            <div className="ads-modal-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                className="ads-modal-container"
                style={{
                  width: '750px',
                  maxWidth: '92vw',
                  maxHeight: '85vh',
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '10px',
                  boxShadow: '0 12px 32px rgba(9, 30, 66, 0.25)',
                  overflow: 'hidden'
                }}
              >
                {/* Modal Header */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>🧩</span> Catálogo de Widgets del Dashboard
                    </h3>
                    <div style={{ fontSize: '12px', color: 'var(--jira-subtle, #626F86)', marginTop: '2px' }}>
                      Agrega nuevas tarjetas y paneles analíticos a tu tablero en tiempo real.
                    </div>
                  </div>
                  <button
                    onClick={() => setShowAddWidgetModal(false)}
                    style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--jira-subtle, #626F86)', padding: '4px' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Modal Body - Catalog Grid */}
                <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="widget-catalog-grid">
                    {AVAILABLE_WIDGET_CATALOG.map(item => {
                      const isAdded = dashboardWidgets.some(w => w.type === item.type);
                      return (
                        <div
                          key={item.type}
                          style={{
                            border: isAdded ? '1.5px solid #ABF5D1' : '1px solid var(--jira-border, #DCDFE4)',
                            borderRadius: '8px',
                            padding: '1rem',
                            backgroundColor: isAdded ? '#F3FBF7' : '#FFFFFF',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                              <span style={{ fontSize: '20px' }}>{item.icon}</span>
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: isAdded ? '#E3FCEF' : '#F1F2F4',
                                  color: isAdded ? '#006644' : item.categoryColor || '#626F86'
                                }}
                              >
                                {item.category}
                              </span>
                            </div>
                            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--jira-dark, #172B4D)', marginBottom: '4px' }}>
                              {item.title}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--jira-subtle, #626F86)', lineHeight: 1.4 }}>
                              {item.description}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid rgba(9, 30, 66, 0.06)' }}>
                            <span style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)' }}>
                              Tamaño: {item.defaultWidth === 'full' ? '100% (2 col)' : '50% (1 col)'}
                            </span>
                            {isAdded ? (
                              <button
                                onClick={() => handleRemoveWidgetByType(item.type)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 10px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  background: '#FFEBE6',
                                  color: '#DE350B',
                                  border: '1px solid #FFBDAD',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                ✕ Quitar
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAddWidget(item.type)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 12px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  background: '#0C66E4',
                                  color: '#FFFFFF',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                ➕ Agregar
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Modal Footer */}
                <div style={{ padding: '0.85rem 1.5rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#FAFBFC' }}>
                  <span style={{ fontSize: '11px', color: 'var(--jira-subtle, #626F86)' }}>
                    {dashboardWidgets.length} de {AVAILABLE_WIDGET_CATALOG.length} widgets activos
                  </span>
                  <button
                    className="btn-primary"
                    onClick={() => setShowAddWidgetModal(false)}
                    style={{ padding: '6px 16px', fontSize: '12px' }}
                  >
                    Listo
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Modal 1: Defectos de Jira sin vincular a pruebas ─── */}
          {showUnlinkedBugsModal && (
            <div className="ads-modal-overlay" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                className="ads-modal-container"
                style={{
                  width: '960px',
                  maxWidth: '95vw',
                  maxHeight: '85vh',
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '10px',
                  boxShadow: '0 12px 32px rgba(9, 30, 66, 0.25)',
                  overflow: 'hidden'
                }}
              >
                {/* Modal Header */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--jira-dark, #172B4D)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>⚠️</span> Defectos de Jira sin Vincular a Pruebas ({projectUnlinkedBugs.length})
                    </h3>
                    <div style={{ fontSize: '12px', color: 'var(--jira-subtle, #626F86)', marginTop: '2px' }}>
                      Incidencias de tipo Bug en el proyecto que no están asociadas a ningún Test Run o caso de prueba.
                    </div>
                  </div>
                  <button
                    onClick={() => setShowUnlinkedBugsModal(false)}
                    style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--jira-subtle, #626F86)', padding: '4px' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Modal Content */}
                <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
                  {projectUnlinkedBugs.length > 0 ? (
                    <table className="dashboard-defects-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '10%' }}>Clave</th>
                          <th style={{ width: '25%' }}>Resumen</th>
                          <th style={{ width: '12%' }}>Versión</th>
                          <th style={{ width: '16%' }}>Fecha / Antigüedad</th>
                          <th style={{ width: '13%' }}>Fecha Estimada</th>
                          <th style={{ width: '9%' }}>Severidad</th>
                          <th style={{ width: '8%' }}>Estado</th>
                          <th style={{ width: '7%', textAlign: 'center' }}>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectUnlinkedBugs.map((bug, idx) => {
                          const { dateStr, timeStr } = formatBugCreatedDate(bug.created);
                          const age = formatBugAge(bug.created, bug.resolutiondate, isBugDone(bug));
                          const badgeColor = age.tone === 'red' ? '#FFEBE6' : age.tone === 'orange' ? '#FFF0B3' : age.tone === 'green' ? '#E3FCEF' : '#F1F2F4';
                          const textColor = age.tone === 'red' ? '#BF2600' : age.tone === 'orange' ? '#172B4D' : age.tone === 'green' ? '#006644' : '#44546F';

                          return (
                            <tr key={bug.key || idx} onClick={() => setSelectedBug(bug)} style={{ cursor: 'pointer' }}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span
                                    onClick={(e) => { e.stopPropagation(); setSelectedBug(bug); }}
                                    style={{ fontWeight: 700, color: '#0C66E4', cursor: 'pointer' }}
                                    className="hover:underline"
                                    title="Ver detalle del bug en Test Pulse"
                                  >
                                    {bug.key}
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); router.open(`/browse/${bug.key}`); }}
                                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: '#626F86', display: 'inline-flex', alignItems: 'center' }}
                                    title="Abrir directamente en Jira"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                  </button>
                                </div>
                              </td>
                              <td style={{ fontSize: '12px', color: '#172B4D' }}>{bug.summary || 'Sin resumen'}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '11px', fontWeight: 600 }}>
                                  🏷️ {bug.version || 'Sin versión'}
                                </span>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <div style={{ fontSize: '11px', color: '#172B4D', fontWeight: 600 }}>
                                    📅 {dateStr} {timeStr && <span style={{ color: '#626F86', fontWeight: 400, fontSize: '10px' }}>({timeStr})</span>}
                                  </div>
                                  {bug.created && (
                                    <div
                                      style={{
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        background: badgeColor,
                                        color: textColor,
                                        padding: '2px 5px',
                                        borderRadius: '4px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        width: 'fit-content'
                                      }}
                                      title={`Jornada laboral México (L-J 7-18h, V 7-13h): ${age.bHoursFormatted} hrs hábiles`}
                                    >
                                      <span>⏱️</span> <span>{age.label}</span>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {renderBugDueDate(bug.duedate, isBugDone(bug))}
                              </td>
                              <td>
                                <span className="ads-lozenge ads-lozenge-subtle" style={{ fontSize: '11px' }}>
                                  {bug.severity || bug.priority || 'Sin definir'}
                                </span>
                              </td>
                              <td>
                                <span className={`ads-lozenge ${isBugDone(bug) ? 'ads-lozenge-success' : 'ads-lozenge-inprogress'}`} style={{ fontSize: '11px' }}>
                                  {bug.status || 'Abierto'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  className="btn-primary"
                                  onClick={() => {
                                    setLinkingUnlinkedBug(bug);
                                    const initialCycleId = filteredCycles[0]?.id || testCycles[0]?.id || '';
                                    setTargetCycleForBug(initialCycleId);
                                    const cycleObj = (reportData?.cycles || []).find(c => String(c.id) === String(initialCycleId));
                                    const firstExec = cycleObj?.execution?.[0]?.id || '';
                                    setTargetTestForBug(firstExec || testCases[0]?.id || '');
                                  }}
                                  style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                                >
                                  <span>🔗</span> Asociar
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#006644', background: '#E3FCEF', borderRadius: '8px' }}>
                      <span style={{ fontSize: '24px' }}>🟢</span>
                      <div style={{ fontWeight: 700, fontSize: '14px', marginTop: '8px' }}>¡Todos los defectos están vinculados a pruebas!</div>
                      <div style={{ fontSize: '12px', color: '#006644', marginTop: '4px' }}>No hay incidencias tipo Bug huérfanas en el proyecto.</div>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', justifyContent: 'flex-end', background: '#FAFBFC' }}>
                  <button className="btn-secondary" onClick={() => setShowUnlinkedBugsModal(false)}>
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Modal 2: Formulario para Vincular Bug a Caso de Prueba ─── */}
          {linkingUnlinkedBug && (
            <div className="ads-modal-overlay" style={{ zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                className="ads-modal-container"
                style={{
                  width: '560px',
                  maxWidth: '92vw',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '10px',
                  boxShadow: '0 16px 40px rgba(9, 30, 66, 0.3)',
                  overflow: 'hidden'
                }}
              >
                {/* Header */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#172B4D', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>🔗</span> Asociar Defecto {linkingUnlinkedBug.key} a Caso de Prueba
                    </h3>
                    <div style={{ fontSize: '12px', color: '#626F86', marginTop: '2px' }}>
                      {linkingUnlinkedBug.summary}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setLinkingUnlinkedBug(null);
                      setTargetCycleForBug('');
                      setTargetTestForBug('');
                    }}
                    style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#626F86', padding: '4px' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Body */}
                <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#172B4D', marginBottom: '6px', display: 'block' }}>
                      1. Selecciona el Ciclo de Prueba:
                    </label>
                    <select
                      className="form-control"
                      value={targetCycleForBug}
                      onChange={(e) => {
                        const newCycleId = e.target.value;
                        setTargetCycleForBug(newCycleId);
                        const cycleObj = (reportData?.cycles || []).find(c => String(c.id) === String(newCycleId));
                        const firstExec = cycleObj?.execution?.[0]?.id || '';
                        setTargetTestForBug(firstExec || (testCases[0]?.id || ''));
                      }}
                      style={{ width: '100%', padding: '6px 10px', fontSize: '13px' }}
                    >
                      <option value="">-- Selecciona un ciclo --</option>
                      {testCycles.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.summary || c.key || `Ciclo ${c.id}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#172B4D', marginBottom: '6px', display: 'block' }}>
                      2. Selecciona el Caso de Prueba / Ejecución:
                    </label>
                    {(() => {
                      const cycleObj = (reportData?.cycles || []).find(c => String(c.id) === String(targetCycleForBug));
                      const availableExec = cycleObj?.execution || [];
                      return (
                        <select
                          className="form-control"
                          value={targetTestForBug}
                          onChange={(e) => setTargetTestForBug(e.target.value)}
                          disabled={!targetCycleForBug}
                          style={{ width: '100%', padding: '6px 10px', fontSize: '13px' }}
                        >
                          <option value="">-- Selecciona un caso de prueba --</option>
                          {availableExec.length > 0 ? (
                            availableExec.map((ex) => {
                              const tc = testCases.find(t => String(t.id) === String(ex.id));
                              const tcKey = tc?.key || ex.key || `TC-${ex.id}`;
                              const tcSummary = tc?.summary || ex.summary || 'Caso de prueba';
                              return (
                                <option key={ex.id} value={ex.id}>
                                  {tcKey} - {tcSummary} ({ex.status || 'Not Run'})
                                </option>
                              );
                            })
                          ) : (
                            testCases.map(tc => (
                              <option key={tc.id} value={tc.id}>
                                {tc.key || `TC-${tc.id}`} - {tc.summary}
                              </option>
                            ))
                          )}
                        </select>
                      );
                    })()}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--jira-border, #DCDFE4)', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: '#FAFBFC' }}>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setLinkingUnlinkedBug(null);
                      setTargetCycleForBug('');
                      setTargetTestForBug('');
                    }}
                    disabled={isLinkingUnlinkedBugLoading}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn-primary"
                    onClick={handleConfirmLinkUnlinkedBug}
                    disabled={!targetCycleForBug || !targetTestForBug || isLinkingUnlinkedBugLoading}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    {isLinkingUnlinkedBugLoading ? 'Vinculando...' : '🔗 Confirmar Vinculación'}
                  </button>
                </div>
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

    // 1. General evidences (filter out any that belong to iterations)
    const iterEvKeys = new Set();
    (testExec.iterations || []).forEach(it => {
      (it.evidences || []).forEach(e => {
        if (e) {
          const id = typeof e === 'object' ? (e.id ? String(e.id) : '') : String(e);
          const name = typeof e === 'object' ? (e.filename ? String(e.filename) : '') : '';
          const url = typeof e === 'object' ? (e.url ? String(e.url) : '') : '';
          if (id) iterEvKeys.add(id);
          if (name) iterEvKeys.add(name);
          if (url) iterEvKeys.add(url);
        }
      });
    });

    const rawGeneral = [...(testExec.evidences || [])];
    if (testExec.evidence && rawGeneral.length === 0) rawGeneral.push(testExec.evidence);
    const generalEvs = rawGeneral.filter(ev => {
      if (!ev) return false;
      const id = typeof ev === 'object' ? (ev.id ? String(ev.id) : '') : String(ev);
      const name = typeof ev === 'object' ? (ev.filename ? String(ev.filename) : '') : '';
      const url = typeof ev === 'object' ? (ev.url ? String(ev.url) : '') : '';
      if (id && iterEvKeys.has(id)) return false;
      if (name && iterEvKeys.has(name)) return false;
      if (url && iterEvKeys.has(url)) return false;
      return true;
    });

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
                Administra el mapeo de entidades nativas de Jira, trazabilidad de requerimientos, métricas visibles del tablero y permisos de acceso para Test Pulse Suite {APP_VERSION}.
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

                {/* Subsección: Visibilidad de Severidades y Contadores de Bugs */}
                <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--ds-border, #30363d)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>🐞</span>
                    <span style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text-primary, #e6edf3)' }}>
                      Visibilidad de Severidades y Contadores de Bugs en Dashboard
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #8b949e)', marginBottom: '0.85rem' }}>
                    Activa o desactiva qué niveles de severidad y contadores estarán visibles en el gráfico circular y tarjetas KPI del Dashboard para este proyecto.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    {/* Bloqueante */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevBloqueante !== false ? 'rgba(222, 53, 11, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevBloqueante !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevBloqueante: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#DE350B', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#DE350B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ✱ Bloqueante
                      </span>
                    </label>

                    {/* Crítico */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevCritico !== false ? 'rgba(229, 73, 58, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevCritico !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevCritico: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#E5493A', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#E5493A', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ▲ Crítico
                      </span>
                    </label>

                    {/* Mayor */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevMayor !== false ? 'rgba(255, 139, 0, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevMayor !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevMayor: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#FF8B00', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#FF8B00', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ● Mayor
                      </span>
                    </label>

                    {/* Medio */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevMedio !== false ? 'rgba(226, 178, 3, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevMedio !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevMedio: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#E2B203', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#E2B203', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ◆ Medio
                      </span>
                    </label>

                    {/* Menor */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevMenor !== false ? 'rgba(0, 102, 68, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevMenor !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevMenor: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#006644', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#006644', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ○ Menor
                      </span>
                    </label>

                    {/* Sin definir */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: '1px solid var(--ds-border, #30363d)',
                      background: (projectConfig || {}).showSevSinDefinir !== false ? 'rgba(98, 111, 134, 0.08)' : 'var(--bg-main, #0d1117)',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={(projectConfig || {}).showSevSinDefinir !== false}
                        onChange={e => setProjectConfig(prev => ({ ...(prev || {}), showSevSinDefinir: e.target.checked }))}
                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#626F86', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-secondary, #8b949e)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ○ Sin Definir
                      </span>
                    </label>
                  </div>
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
          source: `Test Pulse Suite ${APP_VERSION}`,
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
      {renderBugSlidePanel()}
      {renderMediaModal()}
      {renderQrModal()}
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
            <span style={{ fontSize: '40px', marginBottom: '1rem', display: 'inline-block' }}>📁</span>
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
        <div className="modal-overlay" style={{zIndex: 9999}} onClick={() => {
          if (previewModalData?.blobUrl) {
            try { URL.revokeObjectURL(previewModalData.blobUrl); } catch(e){}
          }
          setPreviewModalData(null);
        }}>
          <div className="modal-content glass" style={{width: '92%', height: '90%', maxWidth: '1200px', display: 'flex', flexDirection: 'column'}} onClick={(e) => e.stopPropagation()}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '12px'}}>
              <h2 style={{margin: 0, fontSize: '1.15rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center', gap: '8px'}}>
                <span>{previewModalData.isVideo || previewModalData.filename?.match(/\.(mp4|mov|webm)$/i) ? '🎥' : '📷'}</span>
                <span>{previewModalData.filename}</span>
              </h2>
              <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0}}>
                {previewModalData.blobUrl && (
                  <a
                    href={previewModalData.blobUrl}
                    download={previewModalData.filename}
                    className="btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', background: '#0C66E4', color: '#fff', textDecoration: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  >
                    ⬇ Descargar
                  </a>
                )}
                {previewModalData.downloadUrl && (
                  <button
                    onClick={() => router.open(previewModalData.downloadUrl)}
                    className="btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', background: '#0C66E4', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    ⬇ Descargar archivo
                  </button>
                )}
                <button
                  className="btn-secondary"
                  onClick={() => {
                    if (previewModalData?.blobUrl) {
                      try { URL.revokeObjectURL(previewModalData.blobUrl); } catch(e){}
                    }
                    setPreviewModalData(null);
                  }}
                  style={{ padding: '0.4rem 0.8rem', background: 'var(--danger-color, #DE350B)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                >
                  ✕ Cerrar
                </button>
              </div>
            </div>
            <div style={{flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', background: '#091E42', borderRadius: '6px', minHeight: '320px', position: 'relative'}}>
              {previewModalData.loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', color: '#DEEBFF' }}>
                  <div className="spinner" style={{ width: '32px', height: '32px', border: '3px solid rgba(255,255,255,0.2)', borderTop: '3px solid #579DFF', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>Cargando vista previa...</p>
                </div>
              ) : previewModalData.error ? (
                <div style={{ textAlign: 'center', color: '#FFEBE6', padding: '20px' }}>
                  <p style={{ fontSize: '14px', marginBottom: '12px' }}>⚠️ {previewModalData.error}</p>
                  {previewModalData.downloadUrl && (
                    <button
                      onClick={() => router.open(previewModalData.downloadUrl)}
                      style={{ background: '#0C66E4', color: '#FFF', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Descargar archivo directamente
                    </button>
                  )}
                </div>
              ) : (previewModalData.isVideo || previewModalData.filename?.match(/\.(mp4|mov|webm)$/i)) ? (
                <video
                  controls
                  autoPlay
                  playsInline
                  controlsList="nodownload"
                  style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: '4px', background: '#000', outline: 'none' }}
                  src={previewModalData.blobUrl || (previewModalData.base64 ? `data:${previewModalData.mimeType || 'video/mp4'};base64,${previewModalData.base64}` : '')}
                />
              ) : (
                <img
                  src={previewModalData.blobUrl || (previewModalData.base64 ? `data:${previewModalData.mimeType || 'image/png'};base64,${previewModalData.base64}` : '')}
                  alt={previewModalData.filename || "Evidence preview"}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }}
                />
              )}
            </div>
            {previewModalData.note && (
              <div style={{ marginTop: '0.75rem', padding: '10px 14px', background: '#E9F2FF', border: '1px solid #B2D4FF', borderRadius: '6px', color: '#0747A6', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '15px' }}>💬</span>
                <div>
                  <strong>Nota del tester:</strong> {previewModalData.note}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: '3rem', padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', borderTop: '1px solid var(--ds-border)' }}>
        <strong>Test Pulse Suite</strong> {APP_VERSION} © El Puerto de Liverpool
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

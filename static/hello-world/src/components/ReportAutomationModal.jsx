import React from 'react';
import { view, router, requestJira } from '@forge/bridge';
import { CreateIssueModal } from '@forge/jira-bridge';
import Lozenge from '@atlaskit/lozenge';
import Badge from '@atlaskit/badge';
import Button from '@atlaskit/button';
import Spinner from '@atlaskit/spinner';
import TestPulseLoader from '../components/TestPulseLoader';
import { LIVERPOOL_LOGO_WHITE_ANIMATED_B64, LIVERPOOL_LOGO_WHITE_B64, LIVERPOOL_LOGO_PINK_B64 } from '../assets/liverpool-logo-b64';
import packageJson from '../../package.json';
import { generateQrSvg, generateQrDataUrl } from '../utils/qrCodeGenerator';
import {
  generateUUID,
  normalizeUiStatus,
  REMOVED_WIDGET_TYPES,
  DEFAULT_DASHBOARD_WIDGETS,
  AVAILABLE_WIDGET_CATALOG,
  formatAttachmentSize,
  MX_HOLIDAYS_SET,
  getBusinessHoursBetween,
  formatBugCreatedDate,
  formatBugAge
} from '../utils/constants';
import { textToAdf, sanitizeRenderedHtml, adfToHtml, fetchAttachmentBlobData } from '../utils/adfUtils';
import {
  RichTextEditor,
  SearchableSelect,
  BugAttachmentImageCard,
  PdfDocumentPreview,
  useNotification,
  ConfirmModal,
  TextInputModal,
  AtlaskitStatusLozenge,
  LIST_BATCH_SIZE,
  LoadMoreSentinel
} from '../components/CommonComponents';
import { invoke, queryClient, clearPersistentCache } from '../utils/queryClient';
import { extractEpicAndRequirement } from '../utils/traceabilityHelpers';

const APP_VERSION = `v${packageJson.version || '4.3.0'}`;

export default function ReportAutomationModal({ ctx }) {
  const {
    addNotification,
    context,
    handleGlobalTestAutomatedReportDispatch,
    projects,
    reportAutomationActiveTab,
    reportAutomationConfig,
    reportAutomationLastDispatch,
    reportAutomationLoading,
    reportAutomationTesting,
    saveReportAutomationConfigHandler,
    selectedProjectId,
    setReportAutomationActiveTab,
    setReportAutomationConfig,
    setShowReportAutomationModal,
    showReportAutomationModal
  } = ctx;

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

                {/* Field 1: Native Jira Channel / Optional Target Issue Key */}
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#002D62', marginBottom: '6px' }}>
                    🛡️ Canal Nativo de Jira / Clave de Incidencia (Runs on Atlassian • Opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="NATIVE_JIRA (o clave de ticket ej. QA-100 para publicar comentario ADF nativo)"
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
                    En modo <strong>100% Nativo en Jira (Runs on Atlassian)</strong>, el reporte se publica como propiedad del proyecto (<code>testpulse-executive-report</code>). Si indicas una clave (ej. <code>QA-100</code>), también agregará un comentario ADF nativo para disparar Jira Automation sin webhooks externos.
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
              disabled={reportAutomationTesting}
              onClick={handleGlobalTestAutomatedReportDispatch}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 600,
                borderRadius: '6px',
                border: '1px solid #002D62',
                background: '#FFFFFF',
                color: '#002D62',
                cursor: reportAutomationTesting ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title="Publica una prueba inmediata del reporte ejecutivo de forma 100% nativa en Jira"
            >
              {reportAutomationTesting ? '⏳ Publicando en Jira...' : '⚡ Probar Publicación Inmediata'}
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
}

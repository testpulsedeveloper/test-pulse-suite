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

export default function SettingsView({ ctx }) {
  const {
    DEFAULT_EXECUTION_ENVIRONMENTS,
    addNotification,
    availableEnvironments,
    editingEnvDesc,
    editingEnvId,
    editingEnvName,
    handleResyncCycleRuns,
    handleSaveConfig,
    handleUpdateEnvironmentsCatalog,
    isAdmin,
    isProjectAllowed,
    isSavingConfig,
    isSavingEnvCatalog,
    linkTypes,
    loadReportAutomationConfig,
    newEnvDesc,
    newEnvName,
    projectConfig,
    projectIssueTypes,
    projects,
    reportAutomationConfig,
    resyncCycleId,
    resyncProgress,
    resyncResult,
    resyncRunning,
    selectedProjectId,
    setAllowedProjects,
    setEditingEnvDesc,
    setEditingEnvId,
    setEditingEnvName,
    setIsProjectAllowed,
    setNewEnvDesc,
    setNewEnvName,
    setProjectConfig,
    setResyncCycleId,
    setResyncResult,
    setShowReportAutomationModal,
    snapshotFieldMap,
    testCycles
  } = ctx;

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

              {/* Card 1.5: Catálogo de Ambientes de Ejecución (Formato Tabla para Administradores) */}
              <div className="glass" style={{
                background: 'var(--bg-surface, #161b22)',
                border: '1px solid var(--ds-border, #30363d)',
                borderRadius: '10px',
                padding: '1.5rem 1.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '1.3rem' }}>🌐</span>
                    <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                      Catálogo de Ambientes de Ejecución (Ciclos de Prueba)
                    </h2>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '999px',
                      background: 'rgba(12, 102, 228, 0.12)',
                      color: '#2563EB',
                      border: '1px solid rgba(37, 99, 235, 0.28)'
                    }}>
                      {availableEnvironments.length} {availableEnvironments.length === 1 ? 'ambiente' : 'ambientes'}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={isSavingEnvCatalog}
                    onClick={() => {
                      handleUpdateEnvironmentsCatalog(
                        DEFAULT_EXECUTION_ENVIRONMENTS,
                        'Se restauraron los ambientes predeterminados (QA, UAT, Staging, SIT, Producción).'
                      );
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--ds-border, #CBD5E1)',
                      color: 'var(--text-secondary, #475569)',
                      borderRadius: '6px',
                      padding: '5px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: isSavingEnvCatalog ? 'wait' : 'pointer'
                    }}
                  >
                    ↺ Restaurar predeterminados
                  </button>
                </div>
                <p style={{ margin: '0 0 1.1rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem' }}>
                  Da de alta, edita o administra los ambientes disponibles para configurar en el banner de cada Ciclo de Prueba (se guardan en las propiedades del ciclo en Jira).
                </p>

                {/* Formulario rápido para dar de alta un nuevo ambiente */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 2fr) auto',
                  gap: '0.75rem',
                  alignItems: 'end',
                  marginBottom: '1rem',
                  padding: '0.85rem 1rem',
                  background: 'var(--bg-subtle, rgba(248, 250, 252, 0.6))',
                  border: '1px solid var(--ds-border, #E2E8F0)',
                  borderRadius: '8px'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)' }}>
                      Nombre del Ambiente <span style={{ color: '#E11D48' }}>*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. QA, UAT, Pre-Prod, Sandbox..."
                      value={newEnvName}
                      onChange={(e) => setNewEnvName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const cleanName = newEnvName.trim();
                          if (!cleanName) return;
                          if (availableEnvironments.some(env => env.name.toLowerCase() === cleanName.toLowerCase())) {
                            addNotification({ type: 'warning', title: 'Ambiente duplicado', description: `El ambiente "${cleanName}" ya existe en el catálogo.` });
                            return;
                          }
                          const nextList = [
                            ...availableEnvironments,
                            {
                              id: `env-${Date.now()}`,
                              name: cleanName,
                              description: newEnvDesc.trim(),
                              active: true
                            }
                          ];
                          setNewEnvName('');
                          setNewEnvDesc('');
                          handleUpdateEnvironmentsCatalog(nextList, `Ambiente "${cleanName}" dado de alta en el catálogo.`);
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--ds-border, #CBD5E1)',
                        background: 'var(--bg-surface, #FFFFFF)',
                        color: 'var(--text-primary, #0F172A)',
                        fontSize: '0.85rem',
                        fontWeight: 600
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)' }}>
                      Descripción / URL / Notas (Opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Servidor de pruebas integrales o URL del entorno..."
                      value={newEnvDesc}
                      onChange={(e) => setNewEnvDesc(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const cleanName = newEnvName.trim();
                          if (!cleanName) return;
                          if (availableEnvironments.some(env => env.name.toLowerCase() === cleanName.toLowerCase())) {
                            addNotification({ type: 'warning', title: 'Ambiente duplicado', description: `El ambiente "${cleanName}" ya existe en el catálogo.` });
                            return;
                          }
                          const nextList = [
                            ...availableEnvironments,
                            {
                              id: `env-${Date.now()}`,
                              name: cleanName,
                              description: newEnvDesc.trim(),
                              active: true
                            }
                          ];
                          setNewEnvName('');
                          setNewEnvDesc('');
                          handleUpdateEnvironmentsCatalog(nextList, `Ambiente "${cleanName}" dado de alta en el catálogo.`);
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--ds-border, #CBD5E1)',
                        background: 'var(--bg-surface, #FFFFFF)',
                        color: 'var(--text-primary, #0F172A)',
                        fontSize: '0.85rem'
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={!newEnvName.trim() || isSavingEnvCatalog}
                    onClick={() => {
                      const cleanName = newEnvName.trim();
                      if (!cleanName) return;
                      if (availableEnvironments.some(env => env.name.toLowerCase() === cleanName.toLowerCase())) {
                        addNotification({ type: 'warning', title: 'Ambiente duplicado', description: `El ambiente "${cleanName}" ya existe en el catálogo.` });
                        return;
                      }
                      const nextList = [
                        ...availableEnvironments,
                        {
                          id: `env-${Date.now()}`,
                          name: cleanName,
                          description: newEnvDesc.trim(),
                          active: true
                        }
                      ];
                      setNewEnvName('');
                      setNewEnvDesc('');
                      handleUpdateEnvironmentsCatalog(nextList, `Ambiente "${cleanName}" dado de alta en el catálogo.`);
                    }}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      background: !newEnvName.trim() ? '#94A3B8' : '#0C66E4',
                      color: '#FFFFFF',
                      fontSize: '0.84rem',
                      fontWeight: 700,
                      cursor: !newEnvName.trim() || isSavingEnvCatalog ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      height: '36px'
                    }}
                  >
                    + Agregar Ambiente
                  </button>
                </div>

                {/* Tabla de Ambientes Configurados */}
                <div style={{
                  border: '1px solid var(--ds-border, #E2E8F0)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: 'var(--bg-surface, #FFFFFF)'
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-subtle, #F8FAFC)', borderBottom: '1px solid var(--ds-border, #E2E8F0)' }}>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)', width: '28%' }}>
                          Ambiente
                        </th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)' }}>
                          Descripción / Notas
                        </th>
                        <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)', width: '120px' }}>
                          Disponibilidad
                        </th>
                        <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary, #64748B)', width: '170px' }}>
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {availableEnvironments.map((envItem, idx) => {
                        const isEditingRow = editingEnvId === envItem.id;
                        return (
                          <tr
                            key={envItem.id || idx}
                            style={{
                              borderBottom: idx < availableEnvironments.length - 1 ? '1px solid var(--ds-border, #F1F5F9)' : 'none',
                              background: isEditingRow ? 'rgba(37, 99, 235, 0.04)' : 'transparent'
                            }}
                          >
                            <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                              {isEditingRow ? (
                                <input
                                  type="text"
                                  value={editingEnvName}
                                  onChange={(e) => setEditingEnvName(e.target.value)}
                                  style={{
                                    width: '100%',
                                    padding: '5px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid #2563EB',
                                    fontSize: '0.84rem',
                                    fontWeight: 700
                                  }}
                                />
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                    padding: '3px 9px',
                                    borderRadius: '6px',
                                    background: '#EFF6FF',
                                    color: '#1D4ED8',
                                    border: '1px solid #BFDBFE',
                                    fontWeight: 700,
                                    fontSize: '0.8rem'
                                  }}>
                                    🌐 {envItem.name}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '10px 14px', verticalAlign: 'middle', color: 'var(--text-secondary, #64748B)' }}>
                              {isEditingRow ? (
                                <input
                                  type="text"
                                  value={editingEnvDesc}
                                  onChange={(e) => setEditingEnvDesc(e.target.value)}
                                  placeholder="Descripción o URL..."
                                  style={{
                                    width: '100%',
                                    padding: '5px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid #CBD5E1',
                                    fontSize: '0.84rem'
                                  }}
                                />
                              ) : (
                                <span>{envItem.description || '—'}</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center', verticalAlign: 'middle' }}>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: '999px',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                background: '#ECFDF5',
                                color: '#047857',
                                border: '1px solid #A7F3D0'
                              }}>
                                Activo
                              </span>
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', verticalAlign: 'middle' }}>
                              {isEditingRow ? (
                                <div style={{ display: 'inline-flex', gap: '6px' }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const cleanName = editingEnvName.trim();
                                      if (!cleanName) return;
                                      const nextList = availableEnvironments.map(item =>
                                        item.id === envItem.id
                                          ? { ...item, name: cleanName, description: editingEnvDesc.trim() }
                                          : item
                                      );
                                      setEditingEnvId(null);
                                      handleUpdateEnvironmentsCatalog(nextList, `Ambiente "${cleanName}" actualizado.`);
                                    }}
                                    style={{
                                      padding: '4px 10px',
                                      borderRadius: '4px',
                                      border: 'none',
                                      background: '#0C66E4',
                                      color: '#FFFFFF',
                                      fontSize: '0.76rem',
                                      fontWeight: 700,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Guardar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingEnvId(null)}
                                    style={{
                                      padding: '4px 8px',
                                      borderRadius: '4px',
                                      border: '1px solid #CBD5E1',
                                      background: '#FFFFFF',
                                      color: '#475569',
                                      fontSize: '0.76rem',
                                      fontWeight: 600,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'inline-flex', gap: '6px' }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingEnvId(envItem.id);
                                      setEditingEnvName(envItem.name);
                                      setEditingEnvDesc(envItem.description || '');
                                    }}
                                    style={{
                                      padding: '4px 9px',
                                      borderRadius: '4px',
                                      border: '1px solid var(--ds-border, #CBD5E1)',
                                      background: 'var(--bg-surface, #FFFFFF)',
                                      color: 'var(--text-primary, #334155)',
                                      fontSize: '0.76rem',
                                      fontWeight: 600,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    ✏️ Editar
                                  </button>
                                  <button
                                    type="button"
                                    disabled={availableEnvironments.length <= 1 || isSavingEnvCatalog}
                                    title={availableEnvironments.length <= 1 ? 'Debe existir al menos un ambiente en el catálogo' : 'Eliminar ambiente'}
                                    onClick={() => {
                                      if (availableEnvironments.length <= 1) return;
                                      const nextList = availableEnvironments.filter(item => item.id !== envItem.id);
                                      handleUpdateEnvironmentsCatalog(nextList, `Ambiente "${envItem.name}" eliminado del catálogo.`);
                                    }}
                                    style={{
                                      padding: '4px 9px',
                                      borderRadius: '4px',
                                      border: '1px solid #FECDD3',
                                      background: '#FFF1F2',
                                      color: '#E11D48',
                                      fontSize: '0.76rem',
                                      fontWeight: 600,
                                      cursor: availableEnvironments.length <= 1 ? 'not-allowed' : 'pointer',
                                      opacity: availableEnvironments.length <= 1 ? 0.5 : 1
                                    }}
                                  >
                                    🗑️ Eliminar
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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

              {/* Card 5b: Vista por defecto en Ejecución (Admin Only) */}
              {isAdmin && (
                <div className="glass" style={{
                  background: 'var(--bg-surface, #161b22)',
                  border: '1px solid var(--ds-border, #30363d)',
                  borderRadius: '10px',
                  padding: '1.5rem 1.75rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1.3rem' }}>👤</span>
                    <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                      Vista por defecto en Ejecución
                    </h2>
                  </div>
                  <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem', maxWidth: '650px' }}>
                    Define qué casos ve cada usuario al abrir un ciclo en Ejecución. "Mis asignaciones" muestra los casos asignados al usuario o ejecutados por él; si no tiene ninguno en el ciclo, se muestran todos con un aviso. El usuario siempre puede cambiar el filtro.
                  </p>
                  <select
                    value={projectConfig?.executionDefaultView === 'MINE' ? 'MINE' : 'ALL'}
                    onChange={e => setProjectConfig(prev => ({ ...(prev || {}), executionDefaultView: e.target.value }))}
                    style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem', borderRadius: '6px', border: '1px solid var(--ds-border, #30363d)', background: 'var(--bg-main, #0d1117)', color: 'var(--text-primary, #e6edf3)', minWidth: '260px' }}
                  >
                    <option value="ALL">Todos los casos del ciclo</option>
                    <option value="MINE">Mis asignaciones / ejecuciones</option>
                  </select>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary, #8b949e)' }}>
                    Se guarda con el botón "Guardar Configuración".
                  </div>
                </div>
              )}

              {/* Card 6: Mantenimiento de Test Runs (Admin Only) */}
              {isAdmin && (
                <div className="glass" style={{
                  background: 'var(--bg-surface, #161b22)',
                  border: '1px solid var(--ds-border, #30363d)',
                  borderRadius: '10px',
                  padding: '1.5rem 1.75rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1.3rem' }}>🔄</span>
                    <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary, #e6edf3)' }}>
                      Actualizar Test Runs desde el Test Case
                    </h2>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '10px', background: 'rgba(210,153,34,0.15)', color: '#d29922', border: '1px solid rgba(210,153,34,0.3)' }}>Solo Admin</span>
                  </div>
                  <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary, #8b949e)', fontSize: '0.88rem', maxWidth: '760px' }}>
                    Toma una nueva "foto" (snapshot) del Test Case actual y la aplica a los Test Runs del ciclo: descripción + Precondiciones, Pasos y Resultados Esperados.
                    El snapshot anterior se guarda en el historial de auditoría del Run (quién y cuándo) y Jira conserva el cambio en su historial. Estados, evidencias e iteraciones <strong>no se modifican</strong>.
                  </p>

                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary, #8b949e)', marginBottom: '1rem' }}>
                    <strong style={{ color: 'var(--text-primary, #e6edf3)' }}>Campos detectados:</strong>{' '}
                    {!snapshotFieldMap ? 'Cargando…' : (() => {
                      const labels = { precondition: 'Precondiciones', steps: 'Pasos', expected: 'Resultados Esperados' };
                      return Object.keys(labels).map(k => {
                        const f = (snapshotFieldMap[k] || [])[0];
                        return (
                          <span key={k} style={{ display: 'inline-block', margin: '0.2rem 0.35rem 0.2rem 0', padding: '0.15rem 0.55rem', borderRadius: '10px', border: '1px solid var(--ds-border, #30363d)', color: f ? '#3fb950' : '#8b949e' }}>
                            {f ? '✓' : '—'} {labels[k]}{f ? ` (${f.name})` : ' (no encontrado)'}
                          </span>
                        );
                      });
                    })()}
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={resyncCycleId}
                      onChange={(e) => { setResyncCycleId(e.target.value); setResyncResult(null); }}
                      disabled={resyncRunning}
                      style={{ minWidth: '320px', padding: '0.55rem 0.75rem', borderRadius: '6px', background: 'var(--bg-main, #0d1117)', color: 'var(--text-primary, #e6edf3)', border: '1px solid var(--ds-border, #30363d)' }}
                    >
                      <option value="">Selecciona un ciclo…</option>
                      {testCycles.map(c => (
                        <option key={c.id} value={c.id}>{c.key} — {c.summary}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleResyncCycleRuns}
                      disabled={!resyncCycleId || resyncRunning}
                      style={{ padding: '0.55rem 1.2rem', borderRadius: '6px', fontWeight: 600, border: '1px solid rgba(240,246,252,0.1)', background: (!resyncCycleId || resyncRunning) ? '#484f58' : '#1f6feb', color: '#fff', cursor: (!resyncCycleId || resyncRunning) ? 'not-allowed' : 'pointer' }}
                    >
                      {resyncRunning ? `⏳ Actualizando ${resyncProgress.done}/${resyncProgress.total}…` : '🔄 Actualizar Test Runs del ciclo'}
                    </button>
                  </div>

                  {resyncRunning && resyncProgress.total > 0 && (
                    <div style={{ marginTop: '0.9rem', height: '6px', borderRadius: '3px', background: 'var(--bg-main, #0d1117)', overflow: 'hidden', maxWidth: '520px' }}>
                      <div style={{ height: '100%', width: `${Math.round(resyncProgress.done / resyncProgress.total * 100)}%`, background: '#1f6feb', transition: 'width 0.3s ease' }} />
                    </div>
                  )}

                  {resyncResult && (
                    <div style={{ marginTop: '0.9rem', fontSize: '0.85rem', color: 'var(--text-primary, #e6edf3)' }}>
                      ✅ {resyncResult.ok} actualizados
                      {resyncResult.failed.length > 0 && <span style={{ color: '#f85149' }}> · ❌ {resyncResult.failed.length} con error</span>}
                      {resyncResult.withoutRun > 0 && <span style={{ color: '#8b949e' }}> · {resyncResult.withoutRun} casos sin Test Run (omitidos)</span>}
                      {resyncResult.failed.length > 0 && (
                        <ul style={{ margin: '0.4rem 0 0 1rem', color: '#8b949e', fontSize: '0.8rem' }}>
                          {resyncResult.failed.slice(0, 10).map(f => <li key={f.testRunId}>{f.testRunKey || f.testRunId}: {f.reason}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
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
}

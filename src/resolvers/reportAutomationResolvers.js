/**
 * @file reportAutomationResolvers.js
 * @description Backend resolvers and scheduled trigger handler for Executive Report
 * Automation (100% Native Jira — Opción A: Runs on Atlassian).
 *
 * Allows project administrators to configure scheduled or manual dispatches of the
 * Executive Quality Report natively inside Jira Cloud (Project Properties & Issue Comments)
 * in America/Mexico_City timezone, with zero external egress (`fetch` removed).
 */

import api, { route } from '@forge/api';
import { requireProjectAdmin } from '../utils/authz.js';

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;
const MAX_AUDIT_ENTRIES = 50;

/**
 * Ensures that the report "target channel", when it is a Jira issue key, belongs to the
 * SAME project as the report. The app later comments on that issue as itself (also from
 * the scheduled trigger), so without this check a report of project A could write into
 * project B. The issue is read as the app only to compare its project.
 *
 * @param {string} projectId - Project the report belongs to (ID or key).
 * @param {string} targetChannel - `NATIVE_JIRA` or an issue key such as `QA-100`.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function validateReportTargetChannel(projectId, targetChannel) {
  const trimmed = String(targetChannel || '').trim().toUpperCase();
  if (!trimmed || trimmed === 'NATIVE_JIRA' || !ISSUE_KEY_PATTERN.test(trimmed)) {
    return { ok: true };
  }
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${trimmed}?fields=project`);
    if (!res.ok) return { ok: false, error: `La issue destino ${trimmed} no existe.` };
    const issue = await res.json();
    const ref = String(projectId);
    const sameProject = String(issue?.fields?.project?.id || '') === ref ||
      String(issue?.fields?.project?.key || '').toUpperCase() === ref.toUpperCase();
    if (!sameProject) {
      return { ok: false, error: `La issue destino ${trimmed} debe pertenecer al mismo proyecto del reporte.` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'No se pudo validar la issue destino del reporte.' };
  }
}

/**
 * Appends an entry to the per-project report audit log (last 50 dispatches), so every
 * publication records WHO triggered it, even though Jira shows the app as the author.
 */
async function appendReportAudit(getAppStorage, setAppStorage, projectId, entry) {
  try {
    const key = `report_automation_audit_${projectId}`;
    const current = await getAppStorage(key);
    const list = Array.isArray(current) ? current : [];
    list.unshift(entry);
    await setAppStorage(key, list.slice(0, MAX_AUDIT_ENTRIES));
  } catch (e) {
    console.warn('[ReportAutomation] audit log write failed:', e?.message);
  }
}

/**
 * Publishes the executive report 100% natively inside Jira Cloud (Opción A - Runs on Atlassian):
 * 1. Persists the executive report snapshot to `/rest/api/3/project/{projectId}/properties/testpulse-executive-report`
 *    so native Jira Automation rules can read `{{project.properties."testpulse-executive-report".emailSubject}}`,
 *    `{{project.properties."testpulse-executive-report".recipients}}`, and summary metrics.
 * 2. If `targetChannel` is a Jira Issue Key (e.g., `QA-100`), posts an ADF executive summary
 *    comment on that issue so a native Jira Automation rule ("When: Issue commented") can
 *    immediately send the email without any external webhook egress.
 */
export async function publishNativeJiraExecutiveReport(projectId, bodyPayload, targetChannel = '') {
  const compactSnapshot = {
    timestamp: bodyPayload.timestamp || new Date().toISOString(),
    source: bodyPayload.source || 'Test Pulse Suite v4.7.0 (Runs on Atlassian)',
    projectId: String(projectId || bodyPayload.projectId || ''),
    projectName: bodyPayload.projectName || 'Proyecto',
    projectKey: bodyPayload.projectKey || '',
    recipients: bodyPayload.recipients || '',
    emailSubject: bodyPayload.emailSubject || '',
    plainText: (bodyPayload.plainText || '').slice(0, 4000),
    summary: bodyPayload.summary || {},
    stats: bodyPayload.stats || {},
    mode: 'NATIVE_JIRA_RUNS_ON_ATLASSIAN'
  };

  let propStatus = 200;
  let propOk = true;
  if (projectId) {
    const propRes = await api.asApp().requestJira(
      route`/rest/api/3/project/${projectId}/properties/testpulse-executive-report`,
      {
        method: 'PUT',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(compactSnapshot)
      }
    );
    propStatus = propRes.status || 200;
    propOk = Boolean(propRes.ok || (propStatus >= 200 && propStatus < 300));
  }

  const trimmedTarget = String(targetChannel || '').trim().toUpperCase();
  const isIssueKey = /^[A-Z][A-Z0-9_]*-\d+$/.test(trimmedTarget);
  let commentStatus = null;

  if (isIssueKey) {
    const adfComment = {
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: `📊 ${bodyPayload.emailSubject || 'Reporte Ejecutivo Test Pulse Suite'}` }]
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Destinatarios configurados: ', marks: [{ type: 'strong' }] },
              { type: 'text', text: bodyPayload.recipients || 'Configurados en Jira Automation' }
            ]
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: bodyPayload.plainText || `Reporte publicado para ${bodyPayload.projectName || projectId}.` }
            ]
          }
        ]
      }
    };
    try {
      const cRes = await api.asApp().requestJira(
        route`/rest/api/3/issue/${trimmedTarget}/comment`,
        {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(adfComment)
        }
      );
      commentStatus = cRes.status;
    } catch (e) {
      console.warn('[ReportAutomation] Optional issue comment warning:', e?.message);
    }
  }

  return {
    ok: propOk,
    status: propStatus,
    statusText: propOk ? 'OK (100% Nativo en Jira • Runs on Atlassian)' : 'Error',
    mode: isIssueKey ? `NATIVE_JIRA_ISSUE_COMMENT (${trimmedTarget})` : 'NATIVE_JIRA_PROJECT_PROPERTY',
    commentStatus
  };
}

/**
 * Registers report automation resolvers (`getReportAutomationConfig`,
 * `saveReportAutomationConfig`, `triggerManualReportDispatch`) on the shared Resolver.
 *
 * @param {import('@forge/resolver').default} resolver - Forge Resolver instance.
 * @param {Object} deps - Shared storage helpers (`getAppStorage`, `setAppStorage`).
 */
export function registerReportAutomationResolvers(resolver, { getAppStorage, setAppStorage }) {
  resolver.define('getReportAutomationConfig', async ({ payload, context }) => {
    try {
      const projectId = String(payload?.projectId || context?.extension?.project?.id || '');
      if (!projectId) return { success: false, error: 'ProjectId es requerido' };

      const config = await getAppStorage(`report_automation_config_${projectId}`);
      const lastDispatch = await getAppStorage(`report_automation_last_dispatch_${projectId}`);

      const defaultConfig = {
        enabled: false,
        webhookUrl: 'NATIVE_JIRA',
        recipients: '',
        frequency: 'weekdays', // 'daily', 'weekdays', 'weekly'
        weeklyDay: '5',        // 5 = Friday
        hour: '18',            // 18:00
        minute: '00',
        timezone: 'America/Mexico_City',
        scopePlan: 'all',      // 'all', 'latest', or specific planId
        scopeCycle: 'all',     // 'all', 'latest', or specific cycleId
        sendOnCycleCompleted: false
      };

      return {
        success: true,
        config: config ? { ...defaultConfig, ...config, webhookUrl: config.webhookUrl || 'NATIVE_JIRA' } : defaultConfig,
        lastDispatch: lastDispatch || null
      };
    } catch (err) {
      console.error('[getReportAutomationConfig] Error:', err);
      return { success: false, error: err.message };
    }
  });

  resolver.define('saveReportAutomationConfig', async ({ payload, context }) => {
    try {
      const projectId = String(payload?.projectId || context?.extension?.project?.id || '');
      const config = payload?.config;
      if (!projectId) return { success: false, error: 'ProjectId es requerido' };
      if (!config) return { success: false, error: 'Configuración es requerida' };

      // Report automation (schedule, recipients, target issue) is configured per project
      // by its admins or by Test Pulse superusers.
      await requireProjectAdmin(projectId, context);
      const targetCheck = await validateReportTargetChannel(projectId, config.webhookUrl);
      if (!targetCheck.ok) return { success: false, error: targetCheck.error };

      const normalizedConfig = {
        ...config,
        webhookUrl: String(config.webhookUrl || 'NATIVE_JIRA').trim() || 'NATIVE_JIRA'
      };

      await setAppStorage(`report_automation_config_${projectId}`, normalizedConfig);

      // Update active projects registry
      let activeProjects = (await getAppStorage('report_automation_active_projects')) || [];
      if (!Array.isArray(activeProjects)) activeProjects = [];

      if (normalizedConfig.enabled && !activeProjects.includes(projectId)) {
        activeProjects.push(projectId);
        await setAppStorage('report_automation_active_projects', activeProjects);
      } else if (!normalizedConfig.enabled && activeProjects.includes(projectId)) {
        activeProjects = activeProjects.filter(id => String(id) !== String(projectId));
        await setAppStorage('report_automation_active_projects', activeProjects);
      }

      return { success: true, config: normalizedConfig };
    } catch (err) {
      console.error('[saveReportAutomationConfig] Error:', err);
      return { success: false, error: err.message };
    }
  });

  resolver.define('triggerManualReportDispatch', async ({ payload, context }) => {
    try {
      const projectId = String(payload?.projectId || context?.extension?.project?.id || '');
      const targetChannel = String(payload?.webhookUrl || 'NATIVE_JIRA').trim() || 'NATIVE_JIRA';
      const reportData = payload?.reportData;

      if (!projectId) {
        return { success: false, error: 'ProjectId es requerido para publicar el reporte en Jira' };
      }

      // Any member of the project may publish (membership is enforced by the central
      // filter), but only into an issue of the same project, and only to the recipients an
      // admin configured: recipients sent by the browser are ignored.
      const targetCheck = await validateReportTargetChannel(projectId, targetChannel);
      if (!targetCheck.ok) return { success: false, error: targetCheck.error };
      const storedConfig = (await getAppStorage(`report_automation_config_${projectId}`)) || {};
      const configuredRecipients = String(storedConfig.recipients || '');

      let activeReportData = reportData;
      if (!activeReportData || !activeReportData.htmlReport) {
        const projName = activeReportData?.projectName || 'Proyecto Jira';
        const nowFormatted = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        const testHtml = `
        <div style="max-width: 700px; margin: 0 auto; font-family: sans-serif; border: 1px solid #DFE1E6; border-radius: 8px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #E1007A 0%, #002D62 100%); color: #fff; padding: 18px 24px;">
            <div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #FFE0F0;">TEST PULSE SUITE • PUBLICACIÓN NATIVA JIRA</div>
            <h2 style="margin: 4px 0 0 0; font-size: 20px; color: #ffffff;">Reporte Ejecutivo (100% Nativo en Jira)</h2>
          </div>
          <div style="padding: 20px 24px; color: #172B4D;">
            <p>Este reporte ejecutivo de <strong>Test Pulse Suite</strong> fue publicado de forma <strong>100% nativa en Jira Cloud</strong> (<em>Runs on Atlassian</em>).</p>
            <p><strong>Proyecto:</strong> ${projName}</p>
            <p><strong>Fecha y Hora:</strong> ${nowFormatted} (CDMX)</p>
            <div style="background: #E3FCEF; border: 1px solid #ABF5D1; color: #006644; padding: 12px 16px; border-radius: 6px; font-weight: 600; margin-top: 14px;">
              🟢 El reporte se guardó en la propiedad nativa del proyecto (testpulse-executive-report) sin salida de red externa.
            </div>
          </div>
        </div>
      `;
        activeReportData = {
          projectName: projName,
          projectKey: activeReportData?.projectKey || '',
          recipients: configuredRecipients,
          emailSubject: `[Reporte Ejecutivo] Test Pulse Suite - ${projName} (${nowFormatted})`,
          htmlReport: testHtml,
          plainText: `Test Pulse Suite - Reporte Ejecutivo Nativo para ${projName} (${nowFormatted})`,
          summary: { type: 'NATIVE_JIRA_DISPATCH' },
          stats: {}
        };
      }

      const bodyPayload = {
        timestamp: new Date().toISOString(),
        source: 'Test Pulse Suite v4.7.0 (Runs on Atlassian)',
        projectId: projectId || 'N/A',
        projectName: activeReportData.projectName || 'Proyecto',
        projectKey: activeReportData.projectKey || '',
        recipients: configuredRecipients,
        emailSubject: activeReportData.emailSubject || `[Reporte Ejecutivo] ${activeReportData.projectName}`,
        htmlReport: activeReportData.htmlReport || '',
        plainText: activeReportData.plainText || '',
        summary: activeReportData.summary || {},
        stats: activeReportData.stats || {}
      };

      const nativeRes = await publishNativeJiraExecutiveReport(projectId, bodyPayload, targetChannel);
      const isSuccess = nativeRes.ok;

      const dispatchLog = {
        timestamp: new Date().toISOString(),
        status: isSuccess ? 'SUCCESS' : 'ERROR',
        statusCode: nativeRes.status,
        statusText: nativeRes.statusText,
        responseSummary: `Publicado 100% nativo en Jira (${nativeRes.mode}) • Runs on Atlassian`,
        recipients: configuredRecipients || 'Configurados en Jira Automation (100% Nativo)',
        emailSubject: bodyPayload.emailSubject,
        triggeredBy: context?.accountId || null
      };

      if (projectId) {
        await setAppStorage(`report_automation_last_dispatch_${projectId}`, dispatchLog);
        await appendReportAudit(getAppStorage, setAppStorage, projectId, {
          timestamp: dispatchLog.timestamp,
          accountId: context?.accountId || null,
          target: targetChannel,
          recipients: configuredRecipients,
          status: dispatchLog.status
        });
      }

      if (!isSuccess) {
        return {
          success: false,
          statusCode: nativeRes.status,
          error: `Jira respondió con código ${nativeRes.status} al guardar la propiedad del proyecto.`,
          lastDispatch: dispatchLog
        };
      }

      return {
        success: true,
        statusCode: nativeRes.status,
        message: 'Reporte ejecutivo publicado 100% nativamente en Jira Cloud',
        lastDispatch: dispatchLog
      };
    } catch (err) {
      console.error('[triggerManualReportDispatch] Error:', err);
      return { success: false, error: err.message };
    }
  });
}

/**
 * Factory for the scheduled trigger handler (`scheduledReportHandler`) invoked by Forge.
 *
 * @param {Object} deps - Shared storage helpers (`getAppStorage`, `setAppStorage`).
 * @returns {Function} Scheduled trigger handler function.
 */
export function createScheduledReportHandler({ getAppStorage, setAppStorage }) {
  return async function scheduledReportHandler() {
    try {
      console.log('[scheduledReportHandler] Running scheduled report check (100% Native Jira)...');
      const activeProjects = (await getAppStorage('report_automation_active_projects')) || [];
      if (!Array.isArray(activeProjects) || activeProjects.length === 0) {
        console.log('[scheduledReportHandler] No active report automation projects found.');
        return;
      }

      const now = new Date();
      // Convert to America/Mexico_City time (UTC-6)
      const cdmxDateStr = now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
      const cdmxDate = new Date(cdmxDateStr);
      const currentHour = cdmxDate.getHours();
      const currentDay = cdmxDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday

      for (const projectId of activeProjects) {
        try {
          const config = await getAppStorage(`report_automation_config_${projectId}`);
          if (!config || !config.enabled) continue;

          const targetHour = parseInt(config.hour || '18', 10);
          if (currentHour !== targetHour) continue;

          // Check frequency
          if (config.frequency === 'weekdays' && (currentDay === 0 || currentDay === 6)) {
            continue; // Skip weekends
          } else if (config.frequency === 'weekly') {
            const targetDay = parseInt(config.weeklyDay ?? '5', 10);
            if (currentDay !== targetDay) continue;
          }

          // Prevent duplicate execution in the same day & hour
          const lastDispatch = await getAppStorage(`report_automation_last_dispatch_${projectId}`);
          if (lastDispatch && lastDispatch.timestamp) {
            const lastDate = new Date(lastDispatch.timestamp);
            const lastCdmxStr = lastDate.toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
            const lastCdmxDate = new Date(lastCdmxStr);
            if (lastCdmxDate.toDateString() === cdmxDate.toDateString() && lastCdmxDate.getHours() === currentHour) {
              console.log(`[scheduledReportHandler] Project ${projectId} already ran for this hour.`);
              continue;
            }
          }

          // Fetch project metadata
          let projectName = `Proyecto ${projectId}`;
          let projectKey = projectId;
          try {
            const pRes = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}`);
            if (pRes.ok) {
              const pData = await pRes.json();
              projectName = pData.name || projectName;
              projectKey = pData.key || projectKey;
            }
          } catch (_) {}

          const dateFormatted = cdmxDate.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          const bodyPayload = {
            timestamp: now.toISOString(),
            source: 'Test Pulse Suite Scheduled Trigger (Runs on Atlassian)',
            projectId,
            projectName,
            projectKey,
            recipients: config.recipients || '',
            emailSubject: `[Reporte Ejecutivo Programado] ${projectName} - ${dateFormatted}`,
            plainText: `Reporte Ejecutivo Programado de Test Pulse Suite para ${projectName} (${dateFormatted} CDMX).`,
            dateFormatted,
            scheduledHour: `${config.hour}:00 CDMX`
          };

          const targetChannel = String(config.webhookUrl || 'NATIVE_JIRA').trim() || 'NATIVE_JIRA';
          const nativeRes = await publishNativeJiraExecutiveReport(projectId, bodyPayload, targetChannel);

          await setAppStorage(`report_automation_last_dispatch_${projectId}`, {
            timestamp: now.toISOString(),
            status: nativeRes.ok ? 'SUCCESS' : 'ERROR',
            statusCode: nativeRes.status,
            statusText: nativeRes.statusText,
            responseSummary: `Envío Automático Programado (${nativeRes.mode})`,
            recipients: config.recipients || 'Configurados en regla de Jira',
            emailSubject: bodyPayload.emailSubject
          });
          console.log(`[scheduledReportHandler] Project ${projectId} published natively with status ${nativeRes.status}`);
        } catch (projErr) {
          console.error(`[scheduledReportHandler] Error processing project ${projectId}:`, projErr);
        }
      }
    } catch (err) {
      console.error('[scheduledReportHandler] Fatal error:', err);
    }
  };
}

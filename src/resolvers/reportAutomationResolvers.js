/**
 * @file reportAutomationResolvers.js
 * @description Backend resolvers and scheduled trigger handler for Executive Report
 * Automation via Jira Automation incoming webhooks.
 *
 * Allows project administrators to configure scheduled or manual dispatches of the
 * Executive Quality Report to a Jira Automation webhook in America/Mexico_City timezone.
 */

import api, { route, fetch } from '@forge/api';

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

      return {
        success: true,
        config: config || {
          enabled: false,
          webhookUrl: '',
          recipients: '',
          frequency: 'weekdays', // 'daily', 'weekdays', 'weekly'
          weeklyDay: '5',        // 5 = Friday
          hour: '18',            // 18:00
          minute: '00',
          timezone: 'America/Mexico_City',
          scopePlan: 'all',      // 'all', 'latest', or specific planId
          scopeCycle: 'all',     // 'all', 'latest', or specific cycleId
          sendOnCycleCompleted: false
        },
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

      await setAppStorage(`report_automation_config_${projectId}`, config);

      // Update active projects registry
      let activeProjects = (await getAppStorage('report_automation_active_projects')) || [];
      if (!Array.isArray(activeProjects)) activeProjects = [];

      if (config.enabled && !activeProjects.includes(projectId)) {
        activeProjects.push(projectId);
        await setAppStorage('report_automation_active_projects', activeProjects);
      } else if (!config.enabled && activeProjects.includes(projectId)) {
        activeProjects = activeProjects.filter(id => String(id) !== String(projectId));
        await setAppStorage('report_automation_active_projects', activeProjects);
      }

      return { success: true, config };
    } catch (err) {
      console.error('[saveReportAutomationConfig] Error:', err);
      return { success: false, error: err.message };
    }
  });

  resolver.define('triggerManualReportDispatch', async ({ payload, context }) => {
    try {
      const projectId = String(payload?.projectId || context?.extension?.project?.id || '');
      const webhookUrl = payload?.webhookUrl;
      const reportData = payload?.reportData;

      if (!webhookUrl || !webhookUrl.startsWith('http')) {
        return { success: false, error: 'URL de Webhook inválida o no especificada' };
      }

      let activeReportData = reportData;
      if (!activeReportData || !activeReportData.htmlReport) {
        const projName = activeReportData?.projectName || 'Proyecto Jira';
        const nowFormatted = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        const testHtml = `
        <div style="max-width: 700px; margin: 0 auto; font-family: sans-serif; border: 1px solid #DFE1E6; border-radius: 8px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #E1007A 0%, #002D62 100%); color: #fff; padding: 18px 24px;">
            <div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #FFE0F0;">TEST PULSE SUITE • PRUEBA DE CONEXIÓN</div>
            <h2 style="margin: 4px 0 0 0; font-size: 20px; color: #ffffff;">Reporte Ejecutivo (Prueba)</h2>
          </div>
          <div style="padding: 20px 24px; color: #172B4D;">
            <p>Este es un correo de prueba de <strong>Test Pulse Suite</strong> enviado mediante <strong>Jira Automation</strong>.</p>
            <p><strong>Proyecto:</strong> ${projName}</p>
            <p><strong>Fecha y Hora:</strong> ${nowFormatted} (CDMX)</p>
            <div style="background: #E3FCEF; border: 1px solid #ABF5D1; color: #006644; padding: 12px 16px; border-radius: 6px; font-weight: 600; margin-top: 14px;">
              🟢 La integración con el webhook entrante de Jira Automation está operando correctamente.
            </div>
          </div>
        </div>
      `;
        activeReportData = {
          projectName: projName,
          projectKey: activeReportData?.projectKey || '',
          recipients: activeReportData?.recipients || '',
          emailSubject: `[Prueba de Conexión] Test Pulse Suite - ${projName} (${nowFormatted})`,
          htmlReport: testHtml,
          plainText: `Test Pulse Suite - Prueba de Conexión para ${projName} (${nowFormatted})`,
          summary: { type: 'TEST_DISPATCH' },
          stats: {}
        };
      }

      const bodyPayload = {
        timestamp: new Date().toISOString(),
        source: 'Test Pulse Suite v4.1.0',
        projectId: projectId || 'N/A',
        projectName: activeReportData.projectName || 'Proyecto',
        projectKey: activeReportData.projectKey || '',
        recipients: activeReportData.recipients || '',
        emailSubject: activeReportData.emailSubject || `[Reporte Ejecutivo] ${activeReportData.projectName}`,
        htmlReport: activeReportData.htmlReport || '',
        plainText: activeReportData.plainText || '',
        summary: activeReportData.summary || {},
        stats: activeReportData.stats || {}
      };

      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(bodyPayload)
      });

      const isSuccess = webhookRes.ok || (webhookRes.status >= 200 && webhookRes.status < 300);
      let resText = '';
      try {
        resText = await webhookRes.text();
      } catch (_) {}

      const dispatchLog = {
        timestamp: new Date().toISOString(),
        status: isSuccess ? 'SUCCESS' : 'ERROR',
        statusCode: webhookRes.status,
        statusText: webhookRes.statusText || (isSuccess ? 'OK' : 'Error'),
        responseSummary: resText ? resText.substring(0, 300) : '',
        recipients: reportData?.recipients || 'Configurados en regla de Jira',
        emailSubject: bodyPayload.emailSubject
      };

      if (projectId) {
        await setAppStorage(`report_automation_last_dispatch_${projectId}`, dispatchLog);
      }

      if (!isSuccess) {
        return {
          success: false,
          statusCode: webhookRes.status,
          error: `Jira Automation respondió con código ${webhookRes.status} (${webhookRes.statusText || 'Error'}). ${resText || ''}`,
          lastDispatch: dispatchLog
        };
      }

      return {
        success: true,
        statusCode: webhookRes.status,
        message: 'Reporte ejecutivo enviado exitosamente a Jira Automation',
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
      console.log('[scheduledReportHandler] Running scheduled report check...');
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
          if (!config || !config.enabled || !config.webhookUrl) continue;

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

          // Trigger webhook for Jira Automation
          const bodyPayload = {
            timestamp: now.toISOString(),
            source: 'Test Pulse Suite Scheduled Trigger',
            projectId,
            projectName,
            projectKey,
            recipients: config.recipients || '',
            emailSubject: `[Reporte Ejecutivo Programado] ${projectName} - ${dateFormatted}`,
            dateFormatted,
            scheduledHour: `${config.hour}:00 CDMX`
          };

          const res = await fetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
          });

          await setAppStorage(`report_automation_last_dispatch_${projectId}`, {
            timestamp: now.toISOString(),
            status: res.ok ? 'SUCCESS' : 'ERROR',
            statusCode: res.status,
            statusText: res.statusText || (res.ok ? 'OK' : 'Error'),
            recipients: config.recipients || 'Configurados en regla de Jira',
            emailSubject: bodyPayload.emailSubject
          });
          console.log(`[scheduledReportHandler] Project ${projectId} dispatched with status ${res.status}`);
        } catch (projErr) {
          console.error(`[scheduledReportHandler] Error processing project ${projectId}:`, projErr);
        }
      }
    } catch (err) {
      console.error('[scheduledReportHandler] Fatal error:', err);
    }
  };
}

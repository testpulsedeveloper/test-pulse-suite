/**
 * @file mobileCompanionResolvers.js
 * @description Backend resolvers and Forge WebTrigger handler for the Mobile Companion
 * QR Evidence Upload system.
 *
 * Allows testers to scan a QR code from the Execution screen on their desktop and upload
 * photos/videos directly from their smartphone camera into the Jira Test Run issue and
 * its `testpulse-run-data` entity property.
 */

import api, { route, webTrigger } from '@forge/api';
import { kvs as storage } from '@forge/kvs';
import {
  getIterationEvidenceKeys,
  filterNonIterationEvidences
} from '../utils/statusAndAdfHelpers.js';
import {
  generateMobileErrorHtml,
  generateMobileUploadHtml
} from '../utils/mobileUploadTemplates.js';

const QR_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Registers `createMobileUploadSession` and `checkMobileUploadStatus` resolvers.
 *
 * @param {import('@forge/resolver').default} resolver - Forge Resolver instance.
 */
export function registerMobileCompanionResolvers(resolver) {
  resolver.define('createMobileUploadSession', async ({ payload }) => {
    const { testId, testKey, testRunKey, testRunId, testSummary, iterId, iterName, cycleId } = payload || {};
    const sessionId = 'qr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    let webtriggerUrl = '';
    try {
      webtriggerUrl = await webTrigger.getUrl('mobile-upload-webtrigger');
    } catch (e) {
      console.error('[createMobileUploadSession] Error getting webTrigger URL:', e);
      throw new Error('No se pudo obtener la URL de WebTrigger de Forge: ' + (e.message || String(e)));
    }

    // Attempt to resolve testRunKey from cycle storage if missing
    let resolvedRunKey = testRunKey;
    let resolvedRunId = testRunId;
    if ((!resolvedRunKey || resolvedRunKey === testKey) && cycleId && testId) {
      try {
        const cycleKey = 'cycle_' + cycleId + '_tests';
        const tests = (await storage.get(cycleKey)) || [];
        const match = tests.find(t => String(t.id) === String(testId) || String(t.key) === String(testKey));
        if (match) {
          if (match.testRunKey) resolvedRunKey = match.testRunKey;
          if (match.testRunId) resolvedRunId = match.testRunId;
        }
      } catch (_) {}
    }

    const sessionData = {
      sessionId,
      testId: testId || testKey,
      testKey: testKey || testId,
      testRunKey: resolvedRunKey || testRunKey || testKey || testId,
      testRunId: resolvedRunId || testRunId || resolvedRunKey || testId,
      testSummary: testSummary || 'Caso de Prueba',
      iterId: iterId || null,
      iterName: iterName || null,
      cycleId: cycleId || null,
      createdAt: Date.now()
    };

    await storage.set('qrsession_' + sessionId, sessionData);

    const fullUploadUrl = `${webtriggerUrl}?session=${sessionId}`;
    return {
      sessionId,
      uploadUrl: fullUploadUrl,
      testKey: sessionData.testKey,
      testRunKey: sessionData.testRunKey,
      testRunId: sessionData.testRunId,
      testSummary: sessionData.testSummary,
      iterName: sessionData.iterName
    };
  });

  resolver.define('checkMobileUploadStatus', async ({ payload }) => {
    const { sessionId } = payload || {};
    if (!sessionId) return { uploaded: false };

    const uploadResult = await storage.get('qrupload_' + sessionId);
    if (uploadResult && uploadResult.uploaded) {
      // Delete receipt so consumed items won't duplicate on subsequent polls
      await storage.delete('qrupload_' + sessionId);
      const evidencesList = Array.isArray(uploadResult.evidences) && uploadResult.evidences.length > 0
        ? uploadResult.evidences
        : (uploadResult.evidence ? [uploadResult.evidence] : []);
      return {
        uploaded: true,
        evidence: uploadResult.evidence || evidencesList[evidencesList.length - 1],
        evidences: evidencesList,
        testId: uploadResult.testId,
        iterId: uploadResult.iterId,
        timestamp: uploadResult.timestamp
      };
    }

    return { uploaded: false };
  });
}

/**
 * Forge WebTrigger handler (`mobileUploadHandler`) that serves the mobile upload HTML UI
 * on `GET` and processes base64 photo/video uploads on `POST`.
 *
 * @param {Object} request - Forge WebTrigger HTTP request object.
 * @returns {Promise<Object>} Forge WebTrigger HTTP response object.
 */
export async function mobileUploadHandler(request) {
  const method = request.method ? request.method.toUpperCase() : 'GET';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Methods': ['GET', 'POST', 'OPTIONS'],
        'Access-Control-Allow-Headers': ['Content-Type', 'Authorization', 'X-Requested-With']
      },
      body: ''
    };
  }

  const defaultHeaders = {
    'Access-Control-Allow-Origin': ['*'],
    'Access-Control-Allow-Headers': ['Content-Type', 'Authorization', 'X-Requested-With']
  };

  if (method === 'GET') {
    const query = request.queryParameters || {};
    let sessionId = (query.session && query.session[0]) || query.session || '';
    if (!sessionId && request.url) {
      try {
        const u = new URL(request.url, 'https://forge.atlassian.com');
        sessionId = u.searchParams.get('session') || '';
      } catch (_) {}
    }

    if (!sessionId) {
      return {
        statusCode: 400,
        headers: { ...defaultHeaders, 'Content-Type': ['text/html; charset=utf-8'] },
        body: generateMobileErrorHtml(
          'Enlace no válido',
          'Falta el identificador de sesión. Por favor escanea el código QR desde la pantalla de ejecución de Test Pulse.'
        )
      };
    }

    const session = await storage.get('qrsession_' + sessionId);
    const isExpired = session?.createdAt && (Date.now() - session.createdAt > QR_SESSION_TTL_MS);
    if (!session || isExpired) {
      if (isExpired) await storage.delete('qrsession_' + sessionId).catch(() => {});
      return {
        statusCode: 404,
        headers: { ...defaultHeaders, 'Content-Type': ['text/html; charset=utf-8'] },
        body: generateMobileErrorHtml(
          'Sesión no encontrada',
          'El código QR ha expirado o ya fue utilizado. Por favor abre nuevamente el modal QR en tu computadora.'
        )
      };
    }

    const html = generateMobileUploadHtml(session);
    return {
      statusCode: 200,
      headers: { ...defaultHeaders, 'Content-Type': ['text/html; charset=utf-8'] },
      body: html
    };
  }

  if (method === 'POST') {
    try {
      let body = {};
      try {
        body = typeof request.body === 'string' ? JSON.parse(request.body) : (request.body || {});
      } catch (e) {
        return {
          statusCode: 400,
          headers: { ...defaultHeaders, 'Content-Type': ['application/json'] },
          body: JSON.stringify({ success: false, error: 'JSON malformado' })
        };
      }

      const { sessionId, base64Data, mimeType, note } = body;
      if (!sessionId || !base64Data) {
        return {
          statusCode: 400,
          headers: { ...defaultHeaders, 'Content-Type': ['application/json'] },
          body: JSON.stringify({ success: false, error: 'Faltan datos de sesión o imagen base64' })
        };
      }

      const session = await storage.get('qrsession_' + sessionId);
      const isExpired = session?.createdAt && (Date.now() - session.createdAt > QR_SESSION_TTL_MS);
      if (!session || isExpired) {
        if (isExpired) await storage.delete('qrsession_' + sessionId).catch(() => {});
        return {
          statusCode: 404,
          headers: { ...defaultHeaders, 'Content-Type': ['application/json'] },
          body: JSON.stringify({ success: false, error: 'Sesión expirada. Genera un nuevo QR en la computadora.' })
        };
      }

      const targetIssue = session.testRunKey || session.testRunId || session.testKey || session.testId;
      const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buffer = Buffer.from(cleanBase64, 'base64');
      const resolvedMime = mimeType || 'image/jpeg';
      const ext = resolvedMime.includes('png')
        ? 'png'
        : (resolvedMime.includes('video') || resolvedMime.includes('mp4'))
          ? 'mp4'
          : 'jpg';

      // Generate unique filename with Test Run prefix, timestamp, and short random suffix
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timeStampStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const randSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const prefix = session.testRunKey || session.testKey || 'EV';
      const finalFilename = `EV_${prefix}_${timeStampStr}_${randSuffix}.${ext}`;

      const blob = new Blob([buffer], { type: resolvedMime });
      const formData = new FormData();
      formData.append('file', blob, finalFilename);

      const attachRes = await api.asApp().requestJira(route`/rest/api/3/issue/${targetIssue}/attachments`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'X-Atlassian-Token': 'no-check'
        },
        body: formData
      });

      if (!attachRes.ok) {
        const errText = await attachRes.text();
        console.error('[mobileUploadHandler] Jira attachment error:', attachRes.status, errText);
        return {
          statusCode: 500,
          headers: { ...defaultHeaders, 'Content-Type': ['application/json'] },
          body: JSON.stringify({ success: false, error: `Error Jira (${attachRes.status}): ${errText}` })
        };
      }

      const attachData = await attachRes.json();
      const uploadedItem = Array.isArray(attachData) ? attachData[0] : attachData;

      // If tester included a note from smartphone, add native comment to Test Run in Jira
      if (note && typeof note === 'string' && note.trim().length > 0) {
        try {
          await api.asApp().requestJira(route`/rest/api/3/issue/${targetIssue}/comment`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              body: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: `📸 Evidencia Móvil (${uploadedItem.filename || finalFilename}): `, marks: [{ type: 'strong' }] },
                      { type: 'text', text: note.trim() }
                    ]
                  }
                ]
              }
            })
          });
        } catch (commentErr) {
          console.warn('[mobileUploadHandler] Could not post comment to Jira issue:', commentErr);
        }
      }

      const evidenceObject = {
        id: String(uploadedItem.id),
        filename: uploadedItem.filename || finalFilename,
        url: uploadedItem.content,
        mimeType: resolvedMime,
        note: (note && typeof note === 'string') ? note.trim() : '',
        uploadedAt: new Date().toISOString(),
        source: 'mobile_camera'
      };

      // Persist directly to testpulse-run-data of Test Run so evidence is never lost even if desktop modal closed
      try {
        const runRes = await api.asApp().requestJira(route`/rest/api/3/issue/${targetIssue}?properties=testpulse-run-data`);
        if (runRes.ok) {
          const runIssue = await runRes.json();
          const currentProp = runIssue.properties?.['testpulse-run-data'] || {};
          let updatedProp = { ...currentProp };

          if (session.iterId && Array.isArray(currentProp.iterations)) {
            const iters = [...currentProp.iterations];
            const iterIdx = iters.findIndex(i => String(i.id) === String(session.iterId));
            if (iterIdx > -1) {
              const existingIterEvs = Array.isArray(iters[iterIdx].evidences) ? iters[iterIdx].evidences : [];
              const alreadyExists = existingIterEvs.some(e => String(typeof e === 'object' ? e.id : e) === String(evidenceObject.id));
              if (!alreadyExists) {
                iters[iterIdx] = {
                  ...iters[iterIdx],
                  evidences: [...existingIterEvs, evidenceObject]
                };
              }
              const iterKeys = getIterationEvidenceKeys(iters);
              const cleanEvs = filterNonIterationEvidences(currentProp.evidences || [], iterKeys);
              updatedProp = {
                ...currentProp,
                iterations: iters,
                evidences: cleanEvs
              };
            } else {
              const existingEvs = Array.isArray(currentProp.evidences) ? currentProp.evidences : [];
              const alreadyExists = existingEvs.some(e => String(typeof e === 'object' ? e.id : e) === String(evidenceObject.id));
              if (!alreadyExists) {
                updatedProp = {
                  ...currentProp,
                  evidences: [...existingEvs, evidenceObject]
                };
              }
            }
          } else {
            const existingEvs = Array.isArray(currentProp.evidences) ? currentProp.evidences : [];
            const alreadyExists = existingEvs.some(e => String(typeof e === 'object' ? e.id : e) === String(evidenceObject.id));
            if (!alreadyExists) {
              updatedProp = {
                ...currentProp,
                evidences: [...existingEvs, evidenceObject]
              };
            }
          }

          await api.asApp().requestJira(route`/rest/api/3/issue/${targetIssue}/properties/testpulse-run-data`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedProp)
          });
        }
      } catch (propErr) {
        console.warn('[mobileUploadHandler] Could not persist evidence directly to testpulse-run-data:', propErr);
      }

      // Accumulate in session queue (qrupload_<sessionId>) so desktop polling receives all uploaded evidences
      const existingQueue = (await storage.get('qrupload_' + sessionId)) || {};
      const prevEvidences = Array.isArray(existingQueue.evidences)
        ? existingQueue.evidences
        : (existingQueue.evidence ? [existingQueue.evidence] : []);
      const updatedQueueEvidences = [
        ...prevEvidences.filter(e => String(e.id) !== String(evidenceObject.id)),
        evidenceObject
      ];

      await storage.set('qrupload_' + sessionId, {
        uploaded: true,
        evidence: evidenceObject,
        evidences: updatedQueueEvidences,
        testId: session.testId,
        testKey: session.testKey,
        iterId: session.iterId,
        cycleId: session.cycleId,
        timestamp: Date.now()
      });

      const prevHistory = Array.isArray(session.uploadedHistory) ? session.uploadedHistory : [];
      await storage.set('qrsession_' + sessionId, {
        ...session,
        uploadedHistory: [
          ...prevHistory.filter(h => String(h.id) !== String(evidenceObject.id)),
          { id: evidenceObject.id, filename: evidenceObject.filename, uploadedAt: evidenceObject.uploadedAt }
        ]
      }).catch(() => {});

      return {
        statusCode: 200,
        headers: { ...defaultHeaders, 'Content-Type': ['application/json'] },
        body: JSON.stringify({ success: true, evidence: evidenceObject })
      };
    } catch (err) {
      console.error('[mobileUploadHandler] POST exception:', err);
      return {
        statusCode: 500,
        headers: { ...defaultHeaders, 'Content-Type': ['application/json'] },
        body: JSON.stringify({ success: false, error: err.message || String(err) })
      };
    }
  }

  return {
    statusCode: 405,
    headers: { ...defaultHeaders, 'Content-Type': ['application/json'] },
    body: JSON.stringify({ error: 'Método no permitido' })
  };
}

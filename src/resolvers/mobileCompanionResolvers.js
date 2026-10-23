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
import { randomBytes } from 'node:crypto';
import {
  QR_SESSION_TTL_MS,
  MAX_UPLOADS_PER_SESSION,
  MAX_MOBILE_UPLOAD_BYTES,
  MIN_HMAC_SECRET_LENGTH,
  generateMobileSessionId,
  resolveAllowedMobileMime,
  signMobileSessionToken,
  verifyMobileSessionToken,
  resolveSafeCorsOrigin
} from '../utils/mobileSecurity.js';
import {
  getIssueVisibleToUser,
  userHasPermissions
} from '../utils/authz.js';

export {
  QR_SESSION_TTL_MS,
  MAX_UPLOADS_PER_SESSION,
  signMobileSessionToken,
  verifyMobileSessionToken,
  resolveSafeCorsOrigin
};

// Key of the encrypted KVS secret that holds the per-installation HMAC key.
const MOBILE_HMAC_KVS_SECRET_KEY = 'tp_mobile_hmac_secret_v2';

// In-memory copy of the HMAC key so warm invocations skip the KVS read.
let _cachedHmacSecret = null;

/**
 * Returns the HMAC key used to sign QR upload sessions. Resolution order:
 *  1. `FORGE_MOBILE_HMAC_SECRET` encrypted Forge variable
 *     (`forge variables set --encrypt FORGE_MOBILE_HMAC_SECRET <value>`), if it is long enough.
 *  2. A random 256-bit key generated once per installation and stored in the
 *     encrypted KVS secret store (`kvs.setSecret`). It is never sent to the browser.
 *
 * `FAIL_IF_EXISTS` guarantees that two concurrent first calls cannot overwrite each
 * other's key: the loser simply re-reads the winner's value.
 *
 * @returns {Promise<string>}
 */
export async function getMobileHmacSecret() {
  if (_cachedHmacSecret) return _cachedHmacSecret;

  const envSecret = process.env.FORGE_MOBILE_HMAC_SECRET;
  if (envSecret && envSecret.length >= MIN_HMAC_SECRET_LENGTH) {
    _cachedHmacSecret = envSecret;
    return _cachedHmacSecret;
  }

  let stored = await storage.getSecret(MOBILE_HMAC_KVS_SECRET_KEY);
  if (!stored) {
    const generated = randomBytes(32).toString('hex');
    try {
      await storage.setSecret(MOBILE_HMAC_KVS_SECRET_KEY, generated, { keyPolicy: 'FAIL_IF_EXISTS' });
      stored = generated;
    } catch (_) {
      // Another invocation created the key first: use theirs.
      stored = await storage.getSecret(MOBILE_HMAC_KVS_SECRET_KEY);
    }
  }
  if (!stored) throw new Error('No se pudo inicializar la llave de seguridad de sesiones móviles.');
  _cachedHmacSecret = stored;
  return _cachedHmacSecret;
}

/**
 * Builds a JSON WebTrigger response with the shared CORS headers.
 */
function jsonResponse(statusCode, defaultHeaders, bodyObj) {
  return {
    statusCode,
    headers: { ...defaultHeaders, 'Content-Type': ['application/json'] },
    body: JSON.stringify(bodyObj)
  };
}

/**
 * Registers `createMobileUploadSession` and `checkMobileUploadStatus` resolvers.
 *
 * @param {import('@forge/resolver').default} resolver - Forge Resolver instance.
 */
export function registerMobileCompanionResolvers(resolver) {
  resolver.define('createMobileUploadSession', async ({ payload, context }) => {
    const { testId, testKey, testRunKey, testRunId, testSummary, iterId, iterName, cycleId } = payload || {};
    const createdAt = Date.now();
    const sessionId = generateMobileSessionId();
    const sessionToken = signMobileSessionToken(sessionId, createdAt, await getMobileHmacSecret());

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

    // SECURITY: the WebTrigger later writes to this issue with `.asApp()` (the phone has no
    // Jira session). We therefore resolve the target issue AS THE USER right now and require
    // that they can both edit it and attach files to it. The canonical id/key returned by
    // Jira is stored in the session, so nothing the browser sent is trusted afterwards.
    const requestedTarget = resolvedRunKey || testRunKey || resolvedRunId || testRunId || testKey || testId;
    const targetIssue = await getIssueVisibleToUser(requestedTarget);
    if (!targetIssue) {
      throw new Error('No tienes acceso a la ejecución seleccionada o la referencia no es válida.');
    }
    const canUpload = await userHasPermissions(
      { issueId: targetIssue.id },
      ['EDIT_ISSUES', 'CREATE_ATTACHMENTS']
    );
    if (!canUpload) {
      throw new Error('No tienes permisos para adjuntar evidencias en esta ejecución.');
    }

    const sessionData = {
      sessionId,
      sessionToken,
      testId: testId || testKey,
      testKey: testKey || testId,
      testRunKey: targetIssue.key,
      testRunId: targetIssue.id,
      projectId: targetIssue.projectId,
      createdBy: context?.accountId || null,
      testSummary: String(testSummary || 'Caso de Prueba').slice(0, 255),
      iterId: iterId || null,
      iterName: iterName ? String(iterName).slice(0, 120) : null,
      cycleId: cycleId || null,
      createdAt
    };

    await storage.set('qrsession_' + sessionId, sessionData);

    const fullUploadUrl = `${webtriggerUrl}?session=${encodeURIComponent(sessionId)}&sig=${encodeURIComponent(sessionToken)}`;
    return {
      sessionId,
      sessionToken,
      uploadUrl: fullUploadUrl,
      testKey: sessionData.testKey,
      testRunKey: sessionData.testRunKey,
      testRunId: sessionData.testRunId,
      testSummary: sessionData.testSummary,
      iterName: sessionData.iterName
    };
  });

  resolver.define('checkMobileUploadStatus', async ({ payload, context }) => {
    const { sessionId } = payload || {};
    if (!sessionId || typeof sessionId !== 'string') return { uploaded: false };

    // Only the user who opened the QR session may consume its upload receipts.
    const session = await storage.get('qrsession_' + sessionId);
    if (session?.createdBy && session.createdBy !== context?.accountId) {
      return { uploaded: false };
    }

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
  const corsOrigin = resolveSafeCorsOrigin(request.headers);

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': [corsOrigin],
        'Access-Control-Allow-Methods': ['GET', 'POST', 'OPTIONS'],
        'Access-Control-Allow-Headers': ['Content-Type', 'Authorization', 'X-Requested-With'],
        'Vary': ['Origin']
      },
      body: ''
    };
  }

  const defaultHeaders = {
    'Access-Control-Allow-Origin': [corsOrigin],
    'Access-Control-Allow-Headers': ['Content-Type', 'Authorization', 'X-Requested-With'],
    'Vary': ['Origin']
  };

  if (method === 'GET') {
    const query = request.queryParameters || {};
    let sessionId = (query.session && query.session[0]) || query.session || '';
    let querySig = (query.sig && query.sig[0]) || query.sig || '';
    if (!sessionId && request.url) {
      try {
        const u = new URL(request.url, 'https://forge.atlassian.com');
        sessionId = u.searchParams.get('session') || '';
        querySig = querySig || u.searchParams.get('sig') || '';
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

    // The signature is MANDATORY: a missing `sig` is rejected exactly like a forged one.
    const hmacSecret = await getMobileHmacSecret();
    if (!verifyMobileSessionToken(sessionId, session.createdAt, String(querySig || ''), hmacSecret)) {
      return {
        statusCode: 403,
        headers: { ...defaultHeaders, 'Content-Type': ['text/html; charset=utf-8'] },
        body: generateMobileErrorHtml(
          'Firma de seguridad inválida',
          'El código QR escaneado no superó la verificación criptográfica HMAC. Genera un nuevo código QR desde tu computadora.'
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

      const { sessionId, sessionToken, base64Data, mimeType, note } = body;
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

      // The signature is MANDATORY: a missing token is rejected exactly like a forged one.
      const hmacSecret = await getMobileHmacSecret();
      if (!verifyMobileSessionToken(sessionId, session.createdAt, sessionToken, hmacSecret)) {
        return jsonResponse(403, defaultHeaders, { success: false, error: 'Firma HMAC de sesión inválida.' });
      }

      // Only accept camera media types and cap the decoded size, so the public endpoint
      // cannot be abused to store arbitrary (e.g. HTML/SVG) or oversized files in Jira.
      const allowedMime = resolveAllowedMobileMime(mimeType || 'image/jpeg');
      if (!allowedMime) {
        return jsonResponse(415, defaultHeaders, { success: false, error: 'Tipo de archivo no permitido. Solo fotos o videos.' });
      }
      if (typeof base64Data !== 'string') {
        return jsonResponse(400, defaultHeaders, { success: false, error: 'Formato de archivo inválido.' });
      }
      // Base64 encodes 3 bytes in 4 chars, so this is a cheap pre-check before decoding.
      if (base64Data.length > Math.ceil(MAX_MOBILE_UPLOAD_BYTES / 3) * 4 + 256) {
        return jsonResponse(413, defaultHeaders, { success: false, error: 'El archivo supera el límite de 10 MB.' });
      }

      const prevHistoryForLimit = Array.isArray(session.uploadedHistory) ? session.uploadedHistory : [];
      if (prevHistoryForLimit.length >= MAX_UPLOADS_PER_SESSION) {
        return {
          statusCode: 429,
          headers: { ...defaultHeaders, 'Content-Type': ['application/json'] },
          body: JSON.stringify({
            success: false,
            error: `Se alcanzó el límite de ${MAX_UPLOADS_PER_SESSION} evidencias por sesión QR. Genera un nuevo QR en tu computadora.`
          })
        };
      }

      // Target issue was resolved and permission-checked as the user when the session was created.
      const targetIssue = session.testRunId || session.testRunKey;
      if (!targetIssue) {
        return jsonResponse(400, defaultHeaders, { success: false, error: 'Sesión sin ejecución destino. Genera un nuevo QR.' });
      }
      const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buffer = Buffer.from(cleanBase64, 'base64');
      if (buffer.length === 0 || buffer.length > MAX_MOBILE_UPLOAD_BYTES) {
        return jsonResponse(413, defaultHeaders, { success: false, error: 'El archivo está vacío o supera el límite de 10 MB.' });
      }
      const resolvedMime = allowedMime.mime;
      const ext = allowedMime.ext;

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
        // Do not echo Jira's raw error body to the public endpoint; details stay in `forge logs`.
        return jsonResponse(502, defaultHeaders, { success: false, error: `Jira rechazó la evidencia (HTTP ${attachRes.status}).` });
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
      return jsonResponse(500, defaultHeaders, { success: false, error: 'Error interno al procesar la evidencia.' });
    }
  }

  return {
    statusCode: 405,
    headers: { ...defaultHeaders, 'Content-Type': ['application/json'] },
    body: JSON.stringify({ error: 'Método no permitido' })
  };
}

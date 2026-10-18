/**
 * Bug Inspection, SLA Resolution Time & In-App Editing Resolvers
 *
 * Encapsulates:
 * - getBugsResolutionTime (SLA phase timing using business hours)
 * - getBugDetailsBatch (Lightweight batch bug status/priority/resolution lookup)
 * - getBugFullDetails (Full Bug slide-out panel inspection, custom field discovery, editmeta, transitions)
 * - updateBugIssue (In-app Bug editing for assignee, status transitions, *Severity, fixVersions, estimatedDate, environment, resolution)
 * - addBugComment (In-app Bug comment posting with multipart attachment uploads)
 */

import api, { route } from '@forge/api';
import { getBusinessMilliseconds, analyzeBugChangelog } from '../utils/slaHelpers.js';
import { invalidateProjectReportCache } from '../utils/reportSnapshotCache.js';

// Helper to extract plain editable text from Jira's Environment field (which may be ADF or HTML/string)
function extractPlainTextFromEnv(rawEnv, renderedEnv) {
  if (!rawEnv && !renderedEnv) return '';
  if (typeof rawEnv === 'string') {
    return rawEnv.replace(/<[^>]+>/g, '').trim();
  }
  if (rawEnv && typeof rawEnv === 'object') {
    const walkAdf = (node) => {
      if (!node) return '';
      if (Array.isArray(node)) return node.map(walkAdf).join('');
      if (node.type === 'text') return node.text || '';
      if (node.type === 'hardBreak') return '\n';
      const inner = node.content ? walkAdf(node.content) : '';
      if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') {
        return inner + '\n';
      }
      return inner;
    };
    return walkAdf(rawEnv).replace(/\n{3,}/g, '\n\n').trim();
  }
  if (typeof renderedEnv === 'string') {
    return renderedEnv
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .trim();
  }
  return '';
}

export function registerBugResolvers(resolver) {
  // === Bug Resolution Time ===
  resolver.define('getBugsResolutionTime', async ({ payload }) => {
    const { bugKeys } = payload;
    if (!bugKeys || !Array.isArray(bugKeys) || bugKeys.length === 0) {
      return {
        nuevoAnalisis: 0,
        analisisCurso: 0,
        cursoResuelta: 0,
        resueltaCerrada: 0,
        averageHours: 0
      };
    }

    let sumNuevoAnalisis = 0, cntNuevoAnalisis = 0;
    let sumAnalisisCurso = 0, cntAnalisisCurso = 0;
    let sumCursoResuelta = 0, cntCursoResuelta = 0;
    let sumResueltaCerrada = 0, cntResueltaCerrada = 0;

    let totalHours = 0;
    let countTotal = 0;
    let bugsReopened = 0;

    try {
      const uniqueBugKeys = Array.from(new Set(bugKeys.map(k => String(k || '').trim()).filter(Boolean)));
      const allBugIssues = [];
      for (let i = 0; i < uniqueBugKeys.length; i += 50) {
        const chunk = uniqueBugKeys.slice(i, i + 50);
        const jql = `key in (${chunk.map(k => `"${k}"`).join(',')})`;
        const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jql,
            expand: 'changelog',
            fields: ['created', 'status', 'resolutiondate'],
            maxResults: chunk.length
          })
        });
        if (response.ok) {
          const data = await response.json();
          allBugIssues.push(...(data.issues || data.values || []));
        }
        if (i + 50 < uniqueBugKeys.length) {
          await new Promise(r => setTimeout(r, 80));
        }
      }

      for (const issue of allBugIssues) {
        const changelog = issue.changelog?.histories || [];
        const changelogMeta = analyzeBugChangelog(issue);
        const baseStartStr = (changelogMeta.isReopened && changelogMeta.reopenedAt)
          ? changelogMeta.reopenedAt
          : (issue.fields?.created || null);
        const createdTime = new Date(baseStartStr || Date.now()).getTime();

        let times = { atencion: null, resuelta: null, cerrada: null };
        const isReopened = changelogMeta.isReopened;

        for (const history of changelog) {
          const time = new Date(history.created).getTime();
          if (time < createdTime) continue; // Only measure phases within the active cycle (after reopen if reopened)
          const statusItem = (history.items || []).find(item => item.field === 'status');
          if (statusItem) {
            const toString = (statusItem.toString || '').toLowerCase();

            if (toString.includes('analisis') || toString.includes('análisis') || toString.includes('curso') || toString === 'in progress' || toString.includes('revis') || toString.includes('review')) {
              if (!times.atencion || time < times.atencion) times.atencion = time;
            } else if (toString.includes('resuelta') || toString === 'resolved' || toString === 'done' || toString.includes('listo')) {
              if (!times.resuelta || time < times.resuelta) times.resuelta = time;
            } else if (toString.includes('cerrada') || toString === 'closed' || toString.includes('aceptado')) {
              if (!times.cerrada || time < times.cerrada) times.cerrada = time;
            }
          }
        }

        // Diffs in ms using Business Hours
        if (times.atencion) {
          sumNuevoAnalisis += getBusinessMilliseconds(createdTime, times.atencion);
          cntNuevoAnalisis++;
        } else if (times.resuelta) {
          sumNuevoAnalisis += getBusinessMilliseconds(createdTime, times.resuelta);
          cntNuevoAnalisis++;
        }

        if (times.atencion && times.resuelta && times.resuelta > times.atencion) {
          sumAnalisisCurso += getBusinessMilliseconds(times.atencion, times.resuelta);
          cntAnalisisCurso++;
        }

        if (times.resuelta && times.cerrada && times.cerrada > times.resuelta) {
          sumCursoResuelta += getBusinessMilliseconds(times.resuelta, times.cerrada);
          cntCursoResuelta++;
        }

        if (isReopened) {
          bugsReopened++;
        }

        if (typeof changelogMeta.resolutionBusinessHours === 'number' && !isNaN(changelogMeta.resolutionBusinessHours)) {
          totalHours += changelogMeta.resolutionBusinessHours;
          countTotal++;
        } else {
          const finalTime = times.cerrada || times.resuelta;
          if (finalTime && finalTime > createdTime) {
            totalHours += getBusinessMilliseconds(createdTime, finalTime) / (1000 * 60 * 60);
            countTotal++;
          }
        }
      }
    } catch (e) {
      console.log(`Failed to fetch bulk changelog`, e);
    }

    const toHours = (sum, cnt) => cnt > 0 ? (sum / cnt) / (1000 * 60 * 60) : 0;

    return {
      nuevoAnalisis: toHours(sumNuevoAnalisis, cntNuevoAnalisis),
      analisisCurso: toHours(sumAnalisisCurso, cntAnalisisCurso),
      cursoResuelta: toHours(sumCursoResuelta, cntCursoResuelta),
      resueltaCerrada: toHours(sumResueltaCerrada, cntResueltaCerrada),
      averageHours: countTotal > 0 ? (totalHours / countTotal) : 0,
      reopenedCount: bugsReopened
    };
  });

  resolver.define('getBugDetailsBatch', async ({ payload }) => {
    const { bugKeys } = payload;
    if (!bugKeys || !Array.isArray(bugKeys) || bugKeys.length === 0) return [];

    try {
      const uniqueBugKeys = Array.from(new Set(bugKeys.map(k => String(k || '').trim()).filter(Boolean)));
      const allIssues = [];
      for (let i = 0; i < uniqueBugKeys.length; i += 50) {
        const chunk = uniqueBugKeys.slice(i, i + 50);
        const jql = `key in (${chunk.map(k => `"${k}"`).join(',')})`;
        const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jql,
            fields: ['summary', 'priority', 'status', 'assignee', 'resolution'],
            maxResults: chunk.length
          })
        });
        if (response.ok) {
          const data = await response.json();
          allIssues.push(...(data.issues || data.values || []));
        } else {
          console.error("Error fetching bugs", await response.text());
        }
        if (i + 50 < uniqueBugKeys.length) {
          await new Promise(r => setTimeout(r, 80));
        }
      }

      return allIssues.map(issue => ({
        key: issue.key,
        summary: issue.fields?.summary,
        priority: issue.fields?.priority?.name || 'N/A',
        status: issue.fields?.status?.name || 'N/A',
        assignee: issue.fields?.assignee?.displayName || 'Unassigned',
        resolution: issue.fields?.resolution?.name || 'Unresolved'
      }));
    } catch (e) {
      console.error("Exception fetching bugs", e);
      return [];
    }
  });

  resolver.define('getBugFullDetails', async ({ payload }) => {
    try {
      const { issueIdOrKey } = payload;
      if (!issueIdOrKey) return null;

      // Fetch all relevant fields plus editmeta and transitions in parallel for fast in-app editing
      const [response, editMetaRes, transitionsRes, resolutionsRes] = await Promise.all([
        api.asUser().requestJira(
          route`/rest/api/3/issue/${issueIdOrKey}?expand=renderedFields,changelog,names`
        ),
        api.asUser().requestJira(
          route`/rest/api/3/issue/${issueIdOrKey}/editmeta`
        ).catch(() => null),
        api.asUser().requestJira(
          route`/rest/api/3/issue/${issueIdOrKey}/transitions?expand=transitions.fields`
        ).catch(() => null),
        api.asUser().requestJira(
          route`/rest/api/3/resolution`
        ).catch(() => null)
      ]);

      if (!response.ok) {
        console.warn(`[getBugFullDetails] Failed to fetch bug ${issueIdOrKey}:`, response.status);
        return null;
      }
      const data = await response.json();
      const f = data.fields || {};
      const rf = data.renderedFields || {};
      const fieldNamesMap = data.names || {};
      const changelogMeta = analyzeBugChangelog(data);

      // Parse editmeta, transitions, and resolutions
      const editMetaData = (editMetaRes && editMetaRes.ok) ? await editMetaRes.json().catch(() => ({})) : {};
      const editFields = editMetaData.fields || {};
      const transitionsData = (transitionsRes && transitionsRes.ok) ? await transitionsRes.json().catch(() => ({})) : {};
      const globalResolutions = (resolutionsRes && resolutionsRes.ok) ? await resolutionsRes.json().catch(() => ([])) : [];

      // Project info & project versions for fixVersions
      const projectKey = f.project?.key || (String(data.key || issueIdOrKey).includes('-') ? String(data.key || issueIdOrKey).split('-')[0] : '');
      const projectId = f.project?.id ? String(f.project.id) : '';
      let projectVersionsRaw = [];
      const projIdentifier = projectKey || projectId;
      if (projIdentifier) {
        try {
          const verRes = await api.asUser().requestJira(route`/rest/api/3/project/${projIdentifier}/versions`);
          if (verRes && verRes.ok) {
            const verJson = await verRes.json();
            if (Array.isArray(verJson)) projectVersionsRaw = verJson;
          }
        } catch (verErr) {
          console.warn(`[getBugFullDetails] Could not fetch versions for project ${projIdentifier}:`, verErr.message);
        }
      }

      // Discover *Severity custom field ID & allowed options (strictly *Severity, NOT priority)
      let severityFieldId = 'customfield_10238';
      for (const [fKey, fMeta] of Object.entries(editFields)) {
        const mName = String(fMeta?.name || '').trim();
        if (/^\*?severity$/i.test(mName) || /^\*?severidad$/i.test(mName) || mName.toLowerCase().includes('severity') || mName.toLowerCase().includes('severidad')) {
          severityFieldId = fKey;
          break;
        }
      }
      if (severityFieldId === 'customfield_10238' && !f.customfield_10238 && !editFields.customfield_10238) {
        for (const [fKey, fLabel] of Object.entries(fieldNamesMap)) {
          const mName = String(fLabel || '').trim();
          if (/^\*?severity$/i.test(mName) || /^\*?severidad$/i.test(mName) || mName.toLowerCase().includes('severity') || mName.toLowerCase().includes('severidad')) {
            severityFieldId = fKey;
            break;
          }
        }
      }

      const sevAllowedRaw = editFields[severityFieldId]?.allowedValues || editFields.customfield_10238?.allowedValues || [];
      const severityOptions = sevAllowedRaw.length > 0
        ? sevAllowedRaw.map(opt => ({
            id: opt.id ? String(opt.id) : '',
            value: String(opt.value || opt.name || opt.label || '')
          })).filter(o => o.value)
        : [
            { id: '', value: 'Bloqueante' },
            { id: '', value: 'Crítico' },
            { id: '', value: 'Mayor' },
            { id: '', value: 'Medio' },
            { id: '', value: 'Menor' }
          ];

      // Discover Fecha Estimada custom field ID (strictly custom field, NOT duedate)
      const isEstDateFieldName = (rawName) => {
        const mName = String(rawName || '').trim().toLowerCase();
        return (
          mName.includes('fecha estimada') ||
          mName.includes('fecha de solución') ||
          mName.includes('fecha de solucion') ||
          mName.includes('solución estimada') ||
          mName.includes('solucion estimada') ||
          mName.includes('estimated')
        );
      };
      const estDateCandidateIds = [];
      for (const [fKey, fMeta] of Object.entries(editFields)) {
        if (fKey === 'duedate') continue;
        if (isEstDateFieldName(fMeta?.name)) {
          if (!estDateCandidateIds.includes(fKey)) estDateCandidateIds.push(fKey);
        }
      }
      for (const [fKey, fLabel] of Object.entries(fieldNamesMap)) {
        if (fKey === 'duedate') continue;
        if (isEstDateFieldName(fLabel)) {
          if (!estDateCandidateIds.includes(fKey)) estDateCandidateIds.push(fKey);
        }
      }
      if (!estDateCandidateIds.includes('customfield_10763')) {
        estDateCandidateIds.push('customfield_10763');
      }
      // Prefer a candidate field that currently holds a value, otherwise the first editable/discovered candidate
      const populatedEstFieldId = estDateCandidateIds.find(id => f[id] !== undefined && f[id] !== null && f[id] !== '');
      const estDateFieldId = populatedEstFieldId || estDateCandidateIds[0] || 'customfield_10763';

      // Available project versions for fixVersions / versions
      const editFixVerAllowed = editFields.fixVersions?.allowedValues || [];
      const editAffVerAllowed = editFields.versions?.allowedValues || [];
      const verSeen = new Set();
      const availableVersions = [];
      for (const v of [...projectVersionsRaw, ...editFixVerAllowed, ...editAffVerAllowed]) {
        if (!v) continue;
        const vName = String(v.name || v.value || '').trim();
        if (!vName || verSeen.has(vName)) continue;
        verSeen.add(vName);
        availableVersions.push({
          id: v.id ? String(v.id) : '',
          name: vName,
          released: !!v.released,
          archived: !!v.archived
        });
      }

      // Available transitions for Status workflow
      const transitions = (transitionsData.transitions || []).map(t => ({
        id: String(t.id),
        name: t.name || t.to?.name || '',
        toStatus: t.to?.name || t.name || '',
        toCategory: t.to?.statusCategory?.key || '',
        hasResolutionField: !!(t.fields && t.fields.resolution)
      }));

      // Available resolutions (from editmeta, transitions, and global Jira resolutions)
      const resSeen = new Set();
      const resolutionOptions = [];
      const editResAllowed = editFields.resolution?.allowedValues || [];
      const transResAllowed = [];
      for (const t of (transitionsData.transitions || [])) {
        if (t.fields?.resolution?.allowedValues) {
          transResAllowed.push(...t.fields.resolution.allowedValues);
        }
      }
      for (const r of [...editResAllowed, ...transResAllowed, ...(Array.isArray(globalResolutions) ? globalResolutions : [])]) {
        if (!r) continue;
        const rName = String(r.name || r.value || '').trim();
        if (!rName || resSeen.has(rName)) continue;
        resSeen.add(rName);
        resolutionOptions.push({
          id: r.id ? String(r.id) : '',
          name: rName
        });
      }

      // 1. Description: rendered HTML or raw ADF (sanitize broken Jira server tags)
      const descriptionRendered = rf.description
        ? rf.description
            .replace(/URL validation failed/gi, '')
            .replace(/<span[^>]*class="[^"]*inline-card-resolving[^"]*"[^>]*>.*?<\/span>/gi, '')
            .replace(/<div[^>]*class="[^"]*media-card-error[^"]*"[^>]*>.*?<\/div>/gi, '')
        : null;
      const descriptionRaw = f.description || null;

      // 2. Attachments (categorized)
      const attachments = (f.attachment || []).map(att => ({
        id: att.id,
        filename: att.filename,
        size: att.size,
        mimeType: att.mimeType,
        created: att.created,
        author: att.author?.displayName || 'Usuario',
        content: att.content,
        thumbnail: att.thumbnail || null,
        isImage: (att.mimeType || '').startsWith('image/'),
        isVideo: (att.mimeType || '').startsWith('video/') || /\.(mp4|mov|webm|avi|mkv)$/i.test(att.filename)
      }));

      // 3. Comments (ordered newest first)
      const rawComments = f.comment?.comments || [];
      const renderedComments = rf.comment?.comments || [];
      const comments = rawComments.map((c, i) => {
        const rend = renderedComments[i] || {};
        return {
          id: c.id,
          author: {
            displayName: c.author?.displayName || 'Usuario',
            name: c.author?.name || '',
            avatarUrl: c.author?.avatarUrls?.['32x32'] || c.author?.avatarUrls?.['24x24'] || null
          },
          created: c.created,
          updated: c.updated,
          bodyRaw: c.body,
          bodyRendered: rend.body || null
        };
      }).reverse(); // Newest first!

      // 4. Versions: combine fixVersions and versions (affectsVersions) so any version shown in the table list or Jira is always displayed
      const affectsVersions = (f.versions || []).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
      const rawFixVersions = (f.fixVersions || []).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
      const combinedVersions = Array.from(new Set([...rawFixVersions, ...affectsVersions]));

      // 5. Environment
      let environmentText = null;
      if (rf.environment) environmentText = rf.environment;
      else if (typeof f.environment === 'string') environmentText = f.environment;
      else if (f.environment && typeof f.environment === 'object') environmentText = f.environment;
      const environmentPlainText = extractPlainTextFromEnv(f.environment, rf.environment);

      // 6. Strict Fecha Estimada (custom field, NOT duedate) and *Severity (custom field, NOT priority)
      let rawEstDateVal = null;
      for (const candId of estDateCandidateIds) {
        if (f[candId] !== undefined && f[candId] !== null && f[candId] !== '') {
          rawEstDateVal = f[candId];
          break;
        }
      }
      const estResDate = rawEstDateVal
        ? (typeof rawEstDateVal === 'object' ? (rawEstDateVal.value || rawEstDateVal.name || String(rawEstDateVal)) : String(rawEstDateVal))
        : null;

      const rawSevObj = f[severityFieldId] || f.customfield_10238 || null;
      const sevDisplay = rawSevObj
        ? (typeof rawSevObj === 'object' ? (rawSevObj.value || rawSevObj.name || rawSevObj.label || 'Sin definir') : String(rawSevObj))
        : 'Sin definir';

      return {
        id: data.id,
        key: data.key,
        projectId,
        projectKey,
        issueType: f.issuetype?.name || '',
        parent: f.parent ? {
          key: f.parent.key,
          summary: f.parent.fields?.summary || '',
          status: f.parent.fields?.status?.name || '',
          issueType: f.parent.fields?.issuetype?.name || ''
        } : null,
        summary: f.summary || '',
        descriptionRendered,
        descriptionRaw,
        attachments,
        comments,
        assignee: f.assignee ? {
          accountId: f.assignee.accountId || '',
          displayName: f.assignee.displayName || f.assignee.name || 'Sin asignar',
          avatarUrl: f.assignee.avatarUrls?.['32x32'] || f.assignee.avatarUrls?.['24x24'] || null,
          email: f.assignee.emailAddress || ''
        } : null,
        reporter: f.reporter ? {
          accountId: f.reporter.accountId || '',
          displayName: f.reporter.displayName || f.reporter.name || 'Sin especificar',
          avatarUrl: f.reporter.avatarUrls?.['32x32'] || f.reporter.avatarUrls?.['24x24'] || null,
          email: f.reporter.emailAddress || ''
        } : null,
        status: f.status?.name || 'Abierto',
        statusCategory: f.status?.statusCategory?.key || '',
        resolution: f.resolution?.name || '',
        priority: f.priority?.name || 'Media',
        priorityIcon: f.priority?.iconUrl || null,
        severity: sevDisplay,
        rawSeverity: rawSevObj,
        severityFieldId,
        severityOptions,
        estDateFieldId,
        estDateCandidateIds,
        versions: combinedVersions,
        fixVersions: combinedVersions,
        availableVersions,
        transitions,
        resolutionOptions,
        created: f.created,
        updated: f.updated,
        resolutiondate: f.resolutiondate || changelogMeta.lastTerminalAt || null,
        duedate: estResDate,
        estimatedResolutionDate: estResDate,
        environment: environmentText,
        environmentPlainText,
        labels: f.labels || [],
        ...changelogMeta,
        rawFields: f
      };
    } catch (e) {
      console.error("Error in getBugFullDetails:", e);
      return null;
    }
  });

  // Updates a specific field or workflow transition on a Bug issue directly from Test Pulse
  resolver.define('updateBugIssue', async ({ payload }) => {
    const runBugUpdate = async () => {
    try {
      const { issueIdOrKey, field, value, extra = {} } = payload || {};
      if (!issueIdOrKey || !field) {
        return { error: 'Parámetros incompletos (issueIdOrKey, field).' };
      }

      // 1. Persona asignada (assignee)
      if (field === 'assignee') {
        const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/assignee`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: value || null })
        });
        if (!res.ok) {
          const errText = await res.text();
          return { error: `No se pudo actualizar el responsable (${res.status}): ${errText}` };
        }
        return { success: true };
      }

      // 2. Estado (workflow transition)
      if (field === 'status') {
        const transId = payload.transitionId || extra.transitionId || value;
        const resName = payload.resolution || extra.resolution || null;
        const transitionBody = {
          transition: { id: String(transId) }
        };
        if (resName) {
          transitionBody.fields = {
            resolution: { name: String(resName) }
          };
        }
        let res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/transitions`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(transitionBody)
        });
        // If the transition requires a resolution field (e.g. moving to Resuelta/Cerrada), supply a valid resolution automatically
        if (!res.ok) {
          const transMetaRes = await api.asUser().requestJira(
            route`/rest/api/3/issue/${issueIdOrKey}/transitions?expand=transitions.fields`
          ).catch(() => null);
          if (transMetaRes && transMetaRes.ok) {
            const transMetaData = await transMetaRes.json().catch(() => ({}));
            const matchingTrans = (transMetaData.transitions || []).find(t => String(t.id) === String(transId));
            if (matchingTrans && matchingTrans.fields && matchingTrans.fields.resolution) {
              const allowedRes = matchingTrans.fields.resolution.allowedValues || [];
              const fallbackRes = allowedRes[0]
                ? (allowedRes[0].id ? { id: String(allowedRes[0].id) } : { name: String(allowedRes[0].name || allowedRes[0].value) })
                : { name: 'Done' };
              res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/transitions`, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  transition: { id: String(transId) },
                  fields: { resolution: resName ? { name: String(resName) } : fallbackRes }
                })
              });
            }
          }
        }
        if (!res.ok) {
          const errText = await res.text();
          return { error: `No se pudo cambiar el estado (${res.status}): ${errText}` };
        }
        return { success: true };
      }

      // 3. Severidad (*Severity custom field, e.g. customfield_10238)
      if (field === 'severity') {
        const sevFieldId = payload.customFieldId || payload.fieldId || extra.customFieldId || extra.fieldId || 'customfield_10238';
        const optId = payload.optionId || extra.optionId || null;
        let payloadVal = null;
        if (value) {
          payloadVal = optId ? { id: String(optId) } : { value: String(value) };
        }
        let res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { [sevFieldId]: payloadVal } })
        });
        // Fallback if Jira expects { value } instead of { id } or plain string
        if (!res.ok && value) {
          res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { [sevFieldId]: { value: String(value) } } })
          });
        }
        if (!res.ok && value) {
          res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { [sevFieldId]: String(value) } })
          });
        }
        if (!res.ok) {
          const errText = await res.text();
          return { error: `No se pudo actualizar *Severity (${res.status}): ${errText}` };
        }
        return { success: true };
      }

      // 4. Versiones afectadas (fixVersions + sync with versions so list and Jira match)
      if (field === 'fixVersions') {
        const verArray = Array.isArray(value)
          ? value.filter(Boolean).map(v => {
              if (typeof v === 'object') {
                return v.id ? { id: String(v.id) } : { name: String(v.name || v.value) };
              }
              return { name: String(v) };
            })
          : [];
        let res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { fixVersions: verArray, versions: verArray } })
        });
        if (!res.ok) {
          const resFix = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { fixVersions: verArray } })
          });
          const resAff = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { versions: verArray } })
          });
          if (resFix.ok || resAff.ok) {
            return { success: true };
          }
          const errText = await resFix.text().catch(() => '');
          return { error: `No se pudo actualizar Versiones afectadas (${resFix.status}): ${errText}` };
        }
        return { success: true };
      }

      // 5. Fecha Estimada (custom field, e.g. customfield_10763, NOT duedate)
      if (field === 'estimatedDate') {
        const primaryFieldId = payload.customFieldId || payload.fieldId || extra.customFieldId || extra.fieldId || 'customfield_10763';
        const candidateIdsFromPayload = Array.isArray(payload.candidateFieldIds) ? payload.candidateFieldIds : [];
        const cleanDate = value && String(value).trim() ? String(value).trim().slice(0, 10) : null;

        const candidateFieldIds = [];
        for (const cid of [primaryFieldId, ...candidateIdsFromPayload, 'customfield_10763']) {
          if (cid && cid !== 'duedate' && !candidateFieldIds.includes(cid)) {
            candidateFieldIds.push(cid);
          }
        }

        const tryUpdateDateOnField = async (fId, dateVal) => {
          let r = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { [fId]: dateVal } })
          });
          if (!r.ok && dateVal) {
            r = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
              method: 'PUT',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { [fId]: `${dateVal}T12:00:00.000+0000` } })
            });
          }
          return r;
        };

        let lastRes = null;
        for (const fId of candidateFieldIds) {
          const r = await tryUpdateDateOnField(fId, cleanDate);
          lastRes = r;
          if (r.ok) {
            return { success: true, updatedFieldId: fId };
          }
        }

        const allFieldsRes = await api.asUser().requestJira(route`/rest/api/3/field`).catch(() => null);
        if (allFieldsRes && allFieldsRes.ok) {
          const allFields = await allFieldsRes.json().catch(() => []);
          const matchingCustomFields = (Array.isArray(allFields) ? allFields : []).filter(fObj => {
            if (!fObj || !fObj.id || !String(fObj.id).startsWith('customfield_')) return false;
            const nm = String(fObj.name || '').toLowerCase();
            return (
              nm.includes('fecha estimada') ||
              nm.includes('fecha de solución') ||
              nm.includes('fecha de solucion') ||
              nm.includes('solución estimada') ||
              nm.includes('solucion estimada') ||
              nm.includes('estimated')
            );
          });
          for (const mf of matchingCustomFields) {
            if (candidateFieldIds.includes(mf.id)) continue;
            const r = await tryUpdateDateOnField(mf.id, cleanDate);
            lastRes = r;
            if (r.ok) {
              return { success: true, updatedFieldId: mf.id };
            }
          }
        }

        const errText = lastRes ? await lastRes.text().catch(() => '') : 'Campo no disponible en pantalla de edición';
        return { error: `No se pudo actualizar Fecha Estimada (${lastRes ? lastRes.status : 400}). Verifica que el campo Fecha Estimada esté en la pantalla de Editar del Bug en Jira: ${errText}` };
      }

      // 6. Ambiente / entorno (environment)
      if (field === 'environment') {
        const trimmed = value && String(value).trim() ? String(value).trim() : '';
        const adfEnv = trimmed
          ? {
              type: 'doc',
              version: 1,
              content: trimmed.split('\n').map(line => ({
                type: 'paragraph',
                content: line.trim() ? [{ type: 'text', text: line }] : []
              }))
            }
          : null;
        let res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { environment: adfEnv } })
        });
        if (!res.ok && trimmed) {
          res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { environment: trimmed } })
          });
        }
        if (!res.ok) {
          const errText = await res.text();
          return { error: `No se pudo actualizar el ambiente (${res.status}): ${errText}` };
        }
        return { success: true };
      }

      // 7. Resolución (resolution)
      if (field === 'resolution') {
        const resId = payload.resolutionId || extra.resolutionId || null;
        const currentStatus = payload.currentStatus || extra.currentStatus || '';
        const cleanResName = value && String(value).trim() && String(value) !== 'Sin resolver' ? String(value).trim() : null;
        const resPayload = cleanResName
          ? (resId ? { id: String(resId) } : { name: cleanResName })
          : null;

        let res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { resolution: resPayload } })
        });
        if (!res.ok && cleanResName) {
          res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { resolution: { name: cleanResName } } })
          });
        }
        if (!res.ok && cleanResName) {
          const transRes = await api.asUser().requestJira(
            route`/rest/api/3/issue/${issueIdOrKey}/transitions?expand=transitions.fields`
          ).catch(() => null);
          if (transRes && transRes.ok) {
            const transData = await transRes.json().catch(() => ({}));
            const allTrans = transData.transitions || [];
            const transWithResField = allTrans.filter(t => t.fields && t.fields.resolution);
            const candidateTransitions = transWithResField.length > 0
              ? transWithResField
              : allTrans.filter(t => {
                  const toName = String(t.to?.name || t.name || '').toLowerCase();
                  return (
                    t.to?.name === currentStatus ||
                    t.to?.statusCategory?.key === 'done' ||
                    toName.includes('resuelta') ||
                    toName.includes('resuelto') ||
                    toName.includes('resolved') ||
                    toName.includes('validaci') ||
                    toName.includes('validation') ||
                    toName.includes('cerrada') ||
                    toName.includes('cerrado') ||
                    toName.includes('done') ||
                    toName.includes('listo')
                  );
                });
            const chosenTrans =
              candidateTransitions.find(t => String(t.to?.name || '').toLowerCase() === String(currentStatus).toLowerCase()) ||
              candidateTransitions[0];

            if (chosenTrans) {
              let tExec = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/transitions`, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  transition: { id: String(chosenTrans.id) },
                  fields: { resolution: resId ? { id: String(resId) } : { name: cleanResName } }
                })
              });
              if (!tExec.ok && resId) {
                tExec = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/transitions`, {
                  method: 'POST',
                  headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    transition: { id: String(chosenTrans.id) },
                    fields: { resolution: { name: cleanResName } }
                  })
                });
              }
              if (tExec.ok) {
                return { success: true };
              }
            }
          }
        }
        if (!res.ok) {
          const errText = await res.text();
          return { error: `No se pudo actualizar la resolución (${res.status}). Verifica que el campo Resolución esté en la pantalla de edición o transición de Jira: ${errText}` };
        }
        return { success: true };
      }

      return { error: `Campo no soportado: ${field}` };
    } catch (e) {
      console.error('[updateBugIssue] Error:', e);
      return { error: e.message || 'Error inesperado actualizando el bug.' };
    }
    };
    const result = await runBugUpdate();
    if (result && result.success) {
      await invalidateProjectReportCache();
    }
    return result;
  });

  // Adds a comment to a Bug issue and optionally uploads attached files / screenshots in a single action
  resolver.define('addBugComment', async ({ payload }) => {
    try {
      const { issueIdOrKey, text = '', commentText = '', files = [] } = payload || {};
      if (!issueIdOrKey) {
        return { error: 'Falta issueIdOrKey.' };
      }
      const cleanText = String(commentText || text || '').trim();
      const fileList = Array.isArray(files) ? files : [];
      if (!cleanText && fileList.length === 0) {
        return { error: 'Escribe un comentario o adjunta al menos un archivo.' };
      }

      // 1. Upload any attached files / screenshots to the Jira bug
      const uploadedAttachments = [];
      for (const fileItem of fileList) {
        if (!fileItem || !fileItem.base64Data) continue;
        const safeFilename = (fileItem.filename || `captura_${Date.now()}.png`).replace(/["\r\n]/g, '_');
        const boundary = '----ForgeBugUploadBoundary' + Math.random().toString(36).substring(2);
        const fileBuffer = Buffer.from(fileItem.base64Data, 'base64');
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${fileItem.mimeType || 'application/octet-stream'}\r\n\r\n`;
        const footer = `\r\n--${boundary}--\r\n`;
        const bodyBuffer = Buffer.concat([
          Buffer.from(header, 'utf-8'),
          fileBuffer,
          Buffer.from(footer, 'utf-8')
        ]);

        const upRes = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/attachments`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'X-Atlassian-Token': 'no-check',
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          },
          body: bodyBuffer
        });

        if (upRes.ok) {
          const upData = await upRes.json().catch(() => []);
          const attObj = Array.isArray(upData) ? upData[0] : upData;
          if (attObj && attObj.id) {
            uploadedAttachments.push({
              id: String(attObj.id),
              filename: attObj.filename || safeFilename,
              size: attObj.size || fileBuffer.length,
              mimeType: attObj.mimeType || fileItem.mimeType || 'application/octet-stream'
            });
          }
        } else {
          const errTxt = await upRes.text().catch(() => '');
          console.warn(`[addBugComment] Failed to upload ${safeFilename}:`, upRes.status, errTxt);
        }
      }

      // 2. Build ADF comment body (paragraphs for text + attachment tokens for inline preview in Test Pulse)
      const adfContent = [];
      if (cleanText) {
        const lines = cleanText.split('\n');
        for (const line of lines) {
          adfContent.push({
            type: 'paragraph',
            content: line.trim() ? [{ type: 'text', text: line }] : []
          });
        }
      }
      if (uploadedAttachments.length > 0) {
        for (const att of uploadedAttachments) {
          adfContent.push({
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `📎 [Evidencia adjunta: ${att.filename} (#${att.id})]`,
                marks: [{ type: 'strong' }]
              }
            ]
          });
        }
      }

      if (adfContent.length > 0) {
        const commRes = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/comment`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: {
              type: 'doc',
              version: 1,
              content: adfContent
            }
          })
        });
        if (!commRes.ok) {
          const errTxt = await commRes.text();
          return { error: `No se pudo publicar el comentario (${commRes.status}): ${errTxt}` };
        }
      }

      return {
        success: true,
        uploadedAttachments
      };
    } catch (e) {
      console.error('[addBugComment] Error:', e);
      return { error: e.message || 'Error al guardar comentario en el bug.' };
    }
  });
}

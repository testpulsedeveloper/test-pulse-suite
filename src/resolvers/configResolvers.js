import api, { route } from '@forge/api';
import { kvs as storage } from '@forge/kvs';

const REMOVED_DASHBOARD_WIDGET_TYPES = ['general_status', 'manual_vs_auto', 'cycles_progress'];
const GLOBAL_WIDGETS_KVS_KEY = 'testpulse_global_dashboard_widgets_v2';
const GLOBAL_ENVIRONMENTS_KVS_KEY = 'testpulse_global_environments_v1';

export const DEFAULT_EXECUTION_ENVIRONMENTS = [
  { id: 'env-qa', name: 'QA', description: 'Ambiente de Aseguramiento de Calidad (Pruebas Funcionales)' },
  { id: 'env-uat', name: 'UAT', description: 'Ambiente de Pruebas de Aceptación de Usuario (UAT)' },
  { id: 'env-staging', name: 'Staging / Pre-Prod', description: 'Ambiente Pre-Productivo / Homologación' },
  { id: 'env-int', name: 'Integración (SIT)', description: 'Ambiente de Pruebas de Integración de Sistemas' },
  { id: 'env-prod', name: 'Producción', description: 'Ambiente Productivo (Smoke / Sanity Post-Release)' }
];

const sanitizeDashboardWidgetsList = (widgets) => {
  if (!Array.isArray(widgets)) return null;
  const cleaned = widgets.filter(w => w && w.type && !REMOVED_DASHBOARD_WIDGET_TYPES.includes(w.type));
  return cleaned.length > 0 ? cleaned : null;
};

const sanitizeEnvironmentsList = (envs) => {
  if (!Array.isArray(envs)) return null;
  const cleaned = envs
    .filter(e => e && (typeof e === 'string' || (typeof e === 'object' && e.name)))
    .map((e, idx) => {
      if (typeof e === 'string') {
        const trimmed = e.trim();
        return { id: `env-${idx}-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: trimmed, description: '' };
      }
      return {
        id: String(e.id || `env-${idx}-${String(e.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
        name: String(e.name || '').trim(),
        description: String(e.description || '').trim()
      };
    })
    .filter(e => e.name.length > 0);
  return cleaned.length > 0 ? cleaned : null;
};

/**
 * Registers project configuration, permissions, allowlist, bulk mapping, and attachment resolvers.
 * @param {import('@forge/resolver').default} resolver
 */
export function registerConfigResolvers(resolver) {
  resolver.define('probeAPI', async () => {
    try {
      const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql: "project IS NOT EMPTY", maxResults: 1 })
      });
      const data = await response.json();
      return {
        keys: Object.keys(data),
        hasIssues: !!data.issues,
        hasValues: !!data.values,
        issueKeys: data.issues ? Object.keys(data.issues[0] || {}) : null,
        valueKeys: data.values ? Object.keys(data.values[0] || {}) : null
      };
    } catch (err) {
      return { error: err.message };
    }
  });

  // === Project Management & Configuration ===
  resolver.define('getProjects', async () => {
    try {
      let response = await api.asUser().requestJira(route`/rest/api/3/project`);
      let data = null;
      if (response.ok) {
        data = await response.json();
      } else {
        // Fallback to asApp() in case of user permission scheme quirks
        response = await api.asApp().requestJira(route`/rest/api/3/project`);
        if (response.ok) {
          data = await response.json();
        }
      }

      if (!data) return [];
      let projects = Array.isArray(data) ? data : (data.values || []);
      if (projects.length === 0) return [];

      return projects.map(p => ({ id: p.id, key: p.key, name: p.name }));
    } catch (err) {
      return { error: `Exception: ${err ? err.message || String(err) : "Unknown error"}` };
    }
  });

  resolver.define('getProjectIssueTypes', async ({ payload }) => {
    try {
      const { projectId } = payload;
      const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}`);
      if (!response.ok) return [];
      const data = await response.json();
      if (!data.issueTypes) return [];
      return data.issueTypes.map(type => ({
        id: type.id,
        name: type.name,
        iconUrl: type.iconUrl
      }));
    } catch (e) {
      return [];
    }
  });

  resolver.define('getIssueLinkTypes', async () => {
    try {
      const response = await api.asUser().requestJira(route`/rest/api/3/issueLinkType`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.issueLinkTypes || [];
    } catch (e) {
      console.error("Error getIssueLinkTypes:", e);
      return [];
    }
  });

  resolver.define('getConfig', async ({ payload }) => {
    const { projectId } = payload;
    let globalWidgets = null;
    let globalEnvironments = null;
    try {
      const [rawGlobal, rawGlobalEnvs] = await Promise.all([
        storage.get(GLOBAL_WIDGETS_KVS_KEY).catch(() => null),
        storage.get(GLOBAL_ENVIRONMENTS_KVS_KEY).catch(() => null)
      ]);
      globalWidgets = sanitizeDashboardWidgetsList(rawGlobal);
      globalEnvironments = sanitizeEnvironmentsList(rawGlobalEnvs);
    } catch (e) {}

    const defaultConf = {
      testCaseType: 'Test Case',
      testCaseTypeId: null,
      testCycleType: 'Test Cycle',
      testCycleTypeId: null,
      planIssueType: 'Test Set',
      planIssueTypeId: null,
      testRunType: 'Test Run',
      testRunTypeId: null,
      defectType: 'Bug',
      defectTypeId: null,
      requirementIssueTypes: [],
      requirementLinkType: 'ANY',
      environments: globalEnvironments || DEFAULT_EXECUTION_ENVIRONMENTS,
      ...(globalWidgets ? { dashboardWidgets: globalWidgets } : {})
    };

    if (!projectId) {
      return defaultConf;
    }

    let retries = 3;
    while (retries >= 0) {
      try {
        const response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-config`);
        if (response.status === 429) {
          retries--;
          if (retries < 0) break;
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 600));
          continue;
        }
        if (response.status === 404) {
          return defaultConf;
        }
        if (!response.ok) {
          retries--;
          if (retries < 0) break;
          await new Promise(r => setTimeout(r, 600));
          continue;
        }
        const data = await response.json();
        const config = data?.value || {};
        const projectWidgets = sanitizeDashboardWidgetsList(config.dashboardWidgets);
        const effectiveWidgets = globalWidgets || projectWidgets;

        const projectEnvs = sanitizeEnvironmentsList(config.environments);
        const effectiveEnvironments = globalEnvironments || projectEnvs || DEFAULT_EXECUTION_ENVIRONMENTS;

        if (!globalWidgets && projectWidgets) {
          try {
            await storage.set(GLOBAL_WIDGETS_KVS_KEY, projectWidgets);
          } catch (e) {}
        }
        if (!globalEnvironments && projectEnvs) {
          try {
            await storage.set(GLOBAL_ENVIRONMENTS_KVS_KEY, projectEnvs);
          } catch (e) {}
        }

        const merged = {
          testCaseType: config.testCaseType || 'Test Case',
          testCaseTypeId: config.testCaseTypeId || null,
          testCycleType: config.testCycleType || 'Test Cycle',
          testCycleTypeId: config.testCycleTypeId || null,
          planIssueType: config.planIssueType || 'Test Set',
          planIssueTypeId: config.planIssueTypeId || null,
          testRunType: config.testRunType || 'Test Run',
          testRunTypeId: config.testRunTypeId || null,
          defectType: config.defectType || 'Bug',
          defectTypeId: config.defectTypeId || null,
          requirementIssueTypes: Array.isArray(config.requirementIssueTypes) ? config.requirementIssueTypes : [],
          requirementLinkType: config.requirementLinkType || 'ANY',
          ...config,
          environments: effectiveEnvironments
        };

        if (effectiveWidgets) {
          merged.dashboardWidgets = effectiveWidgets;
        } else {
          delete merged.dashboardWidgets;
        }

        return merged;
      } catch (e) {
        retries--;
        if (retries < 0) break;
        await new Promise(r => setTimeout(r, 600));
      }
    }
    return defaultConf;
  });

  resolver.define('setConfig', async ({ payload }) => {
    const { projectId, config } = payload;
    const nextConfig = { ...(config || {}) };
    if (Array.isArray(nextConfig.dashboardWidgets)) {
      const sanitized = sanitizeDashboardWidgetsList(nextConfig.dashboardWidgets) || [];
      nextConfig.dashboardWidgets = sanitized;
      try {
        await storage.set(GLOBAL_WIDGETS_KVS_KEY, sanitized);
      } catch (e) {}
    }
    if (Array.isArray(nextConfig.environments)) {
      const sanitizedEnvs = sanitizeEnvironmentsList(nextConfig.environments) || DEFAULT_EXECUTION_ENVIRONMENTS;
      nextConfig.environments = sanitizedEnvs;
      try {
        await storage.set(GLOBAL_ENVIRONMENTS_KVS_KEY, sanitizedEnvs);
      } catch (e) {}
    }
    // Auto-resolve issueType IDs when project issueTypes are available so multi-language Jira sites stay resilient
    try {
      const projRes = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}`);
      if (projRes.ok) {
        const projData = await projRes.json();
        const issueTypes = Array.isArray(projData.issueTypes) ? projData.issueTypes : [];
        const findTypeId = (nameVal) => {
          if (!nameVal) return null;
          const target = String(nameVal).trim().toLowerCase();
          const found = issueTypes.find(it => String(it.name || '').trim().toLowerCase() === target || String(it.id) === target);
          return found?.id ? String(found.id) : null;
        };
        if (nextConfig.testCaseType && !nextConfig.testCaseTypeId) nextConfig.testCaseTypeId = findTypeId(nextConfig.testCaseType);
        if (nextConfig.testCycleType && !nextConfig.testCycleTypeId) nextConfig.testCycleTypeId = findTypeId(nextConfig.testCycleType);
        if (nextConfig.planIssueType && !nextConfig.planIssueTypeId) nextConfig.planIssueTypeId = findTypeId(nextConfig.planIssueType);
        if (nextConfig.testRunType && !nextConfig.testRunTypeId) nextConfig.testRunTypeId = findTypeId(nextConfig.testRunType);
        if (nextConfig.defectType && !nextConfig.defectTypeId) nextConfig.defectTypeId = findTypeId(nextConfig.defectType);
      }
    } catch (_) {}

    const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-config`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(nextConfig)
    });
    return { success: response.status >= 200 && response.status < 300, config: nextConfig };
  });

  // === Permissions ===
  resolver.define('checkAdminPermission', async ({ payload }) => {
    try {
      const { projectId } = payload;
      const response = await api.asUser().requestJira(route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=ADMINISTER_PROJECTS`);
      if (!response.ok) return false;
      const data = await response.json();
      return data?.permissions?.ADMINISTER_PROJECTS?.havePermission === true;
    } catch (e) {
      console.error("checkAdminPermission error:", e);
      return false;
    }
  });

  // === Bulk Upload: Field Mapping Config ===
  resolver.define('getBulkMapping', async () => {
    try {
      const response = await api.asUser().requestJira(route`/rest/api/3/user/properties/testops-bulk-mapping`);
      if (response.status === 404) return { mapping: {}, folderId: '' };
      if (!response.ok) {
        console.warn('getBulkMapping response not ok:', response.status);
        return { mapping: {}, folderId: '' };
      }
      const data = await response.json();
      return data.value || { mapping: {}, folderId: '' };
    } catch (e) {
      console.error('getBulkMapping error:', e);
      return { mapping: {}, folderId: '' };
    }
  });

  resolver.define('saveBulkMapping', async ({ payload }) => {
    const { mapping, folderId } = payload;
    try {
      const response = await api.asUser().requestJira(route`/rest/api/3/user/properties/testops-bulk-mapping`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping: mapping || {}, folderId: folderId || '' })
      });
      if (!response.ok) {
        console.error('saveBulkMapping failed:', await response.text());
        return { success: false, message: 'Fallo al guardar en Jira' };
      }
      return { success: true };
    } catch (e) {
      console.error('saveBulkMapping error:', e);
      return { success: false, message: String(e) };
    }
  });

  // === Bulk Upload: Link issues to folder in batch ===
  resolver.define('bulkLinkToFolder', async ({ payload }) => {
    const { issueIds, folderId } = payload;
    if (!folderId || !issueIds || issueIds.length === 0) return { success: true, count: 0 };

    const results = await Promise.allSettled(
      issueIds.map(id =>
        api.asUser().requestJira(route`/rest/api/3/issue/${id}/properties/testops-folder-link`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderId })
        })
      )
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    return { success: true, count: succeeded };
  });

  // === Project Allowlist ===
  resolver.define('getAllowedProjects', async () => {
    try {
      let response = await api.asUser().requestJira(route`/rest/api/3/project`);
      let data = await response.json();
      let projects = Array.isArray(data) ? data : (data.values || []);

      if (projects.length === 0) {
        response = await api.asApp().requestJira(route`/rest/api/3/project`);
        data = await response.json();
        projects = Array.isArray(data) ? data : (data.values || []);
      }

      return projects.map(p => ({ id: p.id, key: p.key, name: p.name }));
    } catch (err) {
      console.error("getAllowedProjects exception:", err);
      return [];
    }
  });

  resolver.define('setAllowedProjects', async ({ payload }) => {
    const { projectId, enabled } = payload;
    await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/testpulse-enabled`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      // Stored as `{ enabled: boolean }`, which is the shape `isProjectAllowed` reads.
      // (It used to store a bare boolean, so turning a project off never took effect.)
      body: JSON.stringify({ enabled: enabled !== false })
    });
    return { success: true };
  });

  resolver.define('isProjectAllowed', async ({ payload, context }) => {
    try {
      const projectId = payload?.projectId || context?.extension?.project?.id;
      if (!projectId) return { allowed: true };
      const response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testpulse-enabled`);
      if (response.status === 404) return { allowed: true };
      if (!response.ok) return { allowed: true };
      const data = await response.json();
      return { allowed: data.value?.enabled !== false };
    } catch (err) {
      return { allowed: true };
    }
  });

  // === Attachment Upload / Download / Delete ===
  resolver.define('uploadAttachment', async ({ payload }) => {
    const { issueId, filename, base64Data, mimeType } = payload;
    if (!issueId || !base64Data) {
      throw new Error("Missing issueId or base64Data");
    }

    try {
      const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buffer = Buffer.from(cleanBase64, 'base64');
      const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });

      const formData = new FormData();
      formData.append('file', blob, filename || `attachment_${Date.now()}.png`);

      const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}/attachments`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'X-Atlassian-Token': 'no-check'
        },
        body: formData
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[uploadAttachment] Failed for issue ${issueId}: ${response.status} ${errText}`);
        throw new Error(`Jira upload error ${response.status}: ${errText}`);
      }

      const attachments = await response.json();
      return attachments;
    } catch (err) {
      console.error(`[uploadAttachment] Exception:`, err.message);
      throw err;
    }
  });

  /**
   * ==========================================================================
   * IMMUTABLE ATTACHMENT BINARY CACHE (LRU + In-Flight Deduplication)
   * ==========================================================================
   * Jira attachment IDs are immutable once uploaded. Caching the resolved
   * base64 payload in a bounded LRU map (max 40 items / 25 MB total base64 chars)
   * prevents redundant downloads when multiple users or views inspect the same
   * evidence screenshot/PDF/video, while strictly bounding Lambda memory.
   */
  const MAX_ATTACHMENT_CACHE_ITEMS = 40;
  const MAX_ATTACHMENT_CACHE_CHARS = 25 * 1024 * 1024; // ~25 MB base64 cap
  const MAX_SINGLE_CACHED_CHARS = 6 * 1024 * 1024; // Only cache individual files up to ~4.5 MB raw
  const _attachmentContentCache = new Map();
  const _attachmentInFlight = new Map();
  let _attachmentCacheTotalChars = 0;

  const evictAttachmentFromCache = (attId) => {
    const key = String(attId || '');
    const existing = _attachmentContentCache.get(key);
    if (existing) {
      _attachmentCacheTotalChars = Math.max(0, _attachmentCacheTotalChars - (existing.base64?.length || 0));
      _attachmentContentCache.delete(key);
    }
  };

  const storeAttachmentInCache = (attId, entry) => {
    const key = String(attId || '');
    const size = entry?.base64?.length || 0;
    if (!size || size > MAX_SINGLE_CACHED_CHARS) return;

    if (_attachmentContentCache.has(key)) {
      evictAttachmentFromCache(key);
    }
    while (
      _attachmentContentCache.size >= MAX_ATTACHMENT_CACHE_ITEMS ||
      (_attachmentCacheTotalChars + size > MAX_ATTACHMENT_CACHE_CHARS && _attachmentContentCache.size > 0)
    ) {
      const oldestKey = _attachmentContentCache.keys().next().value;
      if (oldestKey === undefined) break;
      evictAttachmentFromCache(oldestKey);
    }
    _attachmentContentCache.set(key, entry);
    _attachmentCacheTotalChars += size;
  };

  resolver.define('deleteAttachment', async ({ payload }) => {
    const { attachmentId } = payload;
    try {
      const response = await api.asUser().requestJira(route`/rest/api/3/attachment/${attachmentId}`, {
        method: 'DELETE'
      });
      const ok = response.status === 204 || response.status === 200;
      if (ok) {
        evictAttachmentFromCache(attachmentId);
      }
      return { success: ok };
    } catch (e) {
      console.error('deleteAttachment error:', e);
      return { success: false, error: e.message };
    }
  });

  resolver.define('getAttachmentContent', async ({ payload }) => {
    const { attachmentId } = payload;
    const key = String(attachmentId || '');
    if (!key) return { error: 'Missing attachmentId' };

    // 1. Return immediately if present in bounded LRU cache
    if (_attachmentContentCache.has(key)) {
      const hit = _attachmentContentCache.get(key);
      // Refresh LRU position
      _attachmentContentCache.delete(key);
      _attachmentContentCache.set(key, hit);
      return hit;
    }

    // 2. Deduplicate concurrent requests for the same attachmentId
    if (_attachmentInFlight.has(key)) {
      return _attachmentInFlight.get(key);
    }

    const fetchPromise = (async () => {
      try {
        const response = await api.asUser().requestJira(route`/rest/api/3/attachment/content/${attachmentId}`);
        if (response.status !== 200) {
          throw new Error(`Failed to fetch attachment content, status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const result = {
          base64: buffer.toString('base64'),
          mimeType: response.headers.get('content-type')
        };
        storeAttachmentInCache(key, result);
        return result;
      } catch (e) {
        console.error('getAttachmentContent error:', e);
        return { error: e.message };
      } finally {
        _attachmentInFlight.delete(key);
      }
    })();

    _attachmentInFlight.set(key, fetchPromise);
    return fetchPromise;
  });
}

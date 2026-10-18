/**
 * Traceability Hierarchy & Requirement Resolution Helpers for Test Pulse Suite
 *
 * Resolves Epic and Requirement/Story details from a test case, its Jira links,
 * parent hierarchy, customfield_10014, labels, and the project's requirements map.
 */
export const extractEpicAndRequirement = (tc, config = {}, reqMap = {}) => {
  let epicKey = null;
  let epicSummary = null;
  let reqKey = null;
  let reqSummary = null;

  if (!tc) return { epicKey: null, epicSummary: null, reqKey: null, reqSummary: null };

  const raw = tc.rawFields || {};
  const reqTypesConfig = (config?.requirementIssueTypes || []).map(t => String(t).toLowerCase().trim()).filter(Boolean);
  const reqLinkTypeConfig = (config?.requirementLinkType && config.requirementLinkType !== 'ANY')
    ? String(config.requirementLinkType).toLowerCase().trim()
    : null;

  const customTestTypes = [
    config?.testCaseType,
    config?.testCycleType,
    config?.planIssueType,
    config?.testRunType
  ].filter(Boolean).map(t => String(t).toLowerCase().trim());

  const isBlacklistedOrEpic = (typeStr) => {
    const t = String(typeStr || '').toLowerCase().trim();
    if (!t) return false;
    if (customTestTypes.some(ct => t === ct || t.includes(ct))) return true;
    return (
      t.includes('test run') || t.includes('testrun') || t.includes('ejecuc') ||
      t.includes('test case') || t.includes('testcase') || t.includes('caso de prueba') ||
      t.includes('test cycle') || t.includes('ciclo') ||
      t.includes('test plan') || t.includes('test set') || t.includes('plan de prueba') ||
      t.includes('bug') || t.includes('defecto') || t.includes('error') || t.includes('incidencia') ||
      t === 'epic' || t === 'épica' || t === 'epica' || t.includes('epic') || t.includes('épica')
    );
  };

  const isEpicType = (typeStr) => {
    const t = String(typeStr || '').toLowerCase().trim();
    return t === 'epic' || t === 'épica' || t === 'epica' || t.includes('epic') || t.includes('épica');
  };

  const isReqType = (typeStr) => {
    const t = String(typeStr || '').toLowerCase().trim();
    if (!t) return false;
    if (isBlacklistedOrEpic(t)) return false;
    return true;
  };

  const isPreferredReqType = (typeStr) => {
    const t = String(typeStr || '').toLowerCase().trim();
    if (!isReqType(t)) return false;
    if (reqTypesConfig.length > 0) {
      return reqTypesConfig.some(cfgT => t === cfgT || t.includes(cfgT) || cfgT.includes(t));
    }
    return ['story', 'historia', 'historia de usuario', 'user story', 'requisito', 'requirement', 'requerimiento', 'task', 'tarea', 'feature'].some(w => t === w || t.includes(w));
  };

  // 1. Explicit properties on tc
  if (tc.epicKey || tc.epic) epicKey = tc.epicKey || tc.epic;
  if (tc.epicName || tc.epicSummary) epicSummary = tc.epicName || tc.epicSummary;
  if (tc.storyKey || tc.userStory || tc.requirement) reqKey = tc.storyKey || tc.userStory || tc.requirement;
  if (tc.storySummary || tc.requirementSummary) reqSummary = tc.storySummary || tc.requirementSummary;

  // 2. Customfield 10014 (standard Epic Link in Company-managed projects)
  const epicLinkFieldId = config?.epicLinkFieldId || 'customfield_10014';
  const rawEpicVal = raw[epicLinkFieldId] ?? raw.customfield_10014;
  if (!epicKey && rawEpicVal) {
    if (typeof rawEpicVal === 'string' && /^[A-Z][A-Z0-9]+-\d+$/i.test(rawEpicVal.trim())) {
      epicKey = rawEpicVal.trim();
    } else if (rawEpicVal && typeof rawEpicVal === 'object' && rawEpicVal.key) {
      epicKey = rawEpicVal.key;
      epicSummary = rawEpicVal.summary || null;
    }
  }

  // 3. Parent field (modern Jira Cloud)
  if (raw.parent) {
    const pKey = raw.parent.key;
    const pType = raw.parent.fields?.issuetype?.name || reqMap[pKey]?.issueType || '';
    const pSummary = raw.parent.fields?.summary || reqMap[pKey]?.summary || '';

    if (isEpicType(pType)) {
      if (!epicKey) {
        epicKey = pKey;
        epicSummary = pSummary;
      }
    } else if (isReqType(pType) || (!pType && pKey)) {
      if (!reqKey) {
        reqKey = pKey;
        reqSummary = pSummary;
      }
    }
  }

  // 4. Issue Links (issuelinks)
  if (Array.isArray(raw.issuelinks) && raw.issuelinks.length > 0) {
    let matchedLinkReq = null;
    let preferredLinkReq = null;
    let fallbackLinkReq = null;

    for (const link of raw.issuelinks) {
      const typeName = String(link.type?.name || '').toLowerCase().trim();
      const inwardName = String(link.type?.inward || '').toLowerCase().trim();
      const outwardName = String(link.type?.outward || '').toLowerCase().trim();
      const isConfiguredLinkType = reqLinkTypeConfig && (
        typeName === reqLinkTypeConfig || inwardName === reqLinkTypeConfig || outwardName === reqLinkTypeConfig
      );

      const candidates = [link.inwardIssue, link.outwardIssue].filter(Boolean);
      for (const cand of candidates) {
        const cKey = cand.key;
        if (!cKey) continue;
        const cType = cand.fields?.issuetype?.name || cand.fields?.issuetype || reqMap[cKey]?.issueType || '';
        const cSummary = cand.fields?.summary || reqMap[cKey]?.summary || '';

        // Candidate is Epic
        if (isEpicType(cType)) {
          if (!epicKey) {
            epicKey = cKey;
            epicSummary = cSummary;
          }
          continue;
        }

        // Candidate is Requirement / Story (either by explicit non-blacklisted type or present in reqMap)
        if (isReqType(cType) || (!cType && reqMap[cKey] && !isBlacklistedOrEpic(reqMap[cKey].issueType))) {
          const reqItem = { key: cKey, summary: cSummary, parent: cand.fields?.parent };
          if (isConfiguredLinkType && !matchedLinkReq) {
            matchedLinkReq = reqItem;
          } else if (isPreferredReqType(cType) && !preferredLinkReq) {
            preferredLinkReq = reqItem;
          } else if (!fallbackLinkReq) {
            fallbackLinkReq = reqItem;
          }
        }
      }
    }

    const chosenReq = matchedLinkReq || preferredLinkReq || fallbackLinkReq;
    if (chosenReq) {
      if (!reqKey) {
        reqKey = chosenReq.key;
        reqSummary = chosenReq.summary;
      }
      if (!epicKey && chosenReq.parent) {
        const cpType = chosenReq.parent.fields?.issuetype?.name || '';
        if (isEpicType(cpType) || chosenReq.parent.key) {
          epicKey = chosenReq.parent.key;
          epicSummary = chosenReq.parent.fields?.summary || null;
        }
      }
    }
  }

  // 5. Labels fallback (e.g. epic:PROJ-10, story:PROJ-20)
  const allLabels = [...(Array.isArray(tc.labels) ? tc.labels : []), ...(Array.isArray(raw.labels) ? raw.labels : [])];
  if (!epicKey && allLabels.length > 0) {
    const epLabel = allLabels.find(l => String(l).toLowerCase().startsWith('epic:'));
    if (epLabel) epicKey = epLabel.replace(/^epic:/i, '').trim();
  }
  if (!reqKey && allLabels.length > 0) {
    const stLabel = allLabels.find(l => String(l).toLowerCase().startsWith('story:') || String(l).toLowerCase().startsWith('req:'));
    if (stLabel) reqKey = stLabel.replace(/^(story|req):/i, '').trim();
  }

  // 6. Enrich from reqMap (resolves Story -> Epic and missing summaries)
  if (reqKey && reqMap[reqKey]) {
    const reqInfo = reqMap[reqKey];
    if (!reqSummary && reqInfo.summary) {
      reqSummary = reqInfo.summary;
    }
    if (!epicKey && reqInfo.epicKey) {
      epicKey = reqInfo.epicKey;
      epicSummary = reqInfo.epicSummary || null;
    } else if (epicKey && !epicSummary && reqInfo.epicKey === epicKey && reqInfo.epicSummary) {
      epicSummary = reqInfo.epicSummary;
    }
  }
  if (epicKey && !epicSummary && reqMap[epicKey]?.summary) {
    epicSummary = reqMap[epicKey].summary;
  }

  return { epicKey, epicSummary, reqKey, reqSummary };
};

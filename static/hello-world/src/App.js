import React, { useEffect, useState, useRef, useMemo, useCallback, useDeferredValue, Suspense } from 'react';
import { view, router, requestJira } from '@forge/bridge';
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
} from './utils/constants';
import { textToAdf, sanitizeRenderedHtml, adfToHtml, fetchAttachmentBlobData } from './utils/adfUtils';
import {
  RichTextEditor,
  SearchableSelect,
  BugAttachmentImageCard,
  PdfDocumentPreview,
  NotificationProvider,
  useNotification,
  ConfirmModal,
  TextInputModal,
  AtlaskitStatusLozenge,
  LIST_BATCH_SIZE,
  LoadMoreSentinel
} from './components/CommonComponents';
import { invoke, queryClient, clearPersistentCache } from './utils/queryClient';
import { extractEpicAndRequirement } from './utils/traceabilityHelpers';

export { normalizeUiStatus };

const APP_VERSION = `v${packageJson.version || '4.3.0'}`;

// Stage 1B: Lazy-loaded Views & Slide Panels (Code-Splitting)
const BugSlidePanel = React.lazy(() => import('./components/BugSlidePanel'));
const TraceabilitySlidePanel = React.lazy(() => import('./components/TraceabilitySlidePanel'));
const PlanningView = React.lazy(() => import('./views/PlanningView'));
const ExecutionView = React.lazy(() => import('./views/ExecutionView'));
const ReportsView = React.lazy(() => import('./views/ReportsView'));
const SettingsView = React.lazy(() => import('./views/SettingsView'));
const ReportAutomationModal = React.lazy(() => import('./components/ReportAutomationModal'));

function App() {
  const [activeTab, setActiveTab] = useState('design'); // design, planning, execution, config
  
  // Design Tab State
  const [folders, setFolders] = useState([]);
  const [testCases, setTestCases] = useState([]);
  const [requirementsMap, setRequirementsMap] = useState({});
  // O(1) lookup by id or key — replaces repeated testCases.find(...) scans inside list renders
  const testCasesById = useMemo(() => {
    const m = new Map();
    for (const t of testCases) {
      if (t && t.id != null) m.set(String(t.id), t);
      if (t && t.key != null) m.set(String(t.key), t);
    }
    return m;
  }, [testCases]);
  const findTc = useCallback((idOrKey) => (idOrKey == null ? undefined : testCasesById.get(String(idOrKey))), [testCasesById]);
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
  const deletedIterationIdsRef = useRef(new Set()); // in-session deleted iteration IDs
  const iterationSaveTimersRef = useRef({}); // debounce timers for iteration input persistence

  const mergeIterationsPreservingLocal = useCallback((localIters, remoteIters) => {
    const deletedIters = deletedIterationIdsRef.current;
    const localList = Array.isArray(localIters) ? localIters.filter(it => it && !deletedIters.has(it.id)) : [];
    const remoteList = Array.isArray(remoteIters) ? remoteIters.filter(it => it && !deletedIters.has(it.id)) : [];
    if (localList.length === 0) return remoteList;
    if (remoteList.length === 0) return localList;
    const byId = new Map();
    // Remote first, then overwrite with local so local edits & newly added iterations always win
    remoteList.forEach(it => {
      if (it && it.id) byId.set(String(it.id), it);
    });
    localList.forEach(it => {
      if (it && it.id) {
        const prev = byId.get(String(it.id));
        byId.set(String(it.id), prev ? { ...prev, ...it } : it);
      }
    });
    return Array.from(byId.values());
  }, []);

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
              iterations: mergeIterationsPreservingLocal(existing.iterations, backendItem.iterations),
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
          const hasExec = (item.status && normalizeUiStatus(item.status) !== 'Not Run') || (item.iterations && item.iterations.length > 0);
          const existingHasExec = (existing.status && normalizeUiStatus(existing.status) !== 'Not Run') || (existing.iterations && existing.iterations.length > 0);
          const combinedIterations = mergeIterationsPreservingLocal(existing.iterations, item.iterations);
          if (hasExec && !existingHasExec) {
            dedupedMap.set(dKey, { ...item, iterations: combinedIterations });
          } else {
            dedupedMap.set(dKey, { ...existing, iterations: combinedIterations });
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
  }, [selectedCycle, mergeIterationsPreservingLocal]);

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
  const [executiveReportModalOpen, setExecutiveReportModalOpen] = useState(false);
  const [executiveReportSubject, setExecutiveReportSubject] = useState('');
  const [executiveReportNotes, setExecutiveReportNotes] = useState('');
  const [executiveReportBuild, setExecutiveReportBuild] = useState('');
  const executiveReportContainerRef = useRef(null);
  const [linkingBugTestId, setLinkingBugTestId] = useState(null); // id of test for which we show the bug-link input
  const [bugKeyInput, setBugKeyInput] = useState('');
  const [executionStatusFilter, setExecutionStatusFilter] = useState('ALL');
  const [executionSearchQuery, setExecutionSearchQuery] = useState('');
  const deferredExecutionSearch = useDeferredValue(executionSearchQuery);
  const [executionSortBy, setExecutionSortBy] = useState('none');
  const [executionCurrentPage, setExecutionCurrentPage] = useState(1);
  const [executionPageSize, setExecutionPageSize] = useState(20);
  const [executionChecked, setExecutionChecked] = useState(new Set());

  // Tester / folder filters + folder grouping (Planning & Execution)
  const [execTesterFilter, setExecTesterFilter] = useState('ALL'); // 'ALL' | 'MINE' | 'UNASSIGNED' | accountId
  const [execTesterFilterSource, setExecTesterFilterSource] = useState('default'); // 'default' | 'user'
  const [execFolderFilter, setExecFolderFilter] = useState(''); // '' | '__ROOT__' | folderId
  const [groupByFolder, setGroupByFolder] = useState(() => {
    try { return localStorage.getItem('tp_group_by_folder') !== 'false'; } catch (e) { return true; }
  });
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tp_collapsed_groups') || '{}') || {}; } catch (e) { return {}; }
  });
  useEffect(() => { try { localStorage.setItem('tp_group_by_folder', String(groupByFolder)); } catch (e) {} }, [groupByFolder]);
  useEffect(() => { try { localStorage.setItem('tp_collapsed_groups', JSON.stringify(collapsedGroups)); } catch (e) {} }, [collapsedGroups]);
  const [assignModal, setAssignModal] = useState(null); // { items: [{testRunId, id}] }
  const [assignQuery, setAssignQuery] = useState('');
  const [assignResults, setAssignResults] = useState([]);
  const [assignSearching, setAssignSearching] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  
  // Mobile QR Upload State
  const [qrModalSession, setQrModalSession] = useState(null);
  const [qrModalLoading, setQrModalLoading] = useState(false);
  const [qrModalCopied, setQrModalCopied] = useState(false);
  const [qrModalReceived, setQrModalReceived] = useState(false);
  const [qrModalReceivedCount, setQrModalReceivedCount] = useState(0);
  
  // Reports State
  const [reportData, setReportData] = useState({ cycles: [] });
  // Always-current mirror: the 15-min background sync runs from a closure created when the tab was
  // entered, where `reportData` is stale. Reading the ref avoids misdetecting "no data" → full reload.
  const reportDataRef = useRef(reportData);
  reportDataRef.current = reportData;
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
  const [runsPlanDropdownOpen, setRunsPlanDropdownOpen] = useState(false);
  const runsCycleCarouselRef = useRef(null);
  const [bugResolutionTime, setBugResolutionTime] = useState(null);
  const [reportSelectedCycles, setReportSelectedCycles] = useState([]);
  const [reportSelectedVersions, setReportSelectedVersions] = useState([]);
  const [selectedDashboardSeverityFilter, setSelectedDashboardSeverityFilter] = useState(null);
  const [executionTypeFieldId, setExecutionTypeFieldId] = useState(null);
  const [resolutionStage, setResolutionStage] = useState('Nuevo a Abierto');
  const [dashboardSubView, setDashboardSubView] = useState('runs'); // 'runs', 'bugs', 'traceability'
  const [dashboardBugSearch, setDashboardBugSearch] = useState('');
  const [dashboardCycleBugFilter, setDashboardCycleBugFilter] = useState('ALL'); // 'ALL', 'OPEN', 'CLOSED', 'BLOCKER'
  const [dashboardGeneralBugSearch, setDashboardGeneralBugSearch] = useState('');
  const [dashboardGeneralBugStatusTab, setDashboardGeneralBugStatusTab] = useState('ALL'); // 'ALL', 'OPEN', 'CLOSED'
  const [dashboardTraceabilitySearch, setDashboardTraceabilitySearch] = useState('');
  const [expandedTraceabilityEpics, setExpandedTraceabilityEpics] = useState({});
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
    if (!selectedTestCase) {
      setSelectedTestCaseDescription(null);
      return;
    }
    let cancelled = false;
    // Show cached text immediately, then refresh from Jira (includes Precondición / Pasos / Resultados Esperados)
    const cached = selectedTestCase.description || null;
    setSelectedTestCaseDescription(cached);
    setLoadingDescription(!cached);
    invoke('getIssueDescription', { issueId: selectedTestCase.id }).then(desc => {
      if (cancelled) return;
      if (desc) setSelectedTestCaseDescription(desc);
      setLoadingDescription(false);
    }).catch(() => {
      if (!cancelled) setLoadingDescription(false);
    });
    return () => { cancelled = true; };
  }, [selectedTestCase]);

  const [testCaseDetails, setTestCaseDetails] = useState({ type: 'traditional', content: [] });
  const [testCaseDetailsLoading, setTestCaseDetailsLoading] = useState(false);
  const [testCaseHistory, setTestCaseHistory] = useState([]);
  const [testCaseHistoryLoading, setTestCaseHistoryLoading] = useState(false);
  const [modalDetailTab, setModalDetailTab] = useState('details');

  // Bug Details Modal / Drawer State (Lazy Loading & In-App Editing)
  const [selectedBug, setSelectedBug] = useState(null);
  const [selectedBugDetails, setSelectedBugDetails] = useState(null);
  const [selectedBugLoading, setSelectedBugLoading] = useState(false);
  const [selectedMediaModal, setSelectedMediaModal] = useState(null);

  // In-app Bug Editing States
  const [bugSavingField, setBugSavingField] = useState(null);
  const [bugAssigneeOpen, setBugAssigneeOpen] = useState(false);
  const [bugAssigneeQuery, setBugAssigneeQuery] = useState('');
  const [bugAssigneeResults, setBugAssigneeResults] = useState([]);
  const [bugAssigneeSearching, setBugAssigneeSearching] = useState(false);
  const [bugEditingEnv, setBugEditingEnv] = useState(false);
  const [bugEnvDraft, setBugEnvDraft] = useState('');
  const [bugCommentText, setBugCommentText] = useState('');
  const [bugCommentFiles, setBugCommentFiles] = useState([]);
  const [bugSubmittingComment, setBugSubmittingComment] = useState(false);
  const [bugUploadingStandalone, setBugUploadingStandalone] = useState(false);
  const [bugCustomVersionInput, setBugCustomVersionInput] = useState('');
  const [bugAddingVersion, setBugAddingVersion] = useState(false);

  useEffect(() => {
    const bugKeyOrId = selectedBug ? (selectedBug.key || selectedBug.id) : null;
    if (bugKeyOrId) {
      setSelectedBugLoading(true);
      setSelectedBugDetails(null);
      setBugAssigneeOpen(false);
      setBugAssigneeQuery('');
      setBugEditingEnv(false);
      setBugCommentText('');
      setBugCommentFiles([]);
      setBugCustomVersionInput('');
      setBugAddingVersion(false);
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
  }, [selectedBug?.key, selectedBug?.id]);

  // Traceability Item (Epic / Story) Details Modal State (Lazy Loading)
  const [selectedTraceabilityItem, setSelectedTraceabilityItem] = useState(null);
  const [selectedTraceabilityDetails, setSelectedTraceabilityDetails] = useState(null);
  const [selectedTraceabilityLoading, setSelectedTraceabilityLoading] = useState(false);

  useEffect(() => {
    if (selectedTraceabilityItem && selectedTraceabilityItem.key) {
      setSelectedTraceabilityLoading(true);
      setSelectedTraceabilityDetails(null);
      invoke('getBugFullDetails', { issueIdOrKey: selectedTraceabilityItem.key })
        .then(details => {
          setSelectedTraceabilityDetails(details);
          setSelectedTraceabilityLoading(false);
        })
        .catch(err => {
          console.error('Error fetching traceability item details:', err);
          setSelectedTraceabilityLoading(false);
        });
    } else {
      setSelectedTraceabilityDetails(null);
      setSelectedTraceabilityLoading(false);
    }
  }, [selectedTraceabilityItem?.key]);

  const openTraceabilityItemModal = useCallback((type, key, extra = {}) => {
    if (!key) return;
    setSelectedTraceabilityItem({
      type: type === 'epic' ? 'epic' : 'story',
      key: String(key).trim(),
      ...extra
    });
  }, []);

  // Preload blob URLs for inline images in Bug Details and Traceability modals
  // so that <img src="blob:..."> renders inside description & comments without CSP blocks.
  const [inlineAttachmentUrls, setInlineAttachmentUrls] = useState({});

  useEffect(() => {
    let isMounted = true;
    const candidateMap = new Map();

    const collectFromDetails = (detailsObj) => {
      if (!detailsObj) return;
      const atts = Array.isArray(detailsObj.attachments) ? detailsObj.attachments : [];
      atts.forEach((att) => {
        if (!att || !att.id) return;
        const isImg = att.isImage || (att.mimeType && att.mimeType.startsWith('image/')) || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(att.filename || '');
        if (isImg) {
          candidateMap.set(String(att.id), att.mimeType || 'image/png');
        }
      });

      // Also scan rendered HTML strings for any embedded attachment IDs
      const htmlSources = [
        detailsObj.descriptionRendered,
        ...(Array.isArray(detailsObj.comments) ? detailsObj.comments.map(c => c?.bodyRendered) : [])
      ].filter(Boolean);

      const attRegex = /\/(?:rest\/api\/[23]\/attachment\/(?:content|thumbnail)\/|secure\/attachment\/)(\d+)/gi;
      htmlSources.forEach((htmlStr) => {
        let match;
        while ((match = attRegex.exec(htmlStr)) !== null) {
          const foundId = String(match[1]);
          if (!candidateMap.has(foundId)) {
            candidateMap.set(foundId, 'image/png');
          }
        }
      });
    };

    collectFromDetails(selectedBug);
    collectFromDetails(selectedBugDetails);
    collectFromDetails(selectedTraceabilityDetails);

    candidateMap.forEach((mimeType, attId) => {
      fetchAttachmentBlobData(attId, mimeType)
        .then((res) => {
          if (isMounted && res && res.blobUrl) {
            setInlineAttachmentUrls((prev) => {
              if (prev[attId] === res.blobUrl) return prev;
              return { ...prev, [attId]: res.blobUrl };
            });
          }
        })
        .catch(() => {});
    });

    return () => {
      isMounted = false;
    };
  }, [selectedBug, selectedBugDetails, selectedTraceabilityDetails]);
  
  // Search & Refresh State
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
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
  const [projectConfig, setProjectConfig] = useState({ testCaseType: '', testCycleType: '', planIssueType: '', testRunType: 'Test Run', requirementIssueTypes: [], requirementLinkType: 'ANY', environments: [] });
  const [projectIssueTypes, setProjectIssueTypes] = useState([]);
  const [linkTypes, setLinkTypes] = useState([]);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Catálogo configurable de Ambientes de Ejecución para Ciclos de Prueba
  const DEFAULT_EXECUTION_ENVIRONMENTS = useMemo(() => ([
    { id: 'env-qa', name: 'QA', description: 'Ambiente de Aseguramiento de Calidad (QA)', active: true },
    { id: 'env-uat', name: 'UAT', description: 'Pruebas de Aceptación de Usuario (UAT)', active: true },
    { id: 'env-staging', name: 'Staging / Pre-Prod', description: 'Ambiente Pre-Productivo / Staging', active: true },
    { id: 'env-sit', name: 'Integración (SIT)', description: 'Pruebas de Integración de Sistemas', active: true },
    { id: 'env-prod', name: 'Producción', description: 'Validación Smoke / Post-Deploy en Producción', active: true }
  ]), []);

  const availableEnvironments = useMemo(() => {
    const rawList = Array.isArray(projectConfig?.environments) && projectConfig.environments.length > 0
      ? projectConfig.environments
      : DEFAULT_EXECUTION_ENVIRONMENTS;
    return rawList.map((item, idx) => {
      if (typeof item === 'string') {
        return { id: `env-${idx}`, name: item.trim(), description: '', active: true };
      }
      return {
        id: String(item?.id || `env-${idx}`),
        name: String(item?.name || item?.key || '').trim(),
        description: String(item?.description || '').trim(),
        active: item?.active !== false
      };
    }).filter(e => Boolean(e.name));
  }, [projectConfig?.environments, DEFAULT_EXECUTION_ENVIRONMENTS]);

  const [newEnvName, setNewEnvName] = useState('');
  const [newEnvDesc, setNewEnvDesc] = useState('');
  const [editingEnvId, setEditingEnvId] = useState(null);
  const [editingEnvName, setEditingEnvName] = useState('');
  const [editingEnvDesc, setEditingEnvDesc] = useState('');
  const [isSavingEnvCatalog, setIsSavingEnvCatalog] = useState(false);

  const handleUpdateEnvironmentsCatalog = async (nextEnvironments, successMessage = 'Catálogo de ambientes actualizado.') => {
    const updatedConfig = {
      ...projectConfig,
      environments: nextEnvironments
    };
    setProjectConfig(updatedConfig);
    if (!selectedProjectId) return;
    setIsSavingEnvCatalog(true);
    try {
      await invoke('setConfig', {
        projectId: selectedProjectId,
        config: updatedConfig
      });
      clearPersistentCache();
      queryClient.invalidateQueries();
      addNotification({
        type: 'success',
        title: 'Ambientes actualizados',
        description: successMessage
      });
    } catch (e) {
      console.error('Error saving environments catalog:', e);
      addNotification({
        type: 'error',
        title: 'Error al guardar catálogo de ambientes',
        description: e.message || String(e)
      });
    } finally {
      setIsSavingEnvCatalog(false);
    }
  };

  // Traceability hierarchy state (Épicas ➔ Historias ➔ Casos de Prueba)
  const [traceabilityHierarchy, setTraceabilityHierarchy] = useState({ epics: [], stories: [], storyMap: {}, storiesByEpic: {}, tcMap: {}, _projectId: null });
  const [traceabilityHierarchyLoading, setTraceabilityHierarchyLoading] = useState(false);
  const loadTraceabilityHierarchy = useCallback(async (projId, cfg) => {
    const targetId = projId || selectedProjectId;
    const targetCfg = cfg || projectConfig;
    if (!targetId) return;
    try {
      setTraceabilityHierarchyLoading(true);
      const res = await invoke('getTraceabilityHierarchy', { projectId: targetId, config: targetCfg });
      if (res && res.tcMap) {
        setTraceabilityHierarchy({ ...res, _projectId: String(targetId) });
      }
    } catch (err) {
      console.warn("loadTraceabilityHierarchy error:", err);
    } finally {
      setTraceabilityHierarchyLoading(false);
    }
  }, [selectedProjectId, projectConfig]);

  useEffect(() => {
    if ((activeTab === 'reports' || activeTab === 'dashboard') && selectedProjectId) {
      if (
        !traceabilityHierarchy ||
        String(traceabilityHierarchy._projectId) !== String(selectedProjectId) ||
        (!traceabilityHierarchyLoading && (!traceabilityHierarchy.stories || traceabilityHierarchy.stories.length === 0) && (!traceabilityHierarchy.epics || traceabilityHierarchy.epics.length === 0))
      ) {
        loadTraceabilityHierarchy(selectedProjectId, projectConfig);
      }
    }
  }, [activeTab, dashboardSubView, selectedProjectId]);

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

  // Dashboard Customizable Widgets State (Global across all projects in Test Pulse)
  const GLOBAL_WIDGETS_STORAGE_KEY = 'testpulse_global_dashboard_widgets_v2';
  const sanitizeDashboardWidgets = (list) => {
    if (!Array.isArray(list)) return [];
    const allowedTypes = new Set(AVAILABLE_WIDGET_CATALOG.map(c => c.type));
    return list.filter(w => w && w.type && !REMOVED_WIDGET_TYPES.includes(w.type) && allowedTypes.has(w.type));
  };

  const [dashboardWidgets, setDashboardWidgets] = useState(DEFAULT_DASHBOARD_WIDGETS);
  const [isCustomizingDashboard, setIsCustomizingDashboard] = useState(false);
  const [showAddWidgetModal, setShowAddWidgetModal] = useState(false);
  const [draggedWidgetIndex, setDraggedWidgetIndex] = useState(null);

  // Sync dashboardWidgets globally across projects
  useEffect(() => {
    const fromConfig = sanitizeDashboardWidgets(projectConfig?.dashboardWidgets);
    if (fromConfig.length > 0) {
      setDashboardWidgets(fromConfig);
      try {
        localStorage.setItem(GLOBAL_WIDGETS_STORAGE_KEY, JSON.stringify(fromConfig));
      } catch (e) {}
      return;
    }

    try {
      const globalCached = localStorage.getItem(GLOBAL_WIDGETS_STORAGE_KEY);
      if (globalCached) {
        const parsedGlobal = sanitizeDashboardWidgets(JSON.parse(globalCached));
        if (parsedGlobal.length > 0) {
          setDashboardWidgets(parsedGlobal);
          return;
        }
      }
      if (selectedProjectId) {
        const legacyCached = localStorage.getItem(`testpulse_widgets_${selectedProjectId}`);
        if (legacyCached) {
          const parsedLegacy = sanitizeDashboardWidgets(JSON.parse(legacyCached));
          if (parsedLegacy.length > 0) {
            setDashboardWidgets(parsedLegacy);
            localStorage.setItem(GLOBAL_WIDGETS_STORAGE_KEY, JSON.stringify(parsedLegacy));
            return;
          }
        }
      }
    } catch (e) {}

    setDashboardWidgets(DEFAULT_DASHBOARD_WIDGETS);
  }, [projectConfig?.dashboardWidgets, selectedProjectId]);

  const handleSaveDashboardLayout = (newWidgets) => {
    const sanitized = sanitizeDashboardWidgets(newWidgets);
    const finalWidgets = sanitized.length > 0 ? sanitized : DEFAULT_DASHBOARD_WIDGETS;
    setDashboardWidgets(finalWidgets);
    try {
      localStorage.setItem(GLOBAL_WIDGETS_STORAGE_KEY, JSON.stringify(finalWidgets));
      if (selectedProjectId) {
        localStorage.setItem(`testpulse_widgets_${selectedProjectId}`, JSON.stringify(finalWidgets));
      }
    } catch (e) {}
    if (selectedProjectId) {
      const updatedConf = { ...projectConfig, dashboardWidgets: finalWidgets };
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

  // ── Admin: re-sync Test Runs from current Test Case ──
  const [snapshotFieldMap, setSnapshotFieldMap] = useState(null);
  const [resyncCycleId, setResyncCycleId] = useState('');
  const [resyncRunning, setResyncRunning] = useState(false);
  const [resyncProgress, setResyncProgress] = useState({ done: 0, total: 0 });
  const [resyncResult, setResyncResult] = useState(null);

  useEffect(() => {
    if (activeTab === 'config' && isAdmin && !snapshotFieldMap) {
      invoke('getSnapshotFieldMapping').then(m => setSnapshotFieldMap(m || { precondition: [], steps: [], expected: [] })).catch(() => setSnapshotFieldMap({ precondition: [], steps: [], expected: [] }));
    }
  }, [activeTab, isAdmin, snapshotFieldMap]);

  const handleResyncCycleRuns = () => {
    if (!resyncCycleId || resyncRunning) return;
    const cycle = testCycles.find(c => String(c.id) === String(resyncCycleId));
    showConfirm(
      'Actualizar Test Runs',
      `Se actualizarán los Test Runs del ciclo ${cycle?.key || ''} con el contenido actual de sus Test Cases. El snapshot anterior se guarda para auditoría; estados y evidencias no se modifican.`,
      () => runResyncCycleRuns(cycle),
      { confirmLabel: 'Actualizar' }
    );
  };

  const runResyncCycleRuns = async (cycle) => {
    setResyncRunning(true);
    setResyncResult(null);
    setResyncProgress({ done: 0, total: 0 });
    try {
      const list = await invoke('listCycleRunsForResync', { projectId: selectedProjectId, cycleId: resyncCycleId });
      if (list?.error === 'FORBIDDEN') throw new Error('Solo los administradores del proyecto pueden ejecutar esta acción.');
      const items = list?.items || [];
      setResyncProgress({ done: 0, total: items.length });
      let ok = 0;
      const failed = [];
      for (let i = 0; i < items.length; i += 10) {
        const chunk = items.slice(i, i + 10);
        const res = await invoke('resyncTestRunsBatch', { projectId: selectedProjectId, items: chunk });
        if (res?.error === 'FORBIDDEN') throw new Error('Solo los administradores del proyecto pueden ejecutar esta acción.');
        (res?.results || []).forEach(r => {
          if (r.ok) ok++;
          else failed.push({ ...r, testRunKey: chunk.find(c => c.testRunId === r.testRunId)?.testRunKey });
        });
        setResyncProgress({ done: Math.min(i + chunk.length, items.length), total: items.length });
      }
      setResyncResult({ ok, failed, withoutRun: list?.withoutRun || 0 });
      addNotification({
        type: failed.length ? 'warning' : 'success',
        title: 'Test Runs actualizados',
        description: `${ok} de ${items.length} Test Runs del ciclo ${cycle?.key || ''} se actualizaron desde su Test Case.`
      });
    } catch (err) {
      addNotification({ type: 'error', title: 'No se pudo actualizar', description: err.message || String(err) });
    } finally {
      setResyncRunning(false);
    }
  };
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
                 throw new Error(res[0]?.summary || 'Error al obtener casos de prueba (getTestCases)');
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

  const fetchLinkedRequirements = async (tests, projId, cfg) => {
    const targetProjId = projId || selectedProjectId;
    if (!targetProjId) return;
    try {
      const linkedKeys = new Set();
      (tests || []).forEach(tc => {
        const raw = tc?.rawFields;
        if (raw?.parent?.key) linkedKeys.add(raw.parent.key);
        if (typeof raw?.customfield_10014 === 'string' && /^[A-Z][A-Z0-9]+-\d+$/i.test(raw.customfield_10014.trim())) {
          linkedKeys.add(raw.customfield_10014.trim());
        }
        if (Array.isArray(raw?.issuelinks)) {
          raw.issuelinks.forEach(link => {
            if (link?.inwardIssue?.key) linkedKeys.add(link.inwardIssue.key);
            if (link?.outwardIssue?.key) linkedKeys.add(link.outwardIssue.key);
          });
        }
      });

      const issueKeysArray = Array.from(linkedKeys).filter(k => /^[A-Z][A-Z0-9]+-\d+$/i.test(k)).slice(0, 500);
      const reqRes = await invoke('getRequirements', {
        projectId: targetProjId,
        config: cfg || projectConfig,
        issueKeys: issueKeysArray.length > 0 ? issueKeysArray : undefined
      });

      if (Array.isArray(reqRes) && reqRes.length > 0) {
        const reqMap = {};
        reqRes.forEach(issue => {
          if (!issue || !issue.key) return;
          const p = issue.fields?.parent;
          const cf10014 = issue.fields?.customfield_10014;
          let epicKey = issue.epicKey || null;
          let epicSummary = issue.epicSummary || null;
          if (!epicKey && p?.key) {
            epicKey = p.key;
            epicSummary = p.fields?.summary || null;
          } else if (!epicKey && typeof cf10014 === 'string' && /^[A-Z][A-Z0-9]+-\d+$/i.test(cf10014.trim())) {
            epicKey = cf10014.trim();
          }
          // Check if requirement has an issuelink directly to an Epic
          if (!epicKey && Array.isArray(issue.fields?.issuelinks)) {
            for (const lnk of issue.fields.issuelinks) {
              const cand = lnk.inwardIssue || lnk.outwardIssue;
              const cType = (cand?.fields?.issuetype?.name || '').toLowerCase().trim();
              if (cand?.key && (cType === 'epic' || cType === 'épica' || cType.includes('epic') || cType.includes('épica'))) {
                epicKey = cand.key;
                epicSummary = cand.fields?.summary || null;
                break;
              }
            }
          }
          reqMap[issue.key] = {
            key: issue.key,
            summary: issue.fields?.summary || '',
            issueType: issue.fields?.issuetype?.name || '',
            status: issue.fields?.status?.name || '',
            statusCategory: issue.fields?.status?.statusCategory?.key || '',
            epicKey,
            epicSummary
          };
        });
        setRequirementsMap(prev => ({ ...prev, ...reqMap }));
      }
    } catch (e) {
      console.warn("fetchLinkedRequirements error:", e);
    }
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
      const projectTypes = issueTypesRes.status === 'fulfilled' ? (issueTypesRes.value || []) : [];
      setIsAdmin(adminVal);
      setProjectConfig(config);
      setProjectIssueTypes(projectTypes);

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
        invoke('getTestPlans', { projectId: targetProjectId, config, projectIssueTypes: projectTypes }),
        invoke('getTestCycles', { projectId: targetProjectId, config, projectIssueTypes: projectTypes }),
      ]);
      if (foldersRes.status === 'fulfilled') setFolders(foldersRes.value || []);
      const loadedPlans = (plansRes.status === 'fulfilled' && Array.isArray(plansRes.value)) ? plansRes.value : [];
      const loadedCycles = (cyclesRes.status === 'fulfilled' && Array.isArray(cyclesRes.value)) ? cyclesRes.value : [];
      if (cyclesRes.status === 'fulfilled') {
        setTestCycles(loadedCycles);
      }
      if (plansRes.status === 'fulfilled') {
        setTestPlans(loadedPlans);
        if (loadedPlans.length > 0) {
          const planHasCycles = (plan) => loadedCycles.some(c =>
            c.planId && (
              String(c.planId) === String(plan.id) ||
              (plan.key && String(c.planId).toUpperCase() === String(plan.key).toUpperCase())
            )
          );
          const defaultPlan = loadedPlans.find(planHasCycles) || loadedPlans[0];
          setSelectedPlanId(prev => (prev && loadedPlans.some(p => String(p.id) === String(prev))) ? prev : defaultPlan.id);
        }
      }
      setRefreshTrigger(prev => prev + 1);

      // Phase 3: testCases + linkedRequirements (served in ~5ms from IndexedDB on re-entry)
      setIsFetchingTests(true);
      fetchAllTestCases({ folderId: null, projectId: targetProjectId, config, projectIssueTypes: projectTypes })
        .then(tests => {
          setTestCases(tests || []);
          fetchLinkedRequirements(tests || [], targetProjectId, config);
        })
        .catch(console.warn)
        .finally(() => {
          setIsFetchingTests(false);
        });

      // 3b. Fields (bulk upload + execution type)
      invoke('getFields').then(processFields).catch(console.warn);

      // 3c. (Removed) getAllowedProjects: its result (allowedProjects) is never read in the UI — saved 1 call per admin load.

      // Reports data is loaded on-demand when entering the Reports tab to save initial bandwidth and avoid Jira 429 rate limits

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
            const tc = findTc(ex.id);
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

  // Preload execution summaries for cycles of the active Plan without triggering 429 bursts:
  // Cycles that already carry preloaded executionMeta from getTestCycles require 0 extra JQL calls.
  // Any legacy cycle missing executionMeta is fetched in small batches of 2 with 150ms spacing.
  const [planCyclesSummary, setPlanCyclesSummary] = useState({});
  useEffect(() => {
    if (activeTab !== 'execution' || !testCycles || testCycles.length === 0) return;
    let cancelled = false;
    const targetCycles = selectedPlanId
      ? testCycles.filter(c => {
          const pid = String(selectedPlanId);
          return String(c.planId || '') === pid ||
            String(c.testPlanId || '') === pid ||
            String(c.parentPlanId || '') === pid ||
            (Array.isArray(c.planIds) && c.planIds.map(String).includes(pid));
        })
      : testCycles;
    if (targetCycles.length === 0) return;

    (async () => {
      const nextMap = {};
      const missingCycles = [];
      for (const c of targetCycles) {
        const cid = String(c.id);
        const cached = perCycleCacheRef.current[cid] || perCycleCacheRef.current[c.id];
        if (Array.isArray(cached) && cached.length > 0) {
          nextMap[cid] = cached;
        } else if (c.executionMeta && typeof c.executionMeta.total === 'number') {
          // Already has preloaded execution-meta from getTestCycles -> 0 extra JQL calls needed
          if (Array.isArray(c.tests) && c.tests.length > 0) nextMap[cid] = c.tests;
          else if (Array.isArray(c.execution) && c.execution.length > 0) nextMap[cid] = c.execution;
        } else {
          missingCycles.push(c);
        }
      }

      if (!cancelled && Object.keys(nextMap).length > 0) {
        setPlanCyclesSummary(prev => ({ ...prev, ...nextMap }));
      }

      // Fetch at most 2 legacy cycles at a time with 150ms spacing, respecting the 429 circuit breaker
      for (let i = 0; i < missingCycles.length; i += 2) {
        if (cancelled || isCircuitBroken()) break;
        const batch = missingCycles.slice(i, i + 2);
        const batchMap = {};
        await Promise.all(
          batch.map(async (c) => {
            const cid = String(c.id);
            try {
              const summary = await invoke('getCycleExecutionSummary', { cycleId: c.id });
              if (Array.isArray(summary)) {
                perCycleCacheRef.current[cid] = summary;
                batchMap[cid] = summary;
              } else {
                batchMap[cid] = c.tests || c.execution || [];
              }
            } catch (err) {
              if (err?.message?.includes('429') || err?.status === 429) tripCircuitBreaker();
              batchMap[cid] = c.tests || c.execution || [];
            }
          })
        );
        if (!cancelled && Object.keys(batchMap).length > 0) {
          setPlanCyclesSummary(prev => ({ ...prev, ...batchMap }));
        }
        if (i + 2 < missingCycles.length && !cancelled) {
          await new Promise(r => setTimeout(r, 150));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activeTab, selectedPlanId, testCycles.length]);

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
      const matchesSearch = tc.key.toLowerCase().includes(deferredSearchQuery.toLowerCase()) || (tc.summary || '').toLowerCase().includes(deferredSearchQuery.toLowerCase());
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
  }, [activeFolderScopedTestCases, deferredSearchQuery, isAutomatedTest, designTypeFilter, designSortOrder]);
  
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
              <span>Reports</span>
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
                  clearPersistentCache();
                  queryClient.invalidateQueries();

                  if (activeTab === 'execution' || activeTab === 'planning') {
                    setLocalLoading(true);
                    const config = projectConfig || { testCycleType: 'Test Cycle', planIssueType: 'Test Set' };
                    const [fetchedCycles, fetchedPlans] = await Promise.all([
                      invoke('getTestCycles', { projectId: selectedProjectId, config }),
                      invoke('getTestPlans', { projectId: selectedProjectId, config })
                    ]);
                    if (fetchedCycles && !fetchedCycles._isError) {
                      setTestCycles(fetchedCycles);
                      if (selectedCycle) {
                        const refreshedSel = fetchedCycles.find(c => String(c.id) === String(selectedCycle.id));
                        if (refreshedSel) setSelectedCycle(refreshedSel);
                      }
                    }
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
                    const promises = [
                      invoke('getTestCycles', { projectId: selectedProjectId, config }),
                      invoke('getTestPlans', { projectId: selectedProjectId, config })
                    ];
                    if (activeTab === 'dashboard' && dashboardSubView === 'traceability') {
                      promises.push(loadTraceabilityHierarchy(selectedProjectId, config));
                    }
                    const [fetchedCycles, fetchedPlans] = await Promise.all(promises);
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

        <div id="folderTreeList" style={{ padding: '0.5rem', margin: 0, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
          {(() => {
            const rootCount = isFetchingTests && testCases.length === 0
              ? '...'
              : testCases.filter(t => !t.folderId || !existingFolderIdSet.has(t.folderId)).length;
            const isRootActive = activeFolder === null;
            const isRootDragOver = dragOverFolderId === '__ROOT__';
            return (
              <div
                data-folder-id="__ROOT__"
                className={`folder-tree-row ${isRootActive ? 'active' : ''} ${isRootDragOver ? 'drag-over' : ''}`}
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
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setIsAllTestsExpanded(prev => !prev); }}
                    style={{
                      padding: '2px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: isRootActive ? '#0C66E4' : '#626F86',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={isAllTestsExpanded ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"} />
                    </svg>
                  </button>
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style={{ color: isRootActive ? '#0C66E4' : '#F59E0B', flexShrink: 0 }}>
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                  <span style={{ fontWeight: 600, color: isRootDragOver ? '#E1007A' : (isRootActive ? '#0C66E4' : '#172B4D'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isRootDragOver ? '⚡ Soltar aquí (Sin Carpeta)' : 'Sin Carpeta'}
                  </span>
                </div>
                {isRootActive ? (
                  <span style={{ backgroundColor: '#0C66E4', color: '#FFFFFF', fontSize: '10px', fontWeight: 700, borderRadius: '9999px', padding: '1px 7px', lineHeight: '16px', flexShrink: 0 }}>
                    {rootCount}
                  </span>
                ) : rootCount === 0 ? (
                  <span style={{ fontSize: '10px', color: '#8590A2', fontWeight: 500, padding: '0 4px', flexShrink: 0 }}>
                    0
                  </span>
                ) : (
                  <span style={{ backgroundColor: '#F1F2F4', color: '#44546F', fontSize: '10px', fontWeight: 700, borderRadius: '9999px', padding: '2px 8px', lineHeight: '14px', flexShrink: 0 }}>
                    {rootCount}
                  </span>
                )}
              </div>
            );
          })()}

          {isAllTestsExpanded && (() => {
            const q = (folderSearchQuery || '').trim().toLowerCase();
            const folderMatchesSearch = (fId) => {
              if (!q) return true;
              const desc = getFolderDescendantIds(fId);
              return folders.some(f => desc.has(f.id) && (f.name || '').toLowerCase().includes(q));
            };

            const renderTree = (parentId = null) => {
              const children = folders
                .filter(f => (f.parentId || null) === parentId)
                .filter(f => folderMatchesSearch(f.id));
              if (children.length === 0) return null;

              const hasDirectActiveChild = children.some(f => f.id === activeFolder);

              return (
                <div
                  style={{
                    position: 'relative',
                    marginLeft: '12px',
                    paddingLeft: '10px',
                    borderLeft: hasDirectActiveChild ? '1px solid rgba(12, 102, 228, 0.3)' : '1px solid #DCDFE4',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    marginTop: '2px'
                  }}
                >
                  {children.map(folder => {
                    const hasChildren = folders.some(f => f.parentId === folder.id && folderMatchesSearch(f.id));
                    const isExpanded = q ? true : (expandedFolders[folder.id] !== false);
                    const isActive = activeFolder === folder.id;
                    const isDragTarget = dragOverFolderId === folder.id;
                    const folderCount = isFetchingTests && testCases.length === 0 ? '...' : getFolderTotalCount(folder.id);

                    return (
                      <div key={folder.id} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div
                          data-folder-id={folder.id}
                          className={`folder-tree-row ${isActive ? 'active' : ''} ${isDragTarget ? 'drag-over' : ''}`}
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
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                            {hasChildren && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedFolders(prev => ({ ...prev, [folder.id]: !isExpanded }));
                                }}
                                style={{
                                  padding: '2px',
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: isActive ? '#0C66E4' : '#626F86',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d={isExpanded ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"} />
                                </svg>
                              </button>
                            )}
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              style={{ color: isActive ? '#0C66E4' : '#F59E0B', flexShrink: 0 }}
                            >
                              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                            </svg>
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontWeight: isDragTarget ? 700 : (isActive ? 600 : (hasChildren ? 500 : 400)),
                                color: isDragTarget ? '#E1007A' : (isActive ? '#0C66E4' : '#172B4D')
                              }}
                              title={folder.name}
                            >
                              {isDragTarget ? `⚡ Soltar en "${folder.name}"` : folder.name}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                            <div className="folder-tree-actions">
                              <button
                                type="button"
                                className="folder-tree-action-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCreateFolder(folder.id);
                                  setExpandedFolders(prev => ({ ...prev, [folder.id]: true }));
                                }}
                                title="Añadir subcarpeta"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                              </button>
                              <button
                                type="button"
                                className="folder-tree-action-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateFolder(folder.id, folder.name);
                                }}
                                title="Editar carpeta"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  className="folder-tree-action-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteFolder(folder.id, folder.name);
                                  }}
                                  title="Eliminar carpeta"
                                  style={{ color: '#CA3521' }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                </button>
                              )}
                            </div>

                            {isActive ? (
                              <span style={{ backgroundColor: '#0C66E4', color: '#FFFFFF', fontSize: '10px', fontWeight: 700, borderRadius: '9999px', padding: '1px 7px', lineHeight: '16px' }}>
                                {folderCount}
                              </span>
                            ) : folderCount === 0 ? (
                              <span style={{ fontSize: '10px', color: '#8590A2', fontWeight: 500, padding: '0 4px' }}>
                                0
                              </span>
                            ) : (
                              <span style={{ backgroundColor: '#F1F2F4', color: '#44546F', fontSize: '10px', fontWeight: 600, borderRadius: '9999px', padding: '2px 7px', lineHeight: '14px' }}>
                                {folderCount}
                              </span>
                            )}
                          </div>
                        </div>

                        {hasChildren && isExpanded && renderTree(folder.id)}
                      </div>
                    );
                  })}
                </div>
              );
            };
            return renderTree(null);
          })()}
        </div>
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
                          title={test.summary || (findTc(test.id)?.summary) || "Caso de prueba"}
                        >
                          {test.summary || (findTc(test.id)?.summary) || "Caso de prueba"}
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
    setTestCaseHistoryLoading(true);
    setTestCaseHistory([]);

    const historyPromise = invoke('getTestCaseHistory', { testId: caseId, projectId: selectedProjectId, config: projectConfig })
      .then(h => setTestCaseHistory(Array.isArray(h) ? h : []))
      .catch(e => { console.error('Error loading history:', e); setTestCaseHistory([]); })
      .finally(() => setTestCaseHistoryLoading(false));

    let details = { type: 'traditional', content: [] };
    try {
      details = await invoke('getTestCaseDetails', { caseId });
    } catch(e) {
      console.error('Error loading details:', e);
    }
    setTestCaseDetails(details || { type: 'traditional', content: [] });
    setTestCaseDetailsLoading(false);
    await historyPromise;
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

    const modalEpicReq = extractEpicAndRequirement(selectedTestCase, projectConfig, requirementsMap);

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

                {/* Epic Lozenge if present */}
                {modalEpicReq.epicKey && (
                  <span
                    onClick={() => openTraceabilityItemModal('epic', modalEpicReq.epicKey, {
                      summary: modalEpicReq.epicSummary || ''
                    })}
                    className="ads-lozenge ads-lozenge-subtle"
                    style={{ fontSize: '10px', color: '#6554C0', background: '#EAE6FF', fontWeight: 700, cursor: 'pointer' }}
                    title={modalEpicReq.epicSummary ? `Ver detalle de Épica ${modalEpicReq.epicKey}: ${modalEpicReq.epicSummary}` : `Ver detalle de Épica ${modalEpicReq.epicKey}`}
                  >
                    ⚡ {modalEpicReq.epicKey}
                  </span>
                )}

                {/* Requirement / Story Lozenge if present */}
                {modalEpicReq.reqKey && (
                  <span
                    onClick={() => openTraceabilityItemModal('story', modalEpicReq.reqKey, {
                      summary: modalEpicReq.reqSummary || '',
                      epicKey: modalEpicReq.epicKey || null,
                      epicSummary: modalEpicReq.epicSummary || ''
                    })}
                    className="ads-lozenge ads-lozenge-subtle"
                    style={{ fontSize: '10px', color: '#0065FF', background: '#DEEBFF', fontWeight: 700, cursor: 'pointer' }}
                    title={modalEpicReq.reqSummary ? `Ver detalle de Historia ${modalEpicReq.reqKey}: ${modalEpicReq.reqSummary}` : `Ver detalle de Historia ${modalEpicReq.reqKey}`}
                  >
                    📖 {modalEpicReq.reqKey}
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
                  {testCaseHistoryLoading ? (
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
            setQrModalReceivedCount(0);
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
                  Apunta con la cámara de tu celular para subir una o más fotos
                </div>
              </div>
            </div>
            <button
              onClick={() => { setQrModalSession(null); setQrModalReceived(false); setQrModalReceivedCount(0); }}
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
                  <div>
                    {qrModalReceivedCount > 1
                      ? `¡${qrModalReceivedCount} Evidencias Recibidas con Éxito!`
                      : '¡Evidencia Recibida con Éxito!'}
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 500, color: '#216E4E' }}>
                    Las capturas se acumulan sin sobrescribirse. Puedes seguir enviando más fotos desde el celular o cerrar esta ventana.
                  </div>
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
                <span>Esperando capturas desde el celular...</span>
              </div>
            )}

            {/* Instructions Step-by-Step */}
            <div style={{ width: '100%', fontSize: '11.5px', color: '#626F86', background: '#FAFBFC', padding: '10px 14px', borderRadius: '8px', border: '1px solid #EBECF0' }}>
              <div style={{ fontWeight: 700, color: '#172B4D', marginBottom: '4px' }}>📌 Pasos rápidos:</div>
              <div>1. Abre la app de <strong>Cámara</strong> en tu iPhone o Android.</div>
              <div>2. Apunta al código QR y toca el enlace que aparece.</div>
              <div>3. Toma una o varias fotos y presiona <strong>"Enviar a la Pantalla"</strong> (puedes repetir todas las veces que necesites).</div>
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
                onClick={() => { setQrModalSession(null); setQrModalReceived(false); setQrModalReceivedCount(0); }}
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
        const tc = findTc(ex.id);
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
          const mergedIters = mergeIterationsPreservingLocal(existing.iterations, item.iterations);
          const hasExec = item.status && normalizeUiStatus(item.status) !== 'Not Run';
          const existingHasExec = existing.status && normalizeUiStatus(existing.status) !== 'Not Run';
          if (hasExec && !existingHasExec) {
            dedupedMap.set(dKey, { ...item, iterations: mergedIters });
          } else {
            dedupedMap.set(dKey, { ...existing, iterations: mergedIters });
          }
        }
      });
      const finalTests = Array.from(dedupedMap.values());

      if (activeCycleIdRef.current === cycleId) {
        safeSetCycleTests(finalTests, cycleId);
        setSelectedCycle(prev => (prev && String(prev.id) === cycleId ? { ...prev, testCount: finalTests.length } : prev));
      } else {
        perCycleCacheRef.current[cycleId] = finalTests;
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
    const cycleId = String(selectedCycle.id);
    const targetItem = cycleTests.find(t => String(t.id) === id || String(t.key) === id || String(t.testRunId) === id || String(t.testCaseKey) === id || String(t.testCaseId) === id);
    const idsToTrack = [id];
    if (targetItem) {
      if (targetItem.id) idsToTrack.push(String(targetItem.id));
      if (targetItem.key) idsToTrack.push(String(targetItem.key));
      if (targetItem.testCaseId) idsToTrack.push(String(targetItem.testCaseId));
      if (targetItem.testCaseKey) idsToTrack.push(String(targetItem.testCaseKey));
      if (targetItem.testRunId) idsToTrack.push(String(targetItem.testRunId));
      if (targetItem.testRunKey) idsToTrack.push(String(targetItem.testRunKey));
    }
    idsToTrack.forEach(trackId => {
      deletedIdsRef.current.add(trackId);
      if (!perCycleDeletedRef.current[cycleId]) perCycleDeletedRef.current[cycleId] = new Set();
      perCycleDeletedRef.current[cycleId].add(trackId);
    });
    setPlanningChecked(prev => { const s = new Set(prev); idsToTrack.forEach(tid => s.delete(tid)); return s; });
    setCycleTests(prev => {
      const next = prev.filter(t => {
        const tId = String(t.id || '');
        const tKey = String(t.key || '');
        const tTcKey = String(t.testCaseKey || '');
        const tRunId = String(t.testRunId || '');
        return !idsToTrack.includes(tId) && (!tKey || !idsToTrack.includes(tKey)) && (!tTcKey || !idsToTrack.includes(tTcKey)) && (!tRunId || !idsToTrack.includes(tRunId));
      });
      perCycleCacheRef.current[cycleId] = next;
      setTestCycles(cycles => cycles.map(c => String(c.id) === cycleId ? { ...c, testCount: next.length } : c));
      setSelectedCycle(c => (c && String(c.id) === cycleId ? { ...c, testCount: next.length } : c));
      return next;
    });
    try {
      await invoke('removeTestFromCycle', { cycleId, testId: id, testIds: Array.from(new Set(idsToTrack)) });
    } catch (err) {
      // Rollback on error
      idsToTrack.forEach(trackId => {
        deletedIdsRef.current.delete(trackId);
        perCycleDeletedRef.current[cycleId]?.delete(trackId);
      });
      addNotification({ type: 'error', title: 'Error al eliminar caso', description: err.message });
      const execution = await invoke('getCycleExecutionSummary', { cycleId }).catch(() => null);
      if (execution) safeSetCycleTests(execution);
    }
  };

  const handleRemoveManyFromCycle = async (testIds) => {
    if (!selectedCycle || !testIds || testIds.length === 0) return;
    const cycleId = String(selectedCycle.id);
    const idsToTrack = [];
    testIds.forEach(testId => {
      const id = String(testId);
      idsToTrack.push(id);
      const targetItem = cycleTests.find(t => String(t.id) === id || String(t.key) === id || String(t.testRunId) === id || String(t.testCaseKey) === id || String(t.testCaseId) === id);
      if (targetItem) {
        if (targetItem.id) idsToTrack.push(String(targetItem.id));
        if (targetItem.key) idsToTrack.push(String(targetItem.key));
        if (targetItem.testCaseId) idsToTrack.push(String(targetItem.testCaseId));
        if (targetItem.testCaseKey) idsToTrack.push(String(targetItem.testCaseKey));
        if (targetItem.testRunId) idsToTrack.push(String(targetItem.testRunId));
        if (targetItem.testRunKey) idsToTrack.push(String(targetItem.testRunKey));
      }
    });

    if (!perCycleDeletedRef.current[cycleId]) perCycleDeletedRef.current[cycleId] = new Set();
    idsToTrack.forEach(trackId => {
      deletedIdsRef.current.add(trackId);
      perCycleDeletedRef.current[cycleId].add(trackId);
    });
    setPlanningChecked(new Set());
    setCycleTests(prev => {
      const next = prev.filter(t => {
        const tId = String(t.id || '');
        const tKey = String(t.key || '');
        const tTcKey = String(t.testCaseKey || '');
        const tRunId = String(t.testRunId || '');
        return !idsToTrack.includes(tId) && (!tKey || !idsToTrack.includes(tKey)) && (!tTcKey || !idsToTrack.includes(tTcKey)) && (!tRunId || !idsToTrack.includes(tRunId));
      });
      perCycleCacheRef.current[cycleId] = next;
      setTestCycles(cycles => cycles.map(c => String(c.id) === cycleId ? { ...c, testCount: next.length } : c));
      setSelectedCycle(c => (c && String(c.id) === cycleId ? { ...c, testCount: next.length } : c));
      return next;
    });
    try {
      await invoke('removeManyTestsFromCycle', { cycleId, testIds: Array.from(new Set(idsToTrack)) });
      addNotification({ type: 'success', title: `${testIds.length} caso${testIds.length !== 1 ? 's' : ''} eliminado${testIds.length !== 1 ? 's' : ''} del ciclo` });
    } catch (err) {
      // Rollback on error
      idsToTrack.forEach(trackId => {
        deletedIdsRef.current.delete(trackId);
        perCycleDeletedRef.current[cycleId]?.delete(trackId);
      });
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
    const cycleIdStr = String(selectedCycle.id);
    const testId = (typeof testIdOrObj === 'object' && testIdOrObj?.id) ? testIdOrObj.id : testIdOrObj;
    const cachedList = perCycleCacheRef.current[cycleIdStr] || cycleTests;
    const test = cachedList.find(t => String(t.id) === String(testId))
      || cycleTests.find(t => String(t.id) === String(testId))
      || (typeof testIdOrObj === 'object' ? testIdOrObj : null);
    if (!test) return;

    const newIteration = {
      id: generateUUID(),
      expectedData: '',
      actualResult: '',
      status: 'Not Run',
      executedBy: context?.accountId || null,
      executedAt: Date.now(),
      evidences: []
    };

    const isRunning = !!runningTests[test.id];
    let latestIterationsSnapshot = [...(test.iterations || []), newIteration];
    const calcStatus = calculateOverallStatus(latestIterationsSnapshot);
    const currentNormStatus = normalizeUiStatus(test.status);
    // Preserve active status ('In Progress' when Play is active, or existing non-'Not Run' status when adding a fresh 'Not Run' iteration)
    const newStatus = isRunning
      ? 'In Progress'
      : (calcStatus === 'Not Run' && currentNormStatus !== 'Not Run' ? test.status : calcStatus);

    setCycleTests(prev => {
      const updated = prev.map(t => {
        if (String(t.id) === String(test.id)) {
          const baseIters = Array.isArray(t.iterations) ? t.iterations : (test.iterations || []);
          const exists = baseIters.some(it => String(it?.id) === String(newIteration.id));
          const mergedIters = exists ? baseIters : [...baseIters, newIteration];
          latestIterationsSnapshot = mergedIters;
          return { ...t, iterations: mergedIters, status: newStatus, _detailLoaded: true };
        }
        return t;
      });
      perCycleCacheRef.current[cycleIdStr] = updated;
      return updated;
    });

    try {
      const res = await invoke('updateTestStatus', {
        projectId: selectedProjectId,
        cycleId: selectedCycle.id,
        testId: test.id,
        testRunId: test.testRunId || test.testRunKey,
        iterations: latestIterationsSnapshot,
        status: newStatus,
        takeover: true
      });
      // If backend created/returned a run ID, update local state and cache immediately
      if (res?.test?.testRunId) {
        const newRunId = res.test.testRunId;
        const newRunKey = res.test.testRunKey || test.testRunKey;
        setCycleTests(prev => {
          const updated = prev.map(t => String(t.id) === String(test.id) ? { ...t, testRunId: newRunId, testRunKey: newRunKey, _detailLoaded: true } : t);
          perCycleCacheRef.current[cycleIdStr] = updated;
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
    const cycleIdStr = String(selectedCycle.id);
    if (iterId) {
      deletedIterationIdsRef.current.add(String(iterId));
    }
    const timerKey = `${testIdOrObj?.id || testIdOrObj}_${iterId}`;
    if (iterationSaveTimersRef.current[timerKey]) {
      clearTimeout(iterationSaveTimersRef.current[timerKey]);
      delete iterationSaveTimersRef.current[timerKey];
    }

    const testId = (typeof testIdOrObj === 'object' && testIdOrObj?.id) ? testIdOrObj.id : testIdOrObj;
    const cachedList = perCycleCacheRef.current[cycleIdStr] || cycleTests;
    const test = cachedList.find(t => String(t.id) === String(testId))
      || cycleTests.find(t => String(t.id) === String(testId))
      || (typeof testIdOrObj === 'object' ? testIdOrObj : null);
    if (!test) return;

    let newIterations = (test.iterations || []).filter(i => String(i.id) !== String(iterId));
    const isRunning = !!runningTests[test.id];
    const calcStatus = calculateOverallStatus(newIterations);
    const newStatus = isRunning ? 'In Progress' : calcStatus;

    setCycleTests(prev => {
      const updated = prev.map(t => {
        if (String(t.id) === String(test.id)) {
          const filteredIters = (t.iterations || []).filter(i => String(i.id) !== String(iterId));
          newIterations = filteredIters;
          return { ...t, iterations: filteredIters, status: newStatus, _detailLoaded: true };
        }
        return t;
      });
      perCycleCacheRef.current[cycleIdStr] = updated;
      return updated;
    });

    try {
      await invoke('updateTestStatus', {
        projectId: selectedProjectId,
        cycleId: selectedCycle.id,
        testId: test.id,
        testRunId: test.testRunId || test.testRunKey,
        iterations: newIterations,
        status: newStatus,
        takeover: true
      });
    } catch (e) {
      console.error('Error deleting iteration:', e);
      addNotification({ type: 'error', title: 'Error al eliminar iteración' });
    }
  };

  const handleIterationChange = async (testIdOrObj, iterId, field, value, options = {}) => {
    if (!selectedCycle) return;
    const cycleIdStr = String(selectedCycle.id);
    const testId = (typeof testIdOrObj === 'object' && testIdOrObj?.id) ? testIdOrObj.id : testIdOrObj;
    const cachedList = perCycleCacheRef.current[cycleIdStr] || cycleTests;
    const test = cachedList.find(t => String(t.id) === String(testId))
      || cycleTests.find(t => String(t.id) === String(testId))
      || (typeof testIdOrObj === 'object' ? testIdOrObj : null);
    if (!test) return;

    const isRunning = !!runningTests[test.id];
    let latestIterationsSnapshot = (test.iterations || []).map(i =>
      String(i.id) === String(iterId) ? { ...i, [field]: value } : i
    );
    const calculated = calculateOverallStatus(latestIterationsSnapshot);
    const currentNormStatus = normalizeUiStatus(test.status);
    // Si la prueba está en ejecución activa (Play), mantenemos 'In Progress' en la UI para evitar saltos
    const newStatus = isRunning
      ? 'In Progress'
      : (calculated === 'Not Run' && currentNormStatus !== 'Not Run' ? test.status : calculated);

    setCycleTests(prev => {
      const updated = prev.map(t => {
        if (String(t.id) === String(test.id)) {
          const baseIters = Array.isArray(t.iterations) && t.iterations.length > 0 ? t.iterations : (test.iterations || []);
          const mappedIters = baseIters.map(i => String(i.id) === String(iterId) ? { ...i, [field]: value } : i);
          latestIterationsSnapshot = mappedIters;
          const calc = calculateOverallStatus(mappedIters);
          const normT = normalizeUiStatus(t.status);
          const statusToSet = isRunning
            ? 'In Progress'
            : (calc === 'Not Run' && normT !== 'Not Run' ? t.status : calc);
          return { ...t, iterations: mappedIters, status: statusToSet, _detailLoaded: true };
        }
        return t;
      });
      perCycleCacheRef.current[cycleIdStr] = updated;
      return updated;
    });

    const timerKey = `${test.id}_${iterId}_${field}`;
    const persistToBackend = async () => {
      const freshList = perCycleCacheRef.current[cycleIdStr] || [];
      const freshTest = freshList.find(t => String(t.id) === String(test.id)) || test;
      const itersToSave = freshTest?.iterations || latestIterationsSnapshot;
      const statusToSave = freshTest?.status || newStatus;
      try {
        await invoke('updateTestStatus', {
          projectId: selectedProjectId,
          cycleId: selectedCycle.id,
          testId: test.id,
          testRunId: freshTest?.testRunId || freshTest?.testRunKey || test.testRunId || test.testRunKey,
          iterations: itersToSave,
          status: statusToSave,
          takeover: true
        });
      } catch (e) {
        console.error('Error updating iteration:', e);
      }
    };

    if (options.debounceMs) {
      if (iterationSaveTimersRef.current[timerKey]) {
        clearTimeout(iterationSaveTimersRef.current[timerKey]);
      }
      iterationSaveTimersRef.current[timerKey] = setTimeout(() => {
        delete iterationSaveTimersRef.current[timerKey];
        persistToBackend();
      }, options.debounceMs);
      return;
    }

    if (iterationSaveTimersRef.current[timerKey]) {
      clearTimeout(iterationSaveTimersRef.current[timerKey]);
      delete iterationSaveTimersRef.current[timerKey];
    }
    await persistToBackend();
  };

  const handleStopExecution = async (testIdOrObj, testObj) => {
    const testId = (typeof testIdOrObj === 'object' && testIdOrObj?.id) ? testIdOrObj.id : testIdOrObj;
    setRunningTests(prev => ({ ...prev, [testId]: null }));

    const cycleIdStr = selectedCycle ? String(selectedCycle.id) : null;
    const cachedList = (cycleIdStr && perCycleCacheRef.current[cycleIdStr]) || cycleTests;
    const test = cachedList.find(t => String(t.id) === String(testId))
      || testObj
      || cycleTests.find(t => String(t.id) === String(testId))
      || (typeof testIdOrObj === 'object' ? testIdOrObj : null);
    if (!test || !selectedCycle) return;

    // Consolidar estatus final si tiene iteraciones
    if (test.iterations && test.iterations.length > 0) {
      const finalStatus = calculateOverallStatus(test.iterations);

      setCycleTests(prev => {
        const updated = prev.map(t => String(t.id) === String(testId) ? { ...t, status: finalStatus, _detailLoaded: true } : t);
        perCycleCacheRef.current[cycleIdStr] = updated;
        return updated;
      });

      try {
        await invoke('updateTestStatus', {
          projectId: selectedProjectId,
          cycleId: selectedCycle.id,
          testId: test.id,
          testRunId: test.testRunId || test.testRunKey,
          iterations: test.iterations,
          status: finalStatus,
          takeover: true
        });
      } catch (e) {
        console.error('Error consolidating status upon stop:', e);
      }
    }
  };

  const handleTakeover = async (testIdOrObj) => {
    if (!selectedCycle) return;
    const cycleIdStr = String(selectedCycle.id);
    const testId = (typeof testIdOrObj === 'object' && testIdOrObj?.id) ? testIdOrObj.id : testIdOrObj;
    const cachedList = perCycleCacheRef.current[cycleIdStr] || cycleTests;
    const test = cachedList.find(t => String(t.id) === String(testId))
      || cycleTests.find(t => String(t.id) === String(testId))
      || (typeof testIdOrObj === 'object' ? testIdOrObj : null);
    if (!test || !test.id) return;

    try {
      const updated = await invoke('updateTestStatus', {
        projectId: selectedProjectId,
        cycleId: selectedCycle.id,
        testId: test.id,
        testRunId: test.testRunId || test.testRunKey,
        iterations: Array.isArray(test.iterations) && test.iterations.length > 0 ? test.iterations : undefined,
        takeover: true
      });
      if (updated) {
        setCycleTests(prev => {
          const next = prev.map(t => String(t.id) === String(test.id) ? { ...t, executedBy: updated.executedBy } : t);
          perCycleCacheRef.current[cycleIdStr] = next;
          return next;
        });
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
          filename: uploaded.filename || actualFile.name,
          url: uploaded.content,
          mimeType: uploaded.mimeType || actualFile.type || ''
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

    // Helper: preserve original file extension (e.g. .pdf, .png) if the user omitted it when renaming
    const ensureExtensionPreserved = (oldFilename, requestedName) => {
      const trimmed = String(requestedName || '').trim();
      if (!trimmed || !oldFilename) return trimmed;
      const oldExtMatch = String(oldFilename).match(/(\.[a-zA-Z0-9]{1,8})$/);
      if (oldExtMatch && !/\.[a-zA-Z0-9]{1,8}$/.test(trimmed)) {
        return `${trimmed}${oldExtMatch[1]}`;
      }
      return trimmed;
    };
    
    if (iterId) {
       const iters = [...(currentTest.iterations || [])];
       const iterIdx = iters.findIndex(i => i.id === iterId);
       if (iterIdx > -1) {
          const evs = iters[iterIdx].evidences ? [...iters[iterIdx].evidences] : [];
          if (typeof evs[index] === 'object') {
             const finalName = ensureExtensionPreserved(evs[index].filename, newName);
             evs[index] = { ...evs[index], filename: finalName };
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
      const finalName = ensureExtensionPreserved(currentEvidences[index].filename, newName);
      currentEvidences[index] = { ...currentEvidences[index], filename: finalName };
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
      setQrModalReceivedCount(0);
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

  /**
   * Continuous Polling for QR Mobile Evidence Uploads.
   * Keeps polling as long as the QR modal is open (even after the first photo arrives)
   * and appends every newly uploaded photo/video to the target iteration or test case
   * without overwriting previously captured evidences.
   */
  useEffect(() => {
    if (!qrModalSession || !qrModalSession.sessionId) return;

    let isPolling = false;
    const interval = setInterval(async () => {
      if (isPolling) return;
      isPolling = true;
      try {
        const res = await invoke('checkMobileUploadStatus', { sessionId: qrModalSession.sessionId });
        const rawList = Array.isArray(res?.evidences) && res.evidences.length > 0
          ? res.evidences
          : (res?.evidence ? [res.evidence] : []);

        if (res && res.uploaded && rawList.length > 0) {
          const incomingEvidences = rawList.map(ev => ({
            id: ev.id,
            filename: ev.filename,
            url: ev.url,
            note: ev.note,
            mimeType: ev.mimeType || undefined
          }));

          setQrModalReceived(true);
          setQrModalReceivedCount(prev => prev + incomingEvidences.length);

          const testId = qrModalSession.testId;
          const iterId = qrModalSession.iterId;
          const cycleIdStr = selectedCycle ? String(selectedCycle.id) : null;

          // Read the freshest test state from perCycleCacheRef (if available) or cycleTests
          // so consecutive batches never overwrite previous uploads.
          const latestList = (cycleIdStr && Array.isArray(perCycleCacheRef.current[cycleIdStr]))
            ? perCycleCacheRef.current[cycleIdStr]
            : cycleTests;
          const testItem = latestList.find(t => String(t.id) === String(testId));

          if (iterId) {
            const iters = [...(testItem?.iterations || [])];
            const iterIdx = iters.findIndex(i => i.id === iterId);
            if (iterIdx > -1) {
              const existingIterEvs = Array.isArray(iters[iterIdx].evidences) ? [...iters[iterIdx].evidences] : [];
              const existingIds = new Set(existingIterEvs.map(e => String(typeof e === 'object' ? (e.id || '') : e)));
              for (const ne of incomingEvidences) {
                if (!existingIds.has(String(ne.id))) {
                  existingIterEvs.push(ne);
                  existingIds.add(String(ne.id));
                }
              }
              iters[iterIdx] = {
                ...iters[iterIdx],
                evidences: existingIterEvs
              };

              const incomingIdSet = new Set(incomingEvidences.map(e => String(e.id)));
              const incomingNameSet = new Set(incomingEvidences.map(e => String(e.filename || '')).filter(Boolean));
              const cleanEvidences = (testItem?.evidences || []).filter(e => {
                const id = typeof e === 'object' ? String(e.id || '') : String(e || '');
                const name = typeof e === 'object' ? String(e.filename || '') : '';
                return !incomingIdSet.has(id) && (!name || !incomingNameSet.has(name));
              });

              setCycleTests(prev => {
                const updated = prev.map(t => {
                  if (String(t.id) !== String(testId)) return t;
                  const tIters = Array.isArray(t.iterations) ? [...t.iterations] : iters;
                  const tIdx = tIters.findIndex(i => i.id === iterId);
                  if (tIdx > -1) {
                    const prevEvs = Array.isArray(tIters[tIdx].evidences) ? [...tIters[tIdx].evidences] : [];
                    const prevIdSet = new Set(prevEvs.map(e => String(typeof e === 'object' ? (e.id || '') : e)));
                    for (const ne of incomingEvidences) {
                      if (!prevIdSet.has(String(ne.id))) {
                        prevEvs.push(ne);
                        prevIdSet.add(String(ne.id));
                      }
                    }
                    tIters[tIdx] = { ...tIters[tIdx], evidences: prevEvs };
                  }
                  const tCleanEvs = (t.evidences || []).filter(e => {
                    const id = typeof e === 'object' ? String(e.id || '') : String(e || '');
                    const name = typeof e === 'object' ? String(e.filename || '') : '';
                    return !incomingIdSet.has(id) && (!name || !incomingNameSet.has(name));
                  });
                  return { ...t, evidences: tCleanEvs, iterations: tIters, _detailLoaded: true };
                });
                if (cycleIdStr) {
                  perCycleCacheRef.current[cycleIdStr] = updated;
                }
                return updated;
              });

              await invoke('updateTestStatus', {
                cycleId: selectedCycle?.id,
                testId,
                testRunId: testItem?.testRunId || testItem?.testRunKey || qrModalSession.testRunId || qrModalSession.testRunKey,
                iterations: iters,
                evidences: cleanEvidences
              });
            }
          } else {
            const currentEvidences = testItem?.evidences ? [...testItem.evidences] : [];
            if (testItem?.evidence && currentEvidences.length === 0) {
              currentEvidences.push(testItem.evidence);
            }
            const existingIds = new Set(currentEvidences.map(e => String(typeof e === 'object' ? (e.id || '') : e)));
            for (const ne of incomingEvidences) {
              if (!existingIds.has(String(ne.id))) {
                currentEvidences.push(ne);
                existingIds.add(String(ne.id));
              }
            }

            setCycleTests(prev => {
              const updated = prev.map(t => {
                if (String(t.id) !== String(testId)) return t;
                const prevEvs = Array.isArray(t.evidences) ? [...t.evidences] : [];
                if (t.evidence && prevEvs.length === 0) {
                  prevEvs.push(t.evidence);
                }
                const prevIdSet = new Set(prevEvs.map(e => String(typeof e === 'object' ? (e.id || '') : e)));
                for (const ne of incomingEvidences) {
                  if (!prevIdSet.has(String(ne.id))) {
                    prevEvs.push(ne);
                    prevIdSet.add(String(ne.id));
                  }
                }
                return { ...t, evidences: prevEvs, _detailLoaded: true };
              });
              if (cycleIdStr) {
                perCycleCacheRef.current[cycleIdStr] = updated;
              }
              return updated;
            });

            await invoke('updateTestStatus', {
              cycleId: selectedCycle?.id,
              testId,
              testRunId: testItem?.testRunId || testItem?.testRunKey || qrModalSession.testRunId || qrModalSession.testRunKey,
              evidences: currentEvidences
            });
          }

          addNotification({
            type: 'success',
            title: incomingEvidences.length > 1
              ? `📸 ¡${incomingEvidences.length} Evidencias Móviles Recibidas!`
              : '📸 ¡Evidencia Móvil Recibida!',
            description: `${incomingEvidences.length > 1 ? `${incomingEvidences.length} capturas adjuntadas` : 'Captura adjuntada'} a ${qrModalSession.testRunKey || qrModalSession.testRunId || qrModalSession.testKey}${qrModalSession.iterName ? ` (${qrModalSession.iterName})` : ''}.`
          });
        }
      } catch (e) {
        console.warn('[QR Poll] Error checking mobile upload status:', e);
      } finally {
        isPolling = false;
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [qrModalSession, cycleTests, selectedCycle, addNotification]);

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

  /**
   * Opens an in-app preview modal for images, videos, and PDF documents attached to
   * Test Runs, Bug Details, or Traceability items.
   * Uses `fetchAttachmentBlobData` which automatically falls back to the Forge backend
   * resolver (`getAttachmentContent`) when browser `requestJira` is blocked by Jira's
   * 303 redirect to `api.media.atlassian.com`.
   */
  const handlePreviewEvidence = async (ev, explicitFilename) => {
    if (!ev) return;
    const id = typeof ev === 'object' ? (ev.id || ev.attachmentId) : ev;
    if (!id) return;

    let filename = explicitFilename || (typeof ev === 'object' ? ev.filename : null) || `evidence_${id}`;
    const note = (typeof ev === 'object' && ev.note) ? ev.note : null;
    const rawMime = (typeof ev === 'object' && ev.mimeType) ? String(ev.mimeType).toLowerCase() : '';

    const isVideoExt = /\.(mp4|mov|webm|avi|mkv)$/i.test(filename) || rawMime.startsWith('video/');
    const isImageExt = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(filename) || rawMime.startsWith('image/');
    const isPdfExt = /\.(pdf)$/i.test(filename) || rawMime === 'application/pdf';
    const hasExtension = /\.[a-zA-Z0-9]{1,8}$/.test(filename);

    if (isPdfExt || isVideoExt || isImageExt || !hasExtension) {
      const fallbackMime = isPdfExt
        ? 'application/pdf'
        : isVideoExt
        ? 'video/mp4'
        : 'image/png';

      setPreviewModalData({
        id,
        filename,
        note,
        loading: true,
        isPdf: isPdfExt,
        isVideo: isVideoExt
      });

      try {
        const data = await fetchAttachmentBlobData(id, fallbackMime);

        if (data && data.blobUrl) {
          const detectedMime = String(data.mimeType || fallbackMime).toLowerCase();
          const finalIsPdf = isPdfExt || detectedMime === 'application/pdf';
          const finalIsVideo = !finalIsPdf && (isVideoExt || detectedMime.startsWith('video/'));

          let finalFilename = filename;
          if (!hasExtension) {
            if (finalIsPdf) finalFilename += '.pdf';
            else if (finalIsVideo) finalFilename += '.mp4';
            else finalFilename += '.png';
          }

          setPreviewModalData({
            id,
            filename: finalFilename,
            note,
            loading: false,
            blobUrl: data.blobUrl,
            byteArray: data.byteArray || null,
            mimeType: data.mimeType || fallbackMime,
            isPdf: finalIsPdf,
            isVideo: finalIsVideo
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
      try {
        const snapshotKey = `tp_report_snapshot_${projId}`;
        const raw = localStorage.getItem(snapshotKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.reportData?.cycles?.length > 0) {
            setReportData({
              ...parsed.reportData,
              _loadedAt: parsed.timestamp || Date.now(),
              _isSnapshot: true,
              _snapshotTimestamp: parsed.timestamp || Date.now()
            });
            if (parsed.allCycleSummaries && Array.isArray(parsed.allCycleSummaries)) {
              setTestCycles(parsed.allCycleSummaries);
            }
            if (Array.isArray(parsed.plans) && parsed.plans.length > 0) {
              setTestPlans(parsed.plans);
            }
          }
        }
      } catch (e) {}
      if (!isSilent) {
        addNotification({ type: 'warning', title: 'Rate limit activo', description: 'Mostrando último corte guardado. Jira temporalmente en pausa.' });
      }
      return;
    }

    const currentSession = ++hydrationSessionRef.current;
    const currentReport = reportDataRef.current;
    const hasExistingData = currentReport && Array.isArray(currentReport.cycles) && currentReport.cycles.length > 0 && currentReport._loadedAt;
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
      if (Array.isArray(data?.plans) && data.plans.length > 0) {
        setTestPlans(data.plans);
        setSelectedPlanId(prev => prev || data.plans[0]?.id || null);
      }

      // Silent background sync with history already loaded: merge only the recent cycles into the
      // existing data. Replacing would drop historical cycles and force a full re-hydration (N extra calls).
      const isFullyHydrated = hasExistingData && currentReport.cycles.length >= (currentReport.totalCycles || 0);
      const isIncrementalSync = isSilent && isFullyHydrated;
      if (isIncrementalSync) {
        setReportData(prev => {
          const merged = new Map((prev?.cycles || []).map(c => [String(c.id), c]));
          initialCycles.forEach(c => merged.set(String(c.id), c));
          return {
            ...prev,
            cycles: Array.from(merged.values()),
            bugMap: { ...(prev?.bugMap || {}), ...initialBugMap },
            totalCycles: totalCycles,
            _loadedAt: Date.now(),
            _isSnapshot: false
          };
        });
      } else {
        setReportData({
          cycles: initialCycles,
          bugMap: initialBugMap,
          totalCycles: totalCycles,
          _loadedAt: Date.now(),
          _isSnapshot: false
        });
      }

      try {
        if (initialCycles.length > 0) {
          const snapshotKey = `tp_report_snapshot_${projId}`;
          localStorage.setItem(snapshotKey, JSON.stringify({
            reportData: { cycles: initialCycles, bugMap: initialBugMap, totalCycles },
            allCycleSummaries: data?.allCycleSummaries || [],
            plans: data?.plans || [],
            timestamp: Date.now()
          }));
        }
      } catch (e) {}

      // Populate or sync testCycles immediately with all known cycle summaries from Jira
      if (data?.allCycleSummaries && Array.isArray(data.allCycleSummaries)) {
        setTestCycles(prev => {
          const prevMap = new Map((prev || []).map(c => [String(c.id), c]));
          return data.allCycleSummaries.map(s => {
            const existing = prevMap.get(String(s.id));
            const loadedCycle = initialCycles.find(ic => String(ic.id) === String(s.id));
            return {
              ...(existing || {}),
              id: s.id,
              key: s.key,
              summary: s.summary,
              status: existing?.status || 'To Do',
              planId: s.planId || loadedCycle?.planId || existing?.planId || null,
              schedule: s.schedule || loadedCycle?.schedule || existing?.schedule || null,
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
      // (skipped on incremental 15-min syncs: history is already complete and was merged above)
      if (!isIncrementalSync && data?.hasMore && data.nextOffset < totalCycles) {
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
      let restoredFromSnapshot = false;
      try {
        const snapshotKey = `tp_report_snapshot_${projId}`;
        const raw = localStorage.getItem(snapshotKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.reportData?.cycles?.length > 0) {
            setReportData({
              ...parsed.reportData,
              _loadedAt: parsed.timestamp || Date.now(),
              _isSnapshot: true,
              _snapshotTimestamp: parsed.timestamp || Date.now()
            });
            if (parsed.allCycleSummaries && Array.isArray(parsed.allCycleSummaries)) {
              setTestCycles(parsed.allCycleSummaries);
            }
            restoredFromSnapshot = true;
          }
        }
      } catch (snapErr) {
        console.warn('Error reading snapshot:', snapErr);
      }

      if (!restoredFromSnapshot) {
        setReportData(prev => {
          if (!prev || !prev.cycles || prev.cycles.length === 0) {
            return { ...prev, _loadError: true };
          }
          return prev;
        });
      }
      if (!isSilent) {
        if (restoredFromSnapshot) {
          addNotification({
            type: 'info',
            title: '⚠️ Modo Respaldo Activo',
            description: 'Jira tardó en responder. Mostrando el último corte registrado de métricas.'
          });
        } else {
          addNotification({
            type: 'warning',
            title: 'Sincronización de métricas',
            description: 'Jira tardó en responder. Mostrando los datos actuales disponibles.'
          });
        }
      }
    } finally {
      setReportLoading(false);
      setIsRefreshingReport(false);
    }
  };

  const prevCycleIdRef = useRef(null);
  const prevRefreshRef = useRef(null);

  const isCycleInPlan = useCallback((cycle, planId) => {
    if (!cycle || !cycle.planId || !planId) return false;
    if (String(cycle.planId) === String(planId)) return true;
    const planObj = (testPlans || []).find(p => String(p.id) === String(planId) || String(p.key) === String(planId));
    if (planObj) {
      return (
        String(cycle.planId) === String(planObj.id) ||
        (planObj.key && String(cycle.planId).toUpperCase() === String(planObj.key).toUpperCase())
      );
    }
    return false;
  }, [testPlans]);

  // Auto-preload all cycles of selected test plan in background
  useEffect(() => {
    if (!testCycles || testCycles.length === 0) return;
    if (selectedPlanId) {
      const planCycles = testCycles.filter(c => isCycleInPlan(c, selectedPlanId));
      if (planCycles.length > 0) {
        if (!selectedCycle || !planCycles.some(c => String(c.id) === String(selectedCycle.id))) {
          handleCycleSelect(planCycles[0]);
        }
        return;
      }
    }
    if (!selectedCycle && !selectedPlanId && testCycles.length > 0) {
      handleCycleSelect(testCycles[0]);
    }
  }, [selectedPlanId, testCycles, isCycleInPlan]);

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
            const tc = findTc(ex.id || ex.testCaseId);
            return tc ? { ...ex, key: tc.key, summary: tc.summary } : ex;
          });
          // Filter out any tests deleted this session (avoids stale-read ghosts from Jira eventual consistency)
          const deletedForCycle = perCycleDeletedRef.current[cycleId] || (selectedCycle ? perCycleDeletedRef.current[String(selectedCycle.id)] : null) || new Set();
          const filteredEnriched = enriched.filter(t => {
            const id = String(t.id || t.testCaseId || '');
            const key = String(t.key || t.testCaseKey || '');
            return !deletedForCycle.has(id) && (!key || !deletedForCycle.has(key));
          });
          
          // Preserve exact order as added / linked and preserve any local iterations
          if (activeCycleIdRef.current === cycleId) {
            safeSetCycleTests(filteredEnriched, cycleId);
          } else {
            perCycleCacheRef.current[cycleId] = filteredEnriched;
          }
          setTestCycles(prev => prev.map(c => String(c.id) === cycleId ? { ...c, testCount: filteredEnriched.length } : c));
        })
        .finally(() => {
          if (activeCycleIdRef.current === cycleId) {
            setIsLoadingCycleTests(false);
          }
        });
    }
    // Reports tab: intentionally NOT loaded here — the dedicated Reports effect (activeTab === 'reports')
    // already triggers loadReportData. Having both caused a duplicate getExecutionReport burst on entering the tab.
  }, [activeTab, selectedCycle, refreshTrigger]);

  // Re-enrich cached cycle tests and active cycleTests when Phase 3 (testCases) finishes loading
  useEffect(() => {
    if (!testCases || testCases.length === 0) return;
    const cache = perCycleCacheRef.current || {};
    Object.keys(cache).forEach(cid => {
      const list = cache[cid];
      if (Array.isArray(list) && list.some(ex => !ex.key || !ex.summary)) {
        cache[cid] = list.map(ex => {
          if (ex.key && ex.summary) return ex;
          const tc = findTc(ex.id || ex.testCaseId);
          return tc ? { ...ex, key: ex.key || tc.key, summary: ex.summary || tc.summary } : ex;
        });
      }
    });
    setCycleTests(prev => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      if (!prev.some(ex => !ex.key || !ex.summary)) return prev;
      return prev.map(ex => {
        if (ex.key && ex.summary) return ex;
        const tc = findTc(ex.id || ex.testCaseId);
        return tc ? { ...ex, key: ex.key || tc.key, summary: ex.summary || tc.summary } : ex;
      });
    });
  }, [testCases]);


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
    const targetTc = findTc(targetTestForBug);

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
      const tc = findTc(t.id);
      if (tc) target = tc;
    }
    return isAutomatedTest(target) ? 'automatizado' : 'manual';
  };

  // Incremental rendering counters for Planning lists (reset on cycle/filter change)
  const [planningCycleVisible, setPlanningCycleVisible] = useState(LIST_BATCH_SIZE);
  const [planningAvailVisible, setPlanningAvailVisible] = useState(LIST_BATCH_SIZE);
  useEffect(() => {
    setPlanningCycleVisible(LIST_BATCH_SIZE);
    setPlanningAvailVisible(LIST_BATCH_SIZE);
  }, [selectedCycle?.id, deferredSearchQuery, planningFolder, planningPriority, planningExecutionType]);

  // ─── Tester / folder helpers (Planning & Execution) ───
  const myAccountId = context?.accountId || null;
  const _uid = (u) => (u && typeof u === 'object') ? (u.accountId || null) : (u ? String(u) : null);
  const _uname = (u) => (u && typeof u === 'object') ? (u.displayName || u.name || '') : '';
  // "Mine" = assigned to me OR executed by me (testers usually get assigned when they execute)
  const isTestMine = (t) => !!myAccountId && (_uid(t.assignee) === myAccountId || _uid(t.executedBy) === myAccountId);
  const isTestUnassigned = (t) => !_uid(t.assignee) && !_uid(t.executedBy);
  const matchesTester = (t, filter) => {
    if (!filter || filter === 'ALL') return true;
    if (filter === 'MINE') return isTestMine(t);
    if (filter === 'UNASSIGNED') return isTestUnassigned(t);
    return _uid(t.assignee) === filter || _uid(t.executedBy) === filter;
  };
  const folderPathById = useMemo(() => {
    const m = new Map();
    folderPaths.forEach(f => m.set(String(f.id), f.path));
    return m;
  }, [folderPaths]);
  const getTestFolderId = (t) => {
    const tc = findTc(t.testCaseId || t.id) || t;
    const fid = tc?.folderId ? String(tc.folderId) : null;
    return fid && folderPathById.has(fid) ? fid : null;
  };
  const matchesFolder = (t, filter) => {
    if (!filter) return true;
    const fid = getTestFolderId(t);
    if (filter === '__ROOT__') return !fid;
    return fid === String(filter);
  };
  const groupTestsByFolder = (items) => {
    const map = new Map();
    items.forEach(t => {
      const fid = getTestFolderId(t) || '__ROOT__';
      if (!map.has(fid)) map.set(fid, []);
      map.get(fid).push(t);
    });
    return Array.from(map.entries())
      .map(([fid, list]) => ({ id: fid, name: fid === '__ROOT__' ? 'Sin carpeta' : (folderPathById.get(fid) || 'Carpeta'), items: list }))
      .sort((a, b) => (a.id === '__ROOT__' ? 1 : b.id === '__ROOT__' ? -1 : a.name.localeCompare(b.name)));
  };
  const isGroupCollapsed = (scope, gid) => !!collapsedGroups[`${scope}:${gid}`];
  const toggleGroup = (scope, gid) => setCollapsedGroups(prev => {
    const k = `${scope}:${gid}`;
    const n = { ...prev };
    if (n[k]) delete n[k]; else n[k] = true;
    return n;
  });
  const setAllGroups = (scope, groupIds, collapsed) => setCollapsedGroups(prev => {
    const n = { ...prev };
    groupIds.forEach(g => { const k = `${scope}:${g}`; if (collapsed) n[k] = true; else delete n[k]; });
    return n;
  });

  const groupToolBtnStyle = { background: '#FFFFFF', border: '1px solid #DCDFE4', borderRadius: '4px', padding: '2px 8px', fontSize: '11px', fontWeight: 600, color: '#44546F', cursor: 'pointer', height: '24px', display: 'inline-flex', alignItems: 'center', gap: '4px' };

  // Toolbar: group toggle + expand/collapse all (for a given list scope)
  const renderGroupToolbar = (scope, items) => {
    const groupIds = groupByFolder ? groupTestsByFolder(items).map(g => g.id) : [];
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <button type="button" style={{ ...groupToolBtnStyle, background: groupByFolder ? '#E9F2FF' : '#FFFFFF', color: groupByFolder ? '#0C66E4' : '#44546F' }}
          onClick={() => setGroupByFolder(v => !v)} title="Agrupar la lista por carpeta">
          📁 {groupByFolder ? 'Agrupado' : 'Agrupar'}
        </button>
        {groupByFolder && groupIds.length > 0 && (
          <>
            <button type="button" style={groupToolBtnStyle} onClick={() => setAllGroups(scope, groupIds, false)} title="Expandir todas las carpetas">⊞ Expandir</button>
            <button type="button" style={groupToolBtnStyle} onClick={() => setAllGroups(scope, groupIds, true)} title="Contraer todas las carpetas">⊟ Contraer</button>
          </>
        )}
      </div>
    );
  };

  // Renders items grouped by folder with collapsible headers (or flat when grouping is off)
  const renderGroupedList = (scope, items, renderItem, summaryFn) => {
    if (!groupByFolder) return items.map(renderItem);
    return groupTestsByFolder(items).map(g => {
      const collapsed = isGroupCollapsed(scope, g.id);
      return (
        <React.Fragment key={`grp-${scope}-${g.id}`}>
          <div
            onClick={() => toggleGroup(scope, g.id)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', margin: '6px 0 2px 0', background: '#F7F8F9', border: '1px solid #EBECF0', borderRadius: '6px', cursor: 'pointer', userSelect: 'none' }}
            title={collapsed ? 'Expandir carpeta' : 'Contraer carpeta'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#626F86" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.15s ease', flexShrink: 0 }}>
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <span style={{ fontSize: '13px' }}>📁</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#172B4D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{g.name}</span>
            {summaryFn && <span style={{ fontSize: '11px', color: '#626F86', flexShrink: 0 }}>{summaryFn(g.items)}</span>}
            <span style={{ fontSize: '10px', fontWeight: 700, background: '#DCDFE4', color: '#44546F', padding: '1px 7px', borderRadius: '10px', flexShrink: 0 }}>{g.items.length}</span>
          </div>
          {!collapsed && g.items.map(renderItem)}
        </React.Fragment>
      );
    });
  };

  // Collapsible section header helper (Planning lists)
  const isSectionCollapsed = (key) => !!collapsedGroups[`section:${key}`];
  const toggleSection = (key) => toggleGroup('section', key);
  const renderSectionChevron = (key) => {
    const c = isSectionCollapsed(key);
    return (
      <button type="button" onClick={() => toggleSection(key)} title={c ? 'Expandir lista' : 'Contraer lista'}
        style={{ background: 'transparent', border: 'none', padding: '2px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#44546F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: c ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.15s ease' }}>
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    );
  };

  // Project default view for Execution (configured by admin)
  useEffect(() => {
    if (execTesterFilterSource === 'default') {
      setExecTesterFilter(projectConfig?.executionDefaultView === 'MINE' ? 'MINE' : 'ALL');
    }
  }, [projectConfig?.executionDefaultView, selectedProjectId]);

  // Assignable users search (debounced) for the bulk-assign modal
  useEffect(() => {
    if (!assignModal || !selectedProjectId) return undefined;
    setAssignSearching(true);
    const h = setTimeout(() => {
      invoke('searchAssignableUsers', { projectId: selectedProjectId, query: assignQuery })
        .then(list => setAssignResults(Array.isArray(list) ? list : []))
        .catch(() => setAssignResults([]))
        .finally(() => setAssignSearching(false));
    }, 300);
    return () => clearTimeout(h);
  }, [assignModal, assignQuery, selectedProjectId]);

  const openAssignModal = (items) => {
    const withRun = (items || []).filter(t => t && t.testRunId);
    if (withRun.length === 0) {
      addNotification({ type: 'warning', title: 'Sin Test Runs', description: 'Los casos seleccionados aún no tienen Test Run en Jira.' });
      return;
    }
    setAssignQuery('');
    setAssignResults([]);
    setAssignModal({ items: withRun });
  };

  const applyAssignment = async (user) => {
    if (!assignModal || assignSaving) return;
    setAssignSaving(true);
    const items = assignModal.items.map(t => ({ testRunId: String(t.testRunId), id: String(t.id) }));
    const okIds = [];
    const failed = [];
    try {
      for (let i = 0; i < items.length; i += 25) {
        const chunk = items.slice(i, i + 25);
        const res = await invoke('bulkAssignTestRuns', { projectId: selectedProjectId, cycleId: selectedCycle?.id, items: chunk, user: user ? { accountId: user.accountId, displayName: user.displayName } : null });
        if (res?.error === 'FORBIDDEN') throw new Error('Solo los administradores del proyecto pueden asignar testers.');
        (res?.results || []).forEach(r => (r.ok ? okIds.push(String(r.testRunId)) : failed.push(r)));
      }
      const okSet = new Set(okIds);
      const newAssignee = user ? { accountId: user.accountId, displayName: user.displayName } : null;
      const apply = (arr) => (arr || []).map(t => {
        if (!okSet.has(String(t.testRunId))) return t;
        const notExecuted = normalizeUiStatus(t.status) === 'Not Run';
        // For unexecuted runs, executedBy mirrors the previous assignee (backend fallback) → keep it consistent
        const executedBy = (notExecuted && _uid(t.executedBy) === _uid(t.assignee)) ? newAssignee : t.executedBy;
        return { ...t, assignee: newAssignee, executedBy };
      });
      setCycleTests(prev => apply(prev));
      if (selectedCycle?.id && perCycleCacheRef.current[selectedCycle.id]) {
        perCycleCacheRef.current[selectedCycle.id] = apply(perCycleCacheRef.current[selectedCycle.id]);
      }
      setExecutionChecked(new Set());
      setAssignModal(null);
      addNotification({
        type: failed.length ? 'warning' : 'success',
        title: user ? 'Tester asignado' : 'Asignación removida',
        description: `${okIds.length} Test Run(s) ${user ? `asignados a ${user.displayName}` : 'sin asignar'}${failed.length ? ` · ${failed.length} con error` : ''}.`
      });
    } catch (err) {
      addNotification({ type: 'error', title: 'No se pudo asignar', description: err.message || String(err) });
    } finally {
      setAssignSaving(false);
    }
  };

  const renderAssignModal = () => {
    if (!assignModal) return null;
    return (
      <div onClick={() => !assignSaving && setAssignModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(9,30,66,0.54)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#FFFFFF', borderRadius: '8px', width: '420px', maxWidth: '92vw', boxShadow: '0 8px 24px rgba(9,30,66,0.25)', padding: '1.25rem' }}>
          <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '16px', color: '#172B4D' }}>👤 Asignar tester</h3>
          <p style={{ margin: '0 0 0.9rem 0', fontSize: '12px', color: '#626F86' }}>
            Se asignará la <strong>Persona asignada</strong> de {assignModal.items.length} Test Run(s) en Jira.
          </p>
          <input
            autoFocus
            type="text"
            value={assignQuery}
            onChange={e => setAssignQuery(e.target.value)}
            placeholder="Buscar usuario por nombre o correo…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.65rem', fontSize: '13px', border: '1px solid #DCDFE4', borderRadius: '6px', outline: 'none', marginBottom: '0.6rem' }}
          />
          <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid #EBECF0', borderRadius: '6px' }}>
            {assignSearching && assignResults.length === 0 ? (
              <div style={{ padding: '1rem', fontSize: '12px', color: '#626F86', textAlign: 'center' }}>Buscando…</div>
            ) : assignResults.length === 0 ? (
              <div style={{ padding: '1rem', fontSize: '12px', color: '#626F86', textAlign: 'center' }}>Sin resultados</div>
            ) : assignResults.map(u => (
              <div key={u.accountId}
                onClick={() => applyAssignment(u)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.5rem 0.75rem', cursor: assignSaving ? 'wait' : 'pointer', fontSize: '13px', color: '#172B4D', borderBottom: '1px solid #F1F2F4' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F4F5F7'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: '50%' }} /> : <span>👤</span>}
                <span>{u.displayName}</span>
                {u.accountId === myAccountId && <span style={{ fontSize: '10px', color: '#626F86' }}>(tú)</span>}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.9rem' }}>
            <button type="button" className="btn-secondary" disabled={assignSaving} onClick={() => applyAssignment(null)} style={{ fontSize: '12px', height: '30px' }}>
              Quitar asignación
            </button>
            <button type="button" className="btn-secondary" disabled={assignSaving} onClick={() => setAssignModal(null)} style={{ fontSize: '12px', height: '30px' }}>
              {assignSaving ? 'Asignando…' : 'Cancelar'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Planning Schedule & Filter States (Stitch Redesign) ───
  const [planningPlanSearch, setPlanningPlanSearch] = useState('');
  const [planningShowAllCycles, setPlanningShowAllCycles] = useState(false);
  const [planningCycleSearch, setPlanningCycleSearch] = useState('');
  const [planningCycleStatusFilter, setPlanningCycleStatusFilter] = useState('');
  const [isPlanCalendarOpen, setIsPlanCalendarOpen] = useState(false);
  const [planScheduleForm, setPlanScheduleForm] = useState({
    startDate: '',
    endDate: '',
    excludeWeekends: true,
    holidays: [],
    statusBadge: 'ACTIVO'
  });
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayDesc, setNewHolidayDesc] = useState('');
  const [isSavingPlanSchedule, setIsSavingPlanSchedule] = useState(false);

  const [isCycleScheduleOpen, setIsCycleScheduleOpen] = useState(false);
  const [cycleScheduleForm, setCycleScheduleForm] = useState({
    startDate: '',
    endDate: '',
    sprint: '',
    environment: 'QA',
    planningStatus: 'EN CURSO',
    excludeWeekends: true,
    holidays: []
  });
  const [isSavingCycleSchedule, setIsSavingCycleSchedule] = useState(false);

  // Sync active Test Plan schedule into form when selectedPlanId or testPlans changes
  useEffect(() => {
    const plan = testPlans.find(p => String(p.id) === String(selectedPlanId));
    const sched = plan?.schedule || {};
    setPlanScheduleForm({
      startDate: sched.startDate || '',
      endDate: sched.endDate || '',
      excludeWeekends: sched.excludeWeekends !== false,
      holidays: Array.isArray(sched.holidays) ? sched.holidays : [],
      statusBadge: sched.statusBadge || 'ACTIVO'
    });
    if (plan) {
      const hasSavedDates = Boolean(sched.startDate && sched.endDate);
      setIsPlanCalendarOpen(!hasSavedDates);
    } else {
      setIsPlanCalendarOpen(false);
    }
  }, [selectedPlanId, testPlans]);

  // Sync active Test Cycle schedule into form when selectedCycle or testCycles changes
  useEffect(() => {
    if (!selectedCycle) return;
    const cycleInList = testCycles.find(c => String(c.id) === String(selectedCycle.id)) || selectedCycle;
    const sched = cycleInList?.schedule || selectedCycle?.schedule || {};
    const parentPlan = testPlans.find(p => String(p.id) === String(cycleInList?.planId || selectedPlanId));
    const parentHolidays = Array.isArray(parentPlan?.schedule?.holidays) ? parentPlan.schedule.holidays : [];
    const defaultEnvName = availableEnvironments[0]?.name || 'QA';
    setCycleScheduleForm({
      startDate: sched.startDate || '',
      endDate: sched.endDate || '',
      sprint: sched.sprint || '',
      environment: sched.environment || cycleInList?.environment || selectedCycle?.environment || defaultEnvName,
      planningStatus: sched.planningStatus || 'EN CURSO',
      excludeWeekends: sched.excludeWeekends !== undefined ? sched.excludeWeekends !== false : (parentPlan?.schedule?.excludeWeekends !== false),
      holidays: Array.isArray(sched.holidays) && sched.holidays.length > 0 ? sched.holidays : parentHolidays
    });
  }, [selectedCycle?.id, testCycles, selectedPlanId, testPlans, availableEnvironments]);

  // Helper: Calculate natural and business days between two YYYY-MM-DD dates
  const calcScheduleDays = (startStr, endStr, excludeWeekends = true, holidays = []) => {
    if (!startStr || !endStr) return { naturalDays: 0, businessDays: 0 };
    const [sy, sm, sd] = String(startStr).split('-').map(Number);
    const [ey, em, ed] = String(endStr).split('-').map(Number);
    if (!sy || !sm || !sd || !ey || !em || !ed) return { naturalDays: 0, businessDays: 0 };
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
      return { naturalDays: 0, businessDays: 0 };
    }
    const holidaySet = new Set(
      (Array.isArray(holidays) ? holidays : [])
        .map(h => (typeof h === 'object' && h !== null ? String(h.date || '') : String(h || '')))
        .filter(Boolean)
    );
    let naturalDays = 0;
    let businessDays = 0;
    const cur = new Date(start);
    while (cur <= end && naturalDays < 3660) {
      naturalDays++;
      const dow = cur.getDay();
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = holidaySet.has(iso);
      if ((!excludeWeekends || !isWeekend) && !isHoliday) {
        businessDays++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return { naturalDays, businessDays };
  };

  // Helper: Format YYYY-MM-DD into short Spanish date (e.g. "06 Abr" or "06 Abr 2026")
  const formatShortDateEs = (dateStr, withYear = false) => {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-');
    if (parts.length !== 3) return dateStr;
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const mIdx = parseInt(parts[1], 10) - 1;
    const monthName = months[mIdx] || parts[1];
    return withYear ? `${parts[2]} ${monthName} ${parts[0]}` : `${parts[2]} ${monthName}`;
  };

  // Persist Test Plan calendar in Jira Issue Entity Property ('testpulse-schedule')
  const handleSavePlanSchedule = async () => {
    if (!selectedPlanId) return;
    setIsSavingPlanSchedule(true);
    try {
      const { naturalDays, businessDays } = calcScheduleDays(
        planScheduleForm.startDate,
        planScheduleForm.endDate,
        planScheduleForm.excludeWeekends,
        planScheduleForm.holidays
      );
      const schedulePayload = {
        ...planScheduleForm,
        naturalDays,
        businessDays
      };
      const res = await invoke('savePlanSchedule', {
        planId: selectedPlanId,
        schedule: schedulePayload
      });
      clearPersistentCache();
      queryClient.invalidateQueries();
      const savedSchedule = res?.schedule || schedulePayload;
      setTestPlans(prev => prev.map(p => String(p.id) === String(selectedPlanId) ? { ...p, schedule: savedSchedule } : p));
      setIsPlanCalendarOpen(false);
      addNotification({
        type: 'success',
        title: 'Calendario del Plan guardado',
        description: savedSchedule.startDate && savedSchedule.endDate
          ? `Vigencia: ${formatShortDateEs(savedSchedule.startDate)} – ${formatShortDateEs(savedSchedule.endDate)} (${savedSchedule.businessDays}d hábiles)`
          : 'Configuración de calendario actualizada en Jira.'
      });
    } catch (e) {
      console.error('Error saving plan schedule:', e);
      addNotification({ type: 'error', title: 'Error al guardar calendario del plan', description: e.message || String(e) });
    } finally {
      setIsSavingPlanSchedule(false);
    }
  };

  // Persist Test Cycle schedule in Jira Issue Entity Property ('testops-plan-link' & 'testpulse-schedule')
  const handleSaveCycleSchedule = async (overrideFields = null) => {
    if (!selectedCycle) return;
    setIsSavingCycleSchedule(true);
    try {
      const mergedForm = overrideFields ? { ...cycleScheduleForm, ...overrideFields } : cycleScheduleForm;
      const { naturalDays, businessDays } = calcScheduleDays(
        mergedForm.startDate,
        mergedForm.endDate,
        mergedForm.excludeWeekends,
        mergedForm.holidays
      );
      const schedulePayload = {
        ...mergedForm,
        environment: mergedForm.environment || availableEnvironments[0]?.name || 'QA',
        naturalDays,
        businessDays
      };
      const targetPlanId = selectedCycle.planId || selectedPlanId || null;
      const res = await invoke('saveCycleSchedule', {
        cycleId: selectedCycle.id,
        planId: targetPlanId,
        schedule: schedulePayload
      });
      clearPersistentCache();
      queryClient.invalidateQueries();
      const savedSchedule = res?.schedule || schedulePayload;
      const savedPlanId = res?.planId !== undefined ? res.planId : targetPlanId;
      const savedEnv = savedSchedule.environment || schedulePayload.environment || 'QA';
      setTestCycles(prev => prev.map(c => String(c.id) === String(selectedCycle.id) ? { ...c, schedule: savedSchedule, environment: savedEnv, planId: savedPlanId || c.planId } : c));
      setSelectedCycle(prev => prev ? { ...prev, schedule: savedSchedule, environment: savedEnv, planId: savedPlanId || prev.planId } : prev);
      const isEnvOnlyUpdate = Boolean(overrideFields && Object.keys(overrideFields).length === 1 && overrideFields.environment !== undefined);
      addNotification({
        type: 'success',
        title: isEnvOnlyUpdate ? `Ambiente del Ciclo guardado (${savedEnv})` : 'Propiedades del Ciclo guardadas',
        description: isEnvOnlyUpdate
          ? `Se actualizó el ambiente de ejecución a "${savedEnv}" en las propiedades del ciclo en Jira.`
          : (savedSchedule.startDate && savedSchedule.endDate
            ? `${formatShortDateEs(savedSchedule.startDate)} → ${formatShortDateEs(savedSchedule.endDate)} (${savedSchedule.businessDays}d hábiles · Amb: ${savedEnv})`
            : `Metadatos del ciclo actualizados en Jira (Ambiente: ${savedEnv}).`)
      });
    } catch (e) {
      console.error('Error saving cycle schedule:', e);
      addNotification({ type: 'error', title: 'Error al guardar propiedades del ciclo', description: e.message || String(e) });
    } finally {
      setIsSavingCycleSchedule(false);
    }
  };


  const formatScenarioHtml = (rawHtml) => {
    if (!rawHtml) return '';
    return String(rawHtml)
      .replace(/&lt;&lt;&lt;\s*([^&<>]+?)\s*&gt;&gt;&gt;/g, '<span style="display:inline-block;background:#FAF5FF;color:#6E5DC6;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:600;padding:1px 6px;border-radius:4px;border:1px solid #E9D5FF;font-size:11px;margin:0 2px;">&lt;&lt;&lt;$1&gt;&gt;&gt;</span>')
      .replace(/<<<\s*([^<>]+?)\s*>>>/g, '<span style="display:inline-block;background:#FAF5FF;color:#6E5DC6;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:600;padding:1px 6px;border-radius:4px;border:1px solid #E9D5FF;font-size:11px;margin:0 2px;">&lt;&lt;&lt;$1&gt;&gt;&gt;</span>')
      .replace(/\[([^\[\]<>]{2,45})\](?![^<]*>)/g, '<span style="display:inline-block;background:#EFF6FF;color:#0C66E4;font-weight:600;padding:1px 6px;border-radius:4px;border:1px solid #BFDBFE;font-size:11px;margin:0 2px;">[$1]</span>');
  };

  const handleToggleExecutionTest = async (testId, forceOpen = false) => {
    if (!forceOpen && String(expandedExecutionTest) === String(testId)) {
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
              const mergedIterations = mergeIterationsPreservingLocal(t.iterations, fullExec?.iterations);

              const mergedEvidences = (fullExec?.evidences && fullExec.evidences.length > 0)
                ? fullExec.evidences
                : (t.evidences && t.evidences.length > 0 ? t.evidences : (fullExec?.evidences || []));

              const mergedBugs = (fullExec?.linkedBugs && fullExec.linkedBugs.length > 0)
                ? fullExec.linkedBugs
                : (t.linkedBugs && t.linkedBugs.length > 0 ? t.linkedBugs : (fullExec?.linkedBugs || []));

              const isRunning = !!runningTests[testId];
              const localHasMoreIters = (Array.isArray(t.iterations) ? t.iterations.length : 0) > (Array.isArray(fullExec?.iterations) ? fullExec.iterations.length : 0);
              const preservedStatus = isRunning
                ? 'In Progress'
                : (localHasMoreIters && t.status ? t.status : (fullExec?.status || t.status));

              return {
                ...t,
                ...(fullExec || {}),
                status: preservedStatus,
                iterations: mergedIterations,
                evidences: mergedEvidences,
                linkedBugs: mergedBugs,
                description: desc || fullExec?.description || t.description || null,
                _detailLoaded: true
              };
            }
            return t;
          });
          if (cycleIdStr) {
            perCycleCacheRef.current[cycleIdStr] = updated;
          }
          return updated;
        });
      }
    }
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


  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupProgress, setBackupProgress] = useState(null);

  const handleDownloadFullBackup = async () => {
    if (isBackingUp) return;
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

      // 1. Fetch Structural Data (using fetchAllTestCases so all paginated test cases are included)
      const [fetchedFolders, fetchedPlans, fetchedCycles, fetchedCases] = await Promise.all([
        invoke('getFolders', { projectId: selectedProjectId }).catch(() => []),
        invoke('getTestPlans', { projectId: selectedProjectId, config }).catch(() => []),
        invoke('getTestCycles', { projectId: selectedProjectId, config }).catch(() => []),
        fetchAllTestCases({ folderId: null, projectId: selectedProjectId, config }).catch(() => [])
      ]);

      const resolvedCases = Array.isArray(fetchedCases) ? fetchedCases : (Array.isArray(fetchedCases?.issues) ? fetchedCases.issues : []);
      const casesArray = resolvedCases.length > 0 ? resolvedCases : (testCases || []);
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



  const renderBugSlidePanel = () => {
    if (!selectedBug) return null;
    return (
      <Suspense fallback={null}>
        <BugSlidePanel ctx={{ addNotification, bugAddingVersion, bugAssigneeOpen, bugAssigneeQuery, bugAssigneeResults, bugAssigneeSearching, bugCommentFiles, bugCommentText, bugCustomVersionInput, bugEditingEnv, bugEnvDraft, bugSavingField, bugSubmittingComment, bugUploadingStandalone, formatFileSize, handlePreviewEvidence, inlineAttachmentUrls, selectedBug, selectedBugDetails, selectedBugLoading, selectedProjectId, setBugAddingVersion, setBugAssigneeOpen, setBugAssigneeQuery, setBugAssigneeResults, setBugAssigneeSearching, setBugCommentFiles, setBugCommentText, setBugCustomVersionInput, setBugEditingEnv, setBugEnvDraft, setBugSavingField, setBugSubmittingComment, setBugUploadingStandalone, setReportData, setSelectedBug, setSelectedBugDetails, setUnlinkedBugs }} />
      </Suspense>
    );
  };

  const renderTraceabilityItemSlidePanel = () => {
    if (!selectedTraceabilityItem) return null;
    return (
      <Suspense fallback={null}>
        <TraceabilitySlidePanel ctx={{ formatFileSize, handlePreviewEvidence, inlineAttachmentUrls, loadTestCaseDetails, openTraceabilityItemModal, projectConfig, reportData, requirementsMap, selectedTraceabilityDetails, selectedTraceabilityItem, selectedTraceabilityLoading, setModalDetailTab, setSelectedBug, setSelectedTestCase, setSelectedTraceabilityItem, testCases, testCycles, testPlans, traceabilityHierarchy }} />
      </Suspense>
    );
  };

  const renderPlanningTab = () => (
    <Suspense fallback={<TestPulseLoader size={110} text="Cargando módulo de Planning..." />}>
      <PlanningView ctx={{ activeCycleIdRef, addNotification, addingProgress, availableEnvironments, calcScheduleDays, cycleScheduleForm, cycleTests, deferredSearchQuery, deletedIdsRef, filteredTestCycles, findTc, folderPaths, formatShortDateEs, getExecVal, groupByFolder, handleAddTestToCycle, handleCreateIssue, handleCycleSelect, handleLinkCycleToPlan, handleRemoveManyFromCycle, handleRemoveTestFromCycle, handleSaveCycleSchedule, handleSavePlanSchedule, handleUnlinkCycleFromPlan, isAddingAll, isAdmin, isCycleInPlan, isCycleScheduleOpen, isFolderSidebarVisible, isLoadingCycleTests, isPlanCalendarOpen, isResizing, isSavingCycleSchedule, isSavingPlanSchedule, isSectionCollapsed, loading, newHolidayDate, newHolidayDesc, perCycleCacheRef, perCycleDeletedRef, planScheduleForm, planningAvailVisible, planningChecked, planningCycleSearch, planningCycleVisible, planningExecutionType, planningFolder, planningPlanSearch, planningPriority, planningShowAllCycles, projectConfig, renderGroupToolbar, renderGroupedList, renderSectionChevron, safeSetCycleTests, selectedCycle, selectedPlanId, selectedProjectId, selectedTestsForCycle, setActiveTab, setAddingProgress, setCycleScheduleForm, setCycleTests, setIsAddingAll, setIsCycleScheduleOpen, setIsPlanCalendarOpen, setIsResizing, setNewHolidayDate, setNewHolidayDesc, setPlanScheduleForm, setPlanningAvailVisible, setPlanningChecked, setPlanningCycleVisible, setPlanningExecutionType, setPlanningFolder, setPlanningPlanSearch, setPlanningPriority, setPlanningShowAllCycles, setSelectedCycle, setSelectedPlanId, setSelectedTestsForCycle, setTestCycles, setTestPlans, showConfirm, sidebarWidth, testCases, testCycles, testPlans, toggleFolderSidebar }} />
    </Suspense>
  );

  const renderExecutionTab = () => (
    <Suspense fallback={<TestPulseLoader size={110} text="Cargando módulo de Execution..." />}>
      <ExecutionView ctx={{ _uid, _uname, addNotification, availableEnvironments, calcScheduleDays, cycleScheduleForm, cycleTests, deferredExecutionSearch, execFolderFilter, execTesterFilter, execTesterFilterSource, executionChecked, executionCurrentPage, executionPageSize, executionSearchQuery, executionSortBy, executionStatusFilter, executionTestDetails, expandedExecutionTest, filteredTestCycles, findTc, folderPaths, formatScenarioHtml, formatShortDateEs, getExecVal, getStatusColor, getStatusTextColor, groupByFolder, groupToolBtnStyle, handleAddIteration, handleCaptureScreen, handleCreateIssue, handleCycleSelect, handleDeleteEvidence, handleDeleteIteration, handleIterationChange, handleOpenQrCapture, handlePreviewEvidence, handleRenameEvidence, handleRunTest, handleStopExecution, handleToggleExecutionTest, handleUpdateTestStatus, handleUploadEvidence, isAdmin, isCycleInPlan, isFolderSidebarVisible, isLoadingCycleTests, isResizing, isTestMine, isTestUnassigned, matchesFolder, matchesTester, mergeIterationsPreservingLocal, myAccountId, openAssignModal, planCyclesSummary, planScheduleForm, renderGroupToolbar, renderGroupedList, runningTests, selectedCycle, selectedPlanId, setActiveTab, setExecFolderFilter, setExecTesterFilter, setExecTesterFilterSource, setExecutionChecked, setExecutionCurrentPage, setExecutionPageSize, setExecutionSearchQuery, setExecutionSortBy, setExecutionStatusFilter, setExpandedExecutionTest, setIsResizing, setRefreshTrigger, setSelectedCycle, setSelectedPlanId, sidebarWidth, testCycles, testPlans, toggleFolderSidebar }} />
    </Suspense>
  );

  const renderReportsTab = () => (
    <Suspense fallback={<TestPulseLoader size={110} text="Cargando métricas y tableros de Reports..." />}>
      <ReportsView ctx={{ addNotification, availableEnvironments, calcScheduleDays, circuitBreakerActive, context, dashboardBugSearch, dashboardCycleBugFilter, dashboardGeneralBugSearch, dashboardGeneralBugStatusTab, dashboardSubView, dashboardTraceabilitySearch, dashboardWidgets, draggedWidgetIndex, executiveReportBuild, executiveReportContainerRef, executiveReportModalOpen, executiveReportNotes, executiveReportSubject, expandedTraceabilityEpics, findTc, folderPaths, folders, formatShortDateEs, getExecVal, handleAddWidget, handleConfirmLinkUnlinkedBug, handleDragOver, handleDragStart, handleDrop, handleMoveWidget, handleRemoveWidget, handleRemoveWidgetByType, handleResetDashboardLayout, handleSaveDashboardLayout, handleToggleWidgetWidth, isCustomizingDashboard, isCycleInPlan, isFolderSidebarVisible, isHydratingReport, isLinkingUnlinkedBugLoading, isRefreshingReport, isResizing, linkingUnlinkedBug, loadReportData, openTraceabilityItemModal, perCycleCacheRef, planScheduleForm, projectConfig, projects, reportAutomationConfig, reportData, reportLoading, reportSelectedCycles, reportSelectedPlans, reportSelectedVersions, requirementsMap, runsCycleCarouselRef, runsPlanDropdownOpen, selectedDashboardSeverityFilter, selectedPlanId, selectedProjectId, setDashboardBugSearch, setDashboardCycleBugFilter, setDashboardGeneralBugSearch, setDashboardGeneralBugStatusTab, setDashboardSubView, setDashboardTraceabilitySearch, setExecutiveReportBuild, setExecutiveReportModalOpen, setExecutiveReportNotes, setExecutiveReportSubject, setExpandedTraceabilityEpics, setIsCustomizingDashboard, setIsResizing, setLinkingUnlinkedBug, setReportAutomationLastDispatch, setReportAutomationTesting, setReportSelectedCycles, setReportSelectedPlans, setRunsPlanDropdownOpen, setSelectedBug, setSelectedDashboardSeverityFilter, setShowAddWidgetModal, setShowUnlinkedBugsModal, setTargetCycleForBug, setTargetTestForBug, showAddWidgetModal, showUnlinkedBugsModal, sidebarWidth, targetCycleForBug, targetTestForBug, testCases, testCycles, testPlans, toggleFolderSidebar, traceabilityHierarchy, traceabilityHierarchyLoading, unlinkedBugs }} />
    </Suspense>
  );

  const renderConfigTab = () => (
    <Suspense fallback={<TestPulseLoader size={110} text="Cargando Configuración..." />}>
      <SettingsView ctx={{ DEFAULT_EXECUTION_ENVIRONMENTS, addNotification, availableEnvironments, editingEnvDesc, editingEnvId, editingEnvName, handleResyncCycleRuns, handleSaveConfig, handleUpdateEnvironmentsCatalog, isAdmin, isProjectAllowed, isSavingConfig, isSavingEnvCatalog, linkTypes, loadReportAutomationConfig, newEnvDesc, newEnvName, projectConfig, projectIssueTypes, projects, reportAutomationConfig, resyncCycleId, resyncProgress, resyncResult, resyncRunning, selectedProjectId, setAllowedProjects, setEditingEnvDesc, setEditingEnvId, setEditingEnvName, setIsProjectAllowed, setNewEnvDesc, setNewEnvName, setProjectConfig, setResyncCycleId, setResyncResult, setShowReportAutomationModal, snapshotFieldMap, testCycles }} />
    </Suspense>
  );

  const renderReportAutomationModal = () => {
    if (!showReportAutomationModal) return null;
    return (
      <Suspense fallback={null}>
        <ReportAutomationModal ctx={{ addNotification, context, handleGlobalTestAutomatedReportDispatch, projects, reportAutomationActiveTab, reportAutomationConfig, reportAutomationLastDispatch, reportAutomationLoading, reportAutomationTesting, saveReportAutomationConfigHandler, selectedProjectId, setReportAutomationActiveTab, setReportAutomationConfig, setShowReportAutomationModal, showReportAutomationModal }} />
      </Suspense>
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
      {renderTraceabilityItemSlidePanel()}
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
          {renderAssignModal()}
          {activeTab === 'reports' && renderReportsTab()}
          {activeTab === 'config' && isAdmin && renderConfigTab()}
        </>
      )}
      {renderModal()}
      {renderSlidePanel()}
      {previewModalData && (
        <div className="modal-overlay" style={{zIndex: 9999}} onClick={() => {
          setPreviewModalData(null);
        }}>
          <div className="modal-content glass" style={{width: '92%', height: '90%', maxWidth: '1200px', display: 'flex', flexDirection: 'column'}} onClick={(e) => e.stopPropagation()}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '12px'}}>
              <h2 style={{margin: 0, fontSize: '1.15rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center', gap: '8px'}}>
                <span>{(previewModalData.isPdf || /\.pdf$/i.test(previewModalData.filename || '')) ? '📄' : (previewModalData.isVideo || previewModalData.filename?.match(/\.(mp4|mov|webm)$/i) ? '🎥' : '📷')}</span>
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
              ) : (previewModalData.isPdf || /\.pdf$/i.test(previewModalData.filename || '')) ? (
                <PdfDocumentPreview
                  byteArray={previewModalData.byteArray}
                  blobUrl={previewModalData.blobUrl}
                  filename={previewModalData.filename}
                />
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

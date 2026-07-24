import {
  formatLineRange,
  formatLineReference,
  hashFromLines,
  lineFromGutterPoint,
  parseLineHash,
  sourceLinesFromMarkdown,
  shouldClearLineSelection,
} from "./line-selection.js";
import {
  addAgentContextItem,
  agentContextItemLabel,
  agentContextScopeKey,
  createAgentContextItem,
  formatAgentContextMarkdown,
  readAgentContextItems,
  removeAgentContextItem,
  writeAgentContextItems,
} from "./agent-context.js";
import {
  DOCUMENT_OUTLINE_MAX_WIDTH,
  DOCUMENT_OUTLINE_MIN_WIDTH,
  clampDocumentOutlineWidth,
  clampSidebarWidth,
  documentOutlineWidthFromStorageValue,
  sidebarCollapsedFromStorageValue,
  sidebarWidthFromStorageValue,
} from "./layout.js";
import { createOverflowTooltip } from "./overflow-tooltip.js";
import { attachHorizontalPointerResize } from "./pointer-resize.js";
import {
  activeOutlineIdForSourceLine,
  createOutlineClickViewportGuard,
  outlineItemsFromHeadings,
} from "./outline.js";
import { hasTreeChanged } from "./tree-refresh.js";
import { shouldReplaceDocumentHtml } from "./document-refresh.js";
import { attachChartTooltips } from "./chart-tooltip.js";
import {
  sourceLineFromPreviewScroll,
  shouldIgnoreWatchedChange,
  sourceLineForPreviewSync,
  syncLabelForState,
} from "./source-sync.js";
import {
  clampSourcePreviewRatio,
  sourcePreviewRatioFromStorageValue,
} from "./source-split.js";
import {
  modeFromStorageValue,
  readModePreference,
  writeModePreference,
} from "./mode-preference.js";
import {
  nextTheme,
  readThemePreference,
  writeThemePreference,
} from "./theme-preference.js";
import {
  DEFAULT_USER_PREFERENCES,
  LEGACY_USER_PREFERENCES,
  effectiveColorScheme,
  normalizeUserPreferences,
  shouldRebuildFileTreeForPreferences,
} from "./settings-preferences.js";
import { filterWorkbenchFileTree } from "./file-tree-visibility.js";
import {
  closeDocumentTab,
  closeDocumentTabsToRight,
  closeOtherDocumentTabs,
  openDocumentTab,
  reorderDocumentTabs,
  shouldSkipTreeDocumentLoad,
  tabTitleFromPath,
} from "./document-tabs.js";
import {
  normalizeWorkbenchSessions,
  serializeWorkbenchSession,
  workbenchSessionForLaunch,
  workbenchSessionForRepo,
} from "./workbench-session.js";
import { KEYBOARD_SHORTCUT_GROUPS } from "./keyboard-shortcuts.js";
import {
  findTextRanges,
  nextSearchIndex,
} from "./document-search.js";
import {
  GIT_LEAF_HELP_SECTIONS,
  FILE_TYPE_HELP_ROWS,
} from "./help-content.js";
import { completeWorkbenchStartup } from "./workbench-startup.js";
import {
  fileMatchesTextFilter,
  fileMatchesFrontmatterFilters,
  normalizeFrontmatterFilters,
} from "./frontmatter-filters.js";
import {
  addFrontmatterFieldToSource,
  deleteFrontmatterLineFromSource,
  frontmatterKeysFromSource,
  frontmatterLineForValue,
} from "./frontmatter-edit.js";
import { hasGitChangesChanged } from "./git-sync-ui.js";
import { sidebarUpdateView } from "./update-ui.js";
import {
  normalizeTreeDirectoryStates,
  serializeTreeDirectoryState,
  shouldRecordTreeDirectoryToggle,
  shouldOpenTreeDirectory,
  treeAncestorDirectories,
  treeDirectoryPath,
  treeDirectoryStatesFromPreference,
  treeDirectoryStateScope,
} from "./tree-state.js";
import {
  createSourceEditor,
  imageLineAttributes,
  imageLineForAction,
  normalizeImageAlign,
  normalizeImageCaption,
  normalizeImageWidth,
} from "./source-editor.bundle.js";
import {
  flushRendererTelemetry,
  recordTelemetryFeature,
  setTelemetryMode,
} from "./telemetry.js";
import {
  attachImageLoadState,
  enhanceImageLoadStates,
} from "./image-preview.js";

const SIDEBAR_WIDTH_STORAGE_KEY = "git-leaf-sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "git-leaf-sidebar-collapsed";
const DOCUMENT_OUTLINE_COLLAPSED_STORAGE_KEY = "git-leaf-document-outline-collapsed";
const DOCUMENT_OUTLINE_WIDTH_STORAGE_KEY = "git-leaf-document-outline-width";
const SOURCE_SPLIT_STORAGE_KEY = "git-leaf-source-preview-ratio";
const TREE_DIRECTORY_STORAGE_KEY = "git-leaf-tree-directories";
const WORKBENCH_SESSION_STORAGE_KEY = "git-leaf-workbench-sessions";
const SIDEBAR_WIDTH_STEP = 24;
const DOCUMENT_OUTLINE_WIDTH_STEP = 24;
const SOURCE_SPLIT_STEP = 5;
const TREE_REFRESH_INTERVAL_MS = 5000;
const SOURCE_SYNC_DELAY_MS = 500;
const GIT_STATUS_REFRESH_DELAY_MS = 800;
const TOOL_STATUS_CHECK_INTERVAL_MS = 30_000;
const TOOL_RESTART_WAIT_INTERVAL_MS = 150;
const TOOL_RESTART_WAIT_TIMEOUT_MS = 5_000;
const EDITING_TELEMETRY_INTERVAL_MS = 5 * 60 * 1000;
const DOCUMENT_SEARCH_MATCH_HIGHLIGHT = "git-leaf-document-search-match";
const DOCUMENT_SEARCH_ACTIVE_HIGHLIGHT = "git-leaf-document-search-active";
const OUTLINE_CONTENT_NAVIGATION_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);
const initialSearchParams = new URLSearchParams(window.location.search);
const initialDesktopPreferences = readInitialDesktopPreferences();
const initialLegacyThemeMigrationPending =
  initialDesktopPreferences?.legacyThemeMigrationPending === true;
const initialUserPreferences = normalizeUserPreferences(
  initialDesktopPreferences
    ? {
        ...initialDesktopPreferences,
        ...(initialLegacyThemeMigrationPending
          ? { colorMode: readThemePreference() }
          : {}),
      }
    : { theme: readThemePreference() },
  {
    defaults: initialDesktopPreferences ? DEFAULT_USER_PREFERENCES : LEGACY_USER_PREFERENCES,
  },
);
const systemColorSchemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
const initialWorkbenchSessions = readWorkbenchSessions({ preferences: initialDesktopPreferences });
const initialRepoId = initialSearchParams.get("repo") ||
  (initialSearchParams.has("file") ? window.GIT_LEAF_INITIAL_REPO : null) ||
  window.GIT_LEAF_INITIAL_REPO;
const initialWorktreeId = window.GIT_LEAF_WORKTREE_ID || initialRepoId;
const requestedInitialFile = initialSearchParams.get("file") || window.GIT_LEAF_INITIAL_FILE;
const initialWorkbenchSession = workbenchSessionForLaunch(
  initialWorkbenchSessions,
  initialWorktreeId,
  requestedInitialFile,
);
const initialFile = initialWorkbenchSession?.activeTabPath || requestedInitialFile;
const initialDocumentTabs = initialWorkbenchSession
  ? initialWorkbenchSession.tabs
  : initialFile
    ? [{ path: initialFile }]
    : [];
let fileSearchTelemetryActive = false;
let documentSearchTelemetryActive = false;
let lastEditingTelemetryAt = 0;
const outlineClickViewportGuard = createOutlineClickViewportGuard();

const state = {
  tree: [],
  currentRepo: initialRepoId,
  currentWorktreeId: initialWorktreeId,
  worktrees: [],
  canSwitchWorktrees: false,
  currentFile: initialFile,
  currentDocument: null,
  documentTabs: initialDocumentTabs,
  activeTabPath: initialFile || "",
  canEdit: window.GIT_LEAF_CAN_EDIT !== false,
  currentRepoBranch: "main",
  currentRepoDetached: false,
  currentRepoCanEdit: window.GIT_LEAF_CAN_EDIT !== false,
  repositories: [],
  mode: readModePreference({ preferences: initialDesktopPreferences }),
  colorMode: initialUserPreferences.colorMode,
  theme: effectiveColorScheme(initialUserPreferences.colorMode, {
    systemDark: systemColorSchemeQuery?.matches === true,
  }),
  documentFont: initialUserPreferences.documentFont,
  documentFontSize: initialUserPreferences.documentFontSize,
  fileTreeMode: initialUserPreferences.fileTreeMode,
  sidebarCollapsed: false,
  documentOutlineCollapsed: false,
  desktopPreferences: initialDesktopPreferences ?? {},
  desktopPreferencesAvailable: initialDesktopPreferences !== null,
  filter: "",
  selectedLines: new Set(),
  selectionAnchor: null,
  agentContextItems: [],
  agentContextLoadedScopeKey: "",
  activeAgentContextItemId: "",
  activeImage: null,
  activeLink: null,
  activeFrontmatterField: null,
  statusTimer: null,
  treeTimer: null,
  watchStream: null,
  sourceEditor: null,
  sourceSyncTimer: null,
  sourceWriteInFlight: false,
  scrollSyncSource: null,
  lastSourceVisibleLine: null,
  lastPreviewVisibleLine: null,
  selectionPopoverFrame: null,
  listSourceLineGutterFrame: null,
  lastWrittenHash: null,
  outlineItems: [],
  copyToastTimer: null,
  frontmatterAllowedKeys: [],
  frontmatterFilters: [],
  frontmatterFacets: null,
  frontmatterFiles: {},
  frontmatterActiveKey: "domain",
  frontmatterFacetsLoading: false,
  gitChanges: [],
  showOnlyGitChanges: false,
  gitStatusTimer: null,
  lastToolStatusCheckAt: 0,
  toolRestartInFlight: false,
  toolFingerprint: "",
  treeDirectoryStates: readTreeDirectoryStates({ preferences: initialDesktopPreferences }),
  expandedTreeDirectories: new Set(),
  collapsedTreeDirectories: new Set(),
  workbenchSessions: initialWorkbenchSessions,
  workbenchSessionTimer: null,
  pendingWorkbenchTreeViewportRestore: Boolean(initialWorkbenchSession),
  lastTreeFocus: initialWorkbenchSession?.treeFocus ?? null,
  documentTabTooltipTimer: null,
  documentTabTooltipPendingPath: "",
  documentTabTooltipPath: "",
  documentSearchQuery: "",
  documentSearchMatches: [],
  documentSearchIndex: -1,
  documentSearchReturnFocus: null,
  fileActionTarget: null,
  documentTabPointerDrag: null,
  activeDialog: null,
};

const appShell = document.querySelector("#app-shell");
const workbenchLoading = document.querySelector("#workbench-loading");
const previewPane = document.querySelector(".preview-pane");
const sidebar = document.querySelector(".sidebar");
const workspaceSidebarHeader = document.querySelector("#workspace-sidebar-header");
const fileTree = document.querySelector("#file-tree");
const repositoryTitle = document.querySelector("#repository-title");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const historyBackButton = document.querySelector("#history-back");
const historyForwardButton = document.querySelector("#history-forward");
const documentTabs = document.querySelector("#document-tabs");
const documentNewButton = document.querySelector("#document-new");
const documentTabTooltip = document.querySelector("#document-tab-tooltip");
const floatingDocumentActions = document.querySelector("#floating-document-actions");
const copyShareLinkButton = document.querySelector("#copy-share-link");
const documentActionsMore = document.querySelector("#document-actions-more");
const emptyNewDocument = document.querySelector("#empty-new-document");
const fileActionMenu = document.querySelector("#file-action-menu");
const documentBody = document.querySelector("#document-body");
const documentOutline = document.querySelector("#document-outline");
const documentOutlineResizer = document.querySelector("#document-outline-resizer");
const documentOutlineToggle = document.querySelector("#document-outline-toggle");
const documentWorkspace = document.querySelector("#document-workspace");
const documentContent = document.querySelector("#document-content");
const documentEmptyState = document.querySelector("#document-empty-state");
const sourceSplitter = document.querySelector("#source-splitter");
const sourceEditorPane = document.querySelector("#source-editor-pane");
const sourceEditorHost = document.querySelector("#source-editor");
const treeFilter = document.querySelector("#tree-filter");
const overflowTooltip = document.querySelector("#overflow-tooltip");
const worktreeSwitcher = document.querySelector("#worktree-switcher");
const worktreeSwitcherToggle = document.querySelector("#worktree-switcher-toggle");
const worktreeSwitcherMenu = document.querySelector("#worktree-switcher-menu");
const worktreeCurrentName = document.querySelector("#worktree-current-name");
const worktreeCurrentBranch = document.querySelector("#worktree-current-branch");
const branchStatus = document.querySelector("#branch-status");
const frontmatterFilterToggle = document.querySelector("#frontmatter-filter-toggle");
const frontmatterActiveFilters = document.querySelector("#frontmatter-active-filters");
const frontmatterFilterPopover = document.querySelector("#frontmatter-filter-popover");
const gitChangeToolbar = document.querySelector("#git-change-toolbar");
const gitChangesToggle = document.querySelector("#git-changes-toggle");
const gitChangeCount = document.querySelector("#git-change-count");
const gitSyncOpen = document.querySelector("#git-sync-open");
const gitSyncPanel = document.querySelector("#git-sync-panel");
const gitSyncClose = document.querySelector("#git-sync-close");
const gitSyncResult = document.querySelector("#git-sync-result");
const gitSyncResultTitle = document.querySelector("#git-sync-result-title");
const gitSyncResultHelp = document.querySelector("#git-sync-result-help");
const gitSyncAgentPrompt = document.querySelector("#git-sync-agent-prompt");
const gitSyncCopyPrompt = document.querySelector("#git-sync-copy-prompt");
const desktopUpdatePanel = document.querySelector("#desktop-update-panel");
const desktopUpdateTitle = document.querySelector("#desktop-update-title");
const desktopUpdateDetail = document.querySelector("#desktop-update-detail");
const desktopUpdateAction = document.querySelector("#desktop-update-action");
const appDialog = document.querySelector("#app-dialog");
const appDialogCard = document.querySelector("#app-dialog-card");
const appDialogTitle = document.querySelector("#app-dialog-title");
const appDialogMessage = document.querySelector("#app-dialog-message");
const appDialogContent = document.querySelector("#app-dialog-content");
const appDialogInputWrap = document.querySelector("#app-dialog-input-wrap");
const appDialogInputLabel = document.querySelector("#app-dialog-input-label");
const appDialogInput = document.querySelector("#app-dialog-input");
const appDialogFields = document.querySelector("#app-dialog-fields");
const appDialogClose = document.querySelector("#app-dialog-close");
const appDialogCancel = document.querySelector("#app-dialog-cancel");
const appDialogConfirm = document.querySelector("#app-dialog-confirm");
const appDialogActions = document.querySelector("#app-dialog-actions");
const sidebarResizer = document.querySelector("#sidebar-resizer");
const selectionPopover = document.querySelector("#selection-popover");
const copySelectionPopover = document.querySelector("#copy-selection-popover");
const addSelectionAgentContext = document.querySelector("#add-selection-agent-context");
const agentContextWidget = document.querySelector("#agent-context-widget");
const agentContextPopover = document.querySelector("#agent-context-popover");
const agentContextToggle = document.querySelector("#agent-context-toggle");
const agentContextToggleCount = document.querySelector("#agent-context-toggle-count");
const agentContextClose = document.querySelector("#agent-context-close");
const agentContextList = document.querySelector("#agent-context-list");
const agentContextEmpty = document.querySelector("#agent-context-empty");
const agentContextClear = document.querySelector("#agent-context-clear");
const agentContextCopy = document.querySelector("#agent-context-copy");
const imagePopover = document.querySelector("#image-popover");
const linkPopover = document.querySelector("#link-popover");
const frontmatterFieldPopover = document.querySelector("#frontmatter-field-popover");
const copyToast = document.querySelector("#copy-toast");
const documentSearch = document.querySelector("#document-search");
const documentSearchInput = document.querySelector("#document-search-input");
const documentSearchCount = document.querySelector("#document-search-count");
const documentSearchPrevious = document.querySelector("#document-search-previous");
const documentSearchNext = document.querySelector("#document-search-next");
const documentSearchClose = document.querySelector("#document-search-close");
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const themeToggle = document.querySelector("#theme-toggle");
const chartTooltipController = attachChartTooltips(documentContent);
const sourceChartTooltipController = attachChartTooltips(sourceEditorHost);
const overflowTooltipController = createOverflowTooltip({
  tooltip: overflowTooltip,
  boundsElement: appShell,
  isBlocked: () => !gitSyncPanel.hidden || !appDialog.hidden,
  sources: [
    {
      name: "file-tree",
      container: fileTree,
      itemFromTarget: treeItemFromEventTarget,
      labelElement: treeItemLabelElement,
      details: treeItemTooltipDetails,
      key: treeItemTooltipKey,
    },
    {
      name: "document-outline",
      container: documentOutline,
      itemFromTarget: outlineItemFromEventTarget,
      details: outlineItemTooltipDetails,
      key: (item) => item.dataset.outlineTarget,
    },
  ],
});
attachHorizontalPointerResize({
  resizer: documentOutlineResizer,
  classTarget: documentBody,
  activeClass: "is-outline-resizing",
  onResize: setDocumentOutlineWidthFromPointer,
});

if (!canEditCurrentRepo() && isEditingModeName(state.mode)) {
  state.mode = "preview";
}
applyEditCapability();
applyAppearancePreferences(initialUserPreferences);
applyShortcutTooltips();

sidebarResizer.addEventListener("pointerdown", startSidebarResize);
sidebarResizer.addEventListener("keydown", handleSidebarResizeKeydown);
documentOutlineResizer.addEventListener("keydown", handleDocumentOutlineResizeKeydown);
sidebarToggle.addEventListener("click", () => runAppShortcut("toggle-sidebar"));
historyBackButton.addEventListener("click", () => runAppShortcut("history-back"));
historyForwardButton.addEventListener("click", () => runAppShortcut("history-forward"));
sourceSplitter.addEventListener("pointerdown", startSourceSplitResize);
sourceSplitter.addEventListener("keydown", handleSourceSplitKeydown);
fileTree.addEventListener("keydown", handleFileTreeKeydown);
fileTree.addEventListener("focusin", handleFileTreeFocusIn);
fileTree.addEventListener("scroll", scheduleWorkbenchSessionPersist);
fileTree.addEventListener("contextmenu", handleFileTreeContextMenu);
documentTabs.addEventListener("wheel", handleDocumentTabsWheel, { passive: false });
documentTabs.addEventListener("contextmenu", handleDocumentTabContextMenu);
documentNewButton.addEventListener("click", () => promptNewDocument(newDocumentLocationFromCurrent()));
emptyNewDocument.addEventListener("click", () => promptNewDocument({ directoryPath: "" }));
documentActionsMore.addEventListener("click", showCurrentDocumentActionsMenu);
fileActionMenu.addEventListener("click", handleFileActionMenuClick);
worktreeSwitcherToggle.addEventListener("click", toggleWorktreeSwitcher);
worktreeSwitcherMenu.addEventListener("click", handleWorktreeSelection);
documentOutline.addEventListener("click", handleOutlineClick);
copySelectionPopover.addEventListener("click", copyCurrentLineReference);
addSelectionAgentContext.addEventListener("click", addCurrentSelectionToAgentContext);
agentContextToggle.addEventListener("click", toggleAgentContextPopover);
agentContextClose.addEventListener("click", closeAgentContextPopoverAndRestoreFocus);
agentContextList.addEventListener("click", handleAgentContextListClick);
agentContextClear.addEventListener("click", clearAgentContextItems);
agentContextCopy.addEventListener("click", copyAgentContext);
imagePopover.addEventListener("click", handleImagePopoverClick);
linkPopover.addEventListener("click", handleLinkPopoverClick);
frontmatterFieldPopover.addEventListener("click", handleFrontmatterFieldPopoverClick);
frontmatterFieldPopover.addEventListener("change", handleFrontmatterFieldPopoverChange);
frontmatterFilterToggle.addEventListener("click", toggleFrontmatterFilterPopover);
frontmatterActiveFilters.addEventListener("click", handleActiveFrontmatterFilterClick);
frontmatterFilterPopover.addEventListener("click", handleFrontmatterFilterPopoverClick);
gitChangesToggle.addEventListener("click", toggleGitChangesFilter);
gitSyncOpen.addEventListener("click", submitGitSync);
gitSyncClose.addEventListener("click", closeGitSyncPanel);
gitSyncPanel.addEventListener("click", handleGitSyncPanelBackdropClick);
gitSyncCopyPrompt.addEventListener("click", copyGitSyncAgentPrompt);
desktopUpdateAction.addEventListener("click", requestDesktopUpdateInstall);
themeToggle.addEventListener("click", toggleWebTheme);
documentOutlineToggle.addEventListener("click", toggleDocumentOutline);
appDialog.addEventListener("click", handleAppDialogBackdropClick);
appDialog.addEventListener("keydown", handleAppDialogKeydown);
appDialogClose.addEventListener("click", () => closeAppDialog(false));
appDialogCancel.addEventListener("click", () => closeAppDialog(false));
appDialogConfirm.addEventListener("click", () => closeAppDialog(true));
appDialogInput.addEventListener("keydown", handleAppDialogInputKeydown);
documentSearchInput.addEventListener("input", handleDocumentSearchInput);
documentSearchInput.addEventListener("keydown", handleDocumentSearchKeydown);
documentSearchPrevious.addEventListener("click", () => moveDocumentSearch(-1));
documentSearchNext.addEventListener("click", () => moveDocumentSearch(1));
documentSearchClose.addEventListener("click", () => closeDocumentSearch());
document.addEventListener("click", handleDocumentChromeClick);
document.addEventListener("focusin", handleAgentContextFocusIn);
document.addEventListener("pointerdown", handleToolStatusActivity);
document.addEventListener("wheel", handleOutlineContentNavigationIntent, { capture: true, passive: true });
document.addEventListener("pointerdown", handleOutlineContentNavigationIntent, true);
document.addEventListener("touchstart", handleOutlineContentNavigationIntent, { capture: true, passive: true });
document.addEventListener("keydown", handleAppShortcutKeydown, true);
document.addEventListener("keydown", handleDocumentKeydown, true);
document.addEventListener("keydown", handleOutlineContentNavigationIntent, true);
document.addEventListener("keydown", handleToolStatusActivity);
window.addEventListener("git-leaf-desktop-shortcut", handleDesktopShortcutEvent);
window.addEventListener("git-leaf-desktop-update-status", handleDesktopUpdateStatusEvent);
window.addEventListener("git-leaf-desktop-preferences", handleDesktopPreferencesEvent);
window.addEventListener("focus", handleToolStatusActivity);
window.addEventListener("focus", refreshWorktreesOnWindowFocus);
window.addEventListener("resize", positionFrontmatterFilterPopover);
window.addEventListener("resize", positionWorktreeSwitcherMenu);
window.addEventListener("resize", scheduleListSourceLineGutterSync);
window.addEventListener("resize", closeFileActionMenu);
window.addEventListener("pagehide", flushWorkbenchSessionPreference);
window.addEventListener("pagehide", () => {
  void flushRendererTelemetry();
});
systemColorSchemeQuery?.addEventListener?.("change", handleSystemColorSchemeChange);
if (initialLegacyThemeMigrationPending) {
  persistAppPreference("colorMode", initialUserPreferences.colorMode);
}
document.addEventListener("visibilitychange", handleToolStatusVisibilityChange);
for (const button of modeButtons) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}
window.gitLeafPreparePdfExport = preparePdfExport;
window.gitLeafFinishPdfExport = finishPdfExport;
copyShareLinkButton.addEventListener("click", copyCurrentShareLink);
documentContent.addEventListener("click", handleDocumentClick);
documentContent.addEventListener("keydown", handlePreviewContentKeydown);
documentContent.addEventListener("scroll", () => {
  const previewLine = currentPreviewVisibleLine();
  if (Number.isInteger(previewLine)) {
    state.lastPreviewVisibleLine = previewLine;
  }
  chartTooltipController.hide();
  sourceChartTooltipController.hide();
  scheduleSelectionPopoverPosition();
  positionImagePopover();
  positionLinkPopover();
  positionFrontmatterFieldPopover();
  window.requestAnimationFrame(() => {
    syncSourceScrollFromPreview(previewLine);
    updateActiveOutlineFromContentScroll(activeOutlineIdFromScroll());
  });
});
treeFilter.addEventListener("input", () => {
  state.filter = treeFilter.value.trim().toLowerCase();
  if (state.filter && !fileSearchTelemetryActive) {
    recordTelemetryFeature("navigation.file_search");
    fileSearchTelemetryActive = true;
  } else if (!state.filter) {
    fileSearchTelemetryActive = false;
  }
  renderTree();
  if (
    state.filter.length > 0 &&
    state.frontmatterAllowedKeys.length > 0 &&
    !state.frontmatterFacets
  ) {
    ensureFrontmatterFacets();
  }
});
treeFilter.addEventListener("keydown", handleTreeFilterKeydown);

restoreSidebarWidth();
restoreSidebarCollapsed();
restoreDocumentOutlineWidth();
restoreDocumentOutlineCollapsed();
restoreSourceSplitRatio();
try {
  await loadRepositories();
  await loadWorktrees();
  restoreAgentContextItems();
  renderAgentContext();
  restoreWorkbenchSessionForCurrentRepo({ requestedFile: requestedInitialFile });
  restoreTreeDirectoryState();
  seedInitialTreeDirectoryExpansion();
  await loadTree();
  await loadGitStatus();
  if (state.currentFile) {
    await openFile(state.currentFile);
  } else {
    showNoDocumentSelected();
  }
  setMode(state.mode, { persist: false, focus: false });
  resetTreePolling();
} catch (error) {
  showStartupError(error);
} finally {
  completeWorkbenchStartup({
    root: document.documentElement,
    loadingElement: workbenchLoading,
    requestFrame: window.requestAnimationFrame.bind(window),
    scheduleTimeout: window.setTimeout.bind(window),
  });
}

async function loadRepositories() {
  const response = await fetch(apiUrl("/api/repos"));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "无法读取仓库列表。" }));
    throw new Error(payload.error || "无法读取仓库列表。");
  }

  const payload = await response.json();
  state.repositories = payload.repositories ?? [];
  const current = repositoryById(state.currentRepo) ?? state.repositories[0];
  if (!current) {
    throw new Error("没有可用仓库。");
  }

  state.currentRepo = current.id;
  renderRepositoryHeader(current);
  applyRepositoryStatus(current);
  if (!initialSearchParams.has("file")) {
    state.currentFile = current.defaultFile || state.currentFile;
  }
  renderBranchStatus();
  applyEditCapability();
}

async function loadWorktrees() {
  const response = await fetch(apiUrl("/api/worktrees"), { cache: "no-store" });
  if (!response.ok) {
    worktreeSwitcher.hidden = true;
    repositoryTitle.hidden = false;
    return;
  }

  const payload = await response.json();
  state.worktrees = Array.isArray(payload.worktrees) ? payload.worktrees : [];
  state.currentWorktreeId = payload.currentWorktreeId || state.currentWorktreeId;
  restoreAgentContextItemsForScopeChange();
  state.canSwitchWorktrees = payload.canSwitch === true;
  const current = currentWorktree();
  if (current) {
    state.currentRepoBranch = current.branch || "";
    state.currentRepoDetached = current.detached === true;
    state.currentRepoCanEdit = true;
  }
  renderWorktreeSwitcher();
}

function refreshWorktreesOnWindowFocus() {
  loadWorktrees().catch(() => {});
}

function currentWorktree() {
  return state.worktrees.find((worktree) => worktree.id === state.currentWorktreeId) ||
    state.worktrees.find((worktree) => worktree.current) ||
    null;
}

function renderWorktreeSwitcher() {
  const current = currentWorktree();
  if (!current || state.worktrees.length <= 1) {
    worktreeSwitcher.hidden = true;
    repositoryTitle.hidden = false;
    closeWorktreeSwitcher();
    return;
  }

  repositoryTitle.hidden = true;
  worktreeSwitcher.hidden = false;
  worktreeCurrentName.textContent = worktreeDisplayLabel(current);
  worktreeCurrentBranch.textContent = worktreeBranchLabel(current);
  worktreeSwitcherToggle.disabled = !state.canSwitchWorktrees || state.worktrees.length < 2;
  worktreeSwitcherMenu.replaceChildren(
    ...state.worktrees.map(worktreeOptionElement),
  );
}

function worktreeOptionElement(worktree) {
  const option = document.createElement("button");
  option.type = "button";
  option.className = "worktree-option";
  option.dataset.worktreeId = worktree.id;
  option.disabled = !state.canSwitchWorktrees || worktree.available === false;
  option.setAttribute("role", "option");
  option.setAttribute("aria-selected", String(worktree.id === state.currentWorktreeId));
  const check = document.createElement("span");
  check.className = "worktree-option-check";
  check.textContent = worktree.id === state.currentWorktreeId ? "✓" : "";

  const copy = document.createElement("span");
  copy.className = "worktree-option-copy";
  const title = document.createElement("span");
  title.className = "worktree-option-title";
  title.textContent = worktreeDisplayLabel(worktree);
  const branch = document.createElement("span");
  branch.className = "worktree-option-branch";
  branch.textContent = worktreeBranchLabel(worktree);
  const worktreePath = document.createElement("span");
  worktreePath.className = "worktree-option-path";
  worktreePath.textContent = worktree.displayRoot || worktree.root;
  copy.append(title, branch, worktreePath);
  option.append(check, copy);
  return option;
}

function worktreeDisplayLabel(worktree) {
  const name = worktree?.name || "工作树";
  return worktree?.primary ? name : `Worktree - ${name}`;
}

function worktreeBranchLabel(worktree) {
  if (worktree.branch) {
    return worktree.branch;
  }
  return `无分支 @ ${String(worktree.head || "").slice(0, 7) || "unknown"}`;
}

async function toggleWorktreeSwitcher() {
  if (!worktreeSwitcherMenu.hidden) {
    closeWorktreeSwitcher();
    return;
  }
  await loadWorktrees();
  if (worktreeSwitcher.hidden || worktreeSwitcherToggle.disabled) {
    return;
  }
  worktreeSwitcherMenu.hidden = false;
  worktreeSwitcherToggle.setAttribute("aria-expanded", "true");
  positionWorktreeSwitcherMenu();
}

function positionWorktreeSwitcherMenu() {
  if (worktreeSwitcherMenu.hidden) {
    return;
  }
  const margin = 12;
  const toggleRect = worktreeSwitcherToggle.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  worktreeSwitcherMenu.style.setProperty(
    "--worktree-menu-min-width",
    `${Math.round(toggleRect.width)}px`,
  );
  const width = worktreeSwitcherMenu.getBoundingClientRect().width;
  const left = Math.min(
    Math.max(toggleRect.left, margin),
    Math.max(margin, viewportWidth - width - margin),
  );
  const belowTop = toggleRect.bottom + 6;
  const belowHeight = viewportHeight - belowTop - margin;
  let top = belowTop;
  let maxHeight = Math.min(420, Math.max(180, belowHeight));

  if (belowHeight < 180 && toggleRect.top > belowHeight) {
    const aboveHeight = toggleRect.top - margin - 6;
    maxHeight = Math.min(420, Math.max(180, aboveHeight));
    top = Math.max(margin, toggleRect.top - maxHeight - 6);
  }

  worktreeSwitcherMenu.style.setProperty("--worktree-menu-left", `${Math.round(left)}px`);
  worktreeSwitcherMenu.style.setProperty("--worktree-menu-top", `${Math.round(top)}px`);
  worktreeSwitcherMenu.style.setProperty("--worktree-menu-max-height", `${Math.round(maxHeight)}px`);
}

function closeWorktreeSwitcher() {
  worktreeSwitcherMenu.hidden = true;
  worktreeSwitcherToggle.setAttribute("aria-expanded", "false");
}

function handleWorktreeSelection(event) {
  const option = event.target.closest?.("[data-worktree-id]");
  if (!option || option.disabled) {
    return;
  }
  const worktree = state.worktrees.find((candidate) => candidate.id === option.dataset.worktreeId);
  closeWorktreeSwitcher();
  if (!worktree || worktree.id === state.currentWorktreeId) {
    return;
  }

  flushWorkbenchSessionPreference();
  const action = new URL("git-leaf://open-worktree");
  action.searchParams.set("path", worktree.root);
  window.location.href = action.href;
}

async function loadTree({ force = false } = {}) {
  const response = await fetch(apiUrl("/api/tree"));
  const payload = await response.json();
  const frontmatterAllowedKeys = normalizeFrontmatterAllowedKeys(payload.frontmatterAllowedKeys);
  const frontmatterKeysChanged = !sameStringArray(state.frontmatterAllowedKeys, frontmatterAllowedKeys);
  if (!force && !hasTreeChanged(state.tree, payload.tree) && !frontmatterKeysChanged) {
    return;
  }

  state.tree = payload.tree;
  state.frontmatterAllowedKeys = frontmatterAllowedKeys;
  state.frontmatterFilters = normalizeFrontmatterFilters(
    state.frontmatterFilters,
    state.frontmatterAllowedKeys,
  );
  state.frontmatterFacets = null;
  state.frontmatterFiles = {};
  state.frontmatterActiveKey = nextAvailableFrontmatterKey(state.frontmatterActiveKey);
  renderFrontmatterFilterAvailability();
  renderActiveFrontmatterFilters();
  renderTree();
}

function resetTreePolling() {
  if (state.treeTimer) {
    window.clearInterval(state.treeTimer);
  }
  state.treeTimer = window.setInterval(refreshTreeAndGitStatus, TREE_REFRESH_INTERVAL_MS);
}

async function refreshTreeAndGitStatus() {
  await loadWorktrees();
  await loadTree();
  await loadGitStatus();
}

async function loadGitStatus() {
  const previousGitChanges = state.gitChanges;
  const previousShowOnlyGitChanges = state.showOnlyGitChanges;

  if (!state.canEdit) {
    state.gitChanges = [];
  } else {
    try {
      const response = await fetch(apiUrl("/api/git-status"), { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Unable to load Git status");
      }
      const payload = await response.json();
      applyRepositoryStatus(payload);
      enforceCurrentRepoEditCapability();
      state.gitChanges = payload.changes ?? [];
    } catch {
      state.gitChanges = [];
    }
  }

  if (state.gitChanges.length === 0) {
    state.showOnlyGitChanges = false;
  }
  const gitChangesChanged = hasGitChangesChanged(previousGitChanges, state.gitChanges);
  const gitChangesFilterChanged = previousShowOnlyGitChanges !== state.showOnlyGitChanges;
  if (gitChangesFilterChanged) {
    restoreTreeDirectoryState();
  }
  renderGitChangeToolbar();
  if (gitChangesChanged || gitChangesFilterChanged) {
    renderTree();
  }
}

function scheduleGitStatusRefresh() {
  window.clearTimeout(state.gitStatusTimer);
  state.gitStatusTimer = window.setTimeout(loadGitStatus, GIT_STATUS_REFRESH_DELAY_MS);
}

async function openFile(
  filePath,
  pushState = true,
  {
    repoId = state.currentRepo,
    hash = "",
  } = {},
) {
  if (!filePath) {
    showNoDocumentSelected({ pushState });
    return;
  }

  const hadDocument = Boolean(state.currentDocument);
  const response = await fetch(apiUrl("/api/document", { repo: repoId, file: filePath }));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "加载失败" }));
    const message = payload.error || "加载失败";
    if (hadDocument) {
      showCopyToast(`无法打开目标：${message}`);
    } else {
      showStartupError(new Error(message));
    }
    return false;
  }

  const documentData = await response.json();
  const nextRepoId = documentData.repo || repoId;
  const repoChanged = nextRepoId !== state.currentRepo;
  if (repoChanged) {
    state.documentTabs = [];
    state.activeTabPath = "";
  }
  const repo = repositoryById(nextRepoId);
  state.currentRepo = nextRepoId;
  if (repoChanged) {
    restoreAgentContextItemsForScopeChange();
  }
  if (repoChanged) {
    restoreTreeDirectoryState();
  }
  if (repo) {
    renderRepositoryHeader(repo);
    applyRepositoryStatus(repo);
  }
  applyDocumentData(documentData, {
    pushState,
    resetSelectionFromHash: true,
    applySavedMode: true,
    initialHash: hash,
  });
  renderTree();
  resetStatusPolling();
  resetDocumentWatch();
  return true;
}

function showNoDocumentSelected({ pushState = false } = {}) {
  closeDocumentSearch({ restoreFocus: false });
  state.currentFile = "";
  state.currentDocument = null;
  state.activeTabPath = "";
  state.selectedLines = new Set();
  state.selectionAnchor = null;
  clearActiveImage();
  clearActiveLink();
  clearActiveFrontmatterField();
  setMode("preview", { persist: false, focus: false });
  showNoDocumentSurface();
  documentOutline.hidden = true;
  documentOutlineResizer.hidden = true;
  documentOutlineToggle.hidden = true;
  documentOutline.innerHTML = "";
  state.outlineItems = [];
  updateDocumentActions(false);
  updateLineSelectionUi();
  renderDocumentTabs();
  resetStatusPolling();
  resetDocumentWatch();
  if (state.sourceEditor) {
    state.sourceEditor.setValue("");
    state.sourceEditor.setMode(state.mode);
  }
  if (pushState) {
    const nextUrl = new URL("/", window.location.origin);
    nextUrl.searchParams.set("repo", state.currentRepo);
    window.history.pushState(
      {
        repo: state.currentRepo,
        file: "",
      },
      "",
      `${nextUrl.pathname}${nextUrl.search}`,
    );
  }
  persistWorkbenchSession();
}

function showStartupError(error) {
  closeDocumentSearch({ restoreFocus: false });
  const message = error instanceof Error ? error.message : "加载失败。";
  state.currentDocument = null;
  state.selectedLines = new Set();
  state.selectionAnchor = null;
  hideNoDocumentSurface();
  documentContent.innerHTML = `<p class="error-message">${escapeHtml(message)}</p>`;
  documentOutline.hidden = true;
  documentOutlineResizer.hidden = true;
  documentOutlineToggle.hidden = true;
  documentOutline.innerHTML = "";
  state.outlineItems = [];
  updateDocumentActions(false);
  renderDocumentTabs();
  applyEditCapability();
  updateLineSelectionUi();
}

function showNoDocumentSurface() {
  documentWorkspace.classList.add("is-empty");
  documentEmptyState.hidden = false;
  documentBody.classList.remove("has-outline");
  documentOutline.hidden = true;
  documentOutlineResizer.hidden = true;
  documentOutlineToggle.hidden = true;
  documentOutline.innerHTML = "";
  state.outlineItems = [];
  documentContent.innerHTML = "";
  documentContent.scrollTop = 0;
  sourceSplitter.hidden = true;
  sourceEditorPane.hidden = true;
}

function hideNoDocumentSurface() {
  documentWorkspace.classList.remove("is-empty");
  documentEmptyState.hidden = true;
}

function applyDocumentData(
  documentData,
  {
    pushState = false,
    resetSelectionFromHash = false,
    preserveScroll = false,
    forceReplace = false,
    applySavedMode = false,
    initialHash = "",
  } = {},
) {
  const scrollTop = preserveScroll ? documentContent.scrollTop : 0;
  const shouldReplace = forceReplace || shouldReplaceDocumentHtml(state.currentDocument, documentData);
  state.currentDocument = documentData;
  state.currentFile = documentData.path;
  state.activeTabPath = documentData.path;
  hideNoDocumentSurface();
  state.lastWrittenHash = documentData.sourceHash ?? state.lastWrittenHash;
  updateDocumentActions(true);
  applyRepositoryStatus(documentData);

  if (!isMarkdownDocument(documentData)) {
    state.selectedLines = new Set();
    state.selectionAnchor = null;
  } else if (resetSelectionFromHash) {
    const currentUrl = new URL(window.location.href);
    const hashBelongsToDocument = initialHash || currentUrl.searchParams.get("file") === documentData.path;
    state.selectedLines = new Set(hashBelongsToDocument ? parseLineHash(initialHash || window.location.hash) : []);
    state.selectionAnchor = state.selectedLines.size > 0 ? [...state.selectedLines].at(-1) : null;
  }

  ensureActiveDocumentTab(documentData.path);
  renderBranchStatus();
  applyEditCapability();
  if (applySavedMode) {
    setMode(readModePreference({ preferences: state.desktopPreferences }), {
      persist: false,
      focus: false,
    });
  } else if (!canEditCurrentDocument() && isEditingModeName(state.mode)) {
    setMode("preview", { persist: false, focus: false });
  }

  if (pushState) {
    const initialHash = hashFromLines(state.selectedLines);
    const nextUrl = new URL("/", window.location.origin);
    nextUrl.searchParams.set("repo", state.currentRepo);
    nextUrl.searchParams.set("file", documentData.path);
    nextUrl.hash = initialHash;
    window.history.pushState(
      {
        repo: state.currentRepo,
        file: documentData.path,
      },
      "",
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );
  }

  if (shouldReplace) {
    clearActiveImage();
    clearActiveLink();
    clearActiveFrontmatterField();
    chartTooltipController.hide();
    sourceChartTooltipController.hide();
    renderDocumentContent(documentData);
    if (preserveScroll) {
      documentContent.scrollTop = Math.min(scrollTop, documentContent.scrollHeight);
    }
  }

  if (state.sourceEditor) {
    state.sourceEditor.setValue(canEditDocumentData(documentData) ? documentData.source ?? "" : "");
    state.sourceEditor.setMode(state.mode);
  }

  updateLineSelectionUi();
  if (resetSelectionFromHash) {
    scrollToHashSelectedLine();
  }
  refreshDocumentSearch({ preserveIndex: true, reveal: false });
  persistWorkbenchSession();
}

function setMode(mode, { persist = true, focus = true } = {}) {
  outlineClickViewportGuard.end();
  const previousMode = state.mode;
  const previousSourceLine = currentSourceEditorVisibleLine();
  const previousPreviewLine = currentPreviewVisibleLine();
  let nextMode = modeFromStorageValue(mode);
  if ((!state.currentDocument || !canEditCurrentDocument()) && isEditingModeName(nextMode)) {
    nextMode = "preview";
    persist = false;
  }

  state.mode = nextMode;
  setTelemetryMode(state.mode);
  if (persist && canEditCurrentRepo()) {
    writeModePreference(state.mode);
    persistAppPreference("mode", state.mode);
  }
  const editingMode = isEditorMode();
  previewPane.classList.toggle("is-source-mode", state.mode === "source");
  previewPane.classList.toggle("is-live-mode", state.mode === "live");
  documentBody.hidden = false;
  documentContent.hidden = state.mode === "live";
  sourceSplitter.hidden = state.mode !== "source";
  sourceEditorPane.hidden = !editingMode;
  clearActiveImage();
  clearActiveLink();
  clearActiveFrontmatterField();
  for (const button of modeButtons) {
    const isActive = button.dataset.mode === state.mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  if (editingMode) {
    ensureSourceEditor();
    state.sourceEditor.setValue(state.currentDocument?.source ?? "");
    state.sourceEditor.setMode(state.mode);
    updateLineSelectionUi();
    updateSourceSyncStatus("idle");
    scrollToHashSelectedLine();
    if (focus) {
      state.sourceEditor.focus();
    }
  } else {
    window.clearTimeout(state.sourceSyncTimer);
    state.sourceEditor?.setMode(state.mode);
    updateLineSelectionUi();
  }
  if (state.mode === "preview" && isEditingModeName(previousMode)) {
    scrollPreviewToSourceLine(previousSourceLine);
  }
  if (isEditingModeName(state.mode) && previousMode === "preview") {
    scrollSourceEditorToSourceLine(previousPreviewLine);
  }
  if (state.mode === "source" && previousMode === "live") {
    scrollPreviewToSourceLine(previousSourceLine);
  }
  refreshDocumentSearch({ preserveIndex: true, reveal: false });
}

function currentSourceEditorVisibleLine() {
  const line = state.sourceEditor?.visibleLine?.();
  return Number.isInteger(line) ? line : state.lastSourceVisibleLine;
}

function currentPreviewVisibleLine() {
  if (documentContent.hidden) {
    return state.lastPreviewVisibleLine;
  }

  const line = sourceLineFromPreviewScroll({
    contentTop: documentContent.getBoundingClientRect().top + 16,
    lineRects: [...documentContent.querySelectorAll("[data-source-line]")].map((button) => ({
      line: Number(button.dataset.sourceLine),
      top: button.getBoundingClientRect().top,
    })),
  });
  return Number.isInteger(line) ? line : state.lastPreviewVisibleLine;
}

function isEditorMode() {
  return isEditingModeName(state.mode) && canEditCurrentDocument();
}

function isEditingModeName(mode) {
  return mode === "source" || mode === "live";
}

function canEditCurrentRepo() {
  return Boolean(state.canEdit && state.currentRepoCanEdit);
}

function canEditCurrentDocument() {
  return canEditDocumentData(state.currentDocument) && canEditCurrentRepo();
}

function canEditDocumentData(documentData) {
  return Boolean(documentData && documentData.editable !== false && isMarkdownDocument(documentData));
}

function isMarkdownDocument(documentData = state.currentDocument) {
  return (documentData?.kind ?? "markdown") === "markdown";
}

function readInitialDesktopPreferences() {
  const preferences = window.GIT_LEAF_DESKTOP_PREFERENCES;
  return preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? { ...preferences }
    : null;
}

function readTreeDirectoryStates({ preferences, storage = window.localStorage } = {}) {
  try {
    const fallbackValue = JSON.parse(storage?.getItem(TREE_DIRECTORY_STORAGE_KEY) || "{}");
    return treeDirectoryStatesFromPreference({ preferences, fallbackValue });
  } catch {
    return treeDirectoryStatesFromPreference({ preferences, fallbackValue: {} });
  }
}

function readWorkbenchSessions({ preferences, storage = window.localStorage } = {}) {
  try {
    const fallbackValue = JSON.parse(storage?.getItem(WORKBENCH_SESSION_STORAGE_KEY) || "{}");
    return workbenchSessionsFromPreference({ preferences, fallbackValue });
  } catch {
    return workbenchSessionsFromPreference({ preferences, fallbackValue: {} });
  }
}

function workbenchSessionsFromPreference({ preferences, fallbackValue } = {}) {
  if (preferences && typeof preferences === "object" && !Array.isArray(preferences)) {
    return normalizeWorkbenchSessions(preferences.workbenchSessions);
  }

  return normalizeWorkbenchSessions(fallbackValue);
}

function restoreWorkbenchSessionForCurrentRepo({ requestedFile = "" } = {}) {
  const session = workbenchSessionForLaunch(
    state.workbenchSessions,
    state.currentWorktreeId,
    requestedFile,
  );
  if (!session) {
    return;
  }

  state.documentTabs = session.tabs;
  state.activeTabPath = session.activeTabPath;
  state.currentFile = session.activeTabPath;
  state.lastTreeFocus = session.treeFocus ?? null;
  state.pendingWorkbenchTreeViewportRestore = true;
}

function currentTreeDirectoryStateScope() {
  return treeDirectoryStateScope({
    repoId: state.currentWorktreeId,
    showOnlyGitChanges: state.showOnlyGitChanges,
  });
}

function restoreTreeDirectoryState() {
  const directoryState = normalizeTreeDirectoryStates(state.treeDirectoryStates)[currentTreeDirectoryStateScope()] ?? {
    expanded: [],
    collapsed: [],
  };
  state.expandedTreeDirectories = new Set(directoryState.expanded);
  state.collapsedTreeDirectories = new Set(directoryState.collapsed);
}

function seedInitialTreeDirectoryExpansion() {
  for (const directoryPath of treeAncestorDirectories(state.currentFile)) {
    if (!state.collapsedTreeDirectories.has(directoryPath)) {
      state.expandedTreeDirectories.add(directoryPath);
    }
  }
}

function persistTreeDirectoryState() {
  const nextDirectoryStates = {
    ...state.treeDirectoryStates,
    [currentTreeDirectoryStateScope()]: serializeTreeDirectoryState({
      expandedDirectories: state.expandedTreeDirectories,
      collapsedDirectories: state.collapsedTreeDirectories,
    }),
  };
  state.treeDirectoryStates = normalizeTreeDirectoryStates(nextDirectoryStates);

  try {
    window.localStorage?.setItem(TREE_DIRECTORY_STORAGE_KEY, JSON.stringify(state.treeDirectoryStates));
  } catch {
    // Directory state is a convenience preference; failure should not interrupt navigation.
  }

  persistAppPreference("treeDirectories", state.treeDirectoryStates);
}

function persistWorkbenchSession({ immediate = false } = {}) {
  if (!state.currentWorktreeId) {
    return;
  }

  const nextSessions = normalizeWorkbenchSessions({
    ...state.workbenchSessions,
    [state.currentWorktreeId]: serializeCurrentWorkbenchSession(),
  });
  state.workbenchSessions = nextSessions;

  try {
    window.localStorage?.setItem(WORKBENCH_SESSION_STORAGE_KEY, JSON.stringify(nextSessions));
  } catch {
    // Workbench restore state is best-effort outside the packaged desktop app.
  }

  persistAppPreference("workbenchSessions", nextSessions, { keepalive: immediate });
}

function scheduleWorkbenchSessionPersist() {
  window.clearTimeout(state.workbenchSessionTimer);
  state.workbenchSessionTimer = window.setTimeout(() => persistWorkbenchSession(), 250);
}

function flushWorkbenchSessionPreference() {
  window.clearTimeout(state.workbenchSessionTimer);
  state.workbenchSessionTimer = null;
  persistWorkbenchSession({ immediate: true });
}

function serializeCurrentWorkbenchSession() {
  return serializeWorkbenchSession({
    tabs: state.documentTabs,
    activeTabPath: state.activeTabPath,
    treeScrollTop: fileTree.scrollTop,
    treeFocus: state.lastTreeFocus,
  });
}

function preferenceValue(preferenceKey, storageKey) {
  if (
    state.desktopPreferencesAvailable &&
    Object.hasOwn(state.desktopPreferences, preferenceKey)
  ) {
    return state.desktopPreferences[preferenceKey];
  }

  try {
    return window.localStorage?.getItem(storageKey);
  } catch {
    return null;
  }
}

function persistAppPreference(preferenceKey, value, { keepalive = false } = {}) {
  state.desktopPreferences = {
    ...state.desktopPreferences,
    [preferenceKey]: value,
  };

  if (!state.desktopPreferencesAvailable) {
    return;
  }

  fetch(apiUrl("/api/preferences"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive,
    body: JSON.stringify({ [preferenceKey]: value }),
  })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      if (payload?.preferences && typeof payload.preferences === "object") {
        state.desktopPreferences = payload.preferences;
        if ("treeDirectories" in payload.preferences) {
          state.treeDirectoryStates = normalizeTreeDirectoryStates(payload.preferences.treeDirectories);
        }
        if ("workbenchSessions" in payload.preferences) {
          state.workbenchSessions = normalizeWorkbenchSessions(payload.preferences.workbenchSessions);
        }
      }
    })
    .catch(() => {
      // Preference persistence should never interrupt reading or editing.
    });
}

function applyEditCapability() {
  const canEditRepo = canEditCurrentRepo();
  const hasDocument = Boolean(state.currentDocument);
  const canUseEditor = canEditRepo && (!hasDocument || canEditCurrentDocument());
  document.querySelector("#mode-source").hidden = !canUseEditor;
  document.querySelector("#mode-live").hidden = !canUseEditor;
}

function applyRepositoryStatus(payload) {
  if (typeof payload?.branch === "string") {
    state.currentRepoBranch = payload.branch;
  }
  state.currentRepoDetached = payload?.detached === true || !state.currentRepoBranch;
  if (typeof payload?.canEdit === "boolean") {
    state.currentRepoCanEdit = payload.canEdit;
  } else {
    state.currentRepoCanEdit = state.canEdit;
  }
}

async function applyBranchProtectionPayload(payload) {
  if (!payload || typeof payload.branch !== "string") {
    return;
  }
  state.currentRepoBranch = payload.branch;
  state.currentRepoDetached = false;
  if (state.currentDocument) {
    state.currentDocument.branch = payload.branch;
    state.currentDocument.detached = false;
  }
  renderBranchStatus();
  if (payload.branchCreated) {
    showCopyToast(`已创建保护分支：${payload.branch}`);
    await loadWorktrees();
  }
}

function renderRepositoryHeader(repo) {
  const repoName = String(repo?.name || repo?.id || state.currentRepo || "Git Leaf").trim();
  repositoryTitle.textContent = repoName;
}

function renderBranchStatus() {
  if (!state.currentRepoDetached) {
    branchStatus.hidden = true;
    branchStatus.textContent = "";
    return;
  }
  branchStatus.textContent = "当前工作树未关联分支；第一次编辑时会自动创建保护分支。";
  branchStatus.hidden = false;
}

function enforceCurrentRepoEditCapability() {
  renderBranchStatus();
  applyEditCapability();
  if (!canEditCurrentDocument() && isEditingModeName(state.mode)) {
    setMode("preview", { persist: false, focus: false });
  }
}

function repositoryById(repoId) {
  return state.repositories.find((repo) => repo.id === repoId);
}

function apiUrl(pathname, params = {}) {
  const url = new URL(pathname, window.location.origin);
  url.searchParams.set("repo", state.currentRepo);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}

function updateDocumentActions(hasDocument) {
  const canUseEditor = hasDocument && canEditCurrentDocument();
  floatingDocumentActions.hidden = !hasDocument;
  copyShareLinkButton.hidden = !hasDocument || !isMarkdownDocument();
  copyShareLinkButton.disabled = !hasDocument || !isMarkdownDocument();
  documentActionsMore.disabled = !hasDocument;
  documentNewButton.disabled = !canEditCurrentRepo();
  emptyNewDocument.disabled = !canEditCurrentRepo();
  document.querySelector("#mode-source").disabled = !canUseEditor;
  document.querySelector("#mode-live").disabled = !canUseEditor;
}

function ensureSourceEditor() {
  if (state.sourceEditor) {
    return;
  }
  state.sourceEditor = createSourceEditor({
    parent: sourceEditorHost,
    doc: state.currentDocument?.source ?? "",
    onChange: scheduleSourceSync,
    onScroll: handleSourceEditorScroll,
    onLineSelect: selectSourceLine,
    onBlankClick: clearLineSelection,
    onImageClick: selectImageBlock,
    onLinkClick: selectLiveLink,
    onFrontmatterClick: selectLiveFrontmatterField,
    onPasteImage: pasteImageAsset,
    onPasteText: pasteTextLink,
    onSlashCommand: runSlashCommand,
    theme: state.theme,
    getDocumentPath: () => state.currentDocument?.path ?? "",
    getRenderOptions: () => documentRenderOptions(),
    onBeforeSlashCommand: ensureSlashCommandAllowed,
  });
}

function applyAppearancePreferences(preferences) {
  const normalized = normalizeUserPreferences(preferences, {
    defaults: DEFAULT_USER_PREFERENCES,
  });
  state.colorMode = normalized.colorMode;
  state.documentFont = normalized.documentFont;
  state.documentFontSize = normalized.documentFontSize;
  state.fileTreeMode = normalized.fileTreeMode;
  state.theme = effectiveColorScheme(state.colorMode, {
    systemDark: systemColorSchemeQuery?.matches === true,
  });
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.documentFont = state.documentFont;
  document.documentElement.style.colorScheme = state.theme;
  document.documentElement.style.setProperty("--document-font-size", `${state.documentFontSize}px`);
  updateThemeToggle();
  state.sourceEditor?.setTheme(state.theme);
}

function toggleWebTheme() {
  if (state.desktopPreferencesAvailable) {
    return;
  }
  const theme = writeThemePreference(nextTheme(state.theme));
  applyAppearancePreferences({
    colorMode: theme,
    documentFont: state.documentFont,
    documentFontSize: state.documentFontSize,
    fileTreeMode: state.fileTreeMode,
  });
}

function updateThemeToggle() {
  themeToggle.hidden = state.desktopPreferencesAvailable;
  if (state.desktopPreferencesAvailable) {
    return;
  }
  const isDark = state.theme === "dark";
  themeToggle.textContent = isDark ? "☀" : "☾";
  themeToggle.title = isDark ? "切换到浅色模式" : "切换到深色模式";
  themeToggle.setAttribute("aria-label", themeToggle.title);
  themeToggle.setAttribute("aria-pressed", String(isDark));
}

function handleDesktopPreferencesEvent(event) {
  const preferences = event.detail;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    return;
  }
  const shouldRebuildFileTree = shouldRebuildFileTreeForPreferences(
    state.desktopPreferences,
    preferences,
    {
      defaults: DEFAULT_USER_PREFERENCES,
    },
  );
  const documentOutlineCollapsedChanged =
    typeof preferences.documentOutlineCollapsed === "boolean" &&
    preferences.documentOutlineCollapsed !== state.documentOutlineCollapsed;
  const documentOutlineWidthChanged =
    Number.isFinite(Number(preferences.documentOutlineWidth)) &&
    Number(preferences.documentOutlineWidth) !== currentDocumentOutlineWidth();
  state.desktopPreferences = { ...preferences };
  applyAppearancePreferences(preferences);
  if (shouldRebuildFileTree) {
    renderTree();
  }
  if (documentOutlineCollapsedChanged) {
    setDocumentOutlineCollapsed(preferences.documentOutlineCollapsed, { persist: false });
  }
  if (documentOutlineWidthChanged) {
    setDocumentOutlineWidth(preferences.documentOutlineWidth, { persist: false });
  }
  event.preventDefault();
}

function handleSystemColorSchemeChange() {
  if (state.colorMode !== "system") {
    return;
  }
  applyAppearancePreferences({
    ...state.desktopPreferences,
    colorMode: state.colorMode,
    documentFont: state.documentFont,
    documentFontSize: state.documentFontSize,
    fileTreeMode: state.fileTreeMode,
  });
}

function applyShortcutTooltips() {
  setShortcutTooltip(sidebarToggle, "收起侧边栏", "Command+B");
  setShortcutTooltip(historyBackButton, "后退", "Command+[");
  setShortcutTooltip(historyForwardButton, "前进", "Command+]");
  setShortcutButtonLabel(copyShareLinkButton, "复制分享链接", "Command+Shift+L");
  copyShareLinkButton.title = `${shortcutTooltip("复制分享链接", "Command+Shift+L")}：复制主工作区 main 上已发布文档的分享链接`;
  documentActionsMore.title = "更多文件操作";
  setShortcutButtonLabel(document.querySelector("#mode-preview"), "Preview", "Command+P");
  setShortcutButtonLabel(document.querySelector("#mode-source"), "Source", "Command+S");
  setShortcutButtonLabel(document.querySelector("#mode-live"), "Live", "Command+L");
  setShortcutTooltip(treeFilter, "搜索文件", "Command+K");
  treeFilter.placeholder = `搜索 (${platformShortcutLabel("Command+K")})`;
}

function setShortcutButtonLabel(element, label, shortcut) {
  if (!element) {
    return;
  }

  const labelText = document.createElement("span");
  labelText.textContent = label;

  const shortcutText = document.createElement("span");
  shortcutText.className = "button-shortcut";
  shortcutText.setAttribute("aria-hidden", "true");
  shortcutText.textContent = platformShortcutLabel(shortcut);

  element.textContent = "";
  element.append(labelText, shortcutText);
  element.title = shortcutTooltip(label, shortcut);
  element.setAttribute("aria-label", shortcutTooltip(label, shortcut));
}

function setShortcutTooltip(element, label, shortcut) {
  if (!element) {
    return;
  }
  element.title = shortcutTooltip(label, shortcut);
}

function shortcutTooltip(label, shortcut) {
  return `${label} (${platformShortcutLabel(shortcut)})`;
}

function platformShortcutLabel(shortcut) {
  if (!isMacPlatform()) {
    return String(shortcut)
      .replace(/^Command/, "Ctrl")
      .replaceAll("+Command", "+Ctrl")
      .replace(/^Option/, "Alt")
      .replaceAll("+Option", "+Alt");
  }
  return String(shortcut)
    .split("+")
    .map((part) => {
      if (part === "Command") {
        return "⌘";
      }
      if (part === "Shift") {
        return "⇧";
      }
      if (part === "Option") {
        return "⌥";
      }
      return part;
    })
    .join("");
}

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
}

function documentRenderOptions() {
  return {
    currentFile: state.currentDocument?.path ?? state.currentFile,
    currentRepo: state.currentRepo,
  };
}

async function ensureSlashCommandAllowed(command) {
  if (!command?.requiresMdx || !state.currentDocument?.path) {
    recordSlashCommandTelemetry(command);
    return true;
  }
  if (!/\.md$/i.test(state.currentDocument.path)) {
    recordSlashCommandTelemetry(command);
    return true;
  }

  const currentPath = state.currentDocument.path;
  const nextPath = currentPath.replace(/\.md$/i, ".mdx");
  const { confirmed } = await showAppDialog({
    title: "改为 .mdx 文件",
    message: [
      "MDX 组件建议写在 .mdx 文件中。",
      `是否将 ${currentPath} 重命名为 ${nextPath}，并插入 ${command.title || command.label}？`,
      "注意：仓库里已有的链接不会自动改写。",
    ].join("\n"),
    confirmText: "改名并插入",
    cancelText: "取消",
  });
  if (!confirmed) {
    recordTelemetryFeature("editing.markdown_to_mdx", { result: "cancel" });
    return false;
  }

  try {
    await flushPendingSourceSync();
    const response = await fetch(apiUrl("/api/rename-document", { file: currentPath }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extension: ".mdx" }),
    });
    const payload = await response.json().catch(() => ({ error: "重命名失败" }));
    if (!response.ok) {
      throw new Error(payload.error || "重命名失败");
    }
    await applyBranchProtectionPayload(payload);

    replaceDocumentTabPath(currentPath, payload.path);
    state.currentFile = payload.path;
    state.currentRepo = payload.repo || state.currentRepo;
    applyDocumentData(payload, {
      pushState: true,
      preserveScroll: true,
      forceReplace: true,
    });
    await loadTree({ force: true });
    resetStatusPolling();
    resetDocumentWatch();
    recordTelemetryFeature("editing.markdown_to_mdx", { result: "success" });
    recordSlashCommandTelemetry(command);
    showCopyToast("已改为 .mdx");
    return true;
  } catch (error) {
    recordTelemetryFeature("editing.markdown_to_mdx", { result: "error" });
    showCopyToast(error instanceof Error ? error.message : "重命名失败");
    return false;
  }
}

function handleSourceEditorScroll(sourceMetrics) {
  if (Number.isInteger(sourceMetrics.visibleLine)) {
    state.lastSourceVisibleLine = sourceMetrics.visibleLine;
  }
  scheduleSelectionPopoverPosition();
  positionLinkPopover();
  positionFrontmatterFieldPopover();
  if (state.mode === "live") {
    updateActiveOutlineFromContentScroll(
      activeOutlineIdForSourceLine(sourceMetrics.visibleLine, state.outlineItems),
    );
    return;
  }

  syncPreviewScrollFromSource(sourceMetrics);
}

function syncPreviewScrollFromSource(sourceMetrics) {
  if (state.mode !== "source") {
    return;
  }
  if (state.scrollSyncSource === "preview") {
    return;
  }
  scrollPreviewToSourceLine(sourceMetrics.visibleLine);
}

function scrollPreviewToSourceLine(sourceLine) {
  const availableLines = [...documentContent.querySelectorAll("[data-source-line]")]
    .map((button) => Number(button.dataset.sourceLine));
  const targetLine = sourceLineForPreviewSync(sourceLine, availableLines);
  if (!Number.isInteger(targetLine)) {
    return;
  }

  const target = documentContent.querySelector(`[data-source-line="${targetLine}"]`);
  if (!target) {
    return;
  }
  const targetRect = target.getBoundingClientRect();
  const contentRect = documentContent.getBoundingClientRect();
  state.scrollSyncSource = "source";
  documentContent.scrollTop += targetRect.top - contentRect.top - 16;
  window.setTimeout(() => {
    if (state.scrollSyncSource === "source") {
      state.scrollSyncSource = null;
    }
  }, 80);
}

function syncSourceScrollFromPreview(sourceLine = currentPreviewVisibleLine()) {
  if (state.mode !== "source" || !state.sourceEditor) {
    return;
  }
  if (state.scrollSyncSource === "source") {
    return;
  }

  scrollSourceEditorToSourceLine(sourceLine);
}

function scrollSourceEditorToSourceLine(sourceLine) {
  if (!Number.isInteger(sourceLine) || !state.sourceEditor) {
    return;
  }

  state.scrollSyncSource = "preview";
  state.sourceEditor.scrollToLine(sourceLine);
  window.setTimeout(() => {
    if (state.scrollSyncSource === "preview") {
      state.scrollSyncSource = null;
    }
  }, 80);
}

function scheduleSourceSync(source) {
  if (!canEditCurrentDocument() || !isEditorMode() || !state.currentDocument) {
    return;
  }
  state.currentDocument.source = source;
  refreshDocumentSearch({ preserveIndex: true, reveal: false });
  updateSourceSyncStatus("syncing");
  window.clearTimeout(state.sourceSyncTimer);
  state.sourceSyncTimer = window.setTimeout(syncSourceToDisk, SOURCE_SYNC_DELAY_MS);
}

async function syncSourceToDisk() {
  if (!canEditCurrentDocument() || !state.currentDocument || !state.sourceEditor) {
    return true;
  }

  window.clearTimeout(state.sourceSyncTimer);
  state.sourceSyncTimer = null;
  state.sourceWriteInFlight = true;
  const source = state.sourceEditor.getValue();
  try {
    const response = await fetch(
      apiUrl("/api/document", { file: state.currentDocument.path }),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      },
    );
    if (!response.ok) {
      throw new Error("Source sync failed");
    }
    const payload = await response.json();
    await applyBranchProtectionPayload(payload);
    state.currentDocument = {
      ...state.currentDocument,
      source,
      mtimeMs: payload.mtimeMs,
      sourceHash: payload.sourceHash,
    };
    state.lastWrittenHash = payload.sourceHash;
    state.frontmatterFacets = null;
    await refreshCurrentDocument();
    if (
      state.frontmatterFilters.length > 0 ||
      (state.filter.length > 0 && state.frontmatterAllowedKeys.length > 0)
    ) {
      await ensureFrontmatterFacets({ force: true });
    }
    scheduleGitStatusRefresh();
    updateSourceSyncStatus("idle");
    const telemetryNow = Date.now();
    if (telemetryNow - lastEditingTelemetryAt >= EDITING_TELEMETRY_INTERVAL_MS) {
      recordTelemetryFeature("editing.activity", { mode: state.mode });
      lastEditingTelemetryAt = telemetryNow;
    }
    return true;
  } catch (error) {
    updateSourceSyncStatus("error");
    return false;
  } finally {
    state.sourceWriteInFlight = false;
  }
}

function handleToolStatusActivity() {
  void checkToolStatusFromActivity();
}

function handleToolStatusVisibilityChange() {
  if (document.visibilityState === "visible") {
    void checkToolStatusFromActivity({ force: true });
  }
}

async function checkToolStatusFromActivity({ force = false } = {}) {
  if (!state.canEdit || state.toolRestartInFlight) {
    return;
  }

  const now = Date.now();
  if (!force && now - state.lastToolStatusCheckAt < TOOL_STATUS_CHECK_INTERVAL_MS) {
    return;
  }
  state.lastToolStatusCheckAt = now;

  try {
    const response = await fetch("/api/tool-status?force=1", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const status = await response.json();
    if (status.toolFingerprint) {
      state.toolFingerprint = status.toolFingerprint;
    }
    if (status.stale) {
      await restartToolAfterUpdate(status);
    }
  } catch {
    // Tool status checks are opportunistic; document work should continue if they fail.
  }
}

async function restartToolAfterUpdate(status) {
  if (state.toolRestartInFlight) {
    return;
  }

  state.toolRestartInFlight = true;
  const previousFingerprint = status.toolFingerprint || state.toolFingerprint;
  showCopyToast("Git Leaf 正在更新");
  try {
    await flushPendingSourceSync();
    const response = await fetch("/api/restart", { method: "POST" });
    if (!response.ok) {
      throw new Error("Restart request failed");
    }
    await waitForToolRestart(previousFingerprint);
    window.location.reload();
  } catch {
    state.toolRestartInFlight = false;
    showCopyToast("Git Leaf 更新失败，请重新运行命令");
  }
}

async function flushPendingSourceSync() {
  if (!state.canEdit || !isEditorMode() || !state.currentDocument || !state.sourceEditor) {
    return;
  }

  if (state.sourceSyncTimer) {
    window.clearTimeout(state.sourceSyncTimer);
    state.sourceSyncTimer = null;
    const synced = await syncSourceToDisk();
    if (!synced) {
      throw new Error("Source sync failed before restart");
    }
  }

  const startedAt = Date.now();
  while (state.sourceWriteInFlight && Date.now() - startedAt < 3_000) {
    await delay(50);
  }
}

async function waitForToolRestart(previousFingerprint) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TOOL_RESTART_WAIT_TIMEOUT_MS) {
    await delay(TOOL_RESTART_WAIT_INTERVAL_MS);
    const status = await healthPayloadAfterRestart();
    if (
      status?.app === "git-leaf" &&
      status.toolFingerprint &&
      !status.stale &&
      status.toolFingerprint !== previousFingerprint
    ) {
      return;
    }
  }

  throw new Error("Git Leaf restart did not become ready in time");
}

async function healthPayloadAfterRestart() {
  try {
    const response = await fetch("/api/health?check=1", { cache: "no-store" });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function updateSourceSyncStatus(nextState) {
  const label = syncLabelForState(nextState);
  const status = document.querySelector("#source-sync-status");
  if (!label) {
    status.hidden = true;
    status.textContent = "";
    delete status.dataset.state;
    return;
  }
  status.hidden = false;
  status.textContent = label;
  status.dataset.state = nextState;
}

window.addEventListener("popstate", (event) => {
  const params = new URLSearchParams(window.location.search);
  const repo = event.state?.repo || params.get("repo") || state.currentRepo;
  const file = event.state?.file || params.get("file");
  if (file) {
    openFile(file, false, { repoId: repo });
    return;
  }
  const repoChanged = repo !== state.currentRepo;
  state.currentRepo = repo;
  if (repoChanged) {
    restoreAgentContextItemsForScopeChange();
  }
  showNoDocumentSelected();
});

function renderTree() {
  overflowTooltipController.hide();
  const previousTreeFocus = treeFocusSnapshot();
  fileTree.innerHTML = "";
  const list = document.createElement("ul");
  list.className = "tree-list";
  const visibleTree = filterWorkbenchFileTree(state.tree, {
    mode: state.fileTreeMode,
    currentDocument: state.currentDocument,
    currentFile: state.currentFile,
    searchMatchedPaths: treeSearchMatchedPaths(),
    gitChangedPaths: state.showOnlyGitChanges ? gitChangedPaths() : [],
  });
  for (const node of filterNodes(filterNodesByFrontmatter(filterNodesByGitChanges(visibleTree)))) {
    list.append(renderNode(node, ""));
  }
  fileTree.append(list);
  restoreTreeFocus(previousTreeFocus);
  restoreWorkbenchTreeViewportIfPending();
}

function treeSearchMatchedPaths() {
  if (!state.filter) {
    return [];
  }
  const matched = [];
  collectTreeSearchMatchedPaths(state.tree, "", matched);
  return matched;
}

function collectTreeSearchMatchedPaths(nodes, parentPath, matched) {
  for (const node of nodes) {
    if (node.type === "file") {
      if (fileMatchesTextFilter(node, state.frontmatterFiles[node.path], state.filter)) {
        matched.push(node.path);
      }
      continue;
    }
    const directoryPath = treeDirectoryPath(parentPath, node.name);
    if (node.name.toLowerCase().includes(state.filter)) {
      matched.push(directoryPath);
    }
    collectTreeSearchMatchedPaths(node.children, directoryPath, matched);
  }
}

function tabBehaviorFromClick(event) {
  if (event?.metaKey || (!isMacPlatform() && event?.ctrlKey)) {
    return "background";
  }
  if (event?.shiftKey) {
    return "foreground";
  }
  return "current";
}

async function openFileFromTree(filePath, event) {
  const behavior = tabBehaviorFromClick(event);
  const previousActivePath = state.activeTabPath;
  const nextTabs = openDocumentTab({
    tabs: state.documentTabs,
    activePath: state.activeTabPath,
    targetPath: filePath,
    behavior,
  });
  state.documentTabs = nextTabs.tabs;
  state.activeTabPath = nextTabs.activePath;
  renderDocumentTabs();
  persistWorkbenchSession();

  if (shouldSkipTreeDocumentLoad({
    behavior,
    previousActivePath,
    nextActivePath: nextTabs.activePath,
    currentDocumentPath: state.currentDocument?.path,
    targetPath: filePath,
  })) {
    if (filePath === state.currentDocument?.path) {
      focusActiveDocumentSurface();
    }
    return;
  }
  await openFile(nextTabs.activePath || filePath);
}

function ensureActiveDocumentTab(filePath) {
  const nextTabs = openDocumentTab({
    tabs: state.documentTabs,
    activePath: state.activeTabPath,
    targetPath: filePath,
    behavior: state.activeTabPath ? "current" : "foreground",
  });
  state.documentTabs = nextTabs.tabs;
  state.activeTabPath = nextTabs.activePath;
  renderDocumentTabs();
}

function replaceDocumentTabPath(fromPath, toPath) {
  state.documentTabs = state.documentTabs.map((tab) => tab.path === fromPath ? { path: toPath } : tab);
  if (state.activeTabPath === fromPath) {
    state.activeTabPath = toPath;
  }
  renderDocumentTabs();
  persistWorkbenchSession();
}

function renderDocumentTabs() {
  hideDocumentTabTooltip();
  documentTabs.innerHTML = "";
  for (const { path } of state.documentTabs) {
    const isActive = path === state.activeTabPath;
    const tab = document.createElement("div");
    tab.className = isActive ? "document-tab is-active" : "document-tab";
    tab.dataset.documentTabPath = path;
    tab.addEventListener("pointerdown", (event) => startDocumentTabPointerDrag(event, path));
    tab.addEventListener("pointermove", handleDocumentTabPointerMove);
    tab.addEventListener("pointerup", finishDocumentTabPointerDrag);
    tab.addEventListener("pointercancel", cancelDocumentTabPointerDrag);
    tab.addEventListener("mouseenter", (event) => scheduleDocumentTabTooltip(path, event.currentTarget));
    tab.addEventListener("mousemove", (event) => handleDocumentTabTooltipPointerMove(path, event.currentTarget));
    tab.addEventListener("mouseleave", hideDocumentTabTooltip);
    tab.addEventListener("focusin", (event) => scheduleDocumentTabTooltip(path, event.currentTarget));
    tab.addEventListener("focusout", hideDocumentTabTooltip);

    const title = document.createElement("button");
    title.type = "button";
    title.className = "document-tab-title";
    title.textContent = tabTitleFromPath(path);
    title.addEventListener("click", () => openFileFromTab(path));
    tab.append(title);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "document-tab-close";
    close.title = shortcutTooltip("关闭当前 Tab", "Command+W");
    close.setAttribute("aria-label", `关闭 ${tabTitleFromPath(path)}`);
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(path);
    });
    tab.append(close);
    documentTabs.append(tab);
  }
}

function revealActiveDocumentTab() {
  documentTabs
    .querySelector(`[data-document-tab-path="${cssEscape(state.activeTabPath)}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
}

function startDocumentTabPointerDrag(event, path) {
  if (event.button !== 0 || event.target.closest?.(".document-tab-close")) {
    return;
  }
  state.documentTabPointerDrag = {
    path,
    pointerId: event.pointerId,
    startX: event.clientX,
    element: event.currentTarget,
    active: false,
  };
}

function handleDocumentTabPointerMove(event) {
  const drag = state.documentTabPointerDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }
  if (!drag.active && Math.abs(event.clientX - drag.startX) < 6) {
    return;
  }
  if (!drag.active) {
    drag.active = true;
    drag.element.setPointerCapture?.(event.pointerId);
    documentTabs.querySelector(`[data-document-tab-path="${cssEscape(drag.path)}"]`)?.classList.add("is-dragging");
    hideDocumentTabTooltip();
    closeFileActionMenu();
  }
  event.preventDefault();
  updateDocumentTabDropTarget(event.clientX, drag.path);
}

function updateDocumentTabDropTarget(clientX, draggedPath) {
  const tabs = [...documentTabs.querySelectorAll("[data-document-tab-path]")];
  const target = tabs.find((tab) => {
    const rect = tab.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right;
  });
  if (!target || target.dataset.documentTabPath === draggedPath) {
    clearDocumentTabDropMarkers();
  } else {
    const rect = target.getBoundingClientRect();
    const placement = clientX < rect.left + rect.width / 2 ? "before" : "after";
    clearDocumentTabDropMarkers();
    target.classList.add(placement === "before" ? "is-drop-before" : "is-drop-after");
    target.dataset.dropPlacement = placement;
  }
  const edge = 28;
  const tabsRect = documentTabs.getBoundingClientRect();
  if (clientX < tabsRect.left + edge) {
    documentTabs.scrollLeft -= 18;
  } else if (clientX > tabsRect.right - edge) {
    documentTabs.scrollLeft += 18;
  }
}

function finishDocumentTabPointerDrag(event) {
  const drag = state.documentTabPointerDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }
  const target = documentTabs.querySelector(".is-drop-before, .is-drop-after");
  if (drag.active) {
    releaseDocumentTabPointerCapture(drag);
    event.preventDefault();
    if (target) {
      state.documentTabs = reorderDocumentTabs({
        tabs: state.documentTabs,
        sourcePath: drag.path,
        targetPath: target.dataset.documentTabPath,
        placement: target.dataset.dropPlacement || "before",
      });
      renderDocumentTabs();
      persistWorkbenchSession();
    }
  }
  state.documentTabPointerDrag = null;
  clearDocumentTabDropMarkers();
  for (const tab of documentTabs.querySelectorAll(".is-dragging")) {
    tab.classList.remove("is-dragging");
  }
}

function clearDocumentTabDropMarkers() {
  for (const tab of documentTabs.querySelectorAll(".is-drop-before, .is-drop-after")) {
    tab.classList.remove("is-drop-before", "is-drop-after");
    delete tab.dataset.dropPlacement;
  }
}

function cancelDocumentTabPointerDrag(event) {
  const drag = state.documentTabPointerDrag;
  if (drag && (!event || drag.pointerId === event.pointerId)) {
    releaseDocumentTabPointerCapture(drag);
  }
  state.documentTabPointerDrag = null;
  clearDocumentTabDropMarkers();
  for (const tab of documentTabs.querySelectorAll(".is-dragging")) {
    tab.classList.remove("is-dragging");
  }
}

function releaseDocumentTabPointerCapture(drag) {
  if (drag?.element?.hasPointerCapture?.(drag.pointerId)) {
    drag.element.releasePointerCapture(drag.pointerId);
  }
}

function handleDocumentTabsWheel(event) {
  if (documentTabs.scrollWidth <= documentTabs.clientWidth) {
    return;
  }
  const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY;
  if (!rawDelta) {
    return;
  }
  const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? rawDelta * 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? rawDelta * documentTabs.clientWidth
      : rawDelta;
  event.preventDefault();
  documentTabs.scrollLeft += delta;
  hideDocumentTabTooltip();
}

async function openFileFromTab(filePath) {
  if (filePath === state.activeTabPath && filePath === state.currentFile) {
    focusActiveDocumentSurface();
    return;
  }
  await openFile(filePath);
  focusActiveDocumentSurface();
}

function scheduleDocumentTabTooltip(filePath, anchor) {
  if (state.documentTabTooltipPendingPath === filePath && state.documentTabTooltipTimer) {
    return;
  }
  window.clearTimeout(state.documentTabTooltipTimer);
  state.documentTabTooltipPendingPath = filePath;
  state.documentTabTooltipTimer = window.setTimeout(() => {
    state.documentTabTooltipTimer = null;
    state.documentTabTooltipPendingPath = "";
    showDocumentTabTooltip(filePath, anchor);
  }, 120);
}

function showDocumentTabTooltip(filePath, anchor) {
  if (!documentTabTooltip || !anchor) {
    return;
  }
  const name = document.createElement("div");
  name.className = "document-tab-tooltip-name";
  name.textContent = tabTitleFromPath(filePath);

  const fullPath = document.createElement("div");
  fullPath.className = "document-tab-tooltip-path";
  fullPath.textContent = documentTabDisplayPath(filePath);

  documentTabTooltip.textContent = "";
  documentTabTooltip.append(name, fullPath);
  state.documentTabTooltipPath = filePath;
  documentTabTooltip.hidden = false;
  positionDocumentTabTooltip(anchor);
}

function handleDocumentTabTooltipPointerMove(filePath, anchor) {
  if (!documentTabTooltip || !anchor) {
    return;
  }

  if (documentTabTooltip.hidden || state.documentTabTooltipPath !== filePath) {
    scheduleDocumentTabTooltip(filePath, anchor);
    return;
  }

  positionDocumentTabTooltip(anchor);
}

function positionDocumentTabTooltip(anchor) {
  if (!documentTabTooltip || documentTabTooltip.hidden || !anchor) {
    return;
  }

  const rect = anchor.getBoundingClientRect();
  const tooltipRect = documentTabTooltip.getBoundingClientRect();
  const viewportPadding = 8;
  const top = rect.bottom + 8;
  const idealLeft = rect.left;
  const maxLeft = window.innerWidth - tooltipRect.width - viewportPadding;
  const left = Math.max(viewportPadding, Math.min(idealLeft, maxLeft));
  documentTabTooltip.style.left = `${left}px`;
  documentTabTooltip.style.top = `${top}px`;
}

function hideDocumentTabTooltip() {
  window.clearTimeout(state.documentTabTooltipTimer);
  state.documentTabTooltipTimer = null;
  state.documentTabTooltipPendingPath = "";
  state.documentTabTooltipPath = "";
  if (!documentTabTooltip) {
    return;
  }
  documentTabTooltip.hidden = true;
}

function treeItemFromEventTarget(target) {
  const item = target?.closest?.("[data-tree-item]");
  return item && fileTree.contains(item) ? item : null;
}

function treeItemLabelElement(item) {
  if (item?.dataset.treeItem === "file") {
    return item.querySelector(".tree-file-label") || item;
  }
  return item;
}

function treeItemTooltipDetails(item) {
  const label = treeItemLabelElement(item);
  const name = label?.textContent?.trim() || "";
  return {
    name,
    path: item?.dataset.treePath || "",
  };
}

function treeItemTooltipKey(item) {
  const details = treeItemTooltipDetails(item);
  return `${item?.dataset.treeItem || ""}:${details.path || details.name}`;
}

function outlineItemFromEventTarget(target) {
  const item = target?.closest?.("[data-outline-target]");
  return item && documentOutline.contains(item) ? item : null;
}

function outlineItemTooltipDetails(item) {
  return {
    name: item?.textContent?.trim() || "",
    path: "",
  };
}

function documentTabDisplayPath(filePath) {
  return String(filePath || "").replace(/^[/\\]+/, "");
}

async function closeTab(filePath) {
  const nextTabs = closeDocumentTab({
    tabs: state.documentTabs,
    activePath: state.activeTabPath,
    targetPath: filePath,
  });
  const nextActivePath = nextTabs.activePath;
  state.documentTabs = nextTabs.tabs;
  state.activeTabPath = nextActivePath;
  renderDocumentTabs();
  persistWorkbenchSession();

  if (!nextActivePath) {
    showNoDocumentSelected({ pushState: true });
    return;
  }
  if (nextActivePath !== state.currentFile) {
    await openFile(nextActivePath);
  }
}

async function applyDocumentTabClosure(result) {
  state.documentTabs = result.tabs;
  state.activeTabPath = result.activePath;
  renderDocumentTabs();
  persistWorkbenchSession();
  if (!result.activePath) {
    showNoDocumentSelected({ pushState: true });
  } else if (result.activePath !== state.currentFile) {
    await openFile(result.activePath);
  }
}

function handleDocumentTabContextMenu(event) {
  const tab = event.target.closest?.("[data-document-tab-path]");
  if (!tab) {
    return;
  }
  event.preventDefault();
  const path = tab.dataset.documentTabPath;
  const targetIndex = state.documentTabs.findIndex((item) => item.path === path);
  state.fileActionTarget = { source: "tab", path };
  showFileActionMenu([
    { id: "close-tab", label: "关闭", shortcut: "Command+W" },
    { id: "close-others", label: "关闭其他标签页", disabled: state.documentTabs.length < 2 },
    { id: "close-right", label: "关闭右侧标签页", disabled: targetIndex < 0 || targetIndex === state.documentTabs.length - 1 },
    { id: "close-all", label: "关闭全部标签页" },
    null,
    ...(isMarkdownPath(path) ? [{ id: "copy-share", label: "复制分享链接", shortcut: "Command+Shift+L" }] : []),
    { id: "copy-path", label: "复制文件路径", shortcut: "Command+Shift+C" },
    null,
    { id: "reveal-tree", label: "在左侧目录中显示" },
    { id: "reveal-finder", label: revealInFileManagerLabel(), shortcut: "Command+Shift+R", disabled: !canEditCurrentRepo() },
    { id: "open-system", label: "使用系统应用打开", shortcut: "Command+Shift+O", disabled: !canEditCurrentRepo() },
  ], { x: event.clientX, y: event.clientY });
}

function handleFileTreeContextMenu(event) {
  const item = event.target.closest?.("[data-tree-item]");
  if (!item || !fileTree.contains(item)) {
    return;
  }
  event.preventDefault();
  const path = item.dataset.treePath || "";
  const isDirectory = item.dataset.treeItem === "directory";
  state.fileActionTarget = isDirectory
    ? { source: "tree-directory", path, directoryPath: path }
    : { source: "tree-file", path, directoryPath: parentDirectoryPath(path), referencePath: path };
  const items = isDirectory
    ? [
        { id: "new-document", label: "在这里新建文档", disabled: !canEditCurrentRepo() },
        null,
        { id: "reveal-finder", label: revealInFileManagerLabel(), shortcut: "Command+Shift+R", disabled: !canEditCurrentRepo() },
        { id: "copy-path", label: "复制目录路径", shortcut: "Command+Shift+C" },
      ]
    : [
        { id: "new-document", label: "在同一位置新建文档", disabled: !canEditCurrentRepo() },
        { id: "open-new-tab", label: "在新标签页打开", shortcut: "Shift+Enter" },
        null,
        ...(isMarkdownPath(path) ? [{ id: "copy-share", label: "复制分享链接", shortcut: "Command+Shift+L" }] : []),
        { id: "reveal-finder", label: revealInFileManagerLabel(), shortcut: "Command+Shift+R", disabled: !canEditCurrentRepo() },
      ];
  showFileActionMenu(items, { x: event.clientX, y: event.clientY });
}

function showCurrentDocumentActionsMenu() {
  if (!state.currentDocument) {
    return;
  }
  const rect = documentActionsMore.getBoundingClientRect();
  state.fileActionTarget = { source: "current", path: state.currentDocument.path };
  showFileActionMenu([
    { id: "reveal-tree", label: "在左侧目录中显示" },
    { id: "reveal-finder", label: revealInFileManagerLabel(), shortcut: "Command+Shift+R", disabled: !canEditCurrentRepo() },
    null,
    { id: "open-github", label: "查看 GitHub 源文件", shortcut: "Command+Shift+G", disabled: !state.currentDocument.githubUrl },
    { id: "copy-path", label: "复制文件路径", shortcut: "Command+Shift+C" },
    { id: "open-system", label: "使用系统应用打开", shortcut: "Command+Shift+O", disabled: !canEditCurrentRepo() },
  ], { x: rect.right, y: rect.bottom + 4, alignRight: true });
  documentActionsMore.setAttribute("aria-expanded", "true");
}

function showFileActionMenu(items, { x, y, alignRight = false }) {
  closeFileActionMenu();
  fileActionMenu.replaceChildren(...items.map((item) => {
    if (!item) {
      const separator = document.createElement("div");
      separator.className = "file-action-menu-separator";
      separator.setAttribute("role", "separator");
      return separator;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.fileAction = item.id;
    button.disabled = item.disabled === true;
    button.setAttribute("role", "menuitem");
    const label = document.createElement("span");
    label.className = "file-action-menu-label";
    label.textContent = item.label;
    button.append(label);
    if (item.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "file-action-menu-shortcut";
      shortcut.setAttribute("aria-hidden", "true");
      shortcut.textContent = platformShortcutLabel(item.shortcut);
      button.append(shortcut);
      button.setAttribute("aria-label", shortcutTooltip(item.label, item.shortcut));
    }
    return button;
  }));
  fileActionMenu.hidden = false;
  const margin = 8;
  const rect = fileActionMenu.getBoundingClientRect();
  const desiredLeft = alignRight ? x - rect.width : x;
  const left = Math.max(margin, Math.min(desiredLeft, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
  fileActionMenu.style.left = `${Math.round(left)}px`;
  fileActionMenu.style.top = `${Math.round(top)}px`;
  fileActionMenu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
}

function closeFileActionMenu() {
  if (fileActionMenu.hidden) {
    return;
  }
  fileActionMenu.hidden = true;
  fileActionMenu.replaceChildren();
  documentActionsMore.setAttribute("aria-expanded", "false");
}

function fileActionMenuShortcutTarget(actionId) {
  if (fileActionMenu.hidden || !state.fileActionTarget) {
    return null;
  }
  const button = fileActionMenu.querySelector(`[data-file-action="${actionId}"]`);
  return button && !button.disabled ? state.fileActionTarget : null;
}

async function handleFileActionMenuClick(event) {
  const button = event.target.closest?.("[data-file-action]");
  if (!button || button.disabled || !state.fileActionTarget) {
    return;
  }
  const action = button.dataset.fileAction;
  const target = state.fileActionTarget;
  closeFileActionMenu();
  if (action === "close-tab") {
    await closeTab(target.path);
  } else if (action === "close-others") {
    await applyDocumentTabClosure(closeOtherDocumentTabs({ tabs: state.documentTabs, targetPath: target.path }));
  } else if (action === "close-right") {
    await applyDocumentTabClosure(closeDocumentTabsToRight({
      tabs: state.documentTabs,
      activePath: state.activeTabPath,
      targetPath: target.path,
    }));
  } else if (action === "close-all") {
    await applyDocumentTabClosure({ tabs: [], activePath: "" });
  } else if (action === "copy-share") {
    await copyShareLinkForPath(target.path);
  } else if (action === "reveal-tree") {
    revealFileInTree(target.path);
  } else if (action === "new-document") {
    await promptNewDocument(target);
  } else if (action === "open-new-tab") {
    await openFileInForegroundTab(target.path);
  } else if (action === "reveal-finder") {
    await revealPathInFinder(target.path);
  } else if (action === "copy-path") {
    await copyPathValue(target.path);
  } else if (action === "open-github") {
    openCurrentGithub();
  } else if (action === "open-system") {
    await openPathWithSystem(target.path);
  }
}

async function openFileInForegroundTab(path) {
  const nextTabs = openDocumentTab({
    tabs: state.documentTabs,
    activePath: state.activeTabPath,
    targetPath: path,
    behavior: "foreground",
  });
  state.documentTabs = nextTabs.tabs;
  state.activeTabPath = nextTabs.activePath;
  renderDocumentTabs();
  revealActiveDocumentTab();
  persistWorkbenchSession();
  await openFile(path);
}

function revealFileInTree(path) {
  if (state.sidebarCollapsed) {
    setSidebarCollapsed(false);
  }
  for (const directoryPath of treeAncestorDirectories(path)) {
    state.collapsedTreeDirectories.delete(directoryPath);
    state.expandedTreeDirectories.add(directoryPath);
  }
  persistTreeDirectoryState();
  renderTree();
  window.requestAnimationFrame(() => {
    const item = treeItemByPath(path, "file");
    if (!item) {
      showCopyToast("当前文件未显示在目录中");
      return;
    }
    item.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    item.focus({ preventScroll: true });
  });
}

function newDocumentLocationFromCurrent() {
  const path = state.currentDocument?.path || state.currentFile || "";
  return {
    directoryPath: parentDirectoryPath(path),
    referencePath: path,
  };
}

async function promptNewDocument({ directoryPath = "", referencePath = "" } = {}) {
  if (!canEditCurrentRepo()) {
    showCopyToast("当前仓库不可新建文档");
    return;
  }
  let name = "";
  let format = "md";
  let errorMessage = "";
  while (true) {
    const { confirmed, values } = await showAppDialog({
      title: "新建文档",
      message: [newDocumentLocationMessage({ directoryPath, referencePath }), errorMessage]
        .filter(Boolean)
        .join("\n"),
      fields: [
        { id: "name", label: "文档名称", value: name, placeholder: "例如：活动复盘" },
        {
          id: "format",
          label: "文档格式",
          value: format,
          options: [
            { value: "md", label: "Markdown（推荐）" },
            { value: "mdx", label: "MDX（适合增强内容）" },
          ],
        },
      ],
      confirmText: "创建",
      cancelText: "取消",
    });
    if (!confirmed) {
      return;
    }
    name = values.name;
    format = values.format;
    const response = await fetch(apiUrl("/api/create-document"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: directoryPath, name, format }),
    });
    const payload = await response.json().catch(() => ({ error: "无法创建文档。" }));
    if (!response.ok) {
      errorMessage = payload.error || "无法创建文档，请重试。";
      continue;
    }
    await applyBranchProtectionPayload(payload);
    await loadTree({ force: true });
    await openFileInForegroundTab(payload.path);
    setMode("live");
    showCopyToast(`已创建 ${payload.path}`);
    return;
  }
}

function newDocumentLocationMessage({ directoryPath, referencePath }) {
  if (referencePath) {
    return `将与《${documentNameWithoutExtension(referencePath)}》放在一起。`;
  }
  if (directoryPath) {
    return `将在“${pathBasename(directoryPath)}”中创建。`;
  }
  return "将在仓库首页创建。";
}

async function revealPathInFinder(path) {
  try {
    const response = await fetch(apiUrl("/api/reveal-path", { path }));
    if (!response.ok) {
      throw new Error("Reveal path failed");
    }
  } catch {
    showCopyToast("无法在文件管理器中显示");
  }
}

function revealInFileManagerLabel() {
  if (isMacPlatform()) {
    return "在 Finder 中显示";
  }
  return /Win/.test(navigator.platform || "")
    ? "在文件资源管理器中显示"
    : "在文件管理器中显示";
}

async function copyPathValue(path) {
  try {
    await writeClipboard(path);
    showCopyToast("已复制路径");
  } catch {
    showCopyToast("复制失败");
  }
}

async function openPathWithSystem(path) {
  try {
    const response = await fetch(apiUrl("/api/open-source", { file: path }));
    if (!response.ok) {
      throw new Error("Open source file failed");
    }
  } catch {
    showCopyToast("无法使用系统应用打开文件");
  }
}

function parentDirectoryPath(path) {
  const parts = String(path || "").replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

function pathBasename(path) {
  return String(path || "").replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || "仓库首页";
}

function documentNameWithoutExtension(path) {
  return pathBasename(path).replace(/\.(?:md|mdx)$/i, "");
}

function isMarkdownPath(path) {
  return /\.(?:md|mdx)$/i.test(String(path || ""));
}

function renderNode(node, parentPath) {
  const item = document.createElement("li");
  if (node.type === "file") {
    const button = document.createElement("button");
    const capability = treeFileCapability(node.kind);
    button.type = "button";
    button.className = node.path === state.currentFile ? "tree-file is-active" : "tree-file";
    button.dataset.treeItem = "file";
    button.dataset.treePath = node.path;
    button.dataset.treeKind = node.kind || "unknown";
    button.dataset.fileCapability = capability.name;
    button.setAttribute("aria-label", `${node.path}，${capability.label}`);
    button.title = capability.label;
    const label = document.createElement("span");
    label.className = "tree-file-label";
    label.textContent = node.name;
    button.append(label);
    if (capability.badge) {
      const capabilityBadge = document.createElement("span");
      capabilityBadge.className = `tree-file-capability is-${capability.name}`;
      capabilityBadge.textContent = capability.badge;
      capabilityBadge.setAttribute("aria-hidden", "true");
      button.append(capabilityBadge);
    }
    const change = gitChangeForPath(node.path);
    if (change) {
      const badge = document.createElement("span");
      badge.className = `git-change-badge is-${change.status}`;
      badge.textContent = gitChangeBadgeLabel(change.status);
      badge.title = gitChangeStatusLabel(change.status);
      button.append(badge);
    }
    button.addEventListener("click", (event) => openFileFromTree(node.path, event));
    item.append(button);
    return item;
  }

  const directoryPath = treeDirectoryPath(parentPath, node.name);
  const details = document.createElement("details");
  details.open = shouldOpenTreeDirectory({
    directoryPath,
    hasBroadTreeFilter:
      state.filter.length > 0 ||
      state.frontmatterFilters.length > 0 ||
      state.showOnlyGitChanges,
    expandedDirectories: state.expandedTreeDirectories,
    collapsedDirectories: state.collapsedTreeDirectories,
  });
  let lastRenderedOpen = details.open;
  const summary = document.createElement("summary");
  summary.dataset.treeItem = "directory";
  summary.dataset.treePath = directoryPath;
  summary.tabIndex = 0;
  summary.setAttribute("aria-expanded", String(details.open));
  summary.textContent = node.name;
  details.append(summary);
  details.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(details.open));
    if (!shouldRecordTreeDirectoryToggle({
      previousOpen: lastRenderedOpen,
      nextOpen: details.open,
      programmatic: details.dataset.programmaticToggle === "true",
    })) {
      delete details.dataset.programmaticToggle;
      lastRenderedOpen = details.open;
      return;
    }

    delete details.dataset.programmaticToggle;
    lastRenderedOpen = details.open;
    recordTreeDirectoryToggle(directoryPath, details.open);
  });

  const children = document.createElement("ul");
  children.className = "tree-list";
  for (const child of node.children) {
    children.append(renderNode(child, directoryPath));
  }
  details.append(children);
  item.append(details);
  return item;
}

function treeFileCapability(kind) {
  if (kind === "markdown") {
    return { name: "editable", label: "可编辑文档", badge: "" };
  }
  if (["unsupported", "symlink", "submodule"].includes(kind)) {
    return { name: "unsupported", label: "暂不支持预览", badge: "不支持" };
  }
  if (kind === "unknown") {
    return { name: "unknown", label: "打开后检测预览能力", badge: "检测" };
  }
  return { name: "readonly", label: "只读预览", badge: "只读" };
}

function recordTreeDirectoryToggle(directoryPath, open) {
  if (open) {
    state.expandedTreeDirectories.add(directoryPath);
    state.collapsedTreeDirectories.delete(directoryPath);
  } else {
    state.collapsedTreeDirectories.add(directoryPath);
    state.expandedTreeDirectories.delete(directoryPath);
  }

  persistTreeDirectoryState();
}

function restoreSidebarWidth() {
  const stored = sidebarWidthFromStorageValue(
    preferenceValue("sidebarWidth", SIDEBAR_WIDTH_STORAGE_KEY),
  );
  setSidebarWidth(stored, { persist: false });
}

function restoreSidebarCollapsed() {
  const collapsed = sidebarCollapsedFromStorageValue(
    preferenceValue("sidebarCollapsed", SIDEBAR_COLLAPSED_STORAGE_KEY),
  );
  setSidebarCollapsed(collapsed, { persist: false });
}

function restoreDocumentOutlineCollapsed() {
  const collapsed = sidebarCollapsedFromStorageValue(
    preferenceValue(
      "documentOutlineCollapsed",
      DOCUMENT_OUTLINE_COLLAPSED_STORAGE_KEY,
    ),
  );
  setDocumentOutlineCollapsed(collapsed, { persist: false });
}

function restoreDocumentOutlineWidth() {
  const stored = documentOutlineWidthFromStorageValue(
    preferenceValue(
      "documentOutlineWidth",
      DOCUMENT_OUTLINE_WIDTH_STORAGE_KEY,
    ),
  );
  setDocumentOutlineWidth(stored, { persist: false });
}

function toggleDocumentOutline() {
  setDocumentOutlineCollapsed(!state.documentOutlineCollapsed);
}

function setDocumentOutlineCollapsed(collapsed, { persist = true } = {}) {
  state.documentOutlineCollapsed = Boolean(collapsed);
  documentBody.classList.toggle(
    "is-outline-collapsed",
    state.documentOutlineCollapsed,
  );
  documentOutlineToggle.setAttribute(
    "aria-expanded",
    String(!state.documentOutlineCollapsed),
  );
  const label = state.documentOutlineCollapsed
    ? "显示目录"
    : "隐藏目录";
  documentOutlineToggle.title = shortcutTooltip(label, "Command+Shift+B");
  documentOutlineToggle.setAttribute(
    "aria-label",
    shortcutTooltip(label, "Command+Shift+B"),
  );
  documentOutlineResizer.tabIndex = state.documentOutlineCollapsed ? -1 : 0;
  overflowTooltipController.hide();

  if (persist) {
    try {
      window.localStorage?.setItem(
        DOCUMENT_OUTLINE_COLLAPSED_STORAGE_KEY,
        String(state.documentOutlineCollapsed),
      );
    } catch {
      // Outline visibility is a convenience preference outside the desktop app.
    }
    persistAppPreference(
      "documentOutlineCollapsed",
      state.documentOutlineCollapsed,
    );
  }
}

function toggleSidebar() {
  setSidebarCollapsed(!state.sidebarCollapsed);
}

function setSidebarCollapsed(collapsed, { persist = true } = {}) {
  state.sidebarCollapsed = Boolean(collapsed);
  appShell.classList.toggle("is-sidebar-collapsed", state.sidebarCollapsed);
  sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
  const label = state.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏";
  sidebarToggle.title = shortcutTooltip(label, "Command+B");
  sidebarToggle.setAttribute("aria-label", shortcutTooltip(label, "Command+B"));
  sidebarResizer.tabIndex = state.sidebarCollapsed ? -1 : 0;

  if (state.sidebarCollapsed) {
    setAgentContextPopoverOpen(false);
    closeWorktreeSwitcher();
    overflowTooltipController.hide();
    hideFrontmatterFilterPopover();
    const activeElement = document.activeElement;
    if (sidebar.contains(activeElement) || workspaceSidebarHeader.contains(activeElement)) {
      focusActiveDocumentSurface();
    }
  }

  if (persist) {
    try {
      window.localStorage?.setItem(
        SIDEBAR_COLLAPSED_STORAGE_KEY,
        String(state.sidebarCollapsed),
      );
    } catch {
      // Sidebar visibility is a convenience preference outside the desktop app.
    }
    persistAppPreference("sidebarCollapsed", state.sidebarCollapsed);
  }
}

function startSidebarResize(event) {
  event.preventDefault();
  appShell.classList.add("is-resizing");
  sidebarResizer.setPointerCapture(event.pointerId);
  setSidebarWidth(event.clientX);

  const onPointerMove = (moveEvent) => setSidebarWidth(moveEvent.clientX);
  const onPointerUp = (upEvent) => {
    sidebarResizer.releasePointerCapture(upEvent.pointerId);
    appShell.classList.remove("is-resizing");
    sidebarResizer.removeEventListener("pointermove", onPointerMove);
    sidebarResizer.removeEventListener("pointerup", onPointerUp);
  };

  sidebarResizer.addEventListener("pointermove", onPointerMove);
  sidebarResizer.addEventListener("pointerup", onPointerUp);
}

function handleSidebarResizeKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }

  event.preventDefault();
  const currentWidth = Number.parseInt(
    appShell.style.getPropertyValue("--sidebar-width") || "320",
    10,
  );
  const delta = event.key === "ArrowLeft" ? -SIDEBAR_WIDTH_STEP : SIDEBAR_WIDTH_STEP;
  setSidebarWidth(currentWidth + delta);
}

function setSidebarWidth(width, { persist = true } = {}) {
  const nextWidth = clampSidebarWidth(width, window.innerWidth);
  appShell.style.setProperty("--sidebar-width", `${nextWidth}px`);
  sidebarResizer.setAttribute("aria-valuenow", String(nextWidth));
  overflowTooltipController.hide();
  if (persist) {
    window.localStorage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
    persistAppPreference("sidebarWidth", nextWidth);
  }
  positionFrontmatterFilterPopover();
}

function handleDocumentOutlineResizeKeydown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const delta = event.key === "ArrowLeft"
    ? -DOCUMENT_OUTLINE_WIDTH_STEP
    : DOCUMENT_OUTLINE_WIDTH_STEP;
  setDocumentOutlineWidth(currentDocumentOutlineWidth() + delta);
}

function setDocumentOutlineWidthFromPointer(clientX) {
  const bodyRect = documentBody.getBoundingClientRect();
  setDocumentOutlineWidth(clientX - bodyRect.left);
}

function currentDocumentOutlineWidth() {
  return Number.parseInt(
    documentBody.style.getPropertyValue("--document-outline-width")
      || String(DOCUMENT_OUTLINE_MIN_WIDTH),
    10,
  );
}

function setDocumentOutlineWidth(width, { persist = true } = {}) {
  const containerWidth = documentBody.getBoundingClientRect().width || window.innerWidth;
  const nextWidth = clampDocumentOutlineWidth(Number(width), containerWidth);
  documentBody.style.setProperty("--document-outline-width", `${nextWidth}px`);
  documentOutlineResizer.setAttribute("aria-valuemin", String(DOCUMENT_OUTLINE_MIN_WIDTH));
  documentOutlineResizer.setAttribute("aria-valuemax", String(DOCUMENT_OUTLINE_MAX_WIDTH));
  documentOutlineResizer.setAttribute("aria-valuenow", String(nextWidth));
  overflowTooltipController.hide();
  if (persist) {
    window.localStorage?.setItem(DOCUMENT_OUTLINE_WIDTH_STORAGE_KEY, String(nextWidth));
    persistAppPreference("documentOutlineWidth", nextWidth);
  }
}

function restoreSourceSplitRatio() {
  const stored = sourcePreviewRatioFromStorageValue(
    preferenceValue("sourcePreviewRatio", SOURCE_SPLIT_STORAGE_KEY),
  );
  setSourceSplitRatio(stored, { persist: false });
}

function startSourceSplitResize(event) {
  event.preventDefault();
  documentWorkspace.classList.add("is-resizing");
  sourceSplitter.setPointerCapture(event.pointerId);
  setSourceSplitRatioFromPointer(event.clientY);

  const onPointerMove = (moveEvent) => setSourceSplitRatioFromPointer(moveEvent.clientY);
  const onPointerUp = (upEvent) => {
    sourceSplitter.releasePointerCapture(upEvent.pointerId);
    documentWorkspace.classList.remove("is-resizing");
    sourceSplitter.removeEventListener("pointermove", onPointerMove);
    sourceSplitter.removeEventListener("pointerup", onPointerUp);
  };

  sourceSplitter.addEventListener("pointermove", onPointerMove);
  sourceSplitter.addEventListener("pointerup", onPointerUp);
}

function handleSourceSplitKeydown(event) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
    return;
  }

  event.preventDefault();
  const currentRatio = Number.parseFloat(
    documentWorkspace.style.getPropertyValue("--source-preview-height") || "45",
  );
  const delta = event.key === "ArrowUp" ? -SOURCE_SPLIT_STEP : SOURCE_SPLIT_STEP;
  setSourceSplitRatio(currentRatio + delta);
}

function setSourceSplitRatioFromPointer(clientY) {
  const rect = documentWorkspace.getBoundingClientRect();
  if (rect.height <= 0) {
    return;
  }
  setSourceSplitRatio(((clientY - rect.top) / rect.height) * 100);
}

function setSourceSplitRatio(value, { persist = true } = {}) {
  const ratio = clampSourcePreviewRatio(value);
  documentWorkspace.style.setProperty("--source-preview-height", `${ratio}%`);
  sourceSplitter.setAttribute("aria-valuenow", String(ratio));
  if (persist) {
    window.localStorage?.setItem(SOURCE_SPLIT_STORAGE_KEY, String(ratio));
    persistAppPreference("sourcePreviewRatio", ratio);
  }
}

function renderDocumentContent(documentData) {
  const kind = documentData.kind || "markdown";
  documentContent.dataset.documentKind = kind;
  documentContent.classList.toggle("is-readonly-preview", kind !== "markdown");
  if (kind === "markdown") {
    documentContent.innerHTML = documentData.html || "<p class=\"empty-message\">文档为空。</p>";
    enhanceImageLoadStates(documentContent);
    enhanceTables();
    scheduleListSourceLineGutterSync();
    renderDocumentOutline();
    return;
  }

  documentContent.replaceChildren(readonlyPreviewElement(documentData));
  documentOutline.hidden = true;
  documentOutlineResizer.hidden = true;
  documentOutlineToggle.hidden = true;
  documentOutline.innerHTML = "";
  documentBody.classList.remove("has-outline");
  state.outlineItems = [];
}

function readonlyPreviewElement(documentData) {
  if (documentData.textTruncated) {
    return readonlyMessage(
      "文件过大",
      `这个文件超过 ${formatBytes(documentData.textLimitBytes)}，请用“源文件”在系统应用中打开。`,
      { actionLabel: "使用系统应用打开", onAction: openCurrentSource },
    );
  }

  if (documentData.kind === "image") {
    const frame = document.createElement("figure");
    frame.className = "file-preview file-preview-image";
    const image = document.createElement("img");
    image.src = apiUrl("/raw", { file: documentData.path });
    image.alt = documentData.title || documentData.path;
    frame.append(image);
    attachImageLoadState(image);
    return frame;
  }

  if (["unsupported", "symlink", "submodule"].includes(documentData.kind)) {
    const label = documentData.kind === "symlink"
      ? "符号链接"
      : documentData.kind === "submodule"
        ? "Git Submodule"
        : documentData.extension
          ? `${documentData.extension.slice(1).toUpperCase()} 文件`
          : "未知文件";
    return readonlyMessage(
      "此文件类型暂时不支持预览",
      `${label} · ${formatBytes(documentData.size || 0)}。可以使用系统应用打开源文件。`,
      { actionLabel: "使用系统应用打开", onAction: openCurrentSource },
    );
  }

  if (documentData.kind === "pdf" || documentData.kind === "html") {
    const frame = document.createElement("iframe");
    frame.className = `file-preview-frame is-${documentData.kind}`;
    frame.title = documentData.title || documentData.path;
    frame.src = apiUrl("/raw", { file: documentData.path });
    return frame;
  }

  if (documentData.kind === "csv") {
    return csvPreviewElement(documentData.text ?? "");
  }

  if (documentData.kind === "json") {
    return jsonPreviewElement(documentData);
  }

  return codePreviewElement({
    text: documentData.text ?? "",
    language: documentData.kind,
    notice: documentData.parseError,
  });
}

function readonlyMessage(title, message, { actionLabel = "", onAction = null } = {}) {
  const container = document.createElement("section");
  container.className = "file-preview-message";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const body = document.createElement("p");
  body.textContent = message;
  container.append(heading, body);
  if (actionLabel && typeof onAction === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "file-preview-message-action";
    action.textContent = actionLabel;
    action.addEventListener("click", () => void onAction());
    container.append(action);
  }
  return container;
}

function codePreviewElement({ text, language, notice = "" }) {
  const container = document.createElement("section");
  container.className = "file-preview-code";
  if (notice) {
    const note = document.createElement("p");
    note.className = "file-preview-notice";
    note.textContent = notice;
    container.append(note);
  }

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = `language-${language || "text"}`;
  code.textContent = text || "";
  pre.append(code);
  container.append(pre);
  return container;
}

function csvPreviewElement(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return readonlyMessage("CSV 为空", "这个 CSV 文件没有可显示的内容。");
  }

  const container = document.createElement("section");
  container.className = "file-preview-table";
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const body = document.createElement("tbody");
  const [header, ...bodyRows] = rows;
  const headRow = document.createElement("tr");
  for (const cell of header) {
    const th = document.createElement("th");
    th.textContent = cell;
    headRow.append(th);
  }
  head.append(headRow);

  for (const row of bodyRows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.append(td);
    }
    body.append(tr);
  }

  table.append(head, body);
  scroll.append(table);
  container.append(scroll);
  return container;
}

function jsonPreviewElement(documentData) {
  try {
    const value = JSON.parse(documentData.text ?? "");
    const container = document.createElement("section");
    container.className = "file-preview-json";
    container.append(jsonTreeNode(value, { label: "root", depth: 0, root: true }));
    return container;
  } catch {
    return codePreviewElement({
      text: documentData.text ?? "",
      language: "json",
      notice: documentData.parseError || "JSON 解析失败，已按原始文本显示。",
    });
  }
}

function jsonTreeNode(value, { label, depth = 0, root = false } = {}) {
  const type = jsonValueType(value);
  const isBranch = type === "array" || type === "object";
  const node = document.createElement("div");
  node.className = `json-tree-node is-${type}`;

  if (!isBranch) {
    const row = document.createElement("div");
    row.className = "json-tree-row";
    if (!root) {
      const key = document.createElement("span");
      key.className = "json-tree-key";
      key.textContent = label;
      row.append(key, document.createTextNode(": "));
    }
    const primitive = document.createElement("span");
    primitive.className = `json-tree-value is-${type}`;
    primitive.textContent = jsonPrimitiveLabel(value, type);
    row.append(primitive);
    node.append(row);
    return node;
  }

  const entries = type === "array"
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const details = document.createElement("details");
  details.open = depth < 1;
  const summary = document.createElement("summary");
  summary.className = "json-tree-summary";
  if (!root) {
    const key = document.createElement("span");
    key.className = "json-tree-key";
    key.textContent = label;
    summary.append(key, document.createTextNode(": "));
  }
  const meta = document.createElement("span");
  meta.className = "json-tree-meta";
  meta.textContent = type === "array" ? `Array(${entries.length})` : `Object(${entries.length})`;
  summary.append(meta);
  details.append(summary);

  const children = document.createElement("div");
  children.className = "json-tree-children";
  for (const [childLabel, childValue] of entries) {
    children.append(jsonTreeNode(childValue, {
      label: childLabel,
      depth: depth + 1,
    }));
  }
  details.append(children);
  node.append(details);
  return node;
}

function jsonValueType(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value === "object" ? "object" : typeof value;
}

function jsonPrimitiveLabel(value, type) {
  if (type === "string") {
    return JSON.stringify(value);
  }
  if (type === "null") {
    return "null";
  }
  return String(value);
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((cellValue) => cellValue.length > 0));
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "0 B";
  }
  if (number < 1024) {
    return `${number} B`;
  }
  if (number < 1024 * 1024) {
    return `${(number / 1024).toFixed(1)} KB`;
  }
  return `${(number / 1024 / 1024).toFixed(1)} MB`;
}

function renderDocumentOutline() {
  overflowTooltipController.hide();
  outlineClickViewportGuard.end();
  const headings = [...documentContent.querySelectorAll("h1, h2, h3")].map((heading) => {
    const sourceLine = Number(heading.closest(".source-block")?.dataset.sourceStart);
    return {
      id: heading.id,
      text: heading.textContent,
      tagName: heading.tagName,
      sourceLine: Number.isInteger(sourceLine) ? sourceLine : undefined,
    };
  });
  state.outlineItems = outlineItemsFromHeadings(headings);
  documentOutline.innerHTML = "";
  documentOutline.hidden = state.outlineItems.length === 0;
  documentOutlineResizer.hidden = state.outlineItems.length === 0;
  documentOutlineResizer.tabIndex =
    state.outlineItems.length === 0 || state.documentOutlineCollapsed ? -1 : 0;
  documentOutlineToggle.hidden = state.outlineItems.length === 0;
  documentBody.classList.toggle("has-outline", state.outlineItems.length > 0);
  if (state.outlineItems.length === 0) {
    return;
  }

  const header = document.createElement("div");
  header.className = "document-outline-header";
  header.textContent = "导航";
  const list = document.createElement("ul");
  list.className = "outline-list";
  for (const item of state.outlineItems) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `outline-link depth-${item.depth}`;
    button.dataset.outlineTarget = item.id;
    if (Number.isInteger(item.sourceLine)) {
      button.dataset.sourceLine = String(item.sourceLine);
    }
    button.textContent = item.title;
    listItem.append(button);
    list.append(listItem);
  }
  documentOutline.append(header, list);
  updateActiveOutline(activeOutlineIdFromScroll());
}

function handleOutlineClick(event) {
  const button = event.target.closest("[data-outline-target]");
  if (!button) {
    return;
  }

  if (state.mode === "live" && state.sourceEditor) {
    const sourceLine = Number(button.dataset.sourceLine);
    outlineClickViewportGuard.begin();
    state.sourceEditor.scrollToLine(sourceLine);
    updateActiveOutline(button.dataset.outlineTarget, { preserveViewport: true });
    return;
  }

  const heading = document.getElementById(button.dataset.outlineTarget);
  outlineClickViewportGuard.begin();
  heading?.scrollIntoView({ block: "start" });
  updateActiveOutline(button.dataset.outlineTarget, { preserveViewport: true });
}

function handleOutlineContentNavigationIntent(event) {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target?.closest("#document-content, #source-editor-pane")) {
    return;
  }
  if (event.type === "keydown" && !OUTLINE_CONTENT_NAVIGATION_KEYS.has(event.key)) {
    return;
  }
  outlineClickViewportGuard.end();
}

function updateActiveOutlineFromContentScroll(activeId) {
  const preserveViewport = outlineClickViewportGuard.preserveForContentScroll();
  updateActiveOutline(activeId, { preserveViewport });
}

function updateActiveOutline(activeId, { preserveViewport = false } = {}) {
  const previousActiveButton = documentOutline.querySelector(".outline-link.is-active");
  let activeButton;
  for (const button of documentOutline.querySelectorAll("[data-outline-target]")) {
    const isActive = button.dataset.outlineTarget === activeId;
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      activeButton = button;
    }
  }
  if (!preserveViewport && activeButton && activeButton !== previousActiveButton) {
    centerActiveOutlineButton(activeButton);
  } else if (!preserveViewport && !activeButton && previousActiveButton) {
    documentOutline.scrollTo({ top: 0, left: 0 });
  }
}

function centerActiveOutlineButton(activeButton) {
  const outlineRect = documentOutline.getBoundingClientRect();
  const activeRect = activeButton.getBoundingClientRect();
  const centeredTop = Math.max(
    0,
    documentOutline.scrollTop
      + activeRect.top
      - outlineRect.top
      - (outlineRect.height - activeRect.height) / 2,
  );
  documentOutline.scrollTo({ top: centeredTop, left: 0 });
}

function activeOutlineIdFromScroll() {
  const contentTop = documentContent.getBoundingClientRect().top;
  let activeId;
  for (const item of state.outlineItems) {
    const heading = document.getElementById(item.id);
    if (!heading) {
      continue;
    }
    if (heading.getBoundingClientRect().top <= contentTop + 96) {
      activeId = item.id;
    }
  }
  return activeId;
}

function filterNodes(nodes) {
  if (!state.filter) {
    return nodes;
  }

  const filtered = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (fileMatchesTextFilter(node, state.frontmatterFiles[node.path], state.filter)) {
        filtered.push(node);
      }
      continue;
    }

    const directoryMatches = node.name.toLowerCase().includes(state.filter);
    const children = directoryMatches ? node.children : filterNodes(node.children);
    if (children.length > 0 || directoryMatches) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

function filterNodesByFrontmatter(nodes) {
  if (state.frontmatterFilters.length === 0) {
    return nodes;
  }

  const filtered = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (
        fileMatchesFrontmatterFilters(
          state.frontmatterFiles[node.path],
          state.frontmatterFilters,
          state.frontmatterAllowedKeys,
        )
      ) {
        filtered.push(node);
      }
      continue;
    }

    const children = filterNodesByFrontmatter(node.children);
    if (children.length > 0) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

function filterNodesByGitChanges(nodes) {
  if (!state.showOnlyGitChanges) {
    return nodes;
  }

  const changedPaths = gitChangedPaths();
  const filtered = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (changedPaths.has(node.path)) {
        filtered.push(node);
      }
      continue;
    }

    const children = filterNodesByGitChanges(node.children);
    if (children.length > 0) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

function renderGitChangeToolbar() {
  const hasChanges = state.gitChanges.length > 0;
  const canUseGitSync = canEditCurrentRepo() && hasChanges;
  gitChangeToolbar.hidden = !canUseGitSync;
  gitChangeCount.textContent = String(state.gitChanges.length);
  gitChangesToggle.classList.toggle("is-active", state.showOnlyGitChanges);
  gitChangesToggle.setAttribute("aria-pressed", String(state.showOnlyGitChanges));
  gitSyncOpen.disabled = !canUseGitSync;
  if (!canUseGitSync) {
    closeGitSyncPanel();
  }
}

function toggleGitChangesFilter() {
  state.showOnlyGitChanges = !state.showOnlyGitChanges;
  restoreTreeDirectoryState();
  renderGitChangeToolbar();
  renderTree();
}

function gitChangedPaths() {
  return new Set(state.gitChanges.map((change) => change.path));
}

function gitChangeForPath(filePath) {
  return state.gitChanges.find((change) => change.path === filePath);
}

function gitChangeBadgeLabel(status) {
  if (status === "added") {
    return "+";
  }
  if (status === "untracked") {
    return "?";
  }
  if (status === "deleted") {
    return "D";
  }
  if (status === "renamed") {
    return "R";
  }
  if (status === "copied") {
    return "C";
  }
  return "M";
}

function gitChangeStatusLabel(status) {
  if (status === "added") {
    return "已新增";
  }
  if (status === "untracked") {
    return "未跟踪";
  }
  if (status === "deleted") {
    return "已删除";
  }
  if (status === "renamed") {
    return "已重命名";
  }
  if (status === "copied") {
    return "已复制";
  }
  return "已修改";
}

function closeGitSyncPanel() {
  if (!gitSyncPanel || gitSyncPanel.hidden) {
    return;
  }
  gitSyncPanel.hidden = true;
}

function handleGitSyncPanelBackdropClick(event) {
  if (event.target === gitSyncPanel) {
    closeGitSyncPanel();
  }
}

async function submitGitSync() {
  if (!canEditCurrentRepo() || state.gitChanges.length === 0 || gitSyncOpen.disabled) {
    return;
  }

  const files = state.gitChanges.map((change) => change.path);
  const startedAt = performance.now();
  gitSyncOpen.disabled = true;
  gitSyncOpen.textContent = "正在同步…";
  gitSyncResult.hidden = true;
  try {
    await flushPendingSourceSync();
    const response = await fetch(apiUrl("/api/git-sync"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allChanges: true,
      }),
    });
    const payload = await response.json().catch(() => ({
      ok: false,
      step: "git-sync",
      error: "同步接口返回了不可解析的结果。",
    }));
    await applyBranchProtectionPayload(payload);

    if (!response.ok || payload.ok === false) {
      recordTelemetryFeature("git.sync", {
        strategy: "guarded_live_v1",
        result: "error",
        file_count_bucket: itemCountBucket(files.length),
        error_code: gitSyncTelemetryErrorCode(payload.step),
        drift_kind: gitSyncDriftKind(payload.driftKind),
        retry_bucket: retryCountBucket(payload.retryCount),
        duration_bucket: durationBucket(performance.now() - startedAt),
      });
      showGitSyncFailure({
        ...payload,
        files,
        agentPrompt: payload.agentPrompt || clientGitSyncAgentPrompt({
          files,
          step: payload.step || "git-sync",
          error: payload.error || "同步失败。",
        }),
      });
      return;
    }

    closeGitSyncPanel();
    recordTelemetryFeature("git.sync", {
      strategy: "guarded_live_v1",
      result: "success",
      file_count_bucket: itemCountBucket(files.length),
      drift_kind: gitSyncDriftKind(payload.driftKind),
      retry_bucket: retryCountBucket(payload.retryCount),
      duration_bucket: durationBucket(performance.now() - startedAt),
    });
    showCopyToast("同步完成");
    await loadTree({ force: true });
    await loadGitStatus();
  } catch (error) {
    recordTelemetryFeature("git.sync", {
      strategy: "guarded_live_v1",
      result: "error",
      file_count_bucket: itemCountBucket(files.length),
      error_code: "unknown",
      drift_kind: "none",
      retry_bucket: "0",
      duration_bucket: durationBucket(performance.now() - startedAt),
    });
    showGitSyncFailure({
      files,
      step: "git-sync",
      error: error instanceof Error ? error.message : "同步失败。",
      agentPrompt: clientGitSyncAgentPrompt({
        files,
        step: "git-sync",
        error: error instanceof Error ? error.message : "同步失败。",
      }),
    });
  } finally {
    gitSyncOpen.textContent = "同步";
    gitSyncOpen.disabled = !canEditCurrentRepo() || state.gitChanges.length === 0;
  }
}

function showGitSyncFailure(payload) {
  overflowTooltipController.hide();
  gitSyncPanel.hidden = false;
  gitSyncResult.hidden = false;
  gitSyncResultTitle.textContent = payload.resultTitle || "同步遇到异常";
  gitSyncResultHelp.textContent = payload.resultHelp
    || "点击复制提示词，然后粘贴到你选择的 AI Agent 中继续处理。";
  gitSyncAgentPrompt.value = payload.agentPrompt || clientGitSyncAgentPrompt(payload);
  gitSyncCopyPrompt.disabled = false;
}

async function copyGitSyncAgentPrompt() {
  try {
    await writeClipboard(gitSyncAgentPrompt.value);
    showCopyToast("已复制提示词");
  } catch {
    showCopyToast("复制失败");
  }
}

function showAppDialog({
  title,
  message = "",
  content = null,
  inputLabel = "",
  inputValue = "",
  fields = [],
  confirmText = "确定",
  cancelText = "取消",
  showCancel = true,
  showConfirm = true,
  variant = "",
  initialFocus = "confirm",
} = {}) {
  if (state.activeDialog) {
    closeAppDialog(false);
  }

  overflowTooltipController.hide();
  appDialogTitle.textContent = title || "确认操作";
  appDialogMessage.textContent = message;
  appDialogMessage.hidden = !message;
  appDialogContent.replaceChildren();
  if (content) {
    appDialogContent.append(content);
    appDialogContent.hidden = false;
  } else {
    appDialogContent.hidden = true;
  }
  appDialogConfirm.textContent = confirmText;
  appDialogConfirm.hidden = !showConfirm;
  appDialogCancel.textContent = cancelText;
  appDialogCancel.hidden = !showCancel;
  appDialogActions.hidden = !showConfirm && !showCancel;
  appDialog.classList.toggle("is-shortcuts", variant === "shortcuts");
  appDialogCard.dataset.variant = variant;
  const normalizedFields = normalizeDialogFields(fields);
  appDialogInput.value = inputValue;
  appDialogInputLabel.textContent = inputLabel;
  appDialogInputWrap.hidden = normalizedFields.length > 0 || !inputLabel;
  renderAppDialogFields(normalizedFields);
  appDialog.hidden = false;

  const previousFocus = document.activeElement;
  return new Promise((resolve) => {
    state.activeDialog = {
      previousFocus,
      resolve,
      fieldIds: normalizedFields.map((field) => field.id),
    };
    window.requestAnimationFrame(() => {
      const firstFieldInput = appDialogFields.querySelector("input, select");
      if (firstFieldInput) {
        firstFieldInput.focus({ preventScroll: true });
        firstFieldInput.select?.();
      } else if (inputLabel) {
        appDialogInput.focus({ preventScroll: true });
        appDialogInput.select();
      } else if (initialFocus === "close" || !showConfirm) {
        appDialogClose.focus({ preventScroll: true });
      } else {
        appDialogConfirm.focus({ preventScroll: true });
      }
    });
  });
}

function closeAppDialog(confirmed) {
  const activeDialog = state.activeDialog;
  if (!activeDialog) {
    appDialog.hidden = true;
    return;
  }

  state.activeDialog = null;
  appDialog.hidden = true;
  activeDialog.resolve({
    confirmed,
    value: confirmed ? appDialogInput.value : "",
    values: confirmed ? appDialogValues(activeDialog.fieldIds) : {},
  });
  appDialogFields.replaceChildren();
  appDialogContent.replaceChildren();
  appDialogContent.hidden = true;
  appDialogMessage.hidden = false;
  appDialogFields.hidden = true;
  appDialogCancel.hidden = false;
  appDialogConfirm.hidden = false;
  appDialogActions.hidden = false;
  appDialog.classList.remove("is-shortcuts");
  appDialogCard.dataset.variant = "";
  activeDialog.previousFocus?.focus?.({ preventScroll: true });
}

function normalizeDialogFields(fields) {
  return Array.isArray(fields)
    ? fields
      .map((field) => ({
        id: String(field.id ?? "").trim(),
        label: String(field.label ?? field.id ?? "").trim(),
        value: String(field.value ?? ""),
        placeholder: String(field.placeholder ?? ""),
        options: normalizeDialogFieldOptions(field.options),
      }))
      .filter((field) => field.id && field.label)
    : [];
}

function normalizeDialogFieldOptions(options) {
  return Array.isArray(options)
    ? options
      .map((option) => ({
        label: String(option?.label ?? option ?? "").trim(),
        value: String(option?.value ?? option ?? "").trim(),
      }))
      .filter((option) => option.label && option.value)
    : [];
}

function renderAppDialogFields(fields) {
  appDialogFields.replaceChildren();
  appDialogFields.hidden = fields.length === 0;
  for (const field of fields) {
    const label = document.createElement("label");
    label.className = "app-dialog-field";
    const text = document.createElement("span");
    text.textContent = field.label;
    const control = field.options.length > 0
      ? document.createElement("select")
      : document.createElement("input");
    if (control.tagName === "INPUT") {
      control.type = "text";
      control.placeholder = field.placeholder;
    } else {
      for (const option of field.options) {
        const optionElement = document.createElement("option");
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        control.append(optionElement);
      }
    }
    control.value = field.value;
    control.dataset.dialogField = field.id;
    label.append(text, control);
    appDialogFields.append(label);
  }
}

function appDialogValues(fieldIds = []) {
  const values = {};
  for (const fieldId of fieldIds) {
    values[fieldId] = appDialogFields.querySelector(`[data-dialog-field="${cssEscape(fieldId)}"]`)?.value ?? "";
  }
  return values;
}

function handleAppDialogBackdropClick(event) {
  if (event.target === appDialog) {
    closeAppDialog(false);
  }
}

function handleAppDialogInputKeydown(event) {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    closeAppDialog(true);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeAppDialog(false);
  }
}

function handleAppDialogKeydown(event) {
  if (
    event.key === "Enter" &&
    !event.isComposing &&
    event.target.closest?.("#app-dialog-fields input, #app-dialog-fields select")
  ) {
    event.preventDefault();
    closeAppDialog(true);
    return;
  }
  if (event.key !== "Escape") {
    return;
  }

  event.preventDefault();
  closeAppDialog(false);
}

function handleAppShortcutKeydown(event) {
  if (event.target.closest?.("#app-dialog, #git-sync-panel")) {
    return;
  }

  const action = shortcutActionFromKeyboardEvent(event);
  if (!action) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void runAppShortcut(action);
}

function shortcutActionFromKeyboardEvent(event) {
  const key = String(event.key || "").toLowerCase();
  if (event.isComposing) {
    return null;
  }

  if (event.altKey) {
    return null;
  }

  if (event.metaKey && event.shiftKey && event.code === "BracketLeft") {
    return { command: "previous-tab" };
  }

  if (event.metaKey && event.shiftKey && event.code === "BracketRight") {
    return { command: "next-tab" };
  }

  if (!event.metaKey && event.ctrlKey && key === "tab") {
    return { command: event.shiftKey ? "previous-tab" : "next-tab" };
  }

  if (!event.shiftKey && isPrimaryShortcut(event) && event.code === "BracketLeft") {
    return { command: "history-back" };
  }

  if (!event.shiftKey && isPrimaryShortcut(event) && event.code === "BracketRight") {
    return { command: "history-forward" };
  }

  if (!isPrimaryShortcut(event)) {
    return null;
  }

  if (!event.shiftKey && key === "b") {
    return { command: "toggle-sidebar" };
  }

  if (event.shiftKey && key === "b") {
    return { command: "toggle-document-outline" };
  }

  if (event.shiftKey && key === "c") {
    return { command: "copy-document-path" };
  }

  if (event.shiftKey && key === "l") {
    return { command: "copy-document-share-link" };
  }

  if (event.shiftKey && key === "g") {
    return { command: "open-document-github" };
  }

  if (event.shiftKey && key === "o") {
    return { command: "open-document-source" };
  }

  if (event.shiftKey && key === "r") {
    return { command: "reveal-file-manager" };
  }

  if (event.shiftKey && key === "e") {
    return { command: "focus-file-tree" };
  }

  if (!event.shiftKey && (event.key === "w" || event.key === "W")) {
    return { command: "close-current-tab" };
  }

  if (!event.shiftKey && /^[1-8]$/.test(key)) {
    return { command: "switch-tab-at-index", index: Number(key) - 1 };
  }

  if (!event.shiftKey && key === "9") {
    return { command: "switch-last-tab" };
  }

  if (!event.shiftKey && key === "p") {
    return { command: "set-mode", mode: "preview" };
  }

  if (!event.shiftKey && key === "s") {
    return { command: "set-mode", mode: "source" };
  }

  if (!event.shiftKey && key === "l") {
    return { command: "set-mode", mode: "live" };
  }

  if (!event.shiftKey && key === "k") {
    return { command: "focus-file-search" };
  }

  if (!event.shiftKey && key === "f") {
    return { command: "find-in-document" };
  }

  if (key === "/" || key === "?") {
    return { command: "show-keyboard-shortcuts" };
  }

  return null;
}

async function runAppShortcut(action) {
  const command = typeof action === "string" ? action : action?.command;
  switch (command) {
    case "previous-tab":
      await switchToAdjacentDocumentTab(-1);
      return;
    case "next-tab":
      await switchToAdjacentDocumentTab(1);
      return;
    case "history-back":
      window.history.back();
      return;
    case "history-forward":
      window.history.forward();
      return;
    case "toggle-sidebar":
      toggleSidebar();
      return;
    case "toggle-document-outline":
      toggleDocumentOutline();
      return;
    case "switch-tab-at-index":
      await switchToDocumentTabAtIndex(Number(action.index));
      return;
    case "switch-last-tab":
      await switchToDocumentTabAtIndex(state.documentTabs.length - 1);
      return;
    case "close-current-tab": {
      const target = fileActionMenuShortcutTarget("close-tab");
      if (target) {
        closeFileActionMenu();
        await closeTab(target.path);
        return;
      }
      closeActiveDocumentTab();
      return;
    }
    case "set-mode":
      setMode(action.mode);
      return;
    case "focus-file-search":
      focusFileSearch();
      return;
    case "focus-file-tree":
      focusFileTree();
      return;
    case "find-in-document":
      openDocumentSearch();
      return;
    case "copy-document-path": {
      const target = fileActionMenuShortcutTarget("copy-path");
      if (target) {
        closeFileActionMenu();
        await copyPathValue(target.path);
        return;
      }
      await copyCurrentPath();
      return;
    }
    case "copy-document-share-link": {
      const target = fileActionMenuShortcutTarget("copy-share");
      if (target) {
        closeFileActionMenu();
        await copyShareLinkForPath(target.path);
        return;
      }
      await copyCurrentShareLink();
      return;
    }
    case "open-document-github":
      openCurrentGithub();
      return;
    case "open-document-source": {
      const target = fileActionMenuShortcutTarget("open-system");
      if (target) {
        closeFileActionMenu();
        await openPathWithSystem(target.path);
        return;
      }
      await openCurrentSource();
      return;
    }
    case "reveal-file-manager": {
      const target = fileActionMenuShortcutTarget("reveal-finder");
      if (target) {
        closeFileActionMenu();
        await revealPathInFinder(target.path);
        return;
      }
      if (state.currentDocument && canEditCurrentRepo()) {
        await revealPathInFinder(state.currentDocument.path);
      }
      return;
    }
    case "show-keyboard-shortcuts":
      showKeyboardShortcutsDialog();
      return;
    case "show-git-leaf-help":
      showGitLeafHelpDialog();
      return;
    default:
      return;
  }
}

function handleDesktopShortcutEvent(event) {
  event.preventDefault();
  void runAppShortcut(event.detail);
}

function handleDesktopUpdateStatusEvent(event) {
  event.preventDefault();
  renderSidebarUpdateStatus(event.detail);
  const message = desktopUpdateStatusMessage(event.detail);
  if (message && ["checking", "current", "error", "skipped"].includes(event.detail?.state)) {
    showCopyToast(message);
  }
}

function renderSidebarUpdateStatus(status) {
  const view = sidebarUpdateView(status);
  if (!desktopUpdatePanel) {
    return;
  }
  desktopUpdatePanel.hidden = view.hidden;
  if (view.hidden) {
    return;
  }
  desktopUpdateTitle.textContent = view.title;
  desktopUpdateDetail.textContent = view.detail;
  desktopUpdateAction.textContent = view.actionLabel;
  desktopUpdateAction.hidden = !view.actionLabel;
  desktopUpdateAction.disabled = view.actionDisabled;
}

function requestDesktopUpdateInstall() {
  window.open("git-leaf://install-update", "_blank", "noopener");
}

function openDocumentSearch() {
  if (documentSearch.hidden) {
    state.documentSearchReturnFocus = document.activeElement;
    documentSearch.hidden = false;
    if (!state.documentSearchQuery) {
      state.documentSearchQuery = selectedDocumentSearchText();
    }
    documentSearchInput.value = state.documentSearchQuery;
    refreshDocumentSearch({ preserveIndex: false, reveal: Boolean(state.documentSearchQuery) });
    if (state.documentSearchQuery.trim() && !documentSearchTelemetryActive) {
      recordTelemetryFeature("navigation.document_search");
      documentSearchTelemetryActive = true;
    }
  }

  window.requestAnimationFrame(() => {
    documentSearchInput.focus({ preventScroll: true });
    documentSearchInput.select();
  });
}

function closeDocumentSearch({ restoreFocus = true } = {}) {
  if (documentSearch.hidden) {
    return;
  }

  documentSearch.hidden = true;
  clearDocumentSearchPresentation();
  state.documentSearchMatches = [];
  state.documentSearchIndex = -1;
  documentSearchTelemetryActive = false;
  updateDocumentSearchControls();

  if (!restoreFocus) {
    state.documentSearchReturnFocus = null;
    return;
  }

  const returnFocus = state.documentSearchReturnFocus;
  state.documentSearchReturnFocus = null;
  if (
    returnFocus?.isConnected &&
    !documentSearch.contains(returnFocus) &&
    !returnFocus.closest?.("[hidden]")
  ) {
    returnFocus.focus?.({ preventScroll: true });
    return;
  }
  focusActiveDocumentSurface();
}

function handleDocumentSearchInput() {
  state.documentSearchQuery = documentSearchInput.value;
  if (state.documentSearchQuery.trim() && !documentSearchTelemetryActive) {
    recordTelemetryFeature("navigation.document_search");
    documentSearchTelemetryActive = true;
  } else if (!state.documentSearchQuery.trim()) {
    documentSearchTelemetryActive = false;
  }
  state.documentSearchIndex = -1;
  refreshDocumentSearch({ preserveIndex: false, reveal: true });
}

function handleDocumentSearchKeydown(event) {
  if (event.isComposing) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeDocumentSearch();
    return;
  }
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  moveDocumentSearch(event.shiftKey ? -1 : 1);
}

function moveDocumentSearch(direction) {
  if (state.documentSearchMatches.length === 0) {
    return;
  }
  state.documentSearchIndex = nextSearchIndex(
    state.documentSearchIndex,
    state.documentSearchMatches.length,
    direction,
  );
  applyDocumentSearchPresentation({ reveal: true });
}

function refreshDocumentSearch({ preserveIndex = true, reveal = false } = {}) {
  if (documentSearch.hidden) {
    return;
  }

  clearDocumentSearchPresentation();
  const query = state.documentSearchQuery;
  if (!query || !state.currentDocument) {
    state.documentSearchMatches = [];
    state.documentSearchIndex = -1;
    updateDocumentSearchControls();
    return;
  }

  if (isEditorMode() && state.sourceEditor) {
    state.documentSearchMatches = state.sourceEditor.findMatches(query);
  } else {
    state.documentSearchMatches = findTextRanges(documentContent, query);
  }

  if (state.documentSearchMatches.length === 0) {
    state.documentSearchIndex = -1;
  } else if (
    !preserveIndex ||
    state.documentSearchIndex < 0 ||
    state.documentSearchIndex >= state.documentSearchMatches.length
  ) {
    state.documentSearchIndex = 0;
  }
  applyDocumentSearchPresentation({ reveal });
}

function applyDocumentSearchPresentation({ reveal = false } = {}) {
  clearDocumentSearchPresentation();
  if (state.documentSearchMatches.length === 0) {
    updateDocumentSearchControls();
    return;
  }

  if (isEditorMode() && state.sourceEditor) {
    state.sourceEditor.setSearchMatches(
      state.documentSearchMatches,
      state.documentSearchIndex,
      { reveal },
    );
  } else {
    applyPreviewDocumentSearchHighlights();
    if (reveal) {
      revealPreviewDocumentSearchMatch(state.documentSearchMatches[state.documentSearchIndex]);
    }
  }
  updateDocumentSearchControls();
}

function applyPreviewDocumentSearchHighlights() {
  if (!window.CSS?.highlights || typeof window.Highlight !== "function") {
    return;
  }
  const ranges = state.documentSearchMatches.map((match) => match.range).filter(Boolean);
  if (ranges.length > 0) {
    window.CSS.highlights.set(DOCUMENT_SEARCH_MATCH_HIGHLIGHT, new window.Highlight(...ranges));
  }
  const activeRange = state.documentSearchMatches[state.documentSearchIndex]?.range;
  if (activeRange) {
    window.CSS.highlights.set(DOCUMENT_SEARCH_ACTIVE_HIGHLIGHT, new window.Highlight(activeRange));
  }
}

function revealPreviewDocumentSearchMatch(match) {
  const target = match?.range?.startContainer?.parentElement;
  target?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
}

function clearDocumentSearchPresentation() {
  if (window.CSS?.highlights) {
    window.CSS.highlights.delete(DOCUMENT_SEARCH_MATCH_HIGHLIGHT);
    window.CSS.highlights.delete(DOCUMENT_SEARCH_ACTIVE_HIGHLIGHT);
  }
  state.sourceEditor?.clearSearchMatches?.();
}

function updateDocumentSearchControls() {
  const matchCount = state.documentSearchMatches.length;
  const current = state.documentSearchIndex >= 0 ? state.documentSearchIndex + 1 : 0;
  documentSearchCount.textContent = `${current} / ${matchCount}`;
  documentSearchPrevious.disabled = matchCount === 0;
  documentSearchNext.disabled = matchCount === 0;
  documentSearch.classList.toggle(
    "has-no-results",
    Boolean(state.documentSearchQuery) && matchCount === 0,
  );
}

function selectedDocumentSearchText() {
  const selected = isEditorMode()
    ? state.sourceEditor?.selectedText?.()
    : window.getSelection?.()?.toString();
  const value = String(selected ?? "").trim();
  return value && value.length <= 160 && !/[\r\n]/.test(value) ? value : "";
}

function desktopUpdateStatusMessage(status) {
  if (typeof status?.message === "string" && status.message.trim()) {
    return status.message.trim();
  }

  switch (status?.state) {
    case "checking":
      return "正在检查更新…";
    case "downloading":
      return "正在下载并准备新版本…";
    case "downloaded":
      return "新版本已准备好，退出 Git Leaf 后自动安装。";
    case "available":
      return "发现新版本，点击更新后开始下载。";
    case "current":
      return "Git Leaf 已经是最新版本。";
    case "error":
      return "检查更新失败。";
    default:
      return "";
  }
}

function isPrimaryShortcut(event) {
  return event.metaKey || event.ctrlKey;
}

function closeActiveDocumentTab() {
  if (!state.activeTabPath) {
    return;
  }
  void closeTab(state.activeTabPath);
}

async function switchToDocumentTabAtIndex(index) {
  const tab = state.documentTabs[index];
  if (!tab) {
    return;
  }
  if (tab.path === state.activeTabPath) {
    focusActiveDocumentSurface();
    return;
  }
  await openFile(tab.path);
  focusActiveDocumentSurface();
}

async function switchToAdjacentDocumentTab(direction) {
  if (state.documentTabs.length < 2) {
    return;
  }
  const activeIndex = state.documentTabs.findIndex((tab) => tab.path === state.activeTabPath);
  const currentIndex = activeIndex >= 0 ? activeIndex : 0;
  const nextIndex = (currentIndex + direction + state.documentTabs.length) % state.documentTabs.length;
  await switchToDocumentTabAtIndex(nextIndex);
}

function focusFileSearch() {
  if (state.sidebarCollapsed) {
    setSidebarCollapsed(false);
  }
  treeFilter.focus({ preventScroll: true });
  treeFilter.select();
}

function focusActiveDocumentSurface() {
  if (!state.currentDocument) {
    return;
  }
  if (isEditorMode() && state.sourceEditor) {
    state.sourceEditor.focus();
    return;
  }
  focusPreviewDocumentContent();
}

function focusPreviewDocumentContent() {
  if (state.mode !== "preview" || !state.currentDocument) {
    return;
  }
  documentContent.focus({ preventScroll: true });
}

function focusFileTree({ preferActive = true } = {}) {
  if (state.sidebarCollapsed) {
    setSidebarCollapsed(false);
  }
  const items = visibleTreeItems();
  if (items.length === 0) {
    return;
  }

  const activeItem = preferActive
    ? items.find((item) => item.dataset.treePath === state.currentFile)
    : null;
  focusTreeItem(activeItem || items[0]);
}

function handleTreeFilterKeydown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    focusFileTree();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    openFirstSearchResult();
  }
}

function openFirstSearchResult() {
  const fileItems = visibleTreeItems().filter((item) => item.dataset.treeItem === "file");
  if (fileItems.length === 0) {
    return;
  }

  const normalizedFilter = treeFilter.value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const target = fileItems.find((item) => item.dataset.treePath === normalizedFilter) || fileItems[0];
  if (target?.dataset.treePath) {
    void openFileFromTree(target.dataset.treePath);
  }
}

function handleFileTreeFocusIn(event) {
  const snapshot = treeFocusSnapshot(event.target);
  if (!snapshot) {
    return;
  }

  state.lastTreeFocus = snapshot;
  scheduleWorkbenchSessionPersist();
}

function handleFileTreeKeydown(event) {
  const item = currentTreeItem(event.target);
  if (!item || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusAdjacentTreeItem(1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    focusAdjacentTreeItem(-1);
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    expandOrEnterTreeDirectory(item);
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    collapseOrLeaveTreeDirectory(item);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    activateTreeItem(item);
  }
}

function visibleTreeItems() {
  return [...fileTree.querySelectorAll("[data-tree-item]")].filter(isVisibleTreeItem);
}

function treeFocusSnapshot() {
  const item = currentTreeItem();
  if (!item) {
    return null;
  }

  return {
    itemType: item.dataset.treeItem || "",
    path: item.dataset.treePath || "",
  };
}

function restoreTreeFocus(snapshot) {
  if (!snapshot) {
    return;
  }

  const item = treeItemByPath(snapshot.path, snapshot.itemType) ||
    treeItemByPath(state.currentFile) ||
    visibleTreeItems()[0];
  if (item) {
    focusTreeItem(item, { persist: false });
  }
}

function restoreWorkbenchTreeViewportIfPending() {
  if (!state.pendingWorkbenchTreeViewportRestore) {
    return;
  }

  const session = workbenchSessionForRepo(state.workbenchSessions, state.currentWorktreeId);
  state.pendingWorkbenchTreeViewportRestore = false;
  if (!session) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (session.treeFocus) {
      const item = treeItemByPath(session.treeFocus.path, session.treeFocus.itemType);
      if (item) {
        item.focus({ preventScroll: true });
        state.lastTreeFocus = session.treeFocus;
      }
    }
    if (Number.isFinite(session.treeScrollTop)) {
      fileTree.scrollTop = session.treeScrollTop;
    }
  });
}

function treeItemByPath(path, itemType = "") {
  if (!path) {
    return null;
  }
  return visibleTreeItems().find((item) => {
    return item.dataset.treePath === path && (!itemType || item.dataset.treeItem === itemType);
  }) || null;
}

function currentTreeItem(target = document.activeElement) {
  const item = target?.closest?.("[data-tree-item]");
  return item && fileTree.contains(item) ? item : null;
}

function isVisibleTreeItem(item) {
  for (let node = item.parentElement; node && node !== fileTree; node = node.parentElement) {
    if (node.tagName === "DETAILS" && !node.open && treeDirectorySummary(node) !== item) {
      return false;
    }
  }
  return true;
}

function focusAdjacentTreeItem(direction) {
  const items = visibleTreeItems();
  if (items.length === 0) {
    return;
  }

  const activeItem = currentTreeItem();
  const activeIndex = items.indexOf(activeItem);
  const currentIndex = activeIndex >= 0 ? activeIndex : 0;
  const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + direction));
  focusTreeItem(items[nextIndex]);
}

function focusTreeItem(item, { persist = true } = {}) {
  item.focus({ preventScroll: true });
  item.scrollIntoView({ block: "nearest" });
  window.requestAnimationFrame(() => {
    if (item.isConnected && document.activeElement === item) {
      overflowTooltipController.showFor("file-tree", item);
    }
  });
  const snapshot = treeFocusSnapshot(item);
  if (snapshot) {
    state.lastTreeFocus = snapshot;
    if (persist) {
      scheduleWorkbenchSessionPersist();
    }
  }
}

function activateTreeItem(item) {
  if (item.dataset.treeItem === "file") {
    void openFileFromTree(item.dataset.treePath);
    return;
  }
  const details = treeDirectoryDetails(item);
  if (details) {
    setTreeDirectoryOpen(details, !details.open);
  }
}

function expandOrEnterTreeDirectory(item) {
  const details = treeDirectoryDetails(item);
  if (!details) {
    return;
  }

  if (!details.open) {
    setTreeDirectoryOpen(details, true);
    return;
  }

  const childItem = visibleTreeItems().find((candidate) => {
    return candidate !== item && details.contains(candidate);
  });
  if (childItem) {
    focusTreeItem(childItem);
  }
}

function collapseOrLeaveTreeDirectory(item) {
  const details = treeDirectoryDetails(item);
  if (details?.open) {
    setTreeDirectoryOpen(details, false);
    return;
  }

  const parentSummary = parentTreeDirectorySummary(item);
  if (parentSummary) {
    focusTreeItem(parentSummary);
  }
}

function setTreeDirectoryOpen(details, open) {
  details.open = open;
  details.dataset.programmaticToggle = "true";
  const summary = treeDirectorySummary(details);
  summary?.setAttribute("aria-expanded", String(open));
  if (summary?.dataset.treePath) {
    recordTreeDirectoryToggle(summary.dataset.treePath, open);
  }
}

function treeDirectoryDetails(item) {
  if (item?.dataset.treeItem !== "directory") {
    return null;
  }
  return item.closest("details");
}

function treeDirectorySummary(details) {
  return [...details.children].find((child) => child.tagName === "SUMMARY") || null;
}

function parentTreeDirectorySummary(item) {
  const parentDetails = item.closest("ul")?.closest("details");
  return parentDetails ? treeDirectorySummary(parentDetails) : null;
}

function showKeyboardShortcutsDialog() {
  void showAppDialog({
    title: "Keyboard Shortcuts",
    content: renderKeyboardShortcutsDialog(),
    showCancel: false,
    showConfirm: false,
    variant: "shortcuts",
    initialFocus: "close",
  });
}

function showGitLeafHelpDialog() {
  void showAppDialog({
    title: "Git Leaf 帮助",
    content: renderGitLeafHelpDialog(),
    showCancel: false,
    showConfirm: false,
    variant: "help",
    initialFocus: "close",
  });
}

function renderGitLeafHelpDialog() {
  const root = document.createElement("div");
  root.className = "git-leaf-help";

  for (const sectionData of GIT_LEAF_HELP_SECTIONS) {
    const section = document.createElement("section");
    section.className = "git-leaf-help-section";

    const title = document.createElement("h3");
    title.textContent = sectionData.title;
    section.append(title);

    for (const paragraph of sectionData.body) {
      const body = document.createElement("p");
      body.textContent = paragraph;
      section.append(body);
    }
    root.append(section);
  }

  const tableSection = document.createElement("section");
  tableSection.className = "git-leaf-help-section";
  const tableTitle = document.createElement("h3");
  tableTitle.textContent = "文件类型支持";
  tableSection.append(tableTitle);

  const table = document.createElement("div");
  table.className = "git-leaf-help-table";
  for (const rowData of FILE_TYPE_HELP_ROWS) {
    const row = document.createElement("div");
    row.className = "git-leaf-help-row";
    const files = document.createElement("code");
    files.textContent = rowData.files;
    const behavior = document.createElement("span");
    behavior.textContent = rowData.behavior;
    row.append(files, behavior);
    table.append(row);
  }

  tableSection.append(table);
  root.append(tableSection);
  return root;
}

function renderKeyboardShortcutsDialog() {
  const root = document.createElement("div");
  root.className = "keyboard-shortcuts";

  const intro = document.createElement("p");
  intro.className = "keyboard-shortcuts-note";
  intro.textContent = "Git Leaf 会自动保存 Source 和 Live 编辑内容。";
  root.append(intro);

  for (const group of KEYBOARD_SHORTCUT_GROUPS) {
    const section = document.createElement("section");
    section.className = "keyboard-shortcut-group";

    const title = document.createElement("h3");
    title.textContent = group.title;
    section.append(title);

    const list = document.createElement("div");
    list.className = "keyboard-shortcut-list";
    for (const shortcut of group.shortcuts) {
      const row = document.createElement("div");
      row.className = "keyboard-shortcut-row";

      const keys = document.createElement("kbd");
      keys.textContent = shortcut.keys;

      const action = document.createElement("span");
      action.textContent = shortcut.action;

      row.append(keys, action);
      list.append(row);
    }

    section.append(list);
    root.append(section);
  }

  return root;
}

function clientGitSyncAgentPrompt({ files = [], step = "git-sync", error = "同步失败。" }) {
  return [
    "请处理 Git Leaf 同步失败：",
    "",
    `仓库：${state.currentRepo}`,
    `当前分支：${state.currentRepoBranch}`,
    "选中文件：",
    ...files.map((file) => `- ${file}`),
    "",
    `失败步骤：${step}`,
    "错误输出：",
    error,
    "",
    "目标：",
    "1. 保留 Git Leaf 用户对上述文件的修改。",
    "2. 处理当前 Git 状态、检查失败或冲突。",
    "3. 完成必要检查后，提交并推送当前 main 分支。",
  ].join("\n");
}

async function toggleFrontmatterFilterPopover(event) {
  event.stopPropagation();
  if (state.frontmatterAllowedKeys.length === 0) {
    return;
  }
  if (frontmatterFilterPopover.hidden) {
    frontmatterFilterPopover.hidden = false;
    frontmatterFilterToggle.setAttribute("aria-expanded", "true");
    positionFrontmatterFilterPopover();
    renderFrontmatterFilterPopover();
    await ensureFrontmatterFacets();
    return;
  }

  hideFrontmatterFilterPopover();
}

function hideFrontmatterFilterPopover() {
  frontmatterFilterPopover.hidden = true;
  frontmatterFilterToggle.setAttribute("aria-expanded", "false");
}

function positionFrontmatterFilterPopover() {
  if (frontmatterFilterPopover.hidden) {
    return;
  }

  const margin = 12;
  const toggleRect = frontmatterFilterToggle.getBoundingClientRect();
  const controlsRect = frontmatterFilterToggle.closest(".tree-controls")?.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const width = Math.min(520, Math.max(0, viewportWidth - margin * 2));
  const anchorLeft = controlsRect ? controlsRect.left + 16 : toggleRect.left;
  const left = Math.min(
    Math.max(anchorLeft, margin),
    Math.max(margin, viewportWidth - width - margin),
  );
  const belowTop = toggleRect.bottom + 10;
  const belowHeight = viewportHeight - belowTop - margin;
  let top = belowTop;
  let maxHeight = Math.min(320, Math.max(140, belowHeight));

  if (belowHeight < 140 && toggleRect.top > belowHeight) {
    const aboveHeight = toggleRect.top - margin - 10;
    maxHeight = Math.min(320, Math.max(140, aboveHeight));
    top = Math.max(margin, toggleRect.top - maxHeight - 10);
  }

  frontmatterFilterPopover.style.setProperty("--frontmatter-filter-popover-left", `${Math.round(left)}px`);
  frontmatterFilterPopover.style.setProperty("--frontmatter-filter-popover-top", `${Math.round(top)}px`);
  frontmatterFilterPopover.style.setProperty("--frontmatter-filter-popover-width", `${Math.round(width)}px`);
  frontmatterFilterPopover.style.setProperty("--frontmatter-filter-popover-max-height", `${Math.round(maxHeight)}px`);
}

function renderFrontmatterFilterAvailability() {
  const enabled = state.frontmatterAllowedKeys.length > 0;
  frontmatterFilterToggle.hidden = !enabled;
  frontmatterFilterToggle.disabled = !enabled;
  if (enabled) {
    return;
  }

  hideFrontmatterFilterPopover();
  state.frontmatterFilters = [];
  frontmatterActiveFilters.hidden = true;
  frontmatterActiveFilters.innerHTML = "";
}

function normalizeFrontmatterAllowedKeys(allowedKeys) {
  return Array.isArray(allowedKeys)
    ? allowedKeys.map((key) => String(key ?? "").trim()).filter(Boolean)
    : [];
}

function sameStringArray(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape" && !agentContextPopover.hidden) {
    event.preventDefault();
    closeAgentContextPopoverAndRestoreFocus();
    return;
  }
  if (event.key === "Escape" && !fileActionMenu.hidden) {
    event.preventDefault();
    closeFileActionMenu();
    return;
  }
  if (event.key === "Escape" && !worktreeSwitcherMenu.hidden) {
    event.preventDefault();
    closeWorktreeSwitcher();
    worktreeSwitcherToggle.focus();
    return;
  }
  if (event.key === "Escape" && !frontmatterFilterPopover.hidden) {
    event.preventDefault();
    hideFrontmatterFilterPopover();
    frontmatterFilterToggle.focus();
    return;
  }
  if (event.key !== "Escape" || state.selectedLines.size === 0) {
    return;
  }

  if (event.target.closest?.("#app-dialog")) {
    return;
  }

  event.preventDefault();
  clearLineSelection();
}

function handleDocumentChromeClick(event) {
  if (
    !agentContextPopover.hidden &&
    !closestElement(event.target, ".agent-context-widget")
  ) {
    setAgentContextPopoverOpen(false);
  }
  if (
    !fileActionMenu.hidden &&
    !closestElement(event.target, ".file-action-menu") &&
    !closestElement(event.target, "#document-actions-more")
  ) {
    closeFileActionMenu();
  }
  if (!worktreeSwitcherMenu.hidden && !closestElement(event.target, ".worktree-switcher")) {
    closeWorktreeSwitcher();
  }

  if (
    !imagePopover.hidden &&
    !closestElement(event.target, ".image-popover") &&
    !closestElement(event.target, "[data-git-leaf-image]")
  ) {
    clearActiveImage();
  }

  if (
    !linkPopover.hidden &&
    !closestElement(event.target, ".link-popover") &&
    !closestElement(event.target, ".cm-live-link-text[data-live-link=\"true\"]")
  ) {
    clearActiveLink();
  }

  if (
    !frontmatterFieldPopover.hidden &&
    !closestElement(event.target, ".frontmatter-field-popover") &&
    !closestElement(event.target, ".cm-live-frontmatter-token[data-live-frontmatter=\"true\"]")
  ) {
    clearActiveFrontmatterField();
  }

  if (
    frontmatterFilterPopover.hidden ||
    closestElement(event.target, ".tree-controls")
  ) {
    return;
  }
  hideFrontmatterFilterPopover();
}

function closestElement(target, selector) {
  const element = target?.closest
    ? target
    : target?.parentElement;
  return element?.closest?.(selector) ?? null;
}

async function ensureFrontmatterFacets({ force = false } = {}) {
  if (state.frontmatterAllowedKeys.length === 0) {
    state.frontmatterFacets = {};
    state.frontmatterFiles = {};
    renderFrontmatterFilterAvailability();
    return;
  }
  if (state.frontmatterFacets && !force) {
    renderFrontmatterFilterPopover();
    return;
  }
  if (state.frontmatterFacetsLoading) {
    return;
  }

  state.frontmatterFacetsLoading = true;
  renderFrontmatterFilterPopover();
  try {
    const response = await fetch(apiUrl("/api/frontmatter-facets"));
    if (!response.ok) {
      throw new Error("Unable to load frontmatter facets");
    }
    const payload = await response.json();
    state.frontmatterAllowedKeys = normalizeFrontmatterAllowedKeys(payload.allowedKeys);
    state.frontmatterFilters = normalizeFrontmatterFilters(
      state.frontmatterFilters,
      state.frontmatterAllowedKeys,
    );
    state.frontmatterFacets = payload.facets ?? {};
    state.frontmatterFiles = payload.files ?? {};
    state.frontmatterActiveKey = nextAvailableFrontmatterKey(state.frontmatterActiveKey);
    renderFrontmatterFilterAvailability();
    renderActiveFrontmatterFilters();
    renderTree();
  } finally {
    state.frontmatterFacetsLoading = false;
    renderFrontmatterFilterPopover();
  }
}

function renderFrontmatterFilterPopover() {
  if (frontmatterFilterPopover.hidden) {
    return;
  }
  if (state.frontmatterAllowedKeys.length === 0) {
    hideFrontmatterFilterPopover();
    return;
  }

  if (state.frontmatterFacetsLoading) {
    frontmatterFilterPopover.innerHTML = "<p class=\"frontmatter-filter-empty\">正在加载筛选项...</p>";
    positionFrontmatterFilterPopover();
    return;
  }

  const activeKey = nextAvailableFrontmatterKey(state.frontmatterActiveKey);
  state.frontmatterActiveKey = activeKey;
  const values = state.frontmatterFacets?.[activeKey] ?? [];
  frontmatterFilterPopover.innerHTML = [
    "<div class=\"frontmatter-filter-popover-header\"><span>添加筛选</span><span>AND 条件</span></div>",
    "<div class=\"frontmatter-filter-grid\">",
    `<div class="frontmatter-filter-keys">${renderFrontmatterFilterKeys(activeKey)}</div>`,
    `<div class="frontmatter-filter-values">${renderFrontmatterFilterValues(activeKey, values)}</div>`,
    "</div>",
  ].join("");
  positionFrontmatterFilterPopover();
}

function renderFrontmatterFilterKeys(activeKey) {
  return state.frontmatterAllowedKeys.map((key) => {
    const count = state.frontmatterFacets?.[key]?.length ?? 0;
    const active = key === activeKey ? " is-active" : "";
    return [
      `<button class="frontmatter-filter-option${active}" type="button" data-frontmatter-key="${escapeHtml(key)}">`,
      `<span>${escapeHtml(key)}</span>`,
      `<span class="frontmatter-filter-count">${count}</span>`,
      "</button>",
    ].join("");
  }).join("");
}

function renderFrontmatterFilterValues(activeKey, values) {
  if (!activeKey) {
    return "<p class=\"frontmatter-filter-empty\">已添加所有筛选条件。</p>";
  }
  if (values.length === 0) {
    return "<p class=\"frontmatter-filter-empty\">这个字段暂无可用值。</p>";
  }

  return values.map(({ value, count }) => [
    `<button class="frontmatter-filter-value" type="button" data-frontmatter-value="${escapeHtml(value)}">`,
    `<span>${escapeHtml(value)}</span>`,
    `<span class="frontmatter-filter-count">${count}</span>`,
    "</button>",
  ].join("")).join("");
}

function handleFrontmatterFilterPopoverClick(event) {
  event.stopPropagation();

  const keyButton = event.target.closest?.("[data-frontmatter-key]");
  if (keyButton) {
    state.frontmatterActiveKey = keyButton.dataset.frontmatterKey;
    renderFrontmatterFilterPopover();
    return;
  }

  const valueButton = event.target.closest?.("[data-frontmatter-value]");
  if (!valueButton || !state.frontmatterActiveKey) {
    return;
  }

  state.frontmatterFilters = normalizeFrontmatterFilters([
    ...state.frontmatterFilters.filter((filter) => filter.key !== state.frontmatterActiveKey),
    { key: state.frontmatterActiveKey, value: valueButton.dataset.frontmatterValue },
  ], state.frontmatterAllowedKeys);
  recordTelemetryFeature("navigation.frontmatter_filter", {
    action: "apply",
    filter_count_bucket: frontmatterFilterCountBucket(state.frontmatterFilters.length),
  });
  state.frontmatterActiveKey = nextAvailableFrontmatterKey();
  renderActiveFrontmatterFilters();
  renderFrontmatterFilterPopover();
  renderTree();
  hideFrontmatterFilterPopover();
}

function handleActiveFrontmatterFilterClick(event) {
  const button = event.target.closest?.("[data-remove-frontmatter-key]");
  if (!button) {
    return;
  }

  state.frontmatterFilters = state.frontmatterFilters.filter(
    (filter) => filter.key !== button.dataset.removeFrontmatterKey,
  );
  recordTelemetryFeature("navigation.frontmatter_filter", {
    action: "clear",
    filter_count_bucket: frontmatterFilterCountBucket(Math.max(1, state.frontmatterFilters.length + 1)),
  });
  renderActiveFrontmatterFilters();
  renderFrontmatterFilterPopover();
  renderTree();
}

function renderActiveFrontmatterFilters() {
  frontmatterActiveFilters.hidden = state.frontmatterFilters.length === 0;
  if (state.frontmatterFilters.length === 0) {
    frontmatterActiveFilters.innerHTML = "";
    return;
  }

  frontmatterActiveFilters.innerHTML = state.frontmatterFilters.map(({ key, value }) => [
    "<span class=\"frontmatter-filter-chip\">",
    `<span>${escapeHtml(key)}:</span>`,
    `${escapeHtml(value)}`,
    `<button type="button" aria-label="移除 ${escapeHtml(key)} 筛选" data-remove-frontmatter-key="${escapeHtml(key)}">×</button>`,
    "</span>",
  ].join("")).join("");
}

function nextAvailableFrontmatterKey(preferredKey = state.frontmatterActiveKey) {
  const allowedKeys = state.frontmatterAllowedKeys;
  const activeKeys = new Set(state.frontmatterFilters.map((filter) => filter.key));
  if (preferredKey && allowedKeys.includes(preferredKey) && !activeKeys.has(preferredKey)) {
    return preferredKey;
  }
  return allowedKeys.find((key) => !activeKeys.has(key)) ?? "";
}

function directoryContainsCurrentFile(node) {
  if (node.type === "file") {
    return node.path === state.currentFile;
  }
  return node.children.some(directoryContainsCurrentFile);
}

function handleDocumentClick(event) {
  const image = event.target.closest?.("[data-git-leaf-image]");
  if (image && canEditCurrentDocument() && state.sourceEditor) {
    event.preventDefault();
    const block = image.closest(".source-block");
    const line = Number(block?.dataset.sourceStart);
    if (Number.isInteger(line)) {
      selectImageBlock({ line, image, event });
      return;
    }
  }

  const button = event.target.closest("[data-source-line]");
  if (button) {
    focusPreviewDocumentContent();
    clearActiveImage();
    clearActiveLink();
    selectSourceLine(Number(button.dataset.sourceLine), event);
    return;
  }

  const openableLink = gitLeafOpenableLinkFromClick(event);
  if (openableLink) {
    event.preventDefault();
    openFile(openableLink.file, true, {
      repoId: openableLink.repo,
      hash: openableLink.hash,
    });
    return;
  }

  const isInteractive = isInteractiveClick(event);
  if (isInteractive) {
    return;
  }

  focusPreviewDocumentContent();

  const line = lineFromDocumentGutterPoint(event);
  if (shouldClearLineSelection({
    selectedCount: state.selectedLines.size,
    isInteractive,
    hasLineTarget: Boolean(button),
    gutterLine: line,
  })) {
    clearActiveImage();
    clearActiveLink();
    clearLineSelection();
    return;
  }

  if (!Number.isInteger(line)) {
    return;
  }

  selectSourceLine(line, event);
}

function handlePreviewContentKeydown(event) {
  if (
    event.target !== documentContent ||
    state.mode !== "preview" ||
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing
  ) {
    return;
  }

  const lineStep = 56;
  const pageStep = Math.max(120, Math.floor(documentContent.clientHeight * 0.86));
  let top = 0;
  switch (event.key) {
    case "ArrowDown":
      top = lineStep;
      break;
    case "ArrowUp":
      top = -lineStep;
      break;
    case " ":
      top = event.shiftKey ? -pageStep : pageStep;
      break;
    default:
      return;
  }

  event.preventDefault();
  documentContent.scrollBy({ top, left: 0, behavior: "auto" });
}

function gitLeafOpenableLinkFromClick(event) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) {
    return null;
  }

  const anchor = event.target.closest?.("a[href]");
  if (!anchor || anchor.target && anchor.target !== "_self") {
    return null;
  }

  try {
    const url = new URL(anchor.getAttribute("href"), window.location.origin);
    const file = url.searchParams.get("file") ?? "";
    if (url.origin !== window.location.origin || !["/", "/raw"].includes(url.pathname) || !file) {
      return null;
    }

    return {
      repo: url.searchParams.get("repo") || state.currentRepo,
      file,
      hash: url.hash,
    };
  } catch {
    return null;
  }
}

function selectSourceLine(line, event) {
  if (!Number.isInteger(line)) {
    return;
  }

  clearActiveImage();
  clearActiveLink();
  if (event.shiftKey && state.selectionAnchor) {
    state.selectedLines = new Set(linesBetween(state.selectionAnchor, line));
  } else if (event.metaKey || event.ctrlKey) {
    if (state.selectedLines.has(line)) {
      state.selectedLines.delete(line);
    } else {
      state.selectedLines.add(line);
    }
    state.selectionAnchor = line;
  } else {
    state.selectedLines = new Set([line]);
    state.selectionAnchor = line;
  }

  updateLineSelectionUi();
}

function updateLineSelectionUi() {
  const selected = [...state.selectedLines].sort((left, right) => left - right);
  state.sourceEditor?.setSelectedLines(selected);
  for (const button of documentContent.querySelectorAll("[data-source-line]")) {
    const line = Number(button.dataset.sourceLine);
    button.classList.toggle("is-selected", state.selectedLines.has(line));
  }

  if (selected.length === 0) {
    selectionPopover.hidden = true;
    replaceLineHash("");
    return;
  }

  replaceLineHash(hashFromLines(selected));
  scheduleSelectionPopoverPosition();
}

function scrollToHashSelectedLine() {
  if (state.selectedLines.size === 0) {
    return;
  }

  const [line] = [...state.selectedLines].sort((left, right) => left - right);
  if (!Number.isInteger(line)) {
    return;
  }

  if (isEditorMode()) {
    state.sourceEditor?.scrollToLine(line);
    scheduleSelectionPopoverPosition();
    return;
  }

  const target = documentContent.querySelector(`[data-source-line="${line}"]`);
  if (!target) {
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const contentRect = documentContent.getBoundingClientRect();
  documentContent.scrollTop += targetRect.top - contentRect.top - 24;
  scheduleSelectionPopoverPosition();
}

function scheduleSelectionPopoverPosition() {
  if (state.selectionPopoverFrame) {
    return;
  }

  state.selectionPopoverFrame = window.requestAnimationFrame(() => {
    state.selectionPopoverFrame = null;
    positionSelectionPopover();
  });
}

function clearLineSelection() {
  state.selectedLines = new Set();
  state.selectionAnchor = null;
  updateLineSelectionUi();
}

function replaceLineHash(hash) {
  if (!state.currentDocument) {
    return;
  }

  const url = new URL(window.location.href);
  if (hash) {
    url.hash = hash;
  } else {
    url.hash = "";
  }
  window.history.replaceState(
    {
      repo: state.currentRepo,
      file: state.currentDocument.path,
    },
    "",
    url,
  );
}

async function copyCurrentLineReference() {
  if (!state.currentDocument || state.selectedLines.size === 0) {
    return;
  }

  const selectedLineCount = state.selectedLines.size;
  const copyPromise = writeClipboard(
    formatLineReference({
      path: state.currentDocument.path,
      selectedLines: [...state.selectedLines],
      sourceLines: state.currentDocument.sourceLines,
    }),
  );
  clearLineSelection();
  showCopyToast("已复制定位");
  try {
    await copyPromise;
    recordTelemetryFeature("line_reference.copy", {
      line_count_bucket: lineCountBucket(selectedLineCount),
    });
  } catch {
    showCopyToast("复制失败");
  }
}

function restoreAgentContextItems() {
  state.agentContextLoadedScopeKey = currentAgentContextScopeKey();
  state.agentContextItems = readAgentContextItems({
    storage: agentContextSessionStorage(),
    scopeKey: state.agentContextLoadedScopeKey,
  });
  state.activeAgentContextItemId = state.agentContextItems.at(-1)?.id ?? "";
}

function restoreAgentContextItemsForScopeChange() {
  const nextScopeKey = currentAgentContextScopeKey();
  if (nextScopeKey === state.agentContextLoadedScopeKey) {
    return;
  }
  restoreAgentContextItems();
  setAgentContextPopoverOpen(false);
  renderAgentContext();
}

function persistAgentContextItems() {
  writeAgentContextItems({
    storage: agentContextSessionStorage(),
    scopeKey: currentAgentContextScopeKey(),
    items: state.agentContextItems,
  });
}

function currentAgentContextScopeKey() {
  return agentContextScopeKey({
    repoId: state.currentRepo,
    worktreeId: state.currentWorktreeId,
  });
}

function agentContextSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function toggleAgentContextPopover() {
  setAgentContextPopoverOpen(agentContextPopover.hidden, {
    focus: agentContextPopover.hidden,
  });
}

function closeAgentContextPopoverAndRestoreFocus() {
  setAgentContextPopoverOpen(false);
  agentContextToggle.focus();
}

function setAgentContextPopoverOpen(open, { focus = false } = {}) {
  const nextOpen = Boolean(open);
  agentContextPopover.hidden = !nextOpen;
  agentContextToggle.setAttribute("aria-expanded", String(nextOpen));
  if (nextOpen) {
    renderAgentContext();
    if (focus) {
      agentContextClose.focus();
    }
  }
}

function handleAgentContextFocusIn(event) {
  if (!agentContextPopover.hidden && !agentContextWidget.contains(event.target)) {
    setAgentContextPopoverOpen(false);
  }
}

function addCurrentSelectionToAgentContext(event) {
  event.stopPropagation();
  if (!state.currentDocument || state.selectedLines.size === 0 || !isMarkdownDocument()) {
    return;
  }

  const repository = repositoryById(state.currentRepo);
  const worktree = currentWorktree();
  const sourceLines = isEditorMode() && state.sourceEditor
    ? sourceLinesFromMarkdown(state.sourceEditor.getValue())
    : state.currentDocument.sourceLines;
  const item = createAgentContextItem({
    repoId: state.currentRepo,
    repoName: repository?.name,
    worktreeId: state.currentWorktreeId,
    worktreeName: worktree?.name,
    branch: state.currentRepoBranch || state.currentDocument.branch,
    revision: worktree?.head,
    path: state.currentDocument.path,
    selectedLines: [...state.selectedLines],
    sourceLines,
  });
  if (!item) {
    return;
  }

  const replacing = state.agentContextItems.some((existing) => existing.id === item.id);
  state.agentContextItems = addAgentContextItem(state.agentContextItems, item);
  state.activeAgentContextItemId = item.id;
  persistAgentContextItems();
  clearLineSelection();
  renderAgentContext();
  setAgentContextPopoverOpen(true, { focus: true });
  showCopyToast(replacing ? "已更新 Agent 上下文" : "已加入 Agent 上下文");
}

function renderAgentContext() {
  const count = state.agentContextItems.length;
  agentContextToggleCount.textContent = String(count);
  agentContextToggle.title = `Agent 上下文（${count} 个片段）`;
  agentContextToggle.setAttribute("aria-label", agentContextToggle.title);
  agentContextCopy.textContent = count > 0 ? `复制 ${count} 个片段` : "复制片段";
  agentContextList.replaceChildren(
    ...state.agentContextItems.map(agentContextItemElement),
  );
  agentContextList.hidden = count === 0;
  agentContextEmpty.hidden = count !== 0;
  agentContextClear.disabled = count === 0;
  agentContextCopy.disabled = count === 0;
}

function agentContextItemElement(item) {
  const section = document.createElement("section");
  section.className = "agent-context-item";
  section.classList.toggle("is-active", item.id === state.activeAgentContextItemId);
  section.dataset.agentContextId = item.id;

  const locate = document.createElement("button");
  locate.type = "button";
  locate.className = "agent-context-item-open";
  locate.dataset.agentContextAction = "locate";
  locate.dataset.agentContextId = item.id;
  locate.setAttribute("aria-label", `查看原文：${agentContextReferenceLabel(item)}`);

  const preview = document.createElement("span");
  preview.className = "agent-context-item-preview";
  preview.textContent = item.sourceLines.map((line) => line.text).join("\n").trim() || "（空行）";

  const reference = document.createElement("span");
  reference.className = "agent-context-item-reference";
  reference.textContent = agentContextItemLabel(item);
  locate.append(preview, reference);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "agent-context-item-remove";
  remove.dataset.agentContextAction = "remove";
  remove.dataset.agentContextId = item.id;
  remove.textContent = "×";
  remove.setAttribute("aria-label", `移除片段：${agentContextItemLabel(item)}`);
  section.append(locate, remove);
  return section;
}

function agentContextReferenceLabel(item) {
  const ranges = formatLineRange(item.selectedLines)
    .split(",")
    .filter(Boolean)
    .map((range) => range.includes("-") ? `L${range.replace("-", "-L")}` : `L${range}`)
    .join(",");
  return `${item.path}:${ranges}`;
}

async function handleAgentContextListClick(event) {
  const button = event.target.closest?.("[data-agent-context-action]");
  if (!button) {
    return;
  }
  event.stopPropagation();
  const item = state.agentContextItems.find(
    (candidate) => candidate.id === button.dataset.agentContextId,
  );
  if (!item) {
    return;
  }

  if (button.dataset.agentContextAction === "remove") {
    state.agentContextItems = removeAgentContextItem(state.agentContextItems, item.id);
    if (state.activeAgentContextItemId === item.id) {
      state.activeAgentContextItemId = state.agentContextItems.at(-1)?.id ?? "";
    }
    persistAgentContextItems();
    renderAgentContext();
    agentContextClose.focus();
    showCopyToast("已移除 1 个上下文片段");
    return;
  }

  state.activeAgentContextItemId = item.id;
  renderAgentContext();
  const opened = await openFile(item.path, true);
  if (!opened) {
    showCopyToast("无法定位原文");
    return;
  }
  state.selectedLines = new Set(item.selectedLines);
  state.selectionAnchor = item.selectedLines.at(-1) ?? null;
  updateLineSelectionUi();
  scrollToHashSelectedLine();
  renderAgentContext();
  agentContextClose.focus();
  showCopyToast(`已定位到 ${agentContextReferenceLabel(item)}`);
}

function clearAgentContextItems() {
  state.agentContextItems = [];
  state.activeAgentContextItemId = "";
  persistAgentContextItems();
  renderAgentContext();
  agentContextClose.focus();
  showCopyToast("已清空 Agent 上下文");
}

async function copyAgentContext() {
  const markdown = formatAgentContextMarkdown(state.agentContextItems);
  if (!markdown) {
    return;
  }
  try {
    await writeClipboard(markdown);
    showCopyToast(`已复制 ${state.agentContextItems.length} 个上下文片段`);
  } catch {
    showCopyToast("复制失败");
  }
}

function resetStatusPolling() {
  if (state.statusTimer) {
    window.clearInterval(state.statusTimer);
    state.statusTimer = null;
  }
  if (!state.currentDocument) {
    return;
  }

  state.statusTimer = window.setInterval(checkDocumentStatus, 2000);
}

function resetDocumentWatch() {
  if (state.watchStream) {
    state.watchStream.close();
    state.watchStream = null;
  }
  if (!state.currentDocument || !window.EventSource) {
    return;
  }

  const stream = new EventSource(
    apiUrl("/api/watch", { file: state.currentDocument.path }),
  );
  stream.addEventListener("change", handleWatchedDocumentChange);
  state.watchStream = stream;
}

async function handleWatchedDocumentChange(event) {
  if (!state.currentDocument) {
    return;
  }

  const payload = JSON.parse(event.data);
  applyRepositoryStatus(payload);
  enforceCurrentRepoEditCapability();
  if (state.sourceWriteInFlight) {
    return;
  }
  if (payload.sourceHash === state.currentDocument.sourceHash) {
    return;
  }
  if (
    shouldIgnoreWatchedChange({
      currentMode: state.mode,
      watchedHash: payload.sourceHash,
      lastWrittenHash: state.lastWrittenHash,
    })
  ) {
    return;
  }

  await refreshCurrentDocument({ external: true });
}

async function checkDocumentStatus() {
  if (!state.currentDocument) {
    return;
  }

  let response;
  try {
    response = await fetch(
      apiUrl("/api/document-status", { file: state.currentDocument.path }),
    );
  } catch {
    return;
  }
  if (!response.ok) {
    return;
  }

  const status = await response.json();
  applyRepositoryStatus(status);
  enforceCurrentRepoEditCapability();
  if (state.sourceWriteInFlight) {
    return;
  }
  if (
    shouldIgnoreWatchedChange({
      currentMode: state.mode,
      watchedHash: status.sourceHash,
      lastWrittenHash: state.lastWrittenHash,
    })
  ) {
    return;
  }
  if (status.mtimeMs > state.currentDocument.mtimeMs) {
    await refreshCurrentDocument({ external: true });
  }
}

async function refreshCurrentDocument({ external = false } = {}) {
  if (!state.currentDocument) {
    return;
  }

  const response = await fetch(
    apiUrl("/api/document", { file: state.currentDocument.path }),
  );
  if (!response.ok) {
    return;
  }

  applyDocumentData(await response.json(), { preserveScroll: true });
  if (external && isEditorMode()) {
    updateSourceSyncStatus("external");
  }
}

async function copyCurrentPath() {
  if (!state.currentDocument) {
    return;
  }
  await copyPathValue(state.currentDocument.path);
}

async function copyCurrentShareLink() {
  if (!state.currentDocument || copyShareLinkButton.disabled) {
    return;
  }
  await copyShareLinkForPath(state.currentDocument.path, { disablePrimary: true });
}

async function copyShareLinkForPath(documentPath, { disablePrimary = false } = {}) {
  if (!isMarkdownPath(documentPath)) {
    return;
  }
  if (disablePrimary) {
    copyShareLinkButton.disabled = true;
  }
  try {
    if (documentPath === state.currentDocument?.path) {
      await flushPendingSourceSync();
    }
    const response = await fetch(apiUrl("/api/share-link", {
      file: documentPath,
    }));
    const payload = await response.json().catch(() => ({
      error: "分享链接接口返回了不可解析的结果。",
      code: "share_unavailable",
    }));
    if (!response.ok || !payload.url) {
      await showShareLinkUnavailable(payload, documentPath);
      return;
    }
    await writeRichLinkClipboard(
      payload.url,
      shareLinkClipboardTitle(payload.url, documentPath),
    );
    showCopyToast("已复制分享链接");
  } catch (error) {
    await showAppDialog({
      title: "无法复制分享链接",
      message: error instanceof Error ? error.message : "复制分享链接失败。",
      showCancel: false,
      confirmText: "知道了",
    });
  } finally {
    if (disablePrimary) {
      copyShareLinkButton.disabled = !state.currentDocument || !isMarkdownDocument();
    }
  }
}

async function showShareLinkUnavailable(payload, documentPath) {
  const canPublishDocument = payload?.code === "document_not_committed"
    || payload?.code === "document_not_published";
  const needsCommit = payload?.code === "document_not_committed";
  const { confirmed } = await showAppDialog({
    title: canPublishDocument ? "当前文档尚未发布" : "无法生成分享链接",
    message: payload?.error || "当前文档暂时不能分享。",
    confirmText: canPublishDocument
      ? (needsCommit ? "同步并复制" : "发布并复制")
      : "知道了",
    showCancel: canPublishDocument,
  });
  if (!confirmed || !canPublishDocument) {
    return;
  }
  await publishShareLinkForPath(documentPath);
}

async function publishShareLinkForPath(documentPath) {
  for (;;) {
    let response;
    let payload;
    try {
      response = await fetch(apiUrl("/api/share-link", {
        file: documentPath,
      }), {
        method: "POST",
      });
      payload = await response.json().catch(() => ({
        ok: false,
        error: "分享发布接口返回了不可解析的结果。",
        code: "share_publish_failed",
        retryable: true,
      }));
    } catch (error) {
      payload = {
        ok: false,
        error: error instanceof Error ? error.message : "无法连接本机分享发布服务。",
        code: "share_publish_failed",
        step: "network",
        retryable: true,
      };
    }

    if (response?.ok && payload?.ok !== false && payload?.url) {
      await writeRichLinkClipboard(
        payload.url,
        shareLinkClipboardTitle(payload.url, documentPath),
      );
      showCopyToast(payload.published ? "已发布并复制分享链接" : "已复制分享链接");
      await loadGitStatus();
      return;
    }

    if (payload?.retryable !== true) {
      await showAppDialog({
        title: "无法发布分享链接",
        message: payload?.error || "当前文档暂时不能发布。",
        showCancel: false,
        confirmText: "知道了",
      });
      return;
    }

    const { confirmed } = await showAppDialog({
      title: "分享发布失败",
      message: [
        payload?.error || "远端发布没有完成。",
        "本地修改和已创建的提交均会保留。请检查网络、GitHub 登录或远端分支状态后重试。",
      ].join("\n\n"),
      confirmText: "重试发布",
      cancelText: payload?.agentPrompt ? "交给 AI Agent" : "关闭",
      showCancel: true,
    });
    if (confirmed) {
      await loadGitStatus();
      continue;
    }

    if (payload?.agentPrompt) {
      showGitSyncFailure({
        ...payload,
        resultTitle: "分享发布失败",
        resultHelp: "复制提示词并交给 AI Agent，完成远端发布后再复制分享链接。",
      });
    }
    return;
  }
}

async function openCurrentSource() {
  if (!canEditCurrentRepo() || !state.currentDocument) {
    return;
  }
  await openPathWithSystem(state.currentDocument.path);
}

async function preparePdfExport() {
  if (!state.currentDocument) {
    return null;
  }
  const restoreMode = state.mode;
  if (isEditorMode()) {
    try {
      await flushPendingSourceSync();
    } catch {
      throw new Error("Source sync failed before PDF export.");
    }
  }
  chartTooltipController.hide();
  setMode("preview", { persist: false, focus: false });
  await waitForPdfExportSurface();
  return {
    path: state.currentDocument.path,
    title: state.currentDocument.title || "",
    restoreMode,
  };
}

function finishPdfExport(metadata) {
  const restoreMode = modeFromStorageValue(metadata?.restoreMode);
  if (restoreMode !== state.mode) {
    setMode(restoreMode, { persist: false, focus: false });
  }
}

async function waitForPdfExportSurface() {
  await nextAnimationFrame();
  await document.fonts?.ready?.catch?.(() => {});
  const images = [...documentContent.querySelectorAll("img")];
  await Promise.all(images.map(waitForImageReady));
  await nextAnimationFrame();
}

function nextAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForImageReady(image) {
  if (image.complete) {
    return;
  }
  if (typeof image.decode === "function") {
    await timeoutAfter(image.decode().catch(() => {}), 3000);
    return;
  }
  await timeoutAfter(new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  }), 3000);
}

function timeoutAfter(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    }),
  ]);
}

function openCurrentGithub() {
  if (!state.currentDocument) {
    return;
  }
  if (!state.currentDocument.githubUrl) {
    recordTelemetryFeature("github.open", { result: "error" });
    showCopyToast("当前文档没有 GitHub 链接");
    return;
  }
  try {
    window.open(state.currentDocument.githubUrl, "_blank", "noopener");
    recordTelemetryFeature("github.open", { result: "success" });
    showCopyToast("已打开 GitHub");
  } catch {
    recordTelemetryFeature("github.open", { result: "error" });
    showCopyToast("无法打开 GitHub 链接");
  }
}

function enhanceTables() {
  for (const tableCard of documentContent.querySelectorAll("[data-enhanced-table]")) {
    const table = tableCard.querySelector("table");
    const search = tableCard.querySelector("[data-table-search]");
    const copy = tableCard.querySelector("[data-table-copy]");
    const freeze = tableCard.querySelector("[data-table-freeze]");

    search?.addEventListener("input", () => {
      const needle = search.value.trim().toLowerCase();
      for (const row of table.querySelectorAll("tbody tr")) {
        row.hidden = needle.length > 0 && !row.textContent.toLowerCase().includes(needle);
      }
    });

    copy?.addEventListener("click", async () => {
      await writeClipboard(tableToCsv(table));
    });

    freeze?.addEventListener("change", () => {
      tableCard.classList.toggle("is-first-column-frozen", freeze.checked);
    });
  }
}

async function pasteImageAsset(file) {
  if (!canEditCurrentDocument() || !state.currentDocument?.path) {
    showCopyToast("当前文档不可编辑");
    return "";
  }

  showCopyToast("正在保存图片");
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const response = await fetch(apiUrl("/api/image-assets", { file: state.currentDocument.path }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataUrl,
        name: file.name || "",
      }),
    });
    const payload = await response.json().catch(() => ({ error: "图片保存失败" }));
    if (!response.ok) {
      throw new Error(payload.error || "图片保存失败");
    }
    await applyBranchProtectionPayload(payload);
    recordTelemetryFeature("editing.image_paste", { result: "success" });
    showCopyToast("已插入图片");
    return payload.tag || "";
  } catch (error) {
    recordTelemetryFeature("editing.image_paste", { result: "error" });
    showCopyToast(error instanceof Error ? error.message : "图片保存失败");
    return "";
  }
}

async function pasteTextLink(text, { selectedText = "" } = {}) {
  if (!canEditCurrentDocument() || !state.currentDocument?.path) {
    return "";
  }

  const value = String(text ?? "").trim();
  if (isGitLeafDocumentUrl(value)) {
    return documentLinkMarkdown(value, selectedText);
  }

  if (/^https?:\/\//i.test(value)) {
    return externalLinkMarkdown(value, selectedText);
  }

  return documentLinkMarkdown(value, selectedText);
}

async function runSlashCommand(command) {
  if (command.custom === "link") {
    return externalLinkMarkdown("https://");
  }

  if (command.custom === "doclink") {
    const result = await showLinkFieldsDialog({
      title: "添加仓库文档链接",
      message: "link 填当前仓库内 Markdown / MDX 路径；title 可留空，保存时会使用目标文档标题。",
      titleValue: "",
      linkValue: "",
      linkLabel: "link",
      linkPlaceholder: "docs/example.md",
      confirmText: "插入链接",
    });
    if (!result.confirmed) {
      return null;
    }
    return documentLinkMarkdown(result.values.link, result.values.title);
  }

  return null;
}

async function showLinkFieldsDialog({
  title,
  message,
  titleValue = "",
  linkValue = "",
  linkLabel = "link",
  linkPlaceholder = "",
  confirmText = "保存链接",
} = {}) {
  return showAppDialog({
    title,
    message,
    fields: [
      {
        id: "title",
        label: "title",
        value: titleValue,
        placeholder: "留空时自动使用默认标题",
      },
      {
        id: "link",
        label: linkLabel,
        value: linkValue,
        placeholder: linkPlaceholder,
      },
    ],
    confirmText,
    cancelText: "取消",
  });
}

async function externalLinkMarkdown(url = "", selectedText = "") {
  const normalizedUrl = String(url ?? "").trim();
  const validInitialUrl = /^https?:\/\/\S+$/i.test(normalizedUrl);
  const fetchedTitle = validInitialUrl && !selectedText.trim()
    ? await externalLinkTitle(normalizedUrl)
    : "";
  const result = await showLinkFieldsDialog({
    title: "添加链接",
    message: "外部链接请填写 URL；title 留空时会使用 URL。",
    titleValue: selectedText.trim() || fetchedTitle,
    linkValue: normalizedUrl || "https://",
    linkLabel: "link",
    linkPlaceholder: "https://example.com",
    confirmText: "插入链接",
  });
  if (!result.confirmed) {
    return "";
  }

  return externalLinkMarkdownFromFields(result.values.title, result.values.link);
}

function externalLinkMarkdownFromFields(title, url) {
  const normalizedUrl = String(url ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(normalizedUrl)) {
    showCopyToast("链接 URL 无效");
    return "";
  }

  const normalizedTitle = String(title ?? "").trim() || normalizedUrl;
  return `[${escapeMarkdownLinkText(normalizedTitle)}](${normalizedUrl})`;
}

async function externalLinkTitle(url) {
  try {
    const response = await fetch(apiUrl("/api/link-title", { url }), { cache: "no-store" });
    const payload = await response.json().catch(() => ({ title: "" }));
    if (!response.ok) {
      return "";
    }
    return String(payload.title ?? "").trim();
  } catch {
    return "";
  }
}

async function documentLinkMarkdown(target, titleOverride = "") {
  const normalizedTarget = String(target ?? "").trim();
  if (!normalizedTarget) {
    return "";
  }

  try {
    const response = await fetch(apiUrl("/api/link-target", {
      file: state.currentDocument.path,
      target: normalizedTarget,
    }));
    const payload = await response.json().catch(() => ({ error: "无法读取目标文档" }));
    if (!response.ok) {
      throw new Error(payload.error || "无法读取目标文档");
    }
    const title = String(titleOverride ?? "").trim() || payload.title || payload.path;
    return `[${escapeMarkdownLinkText(title)}](${payload.href})`;
  } catch (error) {
    showCopyToast(error instanceof Error ? error.message : "无法插入文档链接");
    return "";
  }
}

function isGitLeafDocumentUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const file = url.searchParams.get("file") ?? "";
    if (!/^https?:$/i.test(url.protocol) || !/\.mdx?$/i.test(file)) {
      return false;
    }
    return url.origin === window.location.origin || url.searchParams.has("repo");
  } catch {
    return false;
  }
}

function escapeMarkdownLinkText(value) {
  return String(value ?? "").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取图片失败")));
    reader.readAsDataURL(file);
  });
}

function selectImageBlock({ line, image }) {
  if (!canEditCurrentDocument() || !state.sourceEditor || !Number.isInteger(line)) {
    return;
  }

  clearLineSelection();
  clearActiveLink();
  state.activeImage = {
    line,
    element: image,
  };
  markActiveImage();
  positionImagePopover();
}

function clearActiveImage() {
  state.activeImage = null;
  imagePopover.hidden = true;
  for (const frame of document.querySelectorAll(".git-leaf-image-frame.is-selected")) {
    frame.classList.remove("is-selected");
  }
}

function markActiveImage() {
  for (const frame of document.querySelectorAll(".git-leaf-image-frame.is-selected")) {
    frame.classList.remove("is-selected");
  }
  const image = activeImageElement();
  image?.closest(".git-leaf-image-frame")?.classList.add("is-selected");
}

function positionImagePopover() {
  if (!state.activeImage || !state.sourceEditor) {
    imagePopover.hidden = true;
    return;
  }

  const image = activeImageElement();
  if (!image) {
    imagePopover.hidden = true;
    return;
  }

  imagePopover.hidden = false;
  const imageRect = image.getBoundingClientRect();
  const paneRect = previewPane.getBoundingClientRect();
  const left = Math.max(12, imageRect.left - paneRect.left);
  const top = Math.max(12, imageRect.top - paneRect.top - imagePopover.offsetHeight - 8);
  imagePopover.style.left = `${left}px`;
  imagePopover.style.top = `${top}px`;
}

function activeImageElement() {
  const element = state.activeImage?.element;
  if (element?.isConnected) {
    return element;
  }

  const line = state.activeImage?.line;
  if (!Number.isInteger(line)) {
    return null;
  }
  return state.sourceEditor?.imageElement?.(line) ??
    documentContent.querySelector(`.source-block[data-source-start="${line}"] [data-git-leaf-image]`);
}

function selectLiveLink({ line, from, to, text, href, element }) {
  if (!canEditCurrentDocument() || !state.sourceEditor || !Number.isInteger(line)) {
    return;
  }

  clearLineSelection();
  clearActiveImage();
  state.activeLink = {
    line,
    from,
    to,
    text,
    href,
    element,
  };
  markActiveLink();
  positionLinkPopover();
}

function clearActiveLink() {
  state.activeLink = null;
  linkPopover.hidden = true;
  for (const link of document.querySelectorAll(".cm-live-link-text.is-selected")) {
    link.classList.remove("is-selected");
  }
}

function markActiveLink() {
  for (const link of document.querySelectorAll(".cm-live-link-text.is-selected")) {
    link.classList.remove("is-selected");
  }
  activeLinkElement()?.classList.add("is-selected");
}

function positionLinkPopover() {
  if (!state.activeLink || !state.sourceEditor || state.mode !== "live") {
    linkPopover.hidden = true;
    return;
  }

  const link = activeLinkElement();
  if (!link) {
    linkPopover.hidden = true;
    return;
  }

  linkPopover.hidden = false;
  const linkRect = link.getBoundingClientRect();
  const paneRect = previewPane.getBoundingClientRect();
  const left = Math.max(12, linkRect.left - paneRect.left);
  const top = Math.max(12, linkRect.top - paneRect.top - linkPopover.offsetHeight - 8);
  linkPopover.style.left = `${left}px`;
  linkPopover.style.top = `${top}px`;
}

function activeLinkElement() {
  const element = state.activeLink?.element;
  if (element?.isConnected) {
    return element;
  }

  const link = state.activeLink;
  if (!link || !Number.isInteger(link.line)) {
    return null;
  }
  return state.sourceEditor?.linkElement?.(link.line, link.from, link.to) ?? null;
}

function selectLiveFrontmatterField({ line, key, value, element }) {
  if (
    !canEditCurrentDocument() ||
    !state.sourceEditor ||
    !Number.isInteger(line) ||
    !state.currentDocument?.frontmatterProfile?.enabled
  ) {
    return;
  }

  clearLineSelection();
  clearActiveImage();
  clearActiveLink();
  state.activeFrontmatterField = {
    line,
    key,
    value,
    element,
  };
  markActiveFrontmatterField();
  renderFrontmatterFieldPopover();
  positionFrontmatterFieldPopover();
}

function clearActiveFrontmatterField() {
  state.activeFrontmatterField = null;
  frontmatterFieldPopover.hidden = true;
  for (const field of document.querySelectorAll(".cm-live-frontmatter-token.is-selected")) {
    field.classList.remove("is-selected");
  }
}

function markActiveFrontmatterField() {
  for (const field of document.querySelectorAll(".cm-live-frontmatter-token.is-selected")) {
    field.classList.remove("is-selected");
  }
  activeFrontmatterFieldElement()?.classList.add("is-selected");
}

function renderFrontmatterFieldPopover() {
  const field = state.activeFrontmatterField;
  if (!field) {
    frontmatterFieldPopover.hidden = true;
    return;
  }

  const profile = frontmatterFieldDefinition(field.key);
  const editor = renderFrontmatterFieldEditor(profile, field.value);
  const actions = [
    `<span class="frontmatter-field-popover-key">${escapeHtml(field.key)}</span>`,
    editor || "<button type=\"button\" data-frontmatter-field-action=\"edit\">编辑</button>",
  ].filter(Boolean);
  if (profile.type === "date" && editor) {
    actions.push("<button type=\"button\" data-frontmatter-field-action=\"today\">今天</button>");
  }
  actions.push(
    "<button type=\"button\" data-frontmatter-field-action=\"add\">添加字段</button>",
    "<button type=\"button\" data-frontmatter-field-action=\"delete\">删除</button>",
  );
  frontmatterFieldPopover.innerHTML = actions.join("");
}

function renderFrontmatterFieldEditor(definition, value) {
  const values = frontmatterFieldOptionValues(definition);
  if (values.length === 0) {
    return definition.type === "date" ? renderFrontmatterDateEditor(definition, value) : "";
  }

  return renderFrontmatterSelectEditor(definition, value, values);
}

function renderFrontmatterSelectEditor(definition, value, values) {
  const currentValue = frontmatterEditorValue(value);
  if (currentValue && !values.includes(currentValue)) {
    values.unshift(currentValue);
  }
  const options = [
    currentValue ? "" : "<option value=\"\">选择...</option>",
    ...values.map((item) => (
      `<option value="${escapeHtml(item)}"${item === currentValue ? " selected" : ""}>${escapeHtml(item)}</option>`
    )),
  ];
  return `<select data-frontmatter-field-value="${escapeHtml(definition.key)}" aria-label="${escapeHtml(definition.key)}">${options.join("")}</select>`;
}

function renderFrontmatterDateEditor(definition, value) {
  return `<input type="date" data-frontmatter-field-value="${escapeHtml(definition.key)}" aria-label="${escapeHtml(definition.key)}" value="${escapeHtml(frontmatterEditorValue(value))}">`;
}

function frontmatterFieldOptionValues(definition) {
  const values = Array.isArray(definition.values) ? [...definition.values].map(String).filter(Boolean) : [];
  if (values.length > 0 || definition.type !== "boolean") {
    return values;
  }
  return ["true", "false"];
}

function frontmatterEditorValue(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 2) {
    const quote = text[0];
    if ((quote === "\"" || quote === "'") && text.at(-1) === quote) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function positionFrontmatterFieldPopover() {
  if (!state.activeFrontmatterField || !state.sourceEditor || state.mode !== "live") {
    frontmatterFieldPopover.hidden = true;
    return;
  }

  const field = activeFrontmatterFieldElement();
  if (!field) {
    frontmatterFieldPopover.hidden = true;
    return;
  }

  frontmatterFieldPopover.hidden = false;
  const fieldRect = field.getBoundingClientRect();
  const paneRect = previewPane.getBoundingClientRect();
  const left = Math.max(12, fieldRect.left - paneRect.left);
  const top = Math.max(12, fieldRect.top - paneRect.top - frontmatterFieldPopover.offsetHeight - 8);
  frontmatterFieldPopover.style.left = `${left}px`;
  frontmatterFieldPopover.style.top = `${top}px`;
}

function activeFrontmatterFieldElement() {
  const element = state.activeFrontmatterField?.element;
  if (element?.isConnected) {
    return element;
  }

  const field = state.activeFrontmatterField;
  if (!field || !Number.isInteger(field.line)) {
    return null;
  }
  return state.sourceEditor?.frontmatterFieldElement?.(field.line, field.key) ?? null;
}

async function handleFrontmatterFieldPopoverClick(event) {
  event.stopPropagation();
  const button = event.target.closest?.("[data-frontmatter-field-action]");
  if (!button || !state.activeFrontmatterField) {
    return;
  }

  const action = button.dataset.frontmatterFieldAction;
  if (action === "edit") {
    await editActiveFrontmatterField();
    return;
  }
  if (action === "toggle") {
    toggleActiveFrontmatterField();
    return;
  }
  if (action === "today") {
    updateActiveFrontmatterFieldValue(todayIsoDate());
    return;
  }
  if (action === "delete") {
    deleteActiveFrontmatterField();
    return;
  }
  if (action === "add") {
    await addFrontmatterField();
  }
}

function handleFrontmatterFieldPopoverChange(event) {
  event.stopPropagation();
  if (!event.target.closest?.("[data-frontmatter-field-value]") || !state.activeFrontmatterField) {
    return;
  }

  updateActiveFrontmatterFieldValue(event.target.value);
}

async function editActiveFrontmatterField() {
  const field = state.activeFrontmatterField;
  if (!field) {
    return;
  }

  const definition = frontmatterFieldDefinition(field.key);
  const { confirmed, values } = await showAppDialog({
    title: `编辑 ${field.key}`,
    fields: [dialogFieldForFrontmatterValue(definition, field.value)],
    confirmText: "保存",
    cancelText: "取消",
  });
  if (!confirmed) {
    return;
  }

  updateActiveFrontmatterFieldValue(values.value);
}

function toggleActiveFrontmatterField() {
  const field = state.activeFrontmatterField;
  if (!field) {
    return;
  }
  updateActiveFrontmatterFieldValue(normalizeFrontmatterBoolean(field.value) === "true" ? "false" : "true");
}

function updateActiveFrontmatterFieldValue(value) {
  const field = state.activeFrontmatterField;
  if (!field || !state.sourceEditor) {
    return;
  }

  const nextLine = frontmatterLineForValue(field.key, value);
  if (!nextLine) {
    showCopyToast("字段名无效");
    return;
  }
  const updated = state.sourceEditor.replaceLine(field.line, nextLine, { preserveSelection: true });
  if (!updated) {
    return;
  }

  state.activeFrontmatterField = {
    ...field,
    value: String(value ?? "").trim(),
    element: null,
  };
  recordTelemetryFeature("editing.frontmatter", { action: "edit", result: "success" });
  showCopyToast("已更新 frontmatter");
  window.requestAnimationFrame(() => {
    markActiveFrontmatterField();
    renderFrontmatterFieldPopover();
    positionFrontmatterFieldPopover();
  });
}

function deleteActiveFrontmatterField() {
  const field = state.activeFrontmatterField;
  if (!field || !state.sourceEditor) {
    return;
  }

  const deleted = state.sourceEditor.deleteLine(field.line);
  if (!deleted) {
    const source = state.sourceEditor.getValue();
    state.sourceEditor.replaceDocument(deleteFrontmatterLineFromSource(source, field.line));
  }
  clearActiveFrontmatterField();
  recordTelemetryFeature("editing.frontmatter", { action: "delete", result: "success" });
  showCopyToast("已删除 frontmatter 字段");
}

async function addFrontmatterField() {
  if (!state.sourceEditor || !state.currentDocument?.frontmatterProfile?.enabled) {
    return;
  }

  const source = state.sourceEditor.getValue();
  const existingKeys = new Set(frontmatterKeysFromSource(source));
  const fields = frontmatterProfileFields().filter((field) => !existingKeys.has(field.key));
  if (fields.length === 0) {
    showCopyToast("没有可添加的 frontmatter 字段");
    return;
  }

  const fieldResult = await showAppDialog({
    title: "添加 frontmatter 字段",
    fields: [{
      id: "field",
      label: "字段",
      value: fields[0].key,
      options: fields.map((field) => ({ label: field.key, value: field.key })),
    }],
    confirmText: "下一步",
    cancelText: "取消",
  });
  if (!fieldResult.confirmed) {
    return;
  }

  const definition = frontmatterFieldDefinition(fieldResult.values.field);
  const valueResult = await showAppDialog({
    title: `设置 ${definition.key}`,
    fields: [dialogFieldForFrontmatterValue(definition, defaultFrontmatterValue(definition))],
    confirmText: "添加",
    cancelText: "取消",
  });
  if (!valueResult.confirmed) {
    return;
  }

  const nextSource = addFrontmatterFieldToSource(source, definition.key, valueResult.values.value);
  state.sourceEditor.replaceDocument(nextSource);
  clearActiveFrontmatterField();
  recordTelemetryFeature("editing.frontmatter", { action: "add", result: "success" });
  showCopyToast("已添加 frontmatter 字段");
}

function frontmatterProfileFields() {
  const profile = state.currentDocument?.frontmatterProfile;
  return profile?.enabled && Array.isArray(profile.fields) ? profile.fields : [];
}

function frontmatterFieldDefinition(key) {
  return frontmatterProfileFields().find((field) => field.key === key) ?? {
    key,
    type: "text",
    values: [],
    inferredValue: "",
  };
}

function dialogFieldForFrontmatterValue(definition, value) {
  const currentValue = frontmatterEditorValue(value);
  const options = frontmatterFieldOptionValues(definition);
  if (currentValue && options.length > 0 && !options.includes(currentValue)) {
    options.unshift(currentValue);
  }
  return {
    id: "value",
    label: definition.key,
    value: currentValue,
    placeholder: definition.type === "date" ? "YYYY-MM-DD" : "",
    options: options.map((item) => ({ label: item, value: item })),
  };
}

function defaultFrontmatterValue(definition) {
  if (definition.inferredValue) {
    return definition.inferredValue;
  }
  if (definition.type === "date") {
    return todayIsoDate();
  }
  const values = frontmatterFieldOptionValues(definition);
  if (values.length > 0) {
    return values[0];
  }
  return "";
}

function normalizeFrontmatterBoolean(value) {
  return String(value ?? "").trim().toLowerCase() === "true" ? "true" : "false";
}

function todayIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function handleLinkPopoverClick(event) {
  event.stopPropagation();
  const button = event.target.closest?.("[data-link-action]");
  if (!button || !state.activeLink) {
    return;
  }

  const action = button.dataset.linkAction;
  if (action === "edit") {
    await editActiveLiveLink();
    return;
  }

  if (action === "open" || action === "open-tab") {
    await openActiveLiveLink({ newTab: action === "open-tab" });
  }
}

async function editActiveLiveLink() {
  const link = state.activeLink;
  if (!link || !canEditCurrentDocument()) {
    return;
  }

  const source = state.sourceEditor?.getValue() ?? state.currentDocument?.source ?? "";
  const lines = source.split(/\r?\n/);
  const currentLine = lines[link.line - 1] ?? "";
  const result = await showLinkFieldsDialog({
    title: "修改链接",
    message: "外部链接填 URL；仓库内文档填相对路径、根路径或 Git Leaf 文档 URL。",
    titleValue: link.text,
    linkValue: link.href,
    linkLabel: "link",
    linkPlaceholder: "docs/example.md 或 https://example.com",
    confirmText: "保存链接",
  });
  if (!result.confirmed) {
    return;
  }

  const nextMarkdown = await markdownFromLinkFields(result.values);
  const nextLink = parseMarkdownLink(nextMarkdown);
  if (!nextMarkdown || !nextLink) {
    return;
  }

  const nextLine = [
    currentLine.slice(0, link.from),
    nextMarkdown,
    currentLine.slice(link.to),
  ].join("");
  const updated = state.sourceEditor.replaceLine(link.line, nextLine, { preserveSelection: true });
  if (!updated) {
    return;
  }

  state.activeLink = {
    ...link,
    to: link.from + nextMarkdown.length,
    text: nextLink.text,
    href: nextLink.href,
    element: null,
  };
  showCopyToast("已更新链接");
  window.requestAnimationFrame(() => {
    markActiveLink();
    positionLinkPopover();
  });
}

async function markdownFromLinkFields(values = {}) {
  const href = String(values.link ?? "").trim();
  if (!href) {
    showCopyToast("链接不能为空");
    return "";
  }

  if (isGitLeafDocumentUrl(href) || looksLikeMarkdownDocumentHref(href)) {
    return documentLinkMarkdown(href, values.title);
  }
  return externalLinkMarkdownFromFields(values.title, href);
}

async function openActiveLiveLink({ newTab = false } = {}) {
  const href = state.activeLink?.href;
  if (!href) {
    return;
  }

  const documentTarget = await liveDocumentTargetFromHref(href);
  if (documentTarget) {
    if (newTab) {
      window.open(gitLeafAppHref(documentTarget), "_blank", "noopener");
      return;
    }

    await openFile(documentTarget.file, true, {
      repoId: documentTarget.repo,
      hash: documentTarget.hash,
    });
    return;
  }

  const url = browserHrefFromLink(href);
  if (newTab) {
    window.open(url, "_blank", "noopener");
    return;
  }
  window.location.href = url;
}

async function liveDocumentTargetFromHref(href) {
  const directTarget = gitLeafDocumentTargetFromHref(href);
  if (directTarget) {
    return directTarget;
  }
  if (!looksLikeMarkdownDocumentHref(href) || !state.currentDocument?.path) {
    return null;
  }

  try {
    const response = await fetch(apiUrl("/api/link-target", {
      file: state.currentDocument.path,
      target: href,
    }));
    const payload = await response.json().catch(() => ({ error: "无法打开目标文档" }));
    if (!response.ok || !payload.path) {
      throw new Error(payload.error || "无法打开目标文档");
    }
    return {
      repo: payload.repo || state.currentRepo,
      file: payload.path,
      hash: hashFromHref(payload.href || href),
    };
  } catch (error) {
    showCopyToast(error instanceof Error ? error.message : "无法打开目标文档");
    return null;
  }
}

function parseMarkdownLink(value) {
  const markdown = String(value ?? "").trim();
  const match = /^\[([^\]\n]+)\]\(([^)\n]+)\)$/.exec(markdown);
  if (!match) {
    return null;
  }

  return {
    markdown,
    text: match[1],
    href: match[2].trim(),
  };
}

function gitLeafDocumentTargetFromHref(href) {
  try {
    const url = new URL(String(href ?? "").trim(), window.location.origin);
    const file = url.searchParams.get("file") ?? "";
    if (!/^https?:$/i.test(url.protocol) || !/\.mdx?$/i.test(file)) {
      return null;
    }
    if (url.origin !== window.location.origin && !url.searchParams.has("repo")) {
      return null;
    }
    return {
      repo: url.searchParams.get("repo") || state.currentRepo,
      file,
      hash: url.hash,
    };
  } catch {
    return null;
  }
}

function looksLikeMarkdownDocumentHref(href) {
  const value = String(href ?? "").trim();
  if (!value) {
    return false;
  }
  if (gitLeafDocumentTargetFromHref(value)) {
    return true;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return false;
  }
  return /\.mdx?(?:[?#].*)?$/i.test(value.split(/[?#]/)[0]);
}

function gitLeafAppHref({ repo, file, hash = "" }) {
  const url = new URL("/", window.location.origin);
  url.searchParams.set("repo", repo || state.currentRepo);
  url.searchParams.set("file", file);
  url.hash = hash || "";
  return `${url.pathname}${url.search}${url.hash}`;
}

function browserHrefFromLink(href) {
  return new URL(String(href ?? "").trim(), window.location.href).href;
}

function hashFromHref(href) {
  try {
    return new URL(String(href ?? ""), window.location.origin).hash || "";
  } catch {
    const match = /#[^#]*$/.exec(String(href ?? ""));
    return match?.[0] ?? "";
  }
}

async function handleImagePopoverClick(event) {
  event.stopPropagation();
  const button = event.target.closest?.("[data-image-action]");
  if (!button || !state.activeImage) {
    return;
  }

  const line = state.activeImage.line;
  const source = state.sourceEditor?.getValue() ?? state.currentDocument?.source ?? "";
  const lines = source.split(/\r?\n/);
  const currentLine = lines[line - 1] ?? "";
  const action = button.dataset.imageAction;
  const options = {};
  if (action === "caption") {
    const currentCaption = imageLineAttributes(currentLine)?.["data-caption"] ?? "";
    const { confirmed, value } = await showAppDialog({
      title: "图片说明",
      message: "说明文字会显示在图片下方，并写入当前图片的 data-caption 属性。",
      inputLabel: "说明文字",
      inputValue: currentCaption,
      confirmText: "保存说明",
      cancelText: "取消",
    });
    if (!confirmed) {
      return;
    }
    options.caption = value;
  }

  const nextLine = imageLineForAction(currentLine, action, options);
  if (!nextLine || nextLine === currentLine) {
    return;
  }

  const updated = state.sourceEditor.replaceLine(line, nextLine, { preserveSelection: true });
  if (!updated) {
    return;
  }

  updateActiveImageElementFromLine(nextLine);
  showCopyToast("已更新图片");
  window.requestAnimationFrame(() => {
    markActiveImage();
    positionImagePopover();
  });
}

function updateActiveImageElementFromLine(lineText) {
  const image = activeImageElement();
  if (!image) {
    return;
  }

  const attributes = imageLineAttributes(lineText) ?? {};
  const align = normalizeImageAlign(attributes["data-align"]);
  const width = normalizeImageWidth(attributes.width);
  const caption = normalizeImageCaption(attributes["data-caption"]);
  const frame = image.closest(".git-leaf-image-frame");
  frame?.classList.toggle("is-align-center", align === "center");
  frame?.classList.toggle("is-align-left", align !== "center");
  frame?.setAttribute("data-image-align", align);
  image.dataset.imageAlign = align;
  if (caption) {
    image.dataset.imageCaption = caption;
  } else {
    delete image.dataset.imageCaption;
  }
  if (width) {
    image.setAttribute("width", String(width));
  }
  updateImageCaption(frame, caption);
}

function updateImageCaption(frame, caption) {
  if (!frame) {
    return;
  }

  let captionElement = frame.querySelector(".git-leaf-image-caption");
  if (!caption) {
    captionElement?.remove();
    return;
  }

  if (!captionElement) {
    captionElement = document.createElement(frame.tagName === "FIGURE" ? "figcaption" : "span");
    captionElement.className = "git-leaf-image-caption";
    frame.append(captionElement);
  }
  captionElement.textContent = caption;
}

function positionSelectionPopover() {
  if (!state.currentDocument || state.selectedLines.size === 0) {
    selectionPopover.hidden = true;
    return;
  }

  const selected = [...state.selectedLines].sort((left, right) => left - right);
  const anchorLine = selected.at(-1);
  const sourceAnchorRect = isEditorMode()
    ? state.sourceEditor?.lineRect(anchorLine)
    : null;
  const previewAnchor = sourceAnchorRect
    ? null
    : documentContent.querySelector(`[data-source-line="${anchorLine}"]`);
  const anchorRect = sourceAnchorRect ?? previewAnchor?.getBoundingClientRect();
  if (!anchorRect) {
    selectionPopover.hidden = true;
    return;
  }

  selectionPopover.hidden = false;
  const paneRect = document.querySelector(".preview-pane").getBoundingClientRect();
  const popoverWidth = selectionPopover.offsetWidth;
  const left = Math.max(anchorRect.left - paneRect.left - 8, popoverWidth + 8);
  selectionPopover.style.left = `${left}px`;
  selectionPopover.style.top = `${anchorRect.top - paneRect.top + anchorRect.height / 2}px`;
}

function scheduleListSourceLineGutterSync() {
  if (state.listSourceLineGutterFrame) {
    return;
  }

  state.listSourceLineGutterFrame = window.requestAnimationFrame(() => {
    state.listSourceLineGutterFrame = null;
    syncListSourceLineGutters();
  });
}

function syncListSourceLineGutters() {
  for (const gutter of documentContent.querySelectorAll('.source-line-gutter[data-source-line-layout="list"]')) {
    const block = gutter.closest(".source-block");
    const blockRect = block?.getBoundingClientRect();
    if (!blockRect) {
      continue;
    }

    for (const button of gutter.querySelectorAll("[data-source-line]")) {
      const line = button.dataset.sourceLine;
      const anchor = block.querySelector(`[data-source-list-line="${line}"]`);
      const anchorRect = anchor?.getBoundingClientRect();
      if (!anchorRect) {
        continue;
      }

      const top = Math.max(0, anchorRect.top - blockRect.top);
      button.style.setProperty("--source-line-top", `${top}px`);
    }
  }
}

function showCopyToast(message) {
  if (!copyToast) {
    return;
  }

  copyToast.textContent = message;
  copyToast.hidden = false;
  window.clearTimeout(state.copyToastTimer);
  state.copyToastTimer = window.setTimeout(() => {
    copyToast.hidden = true;
  }, 7000);
}

function lineFromDocumentGutterPoint(event) {
  return lineFromGutterPoint({
    x: event.clientX,
    y: event.clientY,
    buttonRects: [...documentContent.querySelectorAll("[data-source-line]")].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        line: Number(button.dataset.sourceLine),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    }),
  });
}

function isInteractiveClick(event) {
  return Boolean(event.target.closest?.("a, button, input, textarea, select, label, summary"));
}

function linesBetween(start, end) {
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  return Array.from({ length: upper - lower + 1 }, (_, index) => lower + index);
}

function frontmatterFilterCountBucket(count) {
  if (count <= 1) return "1";
  if (count <= 3) return "2_3";
  return "4_plus";
}

function itemCountBucket(count) {
  if (count <= 1) return "1";
  if (count <= 5) return "2_5";
  if (count <= 20) return "6_20";
  return "21_plus";
}

function durationBucket(durationMs) {
  if (durationMs < 1000) return "under_1s";
  if (durationMs < 3000) return "1_3s";
  if (durationMs < 10_000) return "3_10s";
  return "over_10s";
}

function retryCountBucket(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value === 1) return "1";
  return "2_plus";
}

function gitSyncDriftKind(value) {
  return ["content_changed", "head_changed", "post_commit_changed"].includes(value)
    ? value
    : "none";
}

function lineCountBucket(count) {
  if (count <= 1) return "1";
  if (count <= 5) return "2_5";
  return "6_plus";
}

function gitSyncTelemetryErrorCode(step) {
  const value = String(step ?? "").toLowerCase();
  if (value.includes("identity")) return "identity_missing";
  if (value.includes("origin")) return "origin_missing";
  if (value.includes("conflict")) return "conflict";
  if (value.includes("commit")) return "commit_failed";
  if (value.includes("workspace changed")) return "workspace_changed";
  if (value.includes("head changed")) return "head_changed";
  if (value.includes("pull")) return "pull_failed";
  if (value.includes("push")) return "push_failed";
  return "unknown";
}

function recordSlashCommandTelemetry(command) {
  recordTelemetryFeature("editing.slash_command", {
    command_category: command?.requiresMdx ? "mdx_component" : "markdown",
  });
}

function tableToCsv(table) {
  const rows = [...table.querySelectorAll("tr")];
  return rows
    .map((row) =>
      [...row.children]
        .map((cell) => `"${cell.textContent.replaceAll('"', '""').trim()}"`)
        .join(","),
    )
    .join("\n");
}

async function writeClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Finder- or automation-focused Electron windows can reject the async
      // clipboard API even though the document can still perform a copy.
    }
  }

  if (copyWithTextarea(value)) {
    return;
  }

  throw new Error("Clipboard write failed");
}

async function writeRichLinkClipboard(value, label) {
  const text = String(value ?? "");
  const normalizedLabel = String(label ?? "").trim() || text;
  const html = `<a href="${escapeHtml(text)}">${escapeHtml(normalizedLabel)}</a>`;

  if (navigator.clipboard?.write && typeof ClipboardItem === "function") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Some Electron focus states reject the async rich clipboard API. The
      // synchronous copy event below can still provide both representations.
    }
  }

  if (copyRichLinkWithTextarea(text, html)) {
    return;
  }

  // Keep sharing usable in clients that only allow plain-text clipboard writes.
  await writeClipboard(text);
}

function shareLinkClipboardTitle(value, fallbackPath = "") {
  try {
    const title = new URL(String(value ?? "")).searchParams.get("title")?.trim();
    if (title) {
      return title;
    }
  } catch {
    // Fall back to the repository-relative file name for malformed legacy URLs.
  }

  return String(fallbackPath).split("/").at(-1)?.trim() || "Git Leaf 文档";
}

function copyWithTextarea(value) {
  return copyWithTextareaData(value);
}

function copyRichLinkWithTextarea(value, html) {
  return copyWithTextareaData(value, html);
}

function copyWithTextareaData(value, html = "") {
  const text = String(value ?? "");
  const handleCopy = (event) => {
    event.clipboardData?.setData("text/plain", text);
    if (html) {
      event.clipboardData?.setData("text/html", html);
    }
    event.preventDefault();
  };
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  document.addEventListener("copy", handleCopy);
  textarea.focus({ preventScroll: true });
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", handleCopy);
    textarea.remove();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }
  return String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&");
}

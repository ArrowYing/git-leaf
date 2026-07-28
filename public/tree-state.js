export function treeDirectoryPath(parentPath, name) {
  return [parentPath, name].filter(Boolean).join("/");
}

export function treeDirectoryStateScope({
  repoId,
  view = "all",
  showOnlyGitChanges = false,
}) {
  const repo = typeof repoId === "string" && repoId.trim() ? repoId.trim() : "default";
  const normalizedView = showOnlyGitChanges || view === "sync"
    ? "git-changes"
    : view === "favorites"
      ? "favorites"
      : "all";
  return `${repo}:${normalizedView}`;
}

export function normalizeTreeDirectoryState(value) {
  return {
    expanded: uniqueStrings(value?.expanded),
    collapsed: uniqueStrings(value?.collapsed),
  };
}

export function normalizeTreeDirectoryStates(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const states = {};
  for (const [scope, state] of Object.entries(value)) {
    if (!scope) {
      continue;
    }

    const nextState = normalizeTreeDirectoryState(state);
    if (nextState.expanded.length > 0 || nextState.collapsed.length > 0) {
      states[scope] = nextState;
    }
  }
  return states;
}

export function treeDirectoryStateForView({
  view = "all",
  directoryState,
} = {}) {
  const normalizedState = normalizeTreeDirectoryState(directoryState);
  if (view === "sync") {
    return {
      expanded: [],
      collapsed: [],
    };
  }
  return normalizedState;
}

export function treeDirectoryStatesFromPreference({ preferences, fallbackValue } = {}) {
  if (preferences && typeof preferences === "object" && !Array.isArray(preferences)) {
    return normalizeTreeDirectoryStates(preferences.treeDirectories);
  }

  return normalizeTreeDirectoryStates(fallbackValue);
}

export function serializeTreeDirectoryState({ expandedDirectories, collapsedDirectories }) {
  return normalizeTreeDirectoryState({
    expanded: [...(expandedDirectories ?? [])],
    collapsed: [...(collapsedDirectories ?? [])],
  });
}

export function shouldRecordTreeDirectoryToggle({ previousOpen, nextOpen, programmatic = false }) {
  return programmatic !== true && previousOpen !== nextOpen;
}

export function shouldOpenTreeDirectory({
  directoryPath,
  hasBroadTreeFilter,
  expandedDirectories,
  collapsedDirectories,
}) {
  if (collapsedDirectories?.has(directoryPath)) {
    return false;
  }
  if (expandedDirectories?.has(directoryPath)) {
    return true;
  }
  if (hasBroadTreeFilter) {
    return true;
  }
  return false;
}

export function treeAncestorDirectories(filePath) {
  const parts = String(filePath || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
  const directories = [];
  for (let index = 1; index < parts.length; index += 1) {
    directories.push(parts.slice(0, index).join("/"));
  }
  return directories;
}

function uniqueStrings(value) {
  return [...new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string" && item) : [])];
}

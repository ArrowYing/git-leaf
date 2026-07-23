const MAX_WORKBENCH_SESSIONS = 50;
const MAX_SESSION_TABS = 20;

export function normalizeWorkbenchSessions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const sessions = {};
  for (const [repoId, session] of Object.entries(value).slice(0, MAX_WORKBENCH_SESSIONS)) {
    if (typeof repoId !== "string" || !repoId) {
      continue;
    }

    const normalized = normalizeWorkbenchSession(session);
    if (normalized) {
      sessions[repoId] = normalized;
    }
  }
  return sessions;
}

export function workbenchSessionForRepo(sessions, repoId) {
  const normalizedSessions = normalizeWorkbenchSessions(sessions);
  return normalizedSessions[repoId] ?? null;
}

export function workbenchSessionForLaunch(sessions, repoId, requestedFile = "") {
  const session = workbenchSessionForRepo(sessions, repoId);
  const requestedPath = safeRelativePath(requestedFile);
  if (!requestedPath) {
    return session;
  }

  const sessionTabs = session?.tabs ?? [];
  const tabs = sessionTabs.some((tab) => tab.path === requestedPath)
    ? sessionTabs
    : [...sessionTabs, { path: requestedPath }].slice(-MAX_SESSION_TABS);
  return {
    ...(session ?? {}),
    tabs,
    activeTabPath: requestedPath,
  };
}

export function serializeWorkbenchSession({
  tabs = [],
  activeTabPath = "",
  treeScrollTop = null,
  treeFocus = null,
} = {}) {
  return normalizeWorkbenchSession({
    tabs,
    activeTabPath,
    treeScrollTop,
    treeFocus,
  }) ?? {
    tabs: [],
    activeTabPath: "",
  };
}

function normalizeWorkbenchSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const hasExplicitTabs = Array.isArray(value.tabs);
  const tabs = normalizeSessionTabs(value.tabs);
  const activeTabPath = activeSessionPath({
    tabs,
    activeTabPath: safeRelativePath(value.activeTabPath),
  });
  const treeScrollTop = nonNegativeInteger(value.treeScrollTop);
  const treeFocus = normalizeTreeFocus(value.treeFocus);

  if (!hasExplicitTabs && treeScrollTop === null && !treeFocus) {
    return null;
  }

  return {
    ...(hasExplicitTabs ? { tabs } : {}),
    activeTabPath,
    ...(treeScrollTop === null ? {} : { treeScrollTop }),
    ...(treeFocus ? { treeFocus } : {}),
  };
}

function normalizeSessionTabs(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const tabs = [];
  for (const item of value) {
    const path = safeRelativePath(typeof item === "string" ? item : item?.path);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    tabs.push({ path });
    if (tabs.length >= MAX_SESSION_TABS) {
      break;
    }
  }
  return tabs;
}

function activeSessionPath({ tabs, activeTabPath }) {
  if (tabs.length === 0) {
    return "";
  }
  return tabs.some((tab) => tab.path === activeTabPath) ? activeTabPath : tabs[0].path;
}

function normalizeTreeFocus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const path = safeRelativePath(value.path);
  const itemType = value.itemType === "directory" ? "directory" : value.itemType === "file" ? "file" : "";
  return path && itemType ? { itemType, path } : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function safeRelativePath(value) {
  const path = String(value || "").replace(/\\/g, "/").trim();
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("../") ||
    path === ".." ||
    path.includes("/../") ||
    /^[a-zA-Z]:/.test(path)
  ) {
    return "";
  }
  return path;
}

export function completeWorkbenchStartup({
  root,
  loadingElement,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  scheduleTimeout = globalThis.setTimeout?.bind(globalThis),
} = {}) {
  root?.classList?.remove("is-workbench-loading");
  root?.classList?.add("is-workbench-ready");

  if (typeof requestFrame !== "function" || typeof scheduleTimeout !== "function") {
    loadingElement?.remove?.();
    root?.classList?.remove("is-workbench-ready");
    return;
  }

  requestFrame(() => {
    requestFrame(() => {
      scheduleTimeout(() => {
        loadingElement?.remove?.();
        root?.classList?.remove("is-workbench-ready");
      }, 140);
    });
  });
}

export function restoreDocumentTabsForStartup({
  session,
  normalizeTabs,
  resolveActiveTabId,
  applyTabState,
} = {}) {
  if (!session) {
    return false;
  }

  const tabs = normalizeTabs(session.tabs);
  const activeTabId = resolveActiveTabId({
    tabs,
    activeTabId: session.activeTabId,
    activePath: session.activeTabPath,
  });
  applyTabState({ tabs, activeTabId }, { render: true });
  return true;
}

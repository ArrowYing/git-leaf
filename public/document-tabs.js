export function tabTitleFromPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) || normalized || "Untitled";
}

export function openDocumentTab({ tabs = [], activePath = "", targetPath, behavior = "current" }) {
  const path = String(targetPath || "");
  if (!path) {
    return { tabs: normalizeTabs(tabs), activePath: "" };
  }

  const normalizedTabs = normalizeTabs(tabs);
  const existingIndex = normalizedTabs.findIndex((tab) => tab.path === path);
  if (existingIndex >= 0) {
    return {
      tabs: normalizedTabs,
      activePath: behavior === "background" ? activePath || normalizedTabs[existingIndex].path : path,
    };
  }

  if (normalizedTabs.length === 0) {
    return { tabs: [{ path }], activePath: path };
  }

  if (behavior === "current") {
    const activeIndex = normalizedTabs.findIndex((tab) => tab.path === activePath);
    const replaceIndex = activeIndex >= 0 ? activeIndex : 0;
    const nextTabs = normalizedTabs.map((tab, index) => index === replaceIndex ? { path } : tab);
    return { tabs: nextTabs, activePath: path };
  }

  return {
    tabs: [...normalizedTabs, { path }],
    activePath: behavior === "background" ? activePath || normalizedTabs[0]?.path || path : path,
  };
}

export function shouldSkipTreeDocumentLoad({
  behavior = "current",
  previousActivePath = "",
  nextActivePath = "",
  currentDocumentPath = "",
  targetPath = "",
} = {}) {
  if (behavior === "background" && previousActivePath && nextActivePath === previousActivePath) {
    return true;
  }
  return Boolean(
    targetPath &&
      currentDocumentPath === targetPath &&
      previousActivePath === targetPath &&
      nextActivePath === targetPath,
  );
}

export function closeDocumentTab({ tabs = [], activePath = "", targetPath }) {
  const normalizedTabs = normalizeTabs(tabs);
  const closeIndex = normalizedTabs.findIndex((tab) => tab.path === targetPath);
  if (closeIndex < 0) {
    return { tabs: normalizedTabs, activePath };
  }

  const nextTabs = normalizedTabs.filter((_, index) => index !== closeIndex);
  if (nextTabs.length === 0) {
    return { tabs: [], activePath: "" };
  }
  if (targetPath !== activePath) {
    return { tabs: nextTabs, activePath };
  }

  const nextActiveIndex = Math.min(closeIndex, nextTabs.length - 1);
  return { tabs: nextTabs, activePath: nextTabs[nextActiveIndex].path };
}

export function closeOtherDocumentTabs({ tabs = [], targetPath }) {
  const normalizedTabs = normalizeTabs(tabs);
  const target = normalizedTabs.find((tab) => tab.path === targetPath);
  return target
    ? { tabs: [target], activePath: target.path }
    : { tabs: normalizedTabs, activePath: normalizedTabs[0]?.path || "" };
}

export function closeDocumentTabsToRight({ tabs = [], activePath = "", targetPath }) {
  const normalizedTabs = normalizeTabs(tabs);
  const targetIndex = normalizedTabs.findIndex((tab) => tab.path === targetPath);
  if (targetIndex < 0 || targetIndex === normalizedTabs.length - 1) {
    return { tabs: normalizedTabs, activePath };
  }

  const nextTabs = normalizedTabs.slice(0, targetIndex + 1);
  return {
    tabs: nextTabs,
    activePath: nextTabs.some((tab) => tab.path === activePath) ? activePath : targetPath,
  };
}

export function reorderDocumentTabs({ tabs = [], sourcePath, targetPath, placement = "before" }) {
  const normalizedTabs = normalizeTabs(tabs);
  const sourceIndex = normalizedTabs.findIndex((tab) => tab.path === sourcePath);
  const targetIndex = normalizedTabs.findIndex((tab) => tab.path === targetPath);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return normalizedTabs;
  }

  const nextTabs = normalizedTabs.filter((tab) => tab.path !== sourcePath);
  const nextTargetIndex = nextTabs.findIndex((tab) => tab.path === targetPath);
  const insertIndex = placement === "after" ? nextTargetIndex + 1 : nextTargetIndex;
  nextTabs.splice(insertIndex, 0, { path: sourcePath });
  return nextTabs;
}

function normalizeTabs(tabs) {
  const seen = new Set();
  const result = [];
  for (const tab of tabs) {
    const path = String(tab?.path || "");
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push({ path });
  }
  return result;
}

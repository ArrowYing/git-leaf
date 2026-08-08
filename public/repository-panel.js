export const REPOSITORY_PANEL_SHOW_URL = "git-leaf://show-repositories";
export const REPOSITORY_PANEL_CLOSE_URL = "git-leaf://close-repositories";
export const REPOSITORY_PANEL_SWITCH_URL = "git-leaf://switch-repository";
export const REPOSITORY_PANEL_REMOVE_URL = "git-leaf://remove-repository";
export const REPOSITORY_PANEL_REORDER_URL = "git-leaf://reorder-repositories";
export const REPOSITORY_PANEL_OPEN_URL = "git-leaf://open-repository";

const REPOSITORY_PANEL_SHORTCUT_LIMIT = 9;

export function repositoryHeaderUsesWorktreeSelector({
  currentWorktree = null,
  worktreeCount = 0,
} = {}) {
  return Boolean(currentWorktree) && Number(worktreeCount) > 1;
}

export function normalizeRepositoryPanelItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const id = String(item?.id ?? "").trim();
    const name = String(item?.name ?? "").trim();
    if (!id || !name || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      name,
      context: String(item?.context ?? "").trim(),
      current: item?.current === true,
    });
  }

  return normalized;
}

export function visibleRepositoryPanelItems(items, query = "") {
  const tokens = normalizedRepositoryQueryTokens(query);
  let shortcut = 1;
  return normalizeRepositoryPanelItems(items)
    .filter((item) => repositoryPanelItemMatches(item, tokens))
    .map((item) => ({
      ...item,
      shortcut: !item.current && shortcut <= REPOSITORY_PANEL_SHORTCUT_LIMIT
        ? shortcut++
        : null,
    }));
}

export function defaultRepositoryPanelSelection(items) {
  const normalized = Array.isArray(items) ? items : [];
  return normalized.find((item) => !item.current)?.id ?? normalized[0]?.id ?? "";
}

export function moveRepositoryPanelSelection(items, selectedId, direction) {
  const normalized = Array.isArray(items) ? items : [];
  if (normalized.length === 0) {
    return "";
  }
  const step = Number(direction) < 0 ? -1 : 1;
  const currentIndex = normalized.findIndex((item) => item.id === selectedId);
  const startIndex = currentIndex < 0 ? (step < 0 ? 0 : -1) : currentIndex;
  return normalized[(startIndex + step + normalized.length) % normalized.length]?.id ?? "";
}

export function reorderRepositoryPanelItems(
  items,
  movedId,
  targetId,
  placement = "before",
) {
  const normalized = normalizeRepositoryPanelItems(items);
  const sourceIndex = normalized.findIndex((item) => item.id === movedId);
  const targetIndex = normalized.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return normalized;
  }

  const reordered = [...normalized];
  const [movedItem] = reordered.splice(sourceIndex, 1);
  const remainingTargetIndex = reordered.findIndex((item) => item.id === targetId);
  const insertionIndex = remainingTargetIndex + (placement === "after" ? 1 : 0);
  reordered.splice(insertionIndex, 0, movedItem);
  return reordered;
}

export function repositoryPanelItemForShortcut(items, shortcut) {
  const number = Number(shortcut);
  if (!Number.isInteger(number) || number < 1 || number > REPOSITORY_PANEL_SHORTCUT_LIMIT) {
    return null;
  }
  return (Array.isArray(items) ? items : []).find((item) => item.shortcut === number) ?? null;
}

export function repositoryPanelActionUrl(action, repositoryId = "") {
  const baseUrl = {
    show: REPOSITORY_PANEL_SHOW_URL,
    close: REPOSITORY_PANEL_CLOSE_URL,
    switch: REPOSITORY_PANEL_SWITCH_URL,
    remove: REPOSITORY_PANEL_REMOVE_URL,
    open: REPOSITORY_PANEL_OPEN_URL,
  }[action];
  if (!baseUrl) {
    return "";
  }
  const url = new URL(baseUrl);
  const id = String(repositoryId ?? "").trim();
  if (id) {
    url.searchParams.set("id", id);
  }
  return url.href;
}

export function repositoryPanelReorderUrl(repositoryIds) {
  const ids = Array.isArray(repositoryIds)
    ? repositoryIds.map((id) => String(id ?? "").trim())
    : [];
  if (
    ids.length < 2
    || new Set(ids).size !== ids.length
    || ids.some((id) => !/^[a-f0-9]{16}$/u.test(id))
  ) {
    return "";
  }
  const url = new URL(REPOSITORY_PANEL_REORDER_URL);
  for (const id of ids) {
    url.searchParams.append("id", id);
  }
  return url.href;
}

function normalizedRepositoryQueryTokens(query) {
  return String(query ?? "")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

function repositoryPanelItemMatches(item, tokens) {
  if (tokens.length === 0) {
    return true;
  }
  const searchable = `${item.name} ${item.context}`.toLocaleLowerCase();
  return tokens.every((token) => searchable.includes(token));
}

const MAX_FAVORITE_SCOPES = 50;
const MAX_FAVORITES_PER_SCOPE = 200;
const MAX_FAVORITE_PATH_LENGTH = 1024;
const FAVORITE_TYPES = new Set(["directory", "document"]);

export function normalizeSidebarFavoriteScopes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const scopes = {};
  for (const [scope, favorites] of Object.entries(value).slice(0, MAX_FAVORITE_SCOPES)) {
    if (typeof scope !== "string" || !scope.trim()) {
      continue;
    }
    const normalized = normalizeSidebarFavorites(favorites);
    if (normalized.length > 0) {
      scopes[scope] = normalized;
    }
  }
  return scopes;
}

export function sidebarFavoritesForScope(value, scope) {
  return normalizeSidebarFavoriteScopes(value)[scope] ?? [];
}

export function createSidebarFavoriteToggleQueue({ isActive, setActive }) {
  if (typeof isActive !== "function" || typeof setActive !== "function") {
    throw new TypeError("Favorite toggle queue requires state callbacks");
  }
  let queue = Promise.resolve();
  return (favorite) => {
    const mutation = queue.then(() => setActive({
      ...favorite,
      active: !isActive(favorite),
    }));
    queue = mutation.catch(() => false);
    return mutation;
  };
}

export function applySidebarFavoriteOperation(value, {
  scope,
  action,
  type,
  path,
  toPath = "",
} = {}) {
  const scopes = normalizeSidebarFavoriteScopes(value);
  const favorite = normalizeSidebarFavorite({ type, path });
  if (!favorite || typeof scope !== "string" || !scope.trim()) {
    return { scopes, favorites: scopes[scope] ?? [], changed: false };
  }

  if (action === "replace") {
    const nextScopes = replaceSidebarFavoritePath(scopes, {
      scope,
      type,
      fromPath: path,
      toPath,
    });
    return {
      scopes: nextScopes,
      favorites: nextScopes[scope] ?? [],
      changed: JSON.stringify(nextScopes) !== JSON.stringify(scopes),
    };
  }

  const favorites = scopes[scope] ?? [];
  const index = favorites.findIndex((item) => (
    item.type === favorite.type && item.path === favorite.path
  ));
  if (action === "add") {
    if (index >= 0 || favorites.length >= MAX_FAVORITES_PER_SCOPE) {
      return { scopes, favorites, changed: false };
    }
    const nextFavorites = [...favorites, favorite];
    return {
      scopes: { ...scopes, [scope]: nextFavorites },
      favorites: nextFavorites,
      changed: true,
    };
  }
  if (action === "remove") {
    if (index < 0) {
      return { scopes, favorites, changed: false };
    }
    const nextFavorites = favorites.filter((_, itemIndex) => itemIndex !== index);
    const nextScopes = { ...scopes };
    if (nextFavorites.length > 0) {
      nextScopes[scope] = nextFavorites;
    } else {
      delete nextScopes[scope];
    }
    return { scopes: nextScopes, favorites: nextFavorites, changed: true };
  }
  return { scopes, favorites, changed: false };
}

export function replaceSidebarFavoritePath(value, {
  scope,
  type,
  fromPath,
  toPath,
} = {}) {
  const scopes = normalizeSidebarFavoriteScopes(value);
  const from = normalizeSidebarFavorite({ type, path: fromPath });
  const to = normalizeSidebarFavorite({ type, path: toPath });
  if (!from || !to || typeof scope !== "string" || !scope || !scopes[scope]) {
    return scopes;
  }

  const favorites = scopes[scope].map((item) => (
    item.type === from.type && item.path === from.path ? to : item
  ));
  const normalized = normalizeSidebarFavorites(favorites);
  return normalized.length > 0
    ? { ...scopes, [scope]: normalized }
    : Object.fromEntries(Object.entries(scopes).filter(([key]) => key !== scope));
}

export function favoriteNodesFromTree(nodes, favorites) {
  const index = new Map();
  indexTreeNodes(Array.isArray(nodes) ? nodes : [], "", index);

  const result = [];
  for (const favorite of normalizeSidebarFavorites(favorites)) {
    const node = index.get(`${favorite.type}:${favorite.path}`);
    if (!node) {
      result.push(missingFavoriteNode(favorite));
      continue;
    }
    const cloned = cloneTreeNode(node);
    result.push(favorite.type === "directory"
      ? { ...cloned, path: favorite.path }
      : cloned);
  }
  return result;
}

export function normalizeSidebarFavorites(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const favorites = [];
  for (const item of value) {
    const favorite = normalizeSidebarFavorite(item);
    if (!favorite) {
      continue;
    }
    const key = `${favorite.type}:${favorite.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    favorites.push(favorite);
    if (favorites.length >= MAX_FAVORITES_PER_SCOPE) {
      break;
    }
  }
  return favorites;
}

export function isSidebarFavoriteEntry(value, { type, path } = {}) {
  const favorite = normalizeSidebarFavorite({ type, path });
  return Boolean(favorite) && normalizeSidebarFavorites(value).some((item) => (
    item.type === favorite.type && item.path === favorite.path
  ));
}

function normalizeSidebarFavorite(value) {
  const type = FAVORITE_TYPES.has(value?.type) ? value.type : "";
  const path = safeRelativePath(value?.path);
  if (!type || !path || (type === "document" && !/\.(?:md|mdx)$/i.test(path))) {
    return null;
  }
  return { type, path };
}

function safeRelativePath(value) {
  const path = String(value || "").replaceAll("\\", "/").trim();
  if (
    !path ||
    path.length > MAX_FAVORITE_PATH_LENGTH ||
    /[\0\r\n]/.test(path) ||
    path.startsWith("/") ||
    path.startsWith("../") ||
    path === ".." ||
    path.includes("/../") ||
    /^[a-zA-Z]:/.test(path)
  ) {
    return "";
  }
  const normalized = path.replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized.split("/").some((segment) => segment === "." || segment === "..")
    ? ""
    : normalized;
}

function indexTreeNodes(nodes, parentPath, index) {
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    if (node.type === "file") {
      const path = safeRelativePath(node.path || [parentPath, node.name].filter(Boolean).join("/"));
      if (path && /\.(?:md|mdx)$/i.test(path)) {
        index.set(`document:${path}`, node);
      }
      continue;
    }
    if (node.type !== "directory") {
      continue;
    }
    const path = safeRelativePath([parentPath, node.name].filter(Boolean).join("/"));
    if (!path) {
      continue;
    }
    index.set(`directory:${path}`, node);
    indexTreeNodes(Array.isArray(node.children) ? node.children : [], path, index);
  }
}

function cloneTreeNode(node) {
  if (node.type !== "directory") {
    return { ...node };
  }
  return {
    ...node,
    children: (Array.isArray(node.children) ? node.children : []).map(cloneTreeNode),
  };
}

/**
 * Return a tree-renderable placeholder while preserving the favorite identity.
 * Missing entries retain their repository-relative path so the Favorites view
 * can still offer "Remove from favorites" in another branch or worktree.
 */
function missingFavoriteNode(favorite) {
  if (favorite.type === "directory") {
    return {
      type: "directory",
      name: favorite.path.split("/").at(-1) || favorite.path,
      path: favorite.path,
      children: [],
      missing: true,
    };
  }
  return {
    type: "file",
    name: favorite.path.split("/").at(-1) || favorite.path,
    path: favorite.path,
    kind: "unknown",
    missing: true,
  };
}

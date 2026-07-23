export function normalizeFrontmatterFilters(filters, allowedKeys = []) {
  const allowedKeySet = new Set(normalizeAllowedFrontmatterKeys(allowedKeys));
  const byKey = new Map();
  for (const filter of filters ?? []) {
    const key = String(filter?.key ?? "");
    if (!allowedKeySet.has(key)) {
      continue;
    }

    const value = normalizeFrontmatterValue(filter?.value);
    if (!value) {
      continue;
    }
    byKey.set(key, { key, value });
  }
  return [...byKey.values()];
}

export function fileMatchesFrontmatterFilters(metadata, filters, allowedKeys = []) {
  const normalizedFilters = normalizeFrontmatterFilters(filters, allowedKeys);
  if (normalizedFilters.length === 0) {
    return true;
  }

  if (!metadata) {
    return false;
  }

  return normalizedFilters.every(({ key, value }) => {
    const rawValue = metadata[key];
    if (Array.isArray(rawValue)) {
      return rawValue.map(normalizeFrontmatterValue).includes(value);
    }
    return normalizeFrontmatterValue(rawValue) === value;
  });
}

export function filterFrontmatterTree(nodes, metadataByPath, filters, allowedKeys = []) {
  const normalizedFilters = normalizeFrontmatterFilters(filters, allowedKeys);
  if (normalizedFilters.length === 0) {
    return nodes;
  }

  const filtered = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (fileMatchesFrontmatterFilters(metadataByPath?.[node.path], normalizedFilters, allowedKeys)) {
        filtered.push(node);
      }
      continue;
    }

    const children = filterFrontmatterTree(node.children, metadataByPath, normalizedFilters, allowedKeys);
    if (children.length > 0) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

export function fileMatchesTextFilter(node, metadata, filter) {
  const tokens = searchTokens(filter);
  if (tokens.length === 0) {
    return true;
  }

  const searchableText = [
    node?.path,
    node?.name,
    metadata?.ai_snippet,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return tokens.every((token) => searchableText.includes(token));
}

export function normalizeFrontmatterValue(value) {
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number") {
    return String(value);
  }
  return String(value ?? "").trim();
}

function searchTokens(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeAllowedFrontmatterKeys(allowedKeys) {
  return Array.isArray(allowedKeys)
    ? allowedKeys.map((key) => String(key ?? "").trim()).filter(Boolean)
    : [];
}

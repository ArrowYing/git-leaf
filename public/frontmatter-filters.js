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
    node?.name,
    metadata?.ai_snippet,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return textIncludesAllTokens(searchableText, tokens);
}

export function directoryMatchesTextFilter(node, filter) {
  const tokens = searchTokens(filter);
  if (tokens.length === 0) {
    return true;
  }
  return textIncludesAllTokens(node?.name, tokens);
}

export function filterTextTree(nodes, metadataByPath, filter) {
  const tokens = searchTokens(filter);
  if (tokens.length === 0) {
    return nodes;
  }
  return filterTextTreeWithTokens(
    Array.isArray(nodes) ? nodes : [],
    metadataByPath,
    tokens,
  );
}

export function textFilterMatchRanges(text, filter) {
  const normalizedText = String(text ?? "").toLowerCase();
  const ranges = [];
  for (const token of searchTokens(filter)) {
    let from = normalizedText.indexOf(token);
    while (from !== -1) {
      ranges.push({ from, to: from + token.length });
      from = normalizedText.indexOf(token, from + token.length);
    }
  }

  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
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
  return [...new Set(String(value ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean))];
}

function textIncludesAllTokens(text, tokens) {
  const normalizedText = String(text ?? "").toLowerCase();
  return tokens.every((token) => normalizedText.includes(token));
}

function filterTextTreeWithTokens(nodes, metadataByPath, tokens) {
  const filtered = [];
  for (const node of nodes) {
    if (node.type === "file") {
      const searchableText = [
        node?.name,
        metadataByPath?.[node.path]?.ai_snippet,
      ]
        .filter(Boolean)
        .join(" ");
      if (textIncludesAllTokens(searchableText, tokens)) {
        filtered.push(node);
      }
      continue;
    }

    const children = filterTextTreeWithTokens(
      Array.isArray(node.children) ? node.children : [],
      metadataByPath,
      tokens,
    );
    if (children.length > 0 || textIncludesAllTokens(node?.name, tokens)) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

function normalizeAllowedFrontmatterKeys(allowedKeys) {
  return Array.isArray(allowedKeys)
    ? allowedKeys.map((key) => String(key ?? "").trim()).filter(Boolean)
    : [];
}

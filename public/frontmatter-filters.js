import { displayedTreeFileTitle } from "./tree-file-title.js";

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
  return fileTextFilterMatchDetails(node, metadata, filter).matches;
}

export function fileTextFilterMatchDetails(
  node,
  metadata,
  filter,
  { maxSnippetLength = 120 } = {},
) {
  const tokens = searchTokens(filter);
  const name = String(node?.name ?? "");
  const title = displayedTreeFileTitle(node);
  const snippet = String(metadata?.ai_snippet ?? "");
  if (tokens.length === 0) {
    return {
      matches: true,
      nameMatchesAllTokens: true,
      nameRanges: [],
      snippetMatch: null,
      snippetExcerpt: null,
    };
  }

  const visibleText = [name, title]
    .filter(Boolean)
    .join(" ");
  const searchableText = [visibleText, snippet]
    .filter(Boolean)
    .join(" ");
  const matches = textIncludesAllTokens(searchableText, tokens);
  const nameMatchesAllTokens = textIncludesAllTokens(name, tokens);
  const visibleTextMatchesAllTokens = textIncludesAllTokens(visibleText, tokens);
  const snippetMatch =
    matches && !visibleTextMatchesAllTokens
      ? {
          text: snippet,
          ranges: textMatchRangesForTokens(snippet, tokens),
        }
      : null;

  return {
    matches,
    nameMatchesAllTokens,
    nameRanges: matches ? textMatchRangesForTokens(name, tokens) : [],
    snippetMatch,
    snippetExcerpt:
      matches && !visibleTextMatchesAllTokens
        ? textFilterExcerpt(snippet, tokens, maxSnippetLength)
        : null,
  };
}

export function directoryMatchesTextFilter(node, filter) {
  const tokens = searchTokens(filter);
  if (tokens.length === 0) {
    return true;
  }
  return textIncludesAllTokens(node?.name, tokens);
}

export function filterTextTree(
  nodes,
  metadataByPath,
  filter,
  { expandedDirectoryPaths = new Set() } = {},
) {
  const tokens = searchTokens(filter);
  if (tokens.length === 0) {
    return nodes;
  }
  return filterTextTreeWithTokens(
    Array.isArray(nodes) ? nodes : [],
    metadataByPath,
    tokens,
    {
      expandedDirectoryPaths: normalizePathSet(expandedDirectoryPaths),
      parentPath: "",
    },
  );
}

export function textFilterMatchRanges(text, filter) {
  return textMatchRangesForTokens(text, searchTokens(filter));
}

function textMatchRangesForTokens(text, tokens) {
  const normalizedText = String(text ?? "").toLowerCase();
  const ranges = [];
  for (const token of tokens) {
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

function textFilterExcerpt(text, tokens, maxLength) {
  const source = String(text ?? "");
  const ranges = textMatchRangesForTokens(source, tokens);
  if (ranges.length === 0) {
    return null;
  }

  const firstMatch = ranges[0];
  const excerptLength = Math.max(
    24,
    firstMatch.to - firstMatch.from,
    Number.isFinite(maxLength) ? Math.trunc(maxLength) : 120,
  );
  if (source.length <= excerptLength) {
    return { text: source, ranges };
  }

  const leadingContext = Math.min(
    32,
    Math.floor((excerptLength - (firstMatch.to - firstMatch.from)) / 2),
  );
  let from = Math.max(0, firstMatch.from - leadingContext);
  let to = Math.min(source.length, from + excerptLength);
  if (to - from < excerptLength) {
    from = Math.max(0, to - excerptLength);
  }

  const prefix = from > 0 ? "…" : "";
  const suffix = to < source.length ? "…" : "";
  const visibleRanges = ranges
    .filter((range) => range.to > from && range.from < to)
    .map((range) => ({
      from: Math.max(range.from, from) - from + prefix.length,
      to: Math.min(range.to, to) - from + prefix.length,
    }));

  return {
    text: `${prefix}${source.slice(from, to)}${suffix}`,
    ranges: visibleRanges,
  };
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

function filterTextTreeWithTokens(
  nodes,
  metadataByPath,
  tokens,
  { expandedDirectoryPaths, parentPath },
) {
  const filtered = [];
  for (const node of nodes) {
    if (node.type === "file") {
      const searchableText = [
        node?.name,
        displayedTreeFileTitle(node),
        metadataByPath?.[node.path]?.ai_snippet,
      ]
        .filter(Boolean)
        .join(" ");
      if (textIncludesAllTokens(searchableText, tokens)) {
        filtered.push(node);
      }
      continue;
    }

    const directoryPath = normalizedNodePath(node, parentPath);
    const matchesDirectory = textIncludesAllTokens(node?.name, tokens);
    const children = matchesDirectory && expandedDirectoryPaths.has(directoryPath)
      ? (Array.isArray(node.children) ? node.children : [])
      : filterTextTreeWithTokens(
          Array.isArray(node.children) ? node.children : [],
          metadataByPath,
          tokens,
          {
            expandedDirectoryPaths,
            parentPath: directoryPath,
          },
        );
    if (children.length > 0 || matchesDirectory) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

function normalizePathSet(value) {
  const paths = value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value
      : [];
  return new Set(paths.map(normalizePath).filter(Boolean));
}

function normalizedNodePath(node, parentPath) {
  return normalizePath(
    node?.path || [parentPath, node?.name].filter(Boolean).join("/"),
  );
}

function normalizePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
}

function normalizeAllowedFrontmatterKeys(allowedKeys) {
  return Array.isArray(allowedKeys)
    ? allowedKeys.map((key) => String(key ?? "").trim()).filter(Boolean)
    : [];
}

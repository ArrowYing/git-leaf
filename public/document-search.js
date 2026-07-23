const DEFAULT_MATCH_LIMIT = 5000;
const DEFAULT_EXCLUDED_SELECTOR = [
  ".source-line-gutter",
  "[hidden]",
  "[aria-hidden=\"true\"]",
  "script",
  "style",
].join(", ");

export function findTextMatches(text, query, { limit = DEFAULT_MATCH_LIMIT } = {}) {
  const source = String(text ?? "");
  const needle = String(query ?? "");
  if (!needle || limit <= 0) {
    return [];
  }

  const matches = [];
  const matcher = new RegExp(escapeRegExp(needle), "giu");
  for (const match of source.matchAll(matcher)) {
    if (!Number.isInteger(match.index)) {
      continue;
    }
    matches.push({
      from: match.index,
      to: match.index + match[0].length,
    });
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

export function nextSearchIndex(currentIndex, matchCount, direction = 1) {
  if (!Number.isInteger(matchCount) || matchCount <= 0) {
    return -1;
  }
  const step = direction < 0 ? -1 : 1;
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= matchCount) {
    return step < 0 ? matchCount - 1 : 0;
  }
  return (currentIndex + step + matchCount) % matchCount;
}

export function findTextRanges(root, query, { excludeSelector = DEFAULT_EXCLUDED_SELECTOR } = {}) {
  if (!root?.ownerDocument) {
    return [];
  }

  const { text, segments } = searchableText(root, excludeSelector);
  return findTextMatches(text, query).flatMap((match) => {
    const start = segmentForStart(segments, match.from);
    const end = segmentForEnd(segments, match.to);
    if (!start || !end) {
      return [];
    }

    const range = root.ownerDocument.createRange();
    range.setStart(start.node, match.from - start.from);
    range.setEnd(end.node, match.to - end.from);
    return [{ ...match, range }];
  });
}

function searchableText(root, excludeSelector) {
  const view = root.ownerDocument.defaultView;
  const nodeFilter = view?.NodeFilter ?? globalThis.NodeFilter;
  if (!nodeFilter) {
    return { text: "", segments: [] };
  }

  const walker = root.ownerDocument.createTreeWalker(root, nodeFilter.SHOW_TEXT);
  const segments = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    if (!value || node.parentElement?.closest(excludeSelector)) {
      continue;
    }
    const from = text.length;
    text += value;
    segments.push({ node, from, to: text.length });
  }
  return { text, segments };
}

function segmentForStart(segments, offset) {
  return segments.find((segment) => segment.from <= offset && offset < segment.to) ?? null;
}

function segmentForEnd(segments, offset) {
  return segments.find((segment) => segment.from < offset && offset <= segment.to) ?? null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

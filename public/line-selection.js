export function rangesFromLines(lines) {
  const sorted = [...new Set(lines)].sort((left, right) => left - right);
  const ranges = [];
  for (const line of sorted) {
    const previous = ranges.at(-1);
    if (previous && line === previous.end + 1) {
      previous.end = line;
    } else {
      ranges.push({ start: line, end: line });
    }
  }
  return ranges;
}

export function selectionForSourceRange({
  selectedLines = [],
  selectionAnchor = null,
  start,
  end = start,
  extend = false,
  toggle = false,
}) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return {
      selectedLines: [...new Set(selectedLines)].sort((left, right) => left - right),
      selectionAnchor,
    };
  }

  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  const rangeLines = inclusiveLines(lower, upper);
  if (extend && Number.isInteger(selectionAnchor)) {
    return {
      selectedLines: inclusiveLines(
        Math.min(selectionAnchor, lower),
        Math.max(selectionAnchor, upper),
      ),
      selectionAnchor,
    };
  }

  if (toggle) {
    const next = new Set(selectedLines);
    const remove = rangeLines.every((line) => next.has(line));
    for (const line of rangeLines) {
      if (remove) {
        next.delete(line);
      } else {
        next.add(line);
      }
    }
    return {
      selectedLines: [...next].sort((left, right) => left - right),
      selectionAnchor: upper,
    };
  }

  return {
    selectedLines: rangeLines,
    selectionAnchor: upper,
  };
}

export function sourceLinesFromMarkdown(source) {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  if (parts.length > 1 && parts.at(-1) === "") {
    parts.pop();
  }

  return parts.map((text, index) => ({
    number: index + 1,
    text,
  }));
}

function inclusiveLines(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function formatLineRange(lines) {
  return rangesFromLines(lines)
    .map((range) => (range.start === range.end ? String(range.start) : `${range.start}-${range.end}`))
    .join(",");
}

export function parseLineHash(hash) {
  const match = hash.match(/^#L(\d+)(?:-L?(\d+))?$/);
  if (!match) {
    return [];
  }
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return [];
  }
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  return Array.from({ length: upper - lower + 1 }, (_, index) => lower + index);
}

export function hashFromLines(lines) {
  const ranges = rangesFromLines(lines);
  if (ranges.length !== 1) {
    return "";
  }
  const [{ start, end }] = ranges;
  return start === end ? `#L${start}` : `#L${start}-L${end}`;
}

export function lineFromSelectionPoint({
  y,
  start,
  end,
  blockTop,
  blockBottom,
  buttonRects = [],
}) {
  for (const rect of buttonRects) {
    if (y >= rect.top && y <= rect.bottom) {
      return rect.line;
    }
  }

  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  const lineCount = upper - lower + 1;
  if (lineCount <= 0) {
    return null;
  }

  const height = Math.max(blockBottom - blockTop, 1);
  const clampedY = Math.min(Math.max(y, blockTop), blockBottom);
  const ratio = Math.min(Math.max((clampedY - blockTop) / height, 0), 0.999999);
  return lower + Math.min(lineCount - 1, Math.floor(ratio * lineCount));
}

export function lineFromGutterPoint({
  x,
  y,
  buttonRects = [],
  leftTolerance = 8,
  rightTolerance = 24,
}) {
  const rects = buttonRects.filter((rect) =>
    [rect.line, rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite),
  );
  if (rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  if (x < left - leftTolerance || x > right + rightTolerance) {
    return null;
  }

  for (const rect of rects) {
    if (y >= rect.top && y <= rect.bottom) {
      return rect.line;
    }
  }

  const nearest = rects.reduce((best, rect) => {
    const center = (rect.top + rect.bottom) / 2;
    const distance = Math.abs(y - center);
    return distance < best.distance ? { line: rect.line, distance } : best;
  }, { line: null, distance: Number.POSITIVE_INFINITY });

  return nearest.line;
}

export function shouldClearLineSelection({
  selectedCount,
  isInteractive,
  hasLineTarget,
  gutterLine,
}) {
  return selectedCount > 0 && !isInteractive && !hasLineTarget && !Number.isInteger(gutterLine);
}

export function formatLineReference({ path, selectedLines, sourceLines }) {
  const selected = [...new Set(selectedLines)].sort((left, right) => left - right);
  if (selected.length === 0) {
    return "";
  }

  const lineText = new Map(sourceLines.map((line) => [line.number, line.text]));
  const body = formatQuotedSourceLines(selected.map((lineNumber) => ({
    number: lineNumber,
    text: lineText.get(lineNumber) ?? "",
  })));

  return `${body}

Source: ${path}:${formatLineRange(selected)}

`;
}

export function formatQuotedSourceLines(sourceLines) {
  return sourceLines
    .map((line) => {
      const text = String(line.text ?? "");
      return `> ${line.number} |${text === "" ? "" : ` ${text}`}`;
    })
    .join("\n");
}

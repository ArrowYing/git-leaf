const EMPTY_CHANGE_MODEL = Object.freeze({
  available: false,
  changed: false,
  hasDeletions: false,
  changedLines: [],
  currentLines: [],
  textRanges: [],
  inlineDeletions: [],
  lineDeletions: [],
});
const MAX_MYERS_DIFF_DEPTH = 512;

export function emptyDocumentChangeModel() {
  return {
    ...EMPTY_CHANGE_MODEL,
    changedLines: [],
    currentLines: [],
    textRanges: [],
    inlineDeletions: [],
    lineDeletions: [],
  };
}

export function createDocumentChangeModel({
  baselineSource = "",
  currentSource = "",
  available = true,
} = {}) {
  if (!available) {
    return emptyDocumentChangeModel();
  }

  const baseline = normalizeSource(baselineSource);
  const current = normalizeSource(currentSource);
  const baselineLines = sourceLineRecords(baseline);
  const currentLines = sourceLineRecords(current);
  const operations = diffSequence(
    baselineLines,
    currentLines,
    (left, right) => left.text === right.text,
  );
  const lineStates = Array.from({ length: currentLines.length }, (_, index) => ({
    line: index + 1,
    baselineLine: null,
    kind: "added",
  }));
  const changedLines = new Set();
  const textRanges = [];
  const inlineDeletions = [];
  const lineDeletions = [];

  for (let operationIndex = 0; operationIndex < operations.length;) {
    const operation = operations[operationIndex];
    if (operation.type === "equal") {
      lineStates[operation.afterIndex] = {
        line: operation.afterIndex + 1,
        baselineLine: operation.beforeIndex + 1,
        kind: "unchanged",
      };
      operationIndex += 1;
      continue;
    }

    const hunk = [];
    while (operationIndex < operations.length && operations[operationIndex].type !== "equal") {
      hunk.push(operations[operationIndex]);
      operationIndex += 1;
    }
    const removed = hunk.filter((item) => item.type === "delete");
    const inserted = hunk.filter((item) => item.type === "insert");
    const pairedCount = Math.min(removed.length, inserted.length);

    for (let pairIndex = 0; pairIndex < pairedCount; pairIndex += 1) {
      const beforeLine = baselineLines[removed[pairIndex].beforeIndex];
      const afterLine = currentLines[inserted[pairIndex].afterIndex];
      const currentLineNumber = inserted[pairIndex].afterIndex + 1;
      lineStates[inserted[pairIndex].afterIndex] = {
        line: currentLineNumber,
        baselineLine: removed[pairIndex].beforeIndex + 1,
        kind: "modified",
      };
      changedLines.add(currentLineNumber);
      const inline = inlineLineChanges(beforeLine.text, afterLine.text, {
        currentLineNumber,
        baselineLineNumber: removed[pairIndex].beforeIndex + 1,
        currentLineStart: afterLine.from,
      });
      textRanges.push(...inline.textRanges);
      inlineDeletions.push(...inline.deletions);
    }

    for (let insertIndex = pairedCount; insertIndex < inserted.length; insertIndex += 1) {
      const item = inserted[insertIndex];
      const line = currentLines[item.afterIndex];
      lineStates[item.afterIndex] = {
        line: item.afterIndex + 1,
        baselineLine: null,
        kind: "added",
      };
      changedLines.add(item.afterIndex + 1);
      if (line.to > line.from) {
        textRanges.push({
          from: line.from,
          to: line.to,
          line: item.afterIndex + 1,
          kind: "added",
        });
      }
    }

    const wholeLineRemovals = removed.slice(pairedCount);
    if (wholeLineRemovals.length > 0) {
      const nextInsertedLine = inserted.at(pairedCount)?.afterIndex;
      const nextEqualLine = operations[operationIndex]?.afterIndex;
      const beforeLine = Number.isInteger(nextInsertedLine)
        ? nextInsertedLine + 1
        : Number.isInteger(nextEqualLine)
          ? nextEqualLine + 1
          : currentLines.length + 1;
      const anchorLine = Math.min(Math.max(1, beforeLine), Math.max(1, currentLines.length));
      changedLines.add(anchorLine);
      lineDeletions.push({
        beforeLine,
        at: documentPositionBeforeLine(current, currentLines, beforeLine),
        lines: wholeLineRemovals.map((item) => ({
          number: item.beforeIndex + 1,
          text: baselineLines[item.beforeIndex].text,
        })),
      });
    }
  }

  const sortedChangedLines = [...changedLines].sort((left, right) => left - right);
  const hasDeletions = inlineDeletions.length > 0 || lineDeletions.length > 0;
  return {
    available: true,
    changed: sortedChangedLines.length > 0 || hasDeletions,
    hasDeletions,
    changedLines: sortedChangedLines,
    currentLines: lineStates,
    textRanges: mergeTextRanges(textRanges),
    inlineDeletions,
    lineDeletions,
  };
}

export function changedOutlineTargets(outlineItems, changedLines) {
  const items = Array.isArray(outlineItems)
    ? outlineItems.filter((item) => Number.isInteger(item?.sourceLine))
    : [];
  const targets = new Set();
  let beforeFirstHeading = false;

  for (const line of [...new Set(changedLines)].filter(Number.isInteger)) {
    let owner = null;
    for (const item of items) {
      if (item.sourceLine > line) {
        break;
      }
      owner = item;
    }
    if (owner?.id) {
      targets.add(owner.id);
    } else {
      beforeFirstHeading = true;
    }
  }

  return {
    targetIds: [...targets],
    beforeFirstHeading,
  };
}

export function sourceRangeHasChanged(model, start, end = start) {
  if (!model?.changed || !Number.isInteger(start) || !Number.isInteger(end)) {
    return false;
  }
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  return model.changedLines.some((line) => line >= lower && line <= upper);
}

function inlineLineChanges(beforeText, afterText, {
  currentLineNumber,
  baselineLineNumber,
  currentLineStart,
}) {
  const beforeTokens = unicodeTokens(beforeText);
  const afterTokens = unicodeTokens(afterText);
  const operations = diffSequence(
    beforeTokens,
    afterTokens,
    (left, right) => left.text === right.text,
  );
  const textRanges = [];
  const deletions = [];

  for (let operationIndex = 0; operationIndex < operations.length;) {
    const operation = operations[operationIndex];
    if (operation.type === "equal") {
      operationIndex += 1;
      continue;
    }

    if (operation.type === "insert") {
      const first = operation;
      let last = operation;
      operationIndex += 1;
      while (operationIndex < operations.length && operations[operationIndex].type === "insert") {
        last = operations[operationIndex];
        operationIndex += 1;
      }
      textRanges.push({
        from: currentLineStart + afterTokens[first.afterIndex].from,
        to: currentLineStart + afterTokens[last.afterIndex].to,
        line: currentLineNumber,
        kind: "modified",
      });
      continue;
    }

    const removed = [];
    const firstAfterIndex = nearestAfterIndex(operations, operationIndex, afterTokens.length);
    while (operationIndex < operations.length && operations[operationIndex].type === "delete") {
      removed.push(beforeTokens[operations[operationIndex].beforeIndex].text);
      operationIndex += 1;
    }
    const currentOffset = firstAfterIndex < afterTokens.length
      ? afterTokens[firstAfterIndex].from
      : afterText.length;
    deletions.push({
      at: currentLineStart + currentOffset,
      text: removed.join(""),
      line: currentLineNumber,
      baselineLine: baselineLineNumber,
    });
  }

  return { textRanges, deletions };
}

function nearestAfterIndex(operations, operationIndex, fallback) {
  for (let index = operationIndex + 1; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation.type === "insert" || operation.type === "equal") {
      return operation.afterIndex;
    }
  }
  return fallback;
}

function diffSequence(before, after, equals) {
  const prefixLength = commonPrefixLength(before, after, equals);
  const suffixLength = commonSuffixLength(before, after, prefixLength, equals);
  const operations = [];

  for (let index = 0; index < prefixLength; index += 1) {
    operations.push({ type: "equal", beforeIndex: index, afterIndex: index });
  }

  const beforeMiddle = before.slice(prefixLength, before.length - suffixLength);
  const afterMiddle = after.slice(prefixLength, after.length - suffixLength);
  operations.push(
    ...myersDiff(beforeMiddle, afterMiddle, equals).map((operation) => ({
      ...operation,
      ...(Number.isInteger(operation.beforeIndex)
        ? { beforeIndex: operation.beforeIndex + prefixLength }
        : {}),
      ...(Number.isInteger(operation.afterIndex)
        ? { afterIndex: operation.afterIndex + prefixLength }
        : {}),
    })),
  );

  for (let index = 0; index < suffixLength; index += 1) {
    operations.push({
      type: "equal",
      beforeIndex: before.length - suffixLength + index,
      afterIndex: after.length - suffixLength + index,
    });
  }

  return operations;
}

function myersDiff(before, after, equals) {
  if (before.length === 0) {
    return after.map((_value, afterIndex) => ({ type: "insert", afterIndex }));
  }
  if (after.length === 0) {
    return before.map((_value, beforeIndex) => ({ type: "delete", beforeIndex }));
  }

  const max = before.length + after.length;
  const maxDepth = Math.min(max, MAX_MYERS_DIFF_DEPTH);
  const trace = [];
  let frontier = new Map([[1, 0]]);

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    trace.push(new Map(frontier));
    const next = new Map(frontier);
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const down = frontier.get(diagonal + 1);
      const right = frontier.get(diagonal - 1);
      let x;
      if (
        diagonal === -depth ||
        (diagonal !== depth && (right ?? Number.NEGATIVE_INFINITY) < (down ?? Number.NEGATIVE_INFINITY))
      ) {
        x = down ?? 0;
      } else {
        x = (right ?? 0) + 1;
      }
      let y = x - diagonal;
      while (x < before.length && y < after.length && equals(before[x], after[y])) {
        x += 1;
        y += 1;
      }
      next.set(diagonal, x);
      if (x >= before.length && y >= after.length) {
        trace.push(next);
        return backtrackMyers(trace, before.length, after.length);
      }
    }
    frontier = next;
  }

  return positionalFallbackDiff(before.length, after.length);
}

function positionalFallbackDiff(beforeLength, afterLength) {
  return [
    ...Array.from({ length: beforeLength }, (_value, beforeIndex) => ({
      type: "delete",
      beforeIndex,
    })),
    ...Array.from({ length: afterLength }, (_value, afterIndex) => ({
      type: "insert",
      afterIndex,
    })),
  ];
}

function backtrackMyers(trace, beforeLength, afterLength) {
  let x = beforeLength;
  let y = afterLength;
  const operations = [];

  for (let depth = trace.length - 1; depth > 0; depth -= 1) {
    const frontier = trace[depth - 1];
    const diagonal = x - y;
    const down = frontier.get(diagonal + 1);
    const right = frontier.get(diagonal - 1);
    const previousDiagonal = (
      diagonal === -(depth - 1) ||
      (
        diagonal !== depth - 1 &&
        (right ?? Number.NEGATIVE_INFINITY) < (down ?? Number.NEGATIVE_INFINITY)
      )
    )
      ? diagonal + 1
      : diagonal - 1;
    const previousX = frontier.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      operations.push({ type: "equal", beforeIndex: x - 1, afterIndex: y - 1 });
      x -= 1;
      y -= 1;
    }
    if (depth === 1 && x === 0 && y === 0) {
      break;
    }
    if (x === previousX) {
      operations.push({ type: "insert", afterIndex: y - 1 });
      y -= 1;
    } else {
      operations.push({ type: "delete", beforeIndex: x - 1 });
      x -= 1;
    }
  }

  while (x > 0 && y > 0) {
    operations.push({ type: "equal", beforeIndex: x - 1, afterIndex: y - 1 });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    operations.push({ type: "delete", beforeIndex: x - 1 });
    x -= 1;
  }
  while (y > 0) {
    operations.push({ type: "insert", afterIndex: y - 1 });
    y -= 1;
  }

  return operations.reverse();
}

function commonPrefixLength(before, after, equals) {
  const limit = Math.min(before.length, after.length);
  let index = 0;
  while (index < limit && equals(before[index], after[index])) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(before, after, prefixLength, equals) {
  const limit = Math.min(before.length, after.length) - prefixLength;
  let length = 0;
  while (
    length < limit &&
    equals(before[before.length - 1 - length], after[after.length - 1 - length])
  ) {
    length += 1;
  }
  return length;
}

function sourceLineRecords(source) {
  if (source === "") {
    return [];
  }
  const parts = source.split("\n");
  if (parts.length > 1 && parts.at(-1) === "") {
    parts.pop();
  }
  let offset = 0;
  return parts.map((text, index) => {
    const record = {
      number: index + 1,
      text,
      from: offset,
      to: offset + text.length,
    };
    offset += text.length + 1;
    return record;
  });
}

function unicodeTokens(value) {
  const tokens = [];
  let offset = 0;
  for (const text of Array.from(value)) {
    tokens.push({ text, from: offset, to: offset + text.length });
    offset += text.length;
  }
  return tokens;
}

function documentPositionBeforeLine(source, lines, beforeLine) {
  if (beforeLine <= lines.length) {
    return lines[Math.max(0, beforeLine - 1)]?.from ?? 0;
  }
  return source.length;
}

function mergeTextRanges(ranges) {
  const sorted = ranges
    .filter((range) => Number.isInteger(range.from) && range.to > range.from)
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && previous.to === range.from && previous.line === range.line) {
      previous.to = range.to;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function normalizeSource(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

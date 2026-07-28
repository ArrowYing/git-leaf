export const MARKDOWN_TABLE_TEXT_COLORS = Object.freeze([
  Object.freeze({ name: "green", value: "#16a34a" }),
  Object.freeze({ name: "red", value: "#dc2626" }),
  Object.freeze({ name: "orange", value: "#d97706" }),
  Object.freeze({ name: "blue", value: "#2563eb" }),
  Object.freeze({ name: "gray", value: "#64748b" }),
]);

const MARKDOWN_TABLE_TEXT_COLOR_VALUES = new Set(
  MARKDOWN_TABLE_TEXT_COLORS.map(({ value }) => value),
);
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/;
const CONTROLLED_TEXT_COLOR_SPAN =
  /^<span\s+style=(["'])\s*color\s*:\s*(#[0-9a-fA-F]{6})\s*;?\s*\1\s*>([^\n]*?)<\/span>/i;

export function normalizeMarkdownTableTextColor(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return MARKDOWN_TABLE_TEXT_COLOR_VALUES.has(normalized) ? normalized : null;
}

export function controlledTextColorSpanAt(source) {
  const match = CONTROLLED_TEXT_COLOR_SPAN.exec(String(source ?? ""));
  if (!match) {
    return null;
  }

  const color = normalizeMarkdownTableTextColor(match[2]);
  if (!color) {
    return null;
  }

  return {
    color,
    content: match[3],
    length: match[0].length,
    source: match[0],
  };
}

export function parseMarkdownTableRow(line) {
  const source = String(line ?? "");
  const firstContentIndex = source.search(/\S/);
  if (firstContentIndex < 0) {
    return null;
  }

  let lastContentIndex = source.length - 1;
  while (lastContentIndex >= firstContentIndex && /\s/.test(source[lastContentIndex])) {
    lastContentIndex -= 1;
  }

  const pipePositions = topLevelPipePositions(
    source,
    firstContentIndex,
    lastContentIndex + 1,
  );
  if (pipePositions.length === 0) {
    return null;
  }

  const leadingPipe = pipePositions[0] === firstContentIndex;
  const trailingPipe =
    pipePositions[pipePositions.length - 1] === lastContentIndex &&
    (!leadingPipe || pipePositions.length > 1);
  const contentStart = leadingPipe ? firstContentIndex + 1 : firstContentIndex;
  const contentEnd = trailingPipe ? lastContentIndex : lastContentIndex + 1;
  const delimiters = pipePositions.filter(
    (position) => position >= contentStart && position < contentEnd,
  );
  const boundaries = [contentStart, ...delimiters, contentEnd];
  const cells = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index] + (index > 0 ? 1 : 0);
    const to = boundaries[index + 1];
    const raw = source.slice(from, to);
    const leadingWhitespace = raw.match(/^[ \t]*/)?.[0] ?? "";
    const trailingWhitespace = raw.match(/[ \t]*$/)?.[0] ?? "";
    const content = raw.trim();
    cells.push({
      column: index,
      from,
      to,
      raw,
      content,
      leadingWhitespace,
      trailingWhitespace,
    });
  }

  if (cells.length === 0) {
    return null;
  }

  return {
    source,
    prefix: source.slice(0, contentStart),
    suffix: source.slice(contentEnd),
    leadingPipe,
    trailingPipe,
    cells,
  };
}

export function parseMarkdownTable(source) {
  const text = String(source ?? "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines.length < 2 || lines.at(-1) === "") {
    return null;
  }

  const sourceRows = lines.map((line, lineIndex) => {
    const row = parseMarkdownTableRow(line);
    return row ? { ...row, lineIndex } : null;
  });
  const header = sourceRows[0];
  const separator = sourceRows[1];
  if (!header || !separator || header.cells.length !== separator.cells.length) {
    return null;
  }
  if (
    separator.cells.length === 0 ||
    !separator.cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell.content))
  ) {
    return null;
  }

  const columnCount = separator.cells.length;
  if (
    sourceRows.slice(2).some(
      (row) => !row || row.cells.length !== columnCount,
    )
  ) {
    return null;
  }

  const visualRows = [
    { ...header, row: 0, kind: "header" },
    ...sourceRows.slice(2).map((row, index) => ({
      ...row,
      row: index + 1,
      kind: "body",
    })),
  ];

  return {
    source: text,
    newline,
    lines,
    sourceRows,
    separator,
    visualRows,
    columnCount,
    rowCount: visualRows.length,
    alignments: separator.cells.map((cell) => separatorAlignment(cell.content)),
  };
}

export function markdownTableBlockAtLines(lines, index) {
  if (!Array.isArray(lines) || !Number.isInteger(index) || index < 0) {
    return null;
  }

  const header = parseMarkdownTableRow(lines[index]);
  const separator = parseMarkdownTableRow(lines[index + 1]);
  if (
    !header ||
    !separator ||
    header.cells.length !== separator.cells.length ||
    !separator.cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell.content))
  ) {
    return null;
  }

  const columnCount = separator.cells.length;
  let endIndex = index + 1;
  while (endIndex + 1 < lines.length) {
    const nextRow = parseMarkdownTableRow(lines[endIndex + 1]);
    if (!nextRow || nextRow.cells.length !== columnCount) {
      break;
    }
    endIndex += 1;
  }

  const source = lines.slice(index, endIndex + 1).join("\n");
  const table = parseMarkdownTable(source);
  return table ? { endIndex, source, table } : null;
}

export function normalizeMarkdownTableSelection(selection, table) {
  if (!selection || !table) {
    return null;
  }

  const values = [
    selection.anchorRow,
    selection.anchorColumn,
    selection.focusRow,
    selection.focusColumn,
  ];
  if (values.some((value) => !Number.isInteger(value))) {
    return null;
  }

  const minRow = Math.min(selection.anchorRow, selection.focusRow);
  const maxRow = Math.max(selection.anchorRow, selection.focusRow);
  const minColumn = Math.min(selection.anchorColumn, selection.focusColumn);
  const maxColumn = Math.max(selection.anchorColumn, selection.focusColumn);
  if (
    minRow < 0 ||
    minColumn < 0 ||
    maxRow >= table.rowCount ||
    maxColumn >= table.columnCount
  ) {
    return null;
  }

  return {
    anchorRow: selection.anchorRow,
    anchorColumn: selection.anchorColumn,
    focusRow: selection.focusRow,
    focusColumn: selection.focusColumn,
    minRow,
    maxRow,
    minColumn,
    maxColumn,
  };
}

export function colorMarkdownTableCellContent(content, color) {
  const source = String(content ?? "");
  const controlledSpan = controlledTextColorSpanAt(source);
  const unwrapped =
    controlledSpan?.length === source.length
      ? controlledSpan.content
      : source;

  if (color === null || color === undefined || color === "") {
    return unwrapped;
  }

  const normalizedColor = normalizeMarkdownTableTextColor(color);
  if (!normalizedColor) {
    return null;
  }
  if (!unwrapped) {
    return unwrapped;
  }

  return `<span style="color: ${normalizedColor};">${unwrapped}</span>`;
}

export function replaceMarkdownTableCell(source, row, column, content) {
  const table = parseMarkdownTable(source);
  if (
    !table ||
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 0 ||
    row >= table.rowCount ||
    column < 0 ||
    column >= table.columnCount ||
    /[\r\n]/.test(String(content ?? ""))
  ) {
    return null;
  }

  const nextLines = [...table.lines];
  const targetRow = table.visualRows[row];
  const nextCells = targetRow.cells.map((cell) => cell.raw);
  nextCells[column] = cellRawWithContent(targetRow.cells[column], String(content ?? ""));
  nextLines[targetRow.lineIndex] = serializeMarkdownTableRow(targetRow, nextCells);
  const nextSource = nextLines.join(table.newline);
  return {
    source: nextSource,
    changed: nextSource !== table.source,
    row,
    column,
  };
}

export function applyMarkdownTableTextColor(source, selection, color) {
  const table = parseMarkdownTable(source);
  const normalizedSelection = normalizeMarkdownTableSelection(selection, table);
  if (!table || !normalizedSelection) {
    return null;
  }
  if (
    color !== null &&
    color !== undefined &&
    color !== "" &&
    !normalizeMarkdownTableTextColor(color)
  ) {
    return null;
  }

  const nextLines = [...table.lines];
  for (
    let rowIndex = normalizedSelection.minRow;
    rowIndex <= normalizedSelection.maxRow;
    rowIndex += 1
  ) {
    const row = table.visualRows[rowIndex];
    const nextCells = row.cells.map((cell) => cell.raw);
    for (
      let columnIndex = normalizedSelection.minColumn;
      columnIndex <= normalizedSelection.maxColumn;
      columnIndex += 1
    ) {
      const nextContent = colorMarkdownTableCellContent(
        row.cells[columnIndex].content,
        color,
      );
      if (nextContent === null) {
        return null;
      }
      nextCells[columnIndex] = cellRawWithContent(
        row.cells[columnIndex],
        nextContent,
      );
    }
    nextLines[row.lineIndex] = serializeMarkdownTableRow(row, nextCells);
  }

  const nextSource = nextLines.join(table.newline);
  return {
    source: nextSource,
    changed: nextSource !== table.source,
    selection: normalizedSelection,
  };
}

export function reorderMarkdownTableColumn(source, fromColumn, toColumn) {
  const table = parseMarkdownTable(source);
  if (
    !table ||
    !Number.isInteger(fromColumn) ||
    !Number.isInteger(toColumn) ||
    fromColumn < 0 ||
    toColumn < 0 ||
    fromColumn >= table.columnCount ||
    toColumn >= table.columnCount
  ) {
    return null;
  }
  if (fromColumn === toColumn) {
    return {
      source: table.source,
      changed: false,
      fromColumn,
      toColumn,
    };
  }

  const nextLines = [...table.lines];
  for (const row of table.sourceRows) {
    const nextCells = moveArrayItem(row.cells.map((cell) => cell.raw), fromColumn, toColumn);
    nextLines[row.lineIndex] = serializeMarkdownTableRow(row, nextCells);
  }
  const nextSource = nextLines.join(table.newline);
  return {
    source: nextSource,
    changed: nextSource !== table.source,
    fromColumn,
    toColumn,
  };
}

function topLevelPipePositions(source, from, to) {
  const positions = [];
  let codeDelimiterLength = 0;

  for (let index = from; index < to; index += 1) {
    const character = source[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "`") {
      let runLength = 1;
      while (source[index + runLength] === "`") {
        runLength += 1;
      }
      if (codeDelimiterLength === 0) {
        codeDelimiterLength = runLength;
      } else if (codeDelimiterLength === runLength) {
        codeDelimiterLength = 0;
      }
      index += runLength - 1;
      continue;
    }
    if (character === "|" && codeDelimiterLength === 0) {
      positions.push(index);
    }
  }

  return positions;
}

function separatorAlignment(content) {
  const left = content.startsWith(":");
  const right = content.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  return "left";
}

function cellRawWithContent(cell, content) {
  if (!cell.content) {
    return cell.raw
      ? ` ${content} `
      : content;
  }
  return `${cell.leadingWhitespace}${content}${cell.trailingWhitespace}`;
}

function serializeMarkdownTableRow(row, rawCells) {
  return `${row.prefix}${rawCells.join("|")}${row.suffix}`;
}

function moveArrayItem(values, fromIndex, toIndex) {
  const next = [...values];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

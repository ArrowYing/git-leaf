import { tableLayoutStyleString } from "./table-layout.mjs";

const DEFAULTS = {
  complexRows: 20,
  complexColumns: 8,
  complexCells: 100,
  longCellLength: 120,
  searchRows: 100,
  freezeRows: 20,
  freezeColumns: 6,
};

export function tableComplexityAttributes({
  rows = 0,
  columns = 0,
  cells = [],
  overrides = {},
} = {}) {
  const rowCount = countValue(rows);
  const columnCount = countValue(columns);
  const cellValues = Array.isArray(cells) ? cells : [];
  const longestCell = cellValues.reduce(
    (max, value) => Math.max(max, String(value ?? "").trim().length),
    0,
  );
  const dense = rowCount > DEFAULTS.complexRows ||
    columnCount >= DEFAULTS.complexColumns ||
    rowCount * columnCount > DEFAULTS.complexCells ||
    longestCell >= DEFAULTS.longCellLength;

  const forcedComplexity = normalizeComplexityOverride(overrides.complexity);
  const complexity = forcedComplexity ?? (dense ? "complex" : "simple");
  const defaultSearch = complexity === "complex" && rowCount > DEFAULTS.searchRows;
  const defaultFreeze = complexity === "complex" &&
    rowCount > DEFAULTS.freezeRows &&
    columnCount >= DEFAULTS.freezeColumns;
  const defaultCopy = complexity === "complex";
  const defaultStickyHeader = complexity === "complex" && rowCount > DEFAULTS.complexRows;

  const search = booleanOverride(overrides.search, defaultSearch);
  const freezeFirstColumn = booleanOverride(
    overrides.freezeFirstColumn ?? overrides.freeze,
    defaultFreeze,
  );
  const copyCsv = booleanOverride(overrides.copyCsv ?? overrides.copy, defaultCopy);
  const stickyHeader = booleanOverride(
    overrides.stickyHeader ?? overrides.sticky,
    defaultStickyHeader,
  );

  return {
    complexity,
    rowCount,
    columnCount,
    toolbar: search || freezeFirstColumn || copyCsv,
    search,
    freezeFirstColumn,
    copyCsv,
    stickyHeader,
  };
}

export function tableCardAttributeString(attributes, layout = null) {
  const classNames = [
    "table-card",
    `is-${attributes.complexity}-table`,
    attributes.stickyHeader ? "is-sticky-header" : "",
  ].filter(Boolean).join(" ");
  return [
    `class="${classNames}"`,
    attributes.toolbar ? "data-enhanced-table" : "",
    `data-table-complexity="${attributes.complexity}"`,
    layout ? `data-table-layout="${layout.mode}"` : "",
    layout ? `style="${tableLayoutStyleString(layout)}"` : "",
  ].filter(Boolean).join(" ");
}

export function renderTableToolbar(attributes) {
  if (!attributes.toolbar) {
    return "";
  }

  return [
    '<div class="table-toolbar">',
    attributes.search
      ? '<label class="table-search"><input type="search" data-table-search aria-label="筛选当前表格" placeholder="筛选当前表格"></label>'
      : "",
    attributes.freezeFirstColumn
      ? '<label class="table-toggle"><input type="checkbox" data-table-freeze> 冻结首列</label>'
      : "",
    attributes.copyCsv ? '<button type="button" data-table-copy>复制 CSV</button>' : "",
    "</div>",
  ].join("");
}

function countValue(value) {
  if (Array.isArray(value)) {
    return value.length;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function normalizeComplexityOverride(value) {
  if (value === "simple" || value === "complex") {
    return value;
  }
  return null;
}

function booleanOverride(value, fallback) {
  if (value === true || value === false) {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

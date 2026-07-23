import assert from "node:assert/strict";
import test from "node:test";

import { tableComplexityAttributes } from "../src/table-complexity.mjs";

test("tableComplexityAttributes keeps small tables plain", () => {
  assert.deepEqual(
    tableComplexityAttributes({
      rows: 2,
      columns: 2,
      cells: ["Name", "Status", "Alpha", "Ready"],
    }),
    {
      complexity: "simple",
      rowCount: 2,
      columnCount: 2,
      toolbar: false,
      search: false,
      freezeFirstColumn: false,
      copyCsv: false,
      stickyHeader: false,
    },
  );
});

test("tableComplexityAttributes keeps table tools conservative", () => {
  const attributes = tableComplexityAttributes({
    rows: 21,
    columns: 6,
    cells: Array.from({ length: 126 }, (_, index) => `cell-${index}`),
  });

  assert.equal(attributes.complexity, "complex");
  assert.equal(attributes.toolbar, true);
  assert.equal(attributes.search, false);
  assert.equal(attributes.freezeFirstColumn, true);
  assert.equal(attributes.copyCsv, true);
  assert.equal(attributes.stickyHeader, true);
});

test("tableComplexityAttributes only enables search above 100 rows", () => {
  const oneHundredRows = tableComplexityAttributes({
    rows: 100,
    columns: 6,
    cells: Array.from({ length: 600 }, (_, index) => `cell-${index}`),
  });
  const oneHundredOneRows = tableComplexityAttributes({
    rows: 101,
    columns: 6,
    cells: Array.from({ length: 606 }, (_, index) => `cell-${index}`),
  });

  assert.equal(oneHundredRows.search, false);
  assert.equal(oneHundredOneRows.search, true);
});

test("tableComplexityAttributes only freezes the first column after 20 rows", () => {
  const twentyRows = tableComplexityAttributes({
    rows: 20,
    columns: 6,
    cells: Array.from({ length: 120 }, (_, index) => `cell-${index}`),
  });
  const twentyOneRows = tableComplexityAttributes({
    rows: 21,
    columns: 6,
    cells: Array.from({ length: 126 }, (_, index) => `cell-${index}`),
  });

  assert.equal(twentyRows.freezeFirstColumn, false);
  assert.equal(twentyOneRows.freezeFirstColumn, true);
});

test("tableComplexityAttributes supports explicit feature overrides", () => {
  const attributes = tableComplexityAttributes({
    rows: 2,
    columns: 2,
    overrides: {
      search: "true",
      freezeFirstColumn: "false",
      copyCsv: "true",
    },
  });

  assert.equal(attributes.toolbar, true);
  assert.equal(attributes.search, true);
  assert.equal(attributes.freezeFirstColumn, false);
  assert.equal(attributes.copyCsv, true);
});

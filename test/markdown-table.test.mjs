import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMarkdownTableTextColor,
  colorMarkdownTableCellContent,
  controlledTextColorSpanAt,
  markdownTableBlockAtLines,
  normalizeMarkdownTableSelection,
  parseMarkdownTable,
  parseMarkdownTableRow,
  reorderMarkdownTableColumn,
  replaceMarkdownTableCell,
} from "../src/content/markdown-table.mjs";

const tableSource = [
  "| 渠道 | 收入与变化 | 状态 |",
  "| :--- | ---: | :---: |",
  "| 自然流量 | 128.4（↑ 12.4%） | 健康 |",
  "| 付费投放 | 96.7（↓ 8.7%） | 风险 |",
].join("\n");

test("parseMarkdownTable maps visual rows while preserving source cell text", () => {
  const table = parseMarkdownTable(tableSource);

  assert.equal(table?.columnCount, 3);
  assert.equal(table?.rowCount, 3);
  assert.deepEqual(table?.alignments, ["left", "right", "center"]);
  assert.equal(table?.visualRows[0].lineIndex, 0);
  assert.equal(table?.visualRows[1].lineIndex, 2);
  assert.equal(table?.visualRows[2].cells[1].content, "96.7（↓ 8.7%）");
});

test("parseMarkdownTableRow ignores escaped and inline-code pipes", () => {
  const row = parseMarkdownTableRow("| Alpha \\| Beta | `a|b` | Ready |");

  assert.deepEqual(
    row?.cells.map((cell) => cell.content),
    ["Alpha \\| Beta", "`a|b`", "Ready"],
  );
});

test("markdownTableBlockAtLines stops before a non-table line", () => {
  const lines = [
    ...tableSource.split("\n"),
    "",
    "After the table.",
  ];

  const block = markdownTableBlockAtLines(lines, 0);
  assert.equal(block?.endIndex, 3);
  assert.equal(block?.table.rowCount, 3);
});

test("normalizeMarkdownTableSelection turns diagonal dragging into a rectangle", () => {
  const table = parseMarkdownTable(tableSource);

  assert.deepEqual(
    normalizeMarkdownTableSelection(
      {
        anchorRow: 2,
        anchorColumn: 2,
        focusRow: 0,
        focusColumn: 0,
      },
      table,
    ),
    {
      anchorRow: 2,
      anchorColumn: 2,
      focusRow: 0,
      focusColumn: 0,
      minRow: 0,
      maxRow: 2,
      minColumn: 0,
      maxColumn: 2,
    },
  );
});

test("replaceMarkdownTableCell changes only the selected cell content", () => {
  const result = replaceMarkdownTableCell(tableSource, 1, 2, "重点观察");

  assert.equal(
    result?.source,
    [
      "| 渠道 | 收入与变化 | 状态 |",
      "| :--- | ---: | :---: |",
      "| 自然流量 | 128.4（↑ 12.4%） | 重点观察 |",
      "| 付费投放 | 96.7（↓ 8.7%） | 风险 |",
    ].join("\n"),
  );
});

test("table text colors wrap, replace, and clear only controlled palette spans", () => {
  assert.equal(
    colorMarkdownTableCellContent("健康", "#16A34A"),
    '<span style="color: #16a34a;">健康</span>',
  );
  assert.equal(
    colorMarkdownTableCellContent(
      '<span style="color: #16a34a;">健康</span>',
      "#dc2626",
    ),
    '<span style="color: #dc2626;">健康</span>',
  );
  assert.equal(
    colorMarkdownTableCellContent(
      '<span style="color: #dc2626;">健康</span>',
      null,
    ),
    "健康",
  );
  assert.equal(colorMarkdownTableCellContent("健康", "#ffffff"), null);
  assert.equal(
    controlledTextColorSpanAt('<span style="font-size: 40px;">健康</span>'),
    null,
  );
});

test("applyMarkdownTableTextColor colors every cell in a rectangular selection", () => {
  const result = applyMarkdownTableTextColor(
    tableSource,
    {
      anchorRow: 1,
      anchorColumn: 1,
      focusRow: 2,
      focusColumn: 2,
    },
    "#d97706",
  );

  assert.match(
    result?.source ?? "",
    /\| 自然流量 \| <span style="color: #d97706;">128\.4（↑ 12\.4%）<\/span> \| <span style="color: #d97706;">健康<\/span> \|/,
  );
  assert.match(
    result?.source ?? "",
    /\| 付费投放 \| <span style="color: #d97706;">96\.7（↓ 8\.7%）<\/span> \| <span style="color: #d97706;">风险<\/span> \|/,
  );
  assert.doesNotMatch(
    result?.source ?? "",
    /<span[^>]*>自然流量<\/span>/,
  );
});

test("reorderMarkdownTableColumn moves header, alignment, and every body cell together", () => {
  const result = reorderMarkdownTableColumn(tableSource, 2, 0);

  assert.equal(
    result?.source,
    [
      "| 状态 | 渠道 | 收入与变化 |",
      "| :---: | :--- | ---: |",
      "| 健康 | 自然流量 | 128.4（↑ 12.4%） |",
      "| 风险 | 付费投放 | 96.7（↓ 8.7%） |",
    ].join("\n"),
  );
});

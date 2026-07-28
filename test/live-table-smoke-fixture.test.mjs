import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LIVE_TABLE_SMOKE_ACCEPTANCE,
  LIVE_TABLE_SMOKE_FILE,
  cleanupLiveTableSmokeFixture,
  createLiveTableSmokeFixture,
  readLiveTableSmokeDocument,
} from "../scripts/live-table-smoke-fixture.mjs";
import {
  markdownTableBlockAtLines,
  parseMarkdownTable,
} from "../src/content/markdown-table.mjs";

test("Live table smoke fixture provides native editable table scenarios", () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "git-leaf-live-table-fixture-test-"),
  );
  const fixture = createLiveTableSmokeFixture({ temporaryRoot });
  try {
    assert.equal(fixture.file, LIVE_TABLE_SMOKE_FILE);
    assert.match(LIVE_TABLE_SMOKE_ACCEPTANCE, /斜向拖动/);
    assert.match(LIVE_TABLE_SMOKE_ACCEPTANCE, /Preview 保持只读/);

    const source = readLiveTableSmokeDocument(fixture);
    const lines = source.split("\n");
    const firstTableLine = lines.findIndex((line) => line.startsWith("| 渠道 |"));
    const block = markdownTableBlockAtLines(lines, firstTableLine);
    assert.equal(block?.table.columnCount, 4);
    assert.equal(block?.table.rowCount, 5);
    assert.ok(parseMarkdownTable(block?.source));
    assert.match(source, /style="color: #16a34a;"/);
  } finally {
    cleanupLiveTableSmokeFixture(fixture);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

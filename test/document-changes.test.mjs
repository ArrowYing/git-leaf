import assert from "node:assert/strict";
import test from "node:test";

import {
  changedOutlineTargets,
  createDocumentChangeModel,
  emptyDocumentChangeModel,
  sourceRangeHasChanged,
} from "../public/document-changes.js";

test("document change model leaves committed text unmarked", () => {
  const source = "# Plan\n\nKeep this paragraph.\n";
  const model = createDocumentChangeModel({
    baselineSource: source,
    currentSource: source,
  });

  assert.equal(model.available, true);
  assert.equal(model.changed, false);
  assert.equal(model.hasDeletions, false);
  assert.deepEqual(model.changedLines, []);
  assert.deepEqual(
    model.currentLines.map(({ line, baselineLine, kind }) => ({ line, baselineLine, kind })),
    [
      { line: 1, baselineLine: 1, kind: "unchanged" },
      { line: 2, baselineLine: 2, kind: "unchanged" },
      { line: 3, baselineLine: 3, kind: "unchanged" },
    ],
  );
});

test("document change model marks only inserted replacement text and preserves Unicode offsets", () => {
  const model = createDocumentChangeModel({
    baselineSource: "结论：暂缓上线。\n",
    currentSource: "结论：本周上线。\n",
  });

  assert.equal(model.changed, true);
  assert.deepEqual(model.changedLines, [1]);
  assert.deepEqual(model.currentLines, [
    { line: 1, baselineLine: 1, kind: "modified" },
  ]);
  assert.deepEqual(
    model.textRanges.map((range) => ({
      text: "结论：本周上线。\n".slice(range.from, range.to),
      line: range.line,
      kind: range.kind,
    })),
    [{ text: "本周", line: 1, kind: "modified" }],
  );
  assert.deepEqual(
    model.inlineDeletions.map(({ text, line, baselineLine }) => ({ text, line, baselineLine })),
    [{ text: "暂缓", line: 1, baselineLine: 1 }],
  );
});

test("document change model keeps committed and current line mappings around added and deleted lines", () => {
  const model = createDocumentChangeModel({
    baselineSource: "# Plan\nold line\nkeep line\nfinal line\n",
    currentSource: "# Plan\nnew first\nnew second\nkeep line\nfinal line\n",
  });

  assert.deepEqual(model.changedLines, [2, 3]);
  assert.deepEqual(model.currentLines, [
    { line: 1, baselineLine: 1, kind: "unchanged" },
    { line: 2, baselineLine: 2, kind: "modified" },
    { line: 3, baselineLine: null, kind: "added" },
    { line: 4, baselineLine: 3, kind: "unchanged" },
    { line: 5, baselineLine: 4, kind: "unchanged" },
  ]);
  assert.equal(model.hasDeletions, true);
  assert.deepEqual(
    model.inlineDeletions.map(({ text, baselineLine }) => ({ text, baselineLine })),
    [{ text: "old li", baselineLine: 2 }],
  );
});

test("document change model exposes whole deleted lines at their current anchor", () => {
  const model = createDocumentChangeModel({
    baselineSource: "# Plan\nremove one\nremove two\n## Keep\nBody\n",
    currentSource: "# Plan\n## Keep\nBody\n",
  });

  assert.equal(model.hasDeletions, true);
  assert.deepEqual(model.changedLines, [2]);
  assert.deepEqual(model.lineDeletions, [{
    beforeLine: 2,
    at: "# Plan\n".length,
    lines: [
      { number: 2, text: "remove one" },
      { number: 3, text: "remove two" },
    ],
  }]);
  assert.deepEqual(model.currentLines, [
    { line: 1, baselineLine: 1, kind: "unchanged" },
    { line: 2, baselineLine: 4, kind: "unchanged" },
    { line: 3, baselineLine: 5, kind: "unchanged" },
  ]);
});

test("new and emptied documents still produce useful top-of-document change cues", () => {
  const added = createDocumentChangeModel({
    baselineSource: "",
    currentSource: "New document\n",
  });
  assert.deepEqual(added.changedLines, [1]);
  assert.deepEqual(added.currentLines, [
    { line: 1, baselineLine: null, kind: "added" },
  ]);
  assert.equal(added.hasDeletions, false);

  const emptied = createDocumentChangeModel({
    baselineSource: "Removed document\n",
    currentSource: "",
  });
  assert.deepEqual(emptied.changedLines, [1]);
  assert.deepEqual(emptied.currentLines, []);
  assert.deepEqual(emptied.lineDeletions, [{
    beforeLine: 1,
    at: 0,
    lines: [{ number: 1, text: "Removed document" }],
  }]);
});

test("changed outline targets assign body edits to their nearest preceding section", () => {
  const outlineItems = [
    { id: "scope", sourceLine: 4 },
    { id: "delivery", sourceLine: 10 },
    { id: "follow-up", sourceLine: 18 },
  ];

  assert.deepEqual(changedOutlineTargets(outlineItems, [2, 6, 8, 14, 21]), {
    targetIds: ["scope", "delivery", "follow-up"],
    beforeFirstHeading: true,
  });
  assert.deepEqual(changedOutlineTargets([], [1]), {
    targetIds: [],
    beforeFirstHeading: true,
  });
});

test("source range lookup supports preview blocks that cover multiple source lines", () => {
  const model = createDocumentChangeModel({
    baselineSource: "one\ntwo\nthree\n",
    currentSource: "one\nchanged\nthree\n",
  });

  assert.equal(sourceRangeHasChanged(model, 1), false);
  assert.equal(sourceRangeHasChanged(model, 1, 2), true);
  assert.equal(sourceRangeHasChanged(model, 3, 8), false);
  assert.equal(sourceRangeHasChanged(emptyDocumentChangeModel(), 1, 2), false);
});

test("document change model keeps a finite fallback for a completely rewritten long document", () => {
  const baselineSource = Array.from({ length: 700 }, (_value, index) => `before ${index}`).join("\n");
  const currentSource = Array.from({ length: 700 }, (_value, index) => `after ${index}`).join("\n");
  const model = createDocumentChangeModel({ baselineSource, currentSource });

  assert.equal(model.changed, true);
  assert.equal(model.changedLines.length, 700);
  assert.deepEqual(model.changedLines.slice(0, 3), [1, 2, 3]);
  assert.deepEqual(model.changedLines.slice(-3), [698, 699, 700]);
  assert.equal(model.currentLines.every((line) => line.kind === "modified"), true);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  formatLineRange,
  formatLineReference,
  hashFromLines,
  lineFromGutterPoint,
  shouldClearLineSelection,
  lineFromSelectionPoint,
  parseLineHash,
  rangesFromLines,
  selectionForSourceRange,
  sourceLinesFromMarkdown,
} from "../public/line-selection.js";

test("rangesFromLines groups continuous and separate selections", () => {
  assert.deepEqual(rangesFromLines([4, 2, 3, 9, 4]), [
    { start: 2, end: 4 },
    { start: 9, end: 9 },
  ]);
  assert.equal(formatLineRange([4, 2, 3, 9]), "2-4,9");
});

test("line hash supports GitHub-style continuous source ranges", () => {
  assert.deepEqual(parseLineHash("#L12-L14"), [12, 13, 14]);
  assert.deepEqual(parseLineHash("#L14-L12"), [12, 13, 14]);
  assert.equal(hashFromLines([12, 13, 14]), "#L12-L14");
  assert.equal(hashFromLines([12, 14]), "");
});

test("formatLineReference keeps copied source quoted and leaves the prompt after its source", () => {
  const output = formatLineReference({
    path: "docs/example.md",
    selectedLines: [3, 1, 2],
    sourceLines: [
      { number: 1, text: "# Title" },
      { number: 2, text: "" },
      { number: 3, text: "Body **text**" },
    ],
  });

  assert.equal(output, `> 1 | # Title
> 2 |
> 3 | Body **text**

Source: docs/example.md:1-3` + "\n\n");
});

test("sourceLinesFromMarkdown preserves blank lines but ignores trailing newline sentinel", () => {
  assert.deepEqual(sourceLinesFromMarkdown("# Title\n\nBody\n"), [
    { number: 1, text: "# Title" },
    { number: 2, text: "" },
    { number: 3, text: "Body" },
  ]);
});

test("lineFromSelectionPoint maps gutter blank clicks to the nearest source line", () => {
  assert.equal(
    lineFromSelectionPoint({
      y: 43,
      start: 10,
      end: 12,
      blockTop: 20,
      blockBottom: 86,
      buttonRects: [
        { line: 10, top: 20, bottom: 40 },
        { line: 11, top: 42, bottom: 62 },
        { line: 12, top: 64, bottom: 84 },
      ],
    }),
    11,
  );

  assert.equal(
    lineFromSelectionPoint({
      y: 63,
      start: 10,
      end: 12,
      blockTop: 20,
      blockBottom: 86,
      buttonRects: [],
    }),
    11,
  );
});

test("lineFromGutterPoint maps left gutter whitespace clicks to source lines", () => {
  const buttonRects = [
    { line: 10, left: 50, right: 114, top: 20, bottom: 40 },
    { line: 11, left: 50, right: 114, top: 42, bottom: 62 },
    { line: 12, left: 50, right: 114, top: 64, bottom: 84 },
  ];

  assert.equal(lineFromGutterPoint({ x: 118, y: 43, buttonRects }), 11);
  assert.equal(lineFromGutterPoint({ x: 52, y: 63, buttonRects }), 11);
  assert.equal(lineFromGutterPoint({ x: 180, y: 43, buttonRects }), null);
});

test("shouldClearLineSelection clears on non-interactive document whitespace", () => {
  assert.equal(shouldClearLineSelection({ selectedCount: 0, isInteractive: false, hasLineTarget: false, gutterLine: null }), false);
  assert.equal(shouldClearLineSelection({ selectedCount: 1, isInteractive: true, hasLineTarget: false, gutterLine: null }), false);
  assert.equal(shouldClearLineSelection({ selectedCount: 1, isInteractive: false, hasLineTarget: true, gutterLine: null }), false);
  assert.equal(shouldClearLineSelection({ selectedCount: 1, isInteractive: false, hasLineTarget: false, gutterLine: 12 }), false);
  assert.equal(shouldClearLineSelection({ selectedCount: 1, isInteractive: false, hasLineTarget: false, gutterLine: null }), true);
});

test("selectionForSourceRange selects and toggles every source line represented by one Preview control", () => {
  assert.deepEqual(selectionForSourceRange({
    selectedLines: [],
    selectionAnchor: null,
    start: 15,
    end: 17,
  }), {
    selectedLines: [15, 16, 17],
    selectionAnchor: 17,
  });

  assert.deepEqual(selectionForSourceRange({
    selectedLines: [15, 16, 17, 20],
    selectionAnchor: 20,
    start: 15,
    end: 17,
    toggle: true,
  }), {
    selectedLines: [20],
    selectionAnchor: 17,
  });

  assert.deepEqual(selectionForSourceRange({
    selectedLines: [10],
    selectionAnchor: 10,
    start: 15,
    end: 17,
    extend: true,
  }), {
    selectedLines: [10, 11, 12, 13, 14, 15, 16, 17],
    selectionAnchor: 10,
  });
});

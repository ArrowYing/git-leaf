import assert from "node:assert/strict";
import test from "node:test";

import {
  activeOutlineIdForSourceLine,
  outlineItemsFromHeadings,
} from "../public/outline.js";

test("outlineItemsFromHeadings hides a sole leading document title and rebases body headings", () => {
  assert.deepEqual(
    outlineItemsFromHeadings([
      { id: "intro", text: " Intro ", tagName: "H1" },
      { id: "", text: "Missing id", tagName: "H2" },
      { id: "empty", text: " ", tagName: "H2" },
      { id: "deep", text: "Deep", tagName: "H4" },
      { id: "goal", text: "Goal", tagName: "H2", sourceLine: 12 },
      { id: "detail", text: "Detail", tagName: "H3", sourceLine: 18 },
    ]),
    [
      { id: "goal", title: "Goal", level: 2, sourceLine: 12, depth: 1 },
      { id: "detail", title: "Detail", level: 3, sourceLine: 18, depth: 2 },
    ],
  );
});

test("outlineItemsFromHeadings hides the outline when a leading H1 is the only heading", () => {
  assert.deepEqual(
    outlineItemsFromHeadings([{ id: "intro", text: "Intro", tagName: "H1" }]),
    [],
  );
});

test("outlineItemsFromHeadings starts H2 at the baseline when a document has no H1", () => {
  assert.deepEqual(
    outlineItemsFromHeadings([
      { id: "goal", text: "Goal", tagName: "H2" },
      { id: "detail", text: "Detail", tagName: "H3" },
    ]),
    [
      { id: "goal", title: "Goal", level: 2, depth: 1 },
      { id: "detail", title: "Detail", level: 3, depth: 2 },
    ],
  );
});

test("outlineItemsFromHeadings preserves full hierarchy for multiple or misplaced H1 headings", () => {
  assert.deepEqual(
    outlineItemsFromHeadings([
      { id: "part-one", text: "Part one", tagName: "H1" },
      { id: "goal", text: "Goal", tagName: "H2" },
      { id: "part-two", text: "Part two", tagName: "H1" },
    ]),
    [
      { id: "part-one", title: "Part one", level: 1, depth: 1 },
      { id: "goal", title: "Goal", level: 2, depth: 2 },
      { id: "part-two", title: "Part two", level: 1, depth: 1 },
    ],
  );

  assert.deepEqual(
    outlineItemsFromHeadings([
      { id: "goal", text: "Goal", tagName: "H2" },
      { id: "late-title", text: "Late title", tagName: "H1" },
    ]),
    [
      { id: "goal", title: "Goal", level: 2, depth: 2 },
      { id: "late-title", title: "Late title", level: 1, depth: 1 },
    ],
  );
});

test("activeOutlineIdForSourceLine chooses the last heading at or before the source line", () => {
  const items = [
    { id: "intro", sourceLine: 3 },
    { id: "scope", sourceLine: 12 },
    { id: "details", sourceLine: 24 },
  ];

  assert.equal(activeOutlineIdForSourceLine(1, items), undefined);
  assert.equal(activeOutlineIdForSourceLine(12, items), "scope");
  assert.equal(activeOutlineIdForSourceLine(20, items), "scope");
  assert.equal(activeOutlineIdForSourceLine(99, items), "details");
  assert.equal(activeOutlineIdForSourceLine(null, items), "intro");
});

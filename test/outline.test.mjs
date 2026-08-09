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
      { id: "unsupported", text: "Unsupported", tagName: "H6" },
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

test("outlineItemsFromHeadings compresses H2, H4, and H5 into consecutive navigation depths", () => {
  assert.deepEqual(
    outlineItemsFromHeadings([
      { id: "scope", text: "Scope", tagName: "H2", sourceLine: 4 },
      { id: "workflow", text: "Workflow", tagName: "H4", sourceLine: 9 },
      { id: "step", text: "Step", tagName: "H5", sourceLine: 14 },
      { id: "too-deep", text: "Too deep", tagName: "H6", sourceLine: 18 },
    ]),
    [
      { id: "scope", title: "Scope", level: 2, sourceLine: 4, depth: 1 },
      { id: "workflow", title: "Workflow", level: 4, sourceLine: 9, depth: 2 },
      { id: "step", title: "Step", level: 5, sourceLine: 14, depth: 3 },
    ],
  );
});

test("outlineItemsFromHeadings compresses H3 and H5 into two navigation depths", () => {
  assert.deepEqual(
    outlineItemsFromHeadings([
      { id: "topic", text: "Topic", tagName: "H3" },
      { id: "detail", text: "Detail", tagName: "H5" },
    ]),
    [
      { id: "topic", title: "Topic", level: 3, depth: 1 },
      { id: "detail", title: "Detail", level: 5, depth: 2 },
    ],
  );
});

test("outlineItemsFromHeadings restores relative ancestors after skipped heading levels", () => {
  assert.deepEqual(
    outlineItemsFromHeadings([
      { id: "root", text: "Root", tagName: "H2" },
      { id: "branch", text: "Branch", tagName: "H4" },
      { id: "leaf", text: "Leaf", tagName: "H5" },
      { id: "sibling", text: "Sibling", tagName: "H4" },
      { id: "explicit-section", text: "Explicit section", tagName: "H3" },
      { id: "nested-after-section", text: "Nested after section", tagName: "H5" },
      { id: "next-root", text: "Next root", tagName: "H2" },
    ]),
    [
      { id: "root", title: "Root", level: 2, depth: 1 },
      { id: "branch", title: "Branch", level: 4, depth: 2 },
      { id: "leaf", title: "Leaf", level: 5, depth: 3 },
      { id: "sibling", title: "Sibling", level: 4, depth: 2 },
      { id: "explicit-section", title: "Explicit section", level: 3, depth: 2 },
      { id: "nested-after-section", title: "Nested after section", level: 5, depth: 3 },
      { id: "next-root", title: "Next root", level: 2, depth: 1 },
    ],
  );
});

test("outlineItemsFromHeadings uses relative hierarchy for multiple or misplaced H1 headings", () => {
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
      { id: "goal", title: "Goal", level: 2, depth: 1 },
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

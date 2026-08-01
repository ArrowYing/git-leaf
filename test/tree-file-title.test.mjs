import assert from "node:assert/strict";
import test from "node:test";

import {
  displayedTreeFileTitle,
  treeFileCanShowDocumentTitle,
  treeFilePresentation,
  treeFilenameContainsHan,
} from "../public/tree-file-title.js";

test("English Markdown filenames keep the filename first and show the document title second", () => {
  assert.deepEqual(
    treeFilePresentation({
      kind: "markdown",
      name: "2026-07-31-khan-academy-ai-tutoring-experiments.md",
      title: "Khan Academy 大规模 AI Tutor 实验",
    }),
    {
      filename: "2026-07-31-khan-academy-ai-tutoring-experiments.md",
      title: "Khan Academy 大规模 AI Tutor 实验",
      lines: [
        {
          kind: "filename",
          text: "2026-07-31-khan-academy-ai-tutoring-experiments.md",
        },
        { kind: "title", text: "Khan Academy 大规模 AI Tutor 实验" },
      ],
    },
  );
});

test("Chinese filenames remain single-line even when the document has a title", () => {
  const node = {
    kind: "markdown",
    name: "学情分析.md",
    title: "学情分析报告",
  };

  assert.equal(treeFilenameContainsHan(node.name), true);
  assert.equal(displayedTreeFileTitle(node), "");
  assert.deepEqual(treeFilePresentation(node).lines, [
    { kind: "filename", text: "学情分析.md" },
  ]);
});

test("the document-title preference keeps English filenames single-line when disabled", () => {
  const node = {
    kind: "markdown",
    name: "weekly-report.md",
    title: "本周工作报告",
  };

  assert.equal(displayedTreeFileTitle(node, { showDocumentTitles: false }), "");
  assert.deepEqual(
    treeFilePresentation(node, { showDocumentTitles: false }).lines,
    [{ kind: "filename", text: "weekly-report.md" }],
  );
  assert.equal(
    treeFilePresentation(node, { showDocumentTitles: true }).title,
    "本周工作报告",
  );
});

test("Missing, identical, and non-Markdown titles do not add a second line", () => {
  assert.equal(displayedTreeFileTitle({ kind: "markdown", name: "notes.md" }), "");
  assert.equal(
    displayedTreeFileTitle({ kind: "markdown", name: "README.md", title: "README" }),
    "",
  );
  assert.equal(
    displayedTreeFileTitle({ kind: "markdown", name: "README.md", title: "README.md" }),
    "",
  );
  assert.equal(
    displayedTreeFileTitle({ kind: "html", name: "report.html", title: "Report" }),
    "",
  );
});

test("only non-Chinese Markdown filenames need title indexing", () => {
  assert.equal(
    treeFileCanShowDocumentTitle({ kind: "markdown", path: "docs/weekly-report.md" }),
    true,
  );
  assert.equal(
    treeFileCanShowDocumentTitle({ kind: "markdown", path: "docs/每周报告.md" }),
    false,
  );
  assert.equal(
    treeFileCanShowDocumentTitle({ kind: "pdf", path: "docs/weekly-report.pdf" }),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  fileMatchesTextFilter,
  fileMatchesFrontmatterFilters,
  filterFrontmatterTree,
  normalizeFrontmatterFilters,
} from "../public/frontmatter-filters.js";

const tree = [
  { type: "file", name: "README.md", path: "README.md" },
  {
    type: "directory",
    name: "docs",
    children: [
      { type: "file", name: "standard.md", path: "docs/standard.md" },
      { type: "file", name: "draft.md", path: "docs/draft.md" },
    ],
  },
];

const metadataByPath = {
  "README.md": { domain: "company", type: "overview", canonical: false },
  "docs/standard.md": { domain: "docs", type: "standard", canonical: true },
  "docs/draft.md": { domain: "docs", type: "draft", canonical: false },
};

test("fileMatchesFrontmatterFilters requires every selected key-value pair", () => {
  const allowedKeys = ["domain", "canonical"];
  assert.equal(
    fileMatchesFrontmatterFilters(metadataByPath["docs/standard.md"], [
      { key: "domain", value: "docs" },
      { key: "canonical", value: "true" },
    ], allowedKeys),
    true,
  );
  assert.equal(
    fileMatchesFrontmatterFilters(metadataByPath["docs/draft.md"], [
      { key: "domain", value: "docs" },
      { key: "canonical", value: "true" },
    ], allowedKeys),
    false,
  );
});

test("filterFrontmatterTree keeps matching files and their parent directories", () => {
  assert.deepEqual(
    filterFrontmatterTree(tree, metadataByPath, [
      { key: "domain", value: "docs" },
      { key: "canonical", value: "true" },
    ], ["domain", "canonical"]),
    [
      {
        type: "directory",
        name: "docs",
        children: [
          { type: "file", name: "standard.md", path: "docs/standard.md" },
        ],
      },
    ],
  );
});

test("normalizeFrontmatterFilters keeps one value per allowed key", () => {
  assert.deepEqual(
    normalizeFrontmatterFilters([
      { key: "domain", value: "docs" },
      { key: "unknown", value: "x" },
      { key: "domain", value: "ai" },
      { key: "canonical", value: true },
    ], ["domain", "canonical"]),
    [
      { key: "domain", value: "ai" },
      { key: "canonical", value: "true" },
    ],
  );
});

test("normalizeFrontmatterFilters has no repository-independent defaults", () => {
  assert.deepEqual(
    normalizeFrontmatterFilters([
      { key: "domain", value: "docs" },
      { key: "canonical", value: true },
    ]),
    [],
  );
});

test("normalizeFrontmatterFilters accepts repository-provided allowed keys", () => {
  assert.deepEqual(
    normalizeFrontmatterFilters(
      [
        { key: "product", value: "sample-product" },
        { key: "status", value: "active" },
        { key: "decision_status", value: "accepted" },
      ],
      ["product", "decision_status"],
    ),
    [
      { key: "product", value: "sample-product" },
      { key: "decision_status", value: "accepted" },
    ],
  );
});

test("fileMatchesTextFilter searches path, file name, and ai_snippet tokens", () => {
  const node = { type: "file", name: "editor-design.md", path: "editor-design.md" };
  const metadata = {
    ai_snippet: "[Plan] Git Leaf editor | CodeMirror live editing | Frontmatter filters",
  };

  assert.equal(fileMatchesTextFilter(node, metadata, "leaf live filters"), true);
  assert.equal(fileMatchesTextFilter(node, metadata, "editor-design"), true);
  assert.equal(fileMatchesTextFilter(node, metadata, "finance report"), false);
});

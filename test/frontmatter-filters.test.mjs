import assert from "node:assert/strict";
import test from "node:test";

import {
  fileTextFilterMatchDetails,
  fileMatchesTextFilter,
  fileMatchesFrontmatterFilters,
  filterFrontmatterTree,
  filterTextTree,
  normalizeFrontmatterFilters,
  textFilterMatchRanges,
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

test("file text search requires every term in the file name or searchable metadata", () => {
  const node = { type: "file", name: "editor-design.md", path: "editor-design.md" };
  const metadata = {
    ai_snippet: "[Plan] OpenGlance editor | CodeMirror live editing | Frontmatter filters",
  };

  assert.equal(fileMatchesTextFilter(node, metadata, "openglance live filters"), true);
  assert.equal(fileMatchesTextFilter(node, metadata, "editor-design"), true);
  assert.equal(fileMatchesTextFilter(node, metadata, "finance report"), false);
  assert.equal(
    fileMatchesTextFilter(
      {
        type: "file",
        name: "pain-points.md",
        path: "marketing/violy/market-context/audience/pain-points.md",
      },
      {},
      "violy context",
    ),
    false,
  );
});

test("file text search matches the displayed title below an English Markdown filename", () => {
  const node = {
    type: "file",
    kind: "markdown",
    name: "2026-07-31-weekly-report.md",
    path: "reports/2026-07-31-weekly-report.md",
    title: "本周工作报告",
  };

  assert.equal(fileMatchesTextFilter(node, {}, "工作报告"), true);
  assert.equal(fileMatchesTextFilter(node, {}, "weekly 工作"), true);
  assert.equal(fileMatchesTextFilter(node, {}, "monthly 工作"), false);
  assert.deepEqual(filterTextTree([node], {}, "工作报告"), [node]);
  assert.equal(
    fileMatchesTextFilter(node, {}, "工作报告", { showDocumentTitles: false }),
    false,
  );
  assert.deepEqual(
    filterTextTree([node], {}, "工作报告", { showDocumentTitles: false }),
    [],
  );

  const details = fileTextFilterMatchDetails(node, {
    ai_snippet: "This metadata is not needed to explain the visible result.",
  }, "weekly 工作");
  assert.equal(details.matches, true);
  assert.equal(details.nameMatchesAllTokens, false);
  assert.deepEqual(details.nameRanges, [{ from: 11, to: 17 }]);
  assert.equal(details.snippetExcerpt, null);
  assert.deepEqual(textFilterMatchRanges(node.title, "weekly 工作"), [
    { from: 2, to: 4 },
  ]);
});

test("titles do not become hidden search fields for Chinese filenames", () => {
  const node = {
    type: "file",
    kind: "markdown",
    name: "本周报告.md",
    path: "reports/本周报告.md",
    title: "Private English Alias",
  };
  assert.equal(fileMatchesTextFilter(node, {}, "private alias"), false);
  assert.deepEqual(filterTextTree([node], {}, "private alias"), []);
});

test("file text search explains an ai_snippet-only match with highlighted evidence", () => {
  const details = fileTextFilterMatchDetails(
    {
      type: "file",
      name: "company-story.md",
      path: "marketing/violy/market-context/brand/company-story.md",
    },
    {
      ai_snippet: "[Marketing Context] Violy 品牌上下文：Violy 公司故事。",
    },
    "context",
  );

  assert.deepEqual(details, {
    matches: true,
    nameMatchesAllTokens: false,
    nameRanges: [],
    snippetMatch: {
      text: "[Marketing Context] Violy 品牌上下文：Violy 公司故事。",
      ranges: [{ from: 11, to: 18 }],
    },
    snippetExcerpt: {
      text: "[Marketing Context] Violy 品牌上下文：Violy 公司故事。",
      ranges: [{ from: 11, to: 18 }],
    },
  });
});

test("file text search shows snippet evidence when query terms span the file name and ai_snippet", () => {
  const details = fileTextFilterMatchDetails(
    {
      type: "file",
      name: "pricing-guide.md",
      path: "marketing/violy/market-context/product/pricing-guide.md",
    },
    {
      ai_snippet: "[Marketing Product Context] Violy 价格与套餐。",
    },
    "guide context",
  );

  assert.equal(details.matches, true);
  assert.equal(details.nameMatchesAllTokens, false);
  assert.deepEqual(details.nameRanges, [{ from: 8, to: 13 }]);
  assert.deepEqual(details.snippetExcerpt?.ranges, [{ from: 19, to: 26 }]);
});

test("file text search keeps compact rows when the file name fully explains the match", () => {
  const details = fileTextFilterMatchDetails(
    {
      type: "file",
      name: "market-context.md",
      path: "market-context.md",
    },
    {
      ai_snippet: "[Marketing Context] Searchable metadata.",
    },
    "market context",
  );

  assert.equal(details.matches, true);
  assert.equal(details.nameMatchesAllTokens, true);
  assert.deepEqual(details.nameRanges, [
    { from: 0, to: 6 },
    { from: 7, to: 14 },
  ]);
  assert.equal(details.snippetExcerpt, null);
});

test("file text search excerpts keep a late ai_snippet match visible", () => {
  const details = fileTextFilterMatchDetails(
    {
      type: "file",
      name: "operating-model.md",
      path: "operating-model.md",
    },
    {
      ai_snippet:
        "This summary begins with background that does not fit in a narrow sidebar before Governance appears.",
    },
    "governance",
    { maxSnippetLength: 40 },
  );

  assert.match(details.snippetExcerpt?.text ?? "", /^….*Governance/);
  const highlighted = details.snippetExcerpt?.ranges
    .map(({ from, to }) => details.snippetExcerpt.text.slice(from, to));
  assert.deepEqual(highlighted, ["Governance"]);
  assert.equal(
    details.snippetMatch?.text,
    "This summary begins with background that does not fit in a narrow sidebar before Governance appears.",
  );
  assert.deepEqual(
    details.snippetMatch?.ranges.map(({ from, to }) => details.snippetMatch.text.slice(from, to)),
    ["Governance"],
  );
});

test("tree text search keeps only matching nodes and the ancestors needed to reach them", () => {
  const searchableTree = [{
    type: "directory",
    name: "marketing",
    children: [
      {
        type: "directory",
        name: "docs",
        children: [{
          type: "directory",
          name: "context-for-llm",
          children: [{
            type: "file",
            name: "violy-product-context.md",
            path: "marketing/docs/context-for-llm/violy-product-context.md",
          }],
        }],
      },
      {
        type: "directory",
        name: "violy",
        children: [{
          type: "directory",
          name: "market-context",
          children: [{
            type: "directory",
            name: "audience",
            children: [{
              type: "file",
              name: "pain-points.md",
              path: "marketing/violy/market-context/audience/pain-points.md",
            }],
          }],
        }],
      },
    ],
  }];

  assert.deepEqual(filterTextTree(searchableTree, {}, "violy context"), [{
    type: "directory",
    name: "marketing",
    children: [{
      type: "directory",
      name: "docs",
      children: [{
        type: "directory",
        name: "context-for-llm",
        children: [{
          type: "file",
          name: "violy-product-context.md",
          path: "marketing/docs/context-for-llm/violy-product-context.md",
        }],
      }],
    }],
  }]);
});

test("matching a directory does not reveal unrelated descendants", () => {
  const searchableTree = [{
    type: "directory",
    name: "campaign-context",
    children: [
      {
        type: "file",
        name: "README.md",
        path: "campaign-context/README.md",
      },
      {
        type: "file",
        name: "context-brief.md",
        path: "campaign-context/context-brief.md",
      },
    ],
  }];

  assert.deepEqual(filterTextTree(searchableTree, {}, "campaign context"), [{
    type: "directory",
    name: "campaign-context",
    children: [],
  }]);
});

test("explicitly expanding a matching directory reveals its descendants for the active search", () => {
  const searchableTree = [{
    type: "directory",
    name: "campaign-context",
    children: [
      {
        type: "file",
        name: "README.md",
        path: "campaign-context/README.md",
      },
      {
        type: "directory",
        name: "notes",
        children: [{
          type: "file",
          name: "launch.md",
          path: "campaign-context/notes/launch.md",
        }],
      },
    ],
  }];

  assert.deepEqual(
    filterTextTree(searchableTree, {}, "campaign context", {
      expandedDirectoryPaths: new Set(["campaign-context"]),
    }),
    searchableTree,
  );
});

test("tree search highlights every case-insensitive keyword match", () => {
  assert.deepEqual(
    textFilterMatchRanges("Violy product context.md", "violy context"),
    [
      { from: 0, to: 5 },
      { from: 14, to: 21 },
    ],
  );
});

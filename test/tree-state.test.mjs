import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTreeDirectoryStates,
  serializeTreeDirectoryState,
  shouldRecordTreeDirectoryToggle,
  shouldOpenTreeDirectory,
  treeAncestorDirectories,
  treeDirectoryPath,
  treeDirectoryStateForView,
  treeDirectoryStatesFromPreference,
  treeDirectoryStateScope,
} from "../public/tree-state.js";

test("treeDirectoryPath derives stable nested directory paths", () => {
  assert.equal(treeDirectoryPath("", "docs"), "docs");
  assert.equal(treeDirectoryPath("docs", "guides"), "docs/guides");
});

test("shouldOpenTreeDirectory preserves manual expansion across refreshes", () => {
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "docs",
      hasBroadTreeFilter: false,
      containsCurrentFile: false,
      expandedDirectories: new Set(["docs"]),
      collapsedDirectories: new Set(),
    }),
    true,
  );
});

test("shouldOpenTreeDirectory preserves manual collapse over active-file defaults", () => {
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "docs",
      hasBroadTreeFilter: false,
      containsCurrentFile: true,
      expandedDirectories: new Set(),
      collapsedDirectories: new Set(["docs"]),
    }),
    false,
  );
});

test("current document does not implicitly expand a directory during tab switches", () => {
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "docs",
      hasBroadTreeFilter: false,
      containsCurrentFile: true,
      expandedDirectories: new Set(),
      collapsedDirectories: new Set(),
    }),
    false,
  );
});

test("treeAncestorDirectories returns the paths needed for an explicit reveal", () => {
  assert.deepEqual(
    treeAncestorDirectories("docs/campaigns/launch.md"),
    ["docs", "docs/campaigns"],
  );
  assert.deepEqual(treeAncestorDirectories("README.md"), []);
});

test("shouldOpenTreeDirectory opens all directories while broad filters are active", () => {
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "docs",
      hasBroadTreeFilter: true,
      containsCurrentFile: false,
      expandedDirectories: new Set(),
      collapsedDirectories: new Set(),
    }),
    true,
  );
});

test("shouldOpenTreeDirectory temporarily overrides manual collapse while broad filters are active", () => {
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "growth",
      hasBroadTreeFilter: true,
      containsCurrentFile: false,
      expandedDirectories: new Set(),
      collapsedDirectories: new Set(["growth"]),
    }),
    true,
  );
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "growth",
      hasBroadTreeFilter: false,
      containsCurrentFile: false,
      expandedDirectories: new Set(),
      collapsedDirectories: new Set(["growth"]),
    }),
    false,
  );
});

test("search uses transient directory state without changing saved directory preferences", () => {
  const savedExpanded = new Set(["archive", "product/campaign-context"]);
  const savedCollapsed = new Set(["product"]);
  const searchAutoExpanded = new Set(["product"]);

  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "product",
      searchActive: true,
      searchAutoExpandedDirectories: searchAutoExpanded,
      searchExpandedDirectories: new Set(),
      searchCollapsedDirectories: new Set(),
      expandedDirectories: savedExpanded,
      collapsedDirectories: savedCollapsed,
    }),
    true,
  );
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "product/campaign-context",
      searchActive: true,
      searchAutoExpandedDirectories: searchAutoExpanded,
      searchExpandedDirectories: new Set(),
      searchCollapsedDirectories: new Set(),
      expandedDirectories: savedExpanded,
      collapsedDirectories: savedCollapsed,
    }),
    false,
  );
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "product/campaign-context",
      searchActive: true,
      searchAutoExpandedDirectories: searchAutoExpanded,
      searchExpandedDirectories: new Set(["product/campaign-context"]),
      searchCollapsedDirectories: new Set(),
      expandedDirectories: savedExpanded,
      collapsedDirectories: savedCollapsed,
    }),
    true,
  );
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "product",
      searchActive: true,
      searchAutoExpandedDirectories: searchAutoExpanded,
      searchExpandedDirectories: new Set(),
      searchCollapsedDirectories: new Set(["product"]),
      expandedDirectories: savedExpanded,
      collapsedDirectories: savedCollapsed,
    }),
    false,
  );
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "product",
      searchActive: false,
      searchAutoExpandedDirectories: searchAutoExpanded,
      searchExpandedDirectories: new Set(["product"]),
      searchCollapsedDirectories: new Set(),
      expandedDirectories: savedExpanded,
      collapsedDirectories: savedCollapsed,
    }),
    false,
  );
});

test("sync view enters with every changed-file directory open despite saved collapse state", () => {
  const directoryState = treeDirectoryStateForView({
    view: "sync",
    directoryState: {
      expanded: ["research"],
      collapsed: ["product", "research/projects"],
    },
  });

  assert.deepEqual(directoryState, {
    expanded: [],
    collapsed: [],
  });
  assert.equal(
    shouldOpenTreeDirectory({
      directoryPath: "product",
      hasBroadTreeFilter: true,
      expandedDirectories: new Set(directoryState.expanded),
      collapsedDirectories: new Set(directoryState.collapsed),
    }),
    true,
  );
});

test("all and favorites views keep their saved directory state", () => {
  const directoryState = {
    expanded: ["research"],
    collapsed: ["product"],
  };

  assert.deepEqual(
    treeDirectoryStateForView({ view: "all", directoryState }),
    directoryState,
  );
  assert.deepEqual(
    treeDirectoryStateForView({ view: "favorites", directoryState }),
    directoryState,
  );
});

test("tree directory states are scoped by repository", () => {
  assert.equal(
    treeDirectoryStateScope({ repoId: "docs-repo" }),
    "docs-repo:all",
  );
});

test("local changes keep directory memory separate from the default tree", () => {
  assert.equal(
    treeDirectoryStateScope({
      repoId: "docs-repo",
      showOnlyGitChanges: true,
    }),
    "docs-repo:git-changes",
  );
  assert.notEqual(
    treeDirectoryStateScope({
      repoId: "docs-repo",
      showOnlyGitChanges: true,
    }),
    treeDirectoryStateScope({ repoId: "docs-repo" }),
  );
});

test("favorites keep directory memory separate from all files and sync", () => {
  assert.equal(
    treeDirectoryStateScope({
      repoId: "docs-repo",
      view: "favorites",
    }),
    "docs-repo:favorites",
  );
  assert.equal(
    treeDirectoryStateScope({
      repoId: "docs-repo",
      view: "sync",
    }),
    "docs-repo:git-changes",
  );
  assert.notEqual(
    treeDirectoryStateScope({ repoId: "docs-repo", view: "favorites" }),
    treeDirectoryStateScope({ repoId: "docs-repo" }),
  );
});

test("tree directory states serialize stable expanded and collapsed paths", () => {
  assert.deepEqual(
    serializeTreeDirectoryState({
      expandedDirectories: new Set(["docs", "growth"]),
      collapsedDirectories: new Set(["growth/mango-da", ""]),
    }),
    {
      expanded: ["docs", "growth"],
      collapsed: ["growth/mango-da"],
    },
  );

  assert.deepEqual(
    normalizeTreeDirectoryStates({
      "docs-repo:previewable": {
        expanded: ["docs", "docs"],
        collapsed: ["growth"],
      },
      empty: {
        expanded: [],
        collapsed: [],
      },
    }),
    {
      "docs-repo:previewable": {
        expanded: ["docs"],
        collapsed: ["growth"],
      },
    },
  );
});

test("tree directory toggle recording ignores initialization and programmatic echoes", () => {
  assert.equal(
    shouldRecordTreeDirectoryToggle({
      previousOpen: true,
      nextOpen: true,
    }),
    false,
  );
  assert.equal(
    shouldRecordTreeDirectoryToggle({
      previousOpen: true,
      nextOpen: false,
      programmatic: true,
    }),
    false,
  );
  assert.equal(
    shouldRecordTreeDirectoryToggle({
      previousOpen: true,
      nextOpen: false,
    }),
    true,
  );
});

test("tree directory desktop preferences do not fall back to stale local storage", () => {
  assert.deepEqual(
    treeDirectoryStatesFromPreference({
      preferences: {},
      fallbackValue: {
        "content-repo:previewable": {
          expanded: ["growth"],
          collapsed: ["docs"],
        },
      },
    }),
    {},
  );

  assert.deepEqual(
    treeDirectoryStatesFromPreference({
      preferences: null,
      fallbackValue: {
        "content-repo:previewable": {
          expanded: ["growth"],
          collapsed: ["docs"],
        },
      },
    }),
    {
      "content-repo:previewable": {
        expanded: ["growth"],
        collapsed: ["docs"],
      },
    },
  );
});

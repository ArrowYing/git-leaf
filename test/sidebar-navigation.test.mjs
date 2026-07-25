import assert from "node:assert/strict";
import test from "node:test";

import {
  sidebarEmptyStateKind,
  normalizeSidebarTab,
  sidebarTabFromKey,
  sidebarTreeForView,
} from "../public/sidebar-navigation.js";

const tree = [
  { type: "file", name: "README.md", path: "README.md", kind: "markdown" },
  {
    type: "directory",
    name: "docs",
    children: [
      { type: "file", name: "guide.md", path: "docs/guide.md", kind: "markdown" },
      { type: "file", name: "plan.md", path: "docs/plan.md", kind: "markdown" },
    ],
  },
];

test("sidebar navigation defaults to all and supports tablist arrow keys", () => {
  assert.equal(normalizeSidebarTab("invalid"), "all");
  assert.equal(sidebarTabFromKey("all", "ArrowRight"), "favorites");
  assert.equal(sidebarTabFromKey("all", "ArrowLeft"), "sync");
  assert.equal(sidebarTabFromKey("sync", "Home"), "all");
  assert.equal(sidebarTabFromKey("all", "End"), "sync");
  assert.equal(sidebarTabFromKey("favorites", "Enter"), "");
});

test("sidebar empty states distinguish no data from filtered results", () => {
  assert.equal(sidebarEmptyStateKind({ view: "favorites" }), "favorites");
  assert.equal(sidebarEmptyStateKind({ view: "sync" }), "sync");
  assert.equal(sidebarEmptyStateKind({
    view: "favorites",
    search: "missing",
  }), "filtered");
  assert.equal(sidebarEmptyStateKind({
    view: "favorites",
    frontmatterFilterCount: 1,
  }), "filtered");
  assert.equal(sidebarEmptyStateKind({
    view: "sync",
    frontmatterFilterCount: 1,
  }), "sync");
});

test("favorites view contains explicit folders and documents in saved order", () => {
  assert.deepEqual(sidebarTreeForView(tree, {
    view: "favorites",
    favorites: [
      { type: "directory", path: "docs" },
      { type: "document", path: "README.md" },
    ],
  }), [{ ...tree[1], path: "docs" }, tree[0]]);
});

test("sync view keeps only changed files with their directory ancestry", () => {
  assert.deepEqual(sidebarTreeForView(tree, {
    view: "sync",
    changedPaths: ["docs/plan.md"],
  }), [{
    type: "directory",
    name: "docs",
    children: [
      { type: "file", name: "plan.md", path: "docs/plan.md", kind: "markdown" },
    ],
  }]);
  assert.deepEqual(sidebarTreeForView(tree, { view: "sync" }), []);
});

test("sync view adds a readonly node for a deleted file missing from the tree", () => {
  assert.deepEqual(sidebarTreeForView(tree, {
    view: "sync",
    changedPaths: ["docs/removed.md"],
  }), [{
    type: "directory",
    name: "docs",
    children: [{
      type: "file",
      name: "removed.md",
      path: "docs/removed.md",
      kind: "readonly",
      missing: true,
    }],
  }]);
});

test("sync view builds missing directory ancestry for deleted git changes", () => {
  assert.deepEqual(sidebarTreeForView(tree, {
    view: "sync",
    gitChanges: [
      { path: "archive/2025/removed.md", status: "deleted" },
      { path: "docs/guide.md", status: "modified" },
    ],
  }), [
    {
      type: "directory",
      name: "archive",
      children: [{
        type: "directory",
        name: "2025",
        children: [{
          type: "file",
          name: "removed.md",
          path: "archive/2025/removed.md",
          kind: "readonly",
          missing: true,
        }],
      }],
    },
    {
      type: "directory",
      name: "docs",
      children: [
        { type: "file", name: "guide.md", path: "docs/guide.md", kind: "markdown" },
      ],
    },
  ]);
});

test("sync view does not duplicate an existing file node", () => {
  assert.deepEqual(sidebarTreeForView(tree, {
    view: "sync",
    changedPaths: ["docs/plan.md"],
    gitChanges: [{ path: "docs/plan.md", status: "deleted" }],
  }), [{
    type: "directory",
    name: "docs",
    children: [
      { type: "file", name: "plan.md", path: "docs/plan.md", kind: "markdown" },
    ],
  }]);
});

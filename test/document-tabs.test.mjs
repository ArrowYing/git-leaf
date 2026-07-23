import assert from "node:assert/strict";
import test from "node:test";
import {
  closeDocumentTab,
  closeDocumentTabsToRight,
  closeOtherDocumentTabs,
  openDocumentTab,
  reorderDocumentTabs,
  shouldSkipTreeDocumentLoad,
  tabTitleFromPath,
} from "../public/document-tabs.js";

test("tabTitleFromPath shows the file name", () => {
  assert.equal(tabTitleFromPath("docs/guides/github-apps-management.md"), "github-apps-management.md");
});

test("plain click replaces the current active tab", () => {
  const result = openDocumentTab({
    tabs: [{ path: "AGENTS.md" }, { path: "README.md" }],
    activePath: "AGENTS.md",
    targetPath: "release.md",
    behavior: "current",
  });

  assert.deepEqual(result.tabs.map((tab) => tab.path), ["release.md", "README.md"]);
  assert.equal(result.activePath, "release.md");
});

test("plain click activates an already-open target without duplicating it", () => {
  const result = openDocumentTab({
    tabs: [{ path: "AGENTS.md" }, { path: "README.md" }],
    activePath: "AGENTS.md",
    targetPath: "README.md",
    behavior: "current",
  });

  assert.deepEqual(result.tabs.map((tab) => tab.path), ["AGENTS.md", "README.md"]);
  assert.equal(result.activePath, "README.md");
});

test("Command click opens a background tab and keeps the current active document", () => {
  const result = openDocumentTab({
    tabs: [{ path: "AGENTS.md" }],
    activePath: "AGENTS.md",
    targetPath: "README.md",
    behavior: "background",
  });

  assert.deepEqual(result.tabs.map((tab) => tab.path), ["AGENTS.md", "README.md"]);
  assert.equal(result.activePath, "AGENTS.md");
});

test("Command click on an already-open target keeps the current active document", () => {
  const result = openDocumentTab({
    tabs: [{ path: "AGENTS.md" }, { path: "README.md" }],
    activePath: "AGENTS.md",
    targetPath: "README.md",
    behavior: "background",
  });

  assert.deepEqual(result.tabs.map((tab) => tab.path), ["AGENTS.md", "README.md"]);
  assert.equal(result.activePath, "AGENTS.md");
});

test("tree click skips loading the already active document", () => {
  assert.equal(
    shouldSkipTreeDocumentLoad({
      behavior: "current",
      previousActivePath: "docs/repo-structure.md",
      nextActivePath: "docs/repo-structure.md",
      currentDocumentPath: "docs/repo-structure.md",
      targetPath: "docs/repo-structure.md",
    }),
    true,
  );
});

test("tree click still loads an inactive already-open document", () => {
  assert.equal(
    shouldSkipTreeDocumentLoad({
      behavior: "current",
      previousActivePath: "AGENTS.md",
      nextActivePath: "README.md",
      currentDocumentPath: "AGENTS.md",
      targetPath: "README.md",
    }),
    false,
  );
});

test("Command tree click opens background tabs without loading them", () => {
  assert.equal(
    shouldSkipTreeDocumentLoad({
      behavior: "background",
      previousActivePath: "AGENTS.md",
      nextActivePath: "AGENTS.md",
      currentDocumentPath: "AGENTS.md",
      targetPath: "README.md",
    }),
    true,
  );
});

test("Shift click opens a foreground tab and activates it", () => {
  const result = openDocumentTab({
    tabs: [{ path: "AGENTS.md" }],
    activePath: "AGENTS.md",
    targetPath: "README.md",
    behavior: "foreground",
  });

  assert.deepEqual(result.tabs.map((tab) => tab.path), ["AGENTS.md", "README.md"]);
  assert.equal(result.activePath, "README.md");
});

test("closing an inactive tab preserves the current active document", () => {
  const result = closeDocumentTab({
    tabs: [{ path: "AGENTS.md" }, { path: "README.md" }, { path: "release.md" }],
    activePath: "release.md",
    targetPath: "README.md",
  });

  assert.deepEqual(result.tabs.map((tab) => tab.path), ["AGENTS.md", "release.md"]);
  assert.equal(result.activePath, "release.md");
});

test("closing the active tab activates the nearest adjacent tab", () => {
  const result = closeDocumentTab({
    tabs: [{ path: "AGENTS.md" }, { path: "README.md" }, { path: "release.md" }],
    activePath: "README.md",
    targetPath: "README.md",
  });

  assert.deepEqual(result.tabs.map((tab) => tab.path), ["AGENTS.md", "release.md"]);
  assert.equal(result.activePath, "release.md");
});

test("closing the final tab leaves no active document", () => {
  const result = closeDocumentTab({
    tabs: [{ path: "AGENTS.md" }],
    activePath: "AGENTS.md",
    targetPath: "AGENTS.md",
  });

  assert.deepEqual(result.tabs, []);
  assert.equal(result.activePath, "");
});

test("closing other tabs keeps and activates the context-menu target", () => {
  const result = closeOtherDocumentTabs({
    tabs: [{ path: "AGENTS.md" }, { path: "README.md" }, { path: "release.md" }],
    targetPath: "README.md",
  });

  assert.deepEqual(result.tabs, [{ path: "README.md" }]);
  assert.equal(result.activePath, "README.md");
});

test("closing tabs to the right follows the current visual order", () => {
  const result = closeDocumentTabsToRight({
    tabs: [{ path: "release.md" }, { path: "AGENTS.md" }, { path: "README.md" }],
    activePath: "README.md",
    targetPath: "AGENTS.md",
  });

  assert.deepEqual(result.tabs.map((tab) => tab.path), ["release.md", "AGENTS.md"]);
  assert.equal(result.activePath, "AGENTS.md");
});

test("drag reorder moves a tab before or after its drop target", () => {
  const tabs = [{ path: "AGENTS.md" }, { path: "README.md" }, { path: "release.md" }];

  assert.deepEqual(
    reorderDocumentTabs({ tabs, sourcePath: "release.md", targetPath: "AGENTS.md", placement: "before" })
      .map((tab) => tab.path),
    ["release.md", "AGENTS.md", "README.md"],
  );
  assert.deepEqual(
    reorderDocumentTabs({ tabs, sourcePath: "AGENTS.md", targetPath: "README.md", placement: "after" })
      .map((tab) => tab.path),
    ["README.md", "AGENTS.md", "release.md"],
  );
});

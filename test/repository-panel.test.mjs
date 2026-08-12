import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultRepositoryPanelSelection,
  moveRepositoryPanelSelection,
  normalizeRepositoryPanelItems,
  reorderRepositoryPanelItems,
  repositoryPanelActionUrl,
  repositoryHeaderUsesWorktreeSelector,
  repositoryPanelItemForShortcut,
  repositoryPanelReorderUrl,
  visibleRepositoryPanelItems,
} from "../public/repository-panel.js";
import {
  desktopRepositoryPanelItems,
  desktopRepositoryPanelShortcutFromInput,
  desktopRepositoryRootForPanelId,
  desktopRepositoryRootsForPanelOrder,
} from "../src/desktop/repository-panel.mjs";

const PANEL_ITEMS = [
  { id: "mango", name: "mango-os", context: "Projects", current: false },
  { id: "leaf", name: "git-leaf", context: "", current: true },
  { id: "content", name: "mango-content", context: "Projects", current: false },
];

test("repository header replaces the repeated title only for multiple worktrees", () => {
  assert.equal(repositoryHeaderUsesWorktreeSelector({
    currentWorktree: { id: "main" },
    worktreeCount: 2,
  }), true);
  assert.equal(repositoryHeaderUsesWorktreeSelector({
    currentWorktree: { id: "main" },
    worktreeCount: 1,
  }), false);
  assert.equal(repositoryHeaderUsesWorktreeSelector({
    currentWorktree: null,
    worktreeCount: 2,
  }), false);
});

test("repository panel preserves stable order without numbering the current repository", () => {
  const visible = visibleRepositoryPanelItems(PANEL_ITEMS);

  assert.deepEqual(visible.map((item) => [item.id, item.shortcut]), [
    ["mango", 1],
    ["leaf", null],
    ["content", 2],
  ]);
  assert.equal(defaultRepositoryPanelSelection(visible), "mango");
});

test("repository panel numbers only the first nine switchable visible repositories", () => {
  const visible = visibleRepositoryPanelItems([
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `before-${index}`,
      name: `Before ${index}`,
      current: false,
    })),
    { id: "current", name: "Current", current: true },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `after-${index}`,
      name: `After ${index}`,
      current: false,
    })),
  ]);

  assert.deepEqual(
    visible.map((item) => item.shortcut),
    [1, 2, 3, 4, 5, null, 6, 7, 8, 9, null, null],
  );
  assert.equal(repositoryPanelItemForShortcut(visible, 9)?.id, "after-3");
});

test("repository panel filters names and duplicate-name context before assigning visible shortcuts", () => {
  const visible = visibleRepositoryPanelItems([
    ...PANEL_ITEMS,
    { id: "archive", name: "docs", context: "Archive", current: false },
  ], "docs archive");

  assert.deepEqual(visible, [{
    id: "archive",
    name: "docs",
    context: "Archive",
    current: false,
    shortcut: 1,
  }]);
  assert.equal(repositoryPanelItemForShortcut(visible, 1)?.id, "archive");
  assert.equal(repositoryPanelItemForShortcut(visible, 0), null);
});

test("repository panel selection wraps across the visible result set", () => {
  const visible = visibleRepositoryPanelItems(PANEL_ITEMS);

  assert.equal(moveRepositoryPanelSelection(visible, "leaf", 1), "content");
  assert.equal(moveRepositoryPanelSelection(visible, "leaf", -1), "mango");
  assert.equal(moveRepositoryPanelSelection(visible, "content", 1), "mango");
  assert.equal(moveRepositoryPanelSelection(visible, "mango", -1), "content");
  assert.equal(moveRepositoryPanelSelection(visible, "missing", 1), "mango");
  assert.equal(moveRepositoryPanelSelection([], "", 1), "");
});

test("repository panel reorders one item before or after another without losing metadata", () => {
  assert.deepEqual(
    reorderRepositoryPanelItems(PANEL_ITEMS, "content", "mango", "before"),
    [PANEL_ITEMS[2], PANEL_ITEMS[0], PANEL_ITEMS[1]],
  );
  assert.deepEqual(
    reorderRepositoryPanelItems(PANEL_ITEMS, "mango", "content", "after"),
    [PANEL_ITEMS[1], PANEL_ITEMS[2], PANEL_ITEMS[0]],
  );
  assert.deepEqual(
    reorderRepositoryPanelItems(PANEL_ITEMS, "missing", "content", "after"),
    PANEL_ITEMS,
  );
});

test("repository panel normalization rejects incomplete and duplicate display items", () => {
  assert.deepEqual(normalizeRepositoryPanelItems([
    { id: "one", name: "One" },
    { id: "one", name: "Duplicate" },
    { id: "", name: "Missing ID" },
    { id: "missing-name", name: "" },
  ]), [{ id: "one", name: "One", context: "", current: false }]);
});

test("repository panel action URLs carry only the opaque repository id", () => {
  assert.equal(
    repositoryPanelActionUrl("switch", "0123456789abcdef"),
    "openpeek://switch-repository?id=0123456789abcdef",
  );
  assert.equal(repositoryPanelActionUrl("open"), "openpeek://open-repository");
  assert.equal(repositoryPanelActionUrl("unknown"), "");
});

test("repository panel reorder URLs carry one validated opaque id per repository", () => {
  assert.equal(
    repositoryPanelReorderUrl(["0123456789abcdef", "fedcba9876543210"]),
    "openpeek://reorder-repositories?id=0123456789abcdef&id=fedcba9876543210",
  );
  assert.equal(repositoryPanelReorderUrl(["0123456789abcdef"]), "");
  assert.equal(repositoryPanelReorderUrl(["0123456789abcdef", "0123456789abcdef"]), "");
  assert.equal(repositoryPanelReorderUrl(["/Users/person/Projects/docs", "fedcba9876543210"]), "");
});

test("desktop repository panel disambiguates duplicate names without exposing local roots", () => {
  const repoRoots = [
    "/Users/person/Projects/docs",
    "/Users/person/Archive/docs",
    "/Users/person/Projects/git-leaf",
  ];
  const items = desktopRepositoryPanelItems(repoRoots, repoRoots[2]);

  assert.deepEqual(items.map(({ name, context, current }) => ({ name, context, current })), [
    { name: "docs", context: "Projects", current: false },
    { name: "docs", context: "Archive", current: false },
    { name: "git-leaf", context: "", current: true },
  ]);
  assert.equal(items.every((item) => /^[a-f0-9]{16}$/u.test(item.id)), true);
  assert.equal(JSON.stringify(items).includes("/Users/person"), false);
  assert.equal(desktopRepositoryRootForPanelId(repoRoots, items[1].id), repoRoots[1]);
  assert.equal(desktopRepositoryRootForPanelId(repoRoots, "../Archive/docs"), "");
  assert.deepEqual(
    desktopRepositoryRootsForPanelOrder(repoRoots, [items[2].id, items[0].id, items[1].id]),
    [repoRoots[2], repoRoots[0], repoRoots[1]],
  );
  assert.equal(
    desktopRepositoryRootsForPanelOrder(repoRoots, [items[0].id, items[1].id]),
    null,
  );
  assert.equal(
    desktopRepositoryRootsForPanelOrder(repoRoots, [items[0].id, items[1].id, "0123456789abcdef"]),
    null,
  );
});

test("desktop repository panel owns Command-number shortcuts only while it is open", () => {
  assert.deepEqual(desktopRepositoryPanelShortcutFromInput({
    type: "keyDown",
    code: "Digit3",
    meta: true,
  }, { open: true }), {
    command: "repository-panel-switch-shortcut",
    shortcut: 3,
  });
  assert.deepEqual(desktopRepositoryPanelShortcutFromInput({
    type: "keyDown",
    code: "Digit0",
    control: true,
  }, { open: true }), {
    command: "repository-panel-open-another",
  });
  assert.equal(desktopRepositoryPanelShortcutFromInput({
    type: "keyDown",
    code: "Digit1",
    meta: true,
  }, { open: false }), null);
  assert.equal(desktopRepositoryPanelShortcutFromInput({
    type: "keyDown",
    code: "Digit1",
    meta: true,
    alt: true,
  }, { open: true }), null);
});

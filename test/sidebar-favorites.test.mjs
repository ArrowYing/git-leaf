import assert from "node:assert/strict";
import test from "node:test";

import {
  applySidebarFavoriteOperation,
  createSidebarFavoriteToggleQueue,
  favoriteNodesFromTree,
  normalizeSidebarFavoriteScopes,
  replaceSidebarFavoritePath,
  sidebarFavoritesForScope,
} from "../public/sidebar-favorites.js";

test("sidebar favorites normalize repository-relative document and directory entries", () => {
  assert.deepEqual(
    normalizeSidebarFavoriteScopes({
      repo: [
        { type: "directory", path: "docs" },
        { type: "document", path: "README.md" },
        { type: "document", path: "README.md" },
        { type: "document", path: "notes.txt" },
        { type: "document", path: "../outside.md" },
        { type: "document", path: "docs/./hidden.md" },
        { type: "document", path: "line\nbreak.md" },
        { type: "directory", path: "/absolute" },
      ],
      empty: [],
    }),
    {
      repo: [
        { type: "directory", path: "docs" },
        { type: "document", path: "README.md" },
      ],
    },
  );
});

test("sidebar favorite operations remain isolated by persistence scope", () => {
  const first = applySidebarFavoriteOperation({}, {
    scope: "main-worktree",
    action: "add",
    type: "document",
    path: "README.md",
  });
  assert.equal(first.changed, true);
  assert.deepEqual(sidebarFavoritesForScope(first.scopes, "main-worktree"), [
    { type: "document", path: "README.md" },
  ]);
  assert.deepEqual(sidebarFavoritesForScope(first.scopes, "linked-worktree"), []);

  const second = applySidebarFavoriteOperation(first.scopes, {
    scope: "main-worktree",
    action: "remove",
    type: "document",
    path: "README.md",
  });
  assert.deepEqual(second, {
    scopes: {},
    favorites: [],
    changed: true,
  });
});

test("explicit favorite operations compose without dropping earlier additions", () => {
  const first = applySidebarFavoriteOperation({}, {
    scope: "/repo",
    action: "add",
    type: "directory",
    path: "docs",
  });
  const second = applySidebarFavoriteOperation(first.scopes, {
    scope: "/repo",
    action: "add",
    type: "document",
    path: "README.md",
  });
  const third = applySidebarFavoriteOperation(second.scopes, {
    scope: "/repo",
    action: "remove",
    type: "directory",
    path: "docs",
  });

  assert.deepEqual(second.favorites, [
    { type: "directory", path: "docs" },
    { type: "document", path: "README.md" },
  ]);
  assert.deepEqual(third.favorites, [
    { type: "document", path: "README.md" },
  ]);
});

test("rapid favorite toggles are serialized against the latest saved state", async () => {
  let active = false;
  const requestedStates = [];
  const toggle = createSidebarFavoriteToggleQueue({
    isActive: () => active,
    setActive: async ({ active: nextActive }) => {
      requestedStates.push(nextActive);
      await new Promise((resolve) => setImmediate(resolve));
      active = nextActive;
    },
  });

  await Promise.all([
    toggle({ type: "document", path: "README.md" }),
    toggle({ type: "document", path: "README.md" }),
  ]);

  assert.deepEqual(requestedStates, [true, false]);
  assert.equal(active, false);
});

test("favorite tree keeps existing and missing entries in explicit order without mutating the source", () => {
  const tree = [
    { type: "file", name: "README.md", path: "README.md", kind: "markdown" },
    {
      type: "directory",
      name: "docs",
      children: [
        { type: "file", name: "guide.md", path: "docs/guide.md", kind: "markdown" },
        { type: "file", name: "image.png", path: "docs/image.png", kind: "image" },
        {
          type: "directory",
          name: "guides",
          children: [
            { type: "file", name: "start.md", path: "docs/guides/start.md", kind: "markdown" },
          ],
        },
      ],
    },
  ];
  const original = structuredClone(tree);

  assert.deepEqual(
    favoriteNodesFromTree(tree, [
      { type: "directory", path: "docs" },
      { type: "document", path: "README.md" },
      { type: "directory", path: "docs/guides" },
      { type: "document", path: "missing.md" },
      { type: "directory", path: "archive/notes" },
    ]),
    [
      { ...tree[1], path: "docs" },
      tree[0],
      {
        ...tree[1].children[2],
        path: "docs/guides",
      },
      {
        type: "file",
        name: "missing.md",
        path: "missing.md",
        kind: "unknown",
        missing: true,
      },
      {
        type: "directory",
        name: "notes",
        path: "archive/notes",
        children: [],
        missing: true,
      },
    ],
  );
  assert.deepEqual(tree, original);
});

test("renaming a favorite document preserves its saved status", () => {
  assert.deepEqual(
    replaceSidebarFavoritePath({
      repo: [
        { type: "document", path: "guide.md" },
        { type: "directory", path: "docs" },
      ],
    }, {
      scope: "repo",
      type: "document",
      fromPath: "guide.md",
      toPath: "guide.mdx",
    }),
    {
      repo: [
        { type: "document", path: "guide.mdx" },
        { type: "directory", path: "docs" },
      ],
    },
  );
});

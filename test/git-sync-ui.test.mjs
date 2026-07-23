import assert from "node:assert/strict";
import test from "node:test";

import { hasGitChangesChanged } from "../public/git-sync-ui.js";

test("identical background git status does not invalidate the file tree", () => {
  const changes = [
    { path: "docs/changed.md", status: "modified", rawStatus: " M" },
    {
      path: "docs/new-name.md",
      oldPath: "docs/old-name.md",
      status: "renamed",
      rawStatus: "R ",
    },
  ];

  assert.equal(hasGitChangesChanged(changes, structuredClone(changes)), false);
  assert.equal(hasGitChangesChanged(changes, [
    ...changes.slice(0, 1),
    { ...changes[1], status: "copied", rawStatus: "C " },
  ]), true);
  assert.equal(hasGitChangesChanged(changes, changes.slice(0, 1)), true);
});

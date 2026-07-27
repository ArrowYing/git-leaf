import assert from "node:assert/strict";
import test from "node:test";

import {
  REMOTE_SYNC_INTERVAL_MS,
  hasGitChangesChanged,
  remoteSyncDecision,
} from "../public/git-sync-ui.js";

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

test("remote sync checks on a ten-minute cadence", () => {
  assert.equal(REMOTE_SYNC_INTERVAL_MS, 600_000);
});

test("clean incoming changes auto-merge while dirty incoming changes require the explicit button", () => {
  const remote = { ok: true, behind: 2 };

  assert.deepEqual(remoteSyncDecision({
    remote,
    localChangeCount: 0,
    canEdit: true,
  }), {
    shouldAutoMerge: true,
    showMergeRemote: false,
    canMergeRemote: false,
    canRunPrimary: true,
    primaryAction: "check",
    badge: "↓",
  });

  assert.deepEqual(remoteSyncDecision({
    remote,
    localChangeCount: 3,
    canEdit: true,
  }), {
    shouldAutoMerge: false,
    showMergeRemote: true,
    canMergeRemote: true,
    canRunPrimary: true,
    primaryAction: "publish",
    badge: "3",
  });
});

test("remote sync actions remain disabled while another sync operation is running", () => {
  assert.deepEqual(remoteSyncDecision({
    remote: { ok: true, behind: 1 },
    localChangeCount: 1,
    canEdit: true,
    operation: "merge",
  }), {
    shouldAutoMerge: false,
    showMergeRemote: true,
    canMergeRemote: false,
    canRunPrimary: false,
    primaryAction: "publish",
    badge: "1",
  });
});

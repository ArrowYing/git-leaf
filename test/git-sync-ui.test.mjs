import assert from "node:assert/strict";
import test from "node:test";

import {
  REMOTE_SYNC_INTERVAL_MS,
  hasGitChangesChanged,
  remoteSyncCheckDue,
  remoteSyncDecision,
  remoteSyncIntervalMs,
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

test("remote sync uses the selected bounded cadence and defaults to ten minutes", () => {
  assert.equal(REMOTE_SYNC_INTERVAL_MS, 600_000);
  assert.equal(remoteSyncIntervalMs(1), 60_000);
  assert.equal(remoteSyncIntervalMs(2), 120_000);
  assert.equal(remoteSyncIntervalMs(5), 300_000);
  assert.equal(remoteSyncIntervalMs(10), 600_000);
  assert.equal(remoteSyncIntervalMs(30), 1_800_000);
  assert.equal(remoteSyncIntervalMs(60), 3_600_000);
  assert.equal(remoteSyncIntervalMs(120), 7_200_000);
  assert.equal(remoteSyncIntervalMs(15), 600_000);
});

test("a visible window checks against the selected interval", () => {
  assert.equal(remoteSyncCheckDue({
    intervalMinutes: 30,
    lastAttemptAt: 1_000,
    now: 1_800_999,
  }), false);
  assert.equal(remoteSyncCheckDue({
    intervalMinutes: 30,
    lastAttemptAt: 1_000,
    now: 1_801_000,
  }), true);
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

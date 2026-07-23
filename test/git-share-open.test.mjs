import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectSharedMain,
  sharedMainWorktree,
} from "../src/git-share-open.mjs";

const REV = "a".repeat(40);
const HEAD = "b".repeat(40);
const REMOTE = "c".repeat(40);

test("sharedMainWorktree selects only the primary main checkout", async () => {
  const result = await sharedMainWorktree("/repo/task", {
    readWorktrees: async () => [
      { root: "/repo", primary: true, branch: "main", available: true },
      { root: "/repo/task", primary: false, branch: "feature/task", available: true },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.primary.root, "/repo");

  const invalid = await sharedMainWorktree("/repo", {
    readWorktrees: async () => [
      { root: "/repo", primary: true, branch: "feature/task", available: true },
    ],
  });
  assert.deepEqual({ state: invalid.state, branch: invalid.branch }, {
    state: "primary_not_main",
    branch: "feature/task",
  });
});

test("inspectSharedMain accepts an up-to-date main with unrelated local edits", async () => {
  const result = await inspectSharedMain({
    repoRoot: "/repo",
    file: "docs/shared.md",
    rev: REV,
    gitRunner: gitRunner({
      head: HEAD,
      remoteHead: HEAD,
      unstaged: ["docs/draft.md"],
    }),
  });
  assert.equal(result.state, "ready");
  assert.deepEqual(result.dirtyPaths, ["docs/draft.md"]);
});

test("inspectSharedMain distinguishes clean and disjoint dirty fast-forwards", async () => {
  const clean = await inspectSharedMain({
    repoRoot: "/repo",
    file: "docs/shared.md",
    rev: REV,
    gitRunner: gitRunner({ head: HEAD, remoteHead: REMOTE, incoming: ["docs/shared.md"] }),
  });
  assert.equal(clean.state, "behind_clean");

  const disjoint = await inspectSharedMain({
    repoRoot: "/repo",
    file: "docs/shared.md",
    rev: REV,
    gitRunner: gitRunner({
      head: HEAD,
      remoteHead: REMOTE,
      unstaged: ["docs/draft.md"],
      incoming: ["docs/shared.md"],
    }),
  });
  assert.equal(disjoint.state, "behind_dirty_disjoint");
});

test("inspectSharedMain routes every overlapping file type to sync", async () => {
  const syncable = await inspectSharedMain({
    repoRoot: "/repo",
    file: "docs/shared.md",
    rev: REV,
    gitRunner: gitRunner({
      head: HEAD,
      remoteHead: REMOTE,
      unstaged: ["docs/shared.md", "docs/draft.mdx"],
      incoming: ["docs/shared.md"],
    }),
  });
  assert.equal(syncable.state, "sync_required");

  const withAttachment = await inspectSharedMain({
    repoRoot: "/repo",
    file: "docs/shared.md",
    rev: REV,
    gitRunner: gitRunner({
      head: HEAD,
      remoteHead: REMOTE,
      unstaged: ["docs/shared.md", "docs/_assets/photo.png"],
      incoming: ["docs/shared.md"],
    }),
  });
  assert.equal(withAttachment.state, "sync_required");
  assert.deepEqual(withAttachment.dirtyPaths, ["docs/_assets/photo.png", "docs/shared.md"]);
});

test("inspectSharedMain rejects missing revisions and non-fast-forward histories", async () => {
  const missing = await inspectSharedMain({
    repoRoot: "/repo",
    file: "docs/shared.md",
    rev: REV,
    gitRunner: gitRunner({ revisionAvailable: false }),
  });
  assert.equal(missing.state, "revision_missing");

  const diverged = await inspectSharedMain({
    repoRoot: "/repo",
    file: "docs/shared.md",
    rev: REV,
    gitRunner: gitRunner({ head: HEAD, remoteHead: REMOTE, headBehind: false, remoteBehind: false }),
  });
  assert.equal(diverged.state, "diverged");
});

test("inspectSharedMain does not turn command dependency failures into revision states", async () => {
  await assert.rejects(
    () => inspectSharedMain({
      repoRoot: "/repo",
      file: "docs/shared.md",
      rev: REV,
      fetchRemote: false,
      gitRunner: async () => {
        const error = new Error("spawn git ENOENT");
        error.code = "ENOENT";
        throw error;
      },
    }),
    /spawn git ENOENT/,
  );
});

function gitRunner({
  head = HEAD,
  remoteHead = REMOTE,
  revisionAvailable = true,
  headBehind = true,
  remoteBehind = false,
  unstaged = [],
  staged = [],
  untracked = [],
  incoming = [],
} = {}) {
  return async (_cwd, args) => {
    const command = args.join(" ");
    if (command === "fetch origin main") return { stdout: "", stderr: "" };
    if (command === "rev-parse HEAD") return { stdout: head, stderr: "" };
    if (command === "rev-parse refs/remotes/origin/main") return { stdout: remoteHead, stderr: "" };
    if (command === "diff --name-only -z") return { stdout: nul(unstaged), stderr: "" };
    if (command === "diff --cached --name-only -z") return { stdout: nul(staged), stderr: "" };
    if (command === "ls-files --others --exclude-standard -z") return { stdout: nul(untracked), stderr: "" };
    if (command === "diff --name-only -z HEAD..refs/remotes/origin/main") {
      return { stdout: nul(incoming), stderr: "" };
    }
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
      const [ancestor, descendant] = args.slice(2);
      if (ancestor === REV && descendant === "refs/remotes/origin/main") {
        if (revisionAvailable) return { stdout: "", stderr: "" };
        throw expectedNonAncestor();
      }
      if (ancestor === head && descendant === "refs/remotes/origin/main") {
        if (headBehind) return { stdout: "", stderr: "" };
        throw expectedNonAncestor();
      }
      if (ancestor === remoteHead && descendant === "HEAD") {
        if (remoteBehind) return { stdout: "", stderr: "" };
        throw expectedNonAncestor();
      }
    }
    throw new Error(`Unexpected git command: ${command}`);
  };
}

function expectedNonAncestor() {
  const error = new Error("not an ancestor");
  error.code = 1;
  return error;
}

function nul(paths) {
  return paths.length > 0 ? `${paths.join("\0")}\0` : "";
}

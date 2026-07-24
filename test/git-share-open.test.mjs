import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectSharedMain,
  inspectSharedMainWithFetchRecovery,
  sharedFetchFailurePrompt,
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

test("inspectSharedMain retries one transient fetch before evaluating the shared revision", async () => {
  const successfulRunner = gitRunner({ head: HEAD, remoteHead: HEAD });
  const waits = [];
  let fetchAttempts = 0;
  const result = await inspectSharedMain({
    repoRoot: "/repo",
    file: "docs/shared.md",
    rev: REV,
    fetchRetryDelayMs: 500,
    wait: async (delay) => waits.push(delay),
    gitRunner: async (cwd, args) => {
      if (args.join(" ") === "fetch origin main" && ++fetchAttempts === 1) {
        const error = new Error("fetch failed");
        error.stderr = "fatal: unable to access remote: Operation timed out";
        throw error;
      }
      return successfulRunner(cwd, args);
    },
  });

  assert.equal(result.state, "ready");
  assert.equal(fetchAttempts, 2);
  assert.deepEqual(waits, [500]);
});

test("inspectSharedMain does not automatically retry authentication failures", async () => {
  let fetchAttempts = 0;
  const result = await inspectSharedMain({
    repoRoot: "/repo",
    file: "docs/shared.md",
    rev: REV,
    wait: async () => assert.fail("authentication failures must wait for user action"),
    gitRunner: async () => {
      fetchAttempts += 1;
      const error = new Error("fetch failed");
      error.stderr = "fatal: Authentication failed for remote";
      throw error;
    },
  });

  assert.equal(result.state, "fetch_failed");
  assert.equal(result.commandState, "authentication_required");
  assert.equal(fetchAttempts, 1);
});

test("shared fetch recovery retries in place and preserves a declined terminal failure", async () => {
  const prompts = [];
  const states = [
    { ok: false, state: "fetch_failed", commandState: "network_unavailable" },
    { ok: true, state: "ready" },
  ];
  const recovered = await inspectSharedMainWithFetchRecovery({
    inspect: async () => states.shift(),
    promptFetchRetry: async (state) => {
      prompts.push(state.commandState);
      return true;
    },
  });
  assert.equal(recovered.state, "ready");
  assert.deepEqual(prompts, ["network_unavailable"]);

  const terminal = { ok: false, state: "fetch_failed", commandState: "authentication_required" };
  const declined = await inspectSharedMainWithFetchRecovery({
    inspect: async () => terminal,
    promptFetchRetry: async () => false,
  });
  assert.equal(declined, terminal);
});

test("shared fetch failure prompts distinguish network and authentication recovery", () => {
  const network = sharedFetchFailurePrompt({
    state: "fetch_failed",
    commandState: "network_unavailable",
    error: "fatal: connection timed out",
  });
  assert.equal(network.message, "暂时无法连接 GitHub");
  assert.match(network.detail, /已自动重试/);
  assert.match(network.detail, /本地仓库没有被修改/);
  assert.deepEqual(network.buttons, ["重新尝试", "暂不打开"]);

  const authentication = sharedFetchFailurePrompt({
    state: "fetch_failed",
    commandState: "authentication_required",
  });
  assert.equal(authentication.message, "Git 凭据需要重新登录");
  assert.match(authentication.detail, /当前仓库使用的 Git 凭据/);
  assert.deepEqual(authentication.buttons, ["重新检查", "暂不打开"]);
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

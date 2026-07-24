import assert from "node:assert/strict";
import test from "node:test";

import {
  createGitSyncGuard,
  publishCurrentBranch,
  repositoryChangesFromPorcelain,
  syncSelectedFiles as syncSelectedFilesImpl,
  syncStateDriftKind,
} from "../src/git-sync.mjs";

const REPO = { id: "docs-repo", root: "/repo/docs-repo", branch: "main" };
const TEST_HEAD = "a".repeat(40);

function stableSyncGuard() {
  return {
    capture: async () => ({ head: TEST_HEAD, fingerprint: "stable" }),
    currentHead: async () => TEST_HEAD,
    isWorktreeClean: async () => true,
  };
}

function syncSelectedFiles(options) {
  return syncSelectedFilesImpl({
    syncGuard: stableSyncGuard(),
    ...options,
  });
}

function successfulPreflight(args) {
  const command = args.join(" ");
  if (command === "config --get user.name") return { stdout: "Jane\n", stderr: "" };
  if (command === "config --get user.email") return { stdout: "jane@example.com\n", stderr: "" };
  if (command === "remote get-url origin") {
    return { stdout: "git@github.com:example-org/docs-repo.git\n", stderr: "" };
  }
  return null;
}

test("repositoryChangesFromPorcelain returns every Git file change", () => {
  const changes = repositoryChangesFromPorcelain([
    " M docs/changed.md",
    "A  docs/new.mdx",
    "?? public/app.js",
    " D assets/slides.pptx",
    "R  docs/new name.md",
    "docs/old name.md",
    "C  docs/copied.md",
    "docs/source.md",
    "",
  ].join("\0"));

  assert.deepEqual(changes, [
    { path: "docs/changed.md", status: "modified", rawStatus: " M" },
    { path: "docs/new.mdx", status: "added", rawStatus: "A " },
    { path: "public/app.js", status: "untracked", rawStatus: "??" },
    { path: "assets/slides.pptx", status: "deleted", rawStatus: " D" },
    {
      path: "docs/new name.md",
      oldPath: "docs/old name.md",
      status: "renamed",
      rawStatus: "R ",
    },
    {
      path: "docs/copied.md",
      oldPath: "docs/source.md",
      status: "copied",
      rawStatus: "C ",
    },
  ]);
});

test("syncSelectedFiles fetches first, commits every selected file type, rebases, and pushes", async () => {
  const calls = [];
  const files = ["docs/changed.md", "assets/slides.pptx"];
  const result = await syncSelectedFiles({
    repo: REPO,
    files,
    note: "补充发布说明",
    gitRunner: async (cwd, args) => {
      calls.push({ cwd, args });
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") {
        return { stdout: " M docs/changed.md\0 M assets/slides.pptx\0", stderr: "" };
      }
      if (args[0] === "rev-list") return { stdout: "0\t1\n", stderr: "" };
      if (args[0] === "diff") return { stdout: files.join("\0") + "\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.files, files);
  assert.deepEqual(calls.map((call) => call.args), [
    ["config", "--get", "user.name"],
    ["config", "--get", "user.email"],
    ["remote", "get-url", "origin"],
    ["ls-files", "--unmerged", "-z"],
    ["rev-parse", "-q", "--verify", "MERGE_HEAD"],
    ["rev-parse", "-q", "--verify", "CHERRY_PICK_HEAD"],
    ["rev-parse", "-q", "--verify", "REVERT_HEAD"],
    ["rev-parse", "--git-path", "rebase-merge"],
    ["rev-parse", "--git-path", "rebase-apply"],
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ["fetch", "origin", "main"],
    ["rev-list", "--left-right", "--count", "HEAD...refs/remotes/origin/main"],
    ["add", "-A", "--", ...files],
    ["diff", "--cached", "--name-only", "-z", "--", ...files],
    [
      "commit",
      "-m",
      "补充发布说明",
      "-m",
      "Files:\n- docs/changed.md\n- assets/slides.pptx",
      "--",
      ...files,
    ],
    ["rebase", "refs/remotes/origin/main"],
    ["push", "origin", `${TEST_HEAD}:refs/heads/main`],
    ["fetch", "origin", "main"],
    ["merge-base", "--is-ancestor", TEST_HEAD, "refs/remotes/origin/main"],
  ]);
  assert.equal(calls.every((call) => call.cwd === REPO.root), true);
});

test("syncSelectedFiles skips rebase when the fetched remote is not ahead", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["public/app.js"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") {
        return { stdout: " M public/app.js\0 M docs/unselected.md\0", stderr: "" };
      }
      if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "public/app.js\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.some((args) => args[0] === "rebase"), false);
  assert.deepEqual(calls.slice(-3), [
    ["push", "origin", `${TEST_HEAD}:refs/heads/main`],
    ["fetch", "origin", "main"],
    ["merge-base", "--is-ancestor", TEST_HEAD, "refs/remotes/origin/main"],
  ]);
});

test("syncSelectedFiles does not report success until origin contains the published commit", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") {
        return { stdout: " M docs/changed.md\0", stderr: "" };
      }
      if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      if (args[0] === "merge-base") {
        const error = new Error("published commit is missing from origin/main");
        error.code = 1;
        throw error;
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "verify publication");
  assert.match(result.error, /origin\/main/);
  assert.deepEqual(calls.slice(-3), [
    ["push", "origin", `${TEST_HEAD}:refs/heads/main`],
    ["fetch", "origin", "main"],
    ["merge-base", "--is-ancestor", TEST_HEAD, "refs/remotes/origin/main"],
  ]);
});

test("syncSelectedFiles blocks before staging when remote updates meet unselected local changes", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") {
        return { stdout: " M docs/changed.md\0 M assets/image.png\0", stderr: "" };
      }
      if (args[0] === "rev-list") return { stdout: "0\t2\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "validate");
  assert.match(result.error, /未勾选的本地改动/);
  assert.match(result.error, /assets\/image\.png/);
  assert.equal(calls.some((args) => args[0] === "add"), false);
  assert.equal(calls.some((args) => args[0] === "commit"), false);
});

test("syncSelectedFiles blocks a diverged branch before staging", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "2\t3\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "compare remote");
  assert.match(result.error, /已经分叉/);
  assert.equal(calls.some((args) => args[0] === "add"), false);
});

test("syncSelectedFiles stops when a successful Git comparison has invalid output", async () => {
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "unexpected\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "compare remote");
  assert.match(result.error, /无法识别的结果/);
});

test("syncSelectedFiles returns an all-file Agent prompt when rebase fails", async () => {
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\t1\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      if (args[0] === "rebase" && args[1] !== "--abort") {
        const error = new Error("rebase failed");
        error.stderr = "CONFLICT (content): Merge conflict in docs/changed.md";
        throw error;
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "rebase remote");
  assert.match(result.error, /CONFLICT/);
  assert.match(result.error, /已自动退出失败的 rebase/);
  assert.match(result.agentPrompt, /选中文件：\n- docs\/changed\.md/);
  assert.match(result.agentPrompt, /保留 Git Leaf 用户对上述文件的修改/);
});

test("syncSelectedFiles refuses unresolved conflicts and in-progress Git operations", async () => {
  const conflicts = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args[0] === "ls-files") return { stdout: "docs/changed.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(conflicts.step, "preflight");
  assert.match(conflicts.error, /尚未解决的冲突/);

  const rebase = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    operationPathExists: async (filePath) => filePath.endsWith("rebase-merge"),
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.join(" ") === "rev-parse --git-path rebase-merge") {
        return { stdout: ".git/rebase-merge\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(rebase.step, "preflight");
  assert.match(rebase.error, /正在进行 rebase/);
});

test("syncSelectedFiles publishes a branch without an upstream", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: { ...REPO, branch: "git-leaf/detached-1234567" },
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) throw expectedGitExit(128, "fatal: no upstream configured for branch");
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.slice(-4), [[
    "push",
    "origin",
    `${TEST_HEAD}:refs/heads/git-leaf/detached-1234567`,
  ], [
    "fetch",
    "origin",
    "git-leaf/detached-1234567",
  ], [
    "merge-base",
    "--is-ancestor",
    TEST_HEAD,
    "refs/remotes/origin/git-leaf/detached-1234567",
  ], [
    "branch",
    "--set-upstream-to=origin/git-leaf/detached-1234567",
    "--",
    "git-leaf/detached-1234567",
  ]]);
});

test("publishCurrentBranch retries an already committed main and verifies origin", async () => {
  const calls = [];
  const result = await publishCurrentBranch({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: "", stderr: "" };
      if (args.join(" ") === "rev-parse --verify HEAD") {
        return { stdout: `${TEST_HEAD}\n`, stderr: "" };
      }
      if (args[0] === "rev-list") return { stdout: "1\t0\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.publishedHead, TEST_HEAD);
  assert.deepEqual(calls.slice(-5), [
    ["fetch", "origin", "main"],
    ["rev-list", "--left-right", "--count", "HEAD...refs/remotes/origin/main"],
    ["push", "origin", `${TEST_HEAD}:refs/heads/main`],
    ["fetch", "origin", "main"],
    ["merge-base", "--is-ancestor", TEST_HEAD, "refs/remotes/origin/main"],
  ]);
});

test("syncSelectedFiles checks Git identity before staging files", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      if (args.join(" ") === "config --get user.name") return { stdout: "Jane\n", stderr: "" };
      throw expectedGitExit(1, "");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "preflight");
  assert.match(result.error, /Git user.email/);
  assert.deepEqual(calls.map((args) => args.join(" ")), [
    "config --get user.name",
    "config --get user.email",
  ]);
});

test("syncSelectedFiles checks origin remote before staging files", async () => {
  const calls = [];
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight && args[0] !== "remote") return preflight;
      throw expectedGitExit(2, "fatal: No such remote 'origin'");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "preflight");
  assert.match(result.error, /origin/);
  assert.deepEqual(calls.map((args) => args.join(" ")), [
    "config --get user.name",
    "config --get user.email",
    "remote get-url origin",
  ]);
});

test("syncSelectedFiles rejects unsafe paths but accepts code and binary paths", async () => {
  let called = false;
  const unsafe = await syncSelectedFiles({
    repo: REPO,
    files: ["../secret.md", "docs/../secret.md", ".git/config"],
    gitRunner: async () => {
      called = true;
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(called, false);
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.error, /请选择需要同步的文件/);

  const selected = ["public/app.js", "assets/slides.pptx"];
  const accepted = await syncSelectedFiles({
    repo: { ...REPO, branch: "feature" },
    files: selected,
    gitRunner: async (_cwd, args) => {
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) throw expectedGitExit(128, "fatal: no upstream configured for branch");
      if (args[0] === "status") {
        return { stdout: " M public/app.js\0 M assets/slides.pptx\0", stderr: "" };
      }
      if (args[0] === "diff") return { stdout: selected.join("\0") + "\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(accepted.ok, true);
});

test("syncSelectedFiles does not turn a missing Git command into missing config", async () => {
  const result = await syncSelectedFiles({
    repo: REPO,
    files: ["docs/changed.md"],
    gitRunner: async () => {
      const error = new Error("spawn git ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  });

  assert.equal(result.step, "preflight");
  assert.match(result.error, /spawn git ENOENT/);
  assert.doesNotMatch(result.error, /user\.name is not configured/);
});

test("syncSelectedFiles does not turn dependency failures into absent operation refs or upstream", async () => {
  for (const failingCommand of ["MERGE_HEAD", "@{upstream}"]) {
    const result = await syncSelectedFiles({
      repo: REPO,
      files: ["docs/changed.md"],
      gitRunner: async (_cwd, args) => {
        const preflight = successfulPreflight(args);
        if (preflight) return preflight;
        if (args.at(-1) === failingCommand) {
          const error = new Error("spawn git EACCES");
          error.code = "EACCES";
          throw error;
        }
        if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
        return { stdout: "", stderr: "" };
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /spawn git EACCES/);
  }
});

test("syncStateDriftKind distinguishes branch movement from content drift", () => {
  assert.equal(syncStateDriftKind(
    { head: TEST_HEAD, fingerprint: "before" },
    { head: "b".repeat(40), fingerprint: "before" },
  ), "head_changed");
  assert.equal(syncStateDriftKind(
    { head: TEST_HEAD, fingerprint: "before" },
    { head: TEST_HEAD, fingerprint: "after" },
  ), "content_changed");
  assert.equal(syncStateDriftKind(
    { head: TEST_HEAD, fingerprint: "same" },
    { head: TEST_HEAD, fingerprint: "same" },
  ), "none");
});

test("syncSelectedFiles retries preparation once when content changes during fetch", async () => {
  const captures = [
    { head: TEST_HEAD, fingerprint: "first" },
    { head: TEST_HEAD, fingerprint: "changed" },
    { head: TEST_HEAD, fingerprint: "stable" },
    { head: TEST_HEAD, fingerprint: "stable" },
  ];
  const calls = [];
  const result = await syncSelectedFilesImpl({
    repo: REPO,
    files: ["docs/changed.md"],
    syncGuard: {
      capture: async () => captures.shift(),
      currentHead: async () => TEST_HEAD,
      isWorktreeClean: async () => true,
    },
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.retryCount, 1);
  assert.equal(result.driftKind, "content_changed");
  assert.equal(calls.filter((args) => args[0] === "fetch").length, 3);
  assert.equal(calls.filter((args) => args[0] === "commit").length, 1);
});

test("all-change sync commits the frozen index instead of rereading worktree paths", async () => {
  const calls = [];
  const result = await syncSelectedFilesImpl({
    repo: REPO,
    allChanges: true,
    syncGuard: stableSyncGuard(),
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  const commitArgs = calls.find((args) => args[0] === "commit");
  assert.ok(commitArgs);
  assert.equal(commitArgs.includes("--"), false);
  assert.equal(commitArgs.includes("docs/changed.md"), false);
});

test("syncSelectedFiles stops before staging when the workspace changes twice", async () => {
  const captures = [
    { head: TEST_HEAD, fingerprint: "one" },
    { head: TEST_HEAD, fingerprint: "two" },
    { head: TEST_HEAD, fingerprint: "three" },
    { head: TEST_HEAD, fingerprint: "four" },
  ];
  const calls = [];
  const result = await syncSelectedFilesImpl({
    repo: REPO,
    files: ["docs/changed.md"],
    syncGuard: {
      capture: async () => captures.shift(),
      currentHead: async () => TEST_HEAD,
      isWorktreeClean: async () => true,
    },
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\t0\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "workspace changed");
  assert.equal(result.retryCount, 1);
  assert.equal(result.driftKind, "content_changed");
  assert.equal(calls.some((args) => args[0] === "add"), false);
});

test("syncSelectedFiles never rebases a worktree that changed after commit", async () => {
  const calls = [];
  const result = await syncSelectedFilesImpl({
    repo: REPO,
    files: ["docs/changed.md"],
    syncGuard: {
      capture: async () => ({ head: TEST_HEAD, fingerprint: "stable" }),
      currentHead: async () => TEST_HEAD,
      isWorktreeClean: async () => false,
    },
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      const preflight = successfulPreflight(args);
      if (preflight) return preflight;
      if (args.includes("@{upstream}")) return { stdout: "origin/main\n", stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "0\t1\n", stderr: "" };
      if (args[0] === "diff") return { stdout: "docs/changed.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, "workspace changed");
  assert.equal(result.driftKind, "post_commit_changed");
  assert.equal(calls.some((args) => args[0] === "rebase"), false);
  assert.equal(calls.some((args) => args[0] === "push"), false);
});

test("createGitSyncGuard fingerprints status, tracked diffs, and untracked content", async () => {
  const calls = [];
  const guard = createGitSyncGuard({
    repo: REPO,
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      if (args.join(" ") === "rev-parse --verify HEAD") return { stdout: `${TEST_HEAD}\n`, stderr: "" };
      if (args[0] === "status") return { stdout: " M docs/changed.md\0?? assets/new.png\0", stderr: "" };
      if (args[0] === "diff") return { stdout: "binary patch", stderr: "" };
      if (args[0] === "hash-object") return { stdout: `${"b".repeat(40)}\n`, stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  const first = await guard.capture({
    changes: [
      { path: "docs/changed.md", status: "modified", rawStatus: " M" },
      { path: "assets/new.png", status: "untracked", rawStatus: "??" },
    ],
    files: ["docs/changed.md", "assets/new.png"],
  });
  const second = await guard.capture({
    changes: [
      { path: "docs/changed.md", status: "modified", rawStatus: " M" },
      { path: "assets/new.png", status: "untracked", rawStatus: "??" },
    ],
    files: ["docs/changed.md", "assets/new.png"],
  });

  assert.equal(first.head, TEST_HEAD);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(calls.some((args) => args[0] === "hash-object" && args.at(-1) === "assets/new.png"), true);
});

function expectedGitExit(code, stderr) {
  const error = new Error(stderr || `git exited with code ${code}`);
  error.code = code;
  error.stderr = stderr;
  return error;
}

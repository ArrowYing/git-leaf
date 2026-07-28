import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  ensureWorktreeBranch,
  generatedDetachedBranchName,
  gitCommonDirectory,
  listGitWorktrees,
  parseGitWorktreeList,
  worktreeDisplayName,
  worktreeDisplayPath,
} from "../src/server/git-worktrees.mjs";
import { createRepositoryInfo } from "../src/server/repositories.mjs";

const execFileAsync = promisify(execFile);

test("parseGitWorktreeList reads branches, detached heads, and worktree flags", () => {
  const payload = [
    "worktree /repo/docs", "HEAD 1234567890abcdef", "branch refs/heads/main", "",
    "worktree /tmp/docs-review", "HEAD abcdef1234567890", "detached", "locked verification", "",
  ].join("\0");

  assert.deepEqual(parseGitWorktreeList(payload), [
    {
      root: "/repo/docs",
      name: "docs",
      head: "1234567890abcdef",
      branch: "main",
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
    },
    {
      root: "/tmp/docs-review",
      name: "docs-review",
      head: "abcdef1234567890",
      branch: "",
      detached: true,
      bare: false,
      locked: true,
      prunable: false,
    },
  ]);
});

test("parseGitWorktreeList reads newline-delimited porcelain output from older Git", () => {
  const payload = [
    "worktree /repo/docs", "HEAD 1234567890abcdef", "branch refs/heads/main", "",
    "worktree /tmp/docs-review", "HEAD abcdef1234567890", "detached", "",
  ].join("\n");

  assert.deepEqual(parseGitWorktreeList(payload), [
    {
      root: "/repo/docs",
      name: "docs",
      head: "1234567890abcdef",
      branch: "main",
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
    },
    {
      root: "/tmp/docs-review",
      name: "docs-review",
      head: "abcdef1234567890",
      branch: "",
      detached: true,
      bare: false,
      locked: false,
      prunable: false,
    },
  ]);
});

test("listGitWorktrees falls back when older Git does not support -z", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-old-git-worktrees-"));
  const calls = [];
  const worktrees = await listGitWorktrees(root, {
    gitRunner: async (_repoRoot, args) => {
      calls.push(args);
      if (args.includes("-z")) {
        const error = new Error("Command failed: git worktree list --porcelain -z");
        error.code = 129;
        error.stderr = "error: unknown switch `z'\nusage: git worktree list [<options>]\n";
        throw error;
      }
      return {
        stdout: [
          `worktree ${root}`,
          "HEAD 1234567890abcdef",
          "branch refs/heads/main",
          "",
        ].join("\n"),
      };
    },
  });

  assert.deepEqual(calls, [
    ["worktree", "list", "--porcelain", "-z"],
    ["worktree", "list", "--porcelain"],
  ]);
  assert.equal(worktrees.length, 1);
  assert.equal(worktrees[0].root, await realpath(root));
  assert.equal(worktrees[0].branch, "main");
});

test("listGitWorktrees does not hide unrelated Git failures", async () => {
  const error = new Error("fatal: not a git repository");
  error.code = 128;
  error.stderr = "fatal: not a git repository\n";

  await assert.rejects(
    () => listGitWorktrees("/tmp/not-a-repo", {
      gitRunner: async () => {
        throw error;
      },
    }),
    (received) => received === error,
  );
});

test("listGitWorktrees does not retry a malformed invocation reported with exit 129", async () => {
  const error = new Error("usage: git worktree list [<options>]");
  error.code = 129;
  error.stderr = "usage: git worktree list [<options>]\n";
  let calls = 0;

  await assert.rejects(
    () => listGitWorktrees("/tmp/repo", {
      gitRunner: async () => {
        calls += 1;
        throw error;
      },
    }),
    (received) => received === error,
  );
  assert.equal(calls, 1);
});

test("listGitWorktrees rejects successful output that violates the porcelain contract", async () => {
  await assert.rejects(
    () => listGitWorktrees("/tmp/repo", {
      gitRunner: async () => ({ stdout: "unexpected output\n" }),
    }),
    (error) => error.externalCommandState === "invalid_output",
  );
});

test("gitCommonDirectory resolves legacy relative output without --path-format", async () => {
  const repoRoot = path.join(tmpdir(), "git-leaf-common-dir", "worktree");
  const calls = [];
  const commonDir = await gitCommonDirectory(repoRoot, {
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      return { stdout: "../main/.git\n" };
    },
  });

  assert.deepEqual(calls, [["rev-parse", "--git-common-dir"]]);
  assert.equal(commonDir, path.resolve(repoRoot, "../main/.git"));
});

test("gitCommonDirectory rejects empty successful output", async () => {
  await assert.rejects(
    () => gitCommonDirectory("/tmp/repo", {
      gitRunner: async () => ({ stdout: "\n" }),
    }),
    (error) => error.externalCommandState === "invalid_output",
  );
});

test("worktreeDisplayName keeps the path after a worktrees container", () => {
  assert.equal(
    worktreeDisplayName("/Users/maintainer/.codex/worktrees/e99c/company-docs"),
    "e99c/company-docs",
  );
  assert.equal(
    worktreeDisplayName("/repo/.claude/worktrees/brave-ramanujan-9f6dc1"),
    "brave-ramanujan-9f6dc1",
  );
  assert.equal(
    worktreeDisplayName("/repo/.worktrees/internal-mailer-html"),
    "internal-mailer-html",
  );
  assert.equal(
    worktreeDisplayName("C:\\Users\\example\\.codex\\worktrees\\e99c\\company-docs"),
    "e99c/company-docs",
  );
  assert.equal(worktreeDisplayName("/Users/maintainer/Projects/company-docs"), "company-docs");
});

test("worktreeDisplayPath abbreviates only paths inside the user home directory", () => {
  assert.equal(
    worktreeDisplayPath("/Users/maintainer/Projects/company-docs", "/Users/maintainer"),
    "~/Projects/company-docs",
  );
  assert.equal(
    worktreeDisplayPath("/private/tmp/company-docs", "/Users/maintainer"),
    "/private/tmp/company-docs",
  );
  assert.equal(
    worktreeDisplayPath("C:\\Users\\Example\\Projects\\company-docs", "c:\\users\\example"),
    "~/Projects/company-docs",
  );
});

test("listGitWorktrees marks worktree directories that no longer exist unavailable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-worktree-availability-"));
  const missingRoot = path.join(root, "removed-worktree");
  const payload = [
    `worktree ${root}`, "HEAD 1234567890abcdef", "branch refs/heads/main", "",
    `worktree ${missingRoot}`, "HEAD abcdef1234567890", "detached", "",
  ].join("\0");
  const worktrees = await listGitWorktrees(root, {
    gitRunner: async () => ({ stdout: payload }),
  });

  assert.equal(worktrees.find((worktree) => worktree.current)?.available, true);
  assert.equal(worktrees.find((worktree) => worktree.root === missingRoot)?.available, false);
});

test("linked worktrees are discovered and accepted as repository roots", async () => {
  const { repoRoot, detachedRoot } = await createRepoWithDetachedWorktree();
  const worktrees = await listGitWorktrees(detachedRoot);
  const canonicalDetachedRoot = await realpath(detachedRoot);
  const detached = worktrees.find((worktree) => worktree.root === canonicalDetachedRoot);
  const repository = await createRepositoryInfo({ repoRoot: detachedRoot });

  assert.equal(worktrees.length, 2);
  assert.equal(worktrees[0]?.primary, true);
  assert.equal(detached?.primary, false);
  assert.equal(detached?.detached, true);
  assert.equal(detached?.branch, "");
  assert.equal(repository.name, path.basename(repoRoot));
  assert.equal(repository.worktreeName, path.basename(detachedRoot));
  assert.equal(repository.detached, true);
  assert.equal(repository.branch, "");
  assert.equal(repository.worktreeId, detached?.id);
});

test("ensureWorktreeBranch creates a stable protection branch before detached edits", async () => {
  const { detachedRoot } = await createRepoWithDetachedWorktree();
  await writeFile(path.join(detachedRoot, "README.md"), "# Edited while detached\n");

  const result = await ensureWorktreeBranch(detachedRoot, {
    now: () => new Date("2026-07-10T14:32:05.000Z"),
  });
  const { stdout: branchOutput } = await execFileAsync("git", ["branch", "--show-current"], {
    cwd: detachedRoot,
  });

  assert.equal(result.created, true);
  assert.equal(result.branch, `git-leaf/detached-${result.head.slice(0, 7)}-20260710-143205`);
  assert.equal(branchOutput.trim(), result.branch);
  assert.equal(await readFile(path.join(detachedRoot, "README.md"), "utf8"), "# Edited while detached\n");
});

test("ensureWorktreeBranch leaves an attached worktree unchanged", async () => {
  const { repoRoot } = await createRepoWithDetachedWorktree();
  assert.deepEqual(await ensureWorktreeBranch(repoRoot), {
    branch: "main",
    created: false,
  });
});

test("ensureWorktreeBranch does not mistake a dependency failure for an available branch name", async () => {
  const calls = [];
  await assert.rejects(
    () => ensureWorktreeBranch("/repo", {
      gitRunner: async (_cwd, args) => {
        calls.push(args);
        if (args[0] === "branch") return { stdout: "", stderr: "" };
        if (args[0] === "rev-parse") return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
        const error = new Error("spawn git ENOENT");
        error.code = "ENOENT";
        throw error;
      },
    }),
    /spawn git ENOENT/,
  );
  assert.equal(calls.some((args) => args[0] === "switch"), false);
});

test("generatedDetachedBranchName is readable and commit-specific", () => {
  assert.equal(
    generatedDetachedBranchName("1234567890abcdef", new Date("2026-07-10T14:32:05.000Z")),
    "git-leaf/detached-1234567-20260710-143205",
  );
});

async function createRepoWithDetachedWorktree() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-worktrees-"));
  const repoRoot = path.join(rootDir, "docs-repo");
  const detachedRoot = path.join(rootDir, "docs-review");
  await mkdir(repoRoot, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.name", "Git Leaf Tests"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "git-leaf@example.test"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "# Docs\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-m", "Initial"], { cwd: repoRoot });
  await execFileAsync("git", ["worktree", "add", "--detach", detachedRoot, "HEAD"], { cwd: repoRoot });
  return { repoRoot, detachedRoot };
}

import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  ExternalCommandOutputError,
  externalCommandState,
  isExternalCommandExit,
  runExternalCommand,
} from "./external-command.mjs";

export async function listGitWorktrees(repoRoot, { gitRunner = runGit } = {}) {
  const { stdout } = await runGitWorktreeList(repoRoot, gitRunner);
  const parsedWorktrees = parseGitWorktreeList(stdout);
  if (parsedWorktrees.length === 0) {
    throw new ExternalCommandOutputError(
      "git",
      ["worktree", "list", "--porcelain"],
      "output without a worktree record",
    );
  }
  const currentRoot = await canonicalPath(repoRoot);
  return Promise.all(parsedWorktrees.map(async (worktree, index) => {
    const root = await canonicalPath(worktree.root);
    return {
      ...worktree,
      root,
      name: worktreeDisplayName(root),
      primary: index === 0,
      current: root === currentRoot,
      id: worktreeIdForPath(root),
      available: await worktreeDirectoryAvailable(root) && !worktree.bare && !worktree.prunable,
    };
  }));
}

export function parseGitWorktreeList(output) {
  return worktreeListRecords(output)
    .filter((fields) => fields.length > 0)
    .map(worktreeFromFields)
    .filter((worktree) => worktree.root);
}

export function worktreeIdForPath(worktreeRoot) {
  return createHash("sha256")
    .update(path.resolve(worktreeRoot))
    .digest("hex")
    .slice(0, 16);
}

export function worktreeDisplayName(worktreeRoot) {
  const segments = String(worktreeRoot ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
  const containerIndex = segments.findLastIndex(
    (segment) => segment === "worktrees" || segment === ".worktrees",
  );
  const relativeSegments = containerIndex >= 0
    ? segments.slice(containerIndex + 1)
    : segments.slice(-1);
  return relativeSegments.join("/");
}

export function worktreeDisplayPath(worktreeRoot, homeDirectory = homedir()) {
  const root = normalizedDisplayPath(worktreeRoot);
  const home = normalizedDisplayPath(homeDirectory).replace(/\/+$/, "");
  if (!root || !home) {
    return root;
  }

  const caseInsensitive = /^[A-Za-z]:\//.test(root);
  const comparableRoot = caseInsensitive ? root.toLowerCase() : root;
  const comparableHome = caseInsensitive ? home.toLowerCase() : home;
  if (comparableRoot === comparableHome) {
    return "~";
  }
  if (comparableRoot.startsWith(`${comparableHome}/`)) {
    return `~${root.slice(home.length)}`;
  }
  return root;
}

export async function gitCommonDirectory(repoRoot, { gitRunner = runGit } = {}) {
  const { stdout } = await gitRunner(repoRoot, ["rev-parse", "--git-common-dir"]);
  const commonDirectory = String(stdout ?? "").trim();
  if (!commonDirectory || /[\r\n\0]/.test(commonDirectory)) {
    throw new ExternalCommandOutputError(
      "git",
      ["rev-parse", "--git-common-dir"],
      "an invalid Git common directory",
    );
  }
  return path.resolve(repoRoot, commonDirectory);
}

export async function ensureWorktreeBranch(
  repoRoot,
  { gitRunner = runGit, now = () => new Date() } = {},
) {
  const branch = await currentWorktreeBranch(repoRoot, { gitRunner });
  if (branch) {
    return { branch, created: false };
  }

  const { stdout } = await gitRunner(repoRoot, ["rev-parse", "HEAD"]);
  const head = stdout.trim();
  const baseName = generatedDetachedBranchName(head, now());
  const branchName = await availableBranchName(repoRoot, baseName, gitRunner);
  await gitRunner(repoRoot, ["switch", "-c", branchName]);
  return { branch: branchName, created: true, head };
}

export async function currentWorktreeBranch(repoRoot, { gitRunner = runGit } = {}) {
  const { stdout } = await gitRunner(repoRoot, ["branch", "--show-current"]);
  return stdout.trim();
}

export function generatedDetachedBranchName(head, date = new Date()) {
  const timestamp = date.toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace(/\.\d{3}Z$/, "");
  return `git-leaf/detached-${String(head || "unknown").slice(0, 7)}-${timestamp}`;
}

function worktreeFromFields(fields) {
  const worktree = {
    root: "",
    name: "",
    head: "",
    branch: "",
    detached: false,
    bare: false,
    locked: false,
    prunable: false,
  };

  for (const field of fields) {
    const separator = field.indexOf(" ");
    const key = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? "" : field.slice(separator + 1);
    if (key === "worktree") {
      worktree.root = value;
      worktree.name = worktreeDisplayName(value);
    } else if (key === "HEAD") {
      worktree.head = value;
    } else if (key === "branch") {
      worktree.branch = value.replace(/^refs\/heads\//, "");
    } else if (key === "detached") {
      worktree.detached = true;
    } else if (key === "bare") {
      worktree.bare = true;
    } else if (key === "locked") {
      worktree.locked = true;
    } else if (key === "prunable") {
      worktree.prunable = true;
    }
  }

  worktree.detached = worktree.detached || !worktree.branch;
  return worktree;
}

async function runGitWorktreeList(repoRoot, gitRunner) {
  try {
    return await gitRunner(repoRoot, ["worktree", "list", "--porcelain", "-z"]);
  } catch (error) {
    if (!worktreeListNullTerminationUnsupported(error)) {
      throw error;
    }
    return gitRunner(repoRoot, ["worktree", "list", "--porcelain"]);
  }
}

function worktreeListNullTerminationUnsupported(error) {
  return externalCommandState(error) === "unsupported";
}

function worktreeListRecords(output) {
  const value = String(output ?? "");
  if (!value) {
    return [];
  }
  if (value.includes("\0")) {
    return value
      .split("\0\0")
      .map((record) => record.split("\0").filter(Boolean));
  }
  return value
    .trimEnd()
    .split(/\r?\n\r?\n+/)
    .map((record) => record.split(/\r?\n/).filter(Boolean));
}

async function availableBranchName(repoRoot, baseName, gitRunner) {
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = suffix === 1 ? baseName : `${baseName}-${suffix}`;
    try {
      await gitRunner(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    } catch (error) {
      if (isExternalCommandExit(error, 1)) {
        return candidate;
      }
      throw error;
    }
  }
  throw new Error("Could not allocate a Git Leaf protection branch name.");
}

function runGit(cwd, args) {
  return runExternalCommand("git", args, { cwd });
}

async function canonicalPath(value) {
  try {
    return await realpath(value);
  } catch {
    return path.resolve(value);
  }
}

function normalizedDisplayPath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

async function worktreeDirectoryAvailable(worktreeRoot) {
  try {
    return (await stat(worktreeRoot)).isDirectory();
  } catch {
    return false;
  }
}

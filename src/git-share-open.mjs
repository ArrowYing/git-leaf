import { runGitCommand } from "./git-sync.mjs";
import { listGitWorktrees } from "./git-worktrees.mjs";
import { externalCommandState, isExternalCommandExit } from "./external-command.mjs";

export async function sharedMainWorktree(repoRoot, { readWorktrees = listGitWorktrees } = {}) {
  const worktrees = await readWorktrees(repoRoot);
  const primary = worktrees.find((worktree) => worktree.primary && worktree.available !== false);
  if (!primary) {
    return { ok: false, state: "primary_missing", worktrees };
  }
  if (primary.branch !== "main") {
    return {
      ok: false,
      state: "primary_not_main",
      branch: primary.branch || "detached",
      primary,
      worktrees,
    };
  }
  return { ok: true, state: "ready", primary, worktrees };
}

export async function inspectSharedMain({
  repoRoot,
  file,
  rev,
  fetchRemote = true,
  gitRunner = runGitCommand,
} = {}) {
  if (fetchRemote) {
    try {
      await gitRunner(repoRoot, ["fetch", "origin", "main"]);
    } catch (error) {
      return {
        ok: false,
        state: "fetch_failed",
        commandState: externalCommandState(error),
        error: commandError(error),
      };
    }
  }

  if (!await isAncestor(repoRoot, rev, "refs/remotes/origin/main", gitRunner)) {
    return { ok: false, state: "revision_missing" };
  }

  const [headResult, remoteResult, dirtyPaths] = await Promise.all([
    gitRunner(repoRoot, ["rev-parse", "HEAD"]),
    gitRunner(repoRoot, ["rev-parse", "refs/remotes/origin/main"]),
    changedPaths(repoRoot, gitRunner),
  ]);
  const head = headResult.stdout.trim();
  const remoteHead = remoteResult.stdout.trim();
  const targetDirty = dirtyPaths.includes(normalizeGitPath(file));

  if (head === remoteHead) {
    if (!targetDirty) {
      return { ok: true, state: "ready", head, remoteHead, dirtyPaths };
    }
    return syncState({ head, remoteHead, dirtyPaths, targetDirty });
  }

  const [headBehind, remoteBehind] = await Promise.all([
    isAncestor(repoRoot, head, "refs/remotes/origin/main", gitRunner),
    isAncestor(repoRoot, remoteHead, "HEAD", gitRunner),
  ]);
  if (!headBehind) {
    return {
      ok: false,
      state: remoteBehind ? "ahead" : "diverged",
      head,
      remoteHead,
      dirtyPaths,
    };
  }

  const incomingPaths = await diffPaths(
    repoRoot,
    ["diff", "--name-only", "-z", "HEAD..refs/remotes/origin/main"],
    gitRunner,
  );
  if (dirtyPaths.length === 0) {
    return { ok: true, state: "behind_clean", head, remoteHead, dirtyPaths, incomingPaths };
  }

  const incoming = new Set(incomingPaths);
  const overlappingPaths = dirtyPaths.filter((candidate) => incoming.has(candidate));
  if (overlappingPaths.length === 0 && !targetDirty) {
    return {
      ok: true,
      state: "behind_dirty_disjoint",
      head,
      remoteHead,
      dirtyPaths,
      incomingPaths,
    };
  }

  return syncState({
    head,
    remoteHead,
    dirtyPaths,
    incomingPaths,
    overlappingPaths,
    targetDirty,
  });
}

export async function fastForwardSharedMain(repoRoot, { gitRunner = runGitCommand } = {}) {
  await gitRunner(repoRoot, ["merge", "--ff-only", "refs/remotes/origin/main"]);
}

export async function changedPaths(repoRoot, gitRunner = runGitCommand) {
  const [unstaged, staged, untracked] = await Promise.all([
    diffPaths(repoRoot, ["diff", "--name-only", "-z"], gitRunner),
    diffPaths(repoRoot, ["diff", "--cached", "--name-only", "-z"], gitRunner),
    diffPaths(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"], gitRunner),
  ]);
  return [...new Set([...unstaged, ...staged, ...untracked])].sort();
}

async function diffPaths(repoRoot, args, gitRunner) {
  const result = await gitRunner(repoRoot, args);
  return String(result.stdout ?? "")
    .split("\0")
    .map(normalizeGitPath)
    .filter(Boolean);
}

async function isAncestor(repoRoot, ancestor, descendant, gitRunner) {
  if (!ancestor || !descendant) {
    return false;
  }
  try {
    await gitRunner(repoRoot, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (isExternalCommandExit(error, 1)) {
      return false;
    }
    throw error;
  }
}

function syncState(state) {
  return { ok: true, state: "sync_required", ...state };
}

function normalizeGitPath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/");
}

function commandError(error) {
  return String(error?.stderr || error?.stdout || error?.message || error || "Git fetch failed").trim();
}

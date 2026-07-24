import { runGitCommand } from "./git-sync.mjs";
import { listGitWorktrees } from "./git-worktrees.mjs";
import { externalCommandState, isExternalCommandExit } from "./external-command.mjs";

const TRANSIENT_FETCH_STATES = new Set(["network_unavailable", "interrupted"]);
const DEFAULT_FETCH_RETRY_DELAY_MS = 500;

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
  fetchRetryDelayMs = DEFAULT_FETCH_RETRY_DELAY_MS,
  wait = waitFor,
} = {}) {
  if (fetchRemote) {
    const fetchFailure = await fetchSharedMain(repoRoot, {
      gitRunner,
      fetchRetryDelayMs,
      wait,
    });
    if (fetchFailure) return fetchFailure;
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

export async function inspectSharedMainWithFetchRecovery({
  inspect = inspectSharedMain,
  promptFetchRetry,
  ...options
} = {}) {
  let state = await inspect(options);
  while (state?.state === "fetch_failed" && typeof promptFetchRetry === "function") {
    if (!await promptFetchRetry(state)) return state;
    state = await inspect(options);
  }
  return state;
}

export function sharedFetchFailurePrompt(state = {}) {
  const commandState = String(state.commandState ?? "failed");
  const guidance = fetchFailureGuidance(commandState);
  const technicalInformation = state.error
    ? `技术信息：${String(state.error).slice(0, 240)}`
    : "";
  return {
    type: "warning",
    message: guidance.message,
    detail: [
      guidance.summary,
      guidance.action,
      "本地仓库没有被修改。",
      technicalInformation,
    ].filter(Boolean).join("\n"),
    buttons: [
      commandState === "authentication_required" ? "重新检查" : "重新尝试",
      "暂不打开",
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
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

async function fetchSharedMain(repoRoot, {
  gitRunner,
  fetchRetryDelayMs,
  wait,
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await gitRunner(repoRoot, ["fetch", "origin", "main"]);
      return null;
    } catch (error) {
      const commandState = externalCommandState(error);
      const retryable = attempt === 0 && TRANSIENT_FETCH_STATES.has(commandState);
      if (retryable) {
        await wait(fetchRetryDelayMs);
        continue;
      }
      return {
        ok: false,
        state: "fetch_failed",
        commandState,
        error: commandError(error),
      };
    }
  }
  return null;
}

function fetchFailureGuidance(state) {
  if (state === "network_unavailable") {
    return {
      message: "暂时无法连接 GitHub",
      summary: "Git Leaf 已自动重试，但仍无法获取最新 main。",
      action: "请检查网络、代理或 GitHub 连接状态，然后在这里重新尝试。",
    };
  }
  if (state === "authentication_required") {
    return {
      message: "Git 凭据需要重新登录",
      summary: "Git Leaf 无法使用当前仓库的 Git 凭据访问远端。",
      action: "请重新登录当前仓库使用的 Git 凭据，然后回到这里重新检查。",
    };
  }
  if (state === "unavailable") {
    return {
      message: "本机 Git 暂不可用",
      summary: "Git Leaf 找不到本机 Git 命令，无法获取最新 main。",
      action: "请确认 Git 已安装并可供桌面应用使用，然后重新尝试。",
    };
  }
  if (state === "permission_denied") {
    return {
      message: "Git 访问被系统拒绝",
      summary: "Git Leaf 没有权限运行 Git 或读取主工作区。",
      action: "请检查 Git 和仓库目录的访问权限，然后重新尝试。",
    };
  }
  if (state === "invalid_context") {
    return {
      message: "主工作区已经不可用",
      summary: "Git Leaf 无法在原主工作区中获取最新 main。",
      action: "请确认仓库目录仍然存在并且仍是 Git 工作区，然后重新尝试。",
    };
  }
  if (state === "interrupted") {
    return {
      message: "获取最新 main 被中断",
      summary: "Git Leaf 已自动重试，但 Git 操作仍在完成前被中断。",
      action: "请确认没有系统任务终止 Git，然后在这里重新尝试。",
    };
  }
  return {
    message: "无法获取最新 main",
    summary: "Git Leaf 获取远端 main 时遇到问题。",
    action: "请检查远端地址和技术信息，然后在这里重新尝试。",
  };
}

function normalizeGitPath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/");
}

function commandError(error) {
  return String(error?.stderr || error?.stdout || error?.message || error || "Git fetch failed").trim();
}

function waitFor(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

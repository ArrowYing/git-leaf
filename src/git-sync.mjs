import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";

import {
  ExternalCommandOutputError,
  externalCommandOutput,
  externalCommandState,
  isExternalCommandExit,
  runExternalCommand,
} from "./external-command.mjs";

const IN_PROGRESS_GIT_REFS = new Map([
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
]);

const REBASE_STATE_PATHS = ["rebase-merge", "rebase-apply"];

export function repositoryChangesFromPorcelain(output) {
  const records = String(output ?? "").split("\0");
  const changes = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) {
      continue;
    }
    const rawStatus = record.slice(0, 2);
    const filePath = normalizeGitPath(record.slice(3));
    if (!filePath) {
      continue;
    }
    const renamed = rawStatus.includes("R") || rawStatus.includes("C");
    const oldPath = renamed ? normalizeGitPath(records[index += 1]) : "";
    changes.push({
      path: filePath,
      ...(oldPath ? { oldPath } : {}),
      status: statusLabel(rawStatus),
      rawStatus,
    });
  }
  return changes;
}

export async function gitStatusPayload({ repo, gitRunner = runGitCommand }) {
  const result = await gitRunner(repo.root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return {
    repo: repo.id,
    branch: repo.branch,
    changes: repositoryChangesFromPorcelain(result.stdout),
  };
}

export async function syncSelectedFiles({
  repo,
  files,
  note = "",
  allChanges = false,
  gitRunner = runGitCommand,
  syncGuard: providedSyncGuard = null,
  operationPathExists = gitOperationPathExists,
}) {
  let selectedFiles = normalizeSelectedFiles(files);
  if (!allChanges && selectedFiles.length === 0) {
    return {
      ok: false,
      step: "validate",
      error: "请选择需要同步的文件。",
      agentPrompt: "",
    };
  }

  const context = {
    repo,
    files: selectedFiles,
    note: String(note ?? "").trim(),
  };
  const syncGuard = providedSyncGuard ?? createGitSyncGuard({ repo, gitRunner });
  let retryCount = 0;
  let driftKind = "none";

  try {
    await preflightGitSync(context, gitRunner, operationPathExists);
    const hasUpstream = await hasUpstreamBranch(context, gitRunner);
    let changes = [];
    let changesByPath = new Map();
    let remoteBehind = 0;

    for (;;) {
      const status = await runStep(context, "status", gitRunner, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]);
      changes = repositoryChangesFromPorcelain(status.stdout);
      if (allChanges) {
        selectedFiles = changes.map((change) => change.path);
        context.files = selectedFiles;
      }
      if (selectedFiles.length === 0) {
        return failurePayload({
          ...context,
          step: "validate",
          error: "当前没有需要同步的本地文件改动。",
          retryCount,
          driftKind,
        });
      }

      changesByPath = new Map(changes.map((change) => [change.path, change]));
      const changedFiles = new Set(changes.map((change) => change.path));
      const unchangedFiles = selectedFiles.filter((file) => !changedFiles.has(file));
      if (unchangedFiles.length > 0) {
        return failurePayload({
          ...context,
          step: "validate",
          error: `选中文件没有本地改动：${unchangedFiles.join(", ")}`,
          retryCount,
          driftKind,
        });
      }

      const baseline = await syncGuard.capture({ changes, files: selectedFiles });
      remoteBehind = 0;
      if (hasUpstream) {
        await runStep(context, "fetch", gitRunner, ["fetch", "origin", repo.branch]);
        const comparison = await runStep(context, "compare remote", gitRunner, [
          "rev-list",
          "--left-right",
          "--count",
          `HEAD...refs/remotes/origin/${repo.branch}`,
        ]);
        const remoteCounts = remoteCommitCounts(comparison.stdout);
        remoteBehind = remoteCounts.behind;
        if (remoteCounts.ahead > 0 && remoteCounts.behind > 0) {
          return failurePayload({
            ...context,
            step: "compare remote",
            error: "当前分支与远端已经分叉。为避免自动改写本地提交，请交给 AI Agent 处理后再同步。",
            retryCount,
            driftKind,
          });
        }
        const unselectedChanges = changes.filter((change) => !selectedFiles.includes(change.path));
        if (remoteBehind > 0 && unselectedChanges.length > 0) {
          return failurePayload({
            ...context,
            step: "validate",
            error: [
              "远端分支已有新提交，但当前仍有未勾选的本地改动。",
              "为避免自动更新时影响这些文件，请勾选全部改动后重试，或先处理未勾选文件：",
              ...unselectedChanges.map((change) => `- ${change.path}`),
            ].join("\n"),
            retryCount,
            driftKind,
          });
        }
      }

      const current = await syncGuard.capture({ changes, files: selectedFiles });
      const detectedDrift = syncStateDriftKind(baseline, current);
      if (detectedDrift === "none") {
        break;
      }
      driftKind = detectedDrift;
      if (retryCount >= 1) {
        return failurePayload({
          ...context,
          step: "workspace changed",
          error: "同步准备期间内容仍在变化。Git Leaf 没有提交当前改动，请稍后重新同步。",
          retryCount,
          driftKind,
        });
      }
      retryCount += 1;
    }

    const stagePaths = selectedFiles.flatMap((file) => {
      const change = changesByPath.get(file);
      return change?.oldPath ? [file, change.oldPath] : [file];
    });
    await runStep(context, "add", gitRunner, ["add", "-A", "--", ...stagePaths]);
    const staged = await runStep(context, "diff staged", gitRunner, [
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--",
      ...stagePaths,
    ]);
    if (!staged.stdout.trim()) {
      return failurePayload({
        ...context,
        step: "diff staged",
        error: "选中文件没有可提交的 staged 改动。",
        retryCount,
        driftKind,
      });
    }

    const commitMessage = commitMessageForContext(context);
    const commitArgs = [
      "commit",
      "-m",
      commitMessage.subject,
      "-m",
      commitMessage.body,
      ...(allChanges ? [] : ["--", ...stagePaths]),
    ];
    await runStep(context, "commit", gitRunner, commitArgs);
    let publishHead = await syncGuard.currentHead();
    const worktreeClean = await syncGuard.isWorktreeClean();
    if (!worktreeClean) {
      driftKind = "post_commit_changed";
      if (hasUpstream && remoteBehind > 0) {
        return failurePayload({
          ...context,
          step: "workspace changed",
          error: "提交后工作区出现了新的修改。Git Leaf 已保留本地提交和新修改，但没有执行 rebase 或 push，请交给 AI Agent 继续处理。",
          retryCount,
          driftKind,
        });
      }
    }
    if (hasUpstream && remoteBehind > 0) {
      try {
        await runStep(context, "rebase remote", gitRunner, [
          "rebase",
          `refs/remotes/origin/${repo.branch}`,
        ]);
      } catch (error) {
        try {
          await gitRunner(repo.root, ["rebase", "--abort"]);
          error.gitLeafRecovery = "Git Leaf 已自动退出失败的 rebase，本地提交和文件已恢复。";
        } catch {
          error.gitLeafRecovery = "Git Leaf 无法自动退出 rebase；请不要继续同步，直接交给 AI Agent 处理。";
        }
        throw error;
      }
      publishHead = await syncGuard.currentHead();
    }
    if (await syncGuard.currentHead() !== publishHead) {
      return failurePayload({
        ...context,
        step: "head changed",
        error: "同步期间当前分支出现了新的提交。Git Leaf 没有继续推送，请交给 AI Agent 检查分支状态。",
        retryCount,
        driftKind: "head_changed",
      });
    }
    const pushRefspec = `${publishHead}:refs/heads/${repo.branch}`;
    if (hasUpstream) {
      await runStep(context, "push", gitRunner, ["push", "origin", pushRefspec]);
    } else {
      await runStep(context, "push", gitRunner, ["push", "origin", pushRefspec]);
      await runStep(context, "set upstream", gitRunner, [
        "update-ref",
        `refs/remotes/origin/${repo.branch}`,
        publishHead,
      ]);
      await runStep(context, "set upstream", gitRunner, [
        "branch",
        `--set-upstream-to=origin/${repo.branch}`,
        "--",
        repo.branch,
      ]);
    }

    return {
      ok: true,
      repo: repo.id,
      branch: repo.branch,
      files: selectedFiles,
      retryCount,
      driftKind,
      remainingChanges: !worktreeClean,
    };
  } catch (error) {
    return failurePayload({
      ...context,
      step: error.step ?? "git",
      error: commandErrorText(error),
      retryCount,
      driftKind,
    });
  }
}

export function createGitSyncGuard({ repo, gitRunner = runGitCommand }) {
  return {
    async capture({ changes = [], files = [] } = {}) {
      const normalizedFiles = normalizeSelectedFiles(files);
      const paths = normalizedFiles.flatMap((file) => {
        const change = changes.find((candidate) => candidate.path === file);
        return change?.oldPath ? [file, change.oldPath] : [file];
      });
      const head = await readCurrentHead(repo, gitRunner);
      const status = await gitRunner(repo.root, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        ...paths,
      ]);
      const diff = await gitRunner(repo.root, [
        "diff",
        "--binary",
        "--no-ext-diff",
        "HEAD",
        "--",
        ...paths,
      ]);
      const untracked = repositoryChangesFromPorcelain(status.stdout)
        .filter((change) => change.status === "untracked")
        .map((change) => change.path)
        .sort();
      const untrackedHashes = [];
      for (const file of untracked) {
        const result = await gitRunner(repo.root, ["hash-object", "--no-filters", "--", file]);
        untrackedHashes.push(`${file}\0${String(result.stdout ?? "").trim()}`);
      }
      const fingerprint = createHash("sha256")
        .update(String(status.stdout ?? ""))
        .update("\0")
        .update(String(diff.stdout ?? ""))
        .update("\0")
        .update(untrackedHashes.join("\0"))
        .digest("hex");
      return { head, fingerprint };
    },
    async currentHead() {
      return readCurrentHead(repo, gitRunner);
    },
    async isWorktreeClean() {
      const result = await gitRunner(repo.root, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]);
      return String(result.stdout ?? "") === "";
    },
  };
}

export function syncStateDriftKind(baseline, current) {
  if (baseline?.head !== current?.head) {
    return "head_changed";
  }
  if (baseline?.fingerprint !== current?.fingerprint) {
    return "content_changed";
  }
  return "none";
}

async function readCurrentHead(repo, gitRunner) {
  const result = await gitRunner(repo.root, ["rev-parse", "--verify", "HEAD"]);
  const head = String(result.stdout ?? "").trim();
  if (!/^[0-9a-f]{40,64}$/i.test(head)) {
    const error = new ExternalCommandOutputError("git", ["rev-parse", "--verify", "HEAD"], "an invalid commit id");
    error.step = "sync guard";
    throw error;
  }
  return head;
}

async function preflightGitSync(context, gitRunner, operationPathExists) {
  const name = await requiredGitValue(
    context,
    gitRunner,
    ["config", "--get", "user.name"],
    "Git user.name is not configured. Run `git config --global user.name \"Your Name\"` before syncing.",
  );
  const email = await requiredGitValue(
    context,
    gitRunner,
    ["config", "--get", "user.email"],
    "Git user.email is not configured. Run `git config --global user.email \"you@example.com\"` before syncing.",
  );
  const origin = await requiredGitValue(
    context,
    gitRunner,
    ["remote", "get-url", "origin"],
    "Git remote `origin` is not configured. Clone the repository from GitHub or add an origin remote before syncing.",
  );

  await assertNoGitOperationInProgress(context, gitRunner, operationPathExists);

  return { name, email, origin };
}

async function assertNoGitOperationInProgress(context, gitRunner, operationPathExists) {
  const conflicts = await runStep(context, "preflight", gitRunner, [
    "ls-files",
    "--unmerged",
    "-z",
  ]);
  if (String(conflicts.stdout ?? "").split("\0").some(Boolean)) {
    const error = new Error("仓库存在尚未解决的冲突，请先交给 AI Agent 处理。");
    error.step = "preflight";
    throw error;
  }

  const activeOperations = [];
  for (const [gitRef, label] of IN_PROGRESS_GIT_REFS) {
    try {
      const result = await gitRunner(context.repo.root, ["rev-parse", "-q", "--verify", gitRef]);
      if (String(result.stdout ?? "").trim()) {
        activeOperations.push(label);
      }
    } catch (error) {
      if (!isExternalCommandExit(error, 1)) {
        error.step = "preflight";
        throw error;
      }
      // Exit 1 means the operation ref does not exist, which is the normal state.
    }
  }
  for (const stateName of REBASE_STATE_PATHS) {
    let result;
    try {
      result = await gitRunner(context.repo.root, ["rev-parse", "--git-path", stateName]);
    } catch (error) {
      error.step = "preflight";
      throw error;
    }
    const statePath = String(result.stdout ?? "").trim();
    const resolvedStatePath = path.isAbsolute(statePath)
      ? statePath
      : path.resolve(context.repo.root, statePath);
    if (statePath) {
      try {
        if (await operationPathExists(resolvedStatePath)) {
          activeOperations.push("rebase");
          break;
        }
      } catch (error) {
        error.step = "preflight";
        throw error;
      }
    }
  }
  if (activeOperations.length > 0) {
    const error = new Error(`仓库正在进行 ${activeOperations.join(" / ")}，请先完成或取消该操作。`);
    error.step = "preflight";
    throw error;
  }
}

async function gitOperationPathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function hasUpstreamBranch(context, gitRunner) {
  try {
    const result = await gitRunner(context.repo.root, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    return Boolean(String(result.stdout ?? "").trim());
  } catch (error) {
    if (gitCommandReportsMissingUpstream(error)) {
      return false;
    }
    error.step = "preflight";
    throw error;
  }
}

function remoteCommitCounts(output) {
  const value = String(output ?? "").trim();
  if (!/^\d+\s+\d+$/.test(value)) {
    const error = new ExternalCommandOutputError(
      "git",
      ["rev-list", "--left-right", "--count"],
      "invalid ahead and behind counts",
    );
    error.step = "compare remote";
    throw error;
  }
  const [ahead, behind] = value.split(/\s+/);
  return {
    ahead: Number.parseInt(ahead, 10),
    behind: Number.parseInt(behind, 10),
  };
}

async function requiredGitValue(context, gitRunner, args, message) {
  let result;
  try {
    result = await gitRunner(context.repo.root, args);
  } catch (error) {
    if (!gitCommandReportsMissingRequiredValue(error, args)) {
      error.step = "preflight";
      throw error;
    }
    const missingValue = new Error(message, { cause: error });
    missingValue.step = "preflight";
    missingValue.stderr = message;
    throw missingValue;
  }

  const value = String(result.stdout ?? "").trim();
  if (!value) {
    const error = new Error(message);
    error.step = "preflight";
    error.stderr = message;
    throw error;
  }
  return value;
}

async function runStep(context, step, gitRunner, args) {
  try {
    return await gitRunner(context.repo.root, args);
  } catch (error) {
    error.step = step;
    throw error;
  }
}

function failurePayload({ repo, files, step, error, retryCount = 0, driftKind = "none" }) {
  const errorText = String(error || "未知 Git 错误").trim();
  return {
    ok: false,
    repo: repo.id,
    branch: repo.branch,
    files,
    step,
    error: errorText,
    retryCount,
    driftKind,
    agentPrompt: buildGitSyncAgentPrompt({
      repo,
      files,
      step,
      error: errorText,
    }),
  };
}

function buildGitSyncAgentPrompt({ repo, files, step, error }) {
  return [
    "请处理 Git Leaf 同步失败：",
    "",
    `仓库：${repo.id}`,
    `仓库路径：${repo.root}`,
    `当前分支：${repo.branch}`,
    "选中文件：",
    ...files.map((file) => `- ${file}`),
    "",
    `失败步骤：${step}`,
    "错误输出：",
    error || "无错误输出",
    "",
    "目标：",
    "1. 保留 Git Leaf 用户对上述文件的修改。",
    "2. 处理当前 Git 状态、检查失败或冲突。",
    `3. 完成必要检查后，提交并推送当前分支 ${repo.branch}。`,
  ].join("\n");
}

function commitMessageForContext({ files, note }) {
  const noteLines = String(note ?? "").split(/\r?\n/);
  const firstLine = noteLines.shift()?.trim() ?? "";
  const subject = firstLine ? firstLine.slice(0, 72) : "Sync Git Leaf files";
  const bodyParts = [];
  if (firstLine.length > subject.length) {
    bodyParts.push(firstLine);
  }
  const remainingNote = noteLines.join("\n").trim();
  if (remainingNote) {
    bodyParts.push(remainingNote);
  }
  bodyParts.push(["Files:", ...files.map((file) => `- ${file}`)].join("\n"));
  return {
    subject,
    body: bodyParts.join("\n\n"),
  };
}

function normalizeSelectedFiles(files) {
  if (!Array.isArray(files)) {
    return [];
  }
  const seen = new Set();
  const selected = [];
  for (const file of files) {
    const normalized = normalizeGitPath(String(file ?? ""));
    if (
      normalized &&
      !normalized.startsWith("../") &&
      !normalized.startsWith("/") &&
      !normalized.split("/").includes("..") &&
      !normalized.startsWith(".git/") &&
      !seen.has(normalized)
    ) {
      seen.add(normalized);
      selected.push(normalized);
    }
  }
  return selected;
}

function normalizeGitPath(filePath) {
  return String(filePath ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "");
}

function statusLabel(rawStatus) {
  if (rawStatus === "??") {
    return "untracked";
  }
  if (rawStatus.includes("D")) {
    return "deleted";
  }
  if (rawStatus.includes("A")) {
    return "added";
  }
  if (rawStatus.includes("R")) {
    return "renamed";
  }
  if (rawStatus.includes("C")) {
    return "copied";
  }
  return "modified";
}

function commandErrorText(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const recovery = typeof error?.gitLeafRecovery === "string" ? error.gitLeafRecovery.trim() : "";
  const state = externalCommandState(error);
  const stateMessage = commandStateMessage(state);
  return [stateMessage, stderr, stdout, message, recovery].filter(Boolean).join("\n");
}

function gitCommandReportsMissingUpstream(error) {
  return isExternalCommandExit(error, 128)
    && /no upstream configured|no upstream branch/i.test(externalCommandOutput(error));
}

function gitCommandReportsMissingRequiredValue(error, args) {
  if (args[0] === "config" && args[1] === "--get") {
    return isExternalCommandExit(error, 1);
  }
  if (args[0] === "remote" && args[1] === "get-url") {
    return isExternalCommandExit(error, 2, 128)
      && /no such remote/i.test(externalCommandOutput(error));
  }
  return false;
}

function commandStateMessage(state) {
  if (state === "unavailable") return "未检测到 Git 命令，当前同步已停止。";
  if (state === "permission_denied") return "Git 命令或仓库访问被拒绝，当前同步已停止。";
  if (state === "unsupported") return "本机 Git 不支持当前同步所需的命令能力。";
  if (state === "invalid_context") return "当前目录已经不是可用的 Git 工作区。";
  if (state === "authentication_required") return "Git 身份验证未通过，当前同步已停止。";
  if (state === "network_unavailable") return "网络或 Git 远端暂时不可用，当前同步已停止。";
  if (state === "interrupted") return "Git 命令在完成前被中断，当前同步已停止。";
  if (state === "invalid_output") return "Git 返回了 Git Leaf 无法识别的结果，当前同步已停止。";
  return "";
}

export function runGitCommand(cwd, args) {
  return runExternalCommand("git", args, { cwd });
}

import path from "node:path";
import process from "node:process";

import {
  ExternalCommandOutputError,
  externalCommandState,
  runExternalCommand,
} from "./external-command.mjs";

export class GitUnavailableError extends Error {
  constructor(message, { state = "unavailable", ...options } = {}) {
    super(message, options);
    this.name = "GitUnavailableError";
    this.code = "GIT_UNAVAILABLE";
    this.state = state;
  }
}

export async function assertGitAvailable({
  gitRunner = runGitVersion,
  platform = process.platform,
} = {}) {
  try {
    const result = await gitRunner();
    return { version: validatedGitVersion(result) };
  } catch (error) {
    const state = externalCommandState(error);
    throw new GitUnavailableError(
      gitDependencyMessage(state, platform),
      { cause: error, state },
    );
  }
}

export async function desktopEnvironmentChecks({
  gitVersionRunner = runGitVersion,
  gitConfigRunner = runGitConfig,
  ghAuthRunner = runGhAuthStatus,
  platform = process.platform,
} = {}) {
  const checks = [];
  let gitAvailable = false;

  try {
    const result = await gitVersionRunner();
    const version = validatedGitVersion(result);
    gitAvailable = true;
    checks.push({
      id: "git-command",
      label: "Git 命令",
      status: "ok",
      message: version || "已检测到 Git 命令。",
    });
  } catch (error) {
    const state = externalCommandState(error);
    checks.push({
      id: "git-command",
      label: "Git 命令",
      status: "error",
      state,
      message: desktopGitDependencyMessage(state, platform),
    });
  }

  checks.push(await gitIdentityCheck({ gitAvailable, gitConfigRunner, platform }));
  checks.push(await githubLoginCheck({ ghAuthRunner }));

  return checks;
}

function gitUnavailableMessage(platform) {
  if (platform === "win32") {
    return "Git is required to open local repositories. Install Git for Windows, or make sure `git.exe` is available on PATH.";
  }
  if (platform === "darwin") {
    return "Git is required to open local repositories. Install Xcode Command Line Tools with `xcode-select --install`, or make sure `git` is available on PATH.";
  }
  return "Git is required to open local repositories. Install Git, or make sure `git` is available on PATH.";
}

function gitDependencyMessage(state, platform) {
  if (state === "unavailable") {
    return gitUnavailableMessage(platform);
  }
  if (state === "permission_denied") {
    return "Git Leaf found Git, but does not have permission to run it or access its files.";
  }
  if (state === "interrupted") {
    return "The Git version check was interrupted before it completed.";
  }
  if (state === "invalid_output") {
    return "The Git command returned an unexpected response, so Git Leaf cannot verify the environment.";
  }
  return "Git is present, but Git Leaf could not complete the Git environment check.";
}

function desktopGitUnavailableMessage(platform) {
  if (platform === "win32") {
    return "未检测到 Git 命令。请先安装 Git for Windows，并确认 git 在 PATH 中。";
  }
  if (platform === "darwin") {
    return "未检测到 Git 命令。请先安装 Xcode Command Line Tools，或确认 git 在 PATH 中。";
  }
  return "未检测到 Git 命令。请先安装 Git，或确认 git 在 PATH 中。";
}

function desktopGitDependencyMessage(state, platform) {
  if (state === "unavailable") {
    return desktopGitUnavailableMessage(platform);
  }
  if (state === "permission_denied") {
    return "已检测到 Git，但 Git Leaf 没有权限运行它。请检查 Git 命令的执行权限。";
  }
  if (state === "interrupted") {
    return "Git 版本检查在完成前被中断，请重试。";
  }
  if (state === "invalid_output") {
    return "Git 命令返回了无法识别的版本信息，Git Leaf 无法确认环境状态。";
  }
  return "Git 命令存在，但环境检查没有正常完成。";
}

function validatedGitVersion(result) {
  const version = String(result?.stdout ?? "").trim();
  if (!/^git version \d+(?:\.\d+){1,3}(?:[.\-+][^\s]+)?(?:\s|$)/i.test(version)) {
    throw new ExternalCommandOutputError("git", ["--version"], "unexpected version output");
  }
  return version;
}

async function gitIdentityCheck({ gitAvailable, gitConfigRunner, platform }) {
  if (!gitAvailable) {
    return {
      id: "git-identity",
      label: "Git 身份",
      status: "warn",
      message: "需要先检测到 Git 命令，才能检查 user.name 和 user.email。",
    };
  }

  try {
    const [nameResult, emailResult] = await Promise.all([
      gitConfigRunner("user.name"),
      gitConfigRunner("user.email"),
    ]);
    const name = String(nameResult.stdout ?? "").trim();
    const email = String(emailResult.stdout ?? "").trim();
    if (!name || !email) {
      throw new Error("missing git identity");
    }

    return {
      id: "git-identity",
      label: "Git 身份",
      status: "ok",
      message: `${name} <${email}>`,
    };
  } catch (error) {
    const state = externalCommandState(error);
    if (["unavailable", "permission_denied", "interrupted", "invalid_output"].includes(state)) {
      return {
        id: "git-identity",
        label: "Git 身份",
        status: "error",
        state,
        message: desktopGitDependencyMessage(state, platform),
      };
    }
    return {
      id: "git-identity",
      label: "Git 身份",
      status: "warn",
      message: "还没有配置 Git user.name / user.email。同步提交前请运行 git config --global user.name 和 git config --global user.email。",
    };
  }
}

async function githubLoginCheck({ ghAuthRunner }) {
  try {
    const result = await ghAuthRunner();
    const output = String(result.stdout || result.stderr || "").trim();
    return {
      id: "github-login",
      label: "GitHub 登录",
      status: "ok",
      message: authStatusSummary(output) || "GitHub CLI 已登录。",
    };
  } catch (error) {
    const state = externalCommandState(error);
    if (state === "unavailable") {
      return {
        id: "github-login",
        label: "GitHub 登录",
        status: "warn",
        message: "未检测到 GitHub CLI。Git Leaf 仍可打开本地仓库；需要同步到 GitHub 时会依赖本机 Git 凭据。",
      };
    }

    const output = String(error?.stdout || error?.stderr || "").trim();
    return {
      id: "github-login",
      label: "GitHub 登录",
      status: "warn",
      state,
      message: authStatusSummary(output) || "GitHub CLI 尚未登录；如需同步到 GitHub，请运行 gh auth login 或配置 Git 凭据。",
    };
  }
}

function authStatusSummary(value) {
  const lines = String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    lines.find((line) => /logged in/i.test(line)) ??
    lines.find((line) => /not logged|not authenticated|authentication/i.test(line)) ??
    lines[0] ??
    ""
  );
}

function runGitVersion() {
  return runCommand("git", ["--version"]);
}

function runGitConfig(key) {
  return runCommand("git", ["config", "--global", "--get", key]);
}

export function runGhAuthStatus(options = {}) {
  return runCommandWithFallback({
    command: "gh",
    args: ["auth", "status"],
    candidateCommands: fallbackCommandsFor("gh"),
    ...options,
  });
}

async function runCommandWithFallback({
  command,
  args,
  candidateCommands = [],
  commandRunner = runCommand,
}) {
  let firstError = null;
  const commands = [...new Set([command, ...candidateCommands])];

  for (const candidate of commands) {
    try {
      return await commandRunner(candidate, args);
    } catch (error) {
      firstError ??= error;
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw firstError;
}

function fallbackCommandsFor(command) {
  if (command !== "gh") {
    return [];
  }

  return [
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    process.env.HOME ? path.join(process.env.HOME, ".local", "bin", "gh") : "",
  ].filter(Boolean);
}

function runCommand(command, args) {
  return runExternalCommand(command, args);
}

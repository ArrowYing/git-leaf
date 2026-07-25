import path from "node:path";
import process from "node:process";

import {
  ExternalCommandOutputError,
  externalCommandState,
  runExternalCommand,
} from "./external-command.mjs";
import { createTranslator } from "../public/i18n.js";

const GIT_ENVIRONMENT_MESSAGES = Object.freeze({
  en: Object.freeze({
    "git.command": "Git command",
    "git.identity": "Git identity",
    "github.login": "GitHub login",
    "git.detected": "Git was detected.",
    "git.required.win32":
      "Git is required to open local repositories. Install Git for Windows, or make sure `git.exe` is available on PATH.",
    "git.required.darwin":
      "Git is required to open local repositories. Install Xcode Command Line Tools with `xcode-select --install`, or make sure `git` is available on PATH.",
    "git.required.other":
      "Git is required to open local repositories. Install Git, or make sure `git` is available on PATH.",
    "git.permission":
      "Git Leaf found Git, but does not have permission to run it or access its files.",
    "git.interrupted": "The Git version check was interrupted before it completed.",
    "git.invalidOutput":
      "The Git command returned an unexpected response, so Git Leaf cannot verify the environment.",
    "git.checkFailed": "Git is present, but Git Leaf could not complete the Git environment check.",
    "desktop.git.missing.win32":
      "Git was not detected. Install Git for Windows and make sure git is available on PATH.",
    "desktop.git.missing.darwin":
      "Git was not detected. Install Xcode Command Line Tools, or make sure git is available on PATH.",
    "desktop.git.missing.other":
      "Git was not detected. Install Git, or make sure git is available on PATH.",
    "desktop.git.permission":
      "Git was detected, but Git Leaf does not have permission to run it. Check the Git command permissions.",
    "desktop.git.interrupted": "The Git version check was interrupted. Try again.",
    "desktop.git.invalidOutput":
      "The Git command returned an unrecognized version, so Git Leaf cannot verify the environment.",
    "desktop.git.checkFailed": "Git is present, but the environment check did not complete.",
    "identity.waitForGit":
      "Git must be detected before Git Leaf can check user.name and user.email.",
    "identity.missing":
      "Git user.name / user.email is not configured. Before syncing commits, run git config --global user.name and git config --global user.email.",
    "github.loggedIn": "GitHub CLI is logged in.",
    "github.cliMissing":
      "GitHub CLI was not detected. Git Leaf can still open local repositories; syncing to GitHub will use local Git credentials.",
    "github.notLoggedIn":
      "GitHub CLI is not logged in. To sync to GitHub, run gh auth login or configure Git credentials.",
  }),
  "zh-CN": Object.freeze({
    "git.command": "Git 命令",
    "git.identity": "Git 身份",
    "github.login": "GitHub 登录",
    "git.detected": "已检测到 Git 命令。",
    "git.required.win32":
      "打开本地仓库需要 Git。请安装 Git for Windows，或确认 `git.exe` 已加入 PATH。",
    "git.required.darwin":
      "打开本地仓库需要 Git。请运行 `xcode-select --install` 安装 Xcode Command Line Tools，或确认 `git` 已加入 PATH。",
    "git.required.other": "打开本地仓库需要 Git。请安装 Git，或确认 `git` 已加入 PATH。",
    "git.permission": "已检测到 Git，但 Git Leaf 没有权限运行它或访问相关文件。",
    "git.interrupted": "Git 版本检查在完成前被中断。",
    "git.invalidOutput": "Git 命令返回了无法识别的结果，Git Leaf 无法确认环境状态。",
    "git.checkFailed": "Git 命令存在，但 Git Leaf 没有完成 Git 环境检查。",
    "desktop.git.missing.win32":
      "未检测到 Git 命令。请先安装 Git for Windows，并确认 git 在 PATH 中。",
    "desktop.git.missing.darwin":
      "未检测到 Git 命令。请先安装 Xcode Command Line Tools，或确认 git 在 PATH 中。",
    "desktop.git.missing.other": "未检测到 Git 命令。请先安装 Git，或确认 git 在 PATH 中。",
    "desktop.git.permission":
      "已检测到 Git，但 Git Leaf 没有权限运行它。请检查 Git 命令的执行权限。",
    "desktop.git.interrupted": "Git 版本检查在完成前被中断，请重试。",
    "desktop.git.invalidOutput":
      "Git 命令返回了无法识别的版本信息，Git Leaf 无法确认环境状态。",
    "desktop.git.checkFailed": "Git 命令存在，但环境检查没有正常完成。",
    "identity.waitForGit": "需要先检测到 Git 命令，才能检查 user.name 和 user.email。",
    "identity.missing":
      "还没有配置 Git user.name / user.email。同步提交前请运行 git config --global user.name 和 git config --global user.email。",
    "github.loggedIn": "GitHub CLI 已登录。",
    "github.cliMissing":
      "未检测到 GitHub CLI。Git Leaf 仍可打开本地仓库；需要同步到 GitHub 时会依赖本机 Git 凭据。",
    "github.notLoggedIn":
      "GitHub CLI 尚未登录；如需同步到 GitHub，请运行 gh auth login 或配置 Git 凭据。",
  }),
});

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
  locale,
  language,
} = {}) {
  const translate = gitEnvironmentTranslator({ locale, language });
  try {
    const result = await gitRunner();
    return { version: validatedGitVersion(result) };
  } catch (error) {
    const state = externalCommandState(error);
    throw new GitUnavailableError(
      gitDependencyMessage(state, platform, translate),
      { cause: error, state },
    );
  }
}

export async function desktopEnvironmentChecks({
  gitVersionRunner = runGitVersion,
  gitConfigRunner = runGitConfig,
  ghAuthRunner = runGhAuthStatus,
  platform = process.platform,
  locale,
  language,
} = {}) {
  const translate = gitEnvironmentTranslator({ locale, language });
  const checks = [];
  let gitAvailable = false;

  try {
    const result = await gitVersionRunner();
    const version = validatedGitVersion(result);
    gitAvailable = true;
    checks.push({
      id: "git-command",
      label: translate("git.command"),
      status: "ok",
      message: version || translate("git.detected"),
    });
  } catch (error) {
    const state = externalCommandState(error);
    checks.push({
      id: "git-command",
      label: translate("git.command"),
      status: "error",
      state,
      message: desktopGitDependencyMessage(state, platform, translate),
    });
  }

  checks.push(await gitIdentityCheck({
    gitAvailable,
    gitConfigRunner,
    platform,
    translate,
  }));
  checks.push(await githubLoginCheck({ ghAuthRunner, translate }));

  return checks;
}

function gitEnvironmentTranslator({ locale, language } = {}) {
  return createTranslator(GIT_ENVIRONMENT_MESSAGES, language ?? locale);
}

function gitUnavailableMessage(platform, translate) {
  return translate(`git.required.${platform === "win32" || platform === "darwin" ? platform : "other"}`);
}

function gitDependencyMessage(state, platform, translate) {
  if (state === "unavailable") {
    return gitUnavailableMessage(platform, translate);
  }
  if (state === "permission_denied") {
    return translate("git.permission");
  }
  if (state === "interrupted") {
    return translate("git.interrupted");
  }
  if (state === "invalid_output") {
    return translate("git.invalidOutput");
  }
  return translate("git.checkFailed");
}

function desktopGitUnavailableMessage(platform, translate) {
  return translate(
    `desktop.git.missing.${platform === "win32" || platform === "darwin" ? platform : "other"}`,
  );
}

function desktopGitDependencyMessage(state, platform, translate) {
  if (state === "unavailable") {
    return desktopGitUnavailableMessage(platform, translate);
  }
  if (state === "permission_denied") {
    return translate("desktop.git.permission");
  }
  if (state === "interrupted") {
    return translate("desktop.git.interrupted");
  }
  if (state === "invalid_output") {
    return translate("desktop.git.invalidOutput");
  }
  return translate("desktop.git.checkFailed");
}

function validatedGitVersion(result) {
  const version = String(result?.stdout ?? "").trim();
  if (!/^git version \d+(?:\.\d+){1,3}(?:[.\-+][^\s]+)?(?:\s|$)/i.test(version)) {
    throw new ExternalCommandOutputError("git", ["--version"], "unexpected version output");
  }
  return version;
}

async function gitIdentityCheck({ gitAvailable, gitConfigRunner, platform, translate }) {
  if (!gitAvailable) {
    return {
      id: "git-identity",
      label: translate("git.identity"),
      status: "warn",
      message: translate("identity.waitForGit"),
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
      label: translate("git.identity"),
      status: "ok",
      message: `${name} <${email}>`,
    };
  } catch (error) {
    const state = externalCommandState(error);
    if (["unavailable", "permission_denied", "interrupted", "invalid_output"].includes(state)) {
      return {
        id: "git-identity",
        label: translate("git.identity"),
        status: "error",
        state,
        message: desktopGitDependencyMessage(state, platform, translate),
      };
    }
    return {
      id: "git-identity",
      label: translate("git.identity"),
      status: "warn",
      message: translate("identity.missing"),
    };
  }
}

async function githubLoginCheck({ ghAuthRunner, translate }) {
  try {
    const result = await ghAuthRunner();
    const output = String(result.stdout || result.stderr || "").trim();
    return {
      id: "github-login",
      label: translate("github.login"),
      status: "ok",
      message: authStatusSummary(output) || translate("github.loggedIn"),
    };
  } catch (error) {
    const state = externalCommandState(error);
    if (state === "unavailable") {
      return {
        id: "github-login",
        label: translate("github.login"),
        status: "warn",
        message: translate("github.cliMissing"),
      };
    }

    const output = String(error?.stdout || error?.stderr || "").trim();
    return {
      id: "github-login",
      label: translate("github.login"),
      status: "warn",
      state,
      message: authStatusSummary(output) || translate("github.notLoggedIn"),
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

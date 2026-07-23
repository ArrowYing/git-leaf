import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { compareAppVersions } from "./app-updates.mjs";
import {
  windowsUpdateWaitProcessId,
  withoutWindowsUpdateArguments,
} from "./windows-app-update.mjs";

const WINDOWS_INSTALL_PARENT = "GitLeaf";
const WINDOWS_INSTALL_DIR = "app";
const WINDOWS_EXECUTABLE = "Git Leaf.exe";
const WINDOWS_INSTALL_STATE = "install-state.json";
const WINDOWS_INSTALL_CONFIRM_ARGUMENT = "--git-leaf-install-confirm=";

export function windowsInstalledAppPaths({
  localAppData,
  roamingAppData = inferRoamingAppData(localAppData),
} = {}) {
  const installRoot = path.win32.join(localAppData, WINDOWS_INSTALL_PARENT, WINDOWS_INSTALL_DIR);
  return {
    installRoot,
    executable: path.win32.join(installRoot, WINDOWS_EXECUTABLE),
    stateFile: path.win32.join(localAppData, WINDOWS_INSTALL_PARENT, WINDOWS_INSTALL_STATE),
    shortcut: path.win32.join(
      roamingAppData,
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Git Leaf.lnk",
    ),
  };
}

export function shouldBootstrapWindowsApp({
  platform = process.platform,
  isPackaged = false,
  execPath = process.execPath,
  localAppData = process.env.LOCALAPPDATA,
  portable = process.env.GIT_LEAF_PORTABLE === "1",
} = {}) {
  if (platform !== "win32" || !isPackaged || portable || !localAppData) {
    return false;
  }

  const installed = windowsInstalledAppPaths({ localAppData }).executable;
  return normalizeWindowsPath(execPath) !== normalizeWindowsPath(installed);
}

export function windowsAppBootstrapPlan({
  platform = process.platform,
  isPackaged = false,
  execPath = process.execPath,
  args = process.argv.slice(1),
  localAppData = process.env.LOCALAPPDATA,
  portable = process.env.GIT_LEAF_PORTABLE === "1",
  processId = process.pid,
  version = "",
  pathExists = existsSync,
  readInstalledVersion = readWindowsInstalledVersion,
} = {}) {
  if (!shouldBootstrapWindowsApp({
    platform,
    isPackaged,
    execPath,
    localAppData,
    portable,
  })) {
    return { status: "current" };
  }

  const paths = windowsInstalledAppPaths({ localAppData });
  const parent = path.win32.dirname(paths.installRoot);
  const hasInstalledApp = pathExists(paths.installRoot);
  const installedVersion = hasInstalledApp
    ? readInstalledVersion(paths.stateFile)
    : "";
  const versionComparison = version && installedVersion
    ? compareAppVersions(version, installedVersion)
    : null;
  const waitForPid = windowsUpdateWaitProcessId(args);
  return {
    status: hasInstalledApp && versionComparison === 0
      ? "redirect"
      : hasInstalledApp && versionComparison < 0
        ? "outdated"
      : hasInstalledApp
        ? "update"
        : "install",
    version,
    processId,
    installedVersion,
    args: withoutWindowsUpdateArguments(args),
    ...(waitForPid ? { waitForPid } : {}),
    sourceRoot: path.win32.dirname(execPath),
    parent,
    installRoot: paths.installRoot,
    executable: paths.executable,
    stateFile: paths.stateFile,
    stagingRoot: path.win32.join(parent, `.installing-${processId}`),
    previousRoot: path.win32.join(parent, `.previous-${processId}`),
    confirmFile: path.win32.join(parent, `.launch-confirm-${processId}.json`),
  };
}

export function windowsBootstrapNeedsExclusiveLock(plan) {
  return ["install", "update"].includes(plan?.status) && !plan?.waitForPid;
}

export async function bootstrapWindowsApp({
  plan,
  copyDirectory = cp,
  makeDirectory = mkdir,
  movePath = rename,
  removePath = rm,
  pathExists = existsSync,
  spawnProcess = spawn,
  writeTextFile = writeFile,
  moveStateFile = rename,
  onProgress = async () => {},
  completionDelayMs = 2_000,
  wait = delay,
  waitForProcessExit = waitForWindowsProcessExit,
  beforeRelaunch = async () => {},
  waitForRelaunchConfirmation = waitForWindowsRelaunchConfirmation,
  stopRelaunchedApp = stopWindowsRelaunchedApp,
  persistInstalledVersion = persistWindowsInstalledVersion,
} = {}) {
  if (!plan || plan.status === "current") {
    return { status: "current" };
  }

  if (["redirect", "outdated"].includes(plan.status)) {
    const outdated = plan.status === "outdated";
    await onProgress({
      phase: outdated ? "outdated" : "redirect",
      percent: 100,
      title: outdated
        ? `这是旧版本的 Git Leaf${plan.version ? ` ${plan.version}` : ""}`
        : `Git Leaf${plan.version ? ` ${plan.version}` : ""} 已安装`,
      message: outdated
        ? `本机已安装更新的 Git Leaf${plan.installedVersion ? ` ${plan.installedVersion}` : ""}，不会使用旧版本覆盖。`
        : "正在从固定位置启动。",
      detail: outdated
        ? "请从开始菜单启动 Git Leaf。这个旧版解压目录可以删除。"
        : "以后请从开始菜单启动 Git Leaf。当前和旧版解压目录均可删除。",
      stage: "从固定位置启动",
    });
    await wait(completionDelayMs);
    return relaunchWindowsApp(plan, spawnProcess).result;
  }

  if (plan.waitForPid) {
    await onProgress({
      phase: "waiting",
      percent: 5,
      title: progressTitle(plan),
      message: "正在关闭当前版本…",
      stage: "等待当前版本退出",
    });
    await waitForProcessExit(plan.waitForPid);
  }

  await onProgress({
    phase: "copying",
    percent: 12,
    title: progressTitle(plan),
    message: "正在复制新版本文件…",
    stage: "复制文件",
  });
  await makeDirectory(plan.parent, { recursive: true });
  await removePath(plan.stagingRoot, { recursive: true, force: true });
  await removePath(plan.previousRoot, { recursive: true, force: true });
  await copyWindowsAppDirectory(plan.sourceRoot, plan.stagingRoot, copyDirectory);

  await onProgress({
    phase: "switching",
    percent: 76,
    title: progressTitle(plan),
    message: "文件复制完成，正在切换到新版本…",
    stage: "切换版本",
  });
  let movedPrevious = false;
  try {
    if (pathExists(plan.installRoot)) {
      await movePath(plan.installRoot, plan.previousRoot);
      movedPrevious = true;
    }
    await movePath(plan.stagingRoot, plan.installRoot);
  } catch (error) {
    let recoveryError = null;
    if (movedPrevious && !pathExists(plan.installRoot) && pathExists(plan.previousRoot)) {
      try {
        await movePath(plan.previousRoot, plan.installRoot);
      } catch (renameError) {
        try {
          await removePath(plan.installRoot, { recursive: true, force: true });
          await copyWindowsAppDirectory(plan.previousRoot, plan.installRoot, copyDirectory);
        } catch (copyError) {
          recoveryError = new AggregateError(
            [renameError, copyError],
            `Git Leaf could not restore the previous app automatically. Backup: ${plan.previousRoot}`,
          );
          recoveryError.code = "WINDOWS_INSTALL_RECOVERY_REQUIRED";
        }
      }
    }
    try {
      await removePath(plan.stagingRoot, { recursive: true, force: true });
    } catch {
      // Preserve the original switch error; a later retry removes stale staging.
    }
    if (recoveryError) {
      throw recoveryError;
    }
    throw error;
  }

  await onProgress({
    phase: "starting",
    percent: 88,
    title: progressTitle(plan),
    message: "正在启动固定目录中的新版本…",
    stage: "确认新版本",
  });
  await removePath(plan.confirmFile, { recursive: false, force: true });
  await beforeRelaunch();
  const relaunched = relaunchWindowsApp(plan, spawnProcess, { confirm: true });
  try {
    await waitForRelaunchConfirmation(plan.confirmFile, { child: relaunched.child });
    await persistInstalledVersion(plan, {
      writeTextFile,
      moveStateFile,
      removePath,
    });
  } catch (error) {
    await stopRelaunchedApp(relaunched.child);
    await rollbackWindowsAppSwitch({
      plan,
      movedPrevious,
      copyDirectory,
      movePath,
      removePath,
      pathExists,
    });
    await removePath(plan.confirmFile, { recursive: false, force: true }).catch(() => {});
    throw error;
  }

  await removePath(plan.confirmFile, { recursive: false, force: true }).catch(() => {});
  if (movedPrevious) {
    try {
      await removePath(plan.previousRoot, { recursive: true, force: true });
    } catch {
      // The new stable app is confirmed; stale backup cleanup can wait.
    }
  }
  await onProgress({
    phase: "complete",
    percent: 100,
    title: plan.status === "update" ? "版本更新已完成" : "Git Leaf 已准备完成",
    message: completionMessage(plan),
    detail: completionDetail(plan),
    stage: "完成",
  });
  await wait(completionDelayMs);
  return relaunched.result;
}

function relaunchWindowsApp(plan, spawnProcess, { confirm = false } = {}) {
  const args = confirm
    ? [`${WINDOWS_INSTALL_CONFIRM_ARGUMENT}${plan.confirmFile}`, ...plan.args]
    : plan.args;
  const child = spawnProcess(plan.executable, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref?.();
  return {
    child,
    result: {
      status: "relaunch",
      executable: plan.executable,
    },
  };
}

async function rollbackWindowsAppSwitch({
  plan,
  movedPrevious,
  copyDirectory,
  movePath,
  removePath,
  pathExists,
}) {
  try {
    await removePath(plan.installRoot, { recursive: true, force: true });
  } catch (error) {
    throw windowsInstallRecoveryRequiredError(plan, error);
  }
  if (!movedPrevious || !pathExists(plan.previousRoot)) {
    return;
  }
  try {
    await movePath(plan.previousRoot, plan.installRoot);
  } catch (renameError) {
    try {
      await copyWindowsAppDirectory(plan.previousRoot, plan.installRoot, copyDirectory);
    } catch (copyError) {
      throw windowsInstallRecoveryRequiredError(plan, new AggregateError([
        renameError,
        copyError,
      ]));
    }
  }
}

function windowsInstallRecoveryRequiredError(plan, cause) {
  const error = new Error(
    `Git Leaf could not restore the previous app automatically. Backup: ${plan.previousRoot}`,
    { cause },
  );
  error.code = "WINDOWS_INSTALL_RECOVERY_REQUIRED";
  return error;
}

async function copyWindowsAppDirectory(source, destination, copyDirectory) {
  const previousNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    await copyDirectory(source, destination, { recursive: true });
  } finally {
    if (previousNoAsar === undefined) {
      delete process.noAsar;
    } else {
      process.noAsar = previousNoAsar;
    }
  }
}

function progressTitle(plan) {
  const version = plan.version ? ` ${plan.version}` : "";
  return plan.status === "update"
    ? `正在更新 Git Leaf${version}`
    : `正在准备 Git Leaf${version}`;
}

function completionMessage(plan) {
  const version = plan.version ? ` ${plan.version}` : "";
  return plan.status === "update"
    ? `已启动更新后的 Git Leaf${version}。`
    : `已从固定位置启动 Git Leaf${version}。`;
}

function completionDetail(plan) {
  return plan.waitForPid
    ? "更新临时文件会自动清理；以后继续从开始菜单启动 Git Leaf。"
    : "以后请从开始菜单启动 Git Leaf。当前和旧版解压目录均可删除。";
}

function readWindowsInstalledVersion(stateFile) {
  try {
    const value = JSON.parse(readFileSync(stateFile, "utf8"));
    return typeof value?.version === "string" ? value.version : "";
  } catch {
    return "";
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function windowsInstallConfirmationPath(args = [], {
  localAppData = process.env.LOCALAPPDATA,
} = {}) {
  if (!localAppData) {
    return "";
  }
  const argument = args.find((value) => String(value).startsWith(WINDOWS_INSTALL_CONFIRM_ARGUMENT));
  const candidate = path.win32.resolve(
    String(argument || "").slice(WINDOWS_INSTALL_CONFIRM_ARGUMENT.length),
  );
  const parent = path.win32.join(localAppData, WINDOWS_INSTALL_PARENT);
  if (
    normalizeWindowsPath(path.win32.dirname(candidate)) !== normalizeWindowsPath(parent)
    || !/^\.launch-confirm-[0-9]+\.json$/i.test(path.win32.basename(candidate))
  ) {
    return "";
  }
  return candidate;
}

export async function confirmWindowsAppLaunch({
  args = process.argv.slice(1),
  localAppData = process.env.LOCALAPPDATA,
  writeTextFile = writeFile,
} = {}) {
  const confirmationPath = windowsInstallConfirmationPath(args, { localAppData });
  if (!confirmationPath) {
    return false;
  }
  await writeTextFile(confirmationPath, `${JSON.stringify({
    pid: process.pid,
    confirmedAt: new Date().toISOString(),
  })}\n`, "utf8");
  return true;
}

export async function persistWindowsInstalledVersion(plan, {
  writeTextFile = writeFile,
  moveStateFile = rename,
  removePath = rm,
} = {}) {
  const tempFile = `${plan.stateFile}.installing-${plan.processId}`;
  await writeTextFile(tempFile, `${JSON.stringify({
    version: plan.version,
    installedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  try {
    await moveStateFile(tempFile, plan.stateFile);
  } finally {
    await removePath(tempFile, { recursive: false, force: true }).catch(() => {});
  }
}

export async function waitForWindowsRelaunchConfirmation(confirmFile, {
  child = null,
  timeoutMs = 30_000,
  pollMs = 100,
  pathExists = existsSync,
  wait = delay,
  now = Date.now,
} = {}) {
  let launchError = null;
  let exitedBeforeConfirmation = false;
  const onLaunchError = (error) => {
    launchError = error;
  };
  const onEarlyExit = () => {
    exitedBeforeConfirmation = true;
  };
  child?.once?.("error", onLaunchError);
  child?.once?.("exit", onEarlyExit);
  const startedAt = now();
  try {
    while (!pathExists(confirmFile)) {
      if (launchError) {
        launchError.code ||= "WINDOWS_INSTALL_LAUNCH_FAILED";
        throw launchError;
      }
      if (exitedBeforeConfirmation || child?.exitCode != null) {
        const error = new Error("The updated Git Leaf exited before startup confirmation.");
        error.code = "WINDOWS_INSTALL_LAUNCH_FAILED";
        throw error;
      }
      if (now() - startedAt >= timeoutMs) {
        const error = new Error("Timed out waiting for the updated Git Leaf to finish starting.");
        error.code = "WINDOWS_INSTALL_LAUNCH_TIMEOUT";
        throw error;
      }
      await wait(pollMs);
    }
    return true;
  } finally {
    child?.off?.("error", onLaunchError);
    child?.off?.("exit", onEarlyExit);
  }
}

async function stopWindowsRelaunchedApp(child) {
  const processId = Number(child?.pid);
  if (!Number.isInteger(processId) || processId <= 0) {
    return false;
  }
  await new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(processId), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", () => resolve(false));
    killer.once("close", () => resolve(true));
  });
  try {
    await waitForWindowsProcessExit(processId, { timeoutMs: 5_000 });
  } catch {
    return false;
  }
  return true;
}

export async function waitForWindowsProcessExit(processId, {
  timeoutMs = 30_000,
  pollMs = 150,
  processExists = runningProcessExists,
  wait = delay,
  now = Date.now,
} = {}) {
  if (!Number.isInteger(processId) || processId <= 0 || processId === process.pid) {
    throw new Error("Invalid Windows update handoff process.");
  }
  const startedAt = now();
  while (processExists(processId)) {
    if (now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for the current Git Leaf process to exit.");
    }
    await wait(pollMs);
  }
}

function runningProcessExists(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function inferRoamingAppData(localAppData = "") {
  const local = String(localAppData);
  const parent = path.win32.dirname(local);
  return path.win32.basename(local).toLowerCase() === "local"
    ? path.win32.join(parent, "Roaming")
    : path.win32.join(local, "Roaming");
}

function normalizeWindowsPath(value) {
  return path.win32.resolve(String(value)).replaceAll("/", "\\").toLowerCase();
}

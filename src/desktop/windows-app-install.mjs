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

const WINDOWS_INSTALL_PARENT = "OpenGlance";
const WINDOWS_INSTALL_DIR = "app";
const WINDOWS_EXECUTABLE = "OpenGlance.exe";
const WINDOWS_INSTALL_STATE = "install-state.json";
const OPENPEEK_WINDOWS_INSTALL_PARENT = "OpenPeek";
const OPENPEEK_WINDOWS_EXECUTABLE = "OpenPeek.exe";
const GIT_LEAF_WINDOWS_INSTALL_PARENT = "GitLeaf";
const GIT_LEAF_WINDOWS_EXECUTABLE = "Git Leaf.exe";
const WINDOWS_INSTALL_CONFIRM_ARGUMENT = "--openglance-install-confirm=";
const OPENPEEK_WINDOWS_INSTALL_CONFIRM_ARGUMENT = "--openpeek-install-confirm=";
const GIT_LEAF_WINDOWS_INSTALL_CONFIRM_ARGUMENT = "--git-leaf-install-confirm=";
const WINDOWS_INSTALL_CONFIRM_ARGUMENTS = [
  WINDOWS_INSTALL_CONFIRM_ARGUMENT,
  OPENPEEK_WINDOWS_INSTALL_CONFIRM_ARGUMENT,
  GIT_LEAF_WINDOWS_INSTALL_CONFIRM_ARGUMENT,
];
const WINDOWS_INSTALL_MESSAGES = Object.freeze({
  en: Object.freeze({
    "outdated.title": "This is an older version of OpenGlance{version}",
    "redirect.title": "OpenGlance{version} is installed",
    "outdated.message": "A newer OpenGlance{installedVersion} is already installed. The older package will not overwrite it.",
    "redirect.message": "Starting OpenGlance from its fixed location.",
    "outdated.detail": "Start OpenGlance from the Start menu. You can delete this older extracted folder.",
    "redirect.detail": "Continue to start OpenGlance from the Start menu. You can delete this and older extracted folders.",
    "stage.fixedLocation": "Starting from fixed location",
    "progress.updateTitle": "Updating OpenGlance{version}",
    "progress.installTitle": "Preparing OpenGlance{version}",
    "waiting.message": "Closing the current version…",
    "stage.waiting": "Waiting for current version to exit",
    "copying.message": "Copying the new version…",
    "stage.copying": "Copying files",
    "switching.message": "Files copied. Switching to the new version…",
    "stage.switching": "Switching versions",
    "starting.message": "Starting the new version from its fixed location…",
    "stage.starting": "Confirming the new version",
    "complete.updateTitle": "OpenGlance update complete",
    "complete.installTitle": "OpenGlance is ready",
    "complete.updateMessage": "Updated OpenGlance{version} has started.",
    "complete.installMessage": "OpenGlance{version} has started from its fixed location.",
    "complete.automaticDetail": "Temporary update files will be cleaned up automatically. Continue to start OpenGlance from the Start menu.",
    "complete.manualDetail": "Continue to start OpenGlance from the Start menu. You can delete this and older extracted folders.",
    "stage.complete": "Complete",
  }),
  "zh-CN": Object.freeze({
    "outdated.title": "这是旧版本的 OpenGlance{version}",
    "redirect.title": "OpenGlance{version} 已安装",
    "outdated.message": "本机已安装更新的 OpenGlance{installedVersion}，不会使用旧版本覆盖。",
    "redirect.message": "正在从固定位置启动。",
    "outdated.detail": "请从开始菜单启动 OpenGlance。这个旧版解压目录可以删除。",
    "redirect.detail": "以后请从开始菜单启动 OpenGlance。当前和旧版解压目录均可删除。",
    "stage.fixedLocation": "从固定位置启动",
    "progress.updateTitle": "正在更新 OpenGlance{version}",
    "progress.installTitle": "正在准备 OpenGlance{version}",
    "waiting.message": "正在关闭当前版本…",
    "stage.waiting": "等待当前版本退出",
    "copying.message": "正在复制新版本文件…",
    "stage.copying": "复制文件",
    "switching.message": "文件复制完成，正在切换到新版本…",
    "stage.switching": "切换版本",
    "starting.message": "正在启动固定目录中的新版本…",
    "stage.starting": "确认新版本",
    "complete.updateTitle": "版本更新已完成",
    "complete.installTitle": "OpenGlance 已准备完成",
    "complete.updateMessage": "已启动更新后的 OpenGlance{version}。",
    "complete.installMessage": "已从固定位置启动 OpenGlance{version}。",
    "complete.automaticDetail": "更新临时文件会自动清理；以后继续从开始菜单启动 OpenGlance。",
    "complete.manualDetail": "以后请从开始菜单启动 OpenGlance。当前和旧版解压目录均可删除。",
    "stage.complete": "完成",
  }),
});

export function windowsInstalledAppPaths({
  localAppData,
  roamingAppData = inferRoamingAppData(localAppData),
} = {}) {
  const installRoot = path.win32.join(localAppData, WINDOWS_INSTALL_PARENT, WINDOWS_INSTALL_DIR);
  const openPeekInstallParent = path.win32.join(localAppData, OPENPEEK_WINDOWS_INSTALL_PARENT);
  const openPeekInstallRoot = path.win32.join(openPeekInstallParent, WINDOWS_INSTALL_DIR);
  const gitLeafInstallParent = path.win32.join(localAppData, GIT_LEAF_WINDOWS_INSTALL_PARENT);
  const gitLeafInstallRoot = path.win32.join(gitLeafInstallParent, WINDOWS_INSTALL_DIR);
  const shortcutRoot = path.win32.join(
    roamingAppData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  );
  const openPeekInstallation = {
    name: "OpenPeek",
    installParent: openPeekInstallParent,
    installRoot: openPeekInstallRoot,
    executable: path.win32.join(openPeekInstallRoot, OPENPEEK_WINDOWS_EXECUTABLE),
    stateFile: path.win32.join(openPeekInstallParent, WINDOWS_INSTALL_STATE),
    shortcut: path.win32.join(shortcutRoot, "OpenPeek.lnk"),
  };
  const gitLeafInstallation = {
    name: "Git Leaf",
    installParent: gitLeafInstallParent,
    installRoot: gitLeafInstallRoot,
    executable: path.win32.join(gitLeafInstallRoot, GIT_LEAF_WINDOWS_EXECUTABLE),
    stateFile: path.win32.join(gitLeafInstallParent, WINDOWS_INSTALL_STATE),
    shortcut: path.win32.join(shortcutRoot, "Git Leaf.lnk"),
  };
  return {
    installRoot,
    executable: path.win32.join(installRoot, WINDOWS_EXECUTABLE),
    stateFile: path.win32.join(localAppData, WINDOWS_INSTALL_PARENT, WINDOWS_INSTALL_STATE),
    shortcut: path.win32.join(shortcutRoot, "OpenGlance.lnk"),
    openPeekInstallParent,
    openPeekInstallRoot,
    openPeekExecutable: openPeekInstallation.executable,
    openPeekStateFile: openPeekInstallation.stateFile,
    openPeekShortcut: openPeekInstallation.shortcut,
    gitLeafInstallParent,
    gitLeafInstallRoot,
    gitLeafExecutable: gitLeafInstallation.executable,
    gitLeafStateFile: gitLeafInstallation.stateFile,
    gitLeafShortcut: gitLeafInstallation.shortcut,
    legacyInstallations: [openPeekInstallation, gitLeafInstallation],
    // Source-level aliases retained for integrations that mean the Git Leaf 1.x installation.
    legacyInstallParent: gitLeafInstallParent,
    legacyInstallRoot: gitLeafInstallRoot,
    legacyExecutable: gitLeafInstallation.executable,
    legacyStateFile: gitLeafInstallation.stateFile,
    legacyShortcut: gitLeafInstallation.shortcut,
  };
}

export function shouldBootstrapWindowsApp({
  platform = process.platform,
  isPackaged = false,
  execPath = process.execPath,
  localAppData = process.env.LOCALAPPDATA,
  portable = (
    process.env.OPENGLANCE_PORTABLE
    ?? process.env.OPENPEEK_PORTABLE
    ?? process.env.GIT_LEAF_PORTABLE
  ) === "1",
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
  portable = (
    process.env.OPENGLANCE_PORTABLE
    ?? process.env.OPENPEEK_PORTABLE
    ?? process.env.GIT_LEAF_PORTABLE
  ) === "1",
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
  const previousInstallation = !hasInstalledApp
    ? paths.legacyInstallations.find((candidate) => pathExists(candidate.installRoot))
    : undefined;
  const hasLegacyInstalledApp = Boolean(previousInstallation);
  const installedVersion = hasInstalledApp
    ? readInstalledVersion(paths.stateFile)
    : hasLegacyInstalledApp
      ? readInstalledVersion(previousInstallation.stateFile)
      : "";
  const versionComparison = version && installedVersion
    ? compareAppVersions(version, installedVersion)
    : null;
  const waitForPid = windowsUpdateWaitProcessId(args);
  return {
    status: hasLegacyInstalledApp
      ? "update"
      : hasInstalledApp && versionComparison === 0
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
    ...(hasLegacyInstalledApp ? {
      previousProductName: previousInstallation.name,
      legacyInstallParent: previousInstallation.installParent,
      legacyInstallRoot: previousInstallation.installRoot,
      legacyShortcut: previousInstallation.shortcut,
    } : {}),
  };
}

export function windowsBootstrapNeedsExclusiveLock(plan) {
  return ["install", "update"].includes(plan?.status) && !plan?.waitForPid;
}

export async function bootstrapWindowsApp({
  plan,
  language = "en",
  locale,
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
  const translate = createWindowsInstallTranslator(locale ?? language);
  if (!plan || plan.status === "current") {
    return { status: "current" };
  }

  if (["redirect", "outdated"].includes(plan.status)) {
    const outdated = plan.status === "outdated";
    await onProgress({
      phase: outdated ? "outdated" : "redirect",
      percent: 100,
      title: outdated
        ? translate("outdated.title", { version: versionSuffix(plan.version) })
        : translate("redirect.title", { version: versionSuffix(plan.version) }),
      message: outdated
        ? translate("outdated.message", {
          installedVersion: versionSuffix(plan.installedVersion),
        })
        : translate("redirect.message"),
      detail: outdated
        ? translate("outdated.detail")
        : translate("redirect.detail"),
      stage: translate("stage.fixedLocation"),
    });
    await wait(completionDelayMs);
    return relaunchWindowsApp(plan, spawnProcess).result;
  }

  if (plan.waitForPid) {
    await onProgress({
      phase: "waiting",
      percent: 5,
      title: progressTitle(plan, translate),
      message: translate("waiting.message"),
      stage: translate("stage.waiting"),
    });
    await waitForProcessExit(plan.waitForPid);
  }

  await onProgress({
    phase: "copying",
    percent: 12,
    title: progressTitle(plan, translate),
    message: translate("copying.message"),
    stage: translate("stage.copying"),
  });
  await makeDirectory(plan.parent, { recursive: true });
  await removePath(plan.stagingRoot, { recursive: true, force: true });
  await removePath(plan.previousRoot, { recursive: true, force: true });
  await copyWindowsAppDirectory(plan.sourceRoot, plan.stagingRoot, copyDirectory);
  for (const executableName of [
    OPENPEEK_WINDOWS_EXECUTABLE,
    GIT_LEAF_WINDOWS_EXECUTABLE,
  ]) {
    await removePath(path.win32.join(plan.stagingRoot, executableName), {
      recursive: false,
      force: true,
    });
  }

  await onProgress({
    phase: "switching",
    percent: 76,
    title: progressTitle(plan, translate),
    message: translate("switching.message"),
    stage: translate("stage.switching"),
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
            `OpenGlance could not restore the previous app automatically. Backup: ${plan.previousRoot}`,
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
    title: progressTitle(plan, translate),
    message: translate("starting.message"),
    stage: translate("stage.starting"),
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
    await cleanupLegacyWindowsInstallation(plan, {
      pathExists,
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
    title: translate(plan.status === "update"
      ? "complete.updateTitle"
      : "complete.installTitle"),
    message: completionMessage(plan, translate),
    detail: completionDetail(plan, translate),
    stage: translate("stage.complete"),
  });
  await wait(completionDelayMs);
  return relaunched.result;
}

async function cleanupLegacyWindowsInstallation(plan, { pathExists, removePath }) {
  if (!plan.legacyInstallParent || !pathExists(plan.legacyInstallParent)) {
    return false;
  }
  const sourceRoot = normalizeWindowsPath(plan.sourceRoot);
  const legacyRoot = normalizeWindowsPath(plan.legacyInstallParent);
  if (sourceRoot === legacyRoot || sourceRoot.startsWith(`${legacyRoot}\\`)) {
    return false;
  }
  try {
    await removePath(plan.legacyInstallParent, { recursive: true, force: true });
    if (plan.legacyShortcut) {
      await removePath(plan.legacyShortcut, { recursive: false, force: true });
    }
    return true;
  } catch {
    // The confirmed OpenGlance install remains authoritative; stale legacy cleanup can retry later.
    return false;
  }
}

export async function cleanupLegacyWindowsInstallationAfterRename({
  platform = process.platform,
  isPackaged = false,
  execPath = process.execPath,
  localAppData = process.env.LOCALAPPDATA,
  roamingAppData = process.env.APPDATA,
  pathExists = existsSync,
  removePath = rm,
} = {}) {
  if (platform !== "win32" || !isPackaged || !localAppData) {
    return false;
  }
  const paths = windowsInstalledAppPaths({ localAppData, roamingAppData });
  if (
    normalizeWindowsPath(execPath) !== normalizeWindowsPath(paths.executable)
    || !pathExists(paths.executable)
  ) {
    return false;
  }
  let removed = false;
  for (const previous of paths.legacyInstallations) {
    if (!pathExists(previous.installParent)) {
      continue;
    }
    try {
      await removePath(previous.shortcut, { recursive: false, force: true });
      await removePath(previous.installParent, { recursive: true, force: true });
      removed = true;
    } catch {
      // A previous updater can still be exiting. The canonical App retries on its next launch.
    }
  }
  return removed;
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
    `OpenGlance could not restore the previous app automatically. Backup: ${plan.previousRoot}`,
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

function progressTitle(plan, translate) {
  return translate(
    plan.status === "update" ? "progress.updateTitle" : "progress.installTitle",
    { version: versionSuffix(plan.version) },
  );
}

function completionMessage(plan, translate) {
  return translate(
    plan.status === "update" ? "complete.updateMessage" : "complete.installMessage",
    { version: versionSuffix(plan.version) },
  );
}

function completionDetail(plan, translate) {
  return translate(plan.waitForPid
    ? "complete.automaticDetail"
    : "complete.manualDetail");
}

function createWindowsInstallTranslator(locale) {
  const messages = WINDOWS_INSTALL_MESSAGES[resolveWindowsInstallLocale(locale)];
  return (key, replacements = {}) => {
    const template = messages[key] ?? WINDOWS_INSTALL_MESSAGES.en[key] ?? key;
    return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name) => (
      replacements[name] == null ? "" : String(replacements[name])
    ));
  };
}

function resolveWindowsInstallLocale(locale) {
  return String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function versionSuffix(version) {
  return version ? ` ${version}` : "";
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
  const argument = args.find((value) => WINDOWS_INSTALL_CONFIRM_ARGUMENTS.some(
    (prefix) => String(value).startsWith(prefix),
  ));
  const prefix = WINDOWS_INSTALL_CONFIRM_ARGUMENTS.find((candidate) => (
    String(argument || "").startsWith(candidate)
  )) || WINDOWS_INSTALL_CONFIRM_ARGUMENT;
  const candidate = path.win32.resolve(
    String(argument || "").slice(prefix.length),
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
        const error = new Error("The updated OpenGlance exited before startup confirmation.");
        error.code = "WINDOWS_INSTALL_LAUNCH_FAILED";
        throw error;
      }
      if (now() - startedAt >= timeoutMs) {
        const error = new Error("Timed out waiting for the updated OpenGlance to finish starting.");
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
      throw new Error("Timed out waiting for the current OpenGlance process to exit.");
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

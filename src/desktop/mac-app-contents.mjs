import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const OFFICIAL_PUBLIC_MAC_BUNDLE_ID = "com.mangofuture.openglance";
export const OFFICIAL_INTERNAL_MAC_BUNDLE_ID = "com.mangofuture.gitleaf";
export const OFFICIAL_MAC_BUNDLE_ID = OFFICIAL_INTERNAL_MAC_BUNDLE_ID;
export const OFFICIAL_MAC_TEAM_IDENTIFIER = "HN6X79BUSR";
export const OFFICIAL_PUBLIC_MAC_EXECUTABLE_NAME = "OpenGlance";
export const OFFICIAL_INTERNAL_MAC_EXECUTABLE_NAME = "OpenGlance";
export const OFFICIAL_MAC_EXECUTABLE_NAME = OFFICIAL_INTERNAL_MAC_EXECUTABLE_NAME;

function runChecked(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim()
      || result.stdout?.trim()
      || `Command failed: ${command} ${args.join(" ")}`,
    );
  }
  return result.stdout.trim();
}

export function readMacAppVersion(appPath) {
  return runChecked("/usr/libexec/PlistBuddy", [
    "-c",
    "Print:CFBundleShortVersionString",
    path.join(appPath, "Contents", "Info.plist"),
  ]);
}

export function readMacAppBundleId(appPath) {
  return runChecked("/usr/libexec/PlistBuddy", [
    "-c",
    "Print:CFBundleIdentifier",
    path.join(appPath, "Contents", "Info.plist"),
  ]);
}

export function readMacAppExecutableName(appPath) {
  return runChecked("/usr/libexec/PlistBuddy", [
    "-c",
    "Print:CFBundleExecutable",
    path.join(appPath, "Contents", "Info.plist"),
  ]);
}

export function verifySignedMacApp(appPath, {
  expectedBundleId = OFFICIAL_INTERNAL_MAC_BUNDLE_ID,
  expectedTeamIdentifier = OFFICIAL_MAC_TEAM_IDENTIFIER,
} = {}) {
  runChecked("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ]);
  const details = spawnSync(
    "codesign",
    ["-dv", "--verbose=4", appPath],
    { encoding: "utf8" },
  );
  if (details.error) throw details.error;
  const identity = `${details.stdout || ""}\n${details.stderr || ""}`;
  if (
    details.status !== 0
    || !identity.includes(`Identifier=${expectedBundleId}`)
    || !identity.includes(`TeamIdentifier=${expectedTeamIdentifier}`)
  ) {
    throw new Error("The App is not signed as the official Mango Future OpenGlance");
  }
  return true;
}

export function runningMacAppProcessIds(appPath, {
  excludedProcessIds = [],
  processList,
} = {}) {
  const roots = new Set([path.resolve(appPath)]);
  try {
    roots.add(realpathSync.native(appPath));
  } catch {
    // The logical App path remains sufficient for validation below.
  }
  const output = processList === undefined
    ? spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).stdout
    : typeof processList === "function"
      ? processList()
      : processList;
  const excluded = new Set(
    excludedProcessIds
      .filter((processId) => Number.isInteger(processId) && processId > 0),
  );
  return String(output || "")
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      processId: Number(match[1]),
      command: match[2],
    }))
    .filter(({ processId, command }) => (
      !excluded.has(processId)
      && [...roots].some((root) => (
        command.startsWith(`${root}${path.sep}Contents${path.sep}`)
      ))
    ))
    .map(({ processId }) => processId);
}

export function assertMacAppNotRunning(appPath, options = {}) {
  const processIds = runningMacAppProcessIds(appPath, options);
  if (processIds.length > 0) {
    throw new Error(
      `Refusing to update a running App: ${appPath} (${processIds.join(", ")})`,
    );
  }
}

export async function waitForMacAppProcessesExit(appPath, {
  excludedProcessIds = [],
  timeoutMs = 15_000,
  pollMs = 100,
  findProcessIds = runningMacAppProcessIds,
  wait = (milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }),
  now = Date.now,
} = {}) {
  const startedAt = now();
  let processIds = findProcessIds(appPath, { excludedProcessIds });
  while (processIds.length > 0) {
    if (now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out waiting for OpenGlance App processes to exit: ${
          processIds.join(", ")
        }`,
      );
    }
    await wait(pollMs);
    processIds = findProcessIds(appPath, { excludedProcessIds });
  }
}

export function beginMacAppContentsReplacement({
  sourceAppPath,
  targetAppPath,
  expectedVersion,
  verifyApp = verifySignedMacApp,
  readVersion = readMacAppVersion,
  copyContents = (source, destination) => {
    runChecked("ditto", [source, destination]);
  },
} = {}) {
  const source = validatedAppDirectory(sourceAppPath, "source");
  const target = validatedAppDirectory(targetAppPath, "target");
  if (source === target) {
    throw new Error("The source and target App paths must be distinct");
  }
  if (source.startsWith(`${target}${path.sep}`) || target.startsWith(`${source}${path.sep}`)) {
    throw new Error("The source and target App paths must not overlap");
  }
  accessSync(target, constants.W_OK);
  verifyApp(source);
  if (readVersion(source) !== expectedVersion) {
    throw new Error(`The source App is not OpenGlance ${expectedVersion}`);
  }

  const targetInode = statSync(target).ino;
  const targetContents = path.join(target, "Contents");
  const sourceContents = path.join(source, "Contents");
  const suffix = `${process.pid}-${Date.now()}`;
  const stagedContents = path.join(target, `.git-leaf-next-${suffix}`);
  const rollbackRoot = mkdtempSync(
    path.join(tmpdir(), "git-leaf-update-rollback."),
  );
  const previousContents = path.join(rollbackRoot, "Contents");
  if (statSync(rollbackRoot).dev !== statSync(target).dev) {
    rmSync(rollbackRoot, { recursive: true, force: true });
    throw new Error(
      "The rollback directory is not on the same volume as the target App",
    );
  }
  let previousMoved = false;
  let candidateInstalled = false;
  let settled = false;

  function rollback() {
    if (settled) {
      return false;
    }
    if (candidateInstalled && existsSync(targetContents)) {
      rmSync(targetContents, { recursive: true, force: false });
    }
    if (previousMoved && existsSync(previousContents)) {
      renameSync(previousContents, targetContents);
      previousMoved = false;
    }
    if (existsSync(stagedContents)) {
      rmSync(stagedContents, { recursive: true, force: false });
    }
    if (existsSync(rollbackRoot)) {
      rmSync(rollbackRoot, { recursive: true, force: true });
    }
    settled = true;
    return true;
  }

  try {
    copyContents(sourceContents, stagedContents);
    renameSync(targetContents, previousContents);
    previousMoved = true;
    renameSync(stagedContents, targetContents);
    candidateInstalled = true;

    verifyApp(target);
    if (readVersion(target) !== expectedVersion) {
      throw new Error(`The installed App is not OpenGlance ${expectedVersion}`);
    }
    if (statSync(target).ino !== targetInode) {
      throw new Error("The App directory inode changed during Contents replacement");
    }
  } catch (error) {
    rollback();
    throw error;
  }

  return {
    installMode: "contents-bridge",
    appDirectoryInodePreserved: true,
    version: expectedVersion,
    commit() {
      if (settled) {
        return false;
      }
      settled = true;
      try {
        rmSync(previousContents, { recursive: true, force: false });
        previousMoved = false;
        rmSync(rollbackRoot, { recursive: true, force: false });
        return true;
      } catch {
        // The verified replacement is already running. Preserve a stale backup
        // rather than attempting a destructive rollback after confirmation.
        return false;
      }
    },
    rollback,
  };
}

export function replaceMacAppContents(options = {}) {
  const transaction = beginMacAppContentsReplacement(options);
  transaction.commit();
  return {
    installMode: transaction.installMode,
    appDirectoryInodePreserved: transaction.appDirectoryInodePreserved,
    version: transaction.version,
  };
}

function validatedAppDirectory(appPath, label) {
  const resolved = path.resolve(appPath || "");
  if (
    !appPath
    || !existsSync(resolved)
    || lstatSync(resolved).isSymbolicLink()
    || !lstatSync(resolved).isDirectory()
  ) {
    throw new Error(`Expected a non-symlink ${label} App directory: ${resolved}`);
  }
  return resolved;
}

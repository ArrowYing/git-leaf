import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const OFFICIAL_MAC_BUNDLE_ID = "com.mangofuture.gitleaf";
export const OFFICIAL_MAC_TEAM_IDENTIFIER = "HN6X79BUSR";

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

export function verifySignedMacApp(appPath) {
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
    || !identity.includes(`Identifier=${OFFICIAL_MAC_BUNDLE_ID}`)
    || !identity.includes(`TeamIdentifier=${OFFICIAL_MAC_TEAM_IDENTIFIER}`)
  ) {
    throw new Error("The App is not signed as the official Mango Future Git Leaf");
  }
  return true;
}

export function assertMacAppNotRunning(appPath) {
  const executable = path.join(appPath, "Contents", "MacOS", "Git Leaf");
  const processes = spawnSync("ps", ["-axo", "command="], { encoding: "utf8" });
  if (
    String(processes.stdout || "")
      .split("\n")
      .some((command) => command.trim().startsWith(executable))
  ) {
    throw new Error(`Refusing to update a running App: ${appPath}`);
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
    throw new Error(`The source App is not Git Leaf ${expectedVersion}`);
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
      throw new Error(`The installed App is not Git Leaf ${expectedVersion}`);
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

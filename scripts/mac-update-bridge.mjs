#!/usr/bin/env node

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
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const GIT_LEAF_BUNDLE_ID = "com.mangofuture.gitleaf";
const MANGO_FUTURE_TEAM_ID = "HN6X79BUSR";

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
    || !identity.includes(`Identifier=${GIT_LEAF_BUNDLE_ID}`)
    || !identity.includes(`TeamIdentifier=${MANGO_FUTURE_TEAM_ID}`)
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

export function replaceMacAppContents({
  sourceAppPath,
  targetAppPath,
  expectedVersion,
  verifyApp = verifySignedMacApp,
  readVersion = readMacAppVersion,
  copyContents = (source, destination) => {
    runChecked("ditto", [source, destination]);
  },
} = {}) {
  const source = path.resolve(sourceAppPath || "");
  const target = path.resolve(targetAppPath || "");
  if (!sourceAppPath || !targetAppPath || source === target) {
    throw new Error("The source and target App paths must be distinct");
  }
  for (const appPath of [source, target]) {
    if (
      !existsSync(appPath)
      || lstatSync(appPath).isSymbolicLink()
      || !lstatSync(appPath).isDirectory()
    ) {
      throw new Error(`Expected a non-symlink App directory: ${appPath}`);
    }
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
    rmSync(previousContents, { recursive: true, force: false });
    previousMoved = false;
    rmSync(rollbackRoot, { recursive: true, force: false });
    return {
      installMode: "contents-bridge",
      appDirectoryInodePreserved: true,
      version: expectedVersion,
    };
  } catch (error) {
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
    throw error;
  }
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? String(args[index + 1] || "").trim() : "";
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage:
  node scripts/mac-update-bridge.mjs
    --source-app /path/to/signed/Git\\ Leaf.app
    --target-app /Applications/Git\\ Leaf.app
    --expected-version VERSION

The target App must already be stopped and writable by the current user. The
bridge replaces only Contents, verifies the final signature and version, and
rolls back on failure. It never invokes a privileged Helper.`);
}

function main(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const sourceAppPath = optionValue(args, "--source-app");
  const targetAppPath = optionValue(args, "--target-app");
  const expectedVersion = optionValue(args, "--expected-version");
  assertMacAppNotRunning(targetAppPath);
  const result = replaceMacAppContents({
    sourceAppPath,
    targetAppPath,
    expectedVersion,
  });
  console.log(
    `Installed Git Leaf ${result.version} by nonprivileged Contents replacement`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

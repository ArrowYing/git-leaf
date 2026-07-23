#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertReleaseVersionIsNew,
  compactTimestamp,
  ensureReleaseGitTag,
  packageVersion,
  releaseTagName,
} from "./release-shared.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const RELEASE_STATE_FILE = "git-leaf-release-state.json";
const UPDATE_REGRESSION_RISK_PATHS = new Set([
  "assets/entitlements.mac.plist",
  "desktop/update-check-schedule.mjs",
  "desktop/updates.mjs",
  "public/update-ui.js",
  "scripts/gitleaf-update-server.py",
  "scripts/install-gitleaf-update-server.sh",
  "scripts/release-mac.mjs",
  "scripts/release-shared.mjs",
  "scripts/release-windows.mjs",
  "src/app-updates.mjs",
  "src/desktop-config.mjs",
  "src/update-publish.mjs",
  "src/windows-app-install.mjs",
  "src/windows-app-update.mjs",
  "src/windows-install-progress.mjs",
]);
const UPDATE_REGRESSION_CONTENT_RISK_PATTERNS = new Map([
  ["desktop/main.mjs", /\b(?:autoUpdater|checkForUpdates|createDesktopUpdateController|createUpdateCheckScheduler|desktopUpdateStatus|DESKTOP_INSTALL_UPDATE_ACTION|git-leaf-desktop-update-status|hasPendingUpdateOnQuit|installPendingUpdateOnQuit|preparePendingUpdateOnQuit|requestQuitForUpdate|restoreKnownUpdate|updateCheckScheduler|updateController)\b|desktop\/(?:update-check-schedule|updates)\.mjs/],
]);
const UPDATE_REGRESSION_DEPENDENCIES = [
  "@electron/packager",
  "electron",
  "extract-zip",
];

export const RELEASE_RUN_COMMANDS = {
  mac: new Set([
    "check-version",
    "check-prereqs",
    "test",
    "package",
    "sign",
    "dmg",
    "notarize",
    "staple",
    "zip",
    "verify",
    "stage-updates",
    "publish-updates",
  ]),
  windows: new Set([
    "check-version",
    "test",
    "package",
    "zip",
    "verify",
    "stage-updates",
    "publish-updates",
  ]),
};

export function defaultReleaseWorktreePath({ sourceRoot, version }) {
  return path.join(
    path.dirname(sourceRoot),
    ".release-worktrees",
    `${path.basename(sourceRoot)}-v${version}`,
  );
}

export function releaseIdentity({ version, commit, now = () => new Date() }) {
  const builtAt = now().toISOString();
  const shortCommit = commit.slice(0, 12);
  return {
    version,
    commit,
    builtAt,
    buildId: `${shortCommit}.${compactTimestamp(builtAt)}`,
  };
}

export function releaseEnvironment(state, { channel } = {}) {
  return {
    VERSION: state.version,
    GIT_COMMIT: state.commit.slice(0, 12),
    RELEASE_COMMIT: state.commit,
    BUILT_AT: state.builtAt,
    BUILD_ID: state.buildId,
    ...(channel ? { UPDATE_CHANNEL: channel } : {}),
  };
}

export function sanitizedReleaseProcessEnvironment(baseEnvironment = process.env) {
  const environment = { ...baseEnvironment };
  for (const variable of [
    "GIT_LEAF_DEV_USER_DATA_DIR",
    "GIT_LEAF_ENABLE_UPDATES",
    "GIT_LEAF_PORTABLE",
    "GIT_LEAF_TELEMETRY_ENDPOINT",
    "GIT_LEAF_UPDATE_BASE_URL",
    "GIT_LEAF_UPDATE_CHANNEL",
  ]) {
    delete environment[variable];
  }
  return environment;
}

export function releaseHasCompleted(state, { action, platform, channel } = {}) {
  return (state.history || []).some((entry) => (
    entry.outcome === "completed"
    && entry.action === action
    && (!platform || entry.platform === platform)
    && (!channel || entry.channel === channel)
  ));
}

export function updateRegressionRiskForPath(filePath, { changedLines = "" } = {}) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  if (UPDATE_REGRESSION_RISK_PATHS.has(normalizedPath)) {
    return true;
  }
  const contentPattern = UPDATE_REGRESSION_CONTENT_RISK_PATTERNS.get(normalizedPath);
  return contentPattern ? contentPattern.test(String(changedLines || "")) : false;
}

export function assessUpdateRegression({
  baseTag = null,
  changedFiles = [],
  changedFileDiffs = {},
  previousDependencies = {},
  currentDependencies = {},
  forcedReason,
  now = () => new Date(),
} = {}) {
  const riskyChangedFiles = changedFiles
    .map((filePath) => filePath.replaceAll("\\", "/"))
    .filter((filePath) => updateRegressionRiskForPath(filePath, {
      changedLines: changedFileDiffs[filePath],
    }))
    .sort();
  const dependencyChanges = UPDATE_REGRESSION_DEPENDENCIES
    .filter((dependency) => previousDependencies[dependency] !== currentDependencies[dependency])
    .map((dependency) => ({
      dependency,
      from: previousDependencies[dependency] || null,
      to: currentDependencies[dependency] || null,
    }));
  const reasons = [];

  if (!baseTag) {
    reasons.push("No previous formal release tag is available");
  }
  if (riskyChangedFiles.length > 0) {
    reasons.push(`Update-sensitive files changed: ${riskyChangedFiles.join(", ")}`);
  }
  if (dependencyChanges.length > 0) {
    reasons.push(`Update-sensitive dependencies changed: ${dependencyChanges
      .map(({ dependency, from, to }) => `${dependency} ${from || "missing"} -> ${to || "missing"}`)
      .join(", ")}`);
  }
  if (forcedReason?.trim()) {
    reasons.push(`Release operator required update regression: ${forcedReason.trim()}`);
  }

  const required = reasons.length > 0;
  return {
    required,
    status: required ? "pending" : "not_required",
    baseTag,
    assessedAt: now().toISOString(),
    reasons,
    changedFiles: riskyChangedFiles,
    dependencyChanges,
  };
}

export function assertCandidateGateComplete(state) {
  if (!state.candidateArtifactsVerifiedAt) {
    throw new Error(
      "Candidate artifacts have not been verified. Run mark-candidate-verified before publishing stable.",
    );
  }

  const regression = state.updateRegression;
  if (!regression) {
    throw new Error("Update regression risk has not been assessed; prepare a new release");
  }
  if (regression.required && regression.status !== "verified") {
    throw new Error(
      "Update regression smoke is required but has not been recorded. Run mark-update-regression-verified before publishing stable.",
    );
  }
  if (!regression.required && regression.status !== "not_required") {
    throw new Error("Update regression assessment is unresolved; prepare a new release");
  }
}

export function assertReleaseRunAllowed({ state, platform, command, channel }) {
  if (!RELEASE_RUN_COMMANDS[platform]?.has(command)) {
    throw new Error(`Unsupported formal release command: ${platform} ${command}`);
  }

  const isUpdateCommand = command === "stage-updates" || command === "publish-updates";
  if (isUpdateCommand && !["candidate", "stable"].includes(channel)) {
    throw new Error(`${command} requires --channel candidate or --channel stable`);
  }
  if (!isUpdateCommand && channel) {
    throw new Error(`--channel is only valid for stage-updates and publish-updates`);
  }
  if (command === "publish-updates" && channel === "stable") {
    assertCandidateGateComplete(state);
  }
}

export function assertCandidateCanBeMarked(state) {
  for (const platform of ["mac", "windows"]) {
    if (!releaseHasCompleted(state, {
      action: "publish-updates",
      platform,
      channel: "candidate",
    })) {
      throw new Error(`Candidate ${platform} artifacts have not been published from this release worktree`);
    }
  }
}

export function assertReleaseCanBeTagged(state) {
  assertCandidateGateComplete(state);
  for (const platform of ["mac", "windows"]) {
    if (!releaseHasCompleted(state, {
      action: "publish-updates",
      platform,
      channel: "stable",
    })) {
      throw new Error(`Stable ${platform} artifacts have not been published from this release worktree`);
    }
  }
}

function gitCommonDir(rootDir) {
  return gitOutput(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: rootDir,
  }).trim();
}

function releaseStatePath(rootDir) {
  return path.join(gitCommonDir(rootDir), RELEASE_STATE_FILE);
}

function readReleaseState(rootDir = REPO_ROOT) {
  const statePath = releaseStatePath(rootDir);
  if (!existsSync(statePath)) {
    throw new Error("No active Git Leaf release. Run release:prepare first.");
  }
  return { statePath, state: JSON.parse(readFileSync(statePath, "utf8")) };
}

function writeReleaseState(statePath, state, { exclusive = false } = {}) {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    flag: exclusive ? "wx" : "w",
  });
}

function refreshMainAndTags(sourceRoot) {
  run("git", ["fetch", "--quiet", "origin", "main", "--tags"], { cwd: sourceRoot });
}

function previousReleaseTag({ sourceRoot, commit }) {
  return gitOutput(
    ["tag", "--merged", commit, "--list", "v*", "--sort=-v:refname"],
    { cwd: sourceRoot },
  ).trim().split("\n").find(Boolean) || null;
}

function changedFilesSince({ sourceRoot, baseTag, commit }) {
  const args = baseTag
    ? ["diff", "--name-only", `${baseTag}..${commit}`]
    : ["ls-tree", "-r", "--name-only", commit];
  return gitOutput(args, { cwd: sourceRoot }).trim().split("\n").filter(Boolean);
}

function changedFileDiffsSince({ sourceRoot, baseTag, commit, changedFiles }) {
  if (!baseTag) return {};
  return Object.fromEntries(changedFiles
    .filter((filePath) => UPDATE_REGRESSION_CONTENT_RISK_PATTERNS.has(filePath))
    .map((filePath) => {
      const patch = gitOutput([
        "diff",
        "--unified=0",
        "--no-ext-diff",
        `${baseTag}..${commit}`,
        "--",
        filePath,
      ], { cwd: sourceRoot });
      const changedLines = patch.split(/\r?\n/)
        .filter((line) => (/^[+-]/.test(line) && !/^(?:---|\+\+\+)/.test(line)))
        .join("\n");
      return [filePath, changedLines];
    }));
}

function packageLockAtRevision({ sourceRoot, revision }) {
  if (!revision) return null;
  const result = gitResult(["show", `${revision}:package-lock.json`], { cwd: sourceRoot });
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout);
}

function updateDependencyVersions(packageLock) {
  if (!packageLock) return {};
  return Object.fromEntries(UPDATE_REGRESSION_DEPENDENCIES.map((dependency) => [
    dependency,
    packageLock.packages?.[`node_modules/${dependency}`]?.version || null,
  ]));
}

function assessUpdateRegressionForCommit({ sourceRoot, commit, forcedReason }) {
  const baseTag = previousReleaseTag({ sourceRoot, commit });
  const changedFiles = changedFilesSince({ sourceRoot, baseTag, commit });
  return assessUpdateRegression({
    baseTag,
    changedFiles,
    changedFileDiffs: changedFileDiffsSince({ sourceRoot, baseTag, commit, changedFiles }),
    previousDependencies: updateDependencyVersions(packageLockAtRevision({
      sourceRoot,
      revision: baseTag,
    })),
    currentDependencies: updateDependencyVersions(packageLockAtRevision({
      sourceRoot,
      revision: commit,
    })),
    forcedReason,
  });
}

function validateReleaseState(state, { refreshRemote = false } = {}) {
  if (!existsSync(state.worktreePath)) {
    throw new Error(`Release worktree is missing: ${state.worktreePath}`);
  }
  if (refreshRemote) {
    refreshMainAndTags(state.sourceRoot);
  }

  const head = gitOutput(["rev-parse", "HEAD"], { cwd: state.worktreePath }).trim();
  if (head !== state.commit) {
    throw new Error(`Release HEAD changed: expected ${state.commit}, found ${head}`);
  }

  const branch = gitResult(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: state.worktreePath,
  });
  if (branch.status === 0) {
    throw new Error(`Release worktree must stay detached, found branch ${branch.stdout.trim()}`);
  }

  const status = gitOutput(["status", "--porcelain", "--untracked-files=all"], {
    cwd: state.worktreePath,
  }).trim();
  if (status) {
    throw new Error(`Release worktree is not clean:\n${status}`);
  }

  const currentVersion = packageVersion({ rootDir: state.worktreePath });
  if (currentVersion !== state.version) {
    throw new Error(`Release version changed: expected ${state.version}, found ${currentVersion}`);
  }

  const ancestor = gitResult(
    ["merge-base", "--is-ancestor", state.commit, "origin/main"],
    { cwd: state.sourceRoot },
  );
  if (ancestor.status !== 0) {
    throw new Error(
      `Frozen release commit ${state.commit} is no longer an ancestor of origin/main; abort the release`,
    );
  }
}

function prepareRelease({
  worktreePath,
  skipInstall = false,
  requireUpdateRegressionReason,
} = {}) {
  const statePath = releaseStatePath(REPO_ROOT);
  if (existsSync(statePath)) {
    const active = JSON.parse(readFileSync(statePath, "utf8"));
    throw new Error(
      `Release ${active.version} is already active at ${active.worktreePath}. Finish or abort it first.`,
    );
  }

  refreshMainAndTags(REPO_ROOT);
  const branch = gitOutput(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: REPO_ROOT,
  }).trim();
  if (branch !== "main") {
    throw new Error(`release:prepare must run from main, found ${branch || "detached HEAD"}`);
  }

  const status = gitOutput(["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO_ROOT,
  }).trim();
  if (status) {
    throw new Error(`main worktree is not clean:\n${status}`);
  }

  const commit = gitOutput(["rev-parse", "HEAD"], { cwd: REPO_ROOT }).trim();
  const remoteCommit = gitOutput(["rev-parse", "origin/main"], { cwd: REPO_ROOT }).trim();
  if (commit !== remoteCommit) {
    throw new Error(`main is not synchronized with origin/main: ${commit} != ${remoteCommit}`);
  }

  const version = packageVersion({ rootDir: REPO_ROOT });
  assertReleaseVersionIsNew({ rootDir: REPO_ROOT, version });
  const identity = releaseIdentity({ version, commit });
  const updateRegression = assessUpdateRegressionForCommit({
    sourceRoot: REPO_ROOT,
    commit,
    forcedReason: requireUpdateRegressionReason,
  });
  const resolvedWorktreePath = path.resolve(
    worktreePath || defaultReleaseWorktreePath({ sourceRoot: REPO_ROOT, version }),
  );
  if (existsSync(resolvedWorktreePath)) {
    throw new Error(`Release worktree path already exists: ${resolvedWorktreePath}`);
  }

  const state = {
    schemaVersion: 2,
    status: "active",
    sourceRoot: REPO_ROOT,
    worktreePath: resolvedWorktreePath,
    ...identity,
    preparedAt: new Date().toISOString(),
    updateRegression,
    history: [{
      action: "update-regression-assessment",
      outcome: updateRegression.required ? "required" : "not-required",
      completedAt: updateRegression.assessedAt,
      baseTag: updateRegression.baseTag,
      reasons: updateRegression.reasons,
    }],
  };

  mkdirSync(path.dirname(resolvedWorktreePath), { recursive: true });
  let lockCreated = false;
  try {
    writeReleaseState(statePath, state, { exclusive: true });
    lockCreated = true;
    run("git", ["worktree", "prune"], { cwd: REPO_ROOT });
    run("git", ["worktree", "add", "--detach", resolvedWorktreePath, commit], { cwd: REPO_ROOT });
    if (!skipInstall) {
      const environment = sanitizedReleaseProcessEnvironment();
      run("npm", ["ci"], { cwd: resolvedWorktreePath, env: environment });
      run("npm", ["run", "test:all"], { cwd: resolvedWorktreePath, env: environment });
      state.history.push({
        action: "test:all",
        outcome: "completed",
        completedAt: new Date().toISOString(),
      });
      writeReleaseState(statePath, state);
    }
    validateReleaseState(state);
  } catch (error) {
    if (lockCreated) {
      removeReleaseWorktree(state, { statePath });
    }
    throw error;
  }

  printReleaseSummary(state, "Prepared immutable release worktree");
}

function runReleaseStep({ platform, command, channel }) {
  const { statePath, state } = readReleaseState();
  assertReleaseRunAllowed({ state, platform, command, channel });
  const changesExternalState = command === "publish-updates";
  validateReleaseState(state, { refreshRemote: changesExternalState });

  const scriptName = platform === "mac" ? "release-mac.mjs" : "release-windows.mjs";
  const scriptPath = path.join(state.worktreePath, "scripts", scriptName);
  const result = run(process.execPath, [scriptPath, command], {
    cwd: state.worktreePath,
    env: {
      ...sanitizedReleaseProcessEnvironment(),
      ...releaseEnvironment(state, { channel }),
    },
    returnResult: true,
  });

  state.history.push({
    action: command,
    platform,
    ...(channel ? { channel } : {}),
    outcome: result.status === 0 ? "completed" : "failed",
    completedAt: new Date().toISOString(),
  });
  writeReleaseState(statePath, state);
  if (result.status !== 0) {
    throw new Error(`Release step failed: ${platform} ${command}`);
  }
}

function markCandidateVerified() {
  const { statePath, state } = readReleaseState();
  validateReleaseState(state, { refreshRemote: true });
  assertCandidateCanBeMarked(state);
  state.candidateArtifactsVerifiedAt = new Date().toISOString();
  state.history.push({
    action: "candidate-artifacts",
    outcome: "completed",
    completedAt: state.candidateArtifactsVerifiedAt,
  });
  writeReleaseState(statePath, state);
  console.log(`Recorded candidate artifact verification for Git Leaf ${state.version}`);
}

function markUpdateRegressionVerified() {
  const { statePath, state } = readReleaseState();
  validateReleaseState(state, { refreshRemote: true });
  assertCandidateCanBeMarked(state);
  if (!state.candidateArtifactsVerifiedAt) {
    throw new Error("Verify candidate artifacts before recording update regression smoke");
  }
  if (!state.updateRegression?.required) {
    throw new Error("Update regression smoke is not required for this release");
  }
  state.updateRegression.status = "verified";
  state.updateRegression.verifiedAt = new Date().toISOString();
  state.history.push({
    action: "update-regression-smoke",
    outcome: "completed",
    completedAt: state.updateRegression.verifiedAt,
  });
  writeReleaseState(statePath, state);
  console.log(`Recorded update regression smoke for Git Leaf ${state.version}`);
}

function createReleaseTag() {
  const { statePath, state } = readReleaseState();
  validateReleaseState(state, { refreshRemote: true });
  assertReleaseCanBeTagged(state);
  const result = ensureReleaseGitTag({
    rootDir: state.worktreePath,
    version: state.version,
  });
  state.history.push({
    action: "tag",
    outcome: "completed",
    completedAt: new Date().toISOString(),
  });
  writeReleaseState(statePath, state);
  console.log(`${result.created ? "Created" : "Verified"} ${result.tagName} at ${result.commit}`);
}

function pushReleaseTag() {
  const { statePath, state } = readReleaseState();
  validateReleaseState(state, { refreshRemote: true });
  assertReleaseCanBeTagged(state);
  const tagName = releaseTagName({ version: state.version });
  assertLocalTag(state, tagName);
  run("git", ["push", "origin", tagName], { cwd: state.worktreePath });
  assertRemoteTag(state, tagName);
  state.history.push({
    action: "push-tag",
    outcome: "completed",
    completedAt: new Date().toISOString(),
  });
  writeReleaseState(statePath, state);
}

function finishRelease() {
  const { statePath, state } = readReleaseState();
  validateReleaseState(state, { refreshRemote: true });
  assertReleaseCanBeTagged(state);
  const tagName = releaseTagName({ version: state.version });
  assertRemoteTag(state, tagName);
  const receiptDir = path.join(state.sourceRoot, "dist", "release-receipts");
  mkdirSync(receiptDir, { recursive: true });
  writeFileSync(
    path.join(receiptDir, `${tagName}.json`),
    `${JSON.stringify({ ...state, status: "completed", finishedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  removeReleaseWorktree(state, { statePath });
  console.log(`Finished ${tagName}; release worktree and local lock removed`);
}

function abortRelease() {
  const { statePath, state } = readReleaseState();
  if (releaseHasCompleted(state, { action: "publish-updates", channel: "stable" })) {
    throw new Error("Stable artifacts were already published; repair and finish this release instead of aborting it");
  }
  const tagName = releaseTagName({ version: state.version });
  if (remoteTagCommit(state, tagName)) {
    throw new Error(`Remote tag ${tagName} already exists; finish this release instead of aborting it`);
  }
  removeReleaseWorktree(state, { statePath });
  console.log(`Aborted Git Leaf ${state.version}; release worktree and local lock removed`);
}

function removeReleaseWorktree(state, { statePath }) {
  if (existsSync(state.worktreePath)) {
    run("git", ["worktree", "remove", "--force", state.worktreePath], { cwd: state.sourceRoot });
  }
  run("git", ["worktree", "prune"], { cwd: state.sourceRoot });
  rmSync(statePath, { force: true });
}

function assertLocalTag(state, tagName) {
  const commit = gitOutput(["rev-parse", `${tagName}^{}`], { cwd: state.worktreePath }).trim();
  if (commit !== state.commit) {
    throw new Error(`Local tag ${tagName} points to ${commit}, expected ${state.commit}`);
  }
}

function remoteTagCommit(state, tagName) {
  const result = gitResult(
    ["ls-remote", "--tags", "origin", `refs/tags/${tagName}`, `refs/tags/${tagName}^{}`],
    { cwd: state.sourceRoot },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `Could not read remote tag ${tagName}`);
  }
  const entries = result.stdout.trim().split("\n").filter(Boolean);
  const peeled = entries.find((line) => line.endsWith(`refs/tags/${tagName}^{}`));
  const direct = entries.find((line) => line.endsWith(`refs/tags/${tagName}`));
  return (peeled || direct)?.split(/\s+/)[0];
}

function assertRemoteTag(state, tagName) {
  const commit = remoteTagCommit(state, tagName);
  if (commit !== state.commit) {
    throw new Error(`Remote tag ${tagName} points to ${commit || "nothing"}, expected ${state.commit}`);
  }
}

function printStatus({ refreshRemote = false } = {}) {
  const { state } = readReleaseState();
  validateReleaseState(state, { refreshRemote });
  printReleaseSummary(state, "Release worktree is valid");
}

function printEnvironment() {
  const { state } = readReleaseState();
  validateReleaseState(state);
  const values = {
    RELEASE_WORKTREE: state.worktreePath,
    ...releaseEnvironment(state),
  };
  for (const [key, value] of Object.entries(values)) {
    console.log(`export ${key}=${shellQuote(value)}`);
  }
}

function printReleaseSummary(state, heading) {
  console.log(`${heading}:`);
  console.log(`  version:   ${state.version}`);
  console.log(`  commit:    ${state.commit}`);
  console.log(`  build id:  ${state.buildId}`);
  console.log(`  worktree:  ${state.worktreePath}`);
  console.log(`  candidate artifacts: ${state.candidateArtifactsVerifiedAt ? "verified" : "pending"}`);
  if (state.updateRegression) {
    const base = state.updateRegression.baseTag ? ` since ${state.updateRegression.baseTag}` : "";
    console.log(`  update regression: ${state.updateRegression.required ? state.updateRegression.status : "not required"}${base}`);
    for (const reason of state.updateRegression.reasons) {
      console.log(`    - ${reason}`);
    }
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function gitOutput(args, { cwd }) {
  const result = gitResult(args, { cwd });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Command failed: git ${args.join(" ")}`);
  }
  return result.stdout;
}

function gitResult(args, { cwd }) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function run(command, args, {
  cwd = REPO_ROOT,
  env = process.env,
  returnResult = false,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (!returnResult && result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
  return result;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/release-worktree.mjs <command>

Commands:
  prepare [--worktree PATH] [--skip-install] [--require-update-regression REASON]
      Freeze origin/main into a detached release worktree, run npm ci and test:all
  status [--remote]
      Validate the frozen commit, clean worktree, version, and main ancestry
  env
      Print shell exports for the frozen release identity
  run <mac|windows> <command> [--channel candidate|stable]
      Run one guarded platform release step inside the release worktree
  mark-candidate-verified
      Record candidate manifests, downloads, signatures, and packages as verified
  mark-update-regression-verified
      Record the real-App update smoke when prepare marked it as required
  tag
      Create the version tag after both stable packages were published
  push-tag
      Push and verify the version tag
  finish
      Save a local receipt and remove the release worktree and lock
  abort
      Remove a pre-stable release worktree and lock
`);
}

function main(args = process.argv.slice(2)) {
  const [command, platform, releaseCommand] = args;
  switch (command) {
    case "prepare":
      return prepareRelease({
        worktreePath: optionValue(args, "--worktree"),
        skipInstall: args.includes("--skip-install"),
        requireUpdateRegressionReason: optionValue(args, "--require-update-regression"),
      });
    case "status":
      return printStatus({ refreshRemote: args.includes("--remote") });
    case "env":
      return printEnvironment();
    case "run":
      return runReleaseStep({
        platform,
        command: releaseCommand,
        channel: optionValue(args, "--channel"),
      });
    case "mark-candidate-verified":
      return markCandidateVerified();
    case "mark-update-regression-verified":
      return markUpdateRegressionVerified();
    case "tag":
      return createReleaseTag();
    case "push-tag":
      return pushReleaseTag();
    case "finish":
      return finishRelease();
    case "abort":
      return abortRelease();
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return printHelp();
    default:
      printHelp();
      throw new Error(`Unknown release worktree command: ${command}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

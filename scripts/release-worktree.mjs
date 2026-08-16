#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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
import { archiveReleaseOutputs } from "./release-archive.mjs";
import { validateMacUpdateRegressionEvidence } from "./mac-update-regression-evidence.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const RELEASE_STATE_FILE = "openglance-release-state.json";
const LEGACY_RELEASE_STATE_FILE = "git-leaf-release-state.json";
const RELEASE_VERSION_BASELINE = "1.11.2";
const LEGACY_INTERNAL_MIGRATION_VERSION = "1.11.3";
const GITHUB_RELEASE_REPOSITORY = "openglance/openglance";
const WINDOWS_RELEASE_SMOKE_WORKFLOW = "Windows Release Smoke";
const WINDOWS_RELEASE_SMOKE_WORKFLOW_PATH = ".github/workflows/windows-release-smoke.yml";
const WINDOWS_RELEASE_SMOKE_ARTIFACT_PREFIX = "openglance-windows-release-smoke-";
const LEGACY_WINDOWS_RELEASE_SMOKE_ARTIFACT_PREFIX = "git-leaf-windows-release-smoke-";
const WINDOWS_RELEASE_SMOKE_ARTIFACT_PREFIXES = [
  WINDOWS_RELEASE_SMOKE_ARTIFACT_PREFIX,
  LEGACY_WINDOWS_RELEASE_SMOKE_ARTIFACT_PREFIX,
];
const WINDOWS_RELEASE_SMOKE_EVENTS = new Set(["push", "workflow_dispatch"]);
const RELEASE_TRACKS = new Set(["public", "internal"]);
const RELEASE_CHANNELS = {
  public: {
    candidate: "candidate",
    stable: "stable",
  },
  internal: {
    candidate: "internal-candidate",
    stable: "internal-stable",
    "legacy-stable": "stable",
  },
};
const DRIFTABLE_RELEASE_ENVIRONMENT_VARIABLES = [
  "APPLICATIONS_DIR",
  "BUILD_ID",
  "BUILT_AT",
  "DEVELOPER_ID_APPLICATION",
  "DMG_LOCALE",
  "ELECTRON_MIRROR",
  "ELECTRON_ZIP_DIR",
  "ENTITLEMENTS_PATH",
  "GIT_COMMIT",
  "GIT_LEAF_DEV_USER_DATA_DIR",
  "GIT_LEAF_DISTRIBUTION",
  "GIT_LEAF_ENABLE_UPDATES",
  "GIT_LEAF_FORMAL_RELEASE",
  "GIT_LEAF_PORTABLE",
  "GIT_LEAF_RELEASE_PROFILE",
  "GIT_LEAF_SMOKE_FILE",
  "GIT_LEAF_SMOKE_REPO_ROOT",
  "GIT_LEAF_SMOKE_USER_DATA_DIR",
  "GIT_LEAF_TELEMETRY_ENDPOINT",
  "GIT_LEAF_UPDATE_BASE_URL",
  "GIT_LEAF_UPDATE_CHANNEL",
  "GIT_LEAF_USAGE_ANALYTICS_DEFAULT",
  "OPENGLANCE_DEV_USER_DATA_DIR",
  "OPENGLANCE_DISTRIBUTION",
  "OPENGLANCE_ENABLE_UPDATES",
  "OPENGLANCE_FORMAL_RELEASE",
  "OPENGLANCE_PORTABLE",
  "OPENGLANCE_RELEASE_PROFILE",
  "OPENGLANCE_SMOKE_FILE",
  "OPENGLANCE_SMOKE_REPO_ROOT",
  "OPENGLANCE_SMOKE_USER_DATA_DIR",
  "OPENGLANCE_TELEMETRY_ENDPOINT",
  "OPENGLANCE_UPDATE_BASE_URL",
  "OPENGLANCE_UPDATE_CHANNEL",
  "OPENGLANCE_USAGE_ANALYTICS_DEFAULT",
  "ICON_PATH",
  "NOTARY_PROFILE",
  "RELEASE_COMMIT",
  "UPDATE_BASE_URL",
  "UPDATE_CHANNEL",
  "UPDATE_REMOTE_HOST",
  "UPDATE_REMOTE_ROOT",
  "VERSION",
];
const UPDATE_REGRESSION_RISK_PATHS = new Set([
  "assets/entitlements.mac.plist",
  "src/desktop/update-check-schedule.mjs",
  "src/desktop/updates.mjs",
  "public/update-ui.js",
  "scripts/openglance-update-server.py",
  "scripts/install-openglance-update-server.sh",
  "scripts/mac-update-bridge.mjs",
  "scripts/mac-update-regression-evidence.mjs",
  "scripts/mac-update-regression.mjs",
  "scripts/release-shared.mjs",
  "scripts/release-windows.mjs",
  "scripts/squirrel-mac-policy.mjs",
  "src/desktop/app-updates.mjs",
  "src/desktop/config.mjs",
  "scripts/update-publish.mjs",
  "src/desktop/windows-app-install.mjs",
  "src/desktop/windows-app-update.mjs",
  "src/desktop/windows-install-progress.mjs",
]);
const UPDATE_REGRESSION_CONTENT_RISK_PATTERNS = new Map([
  ["src/desktop/main.mjs", /\b(?:autoUpdater|checkForUpdates|createDesktopUpdateController|createUpdateCheckScheduler|desktopUpdateStatus|DESKTOP_INSTALL_UPDATE_ACTION|git-leaf-desktop-update-status|hasPendingUpdateOnQuit|installPendingUpdateOnQuit|preparePendingUpdateOnQuit|requestQuitForUpdate|restoreKnownUpdate|updateCheckScheduler|updateController)\b|(?:\.\/)?(?:update-check-schedule|updates)\.mjs/],
  ["scripts/release-mac.mjs", /\b(?:buildUpdateManifest|createZip|electronPackagerArgs|macReleasePaths|macUpdateMetadataPaths|packageMac|patchSquirrelMacPolicy|publishMacUpdates|releaseBuildInfoFromEnv|releaseOptionsFromEnv|releasePackageIdentity|releaseTrack|Squirrel|ShipIt|stageMacUpdateMetadata|updateChannel|verifySquirrelMacPolicy|withReleaseBuildInfoFile|writeUpdateManifests)\b/],
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
    OPENGLANCE_FORMAL_RELEASE: "1",
    OPENGLANCE_RELEASE_PROFILE: state.releaseProfile.path,
    GIT_LEAF_FORMAL_RELEASE: "1",
    GIT_LEAF_RELEASE_PROFILE: state.releaseProfile.path,
    ...(channel ? { UPDATE_CHANNEL: channel } : {}),
  };
}

export function sanitizedReleaseProcessEnvironment(baseEnvironment = process.env) {
  const environment = { ...baseEnvironment };
  for (const variable of DRIFTABLE_RELEASE_ENVIRONMENT_VARIABLES) {
    delete environment[variable];
  }
  return environment;
}

export function releaseHasCompleted(state, {
  action,
  platform,
  phase,
  channel,
  track,
} = {}) {
  return (state.history || []).some((entry) => (
    entry.outcome === "completed"
    && entry.action === action
    && (!platform || entry.platform === platform)
    && (!phase || entry.phase === phase)
    && (!channel || entry.channel === channel)
    && (!track || entry.track === track)
  ));
}

export function physicalUpdateChannel({ track, phase }) {
  const channel = RELEASE_CHANNELS[track]?.[phase];
  if (!channel) {
    throw new Error(`Unsupported ${track || "missing"} release channel phase: ${phase || "missing"}`);
  }
  return channel;
}

export function freezeReleaseProfile({ profilePath, track }) {
  if (!RELEASE_TRACKS.has(track)) {
    throw new Error("prepare requires --track public or --track internal");
  }
  if (!profilePath) {
    throw new Error("prepare requires --profile ABS");
  }
  if (!path.isAbsolute(profilePath)) {
    throw new Error("--profile must be an absolute path");
  }

  let canonicalPath;
  let contents;
  try {
    canonicalPath = realpathSync(profilePath);
    contents = readFileSync(canonicalPath);
  } catch (error) {
    throw new Error(`Could not read release profile: ${profilePath}`, { cause: error });
  }

  let profile;
  try {
    profile = JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`Release profile is not valid JSON: ${canonicalPath}`, { cause: error });
  }
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error(`Release profile must contain one JSON object: ${canonicalPath}`);
  }
  if (profile.distribution !== "official") {
    throw new Error(`Release profile distribution must be official: ${canonicalPath}`);
  }
  if (profile.releaseTrack !== track) {
    throw new Error(
      `Release profile track ${profile.releaseTrack || "missing"} does not match --track ${track}`,
    );
  }
  if (track === "public" && profile.legacyInternalMigrationConfirmed !== true) {
    throw new Error(
      "Public release profile requires legacyInternalMigrationConfirmed=true before stable can replace the internal migration bridge.",
    );
  }

  return {
    path: canonicalPath,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

export function assertFrozenReleaseProfile(state) {
  if (!RELEASE_TRACKS.has(state.track) || !state.releaseProfile?.path || !state.releaseProfile?.sha256) {
    throw new Error("Release state does not contain a frozen track and profile");
  }
  const current = freezeReleaseProfile({
    profilePath: state.releaseProfile.path,
    track: state.track,
  });
  if (current.path !== state.releaseProfile.path) {
    throw new Error(
      `Frozen release profile path changed: expected ${state.releaseProfile.path}, found ${current.path}`,
    );
  }
  if (current.sha256 !== state.releaseProfile.sha256) {
    throw new Error(
      `Frozen release profile changed: expected ${state.releaseProfile.sha256}, found ${current.sha256}`,
    );
  }
}

export function assertReleaseVersionAboveBaseline(
  version,
  { baseline = RELEASE_VERSION_BASELINE } = {},
) {
  if (compareReleaseVersions(version, baseline) <= 0) {
    throw new Error(
      `Release version ${version} must be newer than the migration baseline ${baseline}. ` +
        "Bump package.json before preparing the release.",
    );
  }
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

  assertWindowsReleaseSmokeVerified(state);

  const regression = state.updateRegression;
  if (!regression) {
    throw new Error("Update regression risk has not been assessed; prepare a new release");
  }
  if (regression.required && regression.status !== "verified") {
    throw new Error(
      "macOS Update Regression is required but has not been verified. Run the local harness, then verify-macos-update-regression --evidence FILE before publishing stable.",
    );
  }
  if (regression.required) {
    assertMacosUpdateRegressionVerified(state);
  }
  if (!regression.required && regression.status !== "not_required") {
    throw new Error("Update regression assessment is unresolved; prepare a new release");
  }
}

export function windowsReleaseSmokeEvidence({
  state,
  runId,
  run,
  artifacts,
  now = () => new Date(),
} = {}) {
  const normalizedRunId = String(runId || "").trim();
  if (!/^\d+$/.test(normalizedRunId)) {
    throw new Error("verify-windows-release-smoke requires a numeric GitHub Actions --run-id");
  }
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new Error(`GitHub Actions run ${normalizedRunId} did not return valid metadata`);
  }
  if (String(run.id || "") !== normalizedRunId) {
    throw new Error(`GitHub Actions returned a different run id for ${normalizedRunId}`);
  }
  if (run.repository?.full_name !== GITHUB_RELEASE_REPOSITORY) {
    throw new Error(
      `GitHub Actions run ${normalizedRunId} belongs to ${run.repository?.full_name || "an unknown repository"}, expected ${GITHUB_RELEASE_REPOSITORY}`,
    );
  }
  if (run.name !== WINDOWS_RELEASE_SMOKE_WORKFLOW) {
    throw new Error(
      `GitHub Actions run ${normalizedRunId} is ${run.name || "an unknown workflow"}, expected ${WINDOWS_RELEASE_SMOKE_WORKFLOW}`,
    );
  }
  if (run.path !== WINDOWS_RELEASE_SMOKE_WORKFLOW_PATH) {
    throw new Error(
      `Windows Release Smoke run ${normalizedRunId} used ${run.path || "an unknown workflow path"}, expected ${WINDOWS_RELEASE_SMOKE_WORKFLOW_PATH}`,
    );
  }
  if (run.head_sha !== state?.commit) {
    throw new Error(
      `Windows Release Smoke run ${normalizedRunId} tested ${run.head_sha || "an unknown commit"}, expected frozen release commit ${state?.commit || "missing"}`,
    );
  }
  if (!WINDOWS_RELEASE_SMOKE_EVENTS.has(run.event)) {
    throw new Error(`Windows Release Smoke run ${normalizedRunId} used unsupported event ${run.event || "unknown"}`);
  }
  if (run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(
      `Windows Release Smoke run ${normalizedRunId} is ${run.status || "unknown"}/${run.conclusion || "unknown"}, expected completed/success`,
    );
  }
  const url = String(run.html_url || "").trim();
  if (!url.endsWith(`/actions/runs/${normalizedRunId}`)) {
    throw new Error(`Windows Release Smoke run ${normalizedRunId} returned an unexpected URL`);
  }
  const artifactList = Array.isArray(artifacts?.artifacts) ? artifacts.artifacts : [];
  const artifact = artifactList.find((candidate) => (
    WINDOWS_RELEASE_SMOKE_ARTIFACT_PREFIXES.some((prefix) => (
      String(candidate.name || "").startsWith(prefix)
    ))
    && String(candidate.name || "").endsWith(`-${state.commit}`)
    && candidate.expired === false
    && Number(candidate.size_in_bytes) > 0
  ));
  if (!artifact) {
    throw new Error(
      `Windows Release Smoke run ${normalizedRunId} has no unexpired release-gate artifact for frozen release commit ${state.commit}`,
    );
  }

  return {
    status: "verified",
    repository: GITHUB_RELEASE_REPOSITORY,
    workflowName: WINDOWS_RELEASE_SMOKE_WORKFLOW,
    workflowPath: WINDOWS_RELEASE_SMOKE_WORKFLOW_PATH,
    runId: normalizedRunId,
    runAttempt: Number(run.run_attempt) || null,
    url,
    headSha: run.head_sha,
    event: run.event,
    runStatus: run.status,
    conclusion: run.conclusion,
    artifactId: String(artifact.id),
    artifactName: artifact.name,
    artifactSize: Number(artifact.size_in_bytes),
    verifiedAt: now().toISOString(),
  };
}

export function assertWindowsReleaseSmokeVerified(state) {
  const evidence = state.windowsReleaseSmoke;
  if (!evidence || evidence.status === "pending") {
    throw new Error(
      "Windows Release Smoke has not been verified. Run verify-windows-release-smoke --run-id ID before publishing stable.",
    );
  }
  if (
    evidence.status !== "verified"
    || evidence.repository !== GITHUB_RELEASE_REPOSITORY
    || evidence.workflowName !== WINDOWS_RELEASE_SMOKE_WORKFLOW
    || evidence.workflowPath !== WINDOWS_RELEASE_SMOKE_WORKFLOW_PATH
    || evidence.headSha !== state.commit
    || !WINDOWS_RELEASE_SMOKE_EVENTS.has(evidence.event)
    || evidence.runStatus !== "completed"
    || evidence.conclusion !== "success"
    || !/^\d+$/.test(String(evidence.runId || ""))
    || evidence.url !== `https://github.com/${GITHUB_RELEASE_REPOSITORY}/actions/runs/${evidence.runId}`
    || !/^\d+$/.test(String(evidence.artifactId || ""))
    || !WINDOWS_RELEASE_SMOKE_ARTIFACT_PREFIXES.some((prefix) => (
      String(evidence.artifactName || "").startsWith(prefix)
    ))
    || !String(evidence.artifactName || "").endsWith(`-${state.commit}`)
    || Number(evidence.artifactSize) <= 0
  ) {
    throw new Error(
      "Recorded Windows Release Smoke evidence does not match the frozen release commit and a successful workflow run.",
    );
  }
}

export function assertMacosUpdateRegressionVerified(state) {
  const evidence = state.updateRegression?.evidence;
  if (state.updateRegression?.status !== "verified" || !evidence) {
    throw new Error(
      "Recorded macOS Update Regression evidence is missing.",
    );
  }
  validateMacUpdateRegressionEvidence(evidence, state);
}

export function assertReleaseRunAllowed({ state, platform, command, channel }) {
  if (!RELEASE_RUN_COMMANDS[platform]?.has(command)) {
    throw new Error(`Unsupported formal release command: ${platform} ${command}`);
  }

  const isUpdateCommand = command === "stage-updates" || command === "publish-updates";
  const standardChannel = channel === "candidate" || channel === "stable";
  const legacyStable = isLegacyInternalMigrationRelease(state) && channel === "legacy-stable";
  if (channel === "legacy-stable" && !isLegacyInternalMigrationRelease(state)) {
    throw new Error("--channel legacy-stable is only valid for the internal 1.11.3 migration release");
  }
  if (isUpdateCommand && !standardChannel && !legacyStable) {
    const allowed = isLegacyInternalMigrationRelease(state) && command === "publish-updates"
      ? "--channel candidate, --channel stable, or --channel legacy-stable"
      : "--channel candidate or --channel stable";
    throw new Error(`${command} requires ${allowed}`);
  }
  if (!isUpdateCommand && channel) {
    throw new Error(`--channel is only valid for stage-updates and publish-updates`);
  }
  if (channel === "legacy-stable" && command !== "publish-updates") {
    throw new Error("--channel legacy-stable is only valid for publish-updates");
  }
  if (command === "publish-updates" && channel === "stable") {
    assertCandidateGateComplete(state);
  }
  if (command === "publish-updates" && channel === "legacy-stable") {
    assertPublicDownloadIsolationVerified(state);
    assertCandidateGateComplete(state);
    assertStablePublishedForTrack(state);
  }
}

export function assertCandidateCanBeMarked(state) {
  const physicalChannel = physicalUpdateChannel({
    track: state.track,
    phase: "candidate",
  });
  for (const platform of ["mac", "windows"]) {
    if (!releaseHasCompleted(state, {
      action: "publish-updates",
      platform,
      phase: "candidate",
      channel: physicalChannel,
      track: state.track,
    })) {
      throw new Error(
        `Candidate ${platform} artifacts for track ${state.track} have not been published from this release worktree`,
      );
    }
  }
}

function assertStablePublishedForTrack(state) {
  const physicalChannel = physicalUpdateChannel({
    track: state.track,
    phase: "stable",
  });
  for (const platform of ["mac", "windows"]) {
    if (!releaseHasCompleted(state, {
      action: "publish-updates",
      platform,
      phase: "stable",
      channel: physicalChannel,
      track: state.track,
    })) {
      throw new Error(
        `Stable ${platform} artifacts for track ${state.track} have not been published from this release worktree`,
      );
    }
  }
}

export function assertReleaseCanBeTagged(state) {
  assertCandidateGateComplete(state);
  assertStablePublishedForTrack(state);
  if (isLegacyInternalMigrationRelease(state)) {
    assertLegacyMigrationBridgeComplete(state);
  }
}

function isLegacyInternalMigrationRelease(state) {
  return state.track === "internal" && state.version === LEGACY_INTERNAL_MIGRATION_VERSION;
}

export function assertPublicDownloadIsolationCanBeMarked(state) {
  if (!isLegacyInternalMigrationRelease(state)) {
    throw new Error(
      "Public download isolation verification is only valid for the internal 1.11.3 migration release",
    );
  }
}

function assertPublicDownloadIsolationVerified(state) {
  if (!state.publicDownloadIsolationVerifiedAt) {
    throw new Error(
      "Public download isolation has not been verified. Run mark-public-download-isolation-verified before publishing legacy-stable.",
    );
  }
}

function assertLegacyMigrationBridgeComplete(state) {
  assertPublicDownloadIsolationVerified(state);
  const physicalChannel = physicalUpdateChannel({
    track: state.track,
    phase: "legacy-stable",
  });
  for (const platform of ["mac", "windows"]) {
    if (!releaseHasCompleted(state, {
      action: "publish-updates",
      platform,
      phase: "legacy-stable",
      channel: physicalChannel,
      track: state.track,
    })) {
      throw new Error(
        `Legacy stable ${platform} artifacts for internal 1.11.3 have not been published from this release worktree`,
      );
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

function legacyReleaseStatePath(rootDir) {
  return path.join(gitCommonDir(rootDir), LEGACY_RELEASE_STATE_FILE);
}

function activeReleaseStatePath(rootDir) {
  const canonicalPath = releaseStatePath(rootDir);
  return existsSync(canonicalPath) ? canonicalPath : legacyReleaseStatePath(rootDir);
}

function readReleaseState(rootDir = REPO_ROOT) {
  const statePath = activeReleaseStatePath(rootDir);
  if (!existsSync(statePath)) {
    throw new Error("No active OpenGlance release. Run release:prepare first.");
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
        .filter((line) => (
          /^@@/.test(line)
          || (/^[+-]/.test(line) && !/^(?:---|\+\+\+)/.test(line))
        ))
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
  assertFrozenReleaseProfile(state);
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
  track,
  profilePath,
} = {}) {
  const releaseProfile = freezeReleaseProfile({ profilePath, track });
  const statePath = releaseStatePath(REPO_ROOT);
  const existingStatePath = activeReleaseStatePath(REPO_ROOT);
  if (existsSync(existingStatePath)) {
    const active = JSON.parse(readFileSync(existingStatePath, "utf8"));
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
  assertReleaseVersionAboveBaseline(version);
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
    schemaVersion: 5,
    status: "active",
    sourceRoot: REPO_ROOT,
    worktreePath: resolvedWorktreePath,
    track,
    releaseProfile,
    ...identity,
    preparedAt: new Date().toISOString(),
    windowsReleaseSmoke: {
      status: "pending",
      repository: GITHUB_RELEASE_REPOSITORY,
      workflowPath: WINDOWS_RELEASE_SMOKE_WORKFLOW_PATH,
      headSha: commit,
    },
    updateRegression,
    history: [{
      action: "update-regression-assessment",
      track,
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
      const environment = {
        ...sanitizedReleaseProcessEnvironment(),
        ...releaseEnvironment(state),
      };
      run("npm", ["ci"], { cwd: resolvedWorktreePath, env: environment });
      run("npm", ["run", "test:all"], { cwd: resolvedWorktreePath, env: environment });
      state.history.push({
        action: "test:all",
        track: state.track,
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
  const physicalChannel = channel
    ? physicalUpdateChannel({ track: state.track, phase: channel })
    : undefined;

  const scriptName = platform === "mac" ? "release-mac.mjs" : "release-windows.mjs";
  const scriptPath = path.join(state.worktreePath, "scripts", scriptName);
  const result = run(process.execPath, [scriptPath, command], {
    cwd: state.worktreePath,
    env: {
      ...sanitizedReleaseProcessEnvironment(),
      ...releaseEnvironment(state, { channel: physicalChannel }),
    },
    returnResult: true,
  });

  state.history.push({
    action: command,
    platform,
    track: state.track,
    ...(channel ? { phase: channel, channel: physicalChannel } : {}),
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
    track: state.track,
    outcome: "completed",
    completedAt: state.candidateArtifactsVerifiedAt,
  });
  writeReleaseState(statePath, state);
  console.log(`Recorded candidate artifact verification for OpenGlance ${state.version}`);
}

function verifyWindowsReleaseSmoke(runId) {
  const { statePath, state } = readReleaseState();
  validateReleaseState(state, { refreshRemote: true });
  const normalizedRunId = String(runId || "").trim();
  const runMetadata = githubApiJson({
    endpoint: `repos/${GITHUB_RELEASE_REPOSITORY}/actions/runs/${normalizedRunId}`,
    cwd: state.sourceRoot,
  });
  const artifacts = githubApiJson({
    endpoint: `repos/${GITHUB_RELEASE_REPOSITORY}/actions/runs/${normalizedRunId}/artifacts`,
    cwd: state.sourceRoot,
  });
  const evidence = windowsReleaseSmokeEvidence({
    state,
    runId: normalizedRunId,
    run: runMetadata,
    artifacts,
  });
  state.windowsReleaseSmoke = evidence;
  state.history.push({
    action: "windows-release-smoke",
    track: state.track,
    outcome: "completed",
    completedAt: evidence.verifiedAt,
    runId: evidence.runId,
    runUrl: evidence.url,
    headSha: evidence.headSha,
    artifactId: evidence.artifactId,
    artifactName: evidence.artifactName,
  });
  writeReleaseState(statePath, state);
  console.log(
    `Recorded ${WINDOWS_RELEASE_SMOKE_WORKFLOW} run ${evidence.runId} for ${evidence.headSha}`,
  );
}

function verifyMacosUpdateRegression(evidencePath) {
  const { statePath, state } = readReleaseState();
  validateReleaseState(state, { refreshRemote: true });
  assertCandidateCanBeMarked(state);
  if (!state.candidateArtifactsVerifiedAt) {
    throw new Error(
      "Verify candidate artifacts before verifying macOS Update Regression",
    );
  }
  if (!state.updateRegression?.required) {
    throw new Error("macOS Update Regression is not required for this release");
  }
  const resolvedEvidencePath = path.resolve(String(evidencePath || ""));
  if (!evidencePath || !existsSync(resolvedEvidencePath)) {
    throw new Error(
      "verify-macos-update-regression requires an existing --evidence JSON file",
    );
  }
  const evidenceBytes = readFileSync(resolvedEvidencePath);
  let evidence;
  try {
    evidence = JSON.parse(evidenceBytes.toString("utf8"));
  } catch (error) {
    throw new Error("macOS update regression evidence is not valid JSON", {
      cause: error,
    });
  }
  validateMacUpdateRegressionEvidence(evidence, state);
  state.updateRegression.status = "verified";
  state.updateRegression.verifiedAt = new Date().toISOString();
  state.updateRegression.evidence = evidence;
  state.updateRegression.evidenceSha256 = createHash("sha256")
    .update(evidenceBytes)
    .digest("hex");
  state.history.push({
    action: "macos-update-regression",
    track: state.track,
    outcome: "completed",
    completedAt: state.updateRegression.verifiedAt,
    fromVersion: evidence.fromVersion,
    toVersion: evidence.toVersion,
    evidenceSha256: state.updateRegression.evidenceSha256,
  });
  writeReleaseState(statePath, state);
  console.log(
    `Recorded local macOS Update Regression ${evidence.fromVersion} -> ${evidence.toVersion}`,
  );
}

function githubApiJson({ endpoint, cwd }) {
  const result = spawnSync("gh", ["api", endpoint], {
    cwd,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `Could not inspect GitHub API endpoint ${endpoint}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`GitHub API endpoint ${endpoint} returned invalid JSON`, { cause: error });
  }
}

function markPublicDownloadIsolationVerified() {
  const { statePath, state } = readReleaseState();
  validateReleaseState(state, { refreshRemote: true });
  assertPublicDownloadIsolationCanBeMarked(state);
  state.publicDownloadIsolationVerifiedAt = new Date().toISOString();
  state.history.push({
    action: "public-download-isolation",
    track: state.track,
    outcome: "completed",
    completedAt: state.publicDownloadIsolationVerifiedAt,
  });
  writeReleaseState(statePath, state);
  console.log(
    `Recorded public download isolation verification for OpenGlance ${state.version} ${state.track}`,
  );
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
    track: state.track,
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
    track: state.track,
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
  const releaseArchive = archiveReleaseOutputs(state, {
    channel: physicalUpdateChannel({ track: state.track, phase: "stable" }),
  });
  const finishedAt = new Date().toISOString();
  const receiptDir = path.join(state.sourceRoot, "dist", "release-receipts");
  mkdirSync(receiptDir, { recursive: true });
  writeFileSync(
    path.join(receiptDir, `${tagName}.json`),
    `${JSON.stringify({
      ...state,
      status: "completed",
      history: [
        ...state.history,
        {
          action: "release-archive",
          track: state.track,
          channel: releaseArchive.channel,
          outcome: "completed",
          completedAt: releaseArchive.archivedAt,
          path: releaseArchive.path,
        },
      ],
      releaseArchive,
      finishedAt,
    }, null, 2)}\n`,
    "utf8",
  );
  removeReleaseWorktree(state, { statePath });
  console.log(
    `Finished ${tagName}; archived verified artifacts at ${releaseArchive.path}, then removed the release worktree and local lock`,
  );
}

function abortRelease() {
  const { statePath, state } = readReleaseState();
  if (releaseHasCompleted(state, {
    action: "publish-updates",
    phase: "stable",
    track: state.track,
  })) {
    throw new Error("Stable artifacts were already published; repair and finish this release instead of aborting it");
  }
  const tagName = releaseTagName({ version: state.version });
  if (remoteTagCommit(state, tagName)) {
    throw new Error(`Remote tag ${tagName} already exists; finish this release instead of aborting it`);
  }
  removeReleaseWorktree(state, { statePath });
  console.log(`Aborted OpenGlance ${state.version}; release worktree and local lock removed`);
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
    RELEASE_SOURCE_ROOT: state.sourceRoot,
    RELEASE_TRACK: state.track,
    ...releaseEnvironment(state),
  };
  for (const [key, value] of Object.entries(values)) {
    console.log(`export ${key}=${shellQuote(value)}`);
  }
}

function printReleaseSummary(state, heading) {
  console.log(`${heading}:`);
  console.log(`  version:   ${state.version}`);
  console.log(`  track:     ${state.track}`);
  console.log(`  commit:    ${state.commit}`);
  console.log(`  build id:  ${state.buildId}`);
  console.log(`  worktree:  ${state.worktreePath}`);
  console.log(`  profile:   ${state.releaseProfile.path}`);
  console.log(`  profile sha256: ${state.releaseProfile.sha256}`);
  console.log(`  candidate artifacts: ${state.candidateArtifactsVerifiedAt ? "verified" : "pending"}`);
  console.log(
    `  Windows Release Smoke: ${state.windowsReleaseSmoke?.status === "verified" ? `verified (run ${state.windowsReleaseSmoke.runId})` : "pending"}`,
  );
  if (isLegacyInternalMigrationRelease(state)) {
    console.log(
      `  public download isolation: ${state.publicDownloadIsolationVerifiedAt ? "verified" : "pending"}`,
    );
  }
  if (state.updateRegression) {
    const base = state.updateRegression.baseTag ? ` since ${state.updateRegression.baseTag}` : "";
    const transition = state.updateRegression.evidence?.fromVersion
      ? ` (${state.updateRegression.evidence.fromVersion} -> ${state.updateRegression.evidence.toVersion})`
      : "";
    console.log(`  update regression: ${state.updateRegression.required ? `${state.updateRegression.status}${transition}` : "not required"}${base}`);
    for (const reason of state.updateRegression.reasons) {
      console.log(`    - ${reason}`);
    }
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function compareReleaseVersions(left, right) {
  const parse = (value) => {
    const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) {
      throw new Error(`Unsupported release version: ${value || "missing"}`);
    }
    return match.slice(1).map(Number);
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
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
  prepare --track <public|internal> --profile ABS [--worktree PATH] [--skip-install]
      [--require-update-regression REASON]
      Freeze origin/main into a detached release worktree, run npm ci and test:all
  status [--remote]
      Validate the frozen commit, clean worktree, version, and main ancestry
  env
      Print shell exports for the frozen release identity
  run <mac|windows> <command> [--channel candidate|stable|legacy-stable]
      Run one guarded platform release step inside the release worktree
      legacy-stable is an internal publish-updates migration bridge only
  mark-candidate-verified
      Record candidate manifests, downloads, signatures, and packages as verified
  verify-windows-release-smoke --run-id ID
      Verify and record a successful Windows Release Smoke run for RELEASE_COMMIT
  verify-macos-update-regression --evidence FILE
      Verify and record local macOS Update Regression harness evidence
  mark-public-download-isolation-verified
      Record that the public download service hides the internal 1.11.3 stable bridge
  tag
      Create the version tag after both stable packages were published
  push-tag
      Push and verify the version tag
  finish
      Archive and verify stable artifacts, save a local receipt, then remove the release worktree and lock
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
        track: optionValue(args, "--track"),
        profilePath: optionValue(args, "--profile"),
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
    case "verify-windows-release-smoke":
      return verifyWindowsReleaseSmoke(optionValue(args, "--run-id"));
    case "verify-macos-update-regression":
      return verifyMacosUpdateRegression(optionValue(args, "--evidence"));
    case "mark-public-download-isolation-verified":
      return markPublicDownloadIsolationVerified();
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

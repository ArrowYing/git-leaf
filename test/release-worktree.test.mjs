import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assessUpdateRegression,
  assertCandidateGateComplete,
  assertCandidateCanBeMarked,
  assertReleaseCanBeTagged,
  assertReleaseRunAllowed,
  defaultReleaseWorktreePath,
  releaseEnvironment,
  releaseHasCompleted,
  releaseIdentity,
  sanitizedReleaseProcessEnvironment,
  updateRegressionRiskForPath,
} from "../scripts/release-worktree.mjs";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(TEST_ROOT);

function releaseState(overrides = {}) {
  return {
    version: "1.11.0",
    commit: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-07-15T08:09:10.000Z",
    buildId: "0123456789ab.20260715T080910Z",
    updateRegression: {
      required: false,
      status: "not_required",
      baseTag: "v1.10.0",
      reasons: [],
    },
    history: [],
    ...overrides,
  };
}

function completedPublish(platform, channel) {
  return {
    action: "publish-updates",
    platform,
    channel,
    outcome: "completed",
    completedAt: "2026-07-15T09:00:00.000Z",
  };
}

test("release worktree uses a versioned sibling directory outside the source checkout", () => {
  assert.equal(
    defaultReleaseWorktreePath({
      sourceRoot: path.join("", "Users", "example", "Projects", "git-leaf"),
      version: "1.11.0",
    }),
    path.join("", "Users", "example", "Projects", ".release-worktrees", "git-leaf-v1.11.0"),
  );
});

test("release identity freezes commit, build time, and build id once", () => {
  assert.deepEqual(
    releaseIdentity({
      version: "1.11.0",
      commit: "0123456789abcdef0123456789abcdef01234567",
      now: () => new Date("2026-07-15T08:09:10.123Z"),
    }),
    {
      version: "1.11.0",
      commit: "0123456789abcdef0123456789abcdef01234567",
      builtAt: "2026-07-15T08:09:10.123Z",
      buildId: "0123456789ab.20260715T080910Z",
    },
  );
});

test("release environment cannot drift away from the frozen state", () => {
  assert.deepEqual(releaseEnvironment(releaseState(), { channel: "candidate" }), {
    VERSION: "1.11.0",
    GIT_COMMIT: "0123456789ab",
    RELEASE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    BUILT_AT: "2026-07-15T08:09:10.000Z",
    BUILD_ID: "0123456789ab.20260715T080910Z",
    UPDATE_CHANNEL: "candidate",
  });
});

test("release subprocesses ignore transient desktop smoke overrides", () => {
  assert.deepEqual(sanitizedReleaseProcessEnvironment({
    HOME: "/Users/release",
    GIT_LEAF_DEV_USER_DATA_DIR: "/tmp/release-smoke-profile",
    GIT_LEAF_ENABLE_UPDATES: "1",
    GIT_LEAF_PORTABLE: "1",
    GIT_LEAF_TELEMETRY_ENDPOINT: "http://localhost:9999",
    GIT_LEAF_UPDATE_BASE_URL: "http://localhost:9998",
    GIT_LEAF_UPDATE_CHANNEL: "candidate",
  }), {
    HOME: "/Users/release",
  });
});

test("update regression risk is limited to update, install, packaging, and configuration paths", () => {
  assert.equal(updateRegressionRiskForPath("desktop/updates.mjs"), true);
  assert.equal(updateRegressionRiskForPath("src/desktop-config.mjs"), true);
  assert.equal(updateRegressionRiskForPath("desktop/main.mjs", {
    changedLines: "+ telemetryUploadScheduler = createTelemetryUploadScheduler();",
  }), false);
  assert.equal(updateRegressionRiskForPath("desktop/main.mjs", {
    changedLines: "+ updateController = createDesktopUpdateController();",
  }), true);
  assert.equal(updateRegressionRiskForPath("public/app.js"), false);
  assert.equal(updateRegressionRiskForPath("README.md"), false);
});

test("desktop main telemetry changes do not require real-App update regression", () => {
  const assessment = assessUpdateRegression({
    baseTag: "v1.11.1",
    changedFiles: ["desktop/main.mjs", "src/telemetry-upload-scheduler.mjs"],
    changedFileDiffs: {
      "desktop/main.mjs": [
        "+ telemetryUploadScheduler = createTelemetryUploadScheduler();",
        "+ await telemetryUploadScheduler.shutdown();",
      ].join("\n"),
    },
    previousDependencies: { electron: "43.0.0" },
    currentDependencies: { electron: "43.0.0" },
  });

  assert.equal(assessment.required, false);
  assert.equal(assessment.status, "not_required");
  assert.deepEqual(assessment.changedFiles, []);
});

test("ordinary releases record that update regression is not required", () => {
  assert.deepEqual(assessUpdateRegression({
    baseTag: "v1.11.0",
    changedFiles: ["README.md", "public/app.js"],
    previousDependencies: { electron: "43.0.0" },
    currentDependencies: { electron: "43.0.0" },
    now: () => new Date("2026-07-20T08:00:00.000Z"),
  }), {
    required: false,
    status: "not_required",
    baseTag: "v1.11.0",
    assessedAt: "2026-07-20T08:00:00.000Z",
    reasons: [],
    changedFiles: [],
    dependencyChanges: [],
  });
});

test("update-sensitive files and dependencies require real-App regression", () => {
  const assessment = assessUpdateRegression({
    baseTag: "v1.11.0",
    changedFiles: ["README.md", "desktop/updates.mjs"],
    previousDependencies: { electron: "42.0.0" },
    currentDependencies: { electron: "43.0.0" },
  });

  assert.equal(assessment.required, true);
  assert.equal(assessment.status, "pending");
  assert.deepEqual(assessment.changedFiles, ["desktop/updates.mjs"]);
  assert.deepEqual(assessment.dependencyChanges, [{
    dependency: "electron",
    from: "42.0.0",
    to: "43.0.0",
  }]);
});

test("first releases and explicit operator risk require update regression", () => {
  assert.match(
    assessUpdateRegression().reasons.join("\n"),
    /No previous formal release tag/,
  );
  assert.match(
    assessUpdateRegression({
      baseTag: "v1.11.0",
      forcedReason: "changed external installer policy",
    }).reasons.join("\n"),
    /changed external installer policy/,
  );
});

test("formal release runner rejects composite commands and implicit update channels", () => {
  const state = releaseState();

  assert.throws(
    () => assertReleaseRunAllowed({ state, platform: "mac", command: "release" }),
    /Unsupported formal release command/,
  );
  assert.throws(
    () => assertReleaseRunAllowed({ state, platform: "mac", command: "publish-updates" }),
    /requires --channel candidate or --channel stable/,
  );
  assert.throws(
    () => assertReleaseRunAllowed({ state, platform: "windows", command: "package", channel: "candidate" }),
    /--channel is only valid/,
  );
});

test("stable publishing always requires candidate artifact verification", () => {
  assert.throws(
    () => assertReleaseRunAllowed({
      state: releaseState(),
      platform: "mac",
      command: "publish-updates",
      channel: "stable",
    }),
    /Candidate artifacts have not been verified/,
  );

  assert.doesNotThrow(() => assertReleaseRunAllowed({
    state: releaseState({ candidateArtifactsVerifiedAt: "2026-07-15T10:00:00.000Z" }),
    platform: "mac",
    command: "publish-updates",
    channel: "stable",
  }));
});

test("required update regression blocks stable until its smoke is recorded", () => {
  const pending = releaseState({
    candidateArtifactsVerifiedAt: "2026-07-15T10:00:00.000Z",
    updateRegression: {
      required: true,
      status: "pending",
      baseTag: "v1.10.0",
      reasons: ["Update-sensitive files changed"],
    },
  });
  assert.throws(() => assertCandidateGateComplete(pending), /Update regression smoke is required/);
  assert.doesNotThrow(() => assertCandidateGateComplete({
    ...pending,
    updateRegression: { ...pending.updateRegression, status: "verified" },
  }));
});

test("candidate verification requires both platform uploads from the active release", () => {
  const macOnly = releaseState({ history: [completedPublish("mac", "candidate")] });
  assert.throws(() => assertCandidateCanBeMarked(macOnly), /Candidate windows artifacts/);

  const both = releaseState({
    history: [
      completedPublish("mac", "candidate"),
      completedPublish("windows", "candidate"),
    ],
  });
  assert.doesNotThrow(() => assertCandidateCanBeMarked(both));
});

test("tagging requires resolved candidate gates and both stable platform uploads", () => {
  const history = [
    completedPublish("mac", "stable"),
    completedPublish("windows", "stable"),
  ];
  assert.throws(
    () => assertReleaseCanBeTagged(releaseState({ history })),
    /Candidate artifacts have not been verified/,
  );
  assert.throws(
    () => assertReleaseCanBeTagged(releaseState({
      candidateArtifactsVerifiedAt: "2026-07-15T10:00:00.000Z",
      history: [completedPublish("mac", "stable")],
    })),
    /Stable windows artifacts/,
  );
  assert.doesNotThrow(() => assertReleaseCanBeTagged(releaseState({
    candidateArtifactsVerifiedAt: "2026-07-15T10:00:00.000Z",
    history,
  })));
});

test("failed attempts never satisfy release gates", () => {
  const state = releaseState({
    history: [{
      ...completedPublish("mac", "candidate"),
      outcome: "failed",
    }],
  });
  assert.equal(releaseHasCompleted(state, {
    action: "publish-updates",
    platform: "mac",
    channel: "candidate",
  }), false);
});

test("release controller prepares, validates, exports, and aborts an isolated worktree", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-release-worktree-"));
  const sourceRoot = path.join(fixtureRoot, "git-leaf");
  const remoteRoot = path.join(fixtureRoot, "origin.git");
  mkdirSync(path.join(sourceRoot, "scripts"), { recursive: true });
  mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
  cpSync(path.join(REPO_ROOT, "scripts", "release-worktree.mjs"), path.join(sourceRoot, "scripts", "release-worktree.mjs"));
  cpSync(path.join(REPO_ROOT, "scripts", "release-shared.mjs"), path.join(sourceRoot, "scripts", "release-shared.mjs"));
  cpSync(path.join(REPO_ROOT, "src", "build-info.mjs"), path.join(sourceRoot, "src", "build-info.mjs"));
  writeFileSync(path.join(sourceRoot, "package.json"), `${JSON.stringify({ version: "9.8.6" }, null, 2)}\n`);
  writeFileSync(path.join(sourceRoot, ".gitignore"), "node_modules/\ndist/\n");

  git(["init", "--bare", remoteRoot], { cwd: fixtureRoot });
  git(["init", "-b", "main"], { cwd: sourceRoot });
  git(["config", "user.name", "Release Test"], { cwd: sourceRoot });
  git(["config", "user.email", "release-test@example.com"], { cwd: sourceRoot });
  git(["add", "."], { cwd: sourceRoot });
  git(["commit", "-m", "previous release fixture"], { cwd: sourceRoot });
  git(["tag", "v9.8.6"], { cwd: sourceRoot });
  writeFileSync(path.join(sourceRoot, "package.json"), `${JSON.stringify({ version: "9.8.7" }, null, 2)}\n`);
  writeFileSync(path.join(sourceRoot, "README.md"), "# Ordinary release change\n");
  git(["add", "."], { cwd: sourceRoot });
  git(["commit", "-m", "release fixture"], { cwd: sourceRoot });
  git(["remote", "add", "origin", remoteRoot], { cwd: sourceRoot });
  git(["push", "-u", "origin", "main", "--tags"], { cwd: sourceRoot });

  const controller = realpathSync(path.join(sourceRoot, "scripts", "release-worktree.mjs"));
  const prepared = node([controller, "prepare", "--skip-install"], { cwd: sourceRoot });
  assert.match(prepared, /Prepared immutable release worktree/);
  assert.match(prepared, /update regression: not required since v9\.8\.6/);
  const worktreePath = path.join(
    dirname(realpathSync(sourceRoot)),
    ".release-worktrees",
    "git-leaf-v9.8.7",
  );
  assert.equal(existsSync(worktreePath), true);

  const duplicatePrepare = spawnSync(process.execPath, [controller, "prepare", "--skip-install"], {
    cwd: sourceRoot,
    encoding: "utf8",
  });
  assert.equal(duplicatePrepare.status, 1);
  assert.match(duplicatePrepare.stderr, /Release 9\.8\.7 is already active/);
  assert.equal(existsSync(worktreePath), true);

  assert.match(node([controller, "status", "--remote"], { cwd: sourceRoot }), /Release worktree is valid/);
  const releaseEnv = node([controller, "env"], { cwd: sourceRoot });
  assert.match(releaseEnv, /export VERSION='9\.8\.7'/);
  assert.match(releaseEnv, new RegExp(`export RELEASE_WORKTREE='${escapeRegExp(worktreePath)}'`));

  assert.match(node([controller, "abort"], { cwd: sourceRoot }), /Aborted Git Leaf 9\.8\.7/);
  assert.equal(existsSync(worktreePath), false);
  assert.equal(
    existsSync(path.join(sourceRoot, ".git", "git-leaf-release-state.json")),
    false,
  );
  assert.doesNotMatch(readFileSync(path.join(sourceRoot, ".git", "config"), "utf8"), /release-worktrees/);
});

function git(args, { cwd }) {
  return command("git", args, { cwd });
}

function node(args, { cwd }) {
  return command(process.execPath, args, { cwd });
}

function command(executable, args, { cwd }) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `${executable} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
  );
  return result.stdout;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

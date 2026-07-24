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
  assertFrozenReleaseProfile,
  assertPublicDownloadIsolationCanBeMarked,
  assertReleaseCanBeTagged,
  assertReleaseRunAllowed,
  assertReleaseVersionAboveBaseline,
  assertWindowsReleaseSmokeVerified,
  defaultReleaseWorktreePath,
  freezeReleaseProfile,
  physicalUpdateChannel,
  releaseEnvironment,
  releaseHasCompleted,
  releaseIdentity,
  sanitizedReleaseProcessEnvironment,
  updateRegressionRiskForPath,
  windowsReleaseSmokeEvidence,
} from "../scripts/release-worktree.mjs";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(TEST_ROOT);

function releaseState(overrides = {}) {
  const state = {
    version: "1.11.0",
    commit: "0123456789abcdef0123456789abcdef01234567",
    builtAt: "2026-07-15T08:09:10.000Z",
    buildId: "0123456789ab.20260715T080910Z",
    track: "public",
    releaseProfile: {
      path: "/profiles/git-leaf-official-public.json",
      sha256: "a".repeat(64),
    },
    updateRegression: {
      required: false,
      status: "not_required",
      baseTag: "v1.10.0",
      reasons: [],
    },
    windowsReleaseSmoke: {
      status: "verified",
      repository: "MangoFuture1210/git-leaf",
      workflowName: "Windows Release Smoke",
      workflowPath: ".github/workflows/windows-release-smoke.yml",
      runId: "123456789",
      runAttempt: 1,
      url: "https://github.com/MangoFuture1210/git-leaf/actions/runs/123456789",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      event: "push",
      runStatus: "completed",
      conclusion: "success",
      artifactId: "987654321",
      artifactName: "git-leaf-windows-release-smoke-1-0123456789abcdef0123456789abcdef01234567",
      artifactSize: 1024,
      verifiedAt: "2026-07-15T09:30:00.000Z",
    },
    history: [],
    ...overrides,
  };
  return state;
}

function completedPublish(platform, phase, track = "public") {
  return {
    action: "publish-updates",
    platform,
    phase,
    channel: physicalUpdateChannel({ track, phase }),
    track,
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
    GIT_LEAF_FORMAL_RELEASE: "1",
    GIT_LEAF_RELEASE_PROFILE: "/profiles/git-leaf-official-public.json",
    UPDATE_CHANNEL: "candidate",
  });
});

test("release subprocesses ignore all ambient identity, profile, destination, and smoke overrides", () => {
  assert.deepEqual(sanitizedReleaseProcessEnvironment({
    HOME: "/Users/release",
    VERSION: "99.0.0",
    BUILD_ID: "ambient",
    BUILT_AT: "2099-01-01T00:00:00.000Z",
    GIT_COMMIT: "ambient",
    RELEASE_COMMIT: "ambient",
    GIT_LEAF_FORMAL_RELEASE: "0",
    GIT_LEAF_RELEASE_PROFILE: "/tmp/wrong-profile.json",
    GIT_LEAF_DISTRIBUTION: "source",
    GIT_LEAF_USAGE_ANALYTICS_DEFAULT: "false",
    DEVELOPER_ID_APPLICATION: "wrong identity",
    NOTARY_PROFILE: "wrong notary profile",
    ELECTRON_MIRROR: "http://localhost:9996",
    UPDATE_BASE_URL: "http://localhost:9997",
    UPDATE_REMOTE_HOST: "wrong-host",
    UPDATE_REMOTE_ROOT: "/tmp/wrong-root",
    UPDATE_CHANNEL: "stable",
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

test("release profile freezes canonical content and rejects identity or track mismatch", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-frozen-profile-"));
  const profilePath = path.join(rootDir, "official-internal.json");
  const publicProfilePath = path.join(rootDir, "official-public.json");
  const contents = `${JSON.stringify({
    distribution: "official",
    releaseTrack: "internal",
    usageAnalyticsDefault: true,
  }, null, 2)}\n`;
  writeFileSync(profilePath, contents);

  const frozen = freezeReleaseProfile({ profilePath, track: "internal" });
  assert.equal(frozen.path, realpathSync(profilePath));
  assert.match(frozen.sha256, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertFrozenReleaseProfile({
    track: "internal",
    releaseProfile: frozen,
  }));

  assert.throws(
    () => freezeReleaseProfile({ profilePath: "relative.json", track: "internal" }),
    /absolute path/,
  );
  assert.throws(
    () => freezeReleaseProfile({ profilePath, track: "public" }),
    /does not match --track public/,
  );

  writeFileSync(profilePath, contents.replace('"official"', '"source"'));
  assert.throws(
    () => freezeReleaseProfile({ profilePath, track: "internal" }),
    /distribution must be official/,
  );
  assert.throws(
    () => assertFrozenReleaseProfile({
      track: "internal",
      releaseProfile: frozen,
    }),
    /Frozen release profile changed|distribution must be official/,
  );

  writeFileSync(publicProfilePath, `${JSON.stringify({
    distribution: "official",
    releaseTrack: "public",
    usageAnalyticsDefault: false,
  }, null, 2)}\n`);
  assert.throws(
    () => freezeReleaseProfile({ profilePath: publicProfilePath, track: "public" }),
    /legacyInternalMigrationConfirmed=true/,
  );
  writeFileSync(publicProfilePath, `${JSON.stringify({
    distribution: "official",
    releaseTrack: "public",
    usageAnalyticsDefault: false,
    legacyInternalMigrationConfirmed: true,
  }, null, 2)}\n`);
  assert.doesNotThrow(
    () => freezeReleaseProfile({ profilePath: publicProfilePath, track: "public" }),
  );
});

test("release version must advance beyond the pre-split 1.11.2 baseline even without tags", () => {
  assert.throws(() => assertReleaseVersionAboveBaseline("1.11.2"), /newer than.*1\.11\.2/);
  assert.throws(() => assertReleaseVersionAboveBaseline("1.10.99"), /newer than.*1\.11\.2/);
  assert.doesNotThrow(() => assertReleaseVersionAboveBaseline("1.11.3"));
  assert.doesNotThrow(() => assertReleaseVersionAboveBaseline("2.0.0"));
});

test("logical release phases map to isolated physical update channels", () => {
  assert.equal(physicalUpdateChannel({ track: "public", phase: "candidate" }), "candidate");
  assert.equal(physicalUpdateChannel({ track: "public", phase: "stable" }), "stable");
  assert.equal(
    physicalUpdateChannel({ track: "internal", phase: "candidate" }),
    "internal-candidate",
  );
  assert.equal(physicalUpdateChannel({ track: "internal", phase: "stable" }), "internal-stable");
  assert.equal(physicalUpdateChannel({ track: "internal", phase: "legacy-stable" }), "stable");
  assert.throws(
    () => physicalUpdateChannel({ track: "public", phase: "legacy-stable" }),
    /Unsupported public release channel phase/,
  );
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

test("legacy stable is an internal publish-only bridge gated by completed internal stable", () => {
  const publicState = releaseState();
  assert.throws(
    () => assertReleaseRunAllowed({
      state: publicState,
      platform: "mac",
      command: "publish-updates",
      channel: "legacy-stable",
    }),
    /only valid for the internal 1\.11\.3 migration release/,
  );

  const internalState = releaseState({
    version: "1.11.3",
    track: "internal",
    candidateArtifactsVerifiedAt: "2026-07-15T10:00:00.000Z",
    publicDownloadIsolationVerifiedAt: "2026-07-15T10:30:00.000Z",
    history: [
      completedPublish("mac", "stable", "internal"),
      completedPublish("windows", "stable", "internal"),
    ],
  });
  assert.throws(
    () => assertReleaseRunAllowed({
      state: internalState,
      platform: "mac",
      command: "stage-updates",
      channel: "legacy-stable",
    }),
    /only valid for publish-updates/,
  );
  assert.doesNotThrow(() => assertReleaseRunAllowed({
    state: internalState,
    platform: "mac",
    command: "publish-updates",
    channel: "legacy-stable",
  }));

  assert.throws(
    () => assertReleaseRunAllowed({
      state: { ...internalState, history: [completedPublish("mac", "stable", "internal")] },
      platform: "mac",
      command: "publish-updates",
      channel: "legacy-stable",
    }),
    /Stable windows artifacts for track internal/,
  );

  assert.throws(
    () => assertReleaseRunAllowed({
      state: { ...internalState, publicDownloadIsolationVerifiedAt: undefined },
      platform: "mac",
      command: "publish-updates",
      channel: "legacy-stable",
    }),
    /Public download isolation has not been verified/,
  );
  assert.throws(
    () => assertReleaseRunAllowed({
      state: { ...internalState, version: "1.11.4" },
      platform: "mac",
      command: "publish-updates",
      channel: "legacy-stable",
    }),
    /only valid for the internal 1\.11\.3 migration release/,
  );
});

test("public download isolation can be recorded only for the one-time internal migration", () => {
  assert.throws(
    () => assertPublicDownloadIsolationCanBeMarked(releaseState()),
    /only valid for the internal 1\.11\.3 migration release/,
  );
  assert.throws(
    () => assertPublicDownloadIsolationCanBeMarked(releaseState({
      version: "1.11.4",
      track: "internal",
    })),
    /only valid for the internal 1\.11\.3 migration release/,
  );
  assert.doesNotThrow(() => assertPublicDownloadIsolationCanBeMarked(releaseState({
    version: "1.11.3",
    track: "internal",
  })));
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

test("stable publishing requires a successful Windows Release Smoke for the frozen commit", () => {
  const state = releaseState({
    candidateArtifactsVerifiedAt: "2026-07-15T10:00:00.000Z",
    windowsReleaseSmoke: undefined,
  });
  assert.throws(
    () => assertCandidateGateComplete(state),
    /Windows Release Smoke has not been verified/,
  );
  assert.throws(
    () => assertWindowsReleaseSmokeVerified(releaseState({
      windowsReleaseSmoke: {
        ...releaseState().windowsReleaseSmoke,
        headSha: "f".repeat(40),
      },
    })),
    /does not match the frozen release commit/,
  );
});

test("Windows Release Smoke evidence accepts only a successful run for the frozen commit", () => {
  const state = releaseState();
  const run = {
    id: 30071711489,
    repository: { full_name: "MangoFuture1210/git-leaf" },
    name: "Windows Release Smoke",
    path: ".github/workflows/windows-release-smoke.yml",
    head_sha: state.commit,
    event: "push",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/MangoFuture1210/git-leaf/actions/runs/30071711489",
    run_attempt: 1,
  };
  const artifacts = {
    artifacts: [{
      id: 8588318244,
      name: `git-leaf-windows-release-smoke-10-${state.commit}`,
      size_in_bytes: 152326386,
      expired: false,
    }],
  };
  assert.deepEqual(windowsReleaseSmokeEvidence({
    state,
    runId: "30071711489",
    run,
    artifacts,
    now: () => new Date("2026-07-24T06:20:00.000Z"),
  }), {
    status: "verified",
    repository: "MangoFuture1210/git-leaf",
    workflowName: "Windows Release Smoke",
    workflowPath: ".github/workflows/windows-release-smoke.yml",
    runId: "30071711489",
    runAttempt: 1,
    url: run.html_url,
    headSha: state.commit,
    event: "push",
    runStatus: "completed",
    conclusion: "success",
    artifactId: "8588318244",
    artifactName: `git-leaf-windows-release-smoke-10-${state.commit}`,
    artifactSize: 152326386,
    verifiedAt: "2026-07-24T06:20:00.000Z",
  });
  assert.throws(
    () => windowsReleaseSmokeEvidence({
      state,
      runId: "30071711489",
      run: { ...run, head_sha: "f".repeat(40) },
      artifacts,
    }),
    /expected frozen release commit/,
  );
  assert.throws(
    () => windowsReleaseSmokeEvidence({
      state,
      runId: "30071711489",
      run: { ...run, conclusion: "failure" },
      artifacts,
    }),
    /expected completed\/success/,
  );
  assert.throws(
    () => windowsReleaseSmokeEvidence({
      state,
      runId: "30071711489",
      run,
      artifacts: {
        artifacts: [{ ...artifacts.artifacts[0], expired: true }],
      },
    }),
    /no unexpired release-gate artifact/,
  );
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

  const internalWithPublicUploads = releaseState({
    track: "internal",
    history: [
      completedPublish("mac", "candidate"),
      completedPublish("windows", "candidate"),
    ],
  });
  assert.throws(
    () => assertCandidateCanBeMarked(internalWithPublicUploads),
    /Candidate mac artifacts for track internal/,
  );
  assert.doesNotThrow(() => assertCandidateCanBeMarked(releaseState({
    track: "internal",
    history: [
      completedPublish("mac", "candidate", "internal"),
      completedPublish("windows", "candidate", "internal"),
    ],
  })));
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

test("internal 1.11.3 cannot be tagged until both legacy stable bridge publishes complete", () => {
  const state = releaseState({
    version: "1.11.3",
    track: "internal",
    candidateArtifactsVerifiedAt: "2026-07-15T10:00:00.000Z",
    publicDownloadIsolationVerifiedAt: "2026-07-15T10:30:00.000Z",
    history: [
      completedPublish("mac", "stable", "internal"),
      completedPublish("windows", "stable", "internal"),
    ],
  });

  assert.throws(() => assertReleaseCanBeTagged(state), /Legacy stable mac artifacts/);
  assert.throws(
    () => assertReleaseCanBeTagged({
      ...state,
      history: [
        ...state.history,
        completedPublish("mac", "legacy-stable", "internal"),
      ],
    }),
    /Legacy stable windows artifacts/,
  );
  assert.doesNotThrow(() => assertReleaseCanBeTagged({
    ...state,
    history: [
      ...state.history,
      completedPublish("mac", "legacy-stable", "internal"),
      completedPublish("windows", "legacy-stable", "internal"),
    ],
  }));
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
    phase: "candidate",
    channel: "candidate",
    track: "public",
  }), false);
});

test("release controller prepares, validates, exports, and aborts an isolated worktree", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-release-worktree-"));
  const sourceRoot = path.join(fixtureRoot, "git-leaf");
  const remoteRoot = path.join(fixtureRoot, "origin.git");
  const profilePath = path.join(fixtureRoot, "official-internal.json");
  const profileContents = `${JSON.stringify({
    distribution: "official",
    releaseTrack: "internal",
    usageAnalyticsDefault: true,
  }, null, 2)}\n`;
  writeFileSync(profilePath, profileContents);
  mkdirSync(path.join(sourceRoot, "scripts"), { recursive: true });
  mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
  cpSync(path.join(REPO_ROOT, "scripts", "release-worktree.mjs"), path.join(sourceRoot, "scripts", "release-worktree.mjs"));
  cpSync(path.join(REPO_ROOT, "scripts", "release-shared.mjs"), path.join(sourceRoot, "scripts", "release-shared.mjs"));
  cpSync(path.join(REPO_ROOT, "src", "build-info.mjs"), path.join(sourceRoot, "src", "build-info.mjs"));
  writeFileSync(
    path.join(sourceRoot, "scripts", "release-mac.mjs"),
    "console.log(JSON.stringify({ formal: process.env.GIT_LEAF_FORMAL_RELEASE, profile: process.env.GIT_LEAF_RELEASE_PROFILE, channel: process.env.UPDATE_CHANNEL }));\n",
  );
  writeFileSync(path.join(sourceRoot, "package.json"), `${JSON.stringify({ version: "1.11.2" }, null, 2)}\n`);
  writeFileSync(path.join(sourceRoot, ".gitignore"), "node_modules/\ndist/\n");

  git(["init", "--bare", remoteRoot], { cwd: fixtureRoot });
  git(["init", "-b", "main"], { cwd: sourceRoot });
  git(["config", "user.name", "Release Test"], { cwd: sourceRoot });
  git(["config", "user.email", "release-test@example.com"], { cwd: sourceRoot });
  git(["add", "."], { cwd: sourceRoot });
  git(["commit", "-m", "previous release fixture"], { cwd: sourceRoot });
  git(["tag", "v1.11.2"], { cwd: sourceRoot });
  writeFileSync(path.join(sourceRoot, "package.json"), `${JSON.stringify({ version: "1.11.3" }, null, 2)}\n`);
  writeFileSync(path.join(sourceRoot, "README.md"), "# Ordinary release change\n");
  git(["add", "."], { cwd: sourceRoot });
  git(["commit", "-m", "release fixture"], { cwd: sourceRoot });
  git(["remote", "add", "origin", remoteRoot], { cwd: sourceRoot });
  git(["push", "-u", "origin", "main", "--tags"], { cwd: sourceRoot });

  const controller = realpathSync(path.join(sourceRoot, "scripts", "release-worktree.mjs"));
  const prepareArgs = [
    controller,
    "prepare",
    "--track",
    "internal",
    "--profile",
    profilePath,
    "--skip-install",
  ];
  const prepared = node(prepareArgs, { cwd: sourceRoot });
  assert.match(prepared, /Prepared immutable release worktree/);
  assert.match(prepared, /track:\s+internal/);
  assert.match(prepared, new RegExp(`profile:\\s+${escapeRegExp(realpathSync(profilePath))}`));
  assert.match(prepared, /public download isolation: pending/);
  assert.match(prepared, /update regression: not required since v1\.11\.2/);
  const worktreePath = path.join(
    dirname(realpathSync(sourceRoot)),
    ".release-worktrees",
    "git-leaf-v1.11.3",
  );
  assert.equal(existsSync(worktreePath), true);

  const duplicatePrepare = spawnSync(process.execPath, prepareArgs, {
    cwd: sourceRoot,
    encoding: "utf8",
  });
  assert.equal(duplicatePrepare.status, 1);
  assert.match(duplicatePrepare.stderr, /Release 1\.11\.3 is already active/);
  assert.equal(existsSync(worktreePath), true);

  assert.match(node([controller, "status", "--remote"], { cwd: sourceRoot }), /Release worktree is valid/);
  const releaseEnv = node([controller, "env"], { cwd: sourceRoot });
  assert.match(releaseEnv, /export VERSION='1\.11\.3'/);
  assert.match(releaseEnv, /export GIT_LEAF_FORMAL_RELEASE='1'/);
  assert.match(
    releaseEnv,
    new RegExp(`export GIT_LEAF_RELEASE_PROFILE='${escapeRegExp(realpathSync(profilePath))}'`),
  );
  assert.match(releaseEnv, new RegExp(`export RELEASE_WORKTREE='${escapeRegExp(worktreePath)}'`));

  const statePath = path.join(sourceRoot, ".git", "git-leaf-release-state.json");
  let state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(state.track, "internal");
  assert.equal(state.releaseProfile.path, realpathSync(profilePath));
  assert.match(state.releaseProfile.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(state.windowsReleaseSmoke, {
    status: "pending",
    repository: "MangoFuture1210/git-leaf",
    workflowPath: ".github/workflows/windows-release-smoke.yml",
    headSha: state.commit,
  });

  const isolationOutput = node([
    controller,
    "mark-public-download-isolation-verified",
  ], { cwd: sourceRoot });
  assert.match(isolationOutput, /Recorded public download isolation verification/);
  state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.match(state.publicDownloadIsolationVerifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(state.history.at(-1), {
    action: "public-download-isolation",
    track: "internal",
    outcome: "completed",
    completedAt: state.publicDownloadIsolationVerifiedAt,
  });
  assert.match(
    node([controller, "help"], { cwd: sourceRoot }),
    /mark-public-download-isolation-verified/,
  );

  const stageOutput = node([
    controller,
    "run",
    "mac",
    "stage-updates",
    "--channel",
    "candidate",
  ], { cwd: sourceRoot });
  const stageInvocation = JSON.parse(stageOutput.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(stageInvocation, {
    formal: "1",
    profile: realpathSync(profilePath),
    channel: "internal-candidate",
  });
  state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.deepEqual(
    state.history.at(-1),
    {
      action: "stage-updates",
      platform: "mac",
      track: "internal",
      phase: "candidate",
      channel: "internal-candidate",
      outcome: "completed",
      completedAt: state.history.at(-1).completedAt,
    },
  );

  writeFileSync(profilePath, profileContents.replace("true", "false"));
  const driftedStatus = spawnSync(process.execPath, [controller, "status"], {
    cwd: sourceRoot,
    encoding: "utf8",
  });
  assert.equal(driftedStatus.status, 1);
  assert.match(driftedStatus.stderr, /Frozen release profile changed/);
  writeFileSync(profilePath, profileContents);
  assert.match(node([controller, "status"], { cwd: sourceRoot }), /Release worktree is valid/);

  assert.match(node([controller, "abort"], { cwd: sourceRoot }), /Aborted Git Leaf 1\.11\.3/);
  assert.equal(existsSync(worktreePath), false);
  assert.equal(existsSync(statePath), false);
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertOfficialReleaseProfile,
  electronPackagerCommand,
  assertReleaseVersionIsNew,
  ensureReleaseGitTag,
  RELEASE_PACKAGE_IGNORE_PATTERNS,
  releaseArtifactFileName,
  releaseBuildInfoFromEnv,
  withReleaseBuildInfoFile,
  releaseTagName,
} from "../scripts/release-shared.mjs";
import { BUILD_INFO_FILENAME } from "../src/build-info.mjs";

test("electronPackagerCommand invokes the package JS entry through node", () => {
  const command = electronPackagerCommand({ rootDir: "/repo" });

  assert.equal(command.command, process.execPath);
  assert.equal(
    slashPath(command.args[0]),
    "/repo/node_modules/@electron/packager/bin/electron-packager.mjs",
  );
});

test("releaseTagName derives a stable git tag from the shared app version", () => {
  assert.equal(releaseTagName({ version: "0.1.1" }), "v0.1.1");
});

test("releaseArtifactFileName keeps downloadable artifact names short and shell friendly", () => {
  assert.equal(
    releaseArtifactFileName({
      version: "0.1.4",
      platformKey: "darwin-arm64",
      extension: ".dmg",
    }),
    "GitLeaf-0.1.4-darwin-arm64.dmg",
  );
  assert.doesNotMatch(
    releaseArtifactFileName({
      version: "0.1.4",
      platformKey: "win32-x64",
      extension: "zip",
    }),
    /[\s+]|\bsigned\b|\bunsigned\b/,
  );
});

test("release package ignores third-party test files from app.asar", () => {
  const ignorePatterns = RELEASE_PACKAGE_IGNORE_PATTERNS.map((pattern) => new RegExp(pattern));
  const isIgnored = (filePath) => ignorePatterns.some((pattern) => pattern.test(filePath));

  for (const filePath of [
    "/.gitleaks.toml",
    "/marketing/positioning.md",
    "/node_modules/@lezer/css/test/test-css.js",
    "/node_modules/@lezer/html/tests/fixture.txt",
    "/node_modules/example/__tests__/fixture.js",
    "/node_modules/example/dist/parser.spec.mjs",
    "/node_modules/example/dist/parser.test.ts",
  ]) {
    assert.equal(isIgnored(filePath), true, `${filePath} should not be copied into app.asar`);
  }
});

test("release build identity defaults to source with analytics disabled", () => {
  const buildInfo = releaseBuildInfoFromEnv({
    rootDir: "/repo",
    env: {
      VERSION: "1.12.0",
      GIT_COMMIT: "abc123",
      BUILT_AT: "2026-07-23T00:00:00.000Z",
      BUILD_ID: "abc123.20260723T000000Z",
    },
  });

  assert.equal(buildInfo.distribution, "source");
  assert.equal(buildInfo.usageAnalyticsDefault, false);
  assert.throws(
    () => assertOfficialReleaseProfile(buildInfo),
    /GIT_LEAF_RELEASE_PROFILE/,
  );
});

test("release profile selects official public or internal bootstrap defaults", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-release-profile-"));
  const publicProfile = path.join(rootDir, "official-public.json");
  await writeFile(publicProfile, JSON.stringify({
    distribution: "official",
    usageAnalyticsDefault: false,
  }), "utf8");

  const buildInfo = releaseBuildInfoFromEnv({
    rootDir,
    env: {
      GIT_LEAF_RELEASE_PROFILE: publicProfile,
      VERSION: "1.12.0",
      GIT_COMMIT: "abc123",
      BUILT_AT: "2026-07-23T00:00:00.000Z",
      BUILD_ID: "abc123.20260723T000000Z",
    },
  });

  assert.equal(buildInfo.distribution, "official");
  assert.equal(buildInfo.usageAnalyticsDefault, false);
  assert.equal(buildInfo.releaseProfileConfigured, true);
  assert.equal(buildInfo.releaseProfileDistribution, "official");
  assert.equal(assertOfficialReleaseProfile(buildInfo), undefined);
});

test("environment overrides cannot impersonate a configured official release profile", () => {
  const buildInfo = releaseBuildInfoFromEnv({
    rootDir: "/repo",
    env: {
      GIT_LEAF_DISTRIBUTION: "official",
      VERSION: "1.12.0",
      GIT_COMMIT: "abc123",
      BUILT_AT: "2026-07-23T00:00:00.000Z",
      BUILD_ID: "abc123.20260723T000000Z",
    },
  });

  assert.equal(buildInfo.distribution, "official");
  assert.equal(buildInfo.releaseProfileConfigured, false);
  assert.throws(
    () => assertOfficialReleaseProfile(buildInfo),
    /GIT_LEAF_RELEASE_PROFILE/,
  );
});

test("assertReleaseVersionIsNew rejects a previously released version even on the same commit", () => {
  const runCommand = (_command, args) => {
    if (args.join(" ") === "rev-parse --verify refs/tags/v0.1.1^{}") {
      return { status: 0, stdout: "abc123\n", stderr: "" };
    }
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };

  assert.throws(
    () => assertReleaseVersionIsNew({
      rootDir: "/repo",
      version: "0.1.1",
      runCommand,
    }),
    /Release version 0\.1\.1 has already been published as tag v0\.1\.1/,
  );
});

test("assertReleaseVersionIsNew accepts a version without an existing release tag", () => {
  const runCommand = (_command, args) => {
    if (args.join(" ") === "rev-parse --verify refs/tags/v0.1.2^{}") {
      return { status: 1, stdout: "", stderr: "not found" };
    }
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };

  assert.equal(
    assertReleaseVersionIsNew({
      rootDir: "/repo",
      version: "0.1.2",
      runCommand,
    }),
    undefined,
  );
});

test("withReleaseBuildInfoFile writes development build marker", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-release-shared-"));
  let payload;

  withReleaseBuildInfoFile({
    rootDir,
    buildInfo: {
      version: "0.1.1",
      commit: "93458e1",
      builtAt: "2026-07-05T11:47:00.000Z",
      buildId: "93458e1.20260705T114700Z",
      dev: true,
    },
  }, () => {
    payload = JSON.parse(readFileSync(path.join(rootDir, BUILD_INFO_FILENAME), "utf8"));
  });

  assert.equal(payload.dev, true);
  assert.equal(payload.distribution, "source");
  assert.equal(payload.usageAnalyticsDefault, false);
});

test("ensureReleaseGitTag creates an annotated version tag when it is missing", () => {
  const calls = [];
  const runCommand = (command, args) => {
    calls.push([command, args]);
    if (args.join(" ") === "rev-parse HEAD") {
      return { status: 0, stdout: "abc123\n", stderr: "" };
    }
    if (args.join(" ") === "rev-parse --verify refs/tags/v0.1.1^{}") {
      return { status: 1, stdout: "", stderr: "not found" };
    }
    if (args.join(" ") === "tag -a v0.1.1 -m Git Leaf 0.1.1") {
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };

  assert.deepEqual(
    ensureReleaseGitTag({
      rootDir: "/repo",
      version: "0.1.1",
      runCommand,
    }),
    {
      tagName: "v0.1.1",
      commit: "abc123",
      created: true,
    },
  );
  assert.deepEqual(calls.at(-1), [
    "git",
    ["tag", "-a", "v0.1.1", "-m", "Git Leaf 0.1.1"],
  ]);
});

test("ensureReleaseGitTag rejects an existing version tag on another commit", () => {
  const runCommand = (_command, args) => {
    if (args.join(" ") === "rev-parse HEAD") {
      return { status: 0, stdout: "current\n", stderr: "" };
    }
    if (args.join(" ") === "rev-parse --verify refs/tags/v0.1.1^{}") {
      return { status: 0, stdout: "old\n", stderr: "" };
    }
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  };

  assert.throws(
    () => ensureReleaseGitTag({
      rootDir: "/repo",
      version: "0.1.1",
      runCommand,
    }),
    /v0\.1\.1 already points to old, not current HEAD current/,
  );
});

function slashPath(value) {
  return value.replace(/\\/g, "/").replace(/^[A-Za-z]:(?=\/)/, "");
}

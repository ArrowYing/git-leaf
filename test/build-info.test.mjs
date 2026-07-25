import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aboutPanelCopyright,
  appDisplayName,
  BUILD_INFO_FILENAME,
  buildDistributionLabel,
  isOfficialDistribution,
  readBuildInfo,
  releaseTrackForBuildInfo,
  releaseDateLabel,
} from "../src/build-info.mjs";

test("releaseDateLabel formats the build timestamp as a user-facing release date", () => {
  assert.equal(
    releaseDateLabel({
      builtAt: "2026-07-05T11:47:00.000Z",
      buildId: "93458e1.20260705T114700Z",
      commit: "93458e1",
    }),
    "Released 2026-07-05",
  );
  assert.equal(
    releaseDateLabel({
      builtAt: "2026-07-05T11:47:00.000Z",
    }, { language: "zh-CN" }),
    "发布于 2026-07-05",
  );
});

test("releaseDateLabel omits invalid build timestamps", () => {
  assert.equal(releaseDateLabel({ builtAt: "not-a-date" }), "");
});

test("appDisplayName marks development builds with dev", () => {
  assert.equal(appDisplayName({ dev: true }), "Git Leaf dev");
  assert.equal(appDisplayName({ dev: false }), "Git Leaf");
  assert.equal(appDisplayName({}), "Git Leaf");
});

test("build identity defaults to source with usage analytics disabled", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-build-info-"));
  await writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ version: "0.1.1" }),
    "utf8",
  );

  const buildInfo = readBuildInfo({
    rootDir,
    now: () => new Date("2026-07-23T00:00:00.000Z"),
  });
  assert.equal(buildInfo.distribution, "source");
  assert.equal(buildInfo.releaseTrack, "source");
  assert.equal(buildInfo.usageAnalyticsDefault, false);
  assert.equal(isOfficialDistribution(buildInfo), false);
  assert.equal(buildDistributionLabel(buildInfo), "Source build");
  assert.equal(buildDistributionLabel(buildInfo, { language: "zh-CN" }), "源码构建");
});

test("official legacy build identity without a release track remains on the public track", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-build-info-"));
  await writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ version: "1.11.2" }),
    "utf8",
  );
  await writeFile(
    path.join(rootDir, BUILD_INFO_FILENAME),
    JSON.stringify({
      version: "1.11.2",
      distribution: "official",
    }),
    "utf8",
  );

  const buildInfo = readBuildInfo({
    rootDir,
    env: {
      GIT_LEAF_DISTRIBUTION: "source",
      GIT_LEAF_RELEASE_TRACK: "internal",
    },
  });

  assert.equal(buildInfo.distribution, "official");
  assert.equal(buildInfo.releaseTrack, "public");
  assert.equal(releaseTrackForBuildInfo(buildInfo), "public");
  assert.equal(buildDistributionLabel(buildInfo), "Official public build");
});

test("packaged build identity keeps its embedded internal track despite environment overrides", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-build-info-"));
  await writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ version: "1.11.3" }),
    "utf8",
  );
  await writeFile(
    path.join(rootDir, BUILD_INFO_FILENAME),
    JSON.stringify({
      version: "1.11.3",
      distribution: "official",
      releaseTrack: "internal",
    }),
    "utf8",
  );

  const buildInfo = readBuildInfo({
    rootDir,
    env: {
      GIT_LEAF_DISTRIBUTION: "source",
      GIT_LEAF_RELEASE_TRACK: "public",
    },
  });

  assert.equal(buildInfo.distribution, "official");
  assert.equal(buildInfo.releaseTrack, "internal");
  assert.equal(buildDistributionLabel(buildInfo), "Official internal build");
});

test("official builds with an explicit invalid release track fail closed", async () => {
  for (const releaseTrack of ["source", "unknown", "", null]) {
    const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-build-info-"));
    await writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify({ version: "1.11.3" }),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, BUILD_INFO_FILENAME),
      JSON.stringify({
        version: "1.11.3",
        distribution: "official",
        releaseTrack,
      }),
      "utf8",
    );

    const buildInfo = readBuildInfo({ rootDir });
    assert.equal(buildInfo.releaseTrack, "source", String(releaseTrack));
    assert.equal(releaseTrackForBuildInfo(buildInfo), "source", String(releaseTrack));
    assert.equal(buildDistributionLabel(buildInfo), "Official build (no update track)");
  }
});

test("generated build analytics defaults cannot be overridden by the environment", async () => {
  for (const [generatedValue, environmentValue, expected] of [
    [true, "false", true],
    [false, "true", false],
    [undefined, "true", false],
  ]) {
    const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-build-info-"));
    await writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify({ version: "1.11.3" }),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, BUILD_INFO_FILENAME),
      JSON.stringify({
        version: "1.11.3",
        distribution: "official",
        releaseTrack: "internal",
        ...(generatedValue === undefined
          ? {}
          : { usageAnalyticsDefault: generatedValue }),
      }),
      "utf8",
    );

    const buildInfo = readBuildInfo({
      rootDir,
      env: { GIT_LEAF_USAGE_ANALYTICS_DEFAULT: environmentValue },
    });
    assert.equal(buildInfo.usageAnalyticsDefault, expected);
  }
});

test("source builds without generated identity may use an analytics environment default", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-build-info-"));
  await writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ version: "1.11.3" }),
    "utf8",
  );

  const buildInfo = readBuildInfo({
    rootDir,
    env: { GIT_LEAF_USAGE_ANALYTICS_DEFAULT: "true" },
  });
  assert.equal(buildInfo.distribution, "source");
  assert.equal(buildInfo.usageAnalyticsDefault, true);
});

test("aboutPanelCopyright includes the commit for development builds only", () => {
  assert.equal(
    aboutPanelCopyright({
      builtAt: "2026-07-05T11:47:00.000Z",
      commit: "93458e1",
      dev: true,
    }),
    "Released 2026-07-05\nCommit 93458e1",
  );

  assert.equal(
    aboutPanelCopyright({
      builtAt: "2026-07-05T11:47:00.000Z",
      commit: "93458e1",
      dev: false,
    }),
    "Released 2026-07-05",
  );
});

test("readBuildInfo preserves development build marker", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-build-info-"));
  await writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ version: "0.1.1" }),
    "utf8",
  );
  await writeFile(
    path.join(rootDir, BUILD_INFO_FILENAME),
    JSON.stringify({
      version: "0.1.1",
      commit: "93458e1",
      builtAt: "2026-07-05T11:47:00.000Z",
      buildId: "93458e1.20260705T114700Z",
      dev: true,
      distribution: "official",
      usageAnalyticsDefault: true,
    }),
    "utf8",
  );

  const buildInfo = readBuildInfo({ rootDir });
  assert.equal(buildInfo.dev, true);
  assert.equal(buildInfo.distribution, "official");
  assert.equal(buildInfo.releaseTrack, "public");
  assert.equal(buildInfo.usageAnalyticsDefault, true);
  assert.equal(buildDistributionLabel(buildInfo), "Development build");
});

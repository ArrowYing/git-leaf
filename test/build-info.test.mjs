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
  releaseDateLabel,
} from "../src/build-info.mjs";

test("releaseDateLabel formats the build timestamp as a user-facing release date", () => {
  assert.equal(
    releaseDateLabel({
      builtAt: "2026-07-05T11:47:00.000Z",
      buildId: "93458e1.20260705T114700Z",
      commit: "93458e1",
    }),
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
  assert.equal(buildInfo.usageAnalyticsDefault, false);
  assert.equal(isOfficialDistribution(buildInfo), false);
  assert.equal(buildDistributionLabel(buildInfo), "源码构建");
});

test("aboutPanelCopyright includes the commit for development builds only", () => {
  assert.equal(
    aboutPanelCopyright({
      builtAt: "2026-07-05T11:47:00.000Z",
      commit: "93458e1",
      dev: true,
    }),
    "发布于 2026-07-05\nCommit 93458e1",
  );

  assert.equal(
    aboutPanelCopyright({
      builtAt: "2026-07-05T11:47:00.000Z",
      commit: "93458e1",
      dev: false,
    }),
    "发布于 2026-07-05",
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
  assert.equal(buildInfo.usageAnalyticsDefault, true);
  assert.equal(buildDistributionLabel(buildInfo), "开发构建");
});

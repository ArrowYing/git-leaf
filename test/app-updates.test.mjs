import test from "node:test";
import assert from "node:assert/strict";

import {
  appUpdatePlatformKey,
  compareAppVersions,
  isAppVersionNewer,
  macAutoUpdaterFeedUrl,
  updateChannelForBuildInfo,
  updateManifestIdentityError,
  updateManifestUrl,
} from "../src/app-updates.mjs";

test("compareAppVersions orders semantic versions without treating build metadata as newer", () => {
  assert.equal(compareAppVersions("0.1.2", "0.1.1"), 1);
  assert.equal(compareAppVersions("0.1.1", "0.1.2"), -1);
  assert.equal(compareAppVersions("0.1.1+426b23f", "0.1.1"), 0);
  assert.equal(compareAppVersions("1.0", "1.0.0"), 0);
});

test("isAppVersionNewer only accepts strictly newer versions", () => {
  assert.equal(isAppVersionNewer("0.1.2", "0.1.1"), true);
  assert.equal(isAppVersionNewer("0.1.1", "0.1.1"), false);
  assert.equal(isAppVersionNewer("0.1.0", "0.1.1"), false);
});

test("appUpdatePlatformKey maps desktop platforms to release directories", () => {
  assert.equal(appUpdatePlatformKey({ platform: "darwin", arch: "arm64" }), "darwin-universal");
  assert.equal(appUpdatePlatformKey({ platform: "darwin", arch: "x64" }), "darwin-universal");
  assert.equal(appUpdatePlatformKey({ platform: "win32", arch: "x64" }), "win32-x64");
  assert.equal(appUpdatePlatformKey({ platform: "linux", arch: "arm64" }), "linux-arm64");
});

test("release tracks map to isolated update channels", () => {
  assert.equal(updateChannelForBuildInfo({ distribution: "source" }), "");
  assert.equal(updateChannelForBuildInfo({ distribution: "official" }), "stable");
  assert.equal(
    updateChannelForBuildInfo({ distribution: "official", releaseTrack: "public" }),
    "stable",
  );
  assert.equal(
    updateChannelForBuildInfo({ distribution: "official", releaseTrack: "internal" }),
    "internal-stable",
  );
  assert.equal(
    updateChannelForBuildInfo({ distribution: "official", releaseTrack: "source" }),
    "",
  );
  assert.equal(
    updateChannelForBuildInfo({ distribution: "official", releaseTrack: "unknown" }),
    "",
  );
});

test("update manifests must match release track, channel, and platform", () => {
  const manifest = {
    releaseTrack: "internal",
    channel: "internal-stable",
    platform: "darwin-universal",
  };
  const target = {
    releaseTrack: "internal",
    channel: "internal-stable",
    platformKey: "darwin-universal",
  };

  assert.equal(updateManifestIdentityError(manifest, target), "");
  assert.match(
    updateManifestIdentityError({ ...manifest, releaseTrack: "public" }, target),
    /发行轨道/,
  );
  assert.match(
    updateManifestIdentityError({ ...manifest, channel: "stable" }, target),
    /更新通道/,
  );
  assert.match(
    updateManifestIdentityError({ ...manifest, platform: "win32-x64" }, target),
    /平台/,
  );
});

test("updateManifestUrl builds stable latest manifest URLs", () => {
  assert.equal(
    updateManifestUrl({
      baseUrl: "https://updates.mangofuture.com/git-leaf/",
      channel: "stable",
      platformKey: "win32-x64",
    }),
    "https://updates.mangofuture.com/git-leaf/stable/win32-x64/latest.json",
  );
});

test("macAutoUpdaterFeedUrl includes the current app version for Squirrel.Mac", () => {
  assert.equal(
    macAutoUpdaterFeedUrl({
      baseUrl: "https://updates.mangofuture.com/git-leaf",
      channel: "stable",
      platformKey: "darwin-universal",
      currentVersion: "0.1.1",
    }),
    "https://updates.mangofuture.com/git-leaf/stable/darwin-universal/releases/0.1.1",
  );
});

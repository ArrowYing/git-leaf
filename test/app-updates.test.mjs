import test from "node:test";
import assert from "node:assert/strict";

import {
  appUpdatePlatformKey,
  compareAppVersions,
  isAppVersionNewer,
  macAutoUpdaterFeedUrl,
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

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUpdateManifest,
  updateArtifactRemotePath,
  updateMetadataRelativeDir,
} from "../scripts/update-publish.mjs";

test("buildUpdateManifest describes macOS DMG and ZIP artifacts with absolute update URLs", () => {
  const manifest = buildUpdateManifest({
    appName: "Git Leaf",
    baseUrl: "https://updates.mangofuture.com/git-leaf",
    channel: "stable",
    releaseTrack: "public",
    platformKey: "darwin-arm64",
    version: "0.1.2",
    buildId: "426b23f.20260706T070000Z",
    commit: "426b23f",
    builtAt: "2026-07-06T07:00:00.000Z",
    artifacts: [
      { kind: "zip", fileName: "GitLeaf-0.1.2-darwin-arm64.zip", sha256: "abc", size: 123 },
      { kind: "dmg", fileName: "GitLeaf-0.1.2-darwin-arm64.dmg", sha256: "def", size: 456 },
    ],
  });

  assert.equal(manifest.version, "0.1.2");
  assert.equal(manifest.releaseTrack, "public");
  assert.equal(
    manifest.files.zip.url,
    "https://updates.mangofuture.com/git-leaf/stable/darwin-arm64/GitLeaf-0.1.2-darwin-arm64.zip",
  );
  assert.equal(manifest.files.dmg.sha256, "def");
  assert.equal(manifest.autoUpdater.pub_date, "2026-07-06T07:00:00.000Z");
});

test("buildUpdateManifest can expose an ARM migration feed backed by universal artifacts", () => {
  const manifest = buildUpdateManifest({
    baseUrl: "https://updates.mangofuture.com/git-leaf",
    channel: "stable",
    releaseTrack: "public",
    platformKey: "darwin-arm64",
    artifactPlatformKey: "darwin-universal",
    version: "1.9.0",
    artifacts: [
      {
        kind: "zip",
        fileName: "GitLeaf-1.9.0-darwin-universal.zip",
        sha256: "abc",
        size: 123,
      },
    ],
  });

  assert.equal(manifest.platform, "darwin-arm64");
  assert.equal(
    manifest.files.zip.url,
    "https://updates.mangofuture.com/git-leaf/stable/darwin-universal/GitLeaf-1.9.0-darwin-universal.zip",
  );
  assert.equal(manifest.autoUpdater.url, manifest.files.zip.url);
});

test("buildUpdateManifest keeps internal releases on an explicit manifest identity", () => {
  const manifest = buildUpdateManifest({
    channel: "internal-stable",
    releaseTrack: "internal",
    platformKey: "win32-x64",
    version: "1.11.3",
  });

  assert.equal(manifest.releaseTrack, "internal");
  assert.equal(manifest.channel, "internal-stable");
  assert.equal(manifest.platform, "win32-x64");
});

test("buildUpdateManifest rejects missing or source release tracks", () => {
  assert.throws(
    () => buildUpdateManifest({
      channel: "stable",
      platformKey: "darwin-universal",
      version: "1.11.3",
    }),
    /explicit public or internal releaseTrack/,
  );
  assert.throws(
    () => buildUpdateManifest({
      channel: "stable",
      releaseTrack: "source",
      platformKey: "darwin-universal",
      version: "1.11.3",
    }),
    /explicit public or internal releaseTrack/,
  );
});

test("update metadata paths are scoped by channel and platform", () => {
  assert.equal(
    updateMetadataRelativeDir({ channel: "stable", platformKey: "darwin-arm64" }),
    "git-leaf/stable/darwin-arm64",
  );
  assert.equal(
    updateArtifactRemotePath({
      remoteRoot: "/srv/git-leaf/updates",
      channel: "stable",
      platformKey: "win32-x64",
    }),
    "/srv/git-leaf/updates/git-leaf/stable/win32-x64",
  );
});

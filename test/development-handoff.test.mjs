import test from "node:test";
import assert from "node:assert/strict";

import {
  developmentHandoffReceiptForManifest,
  developmentHandoffReceiptMatchesBuild,
  developmentHandoffTarget,
  developmentHandoffVersionAvailable,
  desktopUpdatesEnabled,
  normalizeDevelopmentHandoffReceipt,
} from "../src/desktop/development-handoff.mjs";

const SOURCE_BUILD = {
  version: "1.16.0",
  buildId: "abc123.20260730T010000Z.source",
  commit: "abc123",
  dev: true,
  distribution: "source",
  releaseTrack: "source",
  usageAnalyticsDefault: false,
};

const INTERNAL_MANIFEST = {
  version: "1.16.0",
  buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
  commit: "2c3e9d8cfcfb",
  releaseTrack: "internal",
  channel: "internal-stable",
  platform: "darwin-universal",
};

test("only a packaged macOS source development build gets the fixed internal target", () => {
  assert.deepEqual(developmentHandoffTarget({
    buildInfo: SOURCE_BUILD,
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
  }), {
    kind: "dev-to-internal",
    releaseTrack: "internal",
    channel: "internal-stable",
    platform: "darwin-universal",
  });

  for (const options of [
    { isPackaged: false },
    { platform: "win32" },
    { buildInfo: { ...SOURCE_BUILD, dev: false } },
    { buildInfo: { ...SOURCE_BUILD, distribution: "official" } },
    { buildInfo: { ...SOURCE_BUILD, releaseTrack: "public" } },
  ]) {
    assert.equal(developmentHandoffTarget({
      buildInfo: SOURCE_BUILD,
      isPackaged: true,
      platform: "darwin",
      arch: "arm64",
      ...options,
    }), null);
  }
});

test("desktop update controls are available only for official or eligible dev builds", () => {
  assert.equal(desktopUpdatesEnabled({
    buildInfo: {
      distribution: "official",
      releaseTrack: "internal",
      dev: false,
    },
    isPackaged: true,
    platform: "darwin",
  }), true);
  assert.equal(desktopUpdatesEnabled({
    buildInfo: SOURCE_BUILD,
    isPackaged: true,
    platform: "darwin",
  }), true);
  assert.equal(desktopUpdatesEnabled({
    buildInfo: { ...SOURCE_BUILD, dev: false },
    isPackaged: true,
    platform: "darwin",
  }), false);
  assert.equal(desktopUpdatesEnabled({
    buildInfo: SOURCE_BUILD,
    isPackaged: false,
    platform: "darwin",
  }), false);
});

test("development handoff requires a strictly newer internal version", () => {
  assert.equal(developmentHandoffVersionAvailable({
    currentVersion: "1.16.0",
    targetVersion: "1.16.1",
  }), true);
  assert.equal(developmentHandoffVersionAvailable({
    currentVersion: "1.16.0",
    targetVersion: "1.16.0",
  }), false);
  assert.equal(developmentHandoffVersionAvailable({
    currentVersion: "1.16.0+local-dev",
    targetVersion: "1.16.0+internal",
  }), false);
  assert.equal(developmentHandoffVersionAvailable({
    currentVersion: "1.16.0",
    targetVersion: "1.15.0",
  }), false);
});

test("development handoff receipts bind every target identity field", () => {
  const receipt = developmentHandoffReceiptForManifest({
    manifest: INTERNAL_MANIFEST,
  });
  assert.deepEqual(receipt, {
    kind: "dev-to-internal",
    version: "1.16.0",
    buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
    commit: "2c3e9d8cfcfb",
    releaseTrack: "internal",
    channel: "internal-stable",
    platform: "darwin-universal",
  });
  assert.deepEqual(normalizeDevelopmentHandoffReceipt(receipt), receipt);

  for (const field of [
    "kind",
    "version",
    "buildId",
    "commit",
    "releaseTrack",
    "channel",
    "platform",
  ]) {
    const invalid = { ...receipt };
    delete invalid[field];
    assert.equal(
      normalizeDevelopmentHandoffReceipt(invalid),
      null,
      `${field} must be required`,
    );
  }

  assert.equal(developmentHandoffReceiptForManifest({
    manifest: { ...INTERNAL_MANIFEST, releaseTrack: "public" },
  }), null);
  assert.equal(developmentHandoffReceiptForManifest({
    manifest: { ...INTERNAL_MANIFEST, channel: "internal-candidate" },
  }), null);
  assert.equal(developmentHandoffReceiptForManifest({
    manifest: { ...INTERNAL_MANIFEST, platform: "win32-x64" },
  }), null);
});

test("a receipt matches only the exact official internal target build", () => {
  const receipt = developmentHandoffReceiptForManifest({
    manifest: INTERNAL_MANIFEST,
  });
  const buildInfo = {
    ...INTERNAL_MANIFEST,
    distribution: "official",
    dev: false,
    usageAnalyticsDefault: true,
  };

  assert.equal(developmentHandoffReceiptMatchesBuild({
    receipt,
    buildInfo,
    platformKey: "darwin-universal",
  }), true);

  for (const mismatch of [
    { dev: true },
    { distribution: "source" },
    { releaseTrack: "public" },
    { version: "1.16.1" },
    { buildId: "another-build.internal" },
    { commit: "another-commit" },
  ]) {
    assert.equal(developmentHandoffReceiptMatchesBuild({
      receipt,
      buildInfo: { ...buildInfo, ...mismatch },
      platformKey: "darwin-universal",
    }), false);
  }
  assert.equal(developmentHandoffReceiptMatchesBuild({
    receipt,
    buildInfo,
    platformKey: "win32-x64",
  }), false);
});

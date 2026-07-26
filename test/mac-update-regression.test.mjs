import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  assertSafeMacUpdateRegressionHost,
  updateRegressionInstallExpression,
  updateRegressionChannels,
  validateMacUpdateRegressionEvidence,
  validateUpdateRegressionManifest,
} from "../scripts/mac-update-regression.mjs";

test("mac update regression maps release tracks to their stable and candidate lanes", () => {
  assert.deepEqual(updateRegressionChannels("public"), {
    stable: "stable",
    candidate: "candidate",
  });
  assert.deepEqual(updateRegressionChannels("internal"), {
    stable: "internal-stable",
    candidate: "internal-candidate",
  });
  assert.throws(() => updateRegressionChannels("source"), /Unsupported release track/);
});

test("mac update regression refuses conflicting local updater state before launching an App", () => {
  assert.throws(
    () => assertSafeMacUpdateRegressionHost({
      platform: "darwin",
      productionAppRunning: true,
      userShipItJobExists: true,
      systemShipItJobExists: false,
    }),
    /Refusing to start.*conflicting local state[\s\S]*installed Git Leaf App is running[\s\S]*ShipIt/,
  );
  assert.doesNotThrow(() => assertSafeMacUpdateRegressionHost({
    platform: "darwin",
    productionAppRunning: false,
    userShipItJobExists: false,
    systemShipItJobExists: false,
  }));
});

test("mac update regression uses the real enabled update action", () => {
  const runWithAction = (action) => vm.runInNewContext(
    updateRegressionInstallExpression(),
    {
      document: {
        querySelector: () => action,
      },
    },
  );

  assert.deepEqual(
    { ...runWithAction(null) },
    { clicked: false, reason: "missing" },
  );

  let clickCount = 0;
  assert.deepEqual(
    {
      ...runWithAction({
        hidden: false,
        disabled: true,
        textContent: "Preparing",
        click: () => {
          clickCount += 1;
        },
      }),
    },
    { clicked: false, reason: "disabled", label: "Preparing" },
  );
  assert.equal(clickCount, 0);

  assert.deepEqual(
    {
      ...runWithAction({
        hidden: false,
        disabled: false,
        textContent: "Install",
        click: () => {
          clickCount += 1;
        },
      }),
    },
    { clicked: true, reason: "action-clicked", label: "Install" },
  );
  assert.equal(clickCount, 1);
});

test("mac update regression validates candidate identity and ZIP contract", () => {
  const manifest = {
    releaseTrack: "internal",
    channel: "internal-candidate",
    platform: "darwin-universal",
    version: "1.12.1",
    commit: "0123456789ab",
    files: {
      zip: {
        name: "GitLeaf-1.12.1-internal-darwin-universal.zip",
        url: "https://updates.example.test/GitLeaf.zip",
        sha256: "a".repeat(64),
        size: 1024,
      },
    },
  };
  assert.equal(validateUpdateRegressionManifest(manifest, {
    channel: "internal-candidate",
    track: "internal",
    expectedVersion: "1.12.1",
    expectedCommit: "0123456789abcdef0123456789abcdef01234567",
  }), manifest);
  assert.throws(
    () => validateUpdateRegressionManifest({
      ...manifest,
      channel: "internal-stable",
    }, {
      channel: "internal-candidate",
      track: "internal",
    }),
    /identity does not match/,
  );
});

test("mac update regression evidence binds installation and cleanup to the frozen release", () => {
  const fingerprint = { sha256: "a".repeat(64), fileCount: 3 };
  const evidence = {
    schemaVersion: 1,
    source: "git-leaf-macos-update-regression",
    status: "passed",
    track: "internal",
    platform: "darwin-universal",
    fromVersion: "1.11.4",
    toVersion: "1.12.1",
    commit: "0123456789abcdef0123456789abcdef01234567",
    buildId: "0123456789ab.20260726T120000Z.internal",
    currentUserDirectContentsWriteEnabled: true,
    directContentsWrite: true,
    appDirectoryInodePreserved: true,
    privilegedShipItJobObserved: false,
    realProfileBefore: fingerprint,
    realProfileAfter: fingerprint,
    realShipItCacheBefore: fingerprint,
    realShipItCacheAfter: fingerprint,
    cleanup: {
      processesTerminated: true,
      userShipItJobAbsent: true,
      systemShipItJobAbsent: true,
      isolatedCacheRemovedWithTemporaryRoot: true,
      realProfileUnchanged: true,
      realShipItCacheUnchanged: true,
    },
  };
  assert.equal(validateMacUpdateRegressionEvidence(evidence, {
    track: "internal",
    version: "1.12.1",
    commit: evidence.commit,
    buildId: "0123456789ab.20260726T120000Z",
  }), evidence);
  assert.throws(
    () => validateMacUpdateRegressionEvidence({
      ...evidence,
      cleanup: { ...evidence.cleanup, userShipItJobAbsent: false },
    }, {
      track: "internal",
      version: "1.12.1",
      commit: evidence.commit,
      buildId: "0123456789ab.20260726T120000Z",
    }),
    /mandatory cleanup contract/,
  );
});

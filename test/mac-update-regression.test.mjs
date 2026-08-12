import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import {
  assertSafeMacUpdateRegressionHost,
  downloadUpdateRegressionArtifact,
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

test("mac update regression downloads redirected artifacts without relying on global fetch", async (t) => {
  const payload = Buffer.from("signed candidate bytes\n");
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/artifact.zip" });
      response.end();
      return;
    }
    if (request.url === "/artifact.zip") {
      response.writeHead(200, {
        "content-length": payload.length,
        "content-type": "application/zip",
      });
      response.end(payload);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-update-download."));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const destinationPath = path.join(temporaryRoot, "artifact.zip");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch transport is unavailable");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const contract = await downloadUpdateRegressionArtifact({
    name: "artifact.zip",
    url: `http://127.0.0.1:${server.address().port}/redirect`,
    sha256: createHash("sha256").update(payload).digest("hex"),
    size: payload.length,
  }, destinationPath);

  assert.deepEqual(contract, {
    sha256: createHash("sha256").update(payload).digest("hex"),
    size: payload.length,
  });
  assert.deepEqual(await readFile(destinationPath), payload);
});

test("mac update regression refuses conflicting local updater state before launching an App", () => {
  assert.throws(
    () => assertSafeMacUpdateRegressionHost({
      platform: "darwin",
      productionAppRunning: true,
      userShipItJobExists: true,
      systemShipItJobExists: false,
    }),
    /Refusing to start.*conflicting local state[\s\S]*installed OpenPeek App is running[\s\S]*ShipIt/,
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
        name: "OpenPeek-1.12.1-internal-darwin-universal.zip",
        url: "https://updates.example.test/OpenPeek.zip",
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

test("mac update regression accepts only the exact internal 1.11.3 public stable bridge", () => {
  const bridgeManifest = {
    releaseTrack: "internal",
    channel: "stable",
    platform: "darwin-universal",
    version: "1.11.3",
    commit: "9a7baa0cb6d3",
    files: {
      zip: {
        name: "OpenPeek-1.11.3-internal-darwin-universal.zip",
        url: "https://updates.example.test/OpenPeek-1.11.3.zip",
        sha256: "b".repeat(64),
        size: 2048,
      },
    },
  };

  assert.equal(validateUpdateRegressionManifest(bridgeManifest, {
    channel: "stable",
    track: "public",
    allowLegacyPublicStableBridge: true,
  }), bridgeManifest);
  assert.throws(
    () => validateUpdateRegressionManifest(bridgeManifest, {
      channel: "stable",
      track: "public",
    }),
    /identity does not match/,
  );
  assert.throws(
    () => validateUpdateRegressionManifest({
      ...bridgeManifest,
      version: "1.11.4",
    }, {
      channel: "stable",
      track: "public",
      allowLegacyPublicStableBridge: true,
    }),
    /identity does not match/,
  );
  assert.throws(
    () => validateUpdateRegressionManifest({
      ...bridgeManifest,
      channel: "candidate",
    }, {
      channel: "stable",
      track: "public",
      allowLegacyPublicStableBridge: true,
    }),
    /identity does not match/,
  );
});

test("mac update regression evidence binds installation and cleanup to the frozen release", () => {
  const fingerprint = { sha256: "a".repeat(64), fileCount: 3 };
  const evidence = {
    schemaVersion: 3,
    source: "git-leaf-macos-update-regression",
    status: "passed",
    track: "internal",
    platform: "darwin-universal",
    fromVersion: "1.11.4",
    fromTrack: "internal",
    fromChannel: "internal-stable",
    toVersion: "1.12.1",
    commit: "0123456789abcdef0123456789abcdef01234567",
    buildId: "0123456789ab.20260726T120000Z.internal",
    installMode: "contents-bridge",
    directContentsWrite: true,
    appDirectoryInodePreserved: true,
    installParentWritable: false,
    privilegedShipItJobObserved: false,
    squirrelPolicy: {
      policy: "nonprivileged-only",
      privilegedHelperAllowed: false,
    },
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
  const publicBridgeEvidence = {
    ...evidence,
    track: "public",
    fromVersion: "1.11.3",
    fromTrack: "internal",
    fromChannel: "stable",
    buildId: "0123456789ab.20260726T120000Z.public",
  };
  assert.equal(validateMacUpdateRegressionEvidence(publicBridgeEvidence, {
    track: "public",
    version: "1.12.1",
    commit: evidence.commit,
    buildId: "0123456789ab.20260726T120000Z",
  }), publicBridgeEvidence);
  assert.throws(
    () => validateMacUpdateRegressionEvidence({
      ...publicBridgeEvidence,
      fromVersion: "1.11.4",
    }, {
      track: "public",
      version: "1.12.1",
      commit: evidence.commit,
      buildId: "0123456789ab.20260726T120000Z",
    }),
    /mandatory cleanup contract/,
  );
  assert.throws(
    () => validateMacUpdateRegressionEvidence({
      ...publicBridgeEvidence,
      installMode: "in-app-update",
    }, {
      track: "public",
      version: "1.12.1",
      commit: evidence.commit,
      buildId: "0123456789ab.20260726T120000Z",
    }),
    /mandatory cleanup contract/,
  );
});

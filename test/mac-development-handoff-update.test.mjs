import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractMacDevelopmentHandoffArchive,
  installPreparedMacDevelopmentHandoff,
  launchMacDevelopmentHandoffUpdate,
  macDevelopmentHandoffCachePaths,
  prepareMacDevelopmentHandoffUpdate,
} from "../src/desktop/mac-development-handoff-update.mjs";

const RECEIPT = Object.freeze({
  kind: "dev-to-internal",
  version: "1.16.0",
  buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
  commit: "2c3e9d8cfcfb",
  releaseTrack: "internal",
  channel: "internal-stable",
  platform: "darwin-universal",
});

const ARCHIVE = Buffer.from("signed internal archive");
const ARCHIVE_SHA256 =
  "946d65515109449dc0cf9f92205385f9d2bb9d9c52792051ce128d049f1279c3";

function manifest() {
  return {
    ...RECEIPT,
    files: {
      zip: {
        name: "OpenPeek-1.16.0-internal-darwin-universal.zip",
        url: "https://updates.example.test/internal.zip",
        sha256: ARCHIVE_SHA256,
        size: ARCHIVE.length,
      },
    },
  };
}

function inspectedTarget(receipt = RECEIPT) {
  return {
    bundleId: "com.mangofuture.gitleaf",
    teamIdentifier: "HN6X79BUSR",
    version: receipt.version,
    buildInfo: {
      distribution: "official",
      usageAnalyticsDefault: true,
      ...receipt,
    },
  };
}

test("mac development handoff extracts the signed App with native ditto", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "git-leaf-mac-handoff-test."));
  try {
    const archivePath = path.join(root, "update.zip");
    const extractRoot = path.join(root, "extracted");
    const calls = [];
    mkdirSync(extractRoot, { recursive: true });
    const child = new EventEmitter();

    const extraction = extractMacDevelopmentHandoffArchive(archivePath, {
      dir: extractRoot,
      spawnProcess(command, args, options) {
        calls.push({ command, args, options });
        queueMicrotask(() => child.emit("close", 0, null));
        return child;
      },
    });
    await extraction;

    assert.deepEqual(calls, [{
      command: "ditto",
      args: ["-x", "-k", archivePath, extractRoot],
      options: { stdio: ["ignore", "ignore", "pipe"] },
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mac development handoff prepares only the exact signed internal target", {
  skip: process.platform === "win32" && "preparation uses macOS-native removal",
}, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "git-leaf-mac-handoff-test."));
  try {
    const userDataDir = path.join(root, "user-data");
    const targetAppPath = path.join(root, "installed", "OpenPeek.app");
    mkdirSync(targetAppPath, { recursive: true });
    const prepared = await prepareMacDevelopmentHandoffUpdate({
      manifest: manifest(),
      handoff: RECEIPT,
      userDataDir,
      targetAppPath,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        body: Readable.from([ARCHIVE]),
      }),
      extractArchive: async (_archivePath, { dir }) => {
        mkdirSync(path.join(dir, "Git Leaf.app"), { recursive: true });
      },
      inspectApp: () => inspectedTarget(),
    });

    assert.equal(prepared.version, RECEIPT.version);
    assert.equal(prepared.handoff.buildId, RECEIPT.buildId);
    const ready = JSON.parse(readFileSync(prepared.readyFile, "utf8"));
    assert.equal(ready.schemaVersion, 1);
    assert.equal(ready.sourceAppPath.endsWith("Git Leaf.app"), true);
    assert.equal(ready.targetAppPath, targetAppPath);
    assert.deepEqual(ready.handoff, RECEIPT);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a newer development handoff removes the older uninstalled package", {
  skip: process.platform === "win32" && "preparation uses macOS-native removal",
}, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "git-leaf-mac-handoff-replace."));
  try {
    const userDataDir = path.join(root, "user-data");
    const targetAppPath = path.join(root, "installed", "OpenPeek.app");
    mkdirSync(targetAppPath, { recursive: true });
    const replacement = {
      ...RECEIPT,
      version: "1.17.0",
      buildId: "3d4f9e9dfdfc.20260808T010000Z.internal",
      commit: "3d4f9e9dfdfc",
    };
    const prepare = (handoff) => prepareMacDevelopmentHandoffUpdate({
      manifest: {
        ...manifest(),
        ...handoff,
        files: {
          zip: {
            ...manifest().files.zip,
            name: `OpenPeek-${handoff.version}-internal-darwin-universal.zip`,
          },
        },
      },
      handoff,
      userDataDir,
      targetAppPath,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        body: Readable.from([ARCHIVE]),
      }),
      extractArchive: async (_archivePath, { dir }) => {
        mkdirSync(path.join(dir, "OpenPeek.app"), { recursive: true });
      },
      inspectApp: () => inspectedTarget(handoff),
    });

    const first = await prepare(RECEIPT);
    const second = await prepare(replacement);
    const updateRoot = macDevelopmentHandoffCachePaths({
      userDataDir,
      handoff: replacement,
    }).updateRoot;

    assert.deepEqual(readdirSync(updateRoot), [replacement.buildId]);
    assert.equal(existsSync(first.readyFile), false);
    assert.equal(existsSync(second.readyFile), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mac development handoff shares one preparation for concurrent retries", {
  skip: process.platform === "win32" && "preparation uses macOS-native removal",
}, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "git-leaf-mac-handoff-test."));
  let releaseExtraction;
  const extractionReleased = new Promise((resolve) => {
    releaseExtraction = resolve;
  });
  let extractionStarted;
  const extractionDidStart = new Promise((resolve) => {
    extractionStarted = resolve;
  });
  try {
    const userDataDir = path.join(root, "user-data");
    const targetAppPath = path.join(root, "installed", "OpenPeek.app");
    mkdirSync(targetAppPath, { recursive: true });
    let fetchCalls = 0;
    let extractCalls = 0;
    const options = {
      manifest: manifest(),
      handoff: RECEIPT,
      userDataDir,
      targetAppPath,
      fetchFn: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          body: Readable.from([ARCHIVE]),
        };
      },
      extractArchive: async (_archivePath, { dir }) => {
        extractCalls += 1;
        extractionStarted();
        await extractionReleased;
        mkdirSync(path.join(dir, "OpenPeek.app"), { recursive: true });
      },
      inspectApp: () => inspectedTarget(),
    };

    const first = prepareMacDevelopmentHandoffUpdate(options);
    await extractionDidStart;
    const retry = prepareMacDevelopmentHandoffUpdate(options);
    releaseExtraction();
    const [firstPrepared, retryPrepared] = await Promise.all([first, retry]);

    assert.equal(fetchCalls, 1);
    assert.equal(extractCalls, 1);
    assert.equal(retryPrepared.readyFile, firstPrepared.readyFile);
  } finally {
    releaseExtraction?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test("mac development handoff rejects an extracted App with another build identity", {
  skip: process.platform === "win32" && "preparation uses macOS-native removal",
}, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "git-leaf-mac-handoff-test."));
  try {
    mkdirSync(path.join(root, "installed", "OpenPeek.app"), {
      recursive: true,
    });
    await assert.rejects(
      prepareMacDevelopmentHandoffUpdate({
        manifest: manifest(),
        handoff: RECEIPT,
        userDataDir: path.join(root, "user-data"),
        targetAppPath: path.join(root, "installed", "OpenPeek.app"),
        fetchFn: async () => ({
          ok: true,
          status: 200,
          body: Readable.from([ARCHIVE]),
        }),
        extractArchive: async (_archivePath, { dir }) => {
          mkdirSync(path.join(dir, "OpenPeek.app"), { recursive: true });
        },
        inspectApp: () => ({
          ...inspectedTarget(),
          buildInfo: {
            ...inspectedTarget().buildInfo,
            buildId: "another.internal",
          },
        }),
      }),
      /target identity/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mac development handoff helper prepares config before switching Contents", async () => {
  const calls = [];
  const transaction = {
    commit() {
      calls.push("commit");
    },
    rollback() {
      calls.push("rollback");
    },
  };
  await installPreparedMacDevelopmentHandoff({
    ready: {
      schemaVersion: 1,
      handoff: RECEIPT,
      sourceAppPath: "/tmp/internal/OpenPeek.app",
      targetAppPath: "/Applications/OpenPeek.app",
      userDataDir: "/tmp/profile",
      launchArgs: ["--repo", "/tmp/repo"],
    },
    normalizeReady: (value) => value,
    waitForProcessExit: async () => calls.push("wait"),
    waitForAppProcessesExit: async (appPath, options) => {
      calls.push("wait-app");
      assert.equal(appPath, "/Applications/OpenPeek.app");
      assert.deepEqual(options.excludedProcessIds, [process.pid]);
    },
    prepareInstallation: async () => {
      calls.push("prepare-config");
      return {
        prepared: true,
        hadUsageAnalyticsSetting: true,
        previousUsageAnalyticsEnabled: false,
      };
    },
    beginContentsReplacement: () => {
      calls.push("replace");
      return transaction;
    },
    launchApp: async () => calls.push("launch"),
    cleanupPreparedUpdate: async () => calls.push("cleanup"),
  });
  assert.deepEqual(calls, [
    "wait",
    "wait-app",
    "prepare-config",
    "replace",
    "launch",
    "commit",
    "cleanup",
  ]);
});

test("mac development handoff helper rolls back Contents and config when relaunch fails", async () => {
  const calls = [];
  await assert.rejects(
    installPreparedMacDevelopmentHandoff({
      ready: {
        schemaVersion: 1,
        handoff: RECEIPT,
        sourceAppPath: "/tmp/internal/OpenPeek.app",
        targetAppPath: "/Applications/OpenPeek.app",
        userDataDir: "/tmp/profile",
        launchArgs: [],
      },
      normalizeReady: (value) => value,
      waitForProcessExit: async () => calls.push("wait"),
      waitForAppProcessesExit: async () => calls.push("wait-app"),
      prepareInstallation: async () => ({
        prepared: true,
        hadUsageAnalyticsSetting: true,
        previousUsageAnalyticsEnabled: false,
      }),
      beginContentsReplacement: () => ({
        commit() {
          calls.push("commit");
        },
        rollback() {
          calls.push("rollback");
        },
      }),
      launchApp: async () => {
        calls.push("launch");
        throw new Error("synthetic launch failure");
      },
      restoreInstallation: async () => calls.push("restore-config"),
    }),
    /synthetic launch failure/,
  );
  assert.deepEqual(calls, [
    "wait",
    "wait-app",
    "launch",
    "rollback",
    "restore-config",
  ]);
});

test("mac development handoff launches a detached Node helper from the current App", () => {
  const spawned = [];
  const child = { unrefCalled: false, unref() { this.unrefCalled = true; } };
  const result = launchMacDevelopmentHandoffUpdate({
    prepared: {
      readyFile: "/tmp/profile/updates/handoff/ready.json",
    },
    currentProcessId: 1234,
    executable: "/Applications/OpenPeek.app/Contents/MacOS/OpenPeek",
    helperPath: "/Applications/OpenPeek.app/Contents/Resources/app.asar/src/desktop/mac-development-handoff-update.mjs",
    spawnProcess(command, args, options) {
      spawned.push({ command, args, options });
      return child;
    },
  });
  assert.equal(result.status, "launched");
  assert.equal(child.unrefCalled, true);
  assert.equal(spawned[0].command, "/Applications/OpenPeek.app/Contents/MacOS/OpenPeek");
  assert.deepEqual(spawned[0].args, [
    "/Applications/OpenPeek.app/Contents/Resources/app.asar/src/desktop/mac-development-handoff-update.mjs",
    "--install-ready",
    "/tmp/profile/updates/handoff/ready.json",
    "--wait-pid",
    "1234",
  ]);
  assert.equal(spawned[0].options.detached, true);
  assert.equal(spawned[0].options.env.ELECTRON_RUN_AS_NODE, "1");
});

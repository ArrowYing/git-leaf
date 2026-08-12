import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanupWindowsUpdateCache,
  prepareWindowsAppUpdate,
  windowsPreparedUpdateLaunch,
  windowsUpdateCachePaths,
} from "../src/desktop/windows-app-update.mjs";

test("Windows updates download privately, verify, extract, and reuse a ready cache", async () => {
  const localAppData = await mkdtemp(path.join(tmpdir(), "git-leaf-win-update-"));
  const archive = Buffer.from("trusted update archive");
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const manifest = {
    version: "1.7.0",
    files: {
      zip: {
        url: "https://updates.mangofuture.com/git-leaf/stable/win32-x64/OpenPeek-1.7.0-win32-x64.zip",
        sha256,
        size: archive.length,
      },
    },
  };
  let fetchCount = 0;
  let extractCount = 0;
  const options = {
    manifest,
    localAppData,
    fetchFn: async () => {
      fetchCount += 1;
      return new Response(archive, { status: 200 });
    },
    async extractArchive(_archivePath, { dir }) {
      extractCount += 1;
      const sourceRoot = path.join(dir, "OpenPeek-win32-x64");
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(path.join(sourceRoot, "OpenPeek.exe"), "exe");
    },
  };

  const prepared = await prepareWindowsAppUpdate(options);
  assert.equal(prepared.version, "1.7.0");
  assert.equal(path.basename(prepared.executable), "OpenPeek.exe");
  assert.equal(fetchCount, 1);
  assert.equal(extractCount, 1);
  assert.equal(
    await readFile(windowsUpdateCachePaths({ localAppData, version: "1.7.0" }).archivePath, "utf8"),
    archive.toString(),
  );

  const paths = windowsUpdateCachePaths({ localAppData, version: "1.7.0" });
  await mkdir(windowsUpdateCachePaths({ localAppData, version: "1.6.0" }).versionRoot, {
    recursive: true,
  });
  await writeFile(path.join(paths.updateRoot, "orphan.tmp"), "orphan");

  const cached = await prepareWindowsAppUpdate(options);
  assert.equal(cached.executable, prepared.executable);
  assert.equal(fetchCount, 1);
  assert.equal(extractCount, 1);
  assert.deepEqual(await readdir(paths.updateRoot), ["1.7.0"]);

  await cleanupWindowsUpdateCache({ localAppData, currentVersion: "1.6.0" });
  assert.equal((await prepareWindowsAppUpdate(options)).executable, prepared.executable);
  assert.equal(fetchCount, 1);
  await cleanupWindowsUpdateCache({ localAppData, currentVersion: "1.7.0" });
  await prepareWindowsAppUpdate(options);
  assert.equal(fetchCount, 2);
});

test("preparing a newer Windows update removes the older uninstalled package", async () => {
  const localAppData = await mkdtemp(path.join(tmpdir(), "git-leaf-win-update-replace-"));

  async function prepare(version) {
    const archive = Buffer.from(`trusted update archive ${version}`);
    return prepareWindowsAppUpdate({
      manifest: {
        version,
        files: {
          zip: {
            url: `https://updates.example/OpenPeek-${version}.zip`,
            sha256: createHash("sha256").update(archive).digest("hex"),
            size: archive.length,
          },
        },
      },
      localAppData,
      fetchFn: async () => new Response(archive, { status: 200 }),
      async extractArchive(_archivePath, { dir }) {
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "OpenPeek.exe"), version);
      },
    });
  }

  const first = await prepare("1.7.0");
  const second = await prepare("1.8.0");
  const updateRoot = windowsUpdateCachePaths({
    localAppData,
    version: second.version,
  }).updateRoot;

  assert.deepEqual(await readdir(updateRoot), ["1.8.0"]);
  await assert.rejects(readFile(first.archivePath), { code: "ENOENT" });
  assert.equal(await readFile(second.executable, "utf8"), "1.8.0");
});

test("Windows startup cache cleanup keeps only the newest future version", async () => {
  const localAppData = await mkdtemp(path.join(tmpdir(), "git-leaf-win-update-cleanup-"));
  const updateRoot = windowsUpdateCachePaths({
    localAppData,
    version: "1.8.0",
  }).updateRoot;
  await mkdir(updateRoot, { recursive: true });
  await Promise.all([
    mkdir(path.join(updateRoot, "1.6.0"), { recursive: true }),
    mkdir(path.join(updateRoot, "1.7.0"), { recursive: true }),
    mkdir(path.join(updateRoot, "1.8.0"), { recursive: true }),
    mkdir(path.join(updateRoot, "not-a-version"), { recursive: true }),
    writeFile(path.join(updateRoot, "orphan.tmp"), "orphan"),
  ]);

  assert.equal(await cleanupWindowsUpdateCache({
    localAppData,
    currentVersion: "invalid",
  }), false);
  assert.equal((await readdir(updateRoot)).length, 5);

  assert.equal(await cleanupWindowsUpdateCache({
    localAppData,
    currentVersion: "1.6.0",
  }), true);
  assert.deepEqual(await readdir(updateRoot), ["1.8.0"]);
});

test("concurrent Windows retries share one download and extraction", async () => {
  const localAppData = await mkdtemp(path.join(tmpdir(), "git-leaf-win-update-concurrent-"));
  const archive = Buffer.from("trusted concurrent update archive");
  const manifest = {
    version: "1.8.0",
    files: {
      zip: {
        url: "https://updates.example/OpenPeek-1.8.0.zip",
        sha256: createHash("sha256").update(archive).digest("hex"),
        size: archive.length,
      },
    },
  };
  let fetchCalls = 0;
  let extractCalls = 0;
  let extractionStarted;
  const extractionDidStart = new Promise((resolve) => {
    extractionStarted = resolve;
  });
  let releaseExtraction;
  const extractionCanFinish = new Promise((resolve) => {
    releaseExtraction = resolve;
  });
  const options = {
    manifest,
    localAppData,
    fetchFn: async () => {
      fetchCalls += 1;
      return new Response(archive, { status: 200 });
    },
    async extractArchive(_archivePath, { dir }) {
      extractCalls += 1;
      extractionStarted();
      await extractionCanFinish;
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "OpenPeek.exe"), "1.8.0");
    },
  };

  const first = prepareWindowsAppUpdate(options);
  await extractionDidStart;
  const retry = prepareWindowsAppUpdate(options);
  let cleanupSettled = false;
  const cleanup = cleanupWindowsUpdateCache({
    localAppData,
    currentVersion: "1.7.0",
  }).then((result) => {
    cleanupSettled = true;
    return result;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cleanupSettled, false);
  releaseExtraction();
  const [firstPrepared, retryPrepared, cleaned] = await Promise.all([
    first,
    retry,
    cleanup,
  ]);

  assert.equal(fetchCalls, 1);
  assert.equal(extractCalls, 1);
  assert.equal(cleaned, true);
  assert.equal(retryPrepared.executable, firstPrepared.executable);
  assert.deepEqual(await readdir(windowsUpdateCachePaths({
    localAppData,
    version: "1.8.0",
  }).updateRoot), ["1.8.0"]);
});

test("a concurrent newer Windows target waits, then replaces the earlier package", async () => {
  const localAppData = await mkdtemp(path.join(tmpdir(), "git-leaf-win-update-serial-"));
  let firstExtractionStarted;
  const firstExtractionDidStart = new Promise((resolve) => {
    firstExtractionStarted = resolve;
  });
  let releaseFirstExtraction;
  const firstExtractionCanFinish = new Promise((resolve) => {
    releaseFirstExtraction = resolve;
  });

  function options(version, { wait = false } = {}) {
    const archive = Buffer.from(`trusted serial update archive ${version}`);
    return {
      manifest: {
        version,
        files: {
          zip: {
            url: `https://updates.example/OpenPeek-${version}.zip`,
            sha256: createHash("sha256").update(archive).digest("hex"),
            size: archive.length,
          },
        },
      },
      localAppData,
      fetchFn: async () => new Response(archive, { status: 200 }),
      async extractArchive(_archivePath, { dir }) {
        if (wait) {
          firstExtractionStarted();
          await firstExtractionCanFinish;
        }
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "OpenPeek.exe"), version);
      },
    };
  }

  const first = prepareWindowsAppUpdate(options("1.7.0", { wait: true }));
  await firstExtractionDidStart;
  const newer = prepareWindowsAppUpdate(options("1.8.0"));
  releaseFirstExtraction();
  await first;
  const newerPrepared = await newer;
  const updateRoot = windowsUpdateCachePaths({
    localAppData,
    version: newerPrepared.version,
  }).updateRoot;

  assert.deepEqual(await readdir(updateRoot), ["1.8.0"]);
  assert.equal(await readFile(newerPrepared.executable, "utf8"), "1.8.0");
});

test("Windows update preparation rejects a checksum mismatch", async () => {
  const localAppData = await mkdtemp(path.join(tmpdir(), "git-leaf-win-update-bad-"));
  await assert.rejects(
    prepareWindowsAppUpdate({
      manifest: {
        version: "1.7.0",
        files: {
          zip: {
            url: "https://updates.example/update.zip",
            sha256: "0".repeat(64),
            size: 3,
          },
        },
      },
      localAppData,
      fetchFn: async () => new Response("bad", { status: 200 }),
      async extractArchive() {
        assert.fail("invalid archives must not be extracted");
      },
    }),
    /SHA-256/,
  );
});

test("Windows prepared update launches outside the fixed directory and waits for the old process", () => {
  const launches = [];
  const result = windowsPreparedUpdateLaunch({
    prepared: {
      executable: "C:\\Users\\mango\\AppData\\Local\\OpenPeek\\updates\\1.7.0\\app\\OpenPeek.exe",
    },
    currentProcessId: 4321,
    args: [
      "--git-leaf-update-wait-pid=1234",
      "openpeek://open?repo=owner%2Frepo&path=README.md",
    ],
    spawnProcess(executable, args, options) {
      launches.push({ executable, args, options });
      return { unref() {} };
    },
  });

  assert.equal(result.status, "launched");
  assert.deepEqual(launches[0].args, [
    "--openpeek-update-wait-pid=4321",
    "openpeek://open?repo=owner%2Frepo&path=README.md",
  ]);
  assert.equal(launches[0].options.detached, true);
});

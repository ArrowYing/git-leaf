import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
        url: "https://updates.mangofuture.com/git-leaf/stable/win32-x64/GitLeaf-1.7.0-win32-x64.zip",
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
      const sourceRoot = path.join(dir, "Git Leaf-win32-x64");
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(path.join(sourceRoot, "Git Leaf.exe"), "exe");
    },
  };

  const prepared = await prepareWindowsAppUpdate(options);
  assert.equal(prepared.version, "1.7.0");
  assert.equal(path.basename(prepared.executable), "Git Leaf.exe");
  assert.equal(fetchCount, 1);
  assert.equal(extractCount, 1);
  assert.equal(
    await readFile(windowsUpdateCachePaths({ localAppData, version: "1.7.0" }).archivePath, "utf8"),
    archive.toString(),
  );

  const cached = await prepareWindowsAppUpdate(options);
  assert.equal(cached.executable, prepared.executable);
  assert.equal(fetchCount, 1);
  assert.equal(extractCount, 1);

  await cleanupWindowsUpdateCache({ localAppData, currentVersion: "1.6.0" });
  assert.equal((await prepareWindowsAppUpdate(options)).executable, prepared.executable);
  assert.equal(fetchCount, 1);
  await cleanupWindowsUpdateCache({ localAppData, currentVersion: "1.7.0" });
  await prepareWindowsAppUpdate(options);
  assert.equal(fetchCount, 2);
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
      executable: "C:\\Users\\mango\\AppData\\Local\\GitLeaf\\updates\\1.7.0\\app\\Git Leaf.exe",
    },
    currentProcessId: 4321,
    args: ["git-leaf://open?repo=owner%2Frepo&path=README.md"],
    spawnProcess(executable, args, options) {
      launches.push({ executable, args, options });
      return { unref() {} };
    },
  });

  assert.equal(result.status, "launched");
  assert.deepEqual(launches[0].args, [
    "--git-leaf-update-wait-pid=4321",
    "git-leaf://open?repo=owner%2Frepo&path=README.md",
  ]);
  assert.equal(launches[0].options.detached, true);
});

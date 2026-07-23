import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createToolVersionMonitor,
  toolFingerprint,
} from "../src/tool-version.mjs";

test("toolFingerprint changes when runtime files change", async () => {
  const appRoot = await testAppRoot();

  const first = await toolFingerprint({ appRoot });
  await writeFile(path.join(appRoot, "public", "app.js"), "console.log('changed');\n");
  const second = await toolFingerprint({ appRoot });

  assert.notEqual(second.fingerprint, first.fingerprint);
});

test("tool version monitor only rehashes after a throttled stat change", async () => {
  let now = 1_000;
  const appRoot = await testAppRoot();
  const monitor = await createToolVersionMonitor({
    appRoot,
    now: () => now,
    minCheckIntervalMs: 30_000,
  });

  const first = await monitor.checkForUpdate();
  now += 1_000;
  await writeFile(path.join(appRoot, "public", "app.js"), "console.log('changed');\n");
  const throttled = await monitor.checkForUpdate();
  now += 30_000;
  const changed = await monitor.checkForUpdate();

  assert.equal(first.stale, false);
  assert.equal(throttled.stale, false);
  assert.equal(changed.stale, true);
  assert.notEqual(changed.fingerprint, monitor.startupFingerprint);
});

async function testAppRoot() {
  const appRoot = await mkdir(path.join(tmpdir(), `git-leaf-tool-${Date.now()}-`), {
    recursive: true,
  });
  await mkdir(path.join(appRoot, "src"), { recursive: true });
  await mkdir(path.join(appRoot, "public"), { recursive: true });
  await writeFile(path.join(appRoot, "package.json"), "{}\n");
  await writeFile(path.join(appRoot, "package-lock.json"), "{}\n");
  await writeFile(path.join(appRoot, "src", "server.mjs"), "export const server = true;\n");
  await writeFile(path.join(appRoot, "public", "app.js"), "console.log('app');\n");
  return appRoot;
}

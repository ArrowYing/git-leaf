#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupRemoteSyncSmokeFixture,
  createRemoteSyncSmokeFixture,
  verifyRemoteSyncSmokeFixture,
} from "./remote-sync-smoke-fixture.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const fixture = createRemoteSyncSmokeFixture();

console.log(`Remote sync smoke repository: ${fixture.repoRoot}`);
console.log(`Remote sync smoke document: ${fixture.file}`);
console.log(`Acceptance: ${fixture.acceptance}`);

let exitCode = 1;
try {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "release-mac.mjs"), "dev-smoke"],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        OPENPEEK_SMOKE_REPO_ROOT: fixture.repoRoot,
        OPENPEEK_SMOKE_FILE: fixture.file,
      },
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    exitCode = result.status ?? 1;
  } else {
    verifyRemoteSyncSmokeFixture(fixture);
    console.log("Remote sync smoke fixture verified.");
    exitCode = 0;
  }
} finally {
  cleanupRemoteSyncSmokeFixture(fixture);
}

process.exitCode = exitCode;

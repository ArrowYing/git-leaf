#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupLiveTableSmokeFixture,
  containsNativeLiveTableSmokeTable,
  createLiveTableSmokeFixture,
  readLiveTableSmokeDocument,
} from "./live-table-smoke-fixture.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const fixture = createLiveTableSmokeFixture();

console.log(`Live table smoke repository: ${fixture.repoRoot}`);
console.log(`Live table smoke document: ${fixture.file}`);
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
        GIT_LEAF_SMOKE_REPO_ROOT: fixture.repoRoot,
        GIT_LEAF_SMOKE_FILE: fixture.file,
      },
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (!containsNativeLiveTableSmokeTable(readLiveTableSmokeDocument(fixture))) {
    throw new Error("Live table smoke no longer contains the native Markdown table.");
  }
  exitCode = result.status ?? 1;
} finally {
  cleanupLiveTableSmokeFixture(fixture);
}

process.exitCode = exitCode;

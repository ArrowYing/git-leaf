#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupDocumentChangesSmokeFixture,
  createDocumentChangesSmokeFixture,
} from "./document-changes-smoke-fixture.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const fixture = createDocumentChangesSmokeFixture();

console.log(`Document changes smoke repository: ${fixture.repoRoot}`);
console.log(`Document changes smoke document: ${fixture.file}`);
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
  exitCode = result.status ?? 1;
} finally {
  cleanupDocumentChangesSmokeFixture(fixture);
}

process.exitCode = exitCode;

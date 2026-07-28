import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REMOTE_SYNC_SMOKE_FILE,
  REMOTE_SYNC_SMOKE_LOCAL_CONTENT,
  cleanupRemoteSyncSmokeFixture,
  createRemoteSyncSmokeFixture,
} from "../scripts/remote-sync-smoke-fixture.mjs";

test("remote sync smoke fixture starts behind with one uncommitted local document", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-remote-smoke-test-"));
  const fixture = createRemoteSyncSmokeFixture({ temporaryRoot });
  try {
    assert.equal(fixture.file, REMOTE_SYNC_SMOKE_FILE);
    assert.equal(
      await readFile(path.join(fixture.repoRoot, fixture.file), "utf8"),
      REMOTE_SYNC_SMOKE_LOCAL_CONTENT,
    );
    assert.match(fixture.acceptance, /automatically merges/);
  } finally {
    cleanupRemoteSyncSmokeFixture(fixture);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

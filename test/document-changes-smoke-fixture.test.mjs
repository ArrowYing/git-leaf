import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DOCUMENT_CHANGES_SMOKE_ACCEPTANCE,
  DOCUMENT_CHANGES_SMOKE_FILE,
  DOCUMENT_CHANGES_SMOKE_SIBLING,
  cleanupDocumentChangesSmokeFixture,
  createDocumentChangesSmokeFixture,
  documentChangesSmokeBaseline,
  documentChangesSmokeCurrent,
  readDocumentChangesSmokeDocument,
} from "../scripts/document-changes-smoke-fixture.mjs";

test("document changes smoke fixture preserves a committed baseline and dirty current document", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-document-changes-fixture-test-"));
  const fixture = createDocumentChangesSmokeFixture({ temporaryRoot });
  try {
    assert.equal(fixture.file, DOCUMENT_CHANGES_SMOKE_FILE);
    assert.equal(fixture.siblingFile, DOCUMENT_CHANGES_SMOKE_SIBLING);
    assert.equal(readDocumentChangesSmokeDocument(fixture), documentChangesSmokeCurrent());
    assert.equal(
      execFileSync("git", ["show", `HEAD:${fixture.file}`], {
        cwd: fixture.repoRoot,
        encoding: "utf8",
      }),
      documentChangesSmokeBaseline(),
    );
    assert.equal(
      execFileSync("git", ["status", "--short", "--", fixture.file], {
        cwd: fixture.repoRoot,
        encoding: "utf8",
      }).trim(),
      `M ${fixture.file}`,
    );
    assert.match(
      readFileSync(path.join(fixture.repoRoot, fixture.siblingFile), "utf8"),
      /用于验证切换文档后返回/,
    );
    assert.match(DOCUMENT_CHANGES_SMOKE_ACCEPTANCE, /铺满整行改动底色/);
    assert.match(DOCUMENT_CHANGES_SMOKE_ACCEPTANCE, /深色模式下显示清晰蓝色底/);
  } finally {
    cleanupDocumentChangesSmokeFixture(fixture);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  assert.equal(existsSync(fixture.repoRoot), false);
});

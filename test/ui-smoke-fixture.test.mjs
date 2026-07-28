import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DOCUMENT_OUTLINE_SMOKE_HEADING,
  TREE_TOOLTIP_SMOKE_AI_SNIPPET,
  TREE_TOOLTIP_SMOKE_RELATIVE_FILE,
  TREE_TOOLTIP_SMOKE_SEARCH_TERM,
  cleanupTreeTooltipSmokeFixture,
  createTreeTooltipSmokeFixture,
} from "../scripts/ui-smoke-fixture.mjs";

test("tree tooltip smoke fixture creates and cleans a deterministic long filename repository", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-ui-smoke-fixture-test-"));
  const fixture = createTreeTooltipSmokeFixture({ temporaryRoot });
  try {
    assert.equal(fixture.file, TREE_TOOLTIP_SMOKE_RELATIVE_FILE);
    assert.equal(fixture.searchTerm, TREE_TOOLTIP_SMOKE_SEARCH_TERM);
    assert.ok(path.basename(fixture.file).length > 70);
    assert.match(fixture.acceptance, /静止至少 10 秒/);
    assert.match(fixture.acceptance, new RegExp(TREE_TOOLTIP_SMOKE_SEARCH_TERM));
    assert.equal(
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: fixture.repoRoot,
        encoding: "utf8",
      }).trim(),
      "true",
    );
    assert.match(
      readFileSync(path.join(fixture.repoRoot, fixture.file), "utf8"),
      new RegExp(DOCUMENT_OUTLINE_SMOKE_HEADING),
    );
    assert.match(
      readFileSync(path.join(fixture.repoRoot, "README.md"), "utf8"),
      new RegExp(TREE_TOOLTIP_SMOKE_AI_SNIPPET),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(
        path.join(fixture.repoRoot, "docs", "frontmatter-rules.json"),
        "utf8",
      )).basicFields,
      ["title", "domain", "ai_snippet"],
    );
    const siblings = readdirSync(path.dirname(path.join(fixture.repoRoot, fixture.file)));
    assert.ok(siblings.length >= 5);
    assert.ok(siblings.every((fileName) => fileName.endsWith(".md")));
  } finally {
    cleanupTreeTooltipSmokeFixture(fixture);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  assert.equal(existsSync(fixture.repoRoot), false);
});

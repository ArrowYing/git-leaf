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
  TREE_TOOLTIP_SMOKE_DOCUMENT_TITLE,
  TREE_TOOLTIP_SMOKE_RELATIVE_FILE,
  TREE_TOOLTIP_SMOKE_READONLY_FILE,
  TREE_TOOLTIP_SMOKE_ROOT_FILE,
  TREE_TOOLTIP_SMOKE_ROOT_TITLE,
  TREE_TOOLTIP_SMOKE_SEARCH_TERM,
  cleanupTreeTooltipSmokeFixture,
  createTreeTooltipSmokeFixture,
} from "../scripts/ui-smoke-fixture.mjs";

test("tree tooltip smoke fixture creates and cleans a deterministic long filename repository", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-ui-smoke-fixture-test-"));
  const fixture = createTreeTooltipSmokeFixture({ temporaryRoot });
  try {
    assert.equal(fixture.file, TREE_TOOLTIP_SMOKE_RELATIVE_FILE);
    assert.equal(fixture.readonlyFile, TREE_TOOLTIP_SMOKE_READONLY_FILE);
    assert.equal(fixture.rootFile, TREE_TOOLTIP_SMOKE_ROOT_FILE);
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
    const smokeDocument = readFileSync(path.join(fixture.repoRoot, fixture.file), "utf8");
    assert.match(smokeDocument, new RegExp(DOCUMENT_OUTLINE_SMOKE_HEADING));
    assert.match(smokeDocument, new RegExp(`^title: ${TREE_TOOLTIP_SMOKE_DOCUMENT_TITLE}$`, "m"));
    assert.match(fixture.acceptance, new RegExp(TREE_TOOLTIP_SMOKE_DOCUMENT_TITLE));
    assert.match(
      readFileSync(path.join(fixture.repoRoot, fixture.rootFile), "utf8"),
      new RegExp(`^title: ${TREE_TOOLTIP_SMOKE_ROOT_TITLE}$`, "m"),
    );
    assert.match(fixture.acceptance, new RegExp(TREE_TOOLTIP_SMOKE_ROOT_FILE));
    assert.match(
      readFileSync(path.join(fixture.repoRoot, "README.md"), "utf8"),
      new RegExp(TREE_TOOLTIP_SMOKE_AI_SNIPPET),
    );
    assert.match(
      readFileSync(path.join(fixture.repoRoot, ...fixture.readonlyFile.split("/")), "utf8"),
      /^date,active_users$/m,
    );
    assert.match(fixture.acceptance, /目录行必须把完整可用宽度留给文件名/);
    assert.match(fixture.acceptance, /顶部模式区域必须只保留 Preview 并显示“只读”/);
    assert.deepEqual(
      JSON.parse(readFileSync(
        path.join(fixture.repoRoot, "docs", "frontmatter-rules.json"),
        "utf8",
      )).basicFields,
      ["title", "domain", "ai_snippet"],
    );
    const siblings = readdirSync(path.dirname(path.join(fixture.repoRoot, fixture.file)));
    const readonlyFileName = path.basename(fixture.readonlyFile);
    const markdownSiblings = siblings.filter((fileName) => fileName !== readonlyFileName);
    assert.ok(markdownSiblings.length >= 5);
    assert.ok(markdownSiblings.every((fileName) => fileName.endsWith(".md")));
    assert.equal(siblings.includes(readonlyFileName), true);
  } finally {
    cleanupTreeTooltipSmokeFixture(fixture);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  assert.equal(existsSync(fixture.repoRoot), false);
});

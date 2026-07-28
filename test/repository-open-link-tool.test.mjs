import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createGitLeafOpenLink as createCanonicalOpenLink,
} from "../src/server/git-leaf-open-link.mjs";
import {
  createGitLeafOpenLink,
  githubRepositoryIdentityFromRemote,
  normalizeMarkdownPath,
  parseGitWorktreeRoots,
  worktreeIdForPath,
} from "../tools/generate-git-leaf-open-link.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL("../tools/generate-git-leaf-open-link.mjs", import.meta.url),
);

test("portable link tool supports common GitHub origin formats", () => {
  assert.equal(
    githubRepositoryIdentityFromRemote("git@github.com:ExampleOrg/shared-context.git"),
    "exampleorg/shared-context",
  );
  assert.equal(
    githubRepositoryIdentityFromRemote("https://person@github.com/ExampleOrg/shared-context"),
    "exampleorg/shared-context",
  );
  assert.equal(githubRepositoryIdentityFromRemote("https://example.com/acme/docs.git"), "");
});

test("portable link tool accepts only repository-relative Markdown and MDX paths", () => {
  assert.equal(normalizeMarkdownPath("docs\\guides\\preview.mdx"), "docs/guides/preview.mdx");
  assert.throws(() => normalizeMarkdownPath("../outside.md"), /repository-relative/);
  assert.throws(() => normalizeMarkdownPath("docs/report.pdf"), /repository-relative/);
});

test("portable link tool parses null- and newline-delimited worktree records", () => {
  const fields = [
    "worktree /repos/shared-context",
    "HEAD 1111111",
    "branch refs/heads/main",
    "",
    "worktree /repos/shared-context-task",
    "HEAD 2222222",
    "branch refs/heads/task",
    "",
  ];
  assert.deepEqual(parseGitWorktreeRoots(fields.join("\0")), [
    "/repos/shared-context",
    "/repos/shared-context-task",
  ]);
  assert.deepEqual(parseGitWorktreeRoots(fields.join("\n")), [
    "/repos/shared-context",
    "/repos/shared-context-task",
  ]);
  assert.deepEqual(parseGitWorktreeRoots(fields.join("\r\n")), [
    "/repos/shared-context",
    "/repos/shared-context-task",
  ]);
});

test("portable link tool matches Git Leaf for primary and linked worktrees", async (t) => {
  const fixture = await createRepositoryFixture(t);
  const expectedPrimaryLink =
    "https://gitleaf.mangofuture.com/open?repo=exampleorg%2Fshared-context&path=docs%2Freport.md";

  assert.equal(
    await createGitLeafOpenLink({ repoRoot: fixture.primaryRoot, file: "docs/report.md" }),
    expectedPrimaryLink,
  );
  assert.equal(
    await createCanonicalOpenLink({ repoRoot: fixture.primaryRoot, file: "docs/report.md" }),
    expectedPrimaryLink,
  );

  const linkedRoot = await realpath(fixture.linkedRoot);
  const expectedLinkedLink =
    `${expectedPrimaryLink}&worktree=${worktreeIdForPath(linkedRoot)}`;
  assert.equal(
    await createGitLeafOpenLink({ repoRoot: fixture.linkedRoot, file: "docs/report.md" }),
    expectedLinkedLink,
  );
  assert.equal(
    await createCanonicalOpenLink({ repoRoot: fixture.linkedRoot, file: "docs/report.md" }),
    expectedLinkedLink,
  );

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--repo-root",
    fixture.linkedRoot,
    "--file",
    "docs/report.md",
  ]);
  assert.equal(stdout.trim(), expectedLinkedLink);
});

async function createRepositoryFixture(t) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-open-link-tool-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  const primaryRoot = path.join(fixtureRoot, "shared-context");
  const linkedRoot = path.join(fixtureRoot, "shared-context-task");
  await mkdir(path.join(primaryRoot, "docs"), { recursive: true });
  await runGit(primaryRoot, ["init", "-q", "-b", "main"]);
  await runGit(primaryRoot, ["config", "user.name", "Test User"]);
  await runGit(primaryRoot, ["config", "user.email", "test@example.com"]);
  await writeFile(path.join(primaryRoot, "docs", "report.md"), "# Report\n");
  await runGit(primaryRoot, ["add", "docs/report.md"]);
  await runGit(primaryRoot, ["commit", "-q", "-m", "initial"]);
  await runGit(primaryRoot, [
    "remote",
    "add",
    "origin",
    "https://github.com/ExampleOrg/shared-context.git",
  ]);
  await runGit(primaryRoot, ["worktree", "add", "-q", "-b", "task", linkedRoot]);

  return { primaryRoot, linkedRoot };
}

async function runGit(cwd, args) {
  await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

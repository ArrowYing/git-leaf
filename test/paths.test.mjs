import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { findRepoRoot, resolveOpenablePath, resolvePreviewPath } from "../src/paths.mjs";
import { GitRepositoryNotFoundError } from "../src/git-errors.mjs";

test("findRepoRoot classifies directories outside Git repositories", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "git-leaf-not-a-repo-"));

  await assert.rejects(
    () => findRepoRoot(directory),
    (error) => {
      assert.equal(error instanceof GitRepositoryNotFoundError, true);
      assert.equal(error.code, "NOT_GIT_REPOSITORY");
      assert.match(error.message, /Could not find a git repository/);
      return true;
    },
  );
});

test("findRepoRoot classifies a removed working directory before spawning Git", async () => {
  const missingDirectory = path.join(tmpdir(), `git-leaf-removed-${Date.now()}`);
  let commandCalled = false;

  await assert.rejects(
    () => findRepoRoot(missingDirectory, {
      gitRunner: async () => {
        commandCalled = true;
        return { stdout: "" };
      },
    }),
    (error) => error instanceof GitRepositoryNotFoundError,
  );
  assert.equal(commandCalled, false);
});

test("findRepoRoot preserves Git dependency failures instead of calling them repository errors", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "git-leaf-git-unavailable-"));
  await mkdir(path.join(directory, ".git"));
  const missingGit = new Error("spawn git ENOENT");
  missingGit.code = "ENOENT";

  await assert.rejects(
    () => findRepoRoot(directory, {
      gitRunner: async () => {
        throw missingGit;
      },
    }),
    (error) => error === missingGit,
  );
});

test("findRepoRoot rejects a successful command with an empty repository root", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "git-leaf-empty-root-"));

  await assert.rejects(
    () => findRepoRoot(directory, {
      gitRunner: async () => ({ stdout: "\n" }),
    }),
    (error) => error.externalCommandState === "invalid_output",
  );
});

test("resolvePreviewPath accepts repository-relative markdown files", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "sample.md"), "# Sample\n");

  const resolved = await resolvePreviewPath(repoRoot, "sample.md");

  assert.equal(resolved.relativePath, "sample.md");
  assert.equal(resolved.absolutePath, await realpath(path.join(repoRoot, "sample.md")));
});

test("resolvePreviewPath rejects files outside the repository", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  const outsideFile = path.join(tmpdir(), "outside-preview.md");
  await writeFile(outsideFile, "# Outside\n");

  await assert.rejects(
    () => resolvePreviewPath(repoRoot, outsideFile),
    /inside the repository/,
  );
});

test("resolvePreviewPath rejects non-markdown files", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "notes.txt"), "not markdown\n");

  await assert.rejects(
    () => resolvePreviewPath(repoRoot, "notes.txt"),
    /Markdown or MDX/,
  );
});

test("resolveOpenablePath accepts selected readonly preview files", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "data.json"), "{\"ok\":true}\n");

  const resolved = await resolveOpenablePath(repoRoot, "data.json");

  assert.equal(resolved.relativePath, "data.json");
  assert.equal(resolved.kind, "json");
  assert.equal(resolved.editable, false);
});

test("resolveOpenablePath classifies BMP files as readonly image previews", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "diagram.bmp"), Buffer.from("bmp-image"));

  const resolved = await resolveOpenablePath(repoRoot, "diagram.bmp");

  assert.equal(resolved.relativePath, "diagram.bmp");
  assert.equal(resolved.kind, "image");
  assert.equal(resolved.raw, true);
  assert.equal(resolved.editable, false);
});

test("resolveOpenablePath accepts unsupported binary files as visible placeholders", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "archive.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));

  const resolved = await resolveOpenablePath(repoRoot, "archive.zip");

  assert.equal(resolved.relativePath, "archive.zip");
  assert.equal(resolved.kind, "unsupported");
  assert.equal(resolved.editable, false);
});

test("resolveOpenablePath detects unknown UTF-8 files as readonly code text", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await writeFile(path.join(repoRoot, "Dockerfile.custom"), "FROM node:22\n");

  const resolved = await resolveOpenablePath(repoRoot, "Dockerfile.custom");

  assert.equal(resolved.kind, "code");
  assert.equal(resolved.editable, false);
});

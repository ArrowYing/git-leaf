import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  symlink,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  cleanupManagedDirectoryPlaceholder,
  createRepositoryDirectory,
  deleteRepositoryPath,
  previewRepositoryDelete,
  previewRepositoryDirectoryCreation,
  previewRepositoryFileRename,
  renameRepositoryFile,
  rewriteMarkdownRepositoryReferences,
} from "../src/server/repository-file-operations.mjs";

const run = promisify(execFile);

async function createRepository() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-file-operations-"));
  await run("git", ["init", "-q"], { cwd: repoRoot });
  return repoRoot;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

test("reference rewriting updates Markdown and HTML targets but leaves code examples alone", () => {
  const source = [
    "[Document](./old.md#overview)",
    "[forward][guide]",
    "[guide]: old.md",
    "![Image](<old image.png>)",
    "`[inline code](old.md)`",
    "```md",
    "[fenced code](old.md)",
    "```",
    '<a href="old.md?mode=preview">HTML link</a>',
    "",
  ].join("\n");

  const result = rewriteMarkdownRepositoryReferences({
    source,
    sourcePath: "docs/index.md",
    targetPath: "docs/old.md",
    replacementPath: "docs/new name.md",
  });

  assert.equal(result.referenceCount, 3);
  assert.match(result.rewrittenSource, /\[Document\]\(\.\/new%20name\.md#overview\)/);
  assert.match(result.rewrittenSource, /\[guide\]: new%20name\.md/);
  assert.match(result.rewrittenSource, /href="new%20name\.md\?mode=preview"/);
  assert.match(result.rewrittenSource, /`\[inline code\]\(old\.md\)`/);
  assert.match(result.rewrittenSource, /\[fenced code\]\(old\.md\)/);
  assert.match(result.rewrittenSource, /!\[Image\]\(<old image\.png>\)/);
});

test("creating a folder writes a visible-to-Git placeholder and removes only its session-owned untracked marker", async () => {
  const repoRoot = await createRepository();
  const managedPlaceholders = new Set();

  const preview = await previewRepositoryDirectoryCreation({
    repoRoot,
    name: "planning",
  });
  assert.equal(preview.markerPath, "planning/.gitkeep");

  const created = await createRepositoryDirectory({
    repoRoot,
    name: "planning",
    managedPlaceholders,
  });
  const markerPath = path.join(repoRoot, "planning", ".gitkeep");
  assert.equal(created.path, "planning");
  assert.equal(await readFile(markerPath, "utf8"), "");
  assert.equal(managedPlaceholders.size, 1);

  await writeFile(path.join(repoRoot, "planning", "brief.md"), "# Brief\n");
  assert.equal(await cleanupManagedDirectoryPlaceholder({
    repoRoot,
    createdPath: "planning/brief.md",
    managedPlaceholders,
  }), true);
  assert.equal(await pathExists(markerPath), false);
  assert.equal(await pathExists(path.join(repoRoot, "planning")), true);
});

test("managed folder placeholders stay scoped to the repository that created them", async () => {
  const firstRepoRoot = await createRepository();
  const secondRepoRoot = await createRepository();
  const managedPlaceholders = new Set();
  await createRepositoryDirectory({
    repoRoot: firstRepoRoot,
    name: "planning",
    managedPlaceholders,
  });
  await mkdir(path.join(secondRepoRoot, "planning"));
  await writeFile(path.join(secondRepoRoot, "planning", ".gitkeep"), "");
  await writeFile(path.join(secondRepoRoot, "planning", "brief.md"), "# Brief\n");

  assert.equal(await cleanupManagedDirectoryPlaceholder({
    repoRoot: secondRepoRoot,
    createdPath: "planning/brief.md",
    managedPlaceholders,
  }), false);
  assert.equal(
    await pathExists(path.join(secondRepoRoot, "planning", ".gitkeep")),
    true,
  );

  await writeFile(path.join(firstRepoRoot, "planning", "brief.md"), "# Brief\n");
  assert.equal(await cleanupManagedDirectoryPlaceholder({
    repoRoot: firstRepoRoot,
    createdPath: "planning/brief.md",
    managedPlaceholders,
  }), true);
  assert.equal(
    await pathExists(path.join(firstRepoRoot, "planning", ".gitkeep")),
    false,
  );
});

test("folder creation is blocked when Git ignores its placeholder", async () => {
  const repoRoot = await createRepository();
  await writeFile(path.join(repoRoot, ".gitignore"), "ignored/\n");

  await assert.rejects(
    () => previewRepositoryDirectoryCreation({
      repoRoot,
      name: "ignored",
      locale: "zh-CN",
    }),
    (error) => error?.code === "folder_marker_ignored" && /Git/.test(error.message),
  );
  assert.equal(await pathExists(path.join(repoRoot, "ignored")), false);
});

test("file operations reject a path that traverses a directory symlink", async () => {
  const repoRoot = await createRepository();
  const outsideRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-file-operations-outside-"));
  await writeFile(path.join(outsideRoot, "outside.md"), "# Outside\n");
  await symlink(outsideRoot, path.join(repoRoot, "linked"));

  await assert.rejects(
    () => previewRepositoryFileRename({
      repoRoot,
      filePath: "linked/outside.md",
      name: "renamed.md",
    }),
    (error) => error?.code === "file_path_outside_repository",
  );
  assert.equal(await readFile(path.join(outsideRoot, "outside.md"), "utf8"), "# Outside\n");
});

test("file operations reject repository metadata paths", async () => {
  const repoRoot = await createRepository();

  await assert.rejects(
    () => previewRepositoryDelete({
      repoRoot,
      targetPath: ".git/config",
    }),
    (error) => error?.code === "file_path_invalid",
  );
  assert.equal(await pathExists(path.join(repoRoot, ".git", "config")), true);
});

test("reference discovery ignores Markdown-named symlinks outside the repository", async () => {
  const repoRoot = await createRepository();
  const outsideRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-file-operations-outside-"));
  const outsidePath = path.join(outsideRoot, "outside.md");
  await writeFile(path.join(repoRoot, "old.md"), "# Old\n");
  await writeFile(outsidePath, "[Old](old.md)\n");
  await symlink(outsidePath, path.join(repoRoot, "linked.md"));

  const preview = await previewRepositoryFileRename({
    repoRoot,
    filePath: "old.md",
    name: "new.md",
  });
  assert.equal(preview.referenceCount, 0);
  await renameRepositoryFile({
    repoRoot,
    filePath: "old.md",
    name: "new.md",
    fingerprint: preview.fingerprint,
  });

  assert.equal(await readFile(outsidePath, "utf8"), "[Old](old.md)\n");
  assert.equal(await pathExists(path.join(repoRoot, "new.md")), true);
});

test("renaming one regular file updates incoming document references atomically", async () => {
  const repoRoot = await createRepository();
  await mkdir(path.join(repoRoot, "docs"));
  await writeFile(path.join(repoRoot, "docs", "old.md"), "# Old\n\n[Self](old.md)\n");
  await writeFile(path.join(repoRoot, "README.md"), [
    "[Old](docs/old.md)",
    '<a href="docs/old.md#top">Old HTML</a>',
    "```md",
    "[Example](docs/old.md)",
    "```",
    "",
  ].join("\n"));

  const preview = await previewRepositoryFileRename({
    repoRoot,
    filePath: "docs/old.md",
    name: "new name.md",
  });
  assert.equal(preview.targetPath, "docs/new name.md");
  assert.equal(preview.referenceCount, 3);
  assert.deepEqual(preview.referenceFiles, ["README.md", "docs/old.md"]);

  const result = await renameRepositoryFile({
    repoRoot,
    filePath: "docs/old.md",
    name: "new name.md",
    fingerprint: preview.fingerprint,
  });
  assert.equal(result.targetPath, "docs/new name.md");
  assert.equal(await pathExists(path.join(repoRoot, "docs", "old.md")), false);
  assert.match(
    await readFile(path.join(repoRoot, "README.md"), "utf8"),
    /\[Old\]\(docs\/new%20name\.md\)/,
  );
  assert.match(
    await readFile(path.join(repoRoot, "docs", "new name.md"), "utf8"),
    /\[Self\]\(new%20name\.md\)/,
  );
  assert.match(
    await readFile(path.join(repoRoot, "README.md"), "utf8"),
    /\[Example\]\(docs\/old\.md\)/,
  );
});

test("renaming an image updates Markdown and quoted HTML image references", async () => {
  const repoRoot = await createRepository();
  await mkdir(path.join(repoRoot, "assets"));
  await writeFile(path.join(repoRoot, "assets", "diagram old.png"), "image");
  await writeFile(path.join(repoRoot, "README.md"), [
    "![Diagram](assets/diagram%20old.png)",
    '<img src="assets/diagram%20old.png#preview">',
    "",
  ].join("\n"));

  const preview = await previewRepositoryFileRename({
    repoRoot,
    filePath: "assets/diagram old.png",
    name: "diagram new.png",
  });
  assert.equal(preview.referenceCount, 2);

  await renameRepositoryFile({
    repoRoot,
    filePath: "assets/diagram old.png",
    name: "diagram new.png",
    fingerprint: preview.fingerprint,
  });
  const source = await readFile(path.join(repoRoot, "README.md"), "utf8");
  assert.match(source, /!\[Diagram\]\(assets\/diagram%20new\.png\)/);
  assert.match(source, /src="assets\/diagram%20new\.png#preview"/);
  assert.equal(await pathExists(path.join(repoRoot, "assets", "diagram old.png")), false);
  assert.equal(await pathExists(path.join(repoRoot, "assets", "diagram new.png")), true);
});

test("rename execution rejects a stale preview without changing any path", async () => {
  const repoRoot = await createRepository();
  await writeFile(path.join(repoRoot, "old.md"), "# Old\n");
  await writeFile(path.join(repoRoot, "index.md"), "[Old](old.md)\n");
  const preview = await previewRepositoryFileRename({
    repoRoot,
    filePath: "old.md",
    name: "new.md",
  });
  await writeFile(path.join(repoRoot, "index.md"), "[Old](old.md)\n\nChanged\n");

  await assert.rejects(
    () => renameRepositoryFile({
      repoRoot,
      filePath: "old.md",
      name: "new.md",
      fingerprint: preview.fingerprint,
    }),
    (error) => error?.code === "file_operation_stale",
  );
  assert.equal(await pathExists(path.join(repoRoot, "old.md")), true);
  assert.equal(await pathExists(path.join(repoRoot, "new.md")), false);
});

test("delete preview distinguishes Git-recoverable content from an untracked draft", async () => {
  const repoRoot = await createRepository();
  await writeFile(path.join(repoRoot, "tracked.md"), "# Tracked\n");
  await writeFile(path.join(repoRoot, "draft.md"), "# Draft\n");
  await run("git", ["add", "tracked.md"], { cwd: repoRoot });

  const tracked = await previewRepositoryDelete({
    repoRoot,
    targetPath: "tracked.md",
  });
  const draft = await previewRepositoryDelete({
    repoRoot,
    targetPath: "draft.md",
  });
  assert.equal(tracked.recoverableByGit, true);
  assert.equal(tracked.requiresUnrecoverableConfirmation, false);
  assert.equal(draft.recoverableByGit, false);
  assert.equal(draft.recoverabilityReason, "untracked");

  await assert.rejects(
    () => deleteRepositoryPath({
      repoRoot,
      targetPath: "draft.md",
      fingerprint: draft.fingerprint,
    }),
    (error) => error?.code === "file_delete_unrecoverable_confirmation_required",
  );
  assert.equal(await pathExists(path.join(repoRoot, "draft.md")), true);

  await deleteRepositoryPath({
    repoRoot,
    targetPath: "draft.md",
    fingerprint: draft.fingerprint,
    confirmUnrecoverable: true,
  });
  assert.equal(await pathExists(path.join(repoRoot, "draft.md")), false);
});

test("Git recoverability treats a leading-colon filename as a literal path", {
  skip: process.platform === "win32" && "Windows filenames cannot contain colons",
}, async () => {
  const repoRoot = await createRepository();
  await writeFile(path.join(repoRoot, ":draft.md"), "# Draft\n");

  const preview = await previewRepositoryDelete({
    repoRoot,
    targetPath: ":draft.md",
  });

  assert.equal(preview.recoverabilityReason, "untracked");
  assert.equal(preview.requiresUnrecoverableConfirmation, true);
});

test("Git recoverability verifies content hidden by assume-unchanged", async () => {
  const repoRoot = await createRepository();
  await writeFile(path.join(repoRoot, "tracked.md"), "# Recorded\n");
  await run("git", ["add", "tracked.md"], { cwd: repoRoot });
  await run("git", ["update-index", "--assume-unchanged", "tracked.md"], {
    cwd: repoRoot,
  });
  await writeFile(path.join(repoRoot, "tracked.md"), "# Hidden local edit\n");

  const preview = await previewRepositoryDelete({
    repoRoot,
    targetPath: "tracked.md",
  });

  assert.equal(preview.recoverabilityReason, "unstaged");
  assert.equal(preview.requiresUnrecoverableConfirmation, true);
});

test("deleting a folder accepts an empty placeholder but refuses recursive deletion", async () => {
  const repoRoot = await createRepository();
  await mkdir(path.join(repoRoot, "empty"));
  await writeFile(path.join(repoRoot, "empty", ".gitkeep"), "");
  await mkdir(path.join(repoRoot, "occupied"));
  await writeFile(path.join(repoRoot, "occupied", ".gitkeep"), "");
  await writeFile(path.join(repoRoot, "occupied", "notes.md"), "# Notes\n");

  const preview = await previewRepositoryDelete({
    repoRoot,
    targetPath: "empty",
  });
  assert.equal(preview.kind, "directory");
  assert.equal(preview.placeholderOnly, true);
  await deleteRepositoryPath({
    repoRoot,
    targetPath: "empty",
    fingerprint: preview.fingerprint,
  });
  assert.equal(await pathExists(path.join(repoRoot, "empty")), false);

  await assert.rejects(
    () => previewRepositoryDelete({
      repoRoot,
      targetPath: "occupied",
    }),
    (error) => error?.code === "directory_not_empty",
  );
  assert.equal(await pathExists(path.join(repoRoot, "occupied", "notes.md")), true);
});

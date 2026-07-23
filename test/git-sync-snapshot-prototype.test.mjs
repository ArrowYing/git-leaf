import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createImmutableGitSnapshot,
  rebaseImmutableGitSnapshot,
} from "../scripts/git-sync-snapshot-prototype.mjs";

test("temporary index freezes all click-time file types without moving HEAD or the real index", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-snapshot-test-"));
  try {
    await initializeRepository(root);
    await writeFile(path.join(root, "document.md"), "before\n");
    await writeFile(path.join(root, "remove.txt"), "remove me\n");
    await writeFile(path.join(root, "asset.bin"), Buffer.from([0, 1, 2]));
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "Initial"]);
    const headBefore = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();

    await writeFile(path.join(root, "document.md"), "clicked\n");
    await writeFile(path.join(root, "asset.bin"), Buffer.from([7, 8, 9]));
    await writeFile(path.join(root, "new.pdf"), "%PDF-prototype\n");
    await unlink(path.join(root, "remove.txt"));
    const indexPath = path.join(root, ".git", "git-leaf-prototype.index");
    const snapshot = await createImmutableGitSnapshot({ repoRoot: root, indexPath });

    await writeFile(path.join(root, "document.md"), "codex changed this later\n");
    await writeFile(path.join(root, "later.md"), "not in click snapshot\n");

    assert.equal((await git(root, ["show", `${snapshot.snapshotCommit}:document.md`])).stdout, "clicked\n");
    assert.equal((await git(root, ["show", `${snapshot.snapshotCommit}:new.pdf`])).stdout, "%PDF-prototype\n");
    assert.deepEqual(
      Buffer.from((await git(root, ["show", `${snapshot.snapshotCommit}:asset.bin`], { encoding: "buffer" })).stdout),
      Buffer.from([7, 8, 9]),
    );
    await assert.rejects(git(root, ["cat-file", "-e", `${snapshot.snapshotCommit}:remove.txt`]));
    await assert.rejects(git(root, ["cat-file", "-e", `${snapshot.snapshotCommit}:later.md`]));
    assert.equal((await git(root, ["rev-parse", "HEAD"])).stdout.trim(), headBefore);
    assert.equal((await git(root, ["diff", "--cached", "--quiet"])).stdout, "");
    assert.equal(await readFile(path.join(root, "document.md"), "utf8"), "codex changed this later\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("object-layer merge rebases a frozen snapshot onto a newer remote without touching the active worktree", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-snapshot-remote-"));
  const bare = path.join(root, "remote.git");
  const author = path.join(root, "author");
  const coworker = path.join(root, "coworker");
  try {
    await mkdir(bare, { recursive: true });
    await git(bare, ["init", "--bare", "--initial-branch=main"]);
    await git(root, ["clone", bare, author]);
    await initializeIdentity(author);
    await writeFile(path.join(author, "document.md"), "before\n");
    await writeFile(path.join(author, "remote.md"), "remote before\n");
    await git(author, ["add", "-A"]);
    await git(author, ["commit", "-m", "Initial"]);
    await git(author, ["push", "-u", "origin", "main"]);
    const activeHead = (await git(author, ["rev-parse", "HEAD"])).stdout.trim();

    await writeFile(path.join(author, "document.md"), "clicked\n");
    const snapshot = await createImmutableGitSnapshot({
      repoRoot: author,
      indexPath: path.join(root, "snapshot.index"),
    });

    await git(root, ["clone", bare, coworker]);
    await initializeIdentity(coworker);
    await writeFile(path.join(coworker, "remote.md"), "coworker update\n");
    await git(coworker, ["add", "-A"]);
    await git(coworker, ["commit", "-m", "Coworker update"]);
    await git(coworker, ["push", "origin", "main"]);

    await git(author, ["fetch", "origin", "main"]);
    const remoteCommit = (await git(author, ["rev-parse", "origin/main"])).stdout.trim();
    const rebased = await rebaseImmutableGitSnapshot({
      repoRoot: author,
      snapshotCommit: snapshot.snapshotCommit,
      remoteCommit,
    });

    assert.equal(rebased.ok, true);
    assert.equal((await git(author, ["show", `${rebased.rebasedCommit}:document.md`])).stdout, "clicked\n");
    assert.equal((await git(author, ["show", `${rebased.rebasedCommit}:remote.md`])).stdout, "coworker update\n");
    assert.equal((await git(author, ["rev-parse", `${rebased.rebasedCommit}^`])).stdout.trim(), remoteCommit);
    assert.equal((await git(author, ["rev-list", "--parents", "-n", "1", rebased.rebasedCommit])).stdout.trim().split(" ").length, 2);
    assert.equal((await git(author, ["rev-parse", "HEAD"])).stdout.trim(), activeHead);
    assert.equal(await readFile(path.join(author, "document.md"), "utf8"), "clicked\n");

    await git(author, ["push", "origin", `${rebased.rebasedCommit}:refs/heads/main`]);
    assert.equal((await git(bare, ["rev-parse", "main"])).stdout.trim(), rebased.rebasedCommit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("object-layer merge reports overlapping edits as a conflict without moving refs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-snapshot-conflict-"));
  try {
    await initializeRepository(root);
    await writeFile(path.join(root, "document.md"), "shared line\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "Initial"]);
    const base = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();

    await writeFile(path.join(root, "document.md"), "snapshot line\n");
    const snapshot = await createImmutableGitSnapshot({
      repoRoot: root,
      indexPath: path.join(root, ".git", "snapshot.index"),
    });
    await git(root, ["reset", "--hard", base]);
    await writeFile(path.join(root, "document.md"), "remote line\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "Remote update"]);
    const remoteCommit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();

    const result = await rebaseImmutableGitSnapshot({
      repoRoot: root,
      snapshotCommit: snapshot.snapshotCommit,
      remoteCommit,
    });

    assert.equal(result.ok, false);
    assert.equal(result.conflict, true);
    assert.equal((await git(root, ["rev-parse", "HEAD"])).stdout.trim(), remoteCommit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function initializeRepository(root) {
  await git(root, ["init", "-b", "main"]);
  await initializeIdentity(root);
}

async function initializeIdentity(root) {
  await git(root, ["config", "user.name", "Git Leaf Tests"]);
  await git(root, ["config", "user.email", "git-leaf@example.test"]);
}

function git(cwd, args, { encoding = "utf8" } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ stdout, stderr });
        return;
      }
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

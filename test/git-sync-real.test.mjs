import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { syncSelectedFiles } from "../src/git-sync.mjs";

test("real one-click sync commits and pushes every changed file type", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-real-sync-"));
  const bare = path.join(root, "remote.git");
  const repoRoot = path.join(root, "repo");
  try {
    await mkdir(bare, { recursive: true });
    await git(bare, ["init", "--bare", "--initial-branch=main"]);
    await git(root, ["clone", bare, repoRoot]);
    await configureIdentity(repoRoot);
    await writeFile(path.join(repoRoot, "document.md"), "before\n");
    await writeFile(path.join(repoRoot, "remove.txt"), "remove\n");
    await writeFile(path.join(repoRoot, "rename.txt"), "rename\n");
    await git(repoRoot, ["add", "-A"]);
    await git(repoRoot, ["commit", "-m", "Initial"]);
    await git(repoRoot, ["push", "-u", "origin", "main"]);

    await writeFile(path.join(repoRoot, "document.md"), "after\n");
    await writeFile(path.join(repoRoot, "attachment.bin"), Buffer.from([0, 7, 255]));
    await unlink(path.join(repoRoot, "remove.txt"));
    await rename(path.join(repoRoot, "rename.txt"), path.join(repoRoot, "renamed.txt"));

    const result = await syncSelectedFiles({
      repo: { id: "fixture", root: repoRoot, branch: "main" },
      allChanges: true,
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.retryCount, 0);
    assert.equal(result.driftKind, "none");
    assert.equal(result.remainingChanges, false);
    assert.equal((await git(repoRoot, ["status", "--porcelain"])).stdout, "");
    assert.equal((await git(repoRoot, ["rev-parse", "HEAD"])).stdout.trim(), (await git(bare, ["rev-parse", "main"])).stdout.trim());
    assert.equal((await git(bare, ["show", "main:document.md"])).stdout, "after\n");
    assert.deepEqual(
      Buffer.from((await git(bare, ["show", "main:attachment.bin"], { encoding: "buffer" })).stdout),
      Buffer.from([0, 7, 255]),
    );
    await assert.rejects(git(bare, ["cat-file", "-e", "main:remove.txt"]));
    assert.equal((await git(bare, ["show", "main:renamed.txt"])).stdout, "rename\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real first sync can publish an explicit commit object and establish upstream", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-first-sync-"));
  const bare = path.join(root, "remote.git");
  const repoRoot = path.join(root, "repo");
  try {
    await mkdir(repoRoot, { recursive: true });
    await mkdir(bare, { recursive: true });
    await git(repoRoot, ["init", "-b", "main"]);
    await configureIdentity(repoRoot);
    await git(bare, ["init", "--bare", "--initial-branch=main"]);
    await git(repoRoot, ["remote", "add", "origin", bare]);
    await writeFile(path.join(repoRoot, "README.md"), "initial\n");
    await git(repoRoot, ["add", "-A"]);
    await git(repoRoot, ["commit", "-m", "Initial"]);
    await writeFile(path.join(repoRoot, "README.md"), "ready to publish\n");

    const result = await syncSelectedFiles({
      repo: { id: "fixture", root: repoRoot, branch: "main" },
      allChanges: true,
    });

    assert.equal(result.ok, true, result.error);
    assert.equal((await git(repoRoot, ["rev-parse", "--abbrev-ref", "@{upstream}"])).stdout.trim(), "origin/main");
    assert.equal(await readFile(path.join(repoRoot, "README.md"), "utf8"), "ready to publish\n");
    assert.equal((await git(bare, ["show", "main:README.md"])).stdout, "ready to publish\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function configureIdentity(repoRoot) {
  await git(repoRoot, ["config", "user.name", "Git Leaf Tests"]);
  await git(repoRoot, ["config", "user.email", "git-leaf@example.test"]);
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

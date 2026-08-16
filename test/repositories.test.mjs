import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  canEditRepository,
  canonicalGithubRepositoryIdentity,
  createRepositoryInfo,
  findGithubRepositoryRoot,
  githubBlobRoot,
  githubRepositoryIdentityFromRemote,
} from "../src/server/repositories.mjs";
import { worktreeIdForPath } from "../src/server/git-worktrees.mjs";

const execFileAsync = promisify(execFile);

test("createRepositoryInfo creates metadata for the selected repository", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-repos-"));
  const repoRoot = await createGitRepo(rootDir, "docs-repo", {
    branch: "main",
    files: {
      "README.md": "# Docs\n",
      "docs/start.md": "# Start\n",
    },
  });

  const repo = await createRepositoryInfo({
    repoRoot,
    initialFile: {
      absolutePath: path.join(repoRoot, "docs/start.md"),
      relativePath: "docs/start.md",
    },
  });

  assert.equal(repo.id, "docs-repo");
  assert.equal(repo.name, "docs-repo");
  assert.equal(repo.root, await realpath(repoRoot));
  assert.equal(repo.defaultFile, "docs/start.md");
  assert.equal(repo.branch, "main");
  assert.equal(repo.detached, false);
  assert.equal(typeof repo.worktreeId, "string");
});

test("non-main repositories remain editable from local requests", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-repos-"));
  const repoRoot = await createGitRepo(rootDir, "draft-repo", {
    branch: "codex/work",
    files: { "README.md": "# Draft\n" },
  });

  const repo = await createRepositoryInfo({ repoRoot });

  assert.equal(repo.branch, "codex/work");
  assert.equal(canEditRepository({ repo, isLocalRequest: true }), true);
  assert.equal(canEditRepository({ repo, isLocalRequest: false }), false);
});

test("repository editing depends on local access rather than branch name", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-repos-"));
  const repoRoot = await createGitRepo(rootDir, "content-repo", {
    branch: "main",
    files: { "README.md": "# Content\n" },
  });
  const repo = await createRepositoryInfo({ repoRoot });

  assert.equal(
    canEditRepository({
      repo,
      isLocalRequest: true,
    }),
    true,
  );
  assert.equal(
    canEditRepository({
      repo: { ...repo, branch: "codex/work" },
      isLocalRequest: true,
    }),
    true,
  );
  assert.equal(
    canEditRepository({
      repo,
      isLocalRequest: false,
    }),
    false,
  );
});

test("githubBlobRoot resolves authenticated HTTPS GitHub remotes", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-repos-"));
  const repoRoot = await createGitRepo(rootDir, "docs-repo", {
    branch: "main",
    files: { "README.md": "# Docs Repo\n" },
  });
  await execFileAsync(
    "git",
    ["remote", "add", "origin", "https://user@github.com/ExampleOrg/docs-repo"],
    { cwd: repoRoot },
  );

  assert.equal(
    await githubBlobRoot(repoRoot, "main"),
    "https://github.com/ExampleOrg/docs-repo/blob/main",
  );
});

test("GitHub repository identities normalize SSH and HTTPS remotes", () => {
  assert.equal(
    githubRepositoryIdentityFromRemote("git@github.com:ExampleOrg/company-docs.git"),
    "exampleorg/company-docs",
  );
  assert.equal(
    githubRepositoryIdentityFromRemote("https://user@github.com/ExampleOrg/company-docs"),
    "exampleorg/company-docs",
  );
  assert.equal(githubRepositoryIdentityFromRemote("https://gitlab.com/acme/docs.git"), "");
});

test("OpenGlance repository renames preserve legacy local checkout identity", () => {
  assert.equal(
    githubRepositoryIdentityFromRemote("https://github.com/MangoFuture1210/git-leaf.git"),
    "openglance/openglance",
  );
  assert.equal(
    githubRepositoryIdentityFromRemote("https://github.com/MangoFuture1210/openglance.git"),
    "openglance/openglance",
  );
  assert.equal(
    githubRepositoryIdentityFromRemote(
      "git@github.com:MangoFuture1210/git-leaf-example-knowledge-base.git",
    ),
    "openglance/openglance-example-knowledge-base",
  );
  assert.equal(
    githubRepositoryIdentityFromRemote(
      "https://github.com/MangoFuture1210/openglance-example-knowledge-base.git",
    ),
    "openglance/openglance-example-knowledge-base",
  );
  assert.equal(
    canonicalGithubRepositoryIdentity("MangoFuture1210/OpenGlance"),
    "openglance/openglance",
  );
  assert.equal(
    canonicalGithubRepositoryIdentity("OpenGlance/OpenGlance"),
    "openglance/openglance",
  );
  assert.equal(
    canonicalGithubRepositoryIdentity("ExampleOrg/company-docs"),
    "exampleorg/company-docs",
  );
});

test("findGithubRepositoryRoot matches OpenGlance links against legacy local remotes", async () => {
  assert.equal(
    await findGithubRepositoryRoot("openglance/openglance", ["/legacy-openglance"], {
      originReader: async () => "https://github.com/MangoFuture1210/git-leaf.git",
      candidateAccess: async () => {},
    }),
    "/legacy-openglance",
  );
  assert.equal(
    await findGithubRepositoryRoot("MangoFuture1210/git-leaf", ["/renamed-openglance"], {
      originReader: async () => "https://github.com/openglance/openglance.git",
      candidateAccess: async () => {},
    }),
    "/renamed-openglance",
  );
});

test("findGithubRepositoryRoot matches a stable identity against local candidates", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-repos-"));
  const otherRoot = await createGitRepo(rootDir, "other", {
    branch: "main",
    files: { "README.md": "# Other\n" },
  });
  const mangoOsRoot = await createGitRepo(rootDir, "company-docs", {
    branch: "main",
    files: { "README.md": "# Company Docs\n" },
  });
  await execFileAsync("git", ["remote", "add", "origin", "git@github.com:ExampleOrg/company-docs.git"], {
    cwd: mangoOsRoot,
  });

  assert.equal(
    await findGithubRepositoryRoot("ExampleOrg/company-docs", [otherRoot, mangoOsRoot]),
    mangoOsRoot,
  );
  assert.equal(
    await findGithubRepositoryRoot("ExampleOrg/missing", [mangoOsRoot]),
    "",
  );
});

test("findGithubRepositoryRoot skips invalid candidates but preserves command dependency failures", async () => {
  const invalidContext = new Error("fatal: not a git repository");
  invalidContext.code = 128;
  invalidContext.stderr = "fatal: not a git repository";
  const matchingRemote = "git@github.com:ExampleOrg/company-docs.git";

  assert.equal(
    await findGithubRepositoryRoot("ExampleOrg/company-docs", ["/stale", "/matching"], {
      originReader: async (repoRoot) => {
        if (repoRoot === "/stale") throw invalidContext;
        return matchingRemote;
      },
      candidateAccess: async () => {},
    }),
    "/matching",
  );

  const missingGit = new Error("spawn git ENOENT");
  missingGit.code = "ENOENT";
  await assert.rejects(
    () => findGithubRepositoryRoot("ExampleOrg/company-docs", ["/candidate"], {
      originReader: async () => { throw missingGit; },
      candidateAccess: async () => {},
    }),
    (error) => error === missingGit,
  );
});

test("findGithubRepositoryRoot resolves an exact local worktree without falling back", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-worktree-link-"));
  const repoRoot = await createGitRepo(rootDir, "company-docs", {
    branch: "main",
    files: { "README.md": "# Main\n" },
  });
  await execFileAsync("git", ["config", "user.name", "OpenGlance Tests"], { cwd: repoRoot });
  await execFileAsync("git", ["config", "user.email", "git-leaf@example.com"], { cwd: repoRoot });
  await execFileAsync("git", ["add", "."], { cwd: repoRoot });
  await execFileAsync("git", ["commit", "-m", "Initial"], { cwd: repoRoot });
  await execFileAsync("git", ["remote", "add", "origin", "git@github.com:ExampleOrg/company-docs.git"], {
    cwd: repoRoot,
  });
  const linkedRoot = path.join(rootDir, "company-docs-task");
  await execFileAsync("git", ["worktree", "add", "-b", "codex/task", linkedRoot], {
    cwd: repoRoot,
  });
  const linkedId = worktreeIdForPath(await realpath(linkedRoot));

  assert.equal(
    await findGithubRepositoryRoot("ExampleOrg/company-docs", [repoRoot], {
      worktree: linkedId,
    }),
    await realpath(linkedRoot),
  );
  assert.equal(
    await findGithubRepositoryRoot("ExampleOrg/company-docs", [repoRoot], {
      worktree: "ffffffffffffffff",
    }),
    "",
  );
});

async function createGitRepo(rootDir, name, { branch, files }) {
  const repoRoot = path.join(rootDir, name);
  await mkdir(repoRoot, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
  if (branch !== "main") {
    await execFileAsync("git", ["checkout", "-b", branch], { cwd: repoRoot });
  }

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
  }

  return repoRoot;
}

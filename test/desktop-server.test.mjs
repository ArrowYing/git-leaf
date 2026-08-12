import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  DESKTOP_BIND_HOST,
  desktopPreviewServerUrl,
  startDesktopOpenPeekServer,
} from "../src/desktop/server.mjs";
import { worktreeIdForPath } from "../src/server/git-worktrees.mjs";

const execFileAsync = promisify(execFile);

test("desktop preview URLs stay on localhost", () => {
  assert.equal(DESKTOP_BIND_HOST, "127.0.0.1");
  assert.equal(
    desktopPreviewServerUrl({
      port: 4317,
      relativePath: "docs/repo structure.md",
      repoId: "docs-repo",
    }),
    "http://127.0.0.1:4317/?repo=docs-repo&file=docs%2Frepo+structure.md",
  );
});

test("desktop server starts the existing OpenPeek workbench on localhost", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-desktop-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "# Desktop\n");

  const desktopServer = await startDesktopOpenPeekServer({
    repoRoot,
    port: 0,
  });

  try {
    assert.equal(desktopServer.host, "127.0.0.1");
    assert.match(desktopServer.url, /^http:\/\/127\.0\.0\.1:\d+\/\?repo=git-leaf-desktop-/);

    const response = await fetch(desktopServer.url);
    const html = await response.text();

    assert.equal(response.ok, true);
    assert.match(html, /window\.OPENPEEK_INITIAL_REPO = "git-leaf-desktop-/);
    assert.doesNotMatch(html, /192\.168\.31\.42/);
  } finally {
    await desktopServer.close();
  }
});

test("desktop server falls back when the preferred port is already serving another process", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-desktop-fallback-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "# Desktop fallback\n");

  const occupiedServer = http.createServer((_request, response) => response.end("occupied"));
  await listenForTest(occupiedServer);
  const preferredPort = occupiedServer.address().port;
  const desktopServer = await startDesktopOpenPeekServer({ repoRoot, port: preferredPort });

  try {
    assert.notEqual(desktopServer.port, preferredPort);
    const response = await fetch(`http://${desktopServer.host}:${desktopServer.port}/api/health?check=1`);
    assert.equal(response.status, 200);
  } finally {
    await desktopServer.close();
    await closeForTest(occupiedServer);
  }
});

test("desktop server opens the restored active workbench tab when a session exists", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-desktop-session-"));
  const mangoOsRoot = await createGitRepo(rootDir, "docs-repo", {
    "AGENTS.md": "# Agents\n",
    "docs/repo-structure.md": "# Repo Structure\n",
  });

  const desktopServer = await startDesktopOpenPeekServer({
    repoRoot: mangoOsRoot,
    port: 0,
    desktopPreferences: {
      workbenchSessions: {
        [worktreeIdForPath(await realpath(mangoOsRoot))]: {
          tabs: [
            { path: "AGENTS.md" },
            { path: "docs/repo-structure.md" },
          ],
          activeTabPath: "docs/repo-structure.md",
        },
      },
    },
  });

  try {
    assert.match(
      desktopServer.url,
      new RegExp(`^http://127\\.0\\.0\\.1:${desktopServer.port}/\\?repo=docs-repo&file=docs%2Frepo-structure\\.md`),
    );
  } finally {
    await desktopServer.close();
  }
});

test("desktop server opens a repository workbench with no document when restored tabs are empty", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-desktop-empty-session-"));
  const mangoOsRoot = await createGitRepo(rootDir, "docs-repo", {
    "AGENTS.md": "# Agents\n",
  });

  const desktopServer = await startDesktopOpenPeekServer({
    repoRoot: mangoOsRoot,
    port: 0,
    desktopPreferences: {
      workbenchSessions: {
        [worktreeIdForPath(await realpath(mangoOsRoot))]: {
          tabs: [],
          activeTabPath: "",
        },
      },
    },
  });

  try {
    assert.match(
      desktopServer.url,
      new RegExp(`^http://127\\.0\\.0\\.1:${desktopServer.port}/\\?repo=docs-repo$`),
    );
  } finally {
    await desktopServer.close();
  }
});

test("desktop server forwards repository-scoped favorite operations", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-desktop-favorites-"));
  const repoRoot = await createGitRepo(rootDir, "docs-repo", {
    "README.md": "# Docs\n",
  });
  let favorites = [{ type: "document", path: "README.md" }];
  let receivedOperation = null;
  const desktopServer = await startDesktopOpenPeekServer({
    repoRoot,
    port: 0,
    getRepositoryFavorites: async (repositoryRoot) => {
      assert.equal(repositoryRoot, await realpath(repoRoot));
      return favorites;
    },
    mutateRepositoryFavorite: async ({ repositoryRoot, operation }) => {
      assert.equal(repositoryRoot, await realpath(repoRoot));
      receivedOperation = operation;
      favorites = [];
      return favorites;
    },
  });

  try {
    const endpoint = `http://${desktopServer.host}:${desktopServer.port}/api/favorites`;
    assert.deepEqual(await (await fetch(endpoint)).json(), {
      available: true,
      favorites: [{ type: "document", path: "README.md" }],
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove",
        type: "document",
        path: "README.md",
      }),
    });
    assert.equal(response.ok, true);
    assert.deepEqual(receivedOperation, {
      action: "remove",
      type: "document",
      path: "README.md",
    });
    assert.deepEqual((await response.json()).favorites, []);
  } finally {
    await desktopServer.close();
  }
});

test("desktop server does not switch repositories inside one server instance", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-desktop-repos-"));
  const docsRoot = await createGitRepo(rootDir, "docs-repo", {
    "README.md": "# Docs\n",
  });

  const desktopServer = await startDesktopOpenPeekServer({
    repoRoot: docsRoot,
    port: 0,
  });

  try {
    assert.deepEqual(Object.keys(desktopServer).sort(), [
      "close",
      "commonDir",
      "host",
      "port",
      "repoId",
      "repoName",
      "repoRoot",
      "repositoryRoot",
      "server",
      "updateDesktopPreferences",
      "url",
      "worktreeId",
      "worktreeName",
    ]);
    assert.equal(desktopServer.repoRoot, await realpath(docsRoot));
    assert.equal(desktopServer.commonDir, path.join(await realpath(docsRoot), ".git"));
    assert.equal(desktopServer.worktreeName, "docs-repo");

    desktopServer.updateDesktopPreferences({ colorMode: "dark", fileTreeMode: "content" });
    const preferencesResponse = await fetch(
      `http://${desktopServer.host}:${desktopServer.port}/api/preferences`,
    );
    assert.deepEqual(await preferencesResponse.json(), {
      available: false,
      preferences: { colorMode: "dark", fileTreeMode: "content" },
    });
  } finally {
    await desktopServer.close();
  }
});

async function createGitRepo(rootDir, name, files) {
  const repoRoot = path.join(rootDir, name);
  await mkdir(repoRoot, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  }
  return repoRoot;
}

function listenForTest(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, DESKTOP_BIND_HOST, resolve);
  });
}

function closeForTest(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

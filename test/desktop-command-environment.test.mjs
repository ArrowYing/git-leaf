import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  initializeDesktopCommandEnvironment,
  readMacLoginShellPath,
} from "../src/desktop/command-environment.mjs";
import { syncSelectedFiles } from "../src/server/git-sync.mjs";

const FINDER_STYLE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

test("desktop command environment augments a Finder-style PATH with login-shell commands", async () => {
  const environment = {
    PATH: FINDER_STYLE_PATH,
    SHELL: "/bin/zsh",
  };

  const result = await initializeDesktopCommandEnvironment({
    environment,
    platform: "darwin",
    loginPathReader: async () => `/example/node/bin:${FINDER_STYLE_PATH}`,
  });

  assert.equal(result.status, "augmented");
  assert.equal(result.addedEntries, 1);
  assert.equal(
    environment.PATH,
    `${FINDER_STYLE_PATH}:/example/node/bin`,
  );
});

test("desktop command environment leaves other platforms and malformed shell output unchanged", async () => {
  const linuxEnvironment = { PATH: "/usr/bin" };
  let linuxReaderCalled = false;
  const linuxResult = await initializeDesktopCommandEnvironment({
    environment: linuxEnvironment,
    platform: "linux",
    loginPathReader: async () => {
      linuxReaderCalled = true;
      return "/example/node/bin";
    },
  });

  assert.equal(linuxResult.status, "skipped");
  assert.equal(linuxReaderCalled, false);
  assert.equal(linuxEnvironment.PATH, "/usr/bin");

  const macEnvironment = { PATH: FINDER_STYLE_PATH };
  const macResult = await initializeDesktopCommandEnvironment({
    environment: macEnvironment,
    platform: "darwin",
    loginPathReader: async () => "/example/node/bin\n/untrusted",
  });

  assert.equal(macResult.status, "unchanged");
  assert.equal(macEnvironment.PATH, FINDER_STYLE_PATH);
});

test("macOS login PATH reader ignores startup noise and falls back from a broken custom shell", async () => {
  const environment = {
    PATH: FINDER_STYLE_PATH,
    SHELL: "/custom/shell",
  };
  const calls = [];

  const loginPath = await readMacLoginShellPath({
    environment,
    shellCandidates: ["/custom/shell", "/bin/zsh"],
    commandRunner: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "/custom/shell") {
        const error = new Error("custom shell failed");
        error.code = "ENOENT";
        throw error;
      }
      return {
        stdout: `startup banner\0/example/node/bin:${FINDER_STYLE_PATH}\n\0exit banner`,
        stderr: "",
      };
    },
  });

  assert.equal(loginPath, `/example/node/bin:${FINDER_STYLE_PATH}`);
  assert.deepEqual(calls.map(({ command }) => command), [
    "/custom/shell",
    "/bin/zsh",
  ]);
  assert.deepEqual(calls[1].args.slice(0, 1), ["-ilc"]);
  assert.equal(calls[1].options.env, environment);
  assert.ok(calls[1].options.timeout > 0);
  assert.ok(calls[1].options.maxBuffer > 0);
});

test(
  "desktop command environment lets real Sync run a Git hook whose runtime is only on the login PATH",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "git-leaf-desktop-hook-path-"));
    const bare = path.join(root, "remote.git");
    const repoRoot = path.join(root, "repo");
    const finderBin = path.join(root, "finder-bin");
    const toolBin = path.join(root, "login-bin");
    const originalPath = process.env.PATH;

    try {
      await mkdir(bare, { recursive: true });
      await mkdir(finderBin, { recursive: true });
      await mkdir(toolBin, { recursive: true });
      await git(bare, ["init", "--bare", "--initial-branch=main"]);
      await git(root, ["clone", bare, repoRoot]);
      await git(repoRoot, ["config", "user.name", "OpenGlance Tests"]);
      await git(repoRoot, ["config", "user.email", "git-leaf@example.test"]);
      await writeFile(path.join(repoRoot, "document.md"), "before\n");
      await git(repoRoot, ["add", "-A"]);
      await git(repoRoot, ["commit", "-m", "Initial"]);
      await git(repoRoot, ["push", "-u", "origin", "main"]);

      const fakeNode = path.join(toolBin, "node");
      await writeFile(
        fakeNode,
        "#!/bin/sh\n/usr/bin/touch .git/git-leaf-hook-ran\n",
      );
      await chmod(fakeNode, 0o755);
      const hook = path.join(repoRoot, ".git", "hooks", "pre-commit");
      await writeFile(
        hook,
        [
          "#!/bin/sh",
          'PATH="node_modules/.bin:$PATH"',
          "export PATH",
          'node -e "process.exit(0)"',
          "",
        ].join("\n"),
      );
      await chmod(hook, 0o755);
      await writeFile(path.join(repoRoot, "document.md"), "after\n");

      await symlink("/usr/bin/git", path.join(finderBin, "git"));
      process.env.PATH = finderBin;
      const initialized = await initializeDesktopCommandEnvironment({
        environment: process.env,
        platform: "darwin",
        loginPathReader: async () => `${toolBin}:${finderBin}`,
      });
      const result = await syncSelectedFiles({
        repo: { id: "fixture", root: repoRoot, branch: "main" },
        allChanges: true,
      });

      assert.equal(result.ok, true, result.error);
      assert.equal(initialized.status, "augmented");
      assert.equal(await readFile(path.join(repoRoot, ".git", "git-leaf-hook-ran"), "utf8"), "");
      assert.equal((await git(repoRoot, ["status", "--porcelain"])).stdout, "");
      assert.equal(
        (await git(repoRoot, ["rev-parse", "HEAD"])).stdout.trim(),
        (await git(bare, ["rev-parse", "main"])).stdout.trim(),
      );
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "Windows preserves its inherited Path for real Sync Git hooks",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "git-leaf-windows-hook-path-"));
    const bare = path.join(root, "remote.git");
    const repoRoot = path.join(root, "repo");
    const inheritedPath = process.env.PATH;

    try {
      await mkdir(bare, { recursive: true });
      await git(bare, ["init", "--bare", "--initial-branch=main"]);
      await git(root, ["clone", bare, repoRoot]);
      await git(repoRoot, ["config", "user.name", "OpenGlance Tests"]);
      await git(repoRoot, ["config", "user.email", "git-leaf@example.test"]);
      await writeFile(path.join(repoRoot, "document.md"), "before\n");
      await git(repoRoot, ["add", "-A"]);
      await git(repoRoot, ["commit", "-m", "Initial"]);
      await git(repoRoot, ["push", "-u", "origin", "main"]);

      const hook = path.join(repoRoot, ".git", "hooks", "pre-commit");
      await writeFile(
        hook,
        [
          "#!/bin/sh",
          'node -e "require(\'node:fs\').writeFileSync(\'.git/git-leaf-hook-ran\', \'ok\')"',
          "",
        ].join("\n"),
      );
      await chmod(hook, 0o755);
      await writeFile(path.join(repoRoot, "document.md"), "after\n");

      const initialized = await initializeDesktopCommandEnvironment({
        environment: process.env,
        platform: "win32",
      });
      const result = await syncSelectedFiles({
        repo: { id: "fixture", root: repoRoot, branch: "main" },
        allChanges: true,
      });

      assert.equal(initialized.status, "skipped");
      assert.equal(process.env.PATH, inheritedPath);
      assert.equal(result.ok, true, result.error);
      assert.equal(
        await readFile(path.join(repoRoot, ".git", "git-leaf-hook-ran"), "utf8"),
        "ok",
      );
      assert.equal((await git(repoRoot, ["status", "--porcelain"])).stdout, "");
      assert.equal(
        (await git(repoRoot, ["rev-parse", "HEAD"])).stdout.trim(),
        (await git(bare, ["rev-parse", "main"])).stdout.trim(),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
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

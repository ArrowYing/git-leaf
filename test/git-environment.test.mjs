import assert from "node:assert/strict";
import test from "node:test";

import {
  assertGitAvailable,
  desktopEnvironmentChecks,
  GitUnavailableError,
  runGhAuthStatus,
} from "../src/desktop/git-environment.mjs";

test("assertGitAvailable returns the detected git version", async () => {
  const result = await assertGitAvailable({
    gitRunner: async () => ({ stdout: "git version 2.50.1\n" }),
  });

  assert.deepEqual(result, { version: "git version 2.50.1" });
});

test("assertGitAvailable rejects successful output that is not a Git version", async () => {
  await assert.rejects(
    () => assertGitAvailable({
      gitRunner: async () => ({ stdout: "wrapper ready\n" }),
    }),
    (error) => {
      assert.equal(error instanceof GitUnavailableError, true);
      assert.equal(error.state, "invalid_output");
      assert.match(error.message, /unexpected response/i);
      return true;
    },
  );
});

test("assertGitAvailable distinguishes permission errors from a missing command", async () => {
  await assert.rejects(
    () => assertGitAvailable({
      gitRunner: async () => {
        const error = new Error("spawn git EACCES");
        error.code = "EACCES";
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.state, "permission_denied");
      assert.match(error.message, /permission/i);
      assert.doesNotMatch(error.message, /install/i);
      return true;
    },
  );
});

test("assertGitAvailable explains missing git instead of reporting a repository error", async () => {
  await assert.rejects(
    () => assertGitAvailable({
      platform: "darwin",
      gitRunner: async () => {
        const error = new Error("spawn git ENOENT");
        error.code = "ENOENT";
        throw error;
      },
    }),
    (error) => {
      assert.equal(error instanceof GitUnavailableError, true);
      assert.match(error.message, /Git is required/);
      assert.match(error.message, /xcode-select --install/);
      return true;
    },
  );
});

test("assertGitAvailable gives Windows-specific Git installation guidance", async () => {
  await assert.rejects(
    () => assertGitAvailable({
      platform: "win32",
      gitRunner: async () => {
        const error = new Error("spawn git ENOENT");
        error.code = "ENOENT";
        throw error;
      },
    }),
    (error) => {
      assert.equal(error instanceof GitUnavailableError, true);
      assert.match(error.message, /Git for Windows/);
      assert.doesNotMatch(error.message, /xcode-select/);
      return true;
    },
  );
});

test("assertGitAvailable accepts the language option and keeps command details unchanged", async () => {
  await assert.rejects(
    () => assertGitAvailable({
      language: "zh-CN",
      gitRunner: async () => ({ stdout: "wrapper ready\n" }),
    }),
    (error) => {
      assert.equal(error.state, "invalid_output");
      assert.match(error.message, /无法识别/);
      assert.equal(error.cause.stdout, undefined);
      return true;
    },
  );
});

test("desktopEnvironmentChecks gives Windows-specific Git installation guidance", async () => {
  const checks = await desktopEnvironmentChecks({
    platform: "win32",
    gitVersionRunner: async () => {
      const error = new Error("spawn git ENOENT");
      error.code = "ENOENT";
      throw error;
    },
    gitConfigRunner: async () => ({ stdout: "" }),
    ghAuthRunner: async () => {
      const error = new Error("spawn gh ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  });

  assert.equal(checks[0].id, "git-command");
  assert.equal(checks[0].status, "error");
  assert.match(checks[0].message, /Git for Windows/);
  assert.doesNotMatch(checks[0].message, /Xcode Command Line Tools/);
});

test("desktopEnvironmentChecks localizes labels and guidance with language or locale", async () => {
  const unavailableGit = new Error("spawn git ENOENT");
  unavailableGit.code = "ENOENT";
  const missingGh = new Error("spawn gh ENOENT");
  missingGh.code = "ENOENT";
  const runners = {
    platform: "darwin",
    gitVersionRunner: async () => {
      throw unavailableGit;
    },
    gitConfigRunner: async () => ({ stdout: "" }),
    ghAuthRunner: async () => {
      throw missingGh;
    },
  };

  const chinese = await desktopEnvironmentChecks({
    ...runners,
    language: "zh-CN",
  });
  assert.deepEqual(
    chinese.map(({ label }) => label),
    ["Git 命令", "Git 身份", "GitHub 登录"],
  );
  assert.match(chinese[0].message, /未检测到 Git 命令/);
  assert.match(chinese[1].message, /user\.name/);
  assert.match(chinese[2].message, /未检测到 GitHub CLI/);

  const localeAlias = await desktopEnvironmentChecks({
    ...runners,
    locale: "zh-Hans-CN",
  });
  assert.deepEqual(
    localeAlias.map(({ label }) => label),
    ["Git 命令", "Git 身份", "GitHub 登录"],
  );

  const unsupported = await desktopEnvironmentChecks({
    ...runners,
    language: "fr-FR",
  });
  assert.deepEqual(
    unsupported.map(({ label }) => label),
    ["Git command", "Git identity", "GitHub login"],
  );
});

test("desktopEnvironmentChecks reports git, identity, and GitHub auth readiness", async () => {
  const checks = await desktopEnvironmentChecks({
    gitVersionRunner: async () => ({ stdout: "git version 2.50.1\n" }),
    gitConfigRunner: async (key) => ({
      stdout: key === "user.name" ? "Example Fang\n" : "example@example.com\n",
    }),
    ghAuthRunner: async () => ({
      stdout: "github.com\n  Logged in to github.com account example\n",
    }),
  });

  assert.deepEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ["git-command", "ok"],
      ["git-identity", "ok"],
      ["github-login", "ok"],
    ],
  );
  assert.match(checks[0].message, /git version 2\.50\.1/);
  assert.match(checks[1].message, /Example Fang/);
  assert.match(checks[2].message, /Logged in/);
  assert.deepEqual(
    checks.map((check) => check.label),
    ["Git command", "Git identity", "GitHub login"],
  );
});

test("desktopEnvironmentChecks keeps login checks non-blocking", async () => {
  const missingGh = new Error("spawn gh ENOENT");
  missingGh.code = "ENOENT";

  const checks = await desktopEnvironmentChecks({
    gitVersionRunner: async () => ({ stdout: "git version 2.50.1\n" }),
    gitConfigRunner: async () => {
      throw new Error("missing config");
    },
    ghAuthRunner: async () => {
      throw missingGh;
    },
  });

  assert.deepEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ["git-command", "ok"],
      ["git-identity", "warn"],
      ["github-login", "warn"],
    ],
  );
  assert.match(checks[1].message, /user\.name/);
  assert.match(checks[2].message, /GitHub CLI/);
});

test("runGhAuthStatus falls back to Homebrew gh when Finder-style PATH cannot find it", async () => {
  const calls = [];

  const result = await runGhAuthStatus({
    candidateCommands: ["/opt/homebrew/bin/gh"],
    commandRunner: async (command, args) => {
      calls.push([command, args]);
      if (command === "gh") {
        const error = new Error("spawn gh ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      return {
        stdout: "github.com\n  ✓ Logged in to github.com account maintainer\n",
        stderr: "",
      };
    },
  });

  assert.deepEqual(calls, [
    ["gh", ["auth", "status"]],
    ["/opt/homebrew/bin/gh", ["auth", "status"]],
  ]);
  assert.match(result.stdout, /maintainer/);
});

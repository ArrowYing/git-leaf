import assert from "node:assert/strict";
import test from "node:test";

import {
  createGitLeafOpenLink,
  createGitLeafShareLink,
} from "../src/git-leaf-open-link.mjs";

test("createGitLeafOpenLink includes the exact linked worktree id", async () => {
  const link = await createGitLeafOpenLink({
    repoRoot: "/repos/company-docs-task",
    file: "docs/report.md",
    readOrigin: async () => "git@github.com:ExampleOrg/company-docs.git",
    listWorktrees: async () => [
      { root: "/repos/company-docs", id: "1111111111111111", primary: true, current: false },
      { root: "/repos/company-docs-task", id: "2222222222222222", primary: false, current: true },
    ],
  });

  assert.equal(
    link,
    "https://gitleaf.mangofuture.com/open?repo=exampleorg%2Fcompany-docs&path=docs%2Freport.md&worktree=2222222222222222",
  );
});

test("createGitLeafOpenLink keeps primary-worktree links portable", async () => {
  const link = await createGitLeafOpenLink({
    repoRoot: "/repos/company-docs",
    file: "AGENTS.md",
    readOrigin: async () => "https://github.com/ExampleOrg/company-docs.git",
    listWorktrees: async () => [
      { root: "/repos/company-docs", id: "1111111111111111", primary: true, current: true },
    ],
  });

  assert.equal(
    link,
    "https://gitleaf.mangofuture.com/open?repo=exampleorg%2Fcompany-docs&path=AGENTS.md",
  );
});

test("createGitLeafShareLink publishes a main-primary document revision", async () => {
  const revision = "a".repeat(40);
  const calls = [];
  const publishedSource = [
    "---",
    "title: Quarterly Plan",
    "ai_snippet: '[Plan] Quarterly Plan | goals, owners, and milestones'",
    "---",
    "# Old heading",
  ].join("\n");
  const link = await createGitLeafShareLink({
    repoRoot: "/repos/company-docs",
    file: "docs/report.md",
    readOrigin: async () => "git@github.com:ExampleOrg/company-docs.git",
    listWorktrees: async () => [
      { root: "/repos/company-docs", primary: true, current: true, branch: "main" },
    ],
    gitRunner: async (_cwd, args) => {
      calls.push(args);
      if (args.includes("status")) return { stdout: "", stderr: "" };
      if (args.includes("log")) return { stdout: `${revision}\n`, stderr: "" };
      if (args[0] === "show") return { stdout: publishedSource, stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  const shareUrl = new URL(link);
  assert.equal(shareUrl.searchParams.get("title"), "Quarterly Plan");
  assert.equal(shareUrl.searchParams.has("snippet"), false);
  assert.deepEqual(calls.find((args) => args[0] === "merge-base"), [
    "merge-base",
    "--is-ancestor",
    revision,
    "refs/remotes/origin/main",
  ]);
  assert.deepEqual(calls.at(-1), ["show", `${revision}:docs/report.md`]);
});

test("createGitLeafShareLink falls back to the file name when preview metadata cannot be read", async () => {
  const revision = "f".repeat(40);
  const link = await createGitLeafShareLink({
    repoRoot: "/repos/company-docs",
    file: "docs/report.md",
    readOrigin: async () => "git@github.com:ExampleOrg/company-docs.git",
    listWorktrees: async () => [
      { root: "/repos/company-docs", primary: true, current: true, branch: "main" },
    ],
    gitRunner: async (_cwd, args) => {
      if (args.includes("status")) return { stdout: "", stderr: "" };
      if (args.includes("log")) return { stdout: revision, stderr: "" };
      if (args[0] === "show") throw new Error("cannot read blob");
      return { stdout: "", stderr: "" };
    },
  });

  const shareUrl = new URL(link);
  assert.equal(shareUrl.searchParams.get("title"), "report.md");
  assert.equal(shareUrl.searchParams.has("snippet"), false);
});

test("createGitLeafShareLink rejects linked worktrees and non-main primary branches", async () => {
  await assert.rejects(
    createGitLeafShareLink({
      repoRoot: "/repos/company-docs-task",
      file: "docs/report.md",
      listWorktrees: async () => [
        { root: "/repos/company-docs-task", primary: false, current: true, branch: "feature/report" },
      ],
    }),
    (error) => error.code === "primary_required",
  );
  await assert.rejects(
    createGitLeafShareLink({
      repoRoot: "/repos/company-docs",
      file: "docs/report.md",
      listWorktrees: async () => [
        { root: "/repos/company-docs", primary: true, current: true, branch: "feature/report" },
      ],
    }),
    (error) => error.code === "main_required",
  );
});

test("createGitLeafShareLink rejects unpublished document changes", async () => {
  const revision = "b".repeat(40);
  await assert.rejects(
    createGitLeafShareLink({
      repoRoot: "/repos/company-docs",
      file: "docs/report.md",
      readOrigin: async () => "https://github.com/ExampleOrg/company-docs.git",
      listWorktrees: async () => [
        { root: "/repos/company-docs", primary: true, current: true, branch: "main" },
      ],
      gitRunner: async (_cwd, args) => {
        if (args.includes("status")) return { stdout: " M docs/report.md\n", stderr: "" };
        return { stdout: "", stderr: "" };
      },
    }),
    (error) => error.code === "document_not_committed",
  );
  await assert.rejects(
    createGitLeafShareLink({
      repoRoot: "/repos/company-docs",
      file: "docs/report.md",
      readOrigin: async () => "https://github.com/ExampleOrg/company-docs.git",
      listWorktrees: async () => [
        { root: "/repos/company-docs", primary: true, current: true, branch: "main" },
      ],
      gitRunner: async (_cwd, args) => {
        if (args.includes("status")) return { stdout: "", stderr: "" };
        if (args.includes("log")) return { stdout: revision, stderr: "" };
        const error = new Error("not on origin/main");
        error.code = 1;
        throw error;
      },
    }),
    (error) => error.code === "document_not_published",
  );
});

test("createGitLeafShareLink preserves dependency failures from the ancestor check", async () => {
  const revision = "c".repeat(40);
  await assert.rejects(
    createGitLeafShareLink({
      repoRoot: "/repos/company-docs",
      file: "docs/report.md",
      readOrigin: async () => "https://github.com/ExampleOrg/company-docs.git",
      listWorktrees: async () => [
        { root: "/repos/company-docs", primary: true, current: true, branch: "main" },
      ],
      gitRunner: async (_cwd, args) => {
        if (args.includes("status")) return { stdout: "", stderr: "" };
        if (args.includes("log")) return { stdout: revision, stderr: "" };
        const error = new Error("spawn git ENOENT");
        error.code = "ENOENT";
        throw error;
      },
    }),
    /spawn git ENOENT/,
  );
});

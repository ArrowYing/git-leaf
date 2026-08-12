import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenPeekOpenLink,
  createOpenPeekShareLink,
} from "../src/server/openpeek-open-link.mjs";

test("createOpenPeekOpenLink includes the exact linked worktree id", async () => {
  const link = await createOpenPeekOpenLink({
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

test("createOpenPeekOpenLink keeps primary-worktree links portable", async () => {
  const link = await createOpenPeekOpenLink({
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

test("createOpenPeekOpenLink localizes predictable errors and preserves dependency errors", async () => {
  await assert.rejects(
    createOpenPeekOpenLink(),
    /A Git repository root is required\./,
  );
  await assert.rejects(
    createOpenPeekOpenLink({ language: "zh-CN" }),
    /需要提供 Git 仓库根目录/,
  );
  await assert.rejects(
    createOpenPeekOpenLink({
      repoRoot: "/repos/company-docs",
      locale: "zh-CN",
      readOrigin: async () => "",
    }),
    /仓库必须配置 GitHub origin/,
  );
  await assert.rejects(
    createOpenPeekOpenLink({
      repoRoot: "/repos/company-docs",
      readOrigin: async () => "git@github.com:ExampleOrg/company-docs.git",
      listWorktrees: async () => [],
    }),
    /Could not identify the current Git worktree/,
  );

  const rawError = new Error("fatal: could not read origin");
  await assert.rejects(
    createOpenPeekOpenLink({
      repoRoot: "/repos/company-docs",
      readOrigin: async () => {
        throw rawError;
      },
    }),
    (error) => error === rawError,
  );
});

test("createOpenPeekShareLink publishes a main-primary document revision", async () => {
  const revision = "a".repeat(40);
  const calls = [];
  const publishedSource = [
    "---",
    "title: Quarterly Plan",
    "ai_snippet: '[Plan] Quarterly Plan | goals, owners, and milestones'",
    "---",
    "# Old heading",
  ].join("\n");
  const link = await createOpenPeekShareLink({
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

test("createOpenPeekShareLink falls back to the file name when preview metadata cannot be read", async () => {
  const revision = "f".repeat(40);
  const link = await createOpenPeekShareLink({
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

test("createOpenPeekShareLink rejects linked worktrees and non-main primary branches", async () => {
  await assert.rejects(
    createOpenPeekShareLink({
      repoRoot: "/repos/company-docs-task",
      file: "docs/report.md",
      listWorktrees: async () => [
        { root: "/repos/company-docs-task", primary: false, current: true, branch: "feature/report" },
      ],
    }),
    (error) => error.code === "primary_required"
      && error.message === "Share links are available only from the primary worktree.",
  );
  await assert.rejects(
    createOpenPeekShareLink({
      repoRoot: "/repos/company-docs",
      file: "docs/report.md",
      language: "zh-CN",
      listWorktrees: async () => [
        { root: "/repos/company-docs", primary: true, current: true, branch: "feature/report" },
      ],
    }),
    (error) => error.code === "main_required"
      && error.message === "分享链接只支持主工作区的 main 分支。",
  );
});

test("createOpenPeekShareLink rejects unpublished document changes", async () => {
  const revision = "b".repeat(40);
  await assert.rejects(
    createOpenPeekShareLink({
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
    (error) => error.code === "document_not_committed"
      && error.message === "This document has uncommitted changes. Sync it before sharing.",
  );
  await assert.rejects(
    createOpenPeekShareLink({
      repoRoot: "/repos/company-docs",
      file: "docs/report.md",
      locale: "zh-CN",
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
    (error) => error.code === "document_not_published"
      && error.message === "当前文档已经提交，但尚未发布到 origin/main。",
  );
});

test("createOpenPeekShareLink localizes repository and first-commit errors", async () => {
  await assert.rejects(
    createOpenPeekShareLink(),
    (error) => error.code === "repository_required"
      && error.message === "Open a Git repository before creating a share link.",
  );
  await assert.rejects(
    createOpenPeekShareLink({
      repoRoot: "/repos/company-docs",
      file: "docs/report.md",
      language: "zh-CN",
      readOrigin: async () => "not-a-github-remote",
      listWorktrees: async () => [
        { root: "/repos/company-docs", primary: true, current: true, branch: "main" },
      ],
    }),
    (error) => error.code === "github_origin_required"
      && error.message === "当前仓库没有可识别的 GitHub origin。",
  );
  await assert.rejects(
    createOpenPeekShareLink({
      repoRoot: "/repos/company-docs",
      file: "docs/report.md",
      readOrigin: async () => "https://github.com/ExampleOrg/company-docs.git",
      listWorktrees: async () => [
        { root: "/repos/company-docs", primary: true, current: true, branch: "main" },
      ],
      gitRunner: async (_cwd, args) => {
        if (args.includes("status")) return { stdout: "", stderr: "" };
        if (args.includes("log")) return { stdout: "", stderr: "" };
        return { stdout: "", stderr: "" };
      },
    }),
    (error) => error.code === "document_not_committed"
      && error.message === "This document has not been committed yet. Sync it before sharing.",
  );
});

test("createOpenPeekShareLink preserves dependency failures from the ancestor check", async () => {
  const revision = "c".repeat(40);
  await assert.rejects(
    createOpenPeekShareLink({
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

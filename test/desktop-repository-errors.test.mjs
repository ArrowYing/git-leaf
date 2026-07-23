import assert from "node:assert/strict";
import test from "node:test";

import {
  repositorySelectionErrorMessage,
  startupRepositoryErrorMessage,
} from "../src/desktop-repository-errors.mjs";
import { GitRepositoryNotFoundError } from "../src/git-errors.mjs";

test("repository selection gives a dedicated message for non-Git directories", () => {
  const message = repositorySelectionErrorMessage(
    "/Users/example/Documents",
    new GitRepositoryNotFoundError("/Users/example/Documents"),
  );

  assert.equal(message, [
    "无法打开这个目录：/Users/example/Documents",
    "这个目录不在 Git 仓库中。",
    "请选择 Git 仓库目录，或仓库中的任意子目录。",
  ].join("\n"));
  assert.doesNotMatch(message, /Could not find|Command failed|升级 Git|旧版 Git Leaf/);
});

test("repository selection keeps unexpected Git failures concise", () => {
  const error = new Error([
    "Command failed: git worktree list --porcelain -z",
    "fatal: repository metadata is corrupt",
    "usage: git worktree list [<options>]",
  ].join("\n"));
  const message = repositorySelectionErrorMessage("/Users/example/repo", error);

  assert.match(message, /Git Leaf 读取这个仓库时遇到问题。/);
  assert.match(message, /技术信息：fatal: repository metadata is corrupt/);
  assert.doesNotMatch(message, /请选择 Git 仓库目录|usage:|升级 Git|旧版 Git Leaf/);
});

test("startup repository errors distinguish a missing repository", () => {
  const message = startupRepositoryErrorMessage(
    "/Users/example/removed-repo",
    new GitRepositoryNotFoundError("/Users/example/removed-repo"),
  );

  assert.equal(message, [
    "上次打开的仓库已不可用：/Users/example/removed-repo",
    "这个目录已经不在 Git 仓库中，请重新选择一个本地 Git 仓库。",
  ].join("\n"));
});

test("repository selection explains each actionable command dependency state", () => {
  const cases = [
    ["ENOENT", "找不到本机 Git 命令"],
    ["EACCES", "没有权限运行 Git 或读取这个目录"],
  ];
  for (const [code, expected] of cases) {
    const error = new Error(`spawn git ${code}`);
    error.code = code;
    assert.match(repositorySelectionErrorMessage("/repo", error), new RegExp(expected));
  }

  const unsupported = new Error("git failed");
  unsupported.code = 129;
  unsupported.stderr = "error: unknown option `example'";
  assert.match(repositorySelectionErrorMessage("/repo", unsupported), /本机 Git 不支持当前操作所需的命令能力/);

  const invalidOutput = new Error("empty output");
  invalidOutput.externalCommandState = "invalid_output";
  assert.match(repositorySelectionErrorMessage("/repo", invalidOutput), /Git 返回了 Git Leaf 无法识别的结果/);
});

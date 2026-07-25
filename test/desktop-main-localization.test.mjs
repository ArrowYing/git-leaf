import assert from "node:assert/strict";
import test from "node:test";

import {
  localizedAboutPanelCopyright,
  localizeDesktopHomeError,
  windowsStartMenuShortcutOptions,
} from "../desktop/main-localization.mjs";
import { GitRepositoryNotFoundError } from "../src/git-errors.mjs";

test("desktop shell copy honors an explicit saved language over the system language", () => {
  const buildInfo = {
    version: "1.2.3",
    commit: "abc1234",
    builtAt: "2026-07-25T08:00:00.000Z",
    dev: true,
  };

  assert.match(
    localizedAboutPanelCopyright(
      buildInfo,
      { language: "zh-CN" },
      { systemLanguages: ["en-US"] },
    ),
    /发布于 2026-07-25\nCommit abc1234/,
  );
  assert.equal(
    windowsStartMenuShortcutOptions(
      "C:\\GitLeaf\\Git Leaf.exe",
      { language: "zh-CN" },
      { systemLanguages: ["en-US"] },
    ).description,
    "在 Git Leaf 中打开 Git 仓库和 Markdown 文档。",
  );

  assert.match(
    localizedAboutPanelCopyright(
      buildInfo,
      { language: "en" },
      { systemLanguages: ["zh-CN"] },
    ),
    /Released 2026-07-25\nCommit abc1234/,
  );
  assert.equal(
    windowsStartMenuShortcutOptions(
      "C:\\GitLeaf\\Git Leaf.exe",
      { language: "en" },
      { systemLanguages: ["zh-CN"] },
    ).description,
    "Open Git repositories and Markdown documents in Git Leaf.",
  );
});

test("desktop home error state can be localized again after the language changes", () => {
  const errorState = {
    kind: "repository-selection",
    path: "/tmp/not-a-repository",
    error: new GitRepositoryNotFoundError("/tmp/not-a-repository"),
  };

  const english = localizeDesktopHomeError(
    errorState,
    { language: "en" },
    { systemLanguages: ["zh-CN"] },
  );
  const chinese = localizeDesktopHomeError(
    errorState,
    { language: "zh-CN" },
    { systemLanguages: ["en-US"] },
  );

  assert.match(english, /Could not open this folder: \/tmp\/not-a-repository/);
  assert.match(english, /This folder is not inside a Git repository/);
  assert.match(chinese, /无法打开这个目录：\/tmp\/not-a-repository/);
  assert.match(chinese, /这个目录不在 Git 仓库中/);
  assert.doesNotMatch(chinese, /Could not open this folder/);
});

test("desktop home retains structured missing-repository context across languages", () => {
  const identityState = {
    kind: "repository-identity-not-found",
    repository: "acme/handbook",
  };
  const worktreeState = {
    kind: "repository-worktree-not-found",
    repository: "acme/handbook",
    worktree: "review-notes",
  };

  assert.match(
    localizeDesktopHomeError(identityState, { language: "en" }),
    /acme\/handbook is not yet in Git Leaf/,
  );
  assert.match(
    localizeDesktopHomeError(identityState, { language: "zh-CN" }),
    /Git Leaf 的仓库列表里还没有 acme\/handbook/,
  );
  assert.match(
    localizeDesktopHomeError(worktreeState, { language: "en" }),
    /review-notes/,
  );
  assert.match(
    localizeDesktopHomeError(worktreeState, { language: "zh-CN" }),
    /review-notes/,
  );
});

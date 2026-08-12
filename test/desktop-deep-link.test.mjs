import assert from "node:assert/strict";
import test from "node:test";

import {
  openPeekDeepLinkFromArgs,
  openPeekDeepLinkUrl,
  openPeekSharedDeepLinkUrl,
  parseOpenPeekDeepLink,
} from "../src/desktop/deep-link.mjs";
import {
  openPeekHttpsOpenUrl,
  openPeekShareUrl,
} from "../src/server/hosted-links.mjs";

test("OpenPeek HTTPS links carry a local worktree id without exposing its path", () => {
  assert.equal(
    openPeekHttpsOpenUrl({
      repository: "ExampleOrg/company-docs",
      file: "docs/report.md",
      worktree: "0123456789abcdef",
    }),
    "https://gitleaf.mangofuture.com/open?repo=exampleorg%2Fcompany-docs&path=docs%2Freport.md&worktree=0123456789abcdef",
  );
});

test("OpenPeek deep links round-trip a macOS repository and Markdown document", () => {
  const url = openPeekDeepLinkUrl({
    repoRoot: "/Users/maintainer/Projects/company-docs",
    file: "docs/strategy notes.md",
    platform: "darwin",
  });

  assert.equal(
    url,
    "openpeek://open?repo=%2FUsers%2Fmaintainer%2FProjects%2Fcompany-docs&path=docs%2Fstrategy+notes.md",
  );
  assert.deepEqual(parseOpenPeekDeepLink(url, { platform: "darwin" }), {
    repoRoot: "/Users/maintainer/Projects/company-docs",
    file: "docs/strategy notes.md",
  });
});

test("OpenPeek deep links round-trip a Windows repository and normalize document separators", () => {
  const url = openPeekDeepLinkUrl({
    repoRoot: "C:\\Users\\mango\\Projects\\company-docs",
    file: "docs\\strategy.md",
    platform: "win32",
  });

  assert.deepEqual(parseOpenPeekDeepLink(url, { platform: "win32" }), {
    repoRoot: "C:\\Users\\mango\\Projects\\company-docs",
    file: "docs/strategy.md",
  });
});

test("OpenPeek deep links round-trip a stable GitHub repository identity", () => {
  const url = openPeekDeepLinkUrl({
    repository: "ExampleOrg/company-docs",
    file: "company/strategy.md",
    worktree: "0123456789abcdef",
    handoff: "handoff_1234567890abcdef",
  });

  assert.equal(
    url,
    "openpeek://open-worktree?repo=exampleorg%2Fcompany-docs&path=company%2Fstrategy.md&worktree=0123456789abcdef&handoff=handoff_1234567890abcdef",
  );
  assert.deepEqual(parseOpenPeekDeepLink(url), {
    repository: "exampleorg/company-docs",
    file: "company/strategy.md",
    worktree: "0123456789abcdef",
    handoff: "handoff_1234567890abcdef",
  });
});

test("OpenPeek share links use an independent versioned protocol", () => {
  const rev = "c".repeat(40);
  const shareUrl = new URL(openPeekShareUrl({
    repository: "ExampleOrg/company-docs",
    file: "company/strategy.md",
    rev,
    title: "  Company   Strategy  ",
    snippet: "One concise\nsummary for Feishu.",
  }));
  assert.equal(shareUrl.origin + shareUrl.pathname, "https://gitleaf.mangofuture.com/share");
  assert.equal(shareUrl.searchParams.get("v"), "1");
  assert.equal(shareUrl.searchParams.get("repo"), "exampleorg/company-docs");
  assert.equal(shareUrl.searchParams.get("path"), "company/strategy.md");
  assert.equal(shareUrl.searchParams.get("rev"), rev);
  assert.equal(shareUrl.searchParams.get("title"), "Company Strategy");
  assert.equal(shareUrl.searchParams.has("snippet"), false);

  const deepLink = openPeekSharedDeepLinkUrl({
    repository: "ExampleOrg/company-docs",
    file: "company/strategy.md",
    rev,
    handoff: "handoff_1234567890abcdef",
  });
  assert.deepEqual(parseOpenPeekDeepLink(deepLink), {
    repository: "exampleorg/company-docs",
    file: "company/strategy.md",
    rev,
    share: true,
    handoff: "handoff_1234567890abcdef",
  });
  assert.equal(deepLink.includes("title="), false);
  assert.equal(deepLink.includes("snippet="), false);
});

test("OpenPeek share title is bounded without carrying ai_snippet", () => {
  const url = new URL(openPeekShareUrl({
    repository: "owner/repo",
    file: "README.md",
    rev: "e".repeat(40),
    title: "题".repeat(140),
    snippet: "摘要".repeat(160),
  }));

  assert.equal(url.searchParams.get("title").length, 100);
  assert.match(url.searchParams.get("title"), /…$/);
  assert.equal(url.searchParams.has("snippet"), false);
  assert.ok(url.toString().length < 4096);
});

test("OpenPeek share links reject invalid versions, revisions, duplicates, and extra fields", () => {
  const rev = "d".repeat(40);
  for (const url of [
    `openpeek://open-shared?v=2&repo=owner%2Frepo&path=README.md&rev=${rev}`,
    "openpeek://open-shared?v=1&repo=owner%2Frepo&path=README.md&rev=short",
    `openpeek://open-shared?v=1&repo=owner%2Frepo&repo=other%2Frepo&path=README.md&rev=${rev}`,
    `openpeek://open-shared?v=1&repo=owner%2Frepo&path=README.md&rev=${rev}&worktree=0123456789abcdef`,
  ]) {
    assert.equal(parseOpenPeekDeepLink(url), null, url);
  }
});

test("OpenPeek accepts a handoff-only deep link for app launch confirmation", () => {
  assert.deepEqual(
    parseOpenPeekDeepLink("openpeek://open?handoff=handoff_1234567890abcdef"),
    { repoRoot: "", file: "", handoff: "handoff_1234567890abcdef" },
  );
  assert.equal(parseOpenPeekDeepLink("openpeek://open?handoff=short"), null);
});

test("OpenPeek deep links reject unsupported hosts, malformed repositories, and unsafe document paths", () => {
  for (const url of [
    "https://open?repo=%2Frepo&path=README.md",
    "openpeek://settings?repo=%2Frepo&path=README.md",
    "openpeek://open?repo=relative&path=README.md",
    "openpeek://open?repo=owner%2Frepo%2Fextra&path=README.md",
    "openpeek://open?repo=owner%2Frepo&path=README.txt",
    "openpeek://open?repo=%2Frepo&path=..%2Fsecret.md",
    "openpeek://open?repo=%2Frepo&path=%2Fetc%2Fpasswd.md",
    "openpeek://open?repo=%2Frepo&path=docs%2Fimage.png",
    "openpeek://open?repo=owner%2Frepo&path=README.md&worktree=main",
    "openpeek://open?repo=owner%2Frepo&path=README.md&worktree=0123456789abcdef",
    "openpeek://open-worktree?repo=owner%2Frepo&path=README.md",
    "openpeek://open?repo=%2Frepo&path=README.md&worktree=0123456789abcdef",
  ]) {
    assert.equal(parseOpenPeekDeepLink(url, { platform: "darwin" }), null, url);
  }
});

test("OpenPeek finds a deep link anywhere in desktop process arguments", () => {
  assert.deepEqual(
    openPeekDeepLinkFromArgs([
      "C:\\Program Files\\OpenPeek\\OpenPeek.exe",
      "--original-process-start-time=123",
      "openpeek://open?repo=C%3A%5CProjects%5Ccompany-docs&path=README.md",
    ], { platform: "win32" }),
    {
      repoRoot: "C:\\Projects\\company-docs",
      file: "README.md",
    },
  );
});

test("OpenPeek continues to open Git Leaf 1.x deep links", () => {
  assert.deepEqual(
    parseOpenPeekDeepLink(
      "git-leaf://open?repo=%2FUsers%2Fmaintainer%2FProjects%2Fcompany-docs&path=README.md",
      { platform: "darwin" },
    ),
    {
      repoRoot: "/Users/maintainer/Projects/company-docs",
      file: "README.md",
    },
  );
});

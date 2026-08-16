import assert from "node:assert/strict";
import test from "node:test";

import {
  openGlanceDeepLinkFromArgs,
  openGlanceDeepLinkUrl,
  openGlanceSharedDeepLinkUrl,
  parseOpenGlanceDeepLink,
} from "../src/desktop/deep-link.mjs";
import {
  openGlanceHttpsOpenUrl,
  openGlanceShareUrl,
} from "../src/server/hosted-links.mjs";

test("OpenGlance HTTPS links carry a local worktree id without exposing its path", () => {
  assert.equal(
    openGlanceHttpsOpenUrl({
      repository: "ExampleOrg/company-docs",
      file: "docs/report.md",
      worktree: "0123456789abcdef",
    }),
    "https://gitleaf.mangofuture.com/open?repo=exampleorg%2Fcompany-docs&path=docs%2Freport.md&worktree=0123456789abcdef",
  );
});

test("OpenGlance deep links round-trip a macOS repository and Markdown document", () => {
  const url = openGlanceDeepLinkUrl({
    repoRoot: "/Users/maintainer/Projects/company-docs",
    file: "docs/strategy notes.md",
    platform: "darwin",
  });

  assert.equal(
    url,
    "openglance://open?repo=%2FUsers%2Fmaintainer%2FProjects%2Fcompany-docs&path=docs%2Fstrategy+notes.md",
  );
  assert.deepEqual(parseOpenGlanceDeepLink(url, { platform: "darwin" }), {
    repoRoot: "/Users/maintainer/Projects/company-docs",
    file: "docs/strategy notes.md",
  });
});

test("OpenGlance deep links round-trip a Windows repository and normalize document separators", () => {
  const url = openGlanceDeepLinkUrl({
    repoRoot: "C:\\Users\\mango\\Projects\\company-docs",
    file: "docs\\strategy.md",
    platform: "win32",
  });

  assert.deepEqual(parseOpenGlanceDeepLink(url, { platform: "win32" }), {
    repoRoot: "C:\\Users\\mango\\Projects\\company-docs",
    file: "docs/strategy.md",
  });
});

test("OpenGlance deep links round-trip a stable GitHub repository identity", () => {
  const url = openGlanceDeepLinkUrl({
    repository: "ExampleOrg/company-docs",
    file: "company/strategy.md",
    worktree: "0123456789abcdef",
    handoff: "handoff_1234567890abcdef",
  });

  assert.equal(
    url,
    "openglance://open-worktree?repo=exampleorg%2Fcompany-docs&path=company%2Fstrategy.md&worktree=0123456789abcdef&handoff=handoff_1234567890abcdef",
  );
  assert.deepEqual(parseOpenGlanceDeepLink(url), {
    repository: "exampleorg/company-docs",
    file: "company/strategy.md",
    worktree: "0123456789abcdef",
    handoff: "handoff_1234567890abcdef",
  });
});

test("OpenGlance share links use an independent versioned protocol", () => {
  const rev = "c".repeat(40);
  const shareUrl = new URL(openGlanceShareUrl({
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

  const deepLink = openGlanceSharedDeepLinkUrl({
    repository: "ExampleOrg/company-docs",
    file: "company/strategy.md",
    rev,
    handoff: "handoff_1234567890abcdef",
  });
  assert.deepEqual(parseOpenGlanceDeepLink(deepLink), {
    repository: "exampleorg/company-docs",
    file: "company/strategy.md",
    rev,
    share: true,
    handoff: "handoff_1234567890abcdef",
  });
  assert.equal(deepLink.includes("title="), false);
  assert.equal(deepLink.includes("snippet="), false);
});

test("OpenGlance share title is bounded without carrying ai_snippet", () => {
  const url = new URL(openGlanceShareUrl({
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

test("OpenGlance share links reject invalid versions, revisions, duplicates, and extra fields", () => {
  const rev = "d".repeat(40);
  for (const url of [
    `openglance://open-shared?v=2&repo=owner%2Frepo&path=README.md&rev=${rev}`,
    "openglance://open-shared?v=1&repo=owner%2Frepo&path=README.md&rev=short",
    `openglance://open-shared?v=1&repo=owner%2Frepo&repo=other%2Frepo&path=README.md&rev=${rev}`,
    `openglance://open-shared?v=1&repo=owner%2Frepo&path=README.md&rev=${rev}&worktree=0123456789abcdef`,
  ]) {
    assert.equal(parseOpenGlanceDeepLink(url), null, url);
  }
});

test("OpenGlance accepts a handoff-only deep link for app launch confirmation", () => {
  assert.deepEqual(
    parseOpenGlanceDeepLink("openglance://open?handoff=handoff_1234567890abcdef"),
    { repoRoot: "", file: "", handoff: "handoff_1234567890abcdef" },
  );
  assert.equal(parseOpenGlanceDeepLink("openglance://open?handoff=short"), null);
});

test("OpenGlance deep links reject unsupported hosts, malformed repositories, and unsafe document paths", () => {
  for (const url of [
    "https://open?repo=%2Frepo&path=README.md",
    "openglance://settings?repo=%2Frepo&path=README.md",
    "openglance://open?repo=relative&path=README.md",
    "openglance://open?repo=owner%2Frepo%2Fextra&path=README.md",
    "openglance://open?repo=owner%2Frepo&path=README.txt",
    "openglance://open?repo=%2Frepo&path=..%2Fsecret.md",
    "openglance://open?repo=%2Frepo&path=%2Fetc%2Fpasswd.md",
    "openglance://open?repo=%2Frepo&path=docs%2Fimage.png",
    "openglance://open?repo=owner%2Frepo&path=README.md&worktree=main",
    "openglance://open?repo=owner%2Frepo&path=README.md&worktree=0123456789abcdef",
    "openglance://open-worktree?repo=owner%2Frepo&path=README.md",
    "openglance://open?repo=%2Frepo&path=README.md&worktree=0123456789abcdef",
  ]) {
    assert.equal(parseOpenGlanceDeepLink(url, { platform: "darwin" }), null, url);
  }
});

test("OpenGlance finds a deep link anywhere in desktop process arguments", () => {
  assert.deepEqual(
    openGlanceDeepLinkFromArgs([
      "C:\\Program Files\\OpenGlance\\OpenGlance.exe",
      "--original-process-start-time=123",
      "openglance://open?repo=C%3A%5CProjects%5Ccompany-docs&path=README.md",
    ], { platform: "win32" }),
    {
      repoRoot: "C:\\Projects\\company-docs",
      file: "README.md",
    },
  );
});

test("OpenGlance continues to open Git Leaf 1.x deep links", () => {
  assert.deepEqual(
    parseOpenGlanceDeepLink(
      "git-leaf://open?repo=%2FUsers%2Fmaintainer%2FProjects%2Fcompany-docs&path=README.md",
      { platform: "darwin" },
    ),
    {
      repoRoot: "/Users/maintainer/Projects/company-docs",
      file: "README.md",
    },
  );
});

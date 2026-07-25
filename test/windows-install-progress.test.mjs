import assert from "node:assert/strict";
import test from "node:test";

import { windowsInstallProgressHtml } from "../src/windows-install-progress.mjs";

test("Windows update progress window defaults to English", () => {
  const html = windowsInstallProgressHtml({
    version: "1.4.0",
    mode: "update",
  });

  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Git Leaf Update<\/title>/);
  assert.match(html, /Updating Git Leaf 1\.4\.0/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow/);
  assert.match(html, /updateInstallProgress/);
  assert.match(html, /transition: width 320ms ease/);
  assert.match(html, /Please wait\. Git Leaf will finish automatically and reopen/);
  assert.match(html, /class="detail" id="detail" hidden/);
  assert.match(html, /detail\.hidden = !state\.detail/);
});

test("same-version redirect window accepts a Chinese locale alias", () => {
  const html = windowsInstallProgressHtml({
    version: "1.4.0",
    mode: "redirect",
    locale: "zh-CN",
  });

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /正在启动 Git Leaf 1\.4\.0/);
  assert.match(html, /Git Leaf 会自动完成并重新打开/);
});

test("outdated package window starts in a visible handoff state", () => {
  const html = windowsInstallProgressHtml({
    version: "1.3.0",
    mode: "outdated",
  });

  assert.match(html, /Starting Git Leaf 1\.3\.0/);
  assert.match(html, /data-phase="starting"/);
  assert.match(html, /data-phase="outdated"/);
});

test("Windows update progress window accepts the Chinese language option", () => {
  const html = windowsInstallProgressHtml({
    version: "1.4.0",
    mode: "update",
    language: "zh-CN",
  });

  assert.match(html, /<title>Git Leaf 更新<\/title>/);
  assert.match(html, /正在更新 Git Leaf 1\.4\.0/);
  assert.match(html, /请稍候，Git Leaf 会自动完成并重新打开/);
  assert.match(html, /正在开始…/);
});
